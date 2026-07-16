"""Tests for the orchestration QA quality gates.

A hand-built *healthy* dataset passes every gate at the default thresholds; a
focused mutation (or a tightened threshold) then trips each gate in isolation,
covering row count, post-dedup duplicates, provenance completeness, dangling
edges, and unreconciled entities. The same rows are round-tripped through real
``nodes/`` / ``edges/`` TSV files to cover the directory reader, the
``culturescrape qa`` CLI command, and the runner's per-job QA step.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec, load_category
from culturescrape.acquire.records import RawRecord
from culturescrape.cli import main
from culturescrape.orchestrate import (
    STAGE_ORDER,
    GateResult,
    GateThresholds,
    Job,
    QaPolicy,
    QaReport,
    evaluate,
    evaluate_directory,
    run_job,
)
from culturescrape.orchestrate.qa import QA_REPORT_SUFFIX
from culturescrape.orchestrate.runner import AdapterFactory
from culturescrape.schema.headers import EdgeSchema, NodeSchema
from culturescrape.schema.pipeline import read_raw_records
from culturescrape.schema.tsvio import Row, write_edge_rows, write_node_rows

FIXTURES = Path(__file__).parent / "fixtures"
RAW_RECORDS = FIXTURES / "raw" / "peruvian_dishes.jsonl"


# --- row builders -----------------------------------------------------------


def _node(csid: str, *, qid: str = "", getty: str = "", **overrides: str) -> Row:
    row: Row = {
        "csid": csid,
        ":LABEL": ["Dish"],
        "name": csid.upper(),
        "lang": "en",
        "wikidata_qid": qid,
        "getty_id": getty,
        "source": "wikidata",
        "source_url": f"https://example.org/{csid}",
        "retrieved_at": "2026-06-16T00:00:00+00:00",
        "confidence": "1.0",
    }
    row.update(overrides)
    return row


def _edge(start: str, end: str, rel_type: str = "INSTANCE_OF", **overrides: str) -> Row:
    row: Row = {
        ":START_ID": start,
        ":END_ID": end,
        ":TYPE": rel_type,
        "source": "wikidata",
        "source_url": "https://example.org/edge",
        "retrieved_at": "2026-06-16T00:00:00+00:00",
        "confidence": "1.0",
    }
    row.update(overrides)
    return row


def _healthy() -> tuple[list[Row], list[Row]]:
    """Three reconciled, fully-provenanced nodes and two valid edges."""
    nodes = [
        _node("cs:dish:Q1", qid="Q1"),
        _node("cs:dish:Q2", qid="Q2"),
        _node("cs:type:dish", getty="aat:300000"),
    ]
    edges = [
        _edge("cs:dish:Q1", "cs:type:dish"),
        _edge("cs:dish:Q2", "cs:type:dish"),
    ]
    return nodes, edges


def _ls_node(csid: str, *, ls_id: str, source: str = "pinakes", **kw: str) -> Row:
    """A pinakes-origin node: canonical row + a ``pinakes_id`` alias."""
    row = _node(csid, source=source, **kw)
    row["pinakes_id"] = ls_id
    return row


def _ls_edge(
    start: str,
    end: str,
    rel_type: str = "DESCENDS_FROM",
    *,
    ls_id: str = "e",
    source: str = "pinakes",
    **kw: str,
) -> Row:
    """A pinakes-origin edge carrying a ``pinakes_id`` alias."""
    row = _edge(start, end, rel_type, source=source, **kw)
    row["pinakes_id"] = ls_id
    return row


def _merged_clean() -> tuple[list[Row], list[Row]]:
    """A merged corpus: one native node/edge plus reconciled pinakes rows."""
    nodes = [
        _node("cs:dish:Q1", qid="Q1"),
        _ls_node("cs:lang:Q2", ls_id="pie", qid="Q2"),
        _ls_node("cs:lang:gaul", ls_id="gaulish", getty="aat:1"),
    ]
    edges = [
        _edge("cs:dish:Q1", "cs:lang:Q2"),
        _ls_edge("cs:lang:gaul", "cs:lang:Q2", ls_id="e1"),
    ]
    return nodes, edges


def _gate(report: QaReport, key: str) -> GateResult:
    return next(gate for gate in report.gates if gate.key == key)


# --- the healthy baseline ---------------------------------------------------


def test_healthy_dataset_passes_every_gate() -> None:
    report = evaluate(*_healthy())
    assert report.ok
    assert report.violations == ()
    assert report.node_count == 3
    assert report.edge_count == 2


def test_report_exposes_every_gate_once() -> None:
    report = evaluate(*_healthy())
    keys = [gate.key for gate in report.gates]
    assert keys == [
        "row_count",
        "duplicate_rate",
        "provenance_completeness",
        "dangling_edge_rate",
        "unreconciled_rate",
    ]


# --- each gate tripped in isolation -----------------------------------------


def test_row_count_gate_trips_when_below_minimum() -> None:
    report = evaluate(*_healthy(), GateThresholds(min_rows=5))
    gate = _gate(report, "row_count")
    assert not gate.passed
    assert gate.value == 3.0
    assert [g.key for g in report.violations] == ["row_count"]


def test_duplicate_gate_trips_on_shared_qid_after_dedup() -> None:
    nodes, edges = _healthy()
    # A second node carrying Q1's QID is a duplicate dedup should have collapsed.
    nodes.append(_node("cs:dish:Q1-dup", qid="Q1"))
    report = evaluate(nodes, edges)
    gate = _gate(report, "duplicate_rate")
    assert not gate.passed
    assert gate.value == pytest.approx(1 / 4)


def test_duplicate_gate_counts_normalized_name_collisions() -> None:
    # No QIDs: identity falls back to normalized (name, lang, label); two rows
    # whose names normalize identically are duplicates.
    nodes = [
        _node("cs:dish:a", name="Ceviche"),
        _node("cs:dish:b", name="  ceviche "),
    ]
    report = evaluate(nodes, [])
    assert _gate(report, "duplicate_rate").value == pytest.approx(0.5)


def test_provenance_gate_trips_on_missing_source_url() -> None:
    nodes, edges = _healthy()
    nodes.append(_node("cs:dish:Q3", qid="Q3", source_url=""))
    report = evaluate(nodes, edges)
    gate = _gate(report, "provenance_completeness")
    assert not gate.passed
    # 5 of 6 rows (4 nodes + 2 edges) stay fully sourced.
    assert gate.value == pytest.approx(5 / 6)


def test_dangling_edge_gate_trips_on_unknown_endpoint() -> None:
    nodes, edges = _healthy()
    edges.append(_edge("cs:dish:Q1", "cs:dish:missing"))
    report = evaluate(nodes, edges)
    gate = _gate(report, "dangling_edge_rate")
    assert not gate.passed
    assert gate.value == pytest.approx(1 / 3)


def test_unreconciled_gate_trips_when_threshold_tightened() -> None:
    # All nodes lack any external id: fully unreconciled.
    nodes = [_node("cs:dish:a"), _node("cs:dish:b")]
    report = evaluate(nodes, [], GateThresholds(max_unreconciled_rate=0.0))
    gate = _gate(report, "unreconciled_rate")
    assert not gate.passed
    assert gate.value == 1.0


def test_partly_reconciled_rate_is_a_fraction() -> None:
    nodes = [_node("cs:dish:Q1", qid="Q1"), _node("cs:dish:b")]
    report = evaluate(nodes, [])
    assert _gate(report, "unreconciled_rate").value == pytest.approx(0.5)


# --- pinakes-scoped gates (US-007) -------------------------------------


def test_native_only_corpus_has_no_pinakes_gates() -> None:
    report = evaluate(*_healthy())
    assert not any(gate.key.startswith("pinakes_") for gate in report.gates)


def test_merged_clean_corpus_passes_every_gate() -> None:
    report = evaluate(*_merged_clean())
    assert report.ok
    ls_keys = [g.key for g in report.gates if g.key.startswith("pinakes_")]
    assert ls_keys == [
        "pinakes_provenance_completeness",
        "pinakes_duplicate_rate",
        "pinakes_dangling_edge_rate",
        "pinakes_unreconciled_rate",
    ]


def test_pinakes_row_recognised_by_merged_source_token() -> None:
    # A reconcile-merged node keeps no alias but carries the joined source.
    nodes = [_node("cs:lang:m", qid="Q1", source="wikidata;pinakes")]
    report = evaluate(nodes, [])
    assert any(gate.key.startswith("pinakes_") for gate in report.gates)


def test_pinakes_provenance_gate_trips_when_stamp_dropped() -> None:
    # Both rows are pinakes-origin (alias present); one lost its source stamp.
    nodes = [
        _ls_node("cs:lang:a", ls_id="a", qid="Q1"),
        _ls_node("cs:lang:b", ls_id="b", qid="Q2", source=""),
    ]
    report = evaluate(nodes, [])
    gate = _gate(report, "pinakes_provenance_completeness")
    assert not gate.passed
    assert gate.value == pytest.approx(0.5)


def test_pinakes_duplicate_gate_trips_on_shared_qid() -> None:
    nodes, edges = _merged_clean()
    nodes.append(_ls_node("cs:lang:Q2-dup", ls_id="pie2", qid="Q2"))
    report = evaluate(nodes, edges)
    gate = _gate(report, "pinakes_duplicate_rate")
    assert not gate.passed
    # Three pinakes nodes, one duplicate QID.
    assert gate.value == pytest.approx(1 / 3)


def test_pinakes_dangling_gate_trips_on_unknown_endpoint() -> None:
    nodes, edges = _merged_clean()
    edges.append(_ls_edge("cs:lang:Q2", "cs:lang:missing", ls_id="e2"))
    report = evaluate(nodes, edges)
    gate = _gate(report, "pinakes_dangling_edge_rate")
    assert not gate.passed
    assert gate.value == pytest.approx(0.5)


def test_pinakes_dangling_gate_allows_edge_into_native_node() -> None:
    # A pinakes edge may legitimately point at a native node.
    nodes = [_node("cs:dish:Q1", qid="Q1"), _ls_node("cs:lang:Q2", ls_id="pie")]
    edges = [_ls_edge("cs:lang:Q2", "cs:dish:Q1", ls_id="e1")]
    report = evaluate(nodes, edges)
    assert _gate(report, "pinakes_dangling_edge_rate").value == 0.0


def test_pinakes_unreconciled_gate_trips_when_tightened() -> None:
    nodes = [
        _ls_node("cs:lang:a", ls_id="a"),
        _ls_node("cs:lang:b", ls_id="b", qid="Q9"),
    ]
    report = evaluate(
        nodes, [], GateThresholds(max_pinakes_unreconciled_rate=0.0)
    )
    gate = _gate(report, "pinakes_unreconciled_rate")
    assert not gate.passed
    assert gate.value == pytest.approx(0.5)


def test_pinakes_from_dict_overrides_ls_thresholds() -> None:
    thresholds = GateThresholds.from_dict(
        {"max_pinakes_dangling_edge_rate": 0.25}
    )
    assert thresholds.max_pinakes_dangling_edge_rate == 0.25
    assert thresholds.min_pinakes_provenance_completeness == 1.0


# --- empty input ------------------------------------------------------------


def test_empty_dataset_only_trips_the_row_count_gate() -> None:
    report = evaluate([], [])
    assert [gate.key for gate in report.violations] == ["row_count"]
    assert _gate(report, "provenance_completeness").value == 1.0
    assert _gate(report, "duplicate_rate").value == 0.0


# --- thresholds config ------------------------------------------------------


def test_from_dict_overrides_only_given_keys() -> None:
    thresholds = GateThresholds.from_dict({"min_rows": 10, "unknown": 1})
    assert thresholds.min_rows == 10
    assert thresholds.max_duplicate_rate == GateThresholds.max_duplicate_rate


def test_from_dict_rejects_non_numeric_threshold() -> None:
    with pytest.raises(ValueError, match="must be a number"):
        GateThresholds.from_dict({"max_duplicate_rate": "high"})


# --- serialisation ----------------------------------------------------------


def test_json_round_trips_the_gate_verdicts() -> None:
    import json

    report = evaluate(*_healthy(), GateThresholds(min_rows=99))
    data = json.loads(report.to_json())
    assert data["ok"] is False
    assert data["node_count"] == 3
    row_gate = next(g for g in data["gates"] if g["key"] == "row_count")
    assert row_gate["passed"] is False
    assert row_gate["threshold"] == 99.0


def test_summary_marks_pass_and_fail() -> None:
    report = evaluate(*_healthy(), GateThresholds(min_rows=99))
    summary = report.render_summary()
    assert "1 violation(s)" in summary
    assert "[FAIL] row count" in summary
    assert "[PASS] dangling-edge rate" in summary


def test_render_markdown_lists_every_gate() -> None:
    report = evaluate(*_merged_clean())
    markdown = report.render_markdown()
    assert markdown.startswith("# QA report")
    assert "pinakes provenance completeness" in markdown
    assert "| Gate | Result | Value | Bound | Detail |" in markdown


def test_write_markdown_emits_human_readable_artifact(tmp_path: Path) -> None:
    report = evaluate(*_merged_clean())
    out = report.write_markdown(tmp_path / "qa.md")
    assert out.is_file()
    assert "pinakes dangling-edge rate" in out.read_text(encoding="utf-8")


# --- directory reader -------------------------------------------------------


def _write_dataset(directory: Path, nodes: list[Row], edges: list[Row]) -> None:
    write_node_rows(directory / "nodes" / "dish.tsv", NodeSchema.canonical(), nodes)
    write_edge_rows(directory / "edges" / "instance.tsv", EdgeSchema.canonical(), edges)


def test_evaluate_directory_reads_real_tsv(tmp_path: Path) -> None:
    _write_dataset(tmp_path, *_healthy())
    report = evaluate_directory(tmp_path)
    assert report.ok
    assert report.node_count == 3
    assert report.dataset == str(tmp_path)


# --- CLI --------------------------------------------------------------------


def test_cli_qa_prints_summary_and_writes_report(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _write_dataset(tmp_path, *_healthy())
    out = tmp_path / "qa.json"
    code = main(["qa", str(tmp_path), "--out", str(out)])
    assert code == 0
    assert out.is_file()
    assert "QA" in capsys.readouterr().out
    assert '"ok": true' in out.read_text(encoding="utf-8")


def test_cli_qa_fails_on_violation_when_requested(tmp_path: Path) -> None:
    _write_dataset(tmp_path, *_healthy())
    assert main(["qa", str(tmp_path), "--min-rows", "99"]) == 0
    assert (
        main(["qa", str(tmp_path), "--min-rows", "99", "--fail-on-violation"]) == 1
    )


def test_cli_qa_rejects_non_directory(tmp_path: Path) -> None:
    assert main(["qa", str(tmp_path / "nope")]) == 2


def test_cli_qa_fails_on_degraded_pinakes_corpus(tmp_path: Path) -> None:
    # One extra pinakes-origin (source='pinakes') node reconciled to
    # nothing. Default thresholds are permissive, so the corpus passes; tightening
    # only the pinakes unreconciled bound trips that gate alone.
    nodes, edges = _healthy()
    nodes.append(_node("cs:lang:x", source="pinakes"))
    _write_dataset(tmp_path, nodes, edges)
    md = tmp_path / "qa.md"
    assert main(["qa", str(tmp_path), "--markdown-out", str(md)]) == 0
    assert md.is_file()
    assert "pinakes unreconciled-entity rate" in md.read_text(encoding="utf-8")
    assert (
        main(
            [
                "qa",
                str(tmp_path),
                "--max-pinakes-unreconciled-rate",
                "0.0",
                "--fail-on-violation",
            ]
        )
        == 1
    )


# --- runner integration -----------------------------------------------------


class _StubAdapter(SourceAdapter):
    name = "stub"
    source_type = "dump"

    def __init__(self, records: list[RawRecord]) -> None:
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from self._records


def _spec() -> CategorySpec:
    return load_category(FIXTURES / "categories" / "valid.yml")


def _job(output_root: Path) -> Job:
    return Job(
        name="fixture-job",
        description="",
        categories=(_spec(),),
        stages=STAGE_ORDER,
        output_root=output_root,
    )


def _stub_factory() -> AdapterFactory:
    records = read_raw_records(RAW_RECORDS)
    return lambda spec: _StubAdapter(records)


def test_run_job_writes_a_qa_report_per_category(tmp_path: Path) -> None:
    out = tmp_path / "out"
    run = run_job(_job(out), adapter_factory=_stub_factory())

    assert run.ok
    report = out / "qa" / f"peruvian-dishes{QA_REPORT_SUFFIX}"
    assert report.is_file()
    assert '"key": "dangling_edge_rate"' in report.read_text(encoding="utf-8")


def test_run_job_fails_category_when_policy_fails_on_violation(tmp_path: Path) -> None:
    out = tmp_path / "out"
    policy = QaPolicy(
        thresholds=GateThresholds(min_rows=999), fail_on_violation=True
    )
    run = run_job(_job(out), adapter_factory=_stub_factory(), qa=policy)

    assert not run.ok
    (failure,) = run.failures
    assert "QA gates failed" in (failure.error or "")
    # The report is still written, even though the category is marked failed.
    assert (out / "qa" / f"peruvian-dishes{QA_REPORT_SUFFIX}").is_file()


def test_run_job_default_policy_reports_without_failing(tmp_path: Path) -> None:
    out = tmp_path / "out"
    # The offline run reconciles nothing, so the unreconciled rate is high — but
    # the default policy only reports, it does not fail the run.
    run = run_job(_job(out), adapter_factory=_stub_factory())
    assert run.ok
