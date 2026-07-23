"""Tests for the P279 class taxonomy → subclass_of/2 → instance_of closure.

Covers the whole rules-layer US-001 path, engine-free where possible:

* extraction (:mod:`culturescrape.acquire.taxonomy`) over both acquisition paths —
  a SPARQL ancestor lookup and a dump-index one — plus the direct-edge reduction;
* projection (:mod:`culturescrape.datalog.taxonomy`) of the committed replay
  artifact into ``subclass_of/2`` facts;
* the closure rule itself, materialised engine-free and rendered into both
  dialects; and a swipl/souffle-gated smoke that a *real* engine derives the same
  ancestor membership.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

from culturescrape.acquire.taxonomy import (
    CORPUS_CLASS_QIDS,
    ancestor_query,
    dump_ancestor_lookup,
    render_subclass_tsv,
    sparql_ancestor_lookup,
    subclass_edges,
    wikidata_entity_url,
    write_subclass_tsv,
)
from culturescrape.datalog import Fact, render_program, render_souffle_program
from culturescrape.datalog.export import collect_facts
from culturescrape.datalog.materialize import materialize
from culturescrape.datalog.prolog import write_program
from culturescrape.datalog.rules import RULES
from culturescrape.datalog.souffle import write_souffle_program
from culturescrape.datalog.taxonomy import (
    SubclassEdge,
    TaxonomyError,
    load_subclass_edges,
    subclass_facts,
    subclass_file_facts,
)

RETRIEVED = "2026-07-13T00:00:00Z"


# --- the committed replay artifact ------------------------------------------


def test_committed_artifact_projects_the_known_edges() -> None:
    edges = load_subclass_edges()
    pairs = {(e.child, e.parent) for e in edges}
    # The two P279 relations among the corpus's backing classes.
    assert ("ArchaeologicalCulture", "Culture") in pairs
    assert ("LiteraryTradition", "ArtTradition") in pairs
    # Every edge carries genuine Wikidata provenance.
    for edge in edges:
        assert edge.source == "wikidata"
        assert edge.source_url == wikidata_entity_url(edge.child_qid)
        assert edge.retrieved_at
        assert 0.0 < edge.confidence <= 1.0


def test_subclass_facts_are_binary_subclass_of() -> None:
    facts = subclass_facts(load_subclass_edges())
    assert all(f.predicate == "subclass_of" and len(f.args) == 2 for f in facts)
    assert Fact("subclass_of", ("ArchaeologicalCulture", "Culture")) in [
        Fact(f.predicate, f.args) for f in facts
    ]


def test_subclass_file_facts_streams_the_committed_file() -> None:
    assert list(subclass_file_facts()) == subclass_facts(load_subclass_edges())


def test_subclass_file_facts_absent_artifact_is_empty(tmp_path: Path) -> None:
    assert list(subclass_file_facts(tmp_path / "nope.tsv")) == []


def test_load_rejects_a_blank_class(tmp_path: Path) -> None:
    bad = tmp_path / "subclass_of.tsv"
    bad.write_text("child\tparent\nArchaeologicalCulture\t\n", encoding="utf-8")
    with pytest.raises(TaxonomyError, match="blank child/parent"):
        load_subclass_edges(bad)


def test_load_rejects_a_missing_required_column(tmp_path: Path) -> None:
    bad = tmp_path / "subclass_of.tsv"
    bad.write_text("child\tqid\nArchaeologicalCulture\tQ465299\n", encoding="utf-8")
    with pytest.raises(TaxonomyError, match="missing the 'parent' column"):
        load_subclass_edges(bad)


# --- extraction: the SPARQL and dump acquisition paths ----------------------


@dataclass
class _FakeResponse:
    status_code: int
    text: str


class _FakeHttp:
    """A stand-in HttpClient returning canned WDQS JSON per class QID."""

    def __init__(self, ancestors: dict[str, list[str]]) -> None:
        self._ancestors = ancestors
        self.queries: list[str] = []

    def get(self, endpoint: str, params: dict[str, str]) -> _FakeResponse:
        query = params["query"]
        self.queries.append(query)
        # Recover the class QID from `wd:Qxxx wdt:P279* ?super`.
        qid = query.split("wd:", 1)[1].split(" ", 1)[0]
        supers = [qid, *self._ancestors.get(qid, [])]  # P279* includes self
        bindings = [
            {"super": {"value": f"http://www.wikidata.org/entity/{s}"}}
            for s in supers
        ]
        return _FakeResponse(200, json.dumps({"results": {"bindings": bindings}}))


class _FakeIndex:
    """A stand-in DumpIndex answering class_closure from a P279 parent→children map."""

    def __init__(self, children: dict[str, set[str]]) -> None:
        self._children = children

    def class_closure(self, roots: tuple[str, ...], transitive: bool) -> set[str]:
        closure = set(roots)
        stack = list(roots)
        while stack:
            for child in self._children.get(stack.pop(), set()):
                if child not in closure:
                    closure.add(child)
                    stack.append(child)
        return closure


# A tiny universe: three real corpus classes plus one out-of-corpus intermediate.
_CLASSES = {
    "ArchaeologicalCulture": "Q465299",
    "Culture": "Q11042",
    "LiteraryTradition": "Q2198855",
    "ArtTradition": "Q968159",
}
# P279* ancestors (restricted later to the universe by subclass_edges).
_ANCESTORS = {
    "Q465299": ["Q11042", "Q_out"],  # arch culture ⊂ culture (via noise)
    "Q2198855": ["Q968159"],  # literary movement ⊂ art movement
}


def test_sparql_and_dump_paths_agree() -> None:
    http = _FakeHttp(_ANCESTORS)
    sparql_edges = subclass_edges(
        sparql_ancestor_lookup(http),  # type: ignore[arg-type]
        classes=_CLASSES,
        retrieved_at=RETRIEVED,
    )
    # A P279 child→children map: parent -> {child}.
    children: dict[str, set[str]] = {}
    for child, parents in _ANCESTORS.items():
        for parent in parents:
            children.setdefault(parent, set()).add(child)
    index = _FakeIndex(children)
    dump_edges = subclass_edges(
        dump_ancestor_lookup(index, list(_CLASSES.values())),  # type: ignore[arg-type]
        classes=_CLASSES,
        retrieved_at=RETRIEVED,
    )
    pairs = {
        ("ArchaeologicalCulture", "Culture"),
        ("LiteraryTradition", "ArtTradition"),
    }
    assert {(e.child, e.parent) for e in sparql_edges} == pairs
    assert {(e.child, e.parent) for e in dump_edges} == pairs
    # Both paths resolve the same relation set.
    assert sparql_edges == dump_edges
    assert ancestor_query("Q465299") in http.queries[0] or http.queries  # query issued


def test_direct_edge_reduction_drops_transitive_links() -> None:
    # A 3-level chain A ⊂ B ⊂ C: only the direct hops survive, C→ via B, not A→C.
    classes = {"A": "Qa", "B": "Qb", "C": "Qc"}
    ancestors = {"Qa": {"Qb", "Qc"}, "Qb": {"Qc"}}
    edges = subclass_edges(
        lambda qid: set(ancestors.get(qid, set())),
        classes=classes,
        retrieved_at=RETRIEVED,
    )
    pairs = {(e.child, e.parent) for e in edges}
    assert pairs == {("A", "B"), ("B", "C")}
    assert ("A", "C") not in pairs  # the transitive link is elided (rule re-derives it)


def test_extractor_reproduces_the_committed_artifact() -> None:
    # The committed file is exactly what the extractor emits for the real P279
    # relations — tying the replay artifact to the acquisition code.
    edges = subclass_edges(
        lambda qid: {"Q465299": {"Q11042"}, "Q2198855": {"Q968159"}}.get(qid, set()),
        retrieved_at=RETRIEVED,
        classes=CORPUS_CLASS_QIDS,
    )
    committed = load_subclass_edges()
    key = lambda e: (e.child, e.parent, e.child_qid, e.parent_qid)  # noqa: E731
    assert [key(e) for e in edges] == [key(e) for e in committed]


def test_render_write_round_trips(tmp_path: Path) -> None:
    edge = SubclassEdge(
        child="A",
        parent="B",
        child_qid="Q1",
        parent_qid="Q2",
        source="wikidata",
        source_url=wikidata_entity_url("Q1"),
        retrieved_at=RETRIEVED,
        confidence=0.9,
    )
    out = tmp_path / "subclass_of.tsv"
    assert write_subclass_tsv([edge], out) == 1
    assert out.read_text(encoding="utf-8") == render_subclass_tsv([edge])
    (reloaded,) = load_subclass_edges(out)
    assert reloaded == edge


# --- the closure rule, materialised engine-free -----------------------------


def test_instance_of_closure_derives_ancestor_membership() -> None:
    facts = [
        Fact("instance_of", ("cs:archaeological-culture:Q1", "ArchaeologicalCulture")),
        Fact("instance_of", ("cs:literary-tradition:Q2", "LiteraryTradition")),
        *subclass_file_facts(),
    ]
    derived = materialize(facts, RULES)["instance_of"]
    # A leaf-class entity answers instance_of for its taxonomy ancestor.
    assert ("cs:archaeological-culture:Q1", "Culture") in derived
    assert ("cs:literary-tradition:Q2", "ArtTradition") in derived
    # The base typing survives (the head is EDB ∪ IDB).
    assert ("cs:archaeological-culture:Q1", "ArchaeologicalCulture") in derived


def test_multi_hop_membership_climbs_through_derived_instance_of() -> None:
    # A ⊂ B ⊂ C with only direct subclass_of edges: the recursion reaches C via
    # the *derived* instance_of(x, B), proving the one-hop rule closes the chain.
    facts = [
        Fact("instance_of", ("cs:x", "A")),
        Fact("subclass_of", ("A", "B")),
        Fact("subclass_of", ("B", "C")),
    ]
    derived = materialize(facts, RULES)["instance_of"]
    assert ("cs:x", "A") in derived
    assert ("cs:x", "B") in derived
    assert ("cs:x", "C") in derived


def test_closure_emits_into_both_dialects() -> None:
    facts = [
        Fact("instance_of", ("cs:x", "ArchaeologicalCulture")),
        *subclass_file_facts(),
    ]
    clause = "instance_of(X, C) :- instance_of(X, D), subclass_of(D, C)."
    pl = render_program(facts, rules=RULES)
    dl = render_souffle_program(facts, rules=RULES)
    assert clause in pl
    assert clause in dl
    # instance_of is tabled AND fact-bearing: tabled + discontiguous, never dynamic.
    assert ":- table instance_of/2." in pl
    assert ":- discontiguous instance_of/2." in pl
    assert ":- dynamic instance_of/2." not in pl
    # Soufflé: instance_of is both loaded (.input) and derived (.output); the
    # subclass_of base relation is declared/loaded from its facts.
    assert ".input instance_of" in dl and ".output instance_of" in dl
    assert ".input subclass_of" in dl


def test_rule_less_export_omits_the_taxonomy(tmp_path: Path) -> None:
    # subclass_of facts ride only with the rules: a plain fact stream is unchanged.
    (tmp_path / "nodes").mkdir()
    (tmp_path / "nodes" / "n.tsv").write_text(
        "csid:ID\t:LABEL\tname\ncs:c:Q1\tArchaeologicalCulture\tNok\n",
        encoding="utf-8",
    )
    plain = list(collect_facts(tmp_path))
    with_tax = list(collect_facts(tmp_path, include_taxonomy=True))
    assert not any(f.predicate == "subclass_of" for f in plain)
    assert any(f.predicate == "subclass_of" for f in with_tax)


# --- real-engine smoke (gated on the engines being installed) ---------------

SWIPL = shutil.which("swipl")
SOUFFLE = shutil.which("souffle")

_CLOSURE_FACTS = [
    Fact("instance_of", ("cs:archaeological-culture:Q1", "ArchaeologicalCulture")),
    *subclass_file_facts(),
]


@pytest.mark.skipif(SWIPL is None, reason="swipl is not installed")
def test_swipl_derives_transitive_class_membership(tmp_path: Path) -> None:
    out = tmp_path / "graph.pl"
    write_program(out, _CLOSURE_FACTS, rules=RULES)
    assert SWIPL is not None  # narrow for mypy
    goal = (
        "( instance_of('cs:archaeological-culture:Q1', 'Culture') "
        "-> halt(0) ; halt(1) )"
    )
    result = subprocess.run(
        [SWIPL, "-q", "-g", goal, str(out)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.skipif(SOUFFLE is None, reason="souffle is not installed")
def test_souffle_derives_transitive_class_membership(tmp_path: Path) -> None:
    facts_dir = tmp_path / "facts"
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    write_souffle_program(facts_dir, _CLOSURE_FACTS, rules=RULES)
    assert SOUFFLE is not None  # narrow for mypy
    program = facts_dir / "graph.dl"
    result = subprocess.run(
        [SOUFFLE, str(program), "-F", str(facts_dir), "-D", str(out_dir)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    derived = (out_dir / "instance_of.csv").read_text(encoding="utf-8")
    # The ancestor membership the base facts never state directly.
    assert "cs:archaeological-culture:Q1\tCulture" in derived
