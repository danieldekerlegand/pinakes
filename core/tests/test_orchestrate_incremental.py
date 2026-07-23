"""Incremental, QID-keyed corpus upsert from a fresher dump slice (US-006).

A living corpus must not be rebuilt from scratch when a handful of upstream
entities change. :mod:`culturescrape.orchestrate.incremental` diffs a fresher
slice against the one the corpus was built from, re-hydrates only the changed
members into a small *delta* corpus, and MERGE-loads it over the base — an
in-place update, because ``csid`` is QID-anchored. These tests pin the planning
logic, the member resolution, the sync log, and a full **offline** upsert on the
committed dump fixture (no network, no live Neo4j).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml

from culturescrape.acquire.factory import build_adapter
from culturescrape.acquire.wikidata_dump import iter_entities
from culturescrape.acquire.wikidata_slice import write_dump
from culturescrape.orchestrate.corpus import (
    DEFAULT_CORPUS_QA,
    CorpusBuild,
    build_corpus,
)
from culturescrape.orchestrate.generate import DumpSource, generate
from culturescrape.orchestrate.incremental import (
    UpsertPlan,
    dataset_qids,
    last_sync_at,
    plan_upsert,
    run_upsert,
    write_sync_log,
)
from culturescrape.orchestrate.jobs import Job, load_job
from culturescrape.schema.headers import NodeSchema
from culturescrape.schema.tsvio import write_node_rows

_FIXTURE = Path(__file__).parent / "fixtures" / "wikidata" / "sample-dump.json"


def _raise_no_network():  # type: ignore[no-untyped-def]
    raise AssertionError("the incremental path must not open a network connection")


def _factory(spec):  # type: ignore[no-untyped-def]
    return build_adapter(spec, http_factory=_raise_no_network)


def _fixture_entities() -> dict[str, dict[str, Any]]:
    """The committed fixture's item entities keyed by QID (drops the P31 property)."""
    return {e["id"]: e for e in iter_entities(_FIXTURE) if e["id"].startswith("Q")}


def _write_corpus(root: Path, csids: list[str]) -> Path:
    """A minimal node-only dataset whose nodes carry the given *csids*."""
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    rows = [{"csid": c, ":LABEL": ["Concept"], "name": c} for c in csids]
    write_node_rows(root / "nodes" / "concept.tsv", NodeSchema.canonical(), rows)
    return root


# --- dataset_qids --------------------------------------------------------------


def test_dataset_qids_recovers_qid_anchored_ids(tmp_path: Path) -> None:
    """QID-anchored csids surrender their QID; alias/name ids yield none."""
    corpus = _write_corpus(
        tmp_path / "corpus",
        ["cs:dish:Q12345", "cs:language:aap", "cs:dish:ceviche-9a3f"],
    )
    assert dataset_qids(corpus) == frozenset({"Q12345"})


def test_dataset_qids_of_missing_dir_is_empty(tmp_path: Path) -> None:
    """A first-ever build (no corpus yet) diffs cleanly against the empty set."""
    assert dataset_qids(tmp_path / "does-not-exist") == frozenset()


# --- plan_upsert ---------------------------------------------------------------


def _dump(entities: list[dict[str, Any]], path: Path) -> Path:
    write_dump(entities, path)
    return path


