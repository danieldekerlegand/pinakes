"""Tests for the logical-consistency checker + CI ratchet (ml US-005).

Two tiers, mirroring the workspace pattern:

* **Pure unit tests + the committed-artifact ratchet run everywhere (incl. CI).**
  The checks are pure over in-memory triples, and the ratchet recomputes violation
  counts from the *committed* ``ml/predictions/*.tsv`` + ``consistency-baseline.json``
  + ``shared/canonical-schema.json`` — all git-tracked, so it is a real CI gate (no
  torch needed), exactly like the TS ``convergence-qa`` drift gate.
* **A live gate** trains a tiny model on the committed splits and generates
  predictions, SKIPPED when the DVC-tracked ``ml/data`` is absent (as in CI).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from linguascrape_ml.baselines import render_baselines_doc
from linguascrape_ml.consistency import (
    ANTISYMMETRIC_RELATIONS,
    SYMMETRIC_RELATIONS,
    Triple,
    build_baseline,
    check_asymmetry_violations,
    check_descent_cycles,
    check_schema_type_breaches,
    compare_to_baseline,
    evaluate_consistency,
    load_edge_constraints,
    node_type_of,
    parse_predictions,
    render_predictions,
)

_ML_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _ML_ROOT.parent
_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"
_PREDICTIONS_DIR = _ML_ROOT / "predictions"
_CONSISTENCY_BASELINE = _ML_ROOT / "manifests" / "consistency-baseline.json"
_COMMITTED_MODELS = ("transe", "complex", "rotate")


def _t(head: str, rel: str, tail: str) -> Triple:
    return Triple(relation=rel, head=head, tail=tail)


# --- csid / schema parsing ----------------------------------------------------


def test_node_type_of() -> None:
    assert node_type_of("cs:language:eng") == "language"
    assert node_type_of("cs:archaeological-culture:Q123") == "archaeological-culture"
    assert node_type_of("cs:place:Q1") == "place"
    assert node_type_of("not-a-csid") is None
    assert node_type_of("") is None


def test_load_edge_constraints_reads_schema() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    # SPOKEN_IN is language -> place; both ends constrained.
    from_types, to_types = constraints["SPOKEN_IN"]
    assert from_types == frozenset({"language"})
    assert to_types == frozenset({"place"})
    # INFLUENCED_BY has empty from/to in the schema -> unconstrained (None).
    assert constraints["INFLUENCED_BY"] == (None, None)
    # COGNATE_WITH is language<->language.
    assert constraints["COGNATE_WITH"] == (
        frozenset({"language"}),
        frozenset({"language"}),
    )


# --- schema type breaches -----------------------------------------------------


def test_schema_type_breaches() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    triples = [
        _t("cs:language:eng", "SPOKEN_IN", "cs:place:london"),  # valid
        _t("cs:place:x", "SPOKEN_IN", "cs:place:y"),  # from breach (place not lang)
        _t("cs:language:a", "SPOKEN_IN", "cs:language:b"),  # to breach (lang not place)
        _t("cs:culture:c", "INFLUENCED_BY", "cs:place:p"),  # unconstrained -> ok
    ]
    breaches = check_schema_type_breaches(triples, constraints)
    assert len(breaches) == 2
    ends = sorted(b["end"] for b in breaches)
    assert ends == ["from", "to"]


def test_schema_type_breach_on_malformed_csid() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    # A malformed head against a constrained 'from' end is a breach.
    triples = [_t("garbage", "SPOKEN_IN", "cs:place:london")]
    breaches = check_schema_type_breaches(triples, constraints)
    assert len(breaches) == 1 and breaches[0]["type"] == "?"


# --- descent cycles -----------------------------------------------------------


def test_descent_cycle_self_loop() -> None:
    loop = [_t("cs:language:a", "DESCENDS_FROM", "cs:language:a")]
    assert check_descent_cycles(loop) == [["cs:language:a"]]


def test_descent_cycle_mutual_and_longer() -> None:
    triples = [
        _t("a", "DESCENDS_FROM", "b"),
        _t("b", "DESCENDS_FROM", "c"),
        _t("c", "DESCENDS_FROM", "a"),  # 3-cycle a->b->c->a
    ]
    cycles = check_descent_cycles(triples)
    assert cycles == [["a", "b", "c"]]


def test_descent_acyclic_is_clean() -> None:
    # A DAG: no cycle. Other relations never enter the descent graph.
    triples = [
        _t("a", "DESCENDS_FROM", "b"),
        _t("b", "DESCENDS_FROM", "c"),
        _t("c", "DESCENDS_FROM", "a2"),
        _t("a", "COGNATE_WITH", "b"),  # ignored by descent check
    ]
    assert check_descent_cycles(triples) == []


# --- asymmetry ----------------------------------------------------------------


def test_asymmetry_self_loop_and_mutual() -> None:
    triples = [
        _t("a", "DESCENDS_FROM", "a"),  # self
        _t("x", "BORROWED_FROM", "y"),
        _t("y", "BORROWED_FROM", "x"),  # mutual pair
    ]
    violations = check_asymmetry_violations(triples)
    kinds = sorted(v["kind"] for v in violations)
    assert kinds == ["mutual", "self"]
    # The mutual pair is reported exactly once (canonicalised).
    assert sum(1 for v in violations if v["kind"] == "mutual") == 1


def test_symmetric_relations_are_not_asymmetry_violations() -> None:
    # COGNATE_WITH / SYNCRETIZED_WITH store both directions legitimately.
    for rel in SYMMETRIC_RELATIONS:
        triples = [_t("a", rel, "b"), _t("b", rel, "a")]
        assert check_asymmetry_violations(triples) == []
    # The antisymmetric set is disjoint from the symmetric one.
    assert not (ANTISYMMETRIC_RELATIONS & SYMMETRIC_RELATIONS)


# --- aggregate report ---------------------------------------------------------


def test_evaluate_consistency_aggregates() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    triples = [
        _t("cs:language:a", "DESCENDS_FROM", "cs:language:a"),  # cycle + self-asym
        _t("cs:place:x", "SPOKEN_IN", "cs:place:y"),  # type breach (from)
    ]
    report = evaluate_consistency("M", triples, constraints)
    assert report.counts["descentCycles"] == 1
    assert report.counts["asymmetryViolations"] == 1
    assert report.counts["schemaTypeBreaches"] == 1
    assert report.num_predictions == 2
    # Samples are present and bounded.
    assert report.samples["descentCycles"] == [["cs:language:a"]]


# --- predictions I/O ----------------------------------------------------------


def test_predictions_round_trip(tmp_path: Path) -> None:
    triples = [
        _t("cs:language:b", "COGNATE_WITH", "cs:language:a"),
        _t("cs:language:a", "COGNATE_WITH", "cs:language:b"),
    ]
    path = tmp_path / "m.tsv"
    path.write_text(render_predictions(triples), encoding="utf-8")
    loaded = parse_predictions(path)
    assert loaded == sorted(triples)


def test_parse_predictions_rejects_bad_columns(tmp_path: Path) -> None:
    path = tmp_path / "bad.tsv"
    path.write_text("a\tb\n", encoding="utf-8")
    with pytest.raises(ValueError):
        parse_predictions(path)


# --- ratchet ------------------------------------------------------------------


def test_build_and_compare_baseline_clean() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    reports = [evaluate_consistency("TransE", [], constraints)]
    baseline = build_baseline(reports)
    assert baseline["models"]["transe"] == {
        "descentCycles": 0,
        "schemaTypeBreaches": 0,
        "asymmetryViolations": 0,
    }
    assert compare_to_baseline(reports, baseline) == []


def test_compare_baseline_flags_regression() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    baseline = {"models": {"transe": {"descentCycles": 0}}}
    reports = [
        evaluate_consistency(
            "TransE",
            [_t("cs:language:a", "DESCENDS_FROM", "cs:language:a")],
            constraints,
        )
    ]
    regressions = compare_to_baseline(reports, baseline)
    assert any(r.get("category") == "descentCycles" for r in regressions)


def test_compare_baseline_flags_unratcheted_model() -> None:
    constraints = load_edge_constraints(_SCHEMA)
    reports = [evaluate_consistency("NewModel", [], constraints)]
    regressions = compare_to_baseline(reports, {"models": {}})
    assert regressions == [{"model": "newmodel", "reason": "not-in-baseline"}]


# --- doc rendering ------------------------------------------------------------


def test_render_baselines_doc_consistency_section() -> None:
    import numpy as np

    from linguascrape_ml.baselines import BaselineOutcome

    outcome = BaselineOutcome(
        model="TransE",
        metrics={"mrr": 0.1, "hits@1": 0.0, "hits@3": 0.1, "hits@10": 0.25},
        embeddings=np.zeros((2, 2), dtype=np.float32),
        embedding_dim=64,
        num_epochs=100,
        seed=1,
        device="cpu",
    )
    consistency = [
        {
            "model": "TransE",
            "numPredictions": 379,
            "counts": {
                "descentCycles": 295,
                "schemaTypeBreaches": 4,
                "asymmetryViolations": 332,
            },
        }
    ]
    doc = render_baselines_doc(
        [outcome],
        corpus_md5="abc",
        manifest_sha256="def",
        triples_sha256="ghi",
        counts={"triples": 1, "entities": 1, "relations": 1},
        split_counts={"train": 1, "valid": 0, "test": 0},
        consistency=consistency,
        predictions_top_k=1,
    )
    assert "## Logical consistency (US-005)" in doc
    assert "| TransE | 379 | 295 | 4 | 332 |" in doc
    # Still a pure function of its inputs.
    kwargs = dict(
        corpus_md5="abc", manifest_sha256="def", triples_sha256="ghi",
        counts={"triples": 1, "entities": 1, "relations": 1},
        split_counts={"train": 1, "valid": 0, "test": 0},
        consistency=consistency, predictions_top_k=1,
    )
    assert render_baselines_doc([outcome], **kwargs) == doc


# --- committed-artifact ratchet (RUNS IN CI) ----------------------------------


def test_committed_predictions_pass_the_ratchet() -> None:
    """The real CI gate: recompute counts from committed predictions vs baseline.

    All inputs (predictions, baseline, schema) are git-tracked, so this exercises
    the ratchet end-to-end in CI without training — the same shape as the TS-side
    convergence-qa drift gate over the committed lexicons.
    """
    assert _CONSISTENCY_BASELINE.exists(), "consistency baseline must be committed"
    baseline = json.loads(_CONSISTENCY_BASELINE.read_text(encoding="utf-8"))
    constraints = load_edge_constraints(_SCHEMA)
    reports = []
    for model in _COMMITTED_MODELS:
        path = _PREDICTIONS_DIR / f"{model}.tsv"
        assert path.exists(), f"committed predictions missing: {path}"
        triples = parse_predictions(path)
        reports.append(evaluate_consistency(model, triples, constraints))
    assert compare_to_baseline(reports, baseline) == []
    # The committed baseline equals a fresh build over the committed predictions
    # (so a hand-edited baseline that loosens the gate is caught).
    assert build_baseline(reports)["models"] == baseline["models"]


# --- live gate: generate predictions from a tiny model (skipped when absent) --


@pytest.mark.skipif(
    not (_ML_ROOT / "data" / "triples" / "train.tsv").exists(),
    reason="triples splits not present (DVC-tracked; run `dvc pull` locally)",
)
def test_generate_predictions_on_committed_splits() -> None:
    from linguascrape_ml.baselines import (
        generate_predictions,
        load_split_factories,
        run_pipeline,
    )

    training, validation, testing = load_split_factories(
        _ML_ROOT / "data" / "triples"
    )
    result = run_pipeline(
        "TransE", training, validation, testing,
        embedding_dim=8, num_epochs=1, device="cpu",
    )
    predictions = generate_predictions(result, testing, top_k=1)
    assert predictions, "expected non-empty predictions"
    constraints = load_edge_constraints(_SCHEMA)
    report = evaluate_consistency("TransE", predictions, constraints)
    assert set(report.counts) == {
        "descentCycles",
        "schemaTypeBreaches",
        "asymmetryViolations",
    }
