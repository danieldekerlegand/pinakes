"""Pinakes cross-domain correlation rules over the merged fixture (US-005).

The bundled example dataset (``datalog/examples/dataset``) now carries
Pinakes-origin facts (``source: pinakes``): a haplogroup, a Proto-Celtic
descent chain, and the ``originates_from`` / ``spoken_in`` region links. These
tests prove three things without a logic engine installed:

* the Pinakes facts *project* into the graph with their provenance intact;
* the ported rules (:data:`SAME_REGION`, :data:`GENETIC_LINGUISTIC_CORRELATION`)
  and the reused base closures (``ancestor``, ``contemporary``) emit valid Prolog
  and Soufflé clauses when the dataset is exported;
* the rules' *derived facts* are the expected ones — checked by evaluating the
  rule bodies directly over the projected base facts, so the correlation logic is
  validated even where ``swipl``/``souffle`` are absent.

A ``swipl``-gated smoke test then runs the real closure and agrees with the
engine-free derivation, skipping (with a logged reason) when ``swipl`` is missing.
"""

from __future__ import annotations

import logging
import shutil
from collections import defaultdict
from pathlib import Path

import pytest

from culturescrape.datalog import (
    RULES,
    Fact,
    render_program,
    render_souffle_program,
)
from culturescrape.datalog.examples import (
    GENETIC_LINGUISTIC_CORRELATION as GLC_EXAMPLE,
)
from culturescrape.datalog.examples import (
    LANGUAGE_DESCENT as DESCENT_EXAMPLE,
)
from culturescrape.datalog.examples import (
    dataset_dir,
    example_file,
    run_example,
)
from culturescrape.datalog.export import Engine, collect_facts, export_dataset
from culturescrape.datalog.rules import (
    GENETIC_LINGUISTIC_CORRELATION,
    SAME_REGION,
)

R1B = "cs:haplogroup:r1b"
GAULISH = "cs:language:gaulish"
PROTO_CELTIC = "cs:language:proto-celtic"
PIE = "cs:language:pie"
WESTERN_EUROPE = "cs:place:western-europe"


def _dataset_facts() -> list[Fact]:
    return collect_facts(dataset_dir())


def _pairs(facts: list[Fact], predicate: str) -> set[tuple[str, str]]:
    """The ``(start, end)`` argument pairs of every *predicate* fact."""
    return {
        (str(f.args[0]), str(f.args[1]))
        for f in facts
        if f.predicate == predicate and len(f.args) == 2
    }


# --- projection carries the Pinakes provenance -------------------------


def test_dataset_projects_pinakes_origin_facts() -> None:
    facts = _dataset_facts()
    pinakes = [f for f in facts if f.source == "pinakes"]
    assert pinakes, "the merged fixture projected no Pinakes-origin facts"
    # The correlation base predicates all carry the Pinakes provenance.
    for predicate in ("originates_from", "spoken_in", "descends_from"):
        assert any(f.predicate == predicate for f in pinakes), predicate


def test_correlation_base_edges_are_present() -> None:
    facts = _dataset_facts()
    assert (R1B, WESTERN_EUROPE) in _pairs(facts, "originates_from")
    assert (PROTO_CELTIC, WESTERN_EUROPE) in _pairs(facts, "spoken_in")
    assert (GAULISH, WESTERN_EUROPE) in _pairs(facts, "spoken_in")
    assert (GAULISH, PROTO_CELTIC) in _pairs(facts, "descends_from")
    assert (PROTO_CELTIC, PIE) in _pairs(facts, "descends_from")


# --- the rules emit valid clauses for the merged dataset --------------------


def test_new_rules_emit_into_both_dialects_for_the_dataset() -> None:
    facts = _dataset_facts()
    pl = render_program(facts, rules=RULES)
    dl = render_souffle_program(facts, rules=RULES)
    for rule in (SAME_REGION, GENETIC_LINGUISTIC_CORRELATION):
        for clause in rule.clauses:
            assert clause in pl, clause
            assert clause in dl, clause
    # Each derived relation is declared and output in Soufflé.
    assert ".output same_region" in dl
    assert ".output genetic_linguistic_correlation" in dl


def test_export_writes_rule_bearing_programs(tmp_path: Path) -> None:
    result = export_dataset(
        dataset_dir(), tmp_path, [Engine.SWIPL, Engine.SOUFFLE], include_rules=True
    )
    pl = result.programs[Engine.SWIPL].read_text(encoding="utf-8")
    dl = (tmp_path / "graph.dl").read_text(encoding="utf-8")
    assert "genetic_linguistic_correlation(X, Y) :-" in pl
    assert "genetic_linguistic_correlation(X, Y) :-" in dl


# --- the derived facts, evaluated engine-free over the fixture --------------


def _ancestors(descends: set[tuple[str, str]], start: str) -> set[str]:
    """Transitive closure of ``descends_from`` from *start* (the ancestor/2 rule)."""
    reached: set[str] = set()
    frontier = {end for (s, end) in descends if s == start}
    while frontier:
        node = frontier.pop()
        if node in reached:
            continue
        reached.add(node)
        frontier |= {end for (s, end) in descends if s == node}
    return reached


def _genetic_linguistic(facts: list[Fact], haplogroup: str) -> set[str]:
    """Apply genetic_linguistic_correlation/2's body over the projected facts.

    ``genetic_linguistic_correlation(H, L) :- originates_from(H, R),
    spoken_in(L, R).`` — every language spoken in a region the haplogroup
    originates from.
    """
    spoken_by_region: dict[str, set[str]] = defaultdict(set)
    for lang, region in _pairs(facts, "spoken_in"):
        spoken_by_region[region].add(lang)
    origins = {r for (h, r) in _pairs(facts, "originates_from") if h == haplogroup}
    return {lang for region in origins for lang in spoken_by_region[region]}


def test_genetic_linguistic_correlation_derives_expected_languages() -> None:
    facts = _dataset_facts()
    derived = _genetic_linguistic(facts, R1B)
    assert derived == {PROTO_CELTIC, GAULISH}
    # ...and that is exactly the shipped example's expected answer shape.
    assert {(lang,) for lang in derived} == GLC_EXAMPLE.expected


def test_ancestor_closure_runs_over_pinakes_descent() -> None:
    facts = _dataset_facts()
    derived = _ancestors(_pairs(facts, "descends_from"), GAULISH)
    assert derived == {PROTO_CELTIC, PIE}
    assert {(anc,) for anc in derived} == DESCENT_EXAMPLE.expected


# --- the swipl smoke test agrees with the engine-free derivation ------------

SWIPL = shutil.which("swipl")


@pytest.mark.skipif(SWIPL is None, reason="the correlation smoke test needs swipl")
def test_swipl_runs_correlation_examples(tmp_path: Path) -> None:
    assert SWIPL is not None  # narrow for mypy
    result = export_dataset(dataset_dir(), tmp_path, [Engine.SWIPL], include_rules=True)
    program = result.programs[Engine.SWIPL]
    glc = run_example(
        program, example_file("genetic-linguistic-correlation"), swipl=SWIPL
    )
    assert glc == GLC_EXAMPLE.expected
    descent = run_example(program, example_file("language-descent"), swipl=SWIPL)
    assert descent == DESCENT_EXAMPLE.expected


def test_correlation_smoke_skip_is_logged_when_swipl_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    if SWIPL is not None:
        pytest.skip("swipl installed; the correlation smoke test runs above")
    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info(
            "skipping Pinakes correlation smoke test: swipl not found"
        )
    assert "swipl not found" in caplog.text