def test_plan_upsert_grades_changes_against_the_corpus(tmp_path: Path) -> None:
    ents = _fixture_entities()
    old = _dump([ents["Q1"], ents["Q42"], ents["Q146"]], tmp_path / "w-20260101.json")

    changed_q42 = {**ents["Q42"], "labels": {"en": {"language": "en", "value": "DA"}}}
    added = {
        "type": "item",
        "id": "Q999",
        "labels": {"en": {"language": "en", "value": "novel"}},
        "claims": {},
        "sitelinks": {},
    }
    new = _dump([ents["Q1"], changed_q42, added], tmp_path / "w-20260601.json")

    # The corpus carries Q1/Q42/Q146 (QID-anchored) but not the added Q999.
    corpus = _write_corpus(
        tmp_path / "corpus", ["cs:concept:Q1", "cs:concept:Q42", "cs:concept:Q146"]
    )

    plan = plan_upsert(old, new, corpus_dir=corpus)

    assert isinstance(plan, UpsertPlan)
    assert plan.watermark == "20260601"  # from the new dump's filename
    assert plan.diff.added == ("Q999",)
    assert plan.diff.changed == ("Q42",)
    assert plan.diff.removed == ("Q146",)
    assert plan.upsert_qids == ("Q42", "Q999")
    # Q42 is a changed entity the corpus already holds -> a true refresh.
    assert plan.changed_in_corpus == ("Q42",)
    # Q146 was removed upstream but the upsert never deletes it.
    assert plan.removed_in_corpus == ("Q146",)


def test_plan_upsert_without_corpus_reports_no_corpus_overlap(tmp_path: Path) -> None:
    ents = _fixture_entities()
    old = _dump([ents["Q1"]], tmp_path / "w-20260101.json")
    new = _dump(
        [{**ents["Q1"], "labels": {"en": {"language": "en", "value": "x"}}}],
        tmp_path / "w-20260601.json",
    )

    plan = plan_upsert(old, new)  # no corpus_dir

    assert plan.diff.changed == ("Q1",)
    assert plan.corpus_qids == frozenset()
    assert plan.changed_in_corpus == ()  # nothing known to overlap


# --- sync log ------------------------------------------------------------------


def test_sync_log_round_trips_watermark_and_last_sync(tmp_path: Path) -> None:
    ents = _fixture_entities()
    old = _dump([ents["Q1"]], tmp_path / "w-20260101.json")
    new = _dump(
        [{**ents["Q1"], "labels": {"en": {"language": "en", "value": "x"}}}],
        tmp_path / "w-20260601.json",
    )
    plan = plan_upsert(old, new)
    from culturescrape.orchestrate.incremental import UpsertResult

    result = UpsertResult(plan, (), None, None, None, None)
    stamp = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)

    path = write_sync_log(tmp_path / "out", result, now=stamp)

    assert path.read_text(encoding="utf-8").count("\n") == 1  # one JSONL line
    assert last_sync_at(tmp_path / "out") == stamp

    # A second sync appends; last_sync_at reads the most recent line.
    later = datetime(2026, 6, 2, 12, 0, tzinfo=UTC)
    write_sync_log(tmp_path / "out", result, now=later)
    assert path.read_text(encoding="utf-8").count("\n") == 2
    assert last_sync_at(tmp_path / "out") == later


def test_last_sync_at_of_missing_log_is_none(tmp_path: Path) -> None:
    assert last_sync_at(tmp_path / "never-synced") is None


# --- full offline upsert on the fixture dump -----------------------------------

#: One category per fixture class (``wikidata_class`` takes a single QID), so every
#: fixture item is a member of exactly one category.
_BLUEPRINT = {
    "defaults": {"label": "Concept", "dimensions": ["temporal"]},
    "categories": [
        {"id": "humans", "name": "concept", "wikidata_class": "Q5"},
        {"id": "universes", "name": "concept", "wikidata_class": "Q1454986"},
        {"id": "cats", "name": "concept", "wikidata_class": "Q55983715"},
    ],
}


def _build_base(root: Path, dump_path: Path) -> tuple[Job, CorpusBuild]:
    """Generate a dump job over *dump_path* and build its (tiny) base corpus offline."""
    root.mkdir(parents=True, exist_ok=True)
    blueprint = root / "bp.yml"
    blueprint.write_text(yaml.safe_dump(_BLUEPRINT), encoding="utf-8")
    result = generate(
        blueprint,
        root / "categories",
        job=root / "bp.job.yml",
        dump=DumpSource(path=dump_path, hydrate="default", transitive=False),
    )
    assert result.job is not None
    job = load_job(result.job)
    build = build_corpus(
        job,
        adapter_factory=_factory,
        force=True,
        workers=1,
        qa=replace(DEFAULT_CORPUS_QA, fail_on_violation=False),
        min_component_fraction=0.0,
    )
    return job, build


