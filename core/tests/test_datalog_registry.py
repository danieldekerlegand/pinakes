"""Tests for the provenanced rules registry (rules-layer US-004).

The registry wraps the three rule sources — the curated ``rules.py`` closures, the
Wikidata property-constraint translations (US-002) and the canonical-schema violation
rules (US-003) — into one provenanced, validated table. These tests pin: the committed
TSV to a fresh build; that every curated rule migrated in with ``source=curated``; that
the property/schema rules flow through; that :func:`validate_registry` is a real QA gate
(catches unparseable clauses, unknown predicates, arity conflicts); the exporter's
status gate; and the ``rules-registry`` CLI.
"""

from __future__ import annotations

from pathlib import Path

from culturescrape import cli
from culturescrape.datalog.export import active_curated_rules
from culturescrape.datalog.registry import (
    LAYER_CANONICAL_SCHEMA,
    LAYER_CURATED,
    LAYER_WIKIDATA_PROPERTY,
    REGISTRY_COLUMNS,
    REGISTRY_TSV,
    RULE_LIBRARY_VERSION,
    RegistryEntry,
    RegistryError,
    RuleStatus,
    assert_valid_registry,
    build_registry,
    curated_entries,
    load_registry,
    property_entries,
    render_registry,
    schema_entries,
    validate_registry,
    write_registry,
)
from culturescrape.datalog.rules import RULES


def _entry(**overrides: object) -> RegistryEntry:
    """A minimal well-formed curated entry, with field overrides for negative tests."""
    base: dict[str, object] = {
        "rule_id": "curated-foo",
        "layer": LAYER_CURATED,
        "head": "foo",
        "clause_prolog": "foo(X, Y) :- bar(X, Y).",
        "clause_souffle": "foo(X, Y) :- bar(X, Y).",
        "depends": "bar",
        "source": "curated",
        "source_url": "docs/datalog.md",
        "retrieved_at": "",
        "confidence": 1.0,
        "version": RULE_LIBRARY_VERSION,
        "status": RuleStatus.ACTIVE.value,
    }
    base.update(overrides)
    return RegistryEntry(**base)  # type: ignore[arg-type]


# --- the committed registry --------------------------------------------------


def test_committed_registry_matches_a_fresh_build() -> None:
    # A test pins the committed TSV to build_registry(): editing a rule without
    # regenerating (culturescrape rules-registry --regenerate) fails CI.
    assert load_registry() == build_registry()


def test_committed_registry_round_trips_through_render() -> None:
    entries = build_registry()
    assert REGISTRY_TSV.read_text(encoding="utf-8") == render_registry(entries)


def test_committed_registry_is_well_formed() -> None:
    # The QA gate over the real registry — runs in CI.
    assert validate_registry(load_registry()) == []


def test_header_is_the_registry_columns() -> None:
    header = REGISTRY_TSV.read_text(encoding="utf-8").splitlines()[0]
    assert header.split("\t") == list(REGISTRY_COLUMNS)


# --- migration of the curated rules -----------------------------------------


def test_every_curated_rule_migrated_with_source_curated() -> None:
    by_id = {e.rule_id: e for e in build_registry()}
    for rule in RULES:
        entry = by_id[f"curated-{rule.name}"]
        assert entry.layer == LAYER_CURATED
        assert entry.source == "curated"
        assert entry.version == RULE_LIBRARY_VERSION
        assert entry.status == RuleStatus.ACTIVE.value
        # The curated clauses are dialect-neutral: both columns carry the same text,
        # and it is exactly the rule's own clauses.
        assert entry.clause_prolog == entry.clause_souffle == " ".join(rule.clauses)


def test_curated_entries_count_matches_rules() -> None:
    assert len(curated_entries()) == len(RULES)


# --- the property / schema layers flow through -------------------------------


def test_property_rules_flow_through_the_registry() -> None:
    prop = property_entries()
    assert prop, "expected the committed P2302 rules to be present"
    ids = {e.rule_id for e in build_registry() if e.layer == LAYER_WIKIDATA_PROPERTY}
    assert ids == {e.rule_id for e in prop}
    assert all(e.source == "wikidata" for e in prop)


def test_schema_rules_flow_through_the_registry() -> None:
    schema = schema_entries()
    assert schema, "expected the committed schema violation rules to be present"
    registry = build_registry()
    ids = {e.rule_id for e in registry if e.layer == LAYER_CANONICAL_SCHEMA}
    assert ids == {e.rule_id for e in schema}
    # Schema rules are Soufflé-only — no Prolog clause, a real Soufflé clause.
    for entry in schema:
        assert entry.clause_prolog == ""
        assert entry.clause_souffle
        assert entry.source == "canonical-schema"


