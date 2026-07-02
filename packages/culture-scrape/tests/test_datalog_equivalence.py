"""Tests for cross-engine inference equivalence (T5-US-007).

The comparison logic (:class:`Divergence`, :func:`compare_relation`) is pure and
exercised directly, so it has coverage even where neither engine is installed.
The end-to-end check — emit the same fact base and rule library for both engines,
run each, and assert the derived relations match tuple-for-tuple — needs ``swipl``
*and* ``souffle``; it skips with a logged reason when either is absent and runs in
CI when both are present.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

import pytest

from culturescrape.datalog import (
    RULES,
    Divergence,
    Fact,
    compare_relation,
    prolog_tuples,
    run_souffle,
    souffle_tuples,
    write_program,
    write_souffle_program,
)
from culturescrape.datalog.equivalence import Tuple

#: A fact base whose every derived relation has tuples the raw facts never state
#: directly: a transitive descends_from / located_in chain, a one-directional
#: contemporary_with edge (the mirror is derived), and a mixed influence chain.
EQUIV_FACTS = [
    Fact("descends_from", ("cs:lang:spa", "cs:lang:lat")),
    Fact("descends_from", ("cs:lang:lat", "cs:lang:itc")),
    Fact("located_in", ("cs:dish:Q42", "cs:place:Q123")),
    Fact("located_in", ("cs:place:Q123", "cs:place:Q200")),
    Fact("contemporary_with", ("cs:battle:Q47", "cs:dish:Q42")),
    Fact("derived_from", ("cs:dish:Q99", "cs:dish:Q42")),
    Fact("influenced_by", ("cs:dish:Q42", "cs:dish:Q07")),
]


# --- the pure comparison ----------------------------------------------------


def test_identical_results_agree_with_an_empty_report() -> None:
    shared: set[Tuple] = {("a", "b"), ("b", "c")}
    div = compare_relation("ancestor", shared, set(shared))
    assert div.agree
    assert div.report() == ""


def test_divergence_records_tuples_unique_to_each_engine() -> None:
    prolog: set[Tuple] = {("a", "b"), ("a", "c")}
    souffle: set[Tuple] = {("a", "b"), ("a", "d")}
    div = compare_relation("ancestor", prolog, souffle)
    assert not div.agree
    assert div.only_in_prolog == frozenset({("a", "c")})
    assert div.only_in_souffle == frozenset({("a", "d")})


def test_report_names_the_predicate_and_the_diverging_tuples() -> None:
    div = compare_relation(
        "ancestor", {("a", "c")}, {("a", "d")}
    )
    report = div.report()
    assert "ancestor: engines disagree" in report
    assert "only in swipl" in report and "(a, c)" in report
    assert "only in souffle" in report and "(a, d)" in report


def test_one_sided_divergence_omits_the_empty_side() -> None:
    # A tuple swipl derived but souffle missed: only the swipl side is listed.
    div = compare_relation("ancestor", {("a", "b"), ("a", "c")}, {("a", "b")})
    report = div.report()
    assert "only in swipl" in report
    assert "only in souffle" not in report


def test_divergence_is_constructible_directly() -> None:
    div = Divergence("rel", frozenset(), frozenset())
    assert div.agree


# --- the cross-engine equivalence smoke test --------------------------------

SWIPL = shutil.which("swipl")
SOUFFLE = shutil.which("souffle")

#: The derived relations whose extensions must match across the two engines.
_DERIVED = tuple(rule.name for rule in RULES)


@pytest.mark.skipif(
    SWIPL is None or SOUFFLE is None,
    reason="cross-engine equivalence needs both swipl and souffle",
)
def test_prolog_and_souffle_agree_on_every_derived_relation(tmp_path: Path) -> None:
    assert SWIPL is not None and SOUFFLE is not None  # narrow for mypy
    pl = tmp_path / "graph.pl"
    write_program(pl, EQUIV_FACTS, rules=RULES)

    facts_dir = tmp_path / "souffle"
    out_dir = tmp_path / "out"
    write_souffle_program(facts_dir, EQUIV_FACTS, rules=RULES)
    run_souffle(facts_dir, out_dir, souffle=SOUFFLE)

    disagreements = []
    for predicate in _DERIVED:
        prolog = prolog_tuples(pl, predicate, 2, swipl=SWIPL)
        souffle = souffle_tuples(out_dir, predicate)
        div = compare_relation(predicate, prolog, souffle)
        if not div.agree:
            disagreements.append(div.report())
        else:
            # A non-empty closure is being compared, not two empty sets.
            assert prolog, f"{predicate} closure was unexpectedly empty"
    assert not disagreements, "\n".join(disagreements)


def test_equivalence_skip_is_logged_when_an_engine_is_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Document (and log) the skip reason when either engine is unavailable."""
    if SWIPL is not None and SOUFFLE is not None:
        pytest.skip("both engines installed; equivalence runs in the check above")
    with caplog.at_level(logging.INFO):
        missing = [n for n, p in (("swipl", SWIPL), ("souffle", SOUFFLE)) if p is None]
        logging.getLogger(__name__).info(
            "skipping cross-engine equivalence: %s not found", ", ".join(missing)
        )
    assert "not found" in caplog.text
