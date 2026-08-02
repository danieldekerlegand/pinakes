"""Tests for the canonical-schema constraint compiler (rules-layer US-003).

Covers the extractor (committed artifact ⇄ live schema), the Soufflé rule generator
(binary heads, Soufflé-only, all four constraint kinds), the engine-free violation
evaluator (from/to type over the transitive instance_of closure, symmetry,
csid-uniqueness), the draft rules registry, the export wiring, and the committed
full-corpus release record — plus a ``souffle``-gated smoke that a real engine detects
the same violation the evaluator does.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from pinakes_engine.datalog import Fact
from pinakes_engine.datalog.export import Engine, export_dataset
from pinakes_engine.datalog.schema_constraints import (
    CANONICAL_SCHEMA_JSON,
    EdgeConstraint,
    SchemaConstraintError,
    evaluate_schema_violations,
    extract_edge_constraints,
    load_edge_constraints,
    render_edge_constraints,
    render_schema_rules_registry,
    schema_constraint_file_rules,
    schema_constraint_rules,
    schema_violation_report,
    souffle_rules,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
COMMITTED_REPORT = (
    Path(__file__).resolve().parents[1] / "docs" / "schema-constraints-report.json"
)
COMMITTED_REGISTRY = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "pinakes_engine"
    / "datalog"
    / "schema"
    / "rules_registry.tsv"
)


def _constraint(**overrides: object) -> EdgeConstraint:
    """A DESCENDS_FROM constraint (language/culture genealogy) for generator tests."""
    base = dict(
        edge_type="DESCENDS_FROM",
        from_labels=("Language", "Culture"),
        to_labels=("Language", "Culture"),
        symmetric=False,
        source="canonical-schema",
        source_url="shared/canonical-schema.json",
        schema_version="1.1.0",
        confidence=1.0,
    )
    base.update(overrides)
    return EdgeConstraint(**base)  # type: ignore[arg-type]


# --- extraction / artifact --------------------------------------------------


@pytest.mark.skipif(
    not CANONICAL_SCHEMA_JSON.exists(),
    reason="shared/canonical-schema.json not present (standalone checkout)",
)
def test_extractor_reproduces_the_committed_artifact() -> None:
    """The committed edge_constraints.tsv equals a fresh compile of the live schema."""
    fresh = render_edge_constraints(extract_edge_constraints())
    committed = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "pinakes_engine"
        / "datalog"
        / "schema"
        / "edge_constraints.tsv"
    ).read_text(encoding="utf-8")
    assert fresh == committed, (
        "edge_constraints.tsv drifted from shared/canonical-schema.json — regenerate it"
    )


@pytest.mark.skipif(
    not CANONICAL_SCHEMA_JSON.exists(),
    reason="shared/canonical-schema.json not present (standalone checkout)",
)
def test_extract_resolves_node_type_names_to_labels() -> None:
    constraints = {c.edge_type: c for c in extract_edge_constraints()}
    descends = constraints["DESCENDS_FROM"]
    # Names (culture) become :LABELs (Culture); an empty from/to stays unconstrained.
    assert descends.from_labels == (
        "Language",
        "LanguageFamily",
        "Culture",
        "ArchaeologicalCulture",
    )
    assert constraints["INFLUENCED_BY"].from_labels == ()


def test_load_missing_artifact_is_empty(tmp_path: Path) -> None:
    assert load_edge_constraints(tmp_path / "nope.tsv") == []
    assert schema_constraint_file_rules(tmp_path / "nope.tsv") == ()


def test_load_rejects_a_missing_edge_type_column(tmp_path: Path) -> None:
    bad = tmp_path / "c.tsv"
    bad.write_text("from_labels\tto_labels\nLanguage\tLanguage\n", encoding="utf-8")
    with pytest.raises(SchemaConstraintError):
        load_edge_constraints(bad)


def test_edge_constraints_round_trip(tmp_path: Path) -> None:
    out = tmp_path / "c.tsv"
    out.write_text(render_edge_constraints([_constraint(symmetric=True)]), "utf-8")
    (restored,) = load_edge_constraints(out)
    assert restored == _constraint(symmetric=True)


# --- generator --------------------------------------------------------------


def test_generator_emits_binary_souffle_only_rules() -> None:
    rules = schema_constraint_rules([_constraint()])
    heads = {r.head for r in rules}
    # from/to support + violation heads, plus the schema-wide csid rule.
    assert "descends_from_from_type_violation" in heads
    assert "descends_from_to_type_violation" in heads
    assert "from_ok_descends_from" in heads
    assert "csid_uniqueness_violation" in heads
    # Every clause is binary in its head and Soufflé-only (no prolog dialect split).
    for rule in rules:
        assert rule.souffle_clauses
        for clause in rule.souffle_clauses:
            head = clause.split(":-")[0]
            assert head.count(",") == 1, clause


def test_from_violation_clause_negates_over_the_support_pair() -> None:
    rules = {r.head: r for r in schema_constraint_rules([_constraint()])}
    clause = rules["descends_from_from_type_violation"].souffle_clauses[0]
    assert clause == (
        "descends_from_from_type_violation(X, Y) :- descends_from(X, Y), "
        "!from_ok_descends_from(X, Y)."
    )
    support = rules["from_ok_descends_from"].souffle_clauses
    assert 'instance_of(X, "Language")' in support[0]
    assert 'instance_of(X, "Culture")' in support[1]


def test_symmetry_rule_only_when_declared() -> None:
    without = {r.kind for r in schema_constraint_rules([_constraint()])}
    assert "symmetry" not in without
    with_sym = {r.kind for r in schema_constraint_rules([_constraint(symmetric=True)])}
    assert "symmetry" in with_sym


def test_souffle_rules_are_plain_rules() -> None:
    rules = souffle_rules(schema_constraint_rules([_constraint()]))
    assert all(rule.clauses for rule in rules)
    assert any(rule.name == "descends_from_from_type_violation" for rule in rules)


# --- engine-free evaluation -------------------------------------------------


def test_evaluate_flags_a_from_and_to_type_violation() -> None:
    facts = [
        Fact("node", ("cs:ws:a", "WritingSystem", "Alpha")),
        Fact("node", ("cs:ws:b", "WritingSystem", "Beta")),
        Fact("node", ("cs:lang:x", "Language", "X")),
        Fact("node", ("cs:lang:y", "Language", "Y")),
        Fact("instance_of", ("cs:ws:a", "WritingSystem")),
        Fact("instance_of", ("cs:ws:b", "WritingSystem")),
        Fact("instance_of", ("cs:lang:x", "Language")),
        Fact("instance_of", ("cs:lang:y", "Language")),
        Fact("descends_from", ("cs:ws:a", "cs:ws:b")),  # both endpoints wrong type
        Fact("descends_from", ("cs:lang:x", "cs:lang:y")),  # clean
    ]
    v = evaluate_schema_violations(facts, [_constraint()])
    assert v["descends_from_from_type_violation"] == [("cs:ws:a", "cs:ws:b")]
    assert v["descends_from_to_type_violation"] == [("cs:ws:a", "cs:ws:b")]
    assert v["csid_uniqueness_violation"] == []


def test_evaluate_honours_the_transitive_instance_of_closure() -> None:
    # from allowed = {Culture} only; the node is an ArchaeologicalCulture.
    constraint = _constraint(
        edge_type="ABSORBED_INTO", from_labels=("Culture",), to_labels=()
    )
    edge = Fact("absorbed_into", ("cs:ac:1", "cs:ac:2"))
    typing = Fact("instance_of", ("cs:ac:1", "ArchaeologicalCulture"))
    # Without a subclass edge, ArchaeologicalCulture is not (yet) a Culture → violation.
    bare = evaluate_schema_violations([edge, typing], [constraint])
    assert bare["absorbed_into_from_type_violation"] == [("cs:ac:1", "cs:ac:2")]
    # With the P279 subclass edge, the closure reaches Culture → no violation.
    closed = evaluate_schema_violations(
        [edge, typing, Fact("subclass_of", ("ArchaeologicalCulture", "Culture"))],
        [constraint],
    )
    assert closed["absorbed_into_from_type_violation"] == []


def test_evaluate_flags_a_symmetry_violation() -> None:
    constraint = _constraint(edge_type="SYNCRETIZED_WITH", symmetric=True)
    facts = [
        Fact("instance_of", ("cs:d:a", "Language")),
        Fact("instance_of", ("cs:d:b", "Language")),
        Fact("syncretized_with", ("cs:d:a", "cs:d:b")),  # no reverse → violation
    ]
    v = evaluate_schema_violations(facts, [constraint])
    assert v["syncretized_with_symmetry_violation"] == [("cs:d:a", "cs:d:b")]
    facts.append(Fact("syncretized_with", ("cs:d:b", "cs:d:a")))
    v2 = evaluate_schema_violations(facts, [constraint])
    assert v2["syncretized_with_symmetry_violation"] == []


def test_evaluate_flags_a_csid_uniqueness_violation() -> None:
    dup = [
        Fact("node", ("cs:x", "Language", "Alpha")),
        Fact("node", ("cs:x", "Culture", "Beta")),  # same csid, different name
        Fact("node", ("cs:y", "Language", "Gamma")),
    ]
    v = evaluate_schema_violations(dup, [_constraint()])
    assert v["csid_uniqueness_violation"] == [("cs:x", "Alpha"), ("cs:x", "Beta")]


def test_report_counts_and_triage_samples() -> None:
    facts = [
        Fact("node", ("cs:ws:a", "WritingSystem", "Alpha")),
        Fact("node", ("cs:ws:b", "WritingSystem", "Beta")),
        Fact("instance_of", ("cs:ws:a", "WritingSystem")),
        Fact("instance_of", ("cs:ws:b", "WritingSystem")),
        Fact("descends_from", ("cs:ws:a", "cs:ws:b")),
    ]
    report = schema_violation_report(facts, [_constraint()])
    assert report.total == 2
    assert report.counts["descends_from_from_type_violation"] == 1
    sample = report.samples["descends_from_from_type_violation"][0]
    assert sample["start_labels"] == ["WritingSystem"]


# --- registry / export wiring ----------------------------------------------


def test_committed_registry_matches_the_generated_rules() -> None:
    fresh = render_schema_rules_registry(schema_constraint_file_rules())
    assert fresh == COMMITTED_REGISTRY.read_text(encoding="utf-8"), (
        "rules_registry.tsv drifted from the generator — regenerate it"
    )


def test_export_flag_wires_schema_constraints(tmp_path: Path) -> None:
    (tmp_path / "nodes").mkdir()
    (tmp_path / "nodes" / "n.tsv").write_text(
        "csid:ID\t:LABEL\tname\ncs:ws:a\tWritingSystem\tAlpha\n", encoding="utf-8"
    )
    (tmp_path / "edges").mkdir()
    (tmp_path / "edges" / "e.tsv").write_text(
        ":START_ID\t:END_ID\t:TYPE\ncs:ws:a\tcs:ws:a\tDESCENDS_FROM\n", encoding="utf-8"
    )
    out = tmp_path / "out"
    export_dataset(tmp_path, out, [Engine.SOUFFLE], include_schema_constraints=True)
    program = (out / "graph.dl").read_text(encoding="utf-8")
    assert "descends_from_from_type_violation(X, Y) :-" in program
    assert ".output descends_from_from_type_violation" in program
    # The taxonomy closure the integrity rules negate over is attached too.
    assert "instance_of(X, C) :- instance_of(X, D), subclass_of(D, C)." in program


def test_committed_full_corpus_report_is_wellformed() -> None:
    payload = json.loads(COMMITTED_REPORT.read_text(encoding="utf-8"))
    assert payload["schema_version"]
    # The release record enumerates the WritingSystem-descent finding (see
    # docs/schema-constraints.md); pin it so a careless regeneration is caught.
    assert payload["total"] == 90
    assert payload["counts"]["descends_from_from_type_violation"] == 45
    assert payload["counts"]["descends_from_to_type_violation"] == 45
    assert payload["counts"]["csid_uniqueness_violation"] == 0
    sample = payload["samples"]["descends_from_from_type_violation"][0]
    assert sample["start_labels"] == ["WritingSystem"]


# --- souffle-gated engine agreement ----------------------------------------

SOUFFLE = shutil.which("souffle")


@pytest.mark.skipif(SOUFFLE is None, reason="souffle is not installed")
def test_souffle_detects_the_type_violation_the_evaluator_does(tmp_path: Path) -> None:
    from pinakes_engine.datalog.souffle import write_souffle_program

    facts = [
        Fact("node", ("cs:ws:a", "WritingSystem", "Alpha")),
        Fact("node", ("cs:ws:b", "WritingSystem", "Beta")),
        Fact("node", ("cs:lang:x", "Language", "X")),
        Fact("node", ("cs:lang:y", "Language", "Y")),
        Fact("instance_of", ("cs:ws:a", "WritingSystem")),
        Fact("instance_of", ("cs:ws:b", "WritingSystem")),
        Fact("instance_of", ("cs:lang:x", "Language")),
        Fact("instance_of", ("cs:lang:y", "Language")),
        Fact("descends_from", ("cs:ws:a", "cs:ws:b")),
        Fact("descends_from", ("cs:lang:x", "cs:lang:y")),
    ]
    constraint = _constraint()
    rules = souffle_rules(schema_constraint_rules([constraint]))
    facts_dir = tmp_path / "facts"
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    write_souffle_program(facts_dir, facts, rules)
    assert SOUFFLE is not None
    program = facts_dir / "graph.dl"
    result = subprocess.run(
        [SOUFFLE, str(program), "-F", str(facts_dir), "-D", str(out_dir)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    engine = (out_dir / "descends_from_from_type_violation.csv").read_text("utf-8")
    # The WritingSystem edge is flagged; the Language edge is not.
    assert "cs:ws:a\tcs:ws:b" in engine
    assert "cs:lang:x" not in engine
    # The engine agrees with the engine-free evaluator.
    evaluated = evaluate_schema_violations(facts, [constraint])
    engine_pairs = {
        tuple(line.split("\t"))
        for line in engine.splitlines()
        if line
    }
    assert engine_pairs == set(evaluated["descends_from_from_type_violation"])
