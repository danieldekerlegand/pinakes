"""Incremental, QID-keyed corpus updates from a fresher dump slice (US-006).

A living corpus must not require a full re-ingestion every time a few upstream
entities change. The MERGE-on-``csid`` Neo4j load is already idempotent and
``csid`` is QID-anchored, so re-exporting a changed entity lands it on the very
node it already occupies — an in-place update, never a duplicate. That makes an
incremental *upsert* architecturally cheap; this module supplies the orchestration
around it.

The flow, keyed on QID throughout:

1. **Diff** the fresher slice against the one the corpus was built from
   (:mod:`culturescrape.acquire.wikidata_diff`) → the added / changed / removed
   QIDs. The change set is cross-referenced against the QIDs the corpus already
   holds (:func:`dataset_qids`).
2. **Resolve** which of the job's ``wikidata-dump`` categories each changed QID
   belongs to (via the new slice's membership index, or a bounded scan), so each
   affected entity is re-exported under the right label/dimensions/links.
3. **Re-hydrate & re-export** only those entities: a small *delta dump* holding
   just the changed members is carved from the new slice, the job is repointed at
   it (each category pinned to its changed members via the adapter's ``ids``
   allowlist), and :func:`~culturescrape.orchestrate.corpus.build_corpus` rebuilds
   a *delta corpus* — the affected rows, and nothing else.
4. **Prove idempotency** offline: the delta MERGE-loads over the base corpus to a
   fixed point (:func:`~culturescrape.neo4j.merge_load.verify_upsert_load`).

Each run appends an auditable line to ``<output_root>/sync-log.jsonl``
(:func:`write_sync_log`) — the entity-granularity complement to the
category-granularity ``--since`` refresh log (:mod:`culturescrape.orchestrate.
schedule`); :func:`last_sync_at` lets a scheduled caller reuse ``--since`` to avoid
re-syncing too often.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.wikidata_diff import DumpDiff, diff_dumps, write_delta_dump
from culturescrape.acquire.wikidata_dump import (
    INSTANCE_OF,
    SUBCLASS_OF,
    claim_entity_ids,
    iter_entities,
)
from culturescrape.acquire.wikidata_dump_index import (
    DumpIndex,
    default_index_path,
    dump_version,
    load_index,
)
from culturescrape.neo4j.merge_load import (
    IdempotencyReport,
    verify_idempotent_load,
    verify_upsert_load,
)
from culturescrape.ontology.linker import Node
from culturescrape.ontology.metrics import read_dataset
from culturescrape.orchestrate.corpus import (
    CORPUS_DIRNAME,
    DEFAULT_CORPUS_QA,
    CorpusBuild,
    build_corpus,
)
from culturescrape.orchestrate.jobs import Job
from culturescrape.orchestrate.runner import AdapterFactory
from culturescrape.schema.ids import csid_qid

LOGGER = logging.getLogger(__name__)

#: The ``source.type`` the incremental path re-hydrates from.
_DUMP_SOURCE_TYPE = "wikidata-dump"

#: Filename of the JSONL sync log appended under a job's output root.
SYNC_LOG_NAME = "sync-log.jsonl"


def _scalar(row: Node, key: str) -> str:
    """The first value of *key* in *row* as a plain string (``""`` when absent)."""
    value = row.get(key, "")
    if isinstance(value, list):
        return value[0] if value else ""
    return value


def dataset_qids(dataset_dir: str | Path) -> frozenset[str]:
    """The set of Wikidata QIDs the corpus under *dataset_dir* holds.

    Reads each node's ``csid`` and recovers the QID a QID-anchored id carries
    (:func:`~culturescrape.schema.ids.csid_qid`); alias-/name-anchored nodes (no
    QID) are skipped. A missing directory reads as the empty set, so a first-ever
    build diffs cleanly.
    """
    dataset_dir = Path(dataset_dir)
    if not dataset_dir.is_dir():
        return frozenset()
    nodes, _edges = read_dataset(dataset_dir)
    qids: set[str] = set()
    for node in nodes:
        qid = csid_qid(_scalar(node, "csid"))
        if qid is not None:
            qids.add(qid)
    return frozenset(qids)


@dataclass(frozen=True)
class UpsertPlan:
    """What a diff says should be re-ingested, keyed on QID.

    Attributes:
        diff: The added / changed / removed classification of the two slices.
        watermark: The ``YYYYMMDD`` version of the new slice — the point the
            corpus is being advanced to.
        corpus_qids: The QIDs the corpus already holds (empty when no corpus was
            supplied), used to report which changes actually touch it.
    """

    diff: DumpDiff
    watermark: str
    corpus_qids: frozenset[str]

    @property
    def upsert_qids(self) -> tuple[str, ...]:
        """The QIDs to re-hydrate and re-export (added ∪ changed)."""
        return self.diff.upsert_qids

    @property
    def changed_in_corpus(self) -> tuple[str, ...]:
        """Changed QIDs the corpus already carries (a true refresh), sorted."""
        return tuple(q for q in self.diff.changed if q in self.corpus_qids)

    @property
    def removed_in_corpus(self) -> tuple[str, ...]:
        """Removed QIDs the corpus still carries (stale, upsert never deletes)."""
        return tuple(q for q in self.diff.removed if q in self.corpus_qids)

    @property
    def summary(self) -> str:
        return f"→ {self.watermark}: {self.diff.summary}"


def plan_upsert(
    old_dump: str | Path, new_dump: str | Path, *, corpus_dir: str | Path | None = None
) -> UpsertPlan:
    """Diff *new_dump* against *old_dump* and grade the change set (no rebuild).

    When *corpus_dir* is given, the change set is cross-referenced against the
    corpus's own QIDs so the plan can report which changes actually touch it
    (removed entities are reported but never deleted — this is an upsert path).
    """
    diff = diff_dumps(old_dump, new_dump)
    corpus = dataset_qids(corpus_dir) if corpus_dir is not None else frozenset()
    return UpsertPlan(diff=diff, watermark=dump_version(Path(new_dump)), corpus_qids=corpus)


@dataclass(frozen=True)
class UpsertResult:
    """The outcome of an incremental upsert.

    Attributes:
        plan: The diff/plan the upsert was driven from.
        categories: The affected category ids that were re-built (empty when the
            change set touched none of the job's dump categories).
        delta_dump: The carved delta dump the affected entities were re-hydrated
            from, or ``None`` when nothing was re-built.
        delta_corpus: The re-exported delta corpus dataset, or ``None``.
        delta_report: Idempotency of the delta corpus loaded on its own, or ``None``.
        upsert_report: Idempotency of the delta MERGE-loaded over the base corpus,
            or ``None`` when no base corpus was available to load over.
    """

    plan: UpsertPlan
    categories: tuple[str, ...]
    delta_dump: Path | None
    delta_corpus: Path | None
    delta_report: IdempotencyReport | None
    upsert_report: IdempotencyReport | None

    @property
    def rebuilt(self) -> bool:
        """Whether any affected entity was re-hydrated and re-exported."""
        return self.delta_corpus is not None

    @property
    def idempotent(self) -> bool:
        """Whether every idempotency proof that ran passed (vacuously true if none)."""
        reports = [r for r in (self.delta_report, self.upsert_report) if r is not None]
        return all(r.idempotent for r in reports)


def run_upsert(
    job: Job,
    old_dump: str | Path,
    new_dump: str | Path,
    *,
    work_dir: str | Path,
    new_index: str | Path | None = None,
    corpus_dir: str | Path | None = None,
    adapter_factory: AdapterFactory | None = None,
    workers: int = 2,
    logger: logging.Logger = LOGGER,
) -> UpsertResult:
    """Diff, re-hydrate the changed entities, re-export them, and prove idempotency.

    *job* is the job that built the corpus (its ``wikidata-dump`` categories decide
    which entities belong where); *old_dump* is the slice it was built from and
    *new_dump* the fresher one. The changed members are carved into a small delta
    dump under *work_dir* and re-built into a *delta corpus* (also under *work_dir*)
    — the affected rows, ready to MERGE-load over the base corpus. *corpus_dir*
    defaults to the job's own corpus (``<output_root>/corpus``); when it exists the
    delta's idempotent load over it is verified. Pass an *adapter_factory* that
    raises to assert the rebuild stays offline.

    Returns an :class:`UpsertResult`; when the change set touches none of the job's
    dump categories it carries ``rebuilt is False`` and no delta artifacts.
    """
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    if corpus_dir is None:
        corpus_dir = job.output_root / CORPUS_DIRNAME
    corpus_dir = Path(corpus_dir)
    base = corpus_dir if corpus_dir.is_dir() else None

    plan = plan_upsert(old_dump, new_dump, corpus_dir=base)
    upsert = set(plan.upsert_qids)

    dump_categories = [c for c in job.categories if c.source.type == _DUMP_SOURCE_TYPE]
    members = _members_by_category(new_dump, dump_categories, new_index)

    selected: set[str] = set()
    per_category: dict[str, set[str]] = {}
    for category in dump_categories:
        ids = members.get(category.id, set()) & upsert
        if ids:
            per_category[category.id] = ids
            selected |= ids

    if not selected:
        logger.info(
            "upsert %s: %s; no changed entity belongs to a dump category — nothing "
            "to rebuild",
            job.name,
            plan.summary,
            extra={"event": "upsert.noop", "job": job.name},
        )
        return UpsertResult(plan, (), None, None, None, None)

    delta_dump = work_dir / f"wikidata-delta-{plan.watermark}.json.gz"
    write_delta_dump(new_dump, selected, delta_dump)

    delta_specs = tuple(
        _repoint(category, delta_dump, per_category[category.id])
        for category in dump_categories
        if category.id in per_category
    )
    delta_root = work_dir / "delta"
    delta_job = replace(job, categories=delta_specs, output_root=delta_root)

    # The delta is a handful of entities that will not self-connect; relax the
    # connectivity floor and never fail the build on QA — its job is to produce the
    # affected rows for an in-place MERGE, not to stand as a corpus of its own.
    build: CorpusBuild = build_corpus(
        delta_job,
        adapter_factory=adapter_factory,
        force=True,
        workers=workers,
        qa=replace(DEFAULT_CORPUS_QA, fail_on_violation=False),
        min_component_fraction=0.0,
        logger=logger,
    )

    delta_report = verify_idempotent_load(build.dataset_dir)
    upsert_report = verify_upsert_load(base, build.dataset_dir) if base else None
    logger.info(
        "upsert %s: %s; rebuilt %d entit(ies) across %d categor(ies), idempotent=%s",
        job.name,
        plan.summary,
        len(selected),
        len(per_category),
        delta_report.idempotent and (upsert_report is None or upsert_report.idempotent),
        extra={"event": "upsert.rebuilt", "job": job.name},
    )
    return UpsertResult(
        plan=plan,
        categories=tuple(sorted(per_category)),
        delta_dump=delta_dump,
        delta_corpus=build.dataset_dir,
        delta_report=delta_report,
        upsert_report=upsert_report,
    )


def _repoint(
    category: CategorySpec, delta_dump: Path, ids: set[str]
) -> CategorySpec:
    """Repoint a dump *category* at *delta_dump*, pinned to its changed *ids*.

    The ``path`` swaps to the delta dump and an ``ids`` allowlist pins membership
    to exactly the changed members (so the adapter re-hydrates only them); the
    ``index`` param is dropped because it fingerprints the *old* dump. ``class`` /
    ``transitive`` / ``hydrate`` and friends ride through unchanged, so the
    re-hydrated rows are byte-for-byte what a full build would have produced.
    """
    params = dict(category.source.params)
    params.pop("index", None)
    params["path"] = str(delta_dump)
    params["ids"] = ";".join(sorted(ids))
    return replace(category, source=replace(category.source, params=params))


def _open_index(
    new_dump: str | Path, new_index: str | Path | None
) -> DumpIndex | None:
    """Load the membership index to resolve category membership, or ``None``.

    An explicit *new_index* is used (verified against *new_dump*); otherwise the
    conventional sidecar beside the new dump is used when present. Absent both, the
    caller falls back to a bounded dump scan.
    """
    new_dump = Path(new_dump)
    if new_index is not None:
        return load_index(Path(new_index), new_dump)
    sidecar = default_index_path(new_dump)
    return load_index(sidecar, new_dump) if sidecar.exists() else None


def _members_by_category(
    new_dump: str | Path,
    categories: Sequence[CategorySpec],
    new_index: str | Path | None,
) -> dict[str, set[str]]:
    """Resolve each dump category's member QIDs over *new_dump*.

    Uses the membership index when one is available (an O(1) lookup per category);
    otherwise falls back to a two-pass scan of the new slice (one pass for the
    ``P279`` subclass map, one to collect ``P31`` members) — bounded regardless of
    how many categories share the scan.
    """
    index = _open_index(new_dump, new_index)
    if index is not None:
        try:
            return {
                category.id: set(
                    index.member_qids(*_selection(category))
                )
                for category in categories
            }
        finally:
            index.close()
    return _scan_members(new_dump, categories)


def _selection(category: CategorySpec) -> tuple[tuple[str, ...], bool]:
    """The ``(roots, transitive)`` a dump category selects members by."""
    params = category.source.params
    roots = tuple(
        qid.strip() for qid in params.get("class", "").split(";") if qid.strip()
    )
    transitive = (params.get("transitive") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    return roots, transitive


def _scan_members(
    new_dump: str | Path, categories: Sequence[CategorySpec]
) -> dict[str, set[str]]:
    """Index-free member resolution: two bounded passes over the new slice."""
    selections = {category.id: _selection(category) for category in categories}
    transitive_roots = {
        root
        for roots, transitive in selections.values()
        if transitive
        for root in roots
    }
    children: dict[str, set[str]] = {}
    if transitive_roots:  # only pay for the P279 pass if any category is transitive
        for entity in iter_entities(new_dump):
            child = entity["id"]
            for parent in claim_entity_ids(entity, SUBCLASS_OF):
                children.setdefault(parent, set()).add(child)

    closures = {
        cid: _closure(roots, children) if transitive else set(roots)
        for cid, (roots, transitive) in selections.items()
    }
    members: dict[str, set[str]] = {cid: set() for cid in selections}
    for entity in iter_entities(new_dump):
        instance_classes = set(claim_entity_ids(entity, INSTANCE_OF))
        if not instance_classes:
            continue
        qid = entity["id"]
        for cid, closure in closures.items():
            if not closure.isdisjoint(instance_classes):
                members[cid].add(qid)
    return members


def _closure(roots: tuple[str, ...], children: dict[str, set[str]]) -> set[str]:
    """The class *roots* plus every ``P279`` descendant, via *children*."""
    closure = set(roots)
    stack = list(roots)
    while stack:
        for child in children.get(stack.pop(), ()):
            if child not in closure:
                closure.add(child)
                stack.append(child)
    return closure


def write_sync_log(
    output_root: str | Path, result: UpsertResult, *, now: datetime
) -> Path:
    """Append a JSON line recording *result* to ``<output_root>/sync-log.jsonl``.

    The entity-granularity twin of :func:`~culturescrape.orchestrate.schedule.
    write_refresh_log`: one line per sync carrying the watermark the corpus was
    advanced to, the added/changed/removed tallies, the categories rebuilt, and
    whether the load proved idempotent — an auditable trail a scheduled sync leaves.
    """
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    path = output_root / SYNC_LOG_NAME
    plan = result.plan
    entry = {
        "timestamp": now.isoformat(),
        "watermark": plan.watermark,
        "added": len(plan.diff.added),
        "changed": len(plan.diff.changed),
        "removed": len(plan.diff.removed),
        "unchanged": plan.diff.unchanged,
        "upserted": len(plan.upsert_qids),
        "changed_in_corpus": len(plan.changed_in_corpus),
        "removed_in_corpus": len(plan.removed_in_corpus),
        "categories": list(result.categories),
        "rebuilt": result.rebuilt,
        "idempotent": result.idempotent,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")
    return path


def last_sync_at(output_root: str | Path) -> datetime | None:
    """The timestamp of the most recent sync recorded under *output_root*, or ``None``.

    Reads the last line of ``sync-log.jsonl`` so a scheduled caller can reuse
    ``--since`` (:func:`~culturescrape.orchestrate.schedule.parse_duration`) to skip
    a sync that ran within the window. A naive timestamp is read as UTC.
    """
    path = Path(output_root) / SYNC_LOG_NAME
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    except OSError:
        return None
    for line in reversed(lines):
        try:
            stamp = json.loads(line).get("timestamp")
            parsed = datetime.fromisoformat(str(stamp))
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    return None


__all__ = [
    "SYNC_LOG_NAME",
    "UpsertPlan",
    "UpsertResult",
    "dataset_qids",
    "last_sync_at",
    "plan_upsert",
    "run_upsert",
    "write_sync_log",
]
