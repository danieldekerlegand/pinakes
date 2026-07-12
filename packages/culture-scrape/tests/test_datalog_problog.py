"""Tests for the ProbLog probabilistic-logic emitter (US-004).

The emitter itself is pure text generation; the *offline* tests below pin
annotation (confidence → probability), atom escaping, rule/stub emission and the
render/write byte-identity. A final smoke test feeds the emitted program to the
``problog`` pip package and asserts a computed **marginal probability**, proving
the generated syntax is valid ProbLog (and that confidences multiply along a
derived chain). That smoke ``importorskip``s problog, so the suite still runs
where it is absent; problog is a declared dev dependency, so it runs in CI.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from culturescrape.datalog import (
    RULES,
    AnnotatedFact,
    Dialect,
    Fact,
    ProblogError,
    annotate_edge_group,
    collect_problog_facts,
    edge_facts,
    render_annotated_fact,
    render_problog_program,
    write_problog_program,
)
from culturescrape.datalog.export import Engine, engines_for_choice, export_dataset
from culturescrape.datalog.problog import PROBLOG_PROGRAM_NAME
from culturescrape.schema.tsvio import Row

_FIXTURES = Path(__file__).parent / "fixtures" / "datalog"


def _dataset(root: Path) -> Path:
    """A dataset root holding the shared datalog fixture nodes/edges."""
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    (root / "nodes" / "nodes.tsv").write_text(
        (_FIXTURES / "nodes.tsv").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (root / "edges" / "edges.tsv").write_text(
        (_FIXTURES / "edges.tsv").read_text(encoding="utf-8"), encoding="utf-8"
    )
    return root


def _chain_dataset(root: Path) -> Path:
    """A tiny dataset with a two-hop ``located_in`` chain of known confidences.

    ``Q1 --0.9--> Q2 --0.8--> Q3`` so ``within_region(Q1, Q3)`` has a marginal of
    ``0.9 * 0.8 = 0.72`` — a clean product a ProbLog evaluation must reproduce.
    """
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    (root / "nodes" / "nodes.tsv").write_text(
        "csid:ID\t:LABEL\tname\tsource\n"
        "cs:dish:Q1\tDish\tArepa\twikidata\n"
        "cs:place:Q2\tPlace\tCity\twikidata\n"
        "cs:place:Q3\tPlace\tCountry\twikidata\n",
        encoding="utf-8",
    )
    (root / "edges" / "edges.tsv").write_text(
        ":START_ID\t:END_ID\t:TYPE\tconfidence:float\tsource\n"
        "cs:dish:Q1\tcs:place:Q2\tLOCATED_IN\t0.9\twikidata\n"
        "cs:place:Q2\tcs:place:Q3\tLOCATED_IN\t0.8\twikidata\n",
        encoding="utf-8",
    )
    return root


# --- Annotation -----------------------------------------------------------


def _edge_row(confidence: str) -> Row:
    return {
        ":START_ID": "cs:dish:Q42",
        ":END_ID": "cs:place:Q123",
        ":TYPE": "LOCATED_IN",
        "confidence": confidence,
        "source": "wikidata",
    }


def test_confidence_annotates_both_edge_views() -> None:
    annotated = annotate_edge_group(edge_facts(_edge_row("0.8")))
    by_pred = {af.fact.predicate: af.probability for af in annotated}
    # The generic rel/3 and the typed located_in/2 both carry the confidence.
    assert by_pred["rel"] == 0.8
    assert by_pred["located_in"] == 0.8


def test_companions_stay_certain() -> None:
    annotated = annotate_edge_group(edge_facts(_edge_row("0.8")))
    companions = {af.fact.predicate: af.probability for af in annotated}
    # rel_conf/rel_source are metadata about the edge, not the edge — unannotated.
    assert companions["rel_conf"] is None
    assert companions["rel_source"] is None


def test_absent_confidence_leaves_edge_unannotated() -> None:
    annotated = annotate_edge_group(edge_facts(_edge_row("")))
    edge = next(af for af in annotated if af.fact.predicate == "rel")
    assert edge.probability is None


def test_unit_confidence_renders_unannotated() -> None:
    # A confidence of exactly 1.0 is certain — no `1.0::` prefix (lowercase
    # atoms are bare Prolog atoms, exactly as render_fact writes them).
    rendered = render_annotated_fact(AnnotatedFact(Fact("rel", ("t", "a", "b")), 1.0))
    assert rendered == "rel(t, a, b)."


def test_fractional_confidence_is_prefixed() -> None:
    rendered = render_annotated_fact(AnnotatedFact(Fact("rel", ("t", "a", "b")), 0.8))
    assert rendered == "0.8::rel(t, a, b)."


def test_out_of_range_confidence_raises() -> None:
    with pytest.raises(ProblogError, match="probability in"):
        render_annotated_fact(AnnotatedFact(Fact("rel", ("t", "a", "b")), 1.5))


# --- Escaping -------------------------------------------------------------


def test_atoms_are_quoted_and_escaped_like_prolog() -> None:
    # The clause body reuses the Prolog dialect, so csids/apostrophes/Unicode
    # quote exactly as render_fact(Dialect.PROLOG) does — problog reads that.
    fact = Fact("rel", ("cognate_with", "cs:word:d'Artagnan", "cs:word:café"))
    rendered = render_annotated_fact(AnnotatedFact(fact, 0.7))
    assert rendered == (
        "0.7::rel(cognate_with, 'cs:word:d\\'Artagnan', 'cs:word:café')."
    )
    # The certain form is exactly the Prolog clause (no annotation added).
    assert render_annotated_fact(AnnotatedFact(fact)) == fact.render(Dialect.PROLOG)


def test_source_comment_rides_along() -> None:
    fact = Fact("rel", ("located_in", "a", "b"), source="wikidata")
    rendered = render_annotated_fact(AnnotatedFact(fact, 0.9))
    assert rendered == "0.9::rel(located_in, a, b).  % source: wikidata"


# --- Program structure ----------------------------------------------------


def test_header_is_comment_only_and_names_the_dialect() -> None:
    program = render_problog_program([])
    header = program.strip()
    assert all(line.startswith("%") for line in header.splitlines())
    assert "ProbLog" in header
    # No Prolog directives — problog's parser rejects them.
    for directive in (":- dynamic", ":- discontiguous", ":- table"):
        assert directive not in program


def test_program_ends_with_a_trailing_newline() -> None:
    program = render_problog_program([AnnotatedFact(Fact("node", ("a", "b", "c")))])
    assert program.endswith(".\n")


def test_write_is_byte_identical_to_render(tmp_path: Path) -> None:
    facts = list(collect_problog_facts(_dataset(tmp_path / "data")))
    out = tmp_path / "nested" / PROBLOG_PROGRAM_NAME
    count = write_problog_program(out, facts, RULES)
    assert count == len(facts)
    assert out.read_text(encoding="utf-8") == render_problog_program(facts, RULES)


def test_fact_count_matches_projection(tmp_path: Path) -> None:
    facts = list(collect_problog_facts(_dataset(tmp_path / "data")))
    out = tmp_path / PROBLOG_PROGRAM_NAME
    # One ProbLog clause per projected fact (confidence rides the edge, not an
    # extra clause), so the count equals the number of annotated facts.
    assert write_problog_program(out, facts) == len(facts)


def test_fixture_annotates_confidence_edges(tmp_path: Path) -> None:
    program = render_problog_program(collect_problog_facts(_dataset(tmp_path / "data")))
    # LOCATED_IN carries weight 0.9 → annotated; DERIVED_FROM has no strength →
    # unannotated bare clause.
    assert "0.9::rel(located_in, 'cs:dish:Q42', 'cs:place:Q123')." in program
    assert "0.9::located_in('cs:dish:Q42', 'cs:place:Q123')." in program
    assert "rel(derived_from, 'cs:dish:Q99', 'cs:dish:Q42')." in program
    # ...with no probability annotation (no `::` prefixes the derived_from edge).
    assert "::rel(derived_from" not in program
    assert "::derived_from(" not in program


# --- Rule + stub emission -------------------------------------------------


def test_rules_emit_clauses_and_base_predicate_stubs(tmp_path: Path) -> None:
    program = render_problog_program(
        collect_problog_facts(_dataset(tmp_path / "data")), RULES
    )
    # Every derived rule head's clause text is present (shared verbatim with .pl).
    assert "ancestor(X, Y) :- descends_from(X, Y)." in program
    assert (
        "within_region(X, Y) :- located_in(X, Z), within_region(Z, Y)." in program
    )
    # A base predicate a rule reads but that may be empty gets a never-firing
    # stub so a query never raises UnknownClause (problog has no :- dynamic).
    assert "originates_from(_, _) :- fail." in program
    assert "spoken_in(_, _) :- fail." in program
    # A rule *head* is defined by its clauses, so it is not also stubbed.
    assert "ancestor(_, _) :- fail." not in program


def test_no_rules_no_stub_section() -> None:
    program = render_problog_program([AnnotatedFact(Fact("node", ("a", "b", "c")))])
    assert ":- fail." not in program
    assert "Inference rules" not in program


# --- CLI / engine wiring --------------------------------------------------


def test_engines_for_choice_selects_problog_alone() -> None:
    assert engines_for_choice("problog") == (Engine.PROBLOG,)
    # problog is opt-in; `both` stays the deterministic pair.
    assert engines_for_choice("both") == (Engine.SWIPL, Engine.SOUFFLE)


def test_export_writes_problog_program_and_hint(tmp_path: Path) -> None:
    out = tmp_path / "out"
    result = export_dataset(_dataset(tmp_path / "data"), out, (Engine.PROBLOG,))
    program = out / PROBLOG_PROGRAM_NAME
    assert result.programs[Engine.PROBLOG] == program
    assert program.exists()
    assert result.load_hint(Engine.PROBLOG) == f"problog {program}"


# --- ProbLog computes a marginal (the CI smoke) ---------------------------


def test_problog_computes_a_marginal_over_a_fixture(tmp_path: Path) -> None:
    problog_program = pytest.importorskip("problog.program")
    problog = pytest.importorskip("problog")

    facts = list(collect_problog_facts(_chain_dataset(tmp_path / "data")))
    # Emit the program WITH rules (so within_region/2 is defined), then append a
    # query — the emitted program is a knowledge base; the caller adds queries.
    text = render_problog_program(facts, RULES)
    text += "\nquery(located_in('cs:dish:Q1', 'cs:place:Q2')).\n"
    text += "query(within_region('cs:dish:Q1', 'cs:place:Q3')).\n"

    model = problog_program.PrologString(text)
    result = problog.get_evaluatable().create_from(model).evaluate()
    marginals = {str(term): prob for term, prob in result.items()}

    # The direct edge is its own confidence; the two-hop derived containment is
    # the product of the chain's confidences (0.9 * 0.8).
    assert marginals["located_in('cs:dish:Q1','cs:place:Q2')"] == pytest.approx(0.9)
    assert marginals["within_region('cs:dish:Q1','cs:place:Q3')"] == pytest.approx(
        0.72
    )
