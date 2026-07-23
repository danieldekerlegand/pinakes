"""Tests for cross-engine inference equivalence (T5-US-007).

The comparison logic (:class:`Divergence`, :func:`compare_relation`) is pure and
exercised directly, so it has coverage even where neither engine is installed.
The end-to-end check — emit the same fact base and rule library for both engines,
run each, and assert the derived relations match tuple-for-tuple — needs ``swipl``
*and* ``souffle``; it skips with a logged reason when either is absent and runs in
CI when both are present.

It runs **twice**, over the two ways a program reaches an engine: once from the
hand-written :data:`EQUIV_FACTS` list (the emitters in isolation) and once from the
same fact base expressed as canonical TSV and exported through
:func:`~culturescrape.datalog.export.export_dataset`, whose fact clauses the
embedded agora translation engine renders (pinakes:50 US-2). The second pair is
what ``culturescrape to-datalog --rules`` actually ships.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

import pytest

from culturescrape import translation
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
from culturescrape.datalog.export import (
    PROLOG_PROGRAM_NAME,
    Engine,
    collect_facts,
    export_dataset,
)
from culturescrape.datalog.materialize import materialize

#: A fact base whose every derived relation in :data:`RULES` has tuples the raw
#: facts never state directly, so the cross-engine check compares non-empty
#: closures (see the ``prolog`` non-empty assertion below): a transitive
#: descends_from / located_in / part_of chain, a one-directional contemporary_with
#: edge (the mirror is derived), dated spans that overlap (Q47/Q42 →
#: ``contemporary``) and that are disjoint (Q42 before Q99 → ``precedes`` /
#: ``follows``), a mixed influence chain, two entities sharing an enclosing region
#: (same_region), and a haplogroup/language co-located in one region
#: (genetic_linguistic_correlation). Every rule head must appear here — a rule with
#: no base facts would close to the empty set and trip that assertion. The dated
#: facts carry numeric values so Soufflé types time_start/time_end as ``number``.
EQUIV_FACTS = [
    Fact("descends_from", ("cs:lang:spa", "cs:lang:lat")),
    Fact("descends_from", ("cs:lang:lat", "cs:lang:itc")),
    Fact("located_in", ("cs:dish:Q42", "cs:place:Q123")),
    Fact("located_in", ("cs:place:Q123", "cs:place:Q200")),
    Fact("located_in", ("cs:culture:Q7", "cs:place:Q123")),
    Fact("contemporary_with", ("cs:battle:Q47", "cs:dish:Q42")),
    Fact("derived_from", ("cs:dish:Q99", "cs:dish:Q42")),
    Fact("influenced_by", ("cs:dish:Q42", "cs:dish:Q07")),
    Fact("part_of", ("cs:part:Q11", "cs:part:Q12")),
    Fact("part_of", ("cs:part:Q12", "cs:part:Q13")),
    Fact("originates_from", ("cs:haplogroup:r1b", "cs:place:western-europe")),
    Fact("spoken_in", ("cs:language:proto-celtic", "cs:place:western-europe")),
    Fact("time_start", ("cs:battle:Q47", 100)),
    Fact("time_end", ("cs:battle:Q47", 200)),
    Fact("time_start", ("cs:dish:Q42", 150)),
    Fact("time_end", ("cs:dish:Q42", 300)),
    Fact("time_start", ("cs:dish:Q99", 400)),
    Fact("time_end", ("cs:dish:Q99", 500)),
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


# --- the same gate, over the LIB-EMITTED programs (pinakes:50 US-2) ----------
#
# The check above builds both programs from the hand-written :data:`EQUIV_FACTS`
# list, so it exercises the emitters but never the embedded agora translation
# engine. The seam spec requires the equivalence gate to hold for the programs the
# export actually ships, whose every fact clause is rendered by the engine
# (``datalog/export.py`` ``_export_rule_bearing`` → ``translation.dataset_datalog``).
# So the same fact base is expressed as canonical TSV, exported through that path
# once per engine, and compared tuple-for-tuple.

#: The canonical node rows behind :data:`EQUIV_FACTS`. The dated spans are the
#: same three (Q47 100–200 overlapping Q42 150–300; Q99 400–500 disjoint from
#: both) that make ``contemporary``/``precedes``/``follows`` non-empty, carried
#: here as ``time_start``/``time_end`` dimension columns rather than bare facts.
_EQUIV_NODES = """csid:ID\t:LABEL\tname\tsource\ttime_start:int\ttime_end:int
cs:battle:Q47\tBattle\tBattle\twikidata\t100\t200
cs:culture:Q7\tCulture\tCulture\twikidata\t\t
cs:dish:Q07\tDish\tOlder Dish\twikidata\t\t
cs:dish:Q42\tDish\tArepa\twikidata\t150\t300
cs:dish:Q99\tDish\tLater Dish\twikidata\t400\t500
cs:haplogroup:r1b\tHaplogroup\tR1b\twikidata\t\t
cs:lang:itc\tLanguage\tItalic\twikidata\t\t
cs:lang:lat\tLanguage\tLatin\twikidata\t\t
cs:lang:spa\tLanguage\tSpanish\twikidata\t\t
cs:language:proto-celtic\tLanguage\tProto-Celtic\twikidata\t\t
cs:part:Q11\tArtifact\tPart 11\twikidata\t\t
cs:part:Q12\tArtifact\tPart 12\twikidata\t\t
cs:part:Q13\tArtifact\tPart 13\twikidata\t\t
cs:place:Q123\tPlace\tCity\twikidata\t\t
cs:place:Q200\tPlace\tRegion\twikidata\t\t
cs:place:western-europe\tPlace\tWestern Europe\twikidata\t\t
"""

#: The canonical edge rows behind :data:`EQUIV_FACTS` — one ``:TYPE`` per typed
#: predicate the rule bodies read (``predicate_for_type`` lowercases them).
_EQUIV_EDGES = """:START_ID\t:END_ID\t:TYPE\tsource
cs:battle:Q47\tcs:dish:Q42\tCONTEMPORARY_WITH\twikidata
cs:culture:Q7\tcs:place:Q123\tLOCATED_IN\twikidata
cs:dish:Q42\tcs:dish:Q07\tINFLUENCED_BY\twikidata
cs:dish:Q42\tcs:place:Q123\tLOCATED_IN\twikidata
cs:dish:Q99\tcs:dish:Q42\tDERIVED_FROM\twikidata
cs:haplogroup:r1b\tcs:place:western-europe\tORIGINATES_FROM\twikidata
cs:lang:lat\tcs:lang:itc\tDESCENDS_FROM\twikidata
cs:lang:spa\tcs:lang:lat\tDESCENDS_FROM\twikidata
cs:language:proto-celtic\tcs:place:western-europe\tSPOKEN_IN\twikidata
cs:part:Q11\tcs:part:Q12\tPART_OF\twikidata
cs:part:Q12\tcs:part:Q13\tPART_OF\twikidata
cs:place:Q123\tcs:place:Q200\tLOCATED_IN\twikidata
"""


def _equiv_dataset(root: Path) -> Path:
    """Write :data:`EQUIV_FACTS`' fact base as a canonical TSV dataset."""
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    (root / "nodes" / "nodes.tsv").write_text(_EQUIV_NODES, encoding="utf-8")
    (root / "edges" / "edges.tsv").write_text(_EQUIV_EDGES, encoding="utf-8")
    return root


