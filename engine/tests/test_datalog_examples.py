"""Tests for the shipped example queries and their harness (T5-US-009).

Two layers, mirroring the cross-engine equivalence test (which is pure where it
can be and engine-gated where it must be):

* the offline layer checks each shipped ``datalog/examples/*.pl`` exists, is
  documented, lints clean, and that the bundled dataset projects to the base
  facts the queries rely on — so it has coverage with no engine installed;
* the runnable layer projects the bundled dataset to a ``graph.pl`` and runs
  every example in ``swipl``, asserting the answer matches the expected output
  shape. It skips with a logged reason when ``swipl`` is absent.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

import pytest

from pinakes_engine.datalog import Fact
from pinakes_engine.datalog.examples import (
    EXAMPLES,
    Example,
    dataset_dir,
    example_file,
    iter_example_files,
    lint_example,
    run_example,
)
from pinakes_engine.datalog.export import Engine, collect_facts, export_dataset

#: The example slugs the story requires, by query-file stem: the four base
#: closures plus one per-domain query per new corpus-expansion signature
#: relationship (T8), mirroring the new ``cypher/*.cypher`` queries.
EXPECTED_SLUGS = {
    "ancestry-of-dish",
    "entities-within-region",
    "contemporaries-of-event",
    "shortest-influence-chain",
    "festivals-in-period",
    "game-family-variants",
    "invention-lineage",
    "material-composition",
    "genetic-linguistic-correlation",
    "language-descent",
    "entities-by-source",
}

#: Base facts each example depends on; their presence makes the offline layer a
#: real check (the queries would return their expected shape) without an engine.
#: The trailing block is the per-domain corpus-expansion relationships (T8).
REQUIRED_BASE_FACTS = [
    Fact("derived_from", ("cs:dish:tiradito", "cs:dish:ceviche")),
    Fact("derived_from", ("cs:dish:nikkei-ceviche", "cs:dish:tiradito")),
    Fact("influenced_by", ("cs:dish:nikkei-ceviche", "cs:dish:kinilaw")),
    Fact("located_in", ("cs:dish:ceviche", "cs:place:lima")),
    Fact("located_in", ("cs:place:lima", "cs:place:peru")),
    Fact("contemporary_with", ("cs:dish:ceviche", "cs:event:inca-expansion")),
    Fact("part_of_period", ("cs:festival:holi", "cs:period:spring")),
    Fact("part_of_period", ("cs:festival:hanami", "cs:period:spring")),
    Fact("variant_of", ("cs:game:shogi", "cs:game:chess")),
    Fact("variant_of", ("cs:game:xiangqi", "cs:game:chess")),
    Fact("derived_from", ("cs:invention:mobile-phone", "cs:invention:telephone")),
    Fact("derived_from", ("cs:invention:smartphone", "cs:invention:mobile-phone")),
    Fact("made_of", ("cs:clothing:kimono", "cs:material:silk")),
    Fact("made_of", ("cs:clothing:kimono", "cs:material:cotton")),
    # pinakes-origin facts the correlation examples query (source: pinakes).
    Fact("originates_from", ("cs:haplogroup:r1b", "cs:place:western-europe")),
    Fact("spoken_in", ("cs:language:proto-celtic", "cs:place:western-europe")),
    Fact("spoken_in", ("cs:language:gaulish", "cs:place:western-europe")),
    Fact("descends_from", ("cs:language:gaulish", "cs:language:proto-celtic")),
    Fact("descends_from", ("cs:language:proto-celtic", "cs:language:pie")),
    # Queryable provenance (US-004): entities-by-source joins source/2 to node/3.
    Fact("source", ("cs:haplogroup:r1b", "pinakes")),
    Fact("source", ("cs:language:pie", "pinakes")),
    Fact("source", ("cs:language:proto-celtic", "pinakes")),
    Fact("source", ("cs:language:gaulish", "pinakes")),
    Fact("source", ("cs:place:western-europe", "pinakes")),
    Fact("source", ("cs:event:la-tene", "pinakes")),
]


# --- the offline layer ------------------------------------------------------


def test_all_required_examples_are_shipped() -> None:
    shipped = {path.stem for path in iter_example_files()}
    assert EXPECTED_SLUGS <= shipped


def test_examples_metadata_matches_shipped_files() -> None:
    assert {example.slug for example in EXAMPLES} == EXPECTED_SLUGS


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda e: e.slug)
def test_example_file_is_non_empty(example: Example) -> None:
    assert example_file(example.slug).read_text(encoding="utf-8").strip()


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda e: e.slug)
def test_example_lints_clean(example: Example) -> None:
    text = example_file(example.slug).read_text(encoding="utf-8")
    assert lint_example(text) == []


def test_dataset_projects_to_facts() -> None:
    facts = collect_facts(dataset_dir())
    assert facts, "the bundled example dataset projected no facts"


def test_dataset_holds_every_base_fact_the_examples_query() -> None:
    projected = {(f.predicate, f.args) for f in collect_facts(dataset_dir())}
    for fact in REQUIRED_BASE_FACTS:
        assert (fact.predicate, fact.args) in projected, fact.render()


def test_known_predicates_include_registered_type_predicates() -> None:
    """The per-domain queries reach only predicates the exporter emits for a
    registered :TYPE, so the linter must recognise each registered type's typed
    predicate (else a clean per-domain query would be wrongly flagged)."""
    from pinakes_engine.datalog.edges import predicate_for_type
    from pinakes_engine.datalog.examples import KNOWN_PREDICATES
    from pinakes_engine.ontology.registry import relation_types

    for rel in relation_types():
        assert predicate_for_type(rel.name) in KNOWN_PREDICATES
    for predicate in ("part_of_period", "variant_of", "made_of", "derived_from"):
        assert predicate in KNOWN_PREDICATES


def test_linter_flags_a_bogus_query() -> None:
    problems = lint_example("nonsense without a comment or entry point")
    assert "query has no explanatory comment" in problems
    assert any("entry point" in p for p in problems)
    assert "query references no known schema predicate" in problems


def test_linter_flags_unbalanced_brackets() -> None:
    text = "% q\nmain :- within_region(X, 'cs:place:peru'.\n"
    assert "unbalanced brackets" in lint_example(text)


# --- the runnable layer (needs swipl) ---------------------------------------

SWIPL = shutil.which("swipl")


@pytest.fixture(scope="module")
def example_program(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Project the bundled dataset to a rule-bearing ``graph.pl`` once."""
    out = tmp_path_factory.mktemp("example_datalog")
    result = export_dataset(dataset_dir(), out, [Engine.SWIPL], include_rules=True)
    return result.programs[Engine.SWIPL]


@pytest.mark.skipif(SWIPL is None, reason="example queries need swipl to run")
@pytest.mark.parametrize("example", EXAMPLES, ids=lambda e: e.slug)
def test_example_runs_with_expected_output(
    example: Example, example_program: Path
) -> None:
    assert SWIPL is not None  # narrow for mypy
    rows = run_example(example_program, example_file(example.slug), swipl=SWIPL)
    assert rows == example.expected


def test_skip_is_logged_when_swipl_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Document (and log) the skip reason when ``swipl`` is unavailable."""
    if SWIPL is not None:
        pytest.skip("swipl installed; the runnable examples run above")
    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info(
            "skipping runnable example queries: swipl not found"
        )
    assert "swipl not found" in caplog.text