def test_run_upsert_rebuilds_only_changed_entities_and_is_idempotent(
    tmp_path: Path,
) -> None:
    """End-to-end offline: a changed + an added entity re-hydrate and MERGE cleanly.

    The base corpus is built from an old slice; a fresher slice edits Q42's label
    and adds a new Q900 of the same class. ``run_upsert`` diffs, carves a delta of
    exactly those two, rebuilds them offline (the network-raising factory proves
    it), and verifies the delta MERGE-loads over the base to a fixed point.
    """
    ents = _fixture_entities()
    old = _dump(
        [ents["Q1"], ents["Q42"], ents["Q146"]],
        tmp_path / "wikidata-20260101-old.json",
    )
    job, base = _build_base(tmp_path / "base", old)

    changed_q42 = {
        **ents["Q42"],
        "labels": {"en": {"language": "en", "value": "Douglas Noel Adams"}},
    }
    added = {
        "type": "item",
        "id": "Q900",
        "labels": {"en": {"language": "en", "value": "new human"}},
        "claims": {
            "P31": [
                {
                    "mainsnak": {
                        "snaktype": "value",
                        "property": "P31",
                        "datavalue": {
                            "value": {"entity-type": "item", "id": "Q5"},
                            "type": "wikibase-entityid",
                        },
                        "datatype": "wikibase-item",
                    },
                    "type": "statement",
                    "rank": "normal",
                }
            ]
        },
        "sitelinks": {},
    }
    new = _dump(
        [ents["Q1"], changed_q42, ents["Q146"], added],
        tmp_path / "wikidata-20260601-new.json",
    )

    result = run_upsert(
        job,
        old,
        new,
        work_dir=tmp_path / "sync",
        corpus_dir=base.dataset_dir,
        adapter_factory=_factory,
        workers=1,
    )

    assert result.rebuilt
    # Only Q42/Q900 changed, and both are P31 Q5 -> just the "humans" category.
    assert result.categories == ("humans",)
    assert set(result.plan.upsert_qids) == {"Q42", "Q900"}
    # The delta dump carries exactly the two changed/added members.
    assert result.delta_dump is not None
    assert {e["id"] for e in iter_entities(result.delta_dump)} == {"Q42", "Q900"}
    # Both idempotency proofs ran and held.
    assert result.delta_report is not None and result.delta_report.idempotent
    assert result.upsert_report is not None and result.upsert_report.idempotent
    assert result.idempotent


def test_run_upsert_is_a_noop_when_nothing_relevant_changed(tmp_path: Path) -> None:
    """A slice with no content change re-builds nothing (stays vacuously idempotent)."""
    ents = _fixture_entities()
    old = _dump([ents["Q1"], ents["Q42"]], tmp_path / "wikidata-20260101-old.json")
    job, base = _build_base(tmp_path / "base", old)
    # Same content, different filename/date -> zero diff.
    new = _dump([ents["Q1"], ents["Q42"]], tmp_path / "wikidata-20260601-new.json")

    result = run_upsert(
        job,
        old,
        new,
        work_dir=tmp_path / "sync",
        corpus_dir=base.dataset_dir,
        adapter_factory=_factory,
        workers=1,
    )

    assert not result.rebuilt
    assert result.categories == ()
    assert result.delta_corpus is None
    assert result.idempotent  # vacuously true — nothing to load


@pytest.mark.parametrize("bad_qid", ["", "not-a-csid"])
def test_dataset_qids_skips_non_qid_anchored(tmp_path: Path, bad_qid: str) -> None:
    corpus = _write_corpus(tmp_path / "c", [bad_qid or "cs:x:name-hash"])
    assert dataset_qids(corpus) == frozenset()