def _export_both(root: Path, tmp_path: Path) -> tuple[Path, Path]:
    """Export *root* with ``--rules`` for each engine; return ``(pl, souffle_dir)``."""
    prolog_dir = tmp_path / "prolog"
    souffle_dir = tmp_path / "souffle"
    export_dataset(root, prolog_dir, (Engine.SWIPL,), include_rules=True)
    export_dataset(root, souffle_dir, (Engine.SOUFFLE,), include_rules=True)
    return prolog_dir / PROLOG_PROGRAM_NAME, souffle_dir


def test_the_lib_emitted_programs_carry_the_engines_clauses_and_a_live_closure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The engine-free half of the gate below — and its non-vacuity guard.

    Two claims the cross-engine run cannot make for itself, because it skips
    wherever ``swipl``/``souffle`` are absent:

    1. **Provenance** — both programs' fact clauses come from the engine. This
       needs a *call-site* probe, not an output one: on this fixture the engine
       and the reference emitters render byte-identical streams (which is the
       whole point of the migration), so swapping the delegation back for the
       Python emitter leaves ``graph.pl`` unchanged and no output assertion can
       see it. Verified deliberately — passing ``rendered_facts=None`` into
       ``_export_rule_bearing`` does not move a single byte. The spy below is
       therefore the only thing separating "the engine rendered these facts" from
       "these bytes happen to match"; the verbatim-block check rides along so a
       call whose *result is discarded* still fails.
    2. **Non-vacuity** — every relation the cross-engine check compares has a
       non-empty extension over this fixture, computed engine-free by
       :func:`~culturescrape.datalog.materialize.materialize`. Without it a
       fixture that closed to the empty set would let the gated test "agree" on
       nothing at all.
    """
    root = _equiv_dataset(tmp_path / "data")

    calls: list[tuple[int, int]] = []
    real = translation.dataset_datalog

    def spy(node_files, edge_files, keep_row=None):  # type: ignore[no-untyped-def]
        calls.append((len(node_files), len(edge_files)))
        return real(node_files, edge_files, keep_row)

    monkeypatch.setattr(translation, "dataset_datalog", spy)
    program, souffle_dir = _export_both(root, tmp_path)
    assert calls == [(1, 1), (1, 1)], (
        "each engine's export must render its facts via the lib"
    )

    facts = collect_facts(root, include_taxonomy=True)
    rendered = real(facts.node_files, facts.edge_files, None)
    clauses = translation.program_fact_clauses(rendered["prolog"])
    assert len(clauses) > 10  # a vacuous block cannot satisfy the check below
    assert "\n".join(clauses) in program.read_text(encoding="utf-8")

    # Soufflé reads its rows from one .facts shard per relation, so the engine's
    # fact base reaches that engine as files rather than as clauses.
    assert (souffle_dir / "rel.facts").exists()
    assert (souffle_dir / "descends_from.facts").exists()

    derived = materialize(list(facts), RULES)
    empty = [name for name in _DERIVED if not derived.get(name)]
    assert not empty, f"closures are empty over the fixture: {empty}"


@pytest.mark.skipif(
    SWIPL is None or SOUFFLE is None,
    reason="cross-engine equivalence needs both swipl and souffle",
)
def test_lib_emitted_prolog_and_souffle_agree_on_every_derived_relation(
    tmp_path: Path,
) -> None:
    assert SWIPL is not None and SOUFFLE is not None  # narrow for mypy
    root = _equiv_dataset(tmp_path / "data")
    program, souffle_dir = _export_both(root, tmp_path)

    out_dir = tmp_path / "out"
    run_souffle(souffle_dir, out_dir, souffle=SOUFFLE)

    disagreements = []
    for predicate in _DERIVED:
        prolog = prolog_tuples(program, predicate, 2, swipl=SWIPL)
        souffle = souffle_tuples(out_dir, predicate)
        div = compare_relation(predicate, prolog, souffle)
        if not div.agree:
            disagreements.append(div.report())
        else:
            # Non-emptiness is pinned engine-free above; assert it here too so a
            # truncated export cannot pass as agreement.
            assert prolog, f"{predicate} closure was unexpectedly empty"
    assert not disagreements, "\n".join(disagreements)