def test_all_three_layers_present() -> None:
    layers = {e.layer for e in build_registry()}
    assert layers == {
        LAYER_CURATED,
        LAYER_WIKIDATA_PROPERTY,
        LAYER_CANONICAL_SCHEMA,
    }


# --- validate_registry: the QA gate ------------------------------------------


def test_valid_entries_have_no_problems() -> None:
    assert validate_registry((_entry(),)) == []


def test_unknown_predicate_is_flagged() -> None:
    bad = _entry(
        rule_id="curated-bad",
        head="baz",
        clause_prolog="baz(X) :- nope(X).",
        clause_souffle="",
        depends="",
    )
    problems = validate_registry((bad,))
    assert any("unknown predicate 'nope'" in p.problem for p in problems)


def test_arity_conflict_is_flagged() -> None:
    one = _entry(rule_id="a", head="foo", clause_prolog="foo(X) :- bar(X).",
                 clause_souffle="foo(X) :- bar(X).", depends="bar")
    two = _entry(rule_id="b", head="foo", clause_prolog="foo(X, Y) :- bar(X, Y).",
                 clause_souffle="foo(X, Y) :- bar(X, Y).", depends="bar")
    problems = validate_registry((one, two))
    assert any("arity conflict" in p.problem for p in problems)


def test_unparseable_clause_is_flagged() -> None:
    bad = _entry(clause_prolog="foo(X, Y :- bar(X, Y).", clause_souffle="")
    problems = validate_registry((bad,))
    assert any("unbalanced" in p.problem for p in problems)


def test_head_mismatch_is_flagged() -> None:
    bad = _entry(head="foo", clause_prolog="qux(X, Y) :- bar(X, Y).",
                 clause_souffle="", depends="bar")
    problems = validate_registry((bad,))
    assert any("does not match the registered head" in p.problem for p in problems)


def test_invalid_status_is_flagged() -> None:
    problems = validate_registry((_entry(status="bogus"),))
    assert any("invalid status" in p.problem for p in problems)


def test_rule_with_no_clauses_is_flagged() -> None:
    problems = validate_registry((_entry(clause_prolog="", clause_souffle=""),))
    assert any("no clauses" in p.problem for p in problems)


def test_duplicate_rule_id_is_flagged() -> None:
    problems = validate_registry((_entry(), _entry()))
    assert any("duplicate rule_id" in p.problem for p in problems)


def test_assert_valid_registry_raises_on_problems() -> None:
    import pytest

    with pytest.raises(RegistryError):
        assert_valid_registry((_entry(status="bogus"),))
    assert_valid_registry(build_registry())  # the real registry does not raise


def test_negation_and_comparison_clauses_parse() -> None:
    # A Soufflé violation rule (negation) and a comparison guard both validate clean.
    neg = _entry(
        rule_id="schema-t-from-type",
        layer=LAYER_CANONICAL_SCHEMA,
        head="t_from_type_violation",
        clause_prolog="",
        clause_souffle="t_from_type_violation(X, Y) :- rel(X, Y), !from_ok_t(X, Y).",
        depends="rel;from_ok_t",
    )
    # from_ok_t must be a defined head for the negation reference to be "known".
    support = _entry(
        rule_id="schema-t-from-ok",
        layer=LAYER_CANONICAL_SCHEMA,
        head="from_ok_t",
        clause_prolog="",
        clause_souffle='from_ok_t(X, Y) :- rel(X, Y), instance_of(X, "Culture").',
        depends="rel;instance_of",
    )
    assert validate_registry((neg, support)) == []


# --- exporter consumption: the status gate -----------------------------------


def test_active_curated_rules_defaults_to_all() -> None:
    assert active_curated_rules() == RULES


def test_retired_curated_rule_is_dropped_from_export() -> None:
    def status_of(name: str) -> str:
        return "retired" if name == "ancestor" else "active"

    active = active_curated_rules(status_of=status_of)
    assert all(rule.name != "ancestor" for rule in active)
    assert len(active) == len(RULES) - 1


# --- the rules-registry CLI --------------------------------------------------


def test_cli_validates_the_committed_registry() -> None:
    assert cli.main(["rules-registry"]) == 0


def test_cli_regenerate_is_idempotent(tmp_path: Path) -> None:
    before = REGISTRY_TSV.read_text(encoding="utf-8")
    assert cli.main(["rules-registry", "--regenerate"]) == 0
    assert REGISTRY_TSV.read_text(encoding="utf-8") == before


def test_cli_json_dump(tmp_path: Path) -> None:
    out = tmp_path / "registry.json"
    assert cli.main(["rules-registry", "--json", str(out)]) == 0
    import json

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["problems"] == []
    assert len(payload["rules"]) == len(build_registry())


def test_write_registry_returns_count(tmp_path: Path) -> None:
    out = tmp_path / "reg.tsv"
    entries = build_registry()
    assert write_registry(entries, out) == len(entries)
    assert load_registry(out) == entries
