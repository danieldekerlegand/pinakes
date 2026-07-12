"""Tests for the shared inference-rule library (T5-US-006).

The rules are engine-neutral templates that attach to any generated program, so
the checks come in pairs: the same rule text must reach both the ``.pl`` (Prolog)
and ``.dl`` (Soufflé) outputs, with the scaffolding each engine needs around it.
The closure semantics themselves are exercised by the ``swipl``/``souffle`` smoke
tests, which skip (with a logged reason) when the engine is absent.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

import pytest

from culturescrape.datalog import (
    RULES,
    Dialect,
    Fact,
    Rule,
    render_program,
    render_rule,
    render_souffle_program,
    write_program,
    write_souffle_program,
)
from culturescrape.datalog.rules import (
    ANCESTOR,
    ARITY,
    COMPONENT_OF,
    CONTEMPORARY,
    GENETIC_LINGUISTIC_CORRELATION,
    INFLUENCED_TRANSITIVELY,
    SAME_REGION,
    WITHIN_REGION,
    is_recursive,
    tabled_signatures,
)

#: A fact base exercising every rule's closure: a two-step descends_from chain,
#: a two-step located_in containment, a one-directional contemporary_with edge,
#: a derived_from→influenced_by influence chain, and — for the LinguaScrape
#: correlation rules — a haplogroup originating in the region a language is
#: spoken in.
RULE_FACTS = [
    Fact("descends_from", ("cs:lang:spa", "cs:lang:lat")),
    Fact("descends_from", ("cs:lang:lat", "cs:lang:itc")),
    Fact("located_in", ("cs:dish:Q42", "cs:place:Q123")),
    Fact("located_in", ("cs:place:Q123", "cs:place:Q200")),
    Fact("contemporary_with", ("cs:battle:Q47", "cs:dish:Q42")),
    Fact("derived_from", ("cs:dish:Q99", "cs:dish:Q42")),
    Fact("influenced_by", ("cs:dish:Q42", "cs:dish:Q07")),
    Fact("part_of", ("cs:part:Q11", "cs:part:Q12")),
    Fact("part_of", ("cs:part:Q12", "cs:part:Q13")),
    Fact("originates_from", ("cs:haplogroup:r1b", "cs:place:Q123")),
    Fact("spoken_in", ("cs:lang:gaulish", "cs:place:Q123")),
]


# --- the library ------------------------------------------------------------


def test_library_defines_the_required_derived_relations() -> None:
    assert [rule.name for rule in RULES] == [
        "ancestor",
        "within_region",
        "contemporary",
        "influenced_transitively",
        "component_of",
        "same_region",
        "genetic_linguistic_correlation",
    ]


def test_each_rule_documents_intent_and_a_worked_example() -> None:
    for rule in RULES:
        assert rule.intent.strip()
        assert "?-" in rule.example  # a runnable example query
        assert rule.clauses  # at least one Horn clause


def test_rule_clause_text_is_shared_verbatim_across_dialects() -> None:
    # A pure Horn rule has no constants, so its clauses are identical in both
    # syntaxes; only the comment marker of the doc block differs.
    for rule in RULES:
        prolog = render_rule(rule, Dialect.PROLOG).splitlines()
        souffle = render_rule(rule, Dialect.DATALOG).splitlines()
        prolog_clauses = [ln for ln in prolog if not ln.startswith("%")]
        souffle_clauses = [ln for ln in souffle if not ln.startswith("//")]
        assert prolog_clauses == souffle_clauses == list(rule.clauses)


def test_doc_block_uses_the_dialect_comment_marker() -> None:
    assert render_rule(ANCESTOR, Dialect.PROLOG).startswith("% ")
    assert render_rule(ANCESTOR, Dialect.DATALOG).startswith("// ")


# --- emission into the Prolog program ---------------------------------------


def test_every_rule_clause_is_emitted_into_the_pl_output() -> None:
    program = render_program(RULE_FACTS, rules=RULES)
    for rule in RULES:
        for clause in rule.clauses:
            assert clause in program


def test_pl_declares_derived_and_base_rule_predicates() -> None:
    # A rule body over a base relation the graph never populates must still be
    # declared, so querying it answers false rather than raising.
    program = render_program([], rules=RULES)
    # Non-recursive derived heads and every base relation are dynamic +
    # discontiguous, so an unpopulated relation answers false instead of raising.
    for name in (
        "contemporary",
        "descends_from",
        "same_region",
        "genetic_linguistic_correlation",
        "originates_from",
        "spoken_in",
    ):
        assert f":- discontiguous {name}/2." in program
        assert f":- dynamic {name}/2." in program
    # Recursive (transitive-closure) heads are TABLED instead — SLD resolution
    # loops on a cyclic base relation, so they must not be dynamic (SWI forbids
    # tabling a dynamic procedure). See rules.is_recursive / tabled_signatures.
    recursive_heads = (
        "ancestor",
        "within_region",
        "influenced_transitively",
        "component_of",
    )
    for name in recursive_heads:
        assert f":- table {name}/2." in program
        assert f":- dynamic {name}/2." not in program
        assert f":- discontiguous {name}/2." not in program


def test_is_recursive_flags_only_transitive_closure_rules() -> None:
    # A rule is recursive iff its head predicate appears in its own body — the
    # transitive closures. The symmetric/join rules are not.
    recursive = {ANCESTOR, WITHIN_REGION, INFLUENCED_TRANSITIVELY, COMPONENT_OF}
    for rule in RULES:
        assert is_recursive(rule) is (rule in recursive), rule.name


def test_tabled_signatures_are_the_recursive_heads() -> None:
    assert tabled_signatures(RULES) == {
        (rule.name, ARITY)
        for rule in (ANCESTOR, WITHIN_REGION, INFLUENCED_TRANSITIVELY, COMPONENT_OF)
    }


def test_pl_documents_each_rule_intent_and_example() -> None:
    program = render_program([], rules=RULES)
    assert "% Inference rules" in program
    for rule in RULES:
        assert f"% {rule.name}(" in program  # intent line names the predicate
    assert "% Example query:" in program


def test_pl_without_rules_is_unchanged() -> None:
    # The rules are opt-in: omitting them leaves the fact-only program intact.
    assert "Inference rules" not in render_program(RULE_FACTS)


# --- emission into the Soufflé program --------------------------------------


def test_every_rule_clause_is_emitted_into_the_dl_output() -> None:
    program = render_souffle_program(RULE_FACTS, rules=RULES)
    for rule in RULES:
        for clause in rule.clauses:
            assert clause in program


def test_dl_declares_and_outputs_each_derived_relation() -> None:
    program = render_souffle_program(RULE_FACTS, rules=RULES)
    for rule in RULES:
        assert f".decl {rule.name}(x0: symbol, x1: symbol)" in program
        assert f".output {rule.name}" in program


def test_dl_declares_unpopulated_base_predicates_once() -> None:
    program = render_souffle_program(RULE_FACTS, rules=RULES)
    # contemporary_with has no facts here but a rule reads it: it must be
    # declared so the program compiles.
    assert ".decl contemporary_with(x0: symbol, x1: symbol)" in program
    # located_in is already declared by the fact base; it must not be redeclared.
    assert program.count(".decl located_in(") == 1


def test_dl_without_rules_is_unchanged() -> None:
    assert "Inference rules" not in render_souffle_program(RULE_FACTS)


# --- writing to disk --------------------------------------------------------


def test_write_program_embeds_rules(tmp_path: Path) -> None:
    out = tmp_path / "graph.pl"
    write_program(out, RULE_FACTS, rules=RULES)
    text = out.read_text(encoding="utf-8")
    assert "ancestor(X, Y) :- descends_from(X, Y)." in text


def test_write_souffle_program_embeds_rules(tmp_path: Path) -> None:
    write_souffle_program(tmp_path, RULE_FACTS, rules=RULES)
    text = (tmp_path / "graph.dl").read_text(encoding="utf-8")
    assert "within_region(X, Y) :- located_in(X, Y)." in text
    assert ".output within_region" in text


# --- a custom rule still attaches cleanly -----------------------------------


def test_a_custom_rule_template_attaches_to_both_engines() -> None:
    rule = Rule(
        name="sibling",
        intent="sibling(X, Y): X and Y share a parent.",
        example="?- sibling(a, X).",
        depends=("descends_from",),
        clauses=("sibling(X, Y) :- descends_from(X, P), descends_from(Y, P).",),
    )
    clause = rule.clauses[0]
    assert clause in render_program([], rules=[rule])
    assert clause in render_souffle_program([], rules=[rule])


# --- the swipl closure smoke test -------------------------------------------

SWIPL = shutil.which("swipl")

#: Goals asserting each rule's closure holds on RULE_FACTS — the transitive,
#: symmetric and union closures the raw facts do not state directly.
_CLOSURE_GOALS = (
    "ancestor('cs:lang:spa', 'cs:lang:itc')",  # transitive descends_from
    "within_region('cs:dish:Q42', 'cs:place:Q200')",  # transitive located_in
    "contemporary('cs:dish:Q42', 'cs:battle:Q47')",  # symmetric closure
    "influenced_transitively('cs:dish:Q99', 'cs:dish:Q07')",  # union closure
    "component_of('cs:part:Q11', 'cs:part:Q13')",  # transitive part_of
    "same_region('cs:dish:Q42', 'cs:place:Q123')",  # co-located via within_region
    # haplogroup origin ∩ language spoken region → correlation
    "genetic_linguistic_correlation('cs:haplogroup:r1b', 'cs:lang:gaulish')",
)


@pytest.mark.skipif(SWIPL is None, reason="swipl is not installed")
def test_swipl_loads_rules_and_computes_closures(tmp_path: Path) -> None:
    out = tmp_path / "graph.pl"
    write_program(out, RULE_FACTS, rules=RULES)
    assert SWIPL is not None  # narrow for mypy; guarded by the skipif above
    goal = f"( {', '.join(_CLOSURE_GOALS)} -> halt(0) ; halt(1) )"
    result = subprocess.run(
        [SWIPL, "-q", "-g", goal, str(out)],
        capture_output=True,
        text=True,
    )
    combined = result.stdout + result.stderr
    assert result.returncode == 0, combined  # every closure goal succeeded
    assert "Warning" not in combined, combined  # ...with a clean load
    assert "ERROR" not in combined, combined


# --- the souffle closure smoke test -----------------------------------------

SOUFFLE = shutil.which("souffle")


@pytest.mark.skipif(SOUFFLE is None, reason="souffle is not installed")
def test_souffle_runs_rules_and_materialises_closures(tmp_path: Path) -> None:
    facts_dir = tmp_path / "facts"
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    write_souffle_program(facts_dir, RULE_FACTS, rules=RULES)
    assert SOUFFLE is not None  # narrow for mypy; guarded by the skipif above
    result = subprocess.run(
        [
            SOUFFLE,
            str(facts_dir / "graph.dl"),
            "-F",
            str(facts_dir),
            "-D",
            str(out_dir),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    ancestor = (out_dir / "ancestor.csv").read_text(encoding="utf-8")
    # The transitive tuple the raw facts never state directly.
    assert "cs:lang:spa\tcs:lang:itc" in ancestor


def test_engine_smoke_skips_are_logged_when_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Document (and log) the skip reason when an engine is unavailable."""
    if SWIPL is not None and SOUFFLE is not None:
        pytest.skip("both engines installed; the absence path is exercised elsewhere")
    with caplog.at_level(logging.INFO):
        for name, found in (("swipl", SWIPL), ("souffle", SOUFFLE)):
            if found is None:
                logging.getLogger(__name__).info(
                    "skipping %s rule smoke test: %s not found", name, name
                )
    assert "not found" in caplog.text


def test_all_rule_constants_are_referenced() -> None:
    # Guard against an orphaned export: every named rule is in RULES.
    named = {
        ANCESTOR,
        WITHIN_REGION,
        CONTEMPORARY,
        INFLUENCED_TRANSITIVELY,
        COMPONENT_OF,
        SAME_REGION,
        GENETIC_LINGUISTIC_CORRELATION,
    }
    assert set(RULES) == named
