"""Trust tiers: which facts auto-admit to the graph corpus, which quarantine.

Phase 3 of the neurosymbolic roadmap (item 3.5) decouples the machine-trusted
grounding corpus from the human-curated app lexicons. The pilot's ~1.7% curation
yield makes the human gate the binding constraint on corpus growth, so a fact
that is *already* globally identified and externally referenced should not have
to wait behind curation to reach the graph — it can **auto-admit** with a rubric
confidence and a trust-tier label, while everything weaker **quarantines**
awaiting a human. Crucially this is a graph-corpus policy only: it never writes
``data/source/lexicons/*.tsv`` (human curation remains the sole path into the app-facing
lexicon layer), so a corpus build classifies rows, it does not move them.

The stitch/merge machinery already unions the pinakes canonical export with
auto-admitted domain corpora (:mod:`pinakes_engine.orchestrate.merge` +
:func:`pinakes_engine.orchestrate.corpus.build_corpus`, US-004); tiering is the
policy layer on top: a pure classifier over each row's provenance, a per-tier QA
policy, and a deterministic composition manifest.

Tiers, most-to-least trusted:

* :data:`TIER_CURATED` — the row came through the human-curated lexicon gate
  (``source`` names :data:`PINAKES_SOURCE`). Highest trust: a person vetted
  it. Curation is enforced upstream, so this tier carries no provenance floor
  here.
* :data:`TIER_AUTO_ADMITTED` — **QID-anchored *and* reference-backed**. A node
  auto-admits when it carries a ``wikidata_qid`` (global identity) *and* a
  ``source_url`` (a resolvable citation to the source authority); an edge, which
  has no QID column, auto-admits on a ``source_url`` citation. These reach the
  graph corpus automatically with their US-001 rubric confidence
  (``referenced-wikidata`` = 0.9) and no human in the loop.
* :data:`TIER_QUARANTINE` — an acquired fact that is *not* both QID-anchored and
  reference-backed (a QID with no citation, a name-only row, an HTML scrape). It
  still lands in the corpus, tagged, but in the low-trust tier awaiting curation.
* :data:`TIER_INFERRED` — synthesized scaffolding: a linker-minted hub or an
  inferred edge (``source`` starts with ``inferred:``). Not an acquired fact, so
  it is neither auto-admitted nor a curation candidate — it is a derived join.

``tier`` is deliberately *not* a new canonical TSV column (that would cascade
into the neo4j/datalog schema and every committed snapshot). It is a pure
function of columns that are **already** first-class and queryable — ``source``,
``wikidata_qid``, ``source_url`` — which the Datalog projection exposes as
``source(Csid, Source)`` facts and Neo4j as node/edge properties, so a query
recovers the tier by the same predicate. :func:`classify_tier` is that function;
the runbook (``docs/tiered-trust.md``) records the source→tier mapping.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from pinakes_engine.ontology.linker import Edge, Node
from pinakes_engine.ontology.metrics import PINAKES_SOURCE, nodes_by_label
from pinakes_engine.orchestrate.manifest import edges_by_type
from pinakes_engine.orchestrate.qa import GateThresholds, QaReport, evaluate
from pinakes_engine.schema.tsvio import Row

#: The human-curated tier: the row passed through ``data/source/lexicons/*.tsv``
#: curation.
TIER_CURATED = "curated"

#: The auto-admitted tier: QID-anchored **and** reference-backed acquired facts.
TIER_AUTO_ADMITTED = "auto-admitted"

#: The quarantine tier: acquired facts awaiting curation (not both QID-anchored
#: and reference-backed).
TIER_QUARANTINE = "quarantine"

#: The inferred tier: linker-minted hubs / inferred edges (derived scaffolding).
TIER_INFERRED = "inferred"

#: The personal tier: facts ingested from a user's own private files by a
#: personal-tier acquisition source. NOT on the trust axis above — it is a
#: **privacy** partition: personal-tier records describe the user's private
#: material and are hard-gated out of every non-personal export, packaged
#: artifact, and open-data release (:func:`assert_no_personal_records`). A record
#: is personal iff its ``source`` names one of :data:`PERSONAL_SOURCES`.
TIER_PERSONAL = "personal"

#: Acquisition-source ids whose records are personal-tier (privacy invariant). A
#: match on any ``source`` token classifies the row personal regardless of any
#: other stamp (a grounded reference fact may carry a QID yet stays personal).
#:
#: **Empty by default** — pinakes bundles no personal-tier producer. A deployment
#: that ingests its own private material registers that adapter's source id here
#: and the whole tier applies to it unchanged: classification, per-tier gates,
#: the containment gate, and the tier-scoped Datalog export.
PERSONAL_SOURCES: frozenset[str] = frozenset()

#: The synthetic tier: facts ingested from a *generated* world via the Insimul
#: bridge (insimul-bridge US-003). Like :data:`TIER_PERSONAL` this is not a rung on
#: the trust ladder above — it is a **provenance partition**: a synthetic record
#: describes a world that does not exist, so however internally exact it is, it
#: must never be mixed into a real-world tier or an open-data release
#: (:func:`assert_no_synthetic_records`; the Insimul bridge spec §7 "License leakage").
#: A record is synthetic iff its ``source`` names one of :data:`SYNTHETIC_SOURCES`.
TIER_SYNTHETIC = "synthetic"

#: Acquisition-source ids whose records are synthetic-tier. A match on any
#: ``source`` token classifies the row synthetic regardless of any other stamp.
SYNTHETIC_SOURCES: frozenset[str] = frozenset({"insimul"})

#: Every tier — the stable order tier reports render in. The first four are the
#: trust axis (most-to-least trusted); :data:`TIER_PERSONAL` and
#: :data:`TIER_SYNTHETIC` are the orthogonal partitions, appended last.
ALL_TIERS: tuple[str, ...] = (
    TIER_CURATED,
    TIER_AUTO_ADMITTED,
    TIER_QUARANTINE,
    TIER_INFERRED,
    TIER_PERSONAL,
    TIER_SYNTHETIC,
)

#: The ``inferred:<linker>`` provenance prefix a linker-minted row carries.
_INFERRED_PREFIX = "inferred:"

#: Delimiter :mod:`pinakes_engine.schema.merge` joins concatenated ``source``
#: values with, so a reconciled row carries ``"pinakes;wikidata"``.
_SOURCE_DELIMITER = ";"


def classify_tier(row: Row) -> str:
    """Classify one node or edge *row* into its trust tier (pure).

    Precedence (a merged row can carry several signals, so order matters):

    #. any :data:`PERSONAL_SOURCES` ``source`` token → :data:`TIER_PERSONAL`
       (the privacy invariant: a fact derived from the user's files is personal
       regardless of any QID / citation it also carries, so this is checked
       **first** — it must never fall through to an exportable tier);
    #. any :data:`SYNTHETIC_SOURCES` ``source`` token → :data:`TIER_SYNTHETIC`
       (the same containment reasoning: a generated-world fact carries a real
       ``source_url`` and would otherwise auto-admit as though it described the
       world, so it is classified before the trust rungs are considered);
    #. any ``inferred:<linker>`` ``source`` token → :data:`TIER_INFERRED`;
    #. a :data:`PINAKES_SOURCE` ``source`` token → :data:`TIER_CURATED`
       (a curated row that *also* reconciled to Wikidata stays curated — human
       vetting is the strongest signal);
    #. otherwise an acquired fact: :data:`TIER_AUTO_ADMITTED` iff it is
       QID-anchored (a node with a ``wikidata_qid``; edges have no QID column so
       the requirement does not apply) **and** reference-backed (a non-empty
       ``source_url``), else :data:`TIER_QUARANTINE`.
    """
    tokens = _source_tokens(row)
    if tokens & PERSONAL_SOURCES:
        return TIER_PERSONAL
    if tokens & SYNTHETIC_SOURCES:
        return TIER_SYNTHETIC
    if any(token.startswith(_INFERRED_PREFIX) for token in tokens):
        return TIER_INFERRED
    if PINAKES_SOURCE in tokens:
        return TIER_CURATED
    reference_backed = bool(_scalar(row, "source_url"))
    if _is_edge(row):
        return TIER_AUTO_ADMITTED if reference_backed else TIER_QUARANTINE
    qid_anchored = bool(_scalar(row, "wikidata_qid"))
    if qid_anchored and reference_backed:
        return TIER_AUTO_ADMITTED
    return TIER_QUARANTINE


def partition_by_tier(rows: Sequence[Row]) -> dict[str, list[Row]]:
    """Group *rows* by :func:`classify_tier`, one bucket per tier (may be empty)."""
    buckets: dict[str, list[Row]] = {tier: [] for tier in ALL_TIERS}
    for row in rows:
        buckets[classify_tier(row)].append(row)
    return buckets


@dataclass(frozen=True)
class TierComposition:
    """The node/edge shape of one tier — a deterministic, content-only slice.

    Attributes:
        node_count: Nodes in the tier.
        edge_count: Edges in the tier.
        nodes_by_label: Tier node counts keyed by primary ``:LABEL``.
        edges_by_type: Tier edge counts keyed by ``:TYPE``.
    """

    node_count: int
    edge_count: int
    nodes_by_label: dict[str, int]
    edges_by_type: dict[str, int]

    def to_dict(self) -> dict[str, object]:
        return {
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "nodes_by_label": dict(self.nodes_by_label),
            "edges_by_type": dict(self.edges_by_type),
        }


@dataclass(frozen=True)
class TieredManifest:
    """Deterministic composition-by-tier fingerprint of a built corpus.

    Content-only (counts, no wall-clock, no paths), so the same corpus always
    serialises to the same bytes and a fresh build can be asserted byte-for-byte
    against the committed snapshot — the same discipline as
    :class:`~pinakes_engine.orchestrate.manifest.CorpusManifest`. This is the
    "committed manifest reports corpus composition by tier" deliverable.

    Attributes:
        job: The job the corpus was built from.
        node_count: Total node rows.
        edge_count: Total edge rows.
        nodes_by_tier: Node counts keyed by tier, in :data:`ALL_TIERS` order.
        edges_by_tier: Edge counts keyed by tier, in :data:`ALL_TIERS` order.
        tiers: Per-tier :class:`TierComposition` (label / type breakdown).
    """

    job: str
    node_count: int
    edge_count: int
    nodes_by_tier: dict[str, int]
    edges_by_tier: dict[str, int]
    tiers: dict[str, TierComposition]

    def to_dict(self) -> dict[str, object]:
        """Render as a plain, JSON-ready dict (tiers in :data:`ALL_TIERS` order)."""
        return {
            "job": self.job,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "nodes_by_tier": dict(self.nodes_by_tier),
            "edges_by_tier": dict(self.edges_by_tier),
            "tiers": {
                tier: self.tiers[tier].to_dict()
                for tier in ALL_TIERS
                if tier in self.tiers
            },
        }

    def to_json(self) -> str:
        """Render the manifest as pretty JSON (no trailing newline)."""
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)

    def write(self, path: str | Path) -> None:
        """Write the manifest JSON to *path* (with a trailing newline)."""
        Path(path).write_text(self.to_json() + "\n", encoding="utf-8")


def build_tier_manifest(
    job: str, nodes: Sequence[Node], edges: Sequence[Edge]
) -> TieredManifest:
    """Fingerprint the *nodes* / *edges* of the corpus built for *job*, by tier."""
    node_buckets = partition_by_tier(nodes)
    edge_buckets = partition_by_tier(edges)
    tiers: dict[str, TierComposition] = {}
    for tier in ALL_TIERS:
        tier_nodes = node_buckets[tier]
        tier_edges = edge_buckets[tier]
        if not tier_nodes and not tier_edges:
            continue
        tiers[tier] = TierComposition(
            node_count=len(tier_nodes),
            edge_count=len(tier_edges),
            nodes_by_label=nodes_by_label(tier_nodes),
            edges_by_type=edges_by_type(tier_edges),
        )
    return TieredManifest(
        job=job,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes_by_tier={
            tier: len(node_buckets[tier]) for tier in ALL_TIERS if node_buckets[tier]
        },
        edges_by_tier={
            tier: len(edge_buckets[tier]) for tier in ALL_TIERS if edge_buckets[tier]
        },
        tiers=tiers,
    )


def manifest_for_tier_dataset(job: str, directory: str | Path) -> TieredManifest:
    """Read the corpus under *directory* and fingerprint it by tier for *job*."""
    from pinakes_engine.ontology.metrics import read_dataset

    nodes, edges = read_dataset(directory)
    return build_tier_manifest(job, nodes, edges)


#: The default per-tier QA gates. The floors that actually differentiate trust:
#: an **auto-admitted** fact must be fully sourced (it is reference-backed by
#: definition) and QID-reconciled (so no unreconciled node) and deduped; a
#: **curated** row need not carry an external ``source_url`` (pinakes records
#: none — curation is the gate, enforced upstream) but must not duplicate; a
#: **quarantine** fact is by construction under-sourced, so it carries no floor
#: (it is *awaiting* curation, not failing it); **inferred** scaffolding is
#: exempt. Dangling-edge / connectivity stay permissive per tier — an edge in one
#: tier legitimately points at a node in another — because the whole-corpus QA
#: gate (:mod:`pinakes_engine.orchestrate.corpus`) enforces those globally.
#: A per-tier subset legitimately holds edges pointing at *other* tiers' nodes
#: (a curated edge into a quarantined node), so both the base and the
#: pinakes-scoped dangling-edge gates are permissive per tier — real
#: dangling is caught by the whole-corpus QA gate.
_PERMISSIVE_DANGLING = {
    "max_dangling_edge_rate": 1.0,
    "max_pinakes_dangling_edge_rate": 1.0,
}

DEFAULT_TIER_GATES: Mapping[str, GateThresholds] = {
    TIER_AUTO_ADMITTED: GateThresholds(
        min_rows=0,
        max_duplicate_rate=0.0,
        min_provenance_completeness=1.0,
        max_unreconciled_rate=0.0,
        **_PERMISSIVE_DANGLING,
    ),
    TIER_CURATED: GateThresholds(
        min_rows=0,
        max_duplicate_rate=0.0,
        min_provenance_completeness=0.0,
        max_unreconciled_rate=1.0,
        **_PERMISSIVE_DANGLING,
    ),
    TIER_QUARANTINE: GateThresholds(
        min_rows=0,
        max_duplicate_rate=1.0,
        min_provenance_completeness=0.0,
        max_unreconciled_rate=1.0,
        **_PERMISSIVE_DANGLING,
    ),
    TIER_INFERRED: GateThresholds(
        min_rows=0,
        max_duplicate_rate=1.0,
        min_provenance_completeness=0.0,
        max_unreconciled_rate=1.0,
        **_PERMISSIVE_DANGLING,
    ),
    # Personal-tier facts are local-only and awaiting no curation, so they carry
    # no trust floor here — containment (not admission) is their gate, enforced by
    # :func:`assert_no_personal_records` on every export/package path.
    TIER_PERSONAL: GateThresholds(
        min_rows=0,
        max_duplicate_rate=1.0,
        min_provenance_completeness=0.0,
        max_unreconciled_rate=1.0,
        **_PERMISSIVE_DANGLING,
    ),
    # A generated world is a closed KB: its rows are fully provenanced (world id +
    # seed + contract version) and carry no QID by construction — there is nothing
    # real to reconcile against — so the floor that bites is **dedup**. A duplicate
    # would mean the world-scoped csid mint forked, which is the one way a
    # Bridge-2 re-ingest could stop being idempotent.
    TIER_SYNTHETIC: GateThresholds(
        min_rows=0,
        max_duplicate_rate=0.0,
        min_provenance_completeness=1.0,
        max_unreconciled_rate=1.0,
        **_PERMISSIVE_DANGLING,
    ),
}


class PersonalTierContainmentError(RuntimeError):
    """Raised when a :data:`TIER_PERSONAL` record reaches a non-personal artifact.

    The privacy invariant of any personal-tier source: facts derived from the
    user's own private files must NEVER appear in an open-data release, a
    packaged corpus, or any non-personal export or training set. This is the hard
    gate that enforces it — the same mechanism the synthetic tier uses.
    """


def is_personal_source(source_cell: str) -> bool:
    """Whether a raw ``source`` cell names any :data:`PERSONAL_SOURCES` token."""
    tokens = {
        token.strip()
        for token in source_cell.split(_SOURCE_DELIMITER)
        if token.strip()
    }
    return bool(tokens & PERSONAL_SOURCES)


def personal_records(rows: Sequence[Row]) -> list[Row]:
    """Return every *row* that classifies as :data:`TIER_PERSONAL`."""
    return [row for row in rows if classify_tier(row) == TIER_PERSONAL]


def assert_no_personal_records(rows: Sequence[Row], *, context: str) -> None:
    """Assert no *row* is personal-tier; raise :class:`PersonalTierContainmentError`.

    The hard containment gate every **non-personal** export / packaging / release
    path calls before it emits *rows*. *context* names the artifact for the error
    message (e.g. ``"packaged corpus"``). A no-op when the corpus carries no
    personal-tier record (the common case, and the only case while
    :data:`PERSONAL_SOURCES` is empty) — so a build with no personal-tier ingest
    is unaffected.
    """
    offenders = personal_records(rows)
    if offenders:
        raise PersonalTierContainmentError(
            f"{len(offenders)} personal-tier record(s) would enter {context}, "
            f"violating the personal-tier privacy invariant; "
            f"personal-tier facts are local-only — first offender source="
            f"{_scalar(offenders[0], 'source')!r}"
        )


class SyntheticTierContainmentError(RuntimeError):
    """Raised when a :data:`TIER_SYNTHETIC` record reaches a real-world artifact.

    The containment invariant of the Insimul bridge (bridge spec §7
    "License leakage"): facts read out of a *generated* world are proprietary and
    describe a world that does not exist, so they must NEVER appear in an
    open-data release, a packaged corpus, or any non-synthetic export. This is the
    hard gate that enforces it — the sibling of
    :class:`PersonalTierContainmentError`.
    """


def is_synthetic_source(source_cell: str) -> bool:
    """Whether a raw ``source`` cell names any :data:`SYNTHETIC_SOURCES` token."""
    tokens = {
        token.strip()
        for token in source_cell.split(_SOURCE_DELIMITER)
        if token.strip()
    }
    return bool(tokens & SYNTHETIC_SOURCES)


def synthetic_records(rows: Sequence[Row]) -> list[Row]:
    """Return every *row* that classifies as :data:`TIER_SYNTHETIC`."""
    return [row for row in rows if classify_tier(row) == TIER_SYNTHETIC]


def assert_no_synthetic_records(rows: Sequence[Row], *, context: str) -> None:
    """Assert no *row* is synthetic-tier; raise :class:`SyntheticTierContainmentError`.

    The hard containment gate every **non-synthetic** export / packaging / release
    path calls before it emits *rows*. *context* names the artifact for the error
    message (e.g. ``"packaged corpus"``). A no-op when the corpus carries no
    synthetic-tier record (the common case) — so a build with no Insimul ingest is
    unaffected.
    """
    offenders = synthetic_records(rows)
    if offenders:
        raise SyntheticTierContainmentError(
            f"{len(offenders)} synthetic-tier record(s) would enter {context}, "
            f"violating the synthetic-tier containment invariant "
            f"(the Insimul bridge spec §7 'License leakage'); generated-world facts "
            f"are proprietary and never mix into real-world tiers — first "
            f"offender source={_scalar(offenders[0], 'source')!r}"
        )


@dataclass(frozen=True)
class TierQaReport:
    """The per-tier QA verdict for a corpus.

    Attributes:
        reports: One :class:`~pinakes_engine.orchestrate.qa.QaReport` per
            *non-empty* tier, keyed by tier (in :data:`ALL_TIERS` order).
    """

    reports: dict[str, QaReport]

    @property
    def ok(self) -> bool:
        """Whether every tier's gates passed."""
        return all(report.ok for report in self.reports.values())

    @property
    def violations(self) -> tuple[tuple[str, str], ...]:
        """``(tier, gate label)`` pairs that failed, in tier / gate order."""
        out: list[tuple[str, str]] = []
        for tier in ALL_TIERS:
            report = self.reports.get(tier)
            if report is None:
                continue
            out.extend((tier, gate.label) for gate in report.violations)
        return tuple(out)

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "tiers": {
                tier: self.reports[tier].to_dict()
                for tier in ALL_TIERS
                if tier in self.reports
            },
        }

    def to_json(self) -> str:
        """Render the report as stable, indented JSON."""
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)

    def write(self, path: str | Path) -> Path:
        """Write the report to *path* as JSON, creating parent directories."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json() + "\n", encoding="utf-8")
        return path

    def render_summary(self) -> str:
        """A short, human-readable multi-line per-tier summary."""
        status = "ok" if self.ok else f"{len(self.violations)} violation(s)"
        lines = [f"tiered QA: {status}"]
        for tier in ALL_TIERS:
            report = self.reports.get(tier)
            if report is None:
                continue
            tier_status = "ok" if report.ok else f"{len(report.violations)} failed"
            lines.append(
                f"  [{tier}] {tier_status} "
                f"({report.node_count} node(s), {report.edge_count} edge(s))"
            )
        return "\n".join(lines)


def evaluate_tiers(
    nodes: Sequence[Row],
    edges: Sequence[Row],
    tier_gates: Mapping[str, GateThresholds] = DEFAULT_TIER_GATES,
    *,
    base: GateThresholds | None = None,
) -> TierQaReport:
    """Grade each *non-empty* tier's rows against its own gate thresholds.

    A tier with no gate configured falls back to *base* (else the tier's
    :data:`DEFAULT_TIER_GATES` entry, else a permissive default), so a partial
    override is valid. Empty tiers are skipped — a corpus that never auto-admits
    a fact has no auto-admitted gate to trip.
    """
    node_buckets = partition_by_tier(nodes)
    edge_buckets = partition_by_tier(edges)
    reports: dict[str, QaReport] = {}
    for tier in ALL_TIERS:
        tier_nodes = node_buckets[tier]
        tier_edges = edge_buckets[tier]
        if not tier_nodes and not tier_edges:
            continue
        thresholds = _thresholds_for(tier, tier_gates, base)
        reports[tier] = evaluate(tier_nodes, tier_edges, thresholds, dataset=tier)
    return TierQaReport(reports=reports)


def _thresholds_for(
    tier: str,
    tier_gates: Mapping[str, GateThresholds],
    base: GateThresholds | None,
) -> GateThresholds:
    """The thresholds for *tier*: its override, else *base*, else its default."""
    if tier in tier_gates:
        return tier_gates[tier]
    if base is not None:
        return base
    return DEFAULT_TIER_GATES.get(tier, GateThresholds())


def _is_edge(row: Row) -> bool:
    """Whether *row* is an edge (carries a ``:TYPE``) rather than a node."""
    return bool(_scalar(row, ":TYPE"))


def _source_tokens(row: Row) -> set[str]:
    """The distinct ``source`` provenance tokens on *row* (merge-split)."""
    source = _scalar(row, "source")
    return {token.strip() for token in source.split(_SOURCE_DELIMITER) if token.strip()}


def _scalar(row: Row, key: str) -> str:
    """The scalar value at *key*, stripped (a multi-value list is not scalar)."""
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


__all__ = [
    "ALL_TIERS",
    "DEFAULT_TIER_GATES",
    "PERSONAL_SOURCES",
    "SYNTHETIC_SOURCES",
    "TIER_AUTO_ADMITTED",
    "TIER_CURATED",
    "TIER_INFERRED",
    "TIER_PERSONAL",
    "TIER_QUARANTINE",
    "TIER_SYNTHETIC",
    "PersonalTierContainmentError",
    "SyntheticTierContainmentError",
    "TierComposition",
    "TierQaReport",
    "TieredManifest",
    "assert_no_personal_records",
    "assert_no_synthetic_records",
    "build_tier_manifest",
    "classify_tier",
    "evaluate_tiers",
    "is_personal_source",
    "is_synthetic_source",
    "manifest_for_tier_dataset",
    "partition_by_tier",
    "personal_records",
    "synthetic_records",
]
