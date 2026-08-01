"""Trust tiers: auto-admission policy, per-tier QA, composition manifest (US-002).

The classifier, manifest, and per-tier gates are pure and unit-tested here; the
committed ``docs/tiered-corpus-manifest.json`` snapshot is asserted against a
small fixture corpus that spans every tier; and the corpus-build integration is
exercised offline against the pinakes fixture export (all curated) plus the
linker-minted inferred scaffolding.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from culturescrape.orchestrate import load_job
from culturescrape.orchestrate import tiers as tiers_module
from culturescrape.orchestrate.corpus import (
    build_corpus,
    corpus_component_fraction,
    corpus_qa_policy,
)
from culturescrape.orchestrate.jobs import JobConfigError
from culturescrape.orchestrate.qa import GateThresholds
from culturescrape.orchestrate.tiers import (
    ALL_TIERS,
    PERSONAL_SOURCES,
    TIER_AUTO_ADMITTED,
    TIER_CURATED,
    TIER_INFERRED,
    TIER_PERSONAL,
    TIER_QUARANTINE,
    PersonalTierContainmentError,
    assert_no_personal_records,
    build_tier_manifest,
    classify_tier,
    evaluate_tiers,
    is_personal_source,
    manifest_for_tier_dataset,
    partition_by_tier,
    personal_records,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).parent / "fixtures" / "tiered"
COMMITTED_MANIFEST = REPO_ROOT / "docs" / "tiered-corpus-manifest.json"
LS_JOB = REPO_ROOT / "jobs" / "pinakes.yml"
LS_EXPORT = Path(__file__).parent / "fixtures" / "pinakes" / "export"


# --------------------------------------------------------------------------- #
# classify_tier — the auto-admission policy                                    #
# --------------------------------------------------------------------------- #


def _node(**cells: str) -> dict[str, object]:
    row: dict[str, object] = {":LABEL": [cells.pop("label", "Place")]}
    row.update(cells)
    return row


def _edge(**cells: str) -> dict[str, object]:
    row: dict[str, object] = {":TYPE": cells.pop("type", "LOCATED_IN")}
    row.update(cells)
    return row


def test_curated_node_when_pinakes_sourced() -> None:
    assert classify_tier(_node(source="pinakes")) == TIER_CURATED


def test_curated_wins_even_when_qid_and_reference_present() -> None:
    # A reconciled row carries both stamps; human curation is the stronger signal.
    row = _node(source="pinakes;wikidata", wikidata_qid="Q1", source_url="http://x")
    assert classify_tier(row) == TIER_CURATED


def test_auto_admitted_node_needs_qid_and_reference() -> None:
    row = _node(source="wikidata", wikidata_qid="Q1", source_url="http://x")
    assert classify_tier(row) == TIER_AUTO_ADMITTED


def test_qid_without_reference_quarantines() -> None:
    assert classify_tier(_node(source="wikidata", wikidata_qid="Q1")) == TIER_QUARANTINE


def test_reference_without_qid_quarantines_a_node() -> None:
    row = _node(source="wikidata", source_url="http://x")
    assert classify_tier(row) == TIER_QUARANTINE


def test_inferred_source_is_inferred_tier() -> None:
    # Even with a QID + URL, an inferred-linker row is derived scaffolding.
    row = _node(source="inferred:geographic", wikidata_qid="Q1", source_url="http://x")
    assert classify_tier(row) == TIER_INFERRED


def test_edge_auto_admits_on_reference_alone() -> None:
    # Edges have no QID column; a citation URL is the auto-admit signal.
    assert classify_tier(_edge(source="getty_tgn", source_url="http://x")) == (
        TIER_AUTO_ADMITTED
    )


def test_edge_without_reference_quarantines() -> None:
    assert classify_tier(_edge(source="wikidata")) == TIER_QUARANTINE


def test_inferred_edge_is_inferred_tier() -> None:
    assert classify_tier(_edge(source="inferred:temporal")) == TIER_INFERRED


def test_partition_by_tier_covers_every_tier_key() -> None:
    buckets = partition_by_tier([_node(source="pinakes")])
    assert set(buckets) == set(ALL_TIERS)
    assert len(buckets[TIER_CURATED]) == 1


# --------------------------------------------------------------------------- #
# personal tier — the framework, with no bundled personal producer             #
# --------------------------------------------------------------------------- #
#
# Pinakes ships no personal-tier acquisition adapter, so PERSONAL_SOURCES is empty
# and nothing classifies personal out of the box. The tier is still a live,
# working framework: a deployment registers its own private-ingest source id and
# every mechanism below applies to it. These tests register such an id
# (monkeypatching the one source list) and prove the whole path still functions.

#: The source id a deployment's own private-file adapter might register.
_PERSONAL_SOURCE = "my-vault"


@pytest.fixture
def registered_personal_source(monkeypatch: pytest.MonkeyPatch) -> str:
    """Register :data:`_PERSONAL_SOURCE` as a personal-tier source for one test."""
    monkeypatch.setattr(
        tiers_module, "PERSONAL_SOURCES", frozenset({_PERSONAL_SOURCE})
    )
    return _PERSONAL_SOURCE


def test_no_personal_source_is_bundled_by_default() -> None:
    # The tier exists; pinakes just ships no producer for it. Nothing classifies
    # personal, so no corpus built from the bundled adapters can trip the gate.
    assert PERSONAL_SOURCES == frozenset()
    assert not is_personal_source("pinakes")
    assert classify_tier(_node(source="pinakes")) != TIER_PERSONAL


def test_a_registered_personal_source_still_classifies(
    registered_personal_source: str,
) -> None:
    assert classify_tier(_node(source=registered_personal_source)) == TIER_PERSONAL
    assert classify_tier(_edge(source=registered_personal_source)) == TIER_PERSONAL


def test_personal_wins_over_every_trust_signal(
    registered_personal_source: str,
) -> None:
    # The privacy invariant: a QID + a citation must NOT lift a personal row onto
    # the trust ladder — classify_tier checks the personal vocabulary first.
    row = _node(
        source=f"{registered_personal_source};wikidata",
        wikidata_qid="Q1",
        source_url="http://x",
    )
    assert classify_tier(row) == TIER_PERSONAL


def test_partition_and_records_pick_up_a_personal_row(
    registered_personal_source: str,
) -> None:
    rows = [_node(source=registered_personal_source), _node(source="pinakes")]
    buckets = partition_by_tier(rows)
    assert len(buckets[TIER_PERSONAL]) == 1
    assert personal_records(rows) == [rows[0]]


def test_the_containment_gate_rejects_a_personal_record(
    registered_personal_source: str,
) -> None:
    with pytest.raises(PersonalTierContainmentError, match="personal-tier"):
        assert_no_personal_records(
            [_node(source=registered_personal_source)], context="packaged corpus"
        )


def test_the_containment_gate_is_a_no_op_without_a_personal_row() -> None:
    assert_no_personal_records([_node(source="pinakes")], context="packaged corpus")


def test_the_datalog_tier_filter_still_scopes_the_personal_tier(
    registered_personal_source: str,
) -> None:
    # The Datalog projection is a release path, so the default (public) program
    # drops personal rows and `--tier personal` selects exactly them.
    from culturescrape.datalog.export import PERSONAL_TIER, tier_row_filter

    public = tier_row_filter(None)
    assert not public({"source": registered_personal_source})
    assert public({"source": "pinakes"})

    scoped = tier_row_filter(PERSONAL_TIER)
    assert scoped({"source": registered_personal_source})
    assert not scoped({"source": "pinakes"})


# --------------------------------------------------------------------------- #
# composition manifest                                                         #
# --------------------------------------------------------------------------- #


def test_manifest_matches_committed_snapshot() -> None:
    written = manifest_for_tier_dataset("tiered-fixture", FIXTURE).to_dict()
    committed = json.loads(COMMITTED_MANIFEST.read_text("utf-8"))
    assert written == committed


def test_manifest_reports_every_tier_present_in_the_fixture() -> None:
    manifest = manifest_for_tier_dataset("tiered-fixture", FIXTURE)
    assert manifest.nodes_by_tier == {
        TIER_CURATED: 2,
        TIER_AUTO_ADMITTED: 1,
        TIER_QUARANTINE: 2,
        TIER_INFERRED: 1,
    }
    # Composition sub-reports render in ALL_TIERS order.
    assert list(manifest.to_dict()["tiers"]) == [
        t for t in ALL_TIERS if t in manifest.tiers
    ]


def test_manifest_is_deterministic() -> None:
    a = manifest_for_tier_dataset("j", FIXTURE).to_json()
    b = manifest_for_tier_dataset("j", FIXTURE).to_json()
    assert a == b


def test_empty_tiers_are_omitted_from_the_manifest() -> None:
    manifest = build_tier_manifest("j", [_node(source="pinakes")], [])
    assert set(manifest.nodes_by_tier) == {TIER_CURATED}
    assert TIER_QUARANTINE not in manifest.tiers


# --------------------------------------------------------------------------- #
# per-tier QA gates                                                            #
# --------------------------------------------------------------------------- #


def test_default_tier_gates_pass_on_the_fixture() -> None:
    from culturescrape.ontology.metrics import read_dataset

    nodes, edges = read_dataset(FIXTURE)
    report = evaluate_tiers(nodes, edges)
    assert report.ok, report.render_summary()
    # Only non-empty tiers are graded.
    assert set(report.reports) == {
        TIER_CURATED,
        TIER_AUTO_ADMITTED,
        TIER_QUARANTINE,
        TIER_INFERRED,
    }


def test_auto_admitted_gate_flags_an_unsourced_row() -> None:
    # Both nodes auto-admit (QID + reference), but neither carries retrieved_at,
    # so the auto-admitted tier's provenance floor (1.0) fails.
    nodes = [
        _node(source="wikidata", wikidata_qid="Q1", source_url="http://x"),
        _node(source="wikidata", wikidata_qid="Q2", source_url="http://y"),
    ]
    report = evaluate_tiers(nodes, [])
    assert not report.ok
    assert any(tier == TIER_AUTO_ADMITTED for tier, _ in report.violations)


def test_tier_gate_override_can_relax_or_tighten() -> None:
    # A quarantine tier with a strict provenance floor now fails.
    nodes = [_node(source="wikidata", wikidata_qid="Q1")]  # quarantine, unsourced
    strict = {TIER_QUARANTINE: GateThresholds(min_provenance_completeness=1.0)}
    assert not evaluate_tiers(nodes, [], strict).ok
    # Default (no floor on quarantine) passes.
    assert evaluate_tiers(nodes, []).ok


# --------------------------------------------------------------------------- #
# job spec parsing                                                             #
# --------------------------------------------------------------------------- #


def _write_job(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "job.yml"
    path.write_text(
        "name: j\ncategories: [c.yml]\noutput_root: out\n" + body, encoding="utf-8"
    )
    (tmp_path / "c.yml").write_text(
        "id: c\nlabel: L\ndescription: d\n"
        "source:\n  type: dump\ndimensions: [temporal]\n",
        encoding="utf-8",
    )
    return path


def test_job_defaults_to_untiered(tmp_path: Path) -> None:
    job = load_job(_write_job(tmp_path, ""))
    assert job.tiered_trust is False
    assert dict(job.tier_gates) == {}


def test_job_parses_tiered_trust_and_tier_gates(tmp_path: Path) -> None:
    job = load_job(
        _write_job(
            tmp_path,
            "tiered_trust: true\n"
            "tier_gates:\n"
            "  auto-admitted:\n"
            "    min_provenance_completeness: 1.0\n"
            "  quarantine:\n"
            "    min_provenance_completeness: 0.0\n",
        )
    )
    assert job.tiered_trust is True
    assert set(job.tier_gates) == {TIER_AUTO_ADMITTED, TIER_QUARANTINE}
    assert job.tier_gates[TIER_AUTO_ADMITTED].min_provenance_completeness == 1.0


def test_job_rejects_unknown_tier(tmp_path: Path) -> None:
    with pytest.raises(JobConfigError, match="unknown tier"):
        load_job(_write_job(tmp_path, "tier_gates:\n  bogus:\n    min_rows: 1\n"))


def test_job_rejects_non_numeric_threshold(tmp_path: Path) -> None:
    with pytest.raises(JobConfigError):
        load_job(
            _write_job(
                tmp_path, "tier_gates:\n  curated:\n    min_rows: not-a-number\n"
            )
        )


# --------------------------------------------------------------------------- #
# corpus-build integration (offline, over the pinakes fixture)            #
# --------------------------------------------------------------------------- #


def _ls_job(output_root: Path):
    job = load_job(LS_JOB)
    (category,) = job.categories
    category = replace(
        category, source=replace(category.source, query=str(LS_EXPORT.resolve()))
    )
    return replace(job, categories=(category,), output_root=output_root)


def test_untiered_build_writes_no_tier_artifacts(tmp_path: Path) -> None:
    job = _ls_job(tmp_path)
    build = build_corpus(
        job,
        qa=corpus_qa_policy(job),
        min_component_fraction=corpus_component_fraction(job),
    )
    assert build.tiers is None
    assert build.tier_qa is None
    assert not (build.dataset_dir / "tiers.json").exists()


def test_tiered_build_writes_manifest_and_per_tier_qa(tmp_path: Path) -> None:
    job = replace(_ls_job(tmp_path), tiered_trust=True)
    build = build_corpus(
        job,
        qa=corpus_qa_policy(job),
        min_component_fraction=corpus_component_fraction(job),
    )

    assert build.tiers is not None
    assert build.tier_qa is not None
    # The manifest + per-tier QA land beside the corpus TSV.
    written = json.loads((build.dataset_dir / "tiers.json").read_text("utf-8"))
    assert written == build.tiers.to_dict()
    assert (build.dataset_dir / "qa-tiers.json").exists()

    # The pinakes fixture rows are all curated; linkers add inferred hubs.
    assert TIER_CURATED in build.tiers.nodes_by_tier
    assert set(build.tiers.nodes_by_tier) <= set(ALL_TIERS)
    # Auto-admission never wrote lexicons — the build only reads the export dir.
    assert build.tier_qa.ok, build.tier_qa.render_summary()
