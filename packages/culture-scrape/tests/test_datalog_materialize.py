"""Engine-free materialisation of the inference rules (T-LS-US-004).

``culturescrape.datalog.materialize`` computes each rule's derived extension over
a set of projected facts by naive fixpoint, so the four US-004 inference targets
(``contemporary``/``contemporary_with``, ``same_region``, transitive
``descends_from`` via ``ancestor``, ``genetic_linguistic_correlation``) can be
produced and counted without ``swipl``/``souffle`` installed. These tests pin the
evaluator's answers on the bundled example dataset — where they are small enough
to enumerate by hand — and on synthetic fact sets that exercise recursion, joins,
and empty base relations.
"""

from __future__ import annotations

import pytest

from culturescrape.datalog import Fact
from culturescrape.datalog.examples import (
    GENETIC_LINGUISTIC_CORRELATION as GLC_EXAMPLE,
)
from culturescrape.datalog.examples import (
    LANGUAGE_DESCENT as DESCENT_EXAMPLE,
)
from culturescrape.datalog.examples import dataset_dir
from culturescrape.datalog.export import collect_facts
from culturescrape.datalog.materialize import (
    MaterializationSummary,
    MaterializeError,
    materialize,
    summarize,
)
from culturescrape.datalog.rules import RULES

GAULISH = "cs:language:gaulish"
PROTO_CELTIC = "cs:language:proto-celtic"
PIE = "cs:language:pie"
R1B = "cs:haplogroup:r1b"


def _fixture_facts() -> list[Fact]:
    return collect_facts(dataset_dir())


# --- exact extensions over the bundled example dataset ----------------------


def test_materialize_derives_every_rule_head() -> None:
    derived = materialize(_fixture_facts())
    assert set(derived) == {rule.name for rule in RULES}


def test_ancestor_is_the_transitive_closure_of_descends_from() -> None:
    # descends_from: gaulish->proto-celtic, proto-celtic->pie; ancestor adds the
    # transitive gaulish->pie hop.
    ancestor = materialize(_fixture_facts())["ancestor"]
    assert ancestor == {
        (GAULISH, PROTO_CELTIC),
        (PROTO_CELTIC, PIE),
        (GAULISH, PIE),
    }
    # ...and that is the shipped language-descent example's expected answer.
    assert {end for (start, end) in ancestor if start == GAULISH} == {
        anc for (anc,) in DESCENT_EXAMPLE.expected
    }


def test_genetic_linguistic_correlation_joins_shared_region() -> None:
    glc = materialize(_fixture_facts())["genetic_linguistic_correlation"]
    assert glc == {(R1B, GAULISH), (R1B, PROTO_CELTIC)}
    assert {lang for (hap, lang) in glc if hap == R1B} == {
        lang for (lang,) in GLC_EXAMPLE.expected
    }


def test_contemporary_is_the_symmetric_closure_of_contemporary_with() -> None:
    facts = _fixture_facts()
    base = {
        (str(f.args[0]), str(f.args[1]))
        for f in facts
        if f.predicate == "contemporary_with"
    }
    contemporary = materialize(facts)["contemporary"]
    # Every base edge and its mirror, and nothing else.
    assert contemporary == base | {(b, a) for (a, b) in base}


def test_same_region_is_reflexive_and_symmetric() -> None:
    same_region = materialize(_fixture_facts())["same_region"]
    # Everything that reaches a region shares south-america, so the relation is
    # the full square of those four entities (reflexive + symmetric).
    entities = {x for (x, _y) in same_region} | {y for (_x, y) in same_region}
    assert same_region == {(x, y) for x in entities for y in entities}


# --- recursion, joins, and empty base relations on synthetic facts ----------


def _pairs(predicate: str, *pairs: tuple[str, str]) -> list[Fact]:
    return [Fact(predicate, pair) for pair in pairs]


def test_recursion_reaches_the_full_chain() -> None:
    facts = _pairs("descends_from", ("a", "b"), ("b", "c"), ("c", "d"))
    assert materialize(facts)["ancestor"] == {
        ("a", "b"),
        ("a", "c"),
        ("a", "d"),
        ("b", "c"),
        ("b", "d"),
        ("c", "d"),
    }


def test_influenced_transitively_unions_two_base_relations() -> None:
    facts = _pairs("derived_from", ("x", "y")) + _pairs("influenced_by", ("y", "z"))
    assert materialize(facts)["influenced_transitively"] == {
        ("x", "y"),
        ("y", "z"),
        ("x", "z"),
    }


def test_empty_base_relation_derives_nothing() -> None:
    # No part_of facts at all -> component_of is empty, not an error.
    derived = materialize(_pairs("descends_from", ("a", "b")))
    assert derived["component_of"] == set()
    assert derived["genetic_linguistic_correlation"] == set()


# --- summary / manifest body ------------------------------------------------


def test_summary_counts_base_and_derived_relations() -> None:
    summary = summarize(_fixture_facts())
    assert isinstance(summary, MaterializationSummary)
    # Base counts read straight from the projected facts.
    assert summary.base_relations["descends_from"] == 2
    assert summary.base_relations["contemporary_with"] == 3
    # Derived counts match the materialisation.
    assert summary.derived_relations["ancestor"] == 3
    assert summary.derived_relations["genetic_linguistic_correlation"] == 2
    assert summary.derived_total == sum(summary.derived_relations.values())


def test_summary_is_ordered_by_count_then_name() -> None:
    summary = summarize(_fixture_facts())
    counts = list(summary.derived_relations.values())
    assert counts == sorted(counts, reverse=True)


def test_to_json_carries_the_three_sections() -> None:
    summary = summarize(_fixture_facts())
    body = summary.to_json()
    assert set(body) == {"base_relations", "derived_relations", "derived_total"}
    assert body["derived_total"] == summary.derived_total


# --- malformed clauses fail loudly ------------------------------------------


def test_non_rule_clause_raises() -> None:
    from culturescrape.datalog.rules import Rule

    fact_shaped = Rule(
        name="bad", intent="", example="", depends=(), clauses=("bad(X, Y).",)
    )
    with pytest.raises(MaterializeError):
        materialize([], [fact_shaped])
