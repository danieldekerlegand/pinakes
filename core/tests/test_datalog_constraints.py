"""Tests for the Wikidata property-constraint (P2302) rules layer (US-002).

Covers the whole path, engine-free where possible:

* extraction (:mod:`culturescrape.acquire.constraints`) of P2302 constraints via a
  fake WDQS lookup, and the corpus resolution baked into the replay artifact;
* translation (:mod:`culturescrape.datalog.constraints`) of each constraint type into
  a rule — symmetric/inverse derivations, subject/value-type integrity rules — plus
  the skip-and-report of the untranslatable;
* the draft rules registry and its provenance;
* the derivations materialised engine-free, and rendered into the programs behind the
  export flag; and a swipl/souffle-gated smoke that a *real* engine derives a
  symmetric edge and detects a type violation.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from culturescrape.acquire.constraints import (
    EDGE_PROPERTY_PIDS,
    constraint_query,
    property_constraints,
    render_property_constraints_tsv,
    sparql_constraint_lookup,
    wikidata_property_url,
    write_property_constraints_tsv,
)
from culturescrape.datalog import Fact, render_program, render_souffle_program
from culturescrape.datalog.constraints import (
    PROPERTY_CONSTRAINTS_TSV,
    RULES_REGISTRY_TSV,
    ConstraintError,
    PropertyConstraint,
    constraint_file_rules,
    load_property_constraints,
    render_rules_registry,
    translate,
)
from culturescrape.datalog.materialize import materialize
from culturescrape.datalog.prolog import write_program
from culturescrape.datalog.souffle import write_souffle_program

RETRIEVED = "2026-07-13T00:00:00Z"


def _constraint(**overrides: object) -> PropertyConstraint:
    """A baseline PropertyConstraint with overridable fields."""
    base = dict(
        property_id="P47",
        edge_type="ADJACENT_TO",
        constraint_kind="symmetric",
        constraint_qid="Q21510862",
        statement_id="P47$stmt",
        inverse_pid="",
        inverse_edge_type="",
        class_qid="",
        class_label="",
        relation_qid="",
        source="wikidata",
        source_url="https://www.wikidata.org/wiki/Property:P47",
        retrieved_at=RETRIEVED,
        confidence=0.9,
    )
    base.update(overrides)
    return PropertyConstraint(**base)  # type: ignore[arg-type]


# --- the committed replay artifact ------------------------------------------


def test_committed_artifact_loads_with_provenance() -> None:
    constraints = load_property_constraints()
    kinds = {(c.edge_type, c.constraint_kind) for c in constraints}
    assert ("ADJACENT_TO", "symmetric") in kinds
    assert ("ADJACENT_TO", "value-type") in kinds
    assert ("ADJACENT_TO", "subject-type") in kinds
    assert ("PART_OF", "inverse") in kinds
    for c in constraints:
        assert c.source == "wikidata"
        assert c.source_url == wikidata_property_url(c.property_id)
        assert c.statement_id
        assert c.retrieved_at
        assert 0.0 < c.confidence <= 1.0


def test_load_rejects_a_blank_edge_type(tmp_path: Path) -> None:
    bad = tmp_path / "c.tsv"
    bad.write_text(
        "property_id\tedge_type\tconstraint_qid\nP47\t\tQ21510862\n", encoding="utf-8"
    )
    with pytest.raises(ConstraintError, match="blank property_id/edge_type"):
        load_property_constraints(bad)


def test_load_rejects_a_missing_required_column(tmp_path: Path) -> None:
    bad = tmp_path / "c.tsv"
    bad.write_text("property_id\tedge_type\nP47\tADJACENT_TO\n", encoding="utf-8")
    with pytest.raises(ConstraintError, match="missing the 'constraint_qid' column"):
        load_property_constraints(bad)


# --- extraction: the SPARQL acquisition path --------------------------------


class _FakeResponse:
    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text


class _FakeHttp:
    """A stand-in HttpClient returning canned WDQS P2302 JSON per property."""

    def __init__(self, statements: dict[str, list[dict[str, str]]]) -> None:
        self._statements = statements
        self.queries: list[str] = []

    def get(self, endpoint: str, params: dict[str, str]) -> _FakeResponse:
        query = params["query"]
        self.queries.append(query)
        pid = query.split("wd:", 1)[1].split(" ", 1)[0]
        bindings = []
        for stmt in self._statements.get(pid, []):
            row: dict[str, dict[str, str]] = {
                "statement": {
                    "value": f"http://www.wikidata.org/entity/statement/{stmt['statement']}"
                },
                "constraintType": {
                    "value": f"http://www.wikidata.org/entity/{stmt['constraintType']}"
                },
            }
            for key in ("class", "relation", "property"):
                if stmt.get(key):
                    row[key] = {"value": f"http://www.wikidata.org/entity/{stmt[key]}"}
            bindings.append(row)
        return _FakeResponse(200, json.dumps({"results": {"bindings": bindings}}))


# The real P2302 statements for the two mapped properties (as the fixture replays).
_STATEMENTS: dict[str, list[dict[str, str]]] = {
    "P47": [
        {"statement": "P47$shares-border-symmetric", "constraintType": "Q21510862"},
        {"statement": "P47$shares-border-subject-type", "constraintType": "Q21503250",
         "class": "Q2221906", "relation": "Q21514624"},
        {"statement": "P47$shares-border-value-type", "constraintType": "Q21510865",
         "class": "Q2221906", "relation": "Q21514624"},
        {"statement": "P47$shares-border-contemporary", "constraintType": "Q25796498"},
    ],
    "P361": [
        {"statement": "P361$part-of-inverse", "constraintType": "Q21510855",
         "property": "P527"},
    ],
}


def test_sparql_extractor_resolves_the_corpus_columns() -> None:
    http = _FakeHttp(_STATEMENTS)
    constraints = property_constraints(
        sparql_constraint_lookup(http),  # type: ignore[arg-type]
        retrieved_at=RETRIEVED,
    )
    by_stmt = {c.statement_id: c for c in constraints}
    # The type constraint's class QID resolves to a corpus :LABEL.
    vt = by_stmt["P47$shares-border-value-type"]
    assert vt.constraint_kind == "value-type"
    assert vt.class_qid == "Q2221906" and vt.class_label == "Place"
    # The inverse constraint's target property is out of vocabulary -> blank edge.
    inv = by_stmt["P361$part-of-inverse"]
    assert inv.constraint_kind == "inverse"
    assert inv.inverse_pid == "P527" and inv.inverse_edge_type == ""
    # An unhandled constraint type is carried as "other" for the translator to skip.
    assert by_stmt["P47$shares-border-contemporary"].constraint_kind == "other"
    assert constraint_query("P47") in http.queries[0]


def test_extractor_reproduces_the_committed_artifact() -> None:
    http = _FakeHttp(_STATEMENTS)
    constraints = property_constraints(
        sparql_constraint_lookup(http),  # type: ignore[arg-type]
        retrieved_at=RETRIEVED,
    )
    committed = PROPERTY_CONSTRAINTS_TSV.read_text(encoding="utf-8")
    assert render_property_constraints_tsv(constraints) == committed


def test_write_round_trips(tmp_path: Path) -> None:
    constraints = [_constraint()]
    out = tmp_path / "c.tsv"
    assert write_property_constraints_tsv(constraints, out) == 1
    rendered = render_property_constraints_tsv(constraints)
    assert out.read_text(encoding="utf-8") == rendered
    (reloaded,) = load_property_constraints(out)
    assert reloaded == constraints[0]


def test_every_mapped_edge_type_is_registered() -> None:
    from culturescrape.ontology import registry

    for edge_type in EDGE_PROPERTY_PIDS:
        assert registry.is_registered(edge_type)


# --- translation ------------------------------------------------------------


def test_symmetric_becomes_a_bidirectional_rule() -> None:
    (rule,) = translate([_constraint()]).rules
    assert rule.kind == "symmetric"
    assert rule.prolog_clauses == ("adjacent_to(X, Y) :- adjacent_to(Y, X).",)
    assert rule.souffle_clauses == rule.prolog_clauses  # dialect-neutral derivation
    assert rule.prolog_rule() is not None and rule.souffle_rule() is not None


def test_inverse_becomes_a_souffle_only_inverse_rule() -> None:
    c = _constraint(
        property_id="P361",
        edge_type="PART_OF",
        constraint_kind="inverse",
        constraint_qid="Q21510855",
        inverse_pid="P527",
        inverse_edge_type="HAS_PART",
    )
    (rule,) = translate([c]).rules
    assert rule.kind == "inverse"
    assert rule.souffle_clauses == ("part_of(X, Y) :- has_part(Y, X).",)
    assert rule.prolog_clauses == ()  # Soufflé-only: inverse pairs mutually recurse
    assert rule.prolog_rule() is None and rule.souffle_rule() is not None


def test_inverse_out_of_vocabulary_is_skipped_and_reported() -> None:
    c = _constraint(
        property_id="P361",
        edge_type="PART_OF",
        constraint_kind="inverse",
        constraint_qid="Q21510855",
        inverse_pid="P527",
        inverse_edge_type="",  # not in the corpus vocabulary
    )
    result = translate([c])
    assert result.rules == ()
    (skip,) = result.skipped
    assert "P527" in skip.reason and "not in the corpus edge vocabulary" in skip.reason


def test_subject_and_value_type_become_integrity_rules() -> None:
    subject = _constraint(
        constraint_kind="subject-type", constraint_qid="Q21503250",
        class_qid="Q2221906", class_label="Place",
    )
    value = replace(subject, constraint_kind="value-type", constraint_qid="Q21510865")
    rules = {r.kind: r for r in translate([subject, value]).rules}
    assert rules["subject-type"].souffle_clauses == (
        'adjacent_to_subject_type_violation(X, Y) :- adjacent_to(X, Y), '
        '!instance_of(X, "Place").',
    )
    assert rules["value-type"].souffle_clauses == (
        'adjacent_to_value_type_violation(X, Y) :- adjacent_to(X, Y), '
        '!instance_of(Y, "Place").',
    )
    # Integrity rules are Soufflé-only (stratified negation), and depend on the closure.
    for kind in ("subject-type", "value-type"):
        assert rules[kind].prolog_clauses == ()
        assert "instance_of" in rules[kind].depends


def test_type_constraint_with_unmapped_class_is_skipped() -> None:
    c = _constraint(
        constraint_kind="value-type", constraint_qid="Q21510865",
        class_qid="Q17334923", class_label="",  # a superclass we don't back
    )
    result = translate([c])
    assert result.rules == ()
    (skip,) = result.skipped
    assert "not mapped to a corpus :LABEL" in skip.reason


def test_untranslatable_constraint_type_is_skipped_and_reported() -> None:
    c = _constraint(constraint_kind="other", constraint_qid="Q25796498")
    result = translate([c])
    assert result.rules == ()
    (skip,) = result.skipped
    assert "untranslatable constraint type" in skip.reason
    assert "Q25796498" in skip.reason


def test_redundant_with_a_curated_rule_is_flagged_not_emitted() -> None:
    # A generated clause that a curated rule already ships is marked redundant.
    c = _constraint()
    curated = frozenset({"adjacent_to(X, Y) :- adjacent_to(Y, X)."})
    (rule,) = translate([c], curated=curated).rules
    assert rule.status == "redundant"
    assert translate([c], curated=curated).prolog_rules() == ()


def test_rules_carry_constraint_provenance() -> None:
    (rule,) = translate([_constraint()]).rules
    assert rule.constraint_statement_id == "P47$stmt"
    assert rule.retrieved_at == RETRIEVED
    assert rule.source == "wikidata"
    row = rule.registry_row()
    assert row["constraint_statement_id"] == "P47$stmt"
    assert row["property_id"] == "P47"
    assert row["status"] == "active"


# --- the draft rules registry -----------------------------------------------


def test_committed_registry_matches_the_translated_constraints() -> None:
    rules = constraint_file_rules().rules
    committed = RULES_REGISTRY_TSV.read_text(encoding="utf-8")
    assert render_rules_registry(rules) == committed
    # Every committed constraint that translated is in the registry.
    assert {r.kind for r in rules} == {"symmetric", "subject-type", "value-type"}


# --- derivations materialised engine-free -----------------------------------


def test_symmetric_derivation_materialises() -> None:
    (rule,) = translate([_constraint()]).rules
    souffle_rule = rule.souffle_rule()
    assert souffle_rule is not None
    facts = [Fact("adjacent_to", ("cs:a", "cs:b"))]
    derived = materialize(facts, [souffle_rule])
    assert ("cs:b", "cs:a") in derived["adjacent_to"]  # the reverse edge


def test_inverse_derivation_materialises() -> None:
    c = _constraint(
        edge_type="PART_OF", constraint_kind="inverse",
        inverse_pid="P527", inverse_edge_type="HAS_PART",
    )
    (rule,) = translate([c]).rules
    souffle_rule = rule.souffle_rule()
    assert souffle_rule is not None
    derived = materialize([Fact("has_part", ("cs:whole", "cs:part"))], [souffle_rule])
    assert ("cs:part", "cs:whole") in derived["part_of"]


# --- emission behind the export flag ----------------------------------------


def _corpus_facts() -> list[Fact]:
    # A Place adjacent to a non-Place: the value-type integrity rule should flag it.
    return [
        Fact("instance_of", ("cs:place:a", "Place")),
        Fact("instance_of", ("cs:culture:b", "Culture")),
        Fact("adjacent_to", ("cs:place:a", "cs:culture:b")),
    ]


def test_constraints_render_into_both_programs() -> None:
    result = constraint_file_rules()
    facts = _corpus_facts()
    pl = render_program(facts, rules=result.prolog_rules())
    dl = render_souffle_program(facts, rules=result.souffle_rules())
    # Prolog gets the symmetric derivation only.
    assert "adjacent_to(X, Y) :- adjacent_to(Y, X)." in pl
    assert "violation" not in pl
    # Soufflé gets the symmetric derivation AND the integrity rules + their outputs.
    assert "adjacent_to(X, Y) :- adjacent_to(Y, X)." in dl
    assert 'adjacent_to_value_type_violation(X, Y) :- adjacent_to(X, Y), ' \
        '!instance_of(Y, "Place").' in dl
    assert ".output adjacent_to_value_type_violation" in dl
    assert ".output adjacent_to_subject_type_violation" in dl


def test_export_flag_wires_constraints(tmp_path: Path) -> None:
    from culturescrape.datalog.export import Engine, export_dataset

    (tmp_path / "nodes").mkdir()
    (tmp_path / "nodes" / "n.tsv").write_text(
        "csid:ID\t:LABEL\tname\ncs:place:a\tPlace\tAtlantis\n", encoding="utf-8"
    )
    (tmp_path / "edges").mkdir()
    (tmp_path / "edges" / "e.tsv").write_text(
        ":START_ID\t:END_ID\t:TYPE\ncs:place:a\tcs:culture:b\tADJACENT_TO\n",
        encoding="utf-8",
    )
    out = tmp_path / "out"
    export_dataset(tmp_path, out, [Engine.SOUFFLE], include_constraints=True)
    dl = (out / "graph.dl").read_text(encoding="utf-8")
    assert "adjacent_to(X, Y) :- adjacent_to(Y, X)." in dl
    assert "adjacent_to_value_type_violation" in dl
    # subclass_of taxonomy facts are loaded (the integrity rules negate over the
    # instance_of closure), and instance_of is both loaded and derived.
    assert ".input subclass_of" in dl


# --- real-engine smoke (gated on the engines being installed) ---------------

SWIPL = shutil.which("swipl")
SOUFFLE = shutil.which("souffle")


@pytest.mark.skipif(SWIPL is None, reason="swipl is not installed")
def test_swipl_derives_the_symmetric_edge(tmp_path: Path) -> None:
    (rule,) = translate([_constraint()]).rules
    prolog_rule = rule.prolog_rule()
    assert prolog_rule is not None
    out = tmp_path / "graph.pl"
    write_program(out, [Fact("adjacent_to", ("cs:a", "cs:b"))], [prolog_rule])
    assert SWIPL is not None
    goal = "( adjacent_to('cs:b', 'cs:a') -> halt(0) ; halt(1) )"
    result = subprocess.run(
        [SWIPL, "-q", "-g", goal, str(out)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.skipif(SOUFFLE is None, reason="souffle is not installed")
def test_souffle_detects_a_value_type_violation(tmp_path: Path) -> None:
    rules = constraint_file_rules().souffle_rules()
    facts_dir = tmp_path / "facts"
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    write_souffle_program(facts_dir, _corpus_facts(), rules)
    assert SOUFFLE is not None
    program = facts_dir / "graph.dl"
    result = subprocess.run(
        [SOUFFLE, str(program), "-F", str(facts_dir), "-D", str(out_dir)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    violations = (out_dir / "adjacent_to_value_type_violation.csv").read_text(
        encoding="utf-8"
    )
    # The Place→non-Place edge is enumerated as a value-type violation.
    assert "cs:place:a\tcs:culture:b" in violations
    # The symmetric derivation fired too (the reverse edge exists).
    adjacency = (out_dir / "adjacent_to.csv").read_text(encoding="utf-8")
    assert "cs:culture:b\tcs:place:a" in adjacency
