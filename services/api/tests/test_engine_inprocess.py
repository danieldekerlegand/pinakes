"""The engine layer: same answers as the seams it replaces, no seam left.

Two things are under test here. The first is behaviour — that a corpus read, a
graph read, a Datalog run and an acquisition run all produce the payload shapes
`/api/graph/*` publishes, and that every absent backend degrades instead of
raising something a route would have to turn into a 500. The second is the
absence of the thing this story removed: :func:`test_no_sidecar_or_subprocess_seam`
reads the service's own source and fails if a sidecar URL or a subprocess spawn
ever comes back.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.explorer.datalog import Datalog

from conftest import FakeNode, FakeRelationship, FakeResult
from pinakes.engine import acquisition, corpus, datalog, graph
from pinakes.engine.errors import EngineFailure, EngineUnavailable

# ── Corpus reads (was: the sidecar's /search, /metrics, /completeness) ────────


@pytest.mark.usefixtures("corpus_env")
def test_search_answers_the_sidecar_shape() -> None:
    payload = corpus.search("ceviche")

    assert payload["query"] == "ceviche"
    hit = payload["results"][0]
    assert hit["csid"] == "cs:dish:ceviche"
    assert hit["name"] == "Ceviche"
    assert hit["label"] == "Dish"
    assert hit["qid"] == "Q207681"
    # Both cross-store locators are present; `graph` percent-encodes the csid.
    assert hit["tsv"] == "/nodes/cs:dish:ceviche"
    assert hit["graph"] == "/graph?csid=cs%3Adish%3Aceviche"
    assert set(hit) == {"csid", "name", "label", "qid", "field", "tsv", "graph"}


@pytest.mark.usefixtures("corpus_env")
def test_search_clamps_the_limit() -> None:
    assert corpus.search("cs:", limit=1)["results"] != []
    assert len(corpus.search("cs:", limit=1)["results"]) == 1
    # A non-positive limit clamps up to 1 rather than returning nothing.
    assert len(corpus.search("cs:", limit=0)["results"]) == 1


@pytest.mark.usefixtures("corpus_env")
def test_metrics_renders_the_canonical_document() -> None:
    payload = corpus.metrics()

    assert payload["node_count"] == 3
    assert payload["edges_by_type"] == {"DERIVED_FROM": 1, "LOCATED_IN": 1}
    assert set(payload) == {
        "node_count",
        "edge_count",
        "edges_per_node",
        "component_count",
        "largest_component_size",
        "largest_component_fraction",
        "edges_by_dimension",
        "edges_by_type",
    }


@pytest.mark.usefixtures("corpus_env")
def test_completeness_joins_the_catalog_with_qa() -> None:
    payload = corpus.completeness()

    assert payload["qa"] == {
        "ok": False,
        "node_count": 3,
        "edge_count": 2,
        "violations": ["provenance completeness"],
        "failed_keys": ["provenance_completeness"],
    }
    # Default sort is worst-first: the category with fetch errors leads.
    assert [row["category_id"] for row in payload["rows"]] == [
        "andean-context",
        "peruvian-dishes",
    ]
    assert payload["rows"][0]["status"] == "failed"
    assert payload["rows"][0]["errors"] == 2


@pytest.mark.usefixtures("corpus_env")
def test_completeness_filters_and_falls_back_to_a_known_sort() -> None:
    only_failed = corpus.completeness(status="failed")
    assert [row["category_id"] for row in only_failed["rows"]] == ["andean-context"]

    # An unknown sort is a stale bookmark, not an error — it degrades to
    # "status", the same order the default answers with.
    assert corpus.completeness(sort="nonsense") == corpus.completeness()


def test_a_missing_corpus_is_unavailable_not_a_crash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(corpus.CORPUS_ENV, str(tmp_path / "nowhere"))
    with pytest.raises(EngineUnavailable):
        corpus.search("anything")


def test_the_corpus_location_is_overridable_and_defaults_into_the_repo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(corpus.CORPUS_ENV, str(tmp_path))
    assert corpus.corpus_source() == tmp_path.resolve()

    monkeypatch.delenv(corpus.CORPUS_ENV, raising=False)
    assert corpus.corpus_source().parts[-2:] == ("build", "corpus")


# ── Graph reads (was: the TypeScript neo4j driver + the sidecar consoles) ─────


def _dish() -> FakeNode:
    return FakeNode(
        "4:n:1",
        ["Dish", "Entity"],
        {
            "csid": "cs:dish:ceviche",
            "name": "Ceviche",
            "source": "wikidata",
            "time_start": -200,
        },
    )


def _place() -> FakeNode:
    return FakeNode(
        "4:n:2", ["Place"], {"csid": "cs:place:lima", "name": "Lima"}
    )


def test_node_projects_csid_labels_name_and_the_rest_as_properties(
    fake_graph: Any,
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([{"n": _dish()}], ["n"]))

    found = graph.node("cs:dish:ceviche")

    assert found == {
        "csid": "cs:dish:ceviche",
        "labels": ["Dish", "Entity"],
        "name": "Ceviche",
        "properties": {"source": "wikidata", "time_start": -200},
    }


def test_a_missing_node_is_none(fake_graph: Any) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], ["n"]))
    assert graph.node("cs:dish:nope") is None


def test_an_unreachable_store_is_unavailable_before_the_query_runs(
    fake_graph: Any,
) -> None:
    driver = fake_graph(
        lambda _cypher, _params: FakeResult([{"n": _dish()}], ["n"]), reachable=False
    )

    with pytest.raises(EngineUnavailable):
        graph.node("cs:dish:ceviche")
    # The fast-fail probe is the point: no read was attempted at all, so a down
    # store answers immediately instead of waiting out the driver's retry window.
    assert driver.queries == []


def test_the_availability_probe_is_cached(fake_graph: Any) -> None:
    driver = fake_graph(lambda _cypher, _params: FakeResult([], []))

    assert graph.available() is True
    assert graph.available() is True
    assert driver.probes == 1

    graph.reset()
    assert graph.available() is True
    assert driver.probes == 2


def test_neighborhood_is_self_contained_and_depth_is_clamped(
    fake_graph: Any,
) -> None:
    dish, place = _dish(), _place()
    stray = FakeNode("4:n:9", ["Dish"], {"csid": "cs:dish:stray"})
    edges = [
        FakeRelationship("5:e:1", "LOCATED_IN", dish, place, {"weight": 0.8}),
        # An edge to a node outside the returned set must be dropped.
        FakeRelationship("5:e:2", "DERIVED_FROM", stray, dish),
    ]
    driver = fake_graph(
        lambda _cypher, _params: FakeResult(
            [{"focus": dish, "reachedNodes": [place], "pathRels": edges}],
            ["focus", "reachedNodes", "pathRels"],
        )
    )

    hood = graph.neighborhood("cs:dish:ceviche", depth=99)

    assert hood is not None
    assert hood["depth"] == graph.MAX_DEPTH
    assert f"[*1..{graph.MAX_DEPTH}]" in driver.queries[0][0]
    assert hood["root"]["csid"] == "cs:dish:ceviche"
    assert {node["csid"] for node in hood["nodes"]} == {
        "cs:dish:ceviche",
        "cs:place:lima",
    }
    assert hood["edges"] == [
        {
            "id": "5:e:1",
            "type": "LOCATED_IN",
            "startCsid": "cs:dish:ceviche",
            "endCsid": "cs:place:lima",
            "weight": 0.8,
            "properties": {},
        }
    ]


def test_neighborhood_of_a_missing_node_is_none(fake_graph: Any) -> None:
    fake_graph(
        lambda _cypher, _params: FakeResult(
            [{"focus": None, "reachedNodes": [], "pathRels": []}],
            ["focus", "reachedNodes", "pathRels"],
        )
    )
    assert graph.neighborhood("cs:dish:nope") is None


def test_overview_clamps_its_limit_and_returns_a_snapshot(fake_graph: Any) -> None:
    dish, place = _dish(), _place()
    driver = fake_graph(
        lambda _cypher, _params: FakeResult(
            [
                {
                    "nodes": [dish, place],
                    "rels": [FakeRelationship("5:e:1", "LOCATED_IN", dish, place)],
                }
            ],
            ["nodes", "rels"],
        )
    )

    snapshot = graph.overview(limit=10_000)

    assert driver.queries[0][1] == {"limit": graph.MAX_OVERVIEW_LIMIT}
    assert len(snapshot["nodes"]) == 2
    assert snapshot["edges"][0]["type"] == "LOCATED_IN"
    # No weight property on that edge, so the key is absent rather than null.
    assert "weight" not in snapshot["edges"][0]


def test_an_empty_graph_is_an_empty_snapshot(fake_graph: Any) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], ["nodes", "rels"]))
    assert graph.overview() == {"nodes": [], "edges": []}


def test_cypher_returns_columns_and_stringified_rows(fake_graph: Any) -> None:
    fake_graph(
        lambda _cypher, _params: FakeResult(
            [{"csid": "cs:dish:ceviche", "n": 3}], ["csid", "n"]
        )
    )

    assert graph.cypher("MATCH (n) RETURN n.csid AS csid, 3 AS n") == {
        "columns": ["csid", "n"],
        "rows": [["cs:dish:ceviche", "3"]],
    }


def test_a_rejected_query_is_a_failure_not_an_outage(fake_graph: Any) -> None:
    from neo4j.exceptions import ClientError

    def reject(_cypher: str, _params: dict[str, Any]) -> FakeResult:
        raise ClientError("Invalid input 'MATCH'")

    fake_graph(reject)

    # 502, not 503: the store is up and retrying will not help.
    with pytest.raises(EngineFailure):
        graph.cypher("MATCH bad syntax")


def test_a_dropped_connection_mid_query_is_an_outage(fake_graph: Any) -> None:
    def drop(_cypher: str, _params: dict[str, Any]) -> FakeResult:
        raise OSError("connection reset")

    fake_graph(drop)

    with pytest.raises(EngineUnavailable):
        graph.node("cs:dish:ceviche")


def test_retrieval_without_an_embedder_degrades(fake_graph: Any) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], []))
    # No `graphrag` extra in this service's environment, so the default
    # retriever reports itself unavailable — the documented degraded state.
    with pytest.raises(EngineUnavailable):
        graph.retrieve("andean cuisine")


# ── The personal-tier gate ───────────────────────────────────────────────────


def _asset() -> FakeNode:
    return FakeNode("4:n:3", ["Asset"], {"csid": "cs:asset:home-video"})


def test_personal_nodes_are_hidden_by_default(fake_graph: Any) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([{"n": _asset()}], ["n"]))
    assert graph.node("cs:asset:home-video") is None


def test_personal_nodes_surface_only_when_the_operator_opts_in(
    fake_graph: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([{"n": _asset()}], ["n"]))
    monkeypatch.setenv(graph.PERSONAL_TIER_ENV, "true")

    found = graph.node("cs:asset:home-video")

    assert found is not None
    assert found["csid"] == "cs:asset:home-video"


def test_a_dropped_personal_node_takes_its_edges_with_it(fake_graph: Any) -> None:
    dish, asset = _dish(), _asset()
    fake_graph(
        lambda _cypher, _params: FakeResult(
            [
                {
                    "nodes": [dish, asset],
                    "rels": [FakeRelationship("5:e:1", "DEPICTS", asset, dish)],
                }
            ],
            ["nodes", "rels"],
        )
    )

    snapshot = graph.overview()

    assert [node["csid"] for node in snapshot["nodes"]] == ["cs:dish:ceviche"]
    assert snapshot["edges"] == []


# ── Datalog (was: the sidecar's /datalog console over HTTP) ──────────────────


@pytest.fixture
def offline_datalog(corpus_root: Path) -> Iterator[None]:
    """Pin the console to the offline (lint-only) path, whatever is on PATH."""
    datalog.configure(Datalog(corpus_root / "corpus", swipl=None))
    yield
    datalog.reset()


@pytest.mark.usefixtures("offline_datalog")
def test_datalog_answers_the_declared_outcome_shape() -> None:
    outcome = datalog.run(goal="main :- true.")

    assert set(outcome) == {"ran", "rows", "problems", "error", "reason"}
    # Without swipl the query is linted, not run — and says so, rather than
    # failing. The TypeScript client's schema declared exactly this shape; the
    # sidecar's HTML-only view could never actually return it.
    assert outcome["ran"] is False
    assert outcome["reason"]
    assert outcome["rows"] == []


@pytest.mark.usefixtures("offline_datalog")
def test_a_shipped_example_runs_by_slug() -> None:
    slug = datalog.examples()[0].slug
    assert datalog.run(example=slug)["ran"] is False  # offline, as above


@pytest.mark.usefixtures("offline_datalog")
def test_an_unknown_example_is_rejected() -> None:
    with pytest.raises(datalog.UnknownExample):
        datalog.run(example="no-such-query")


@pytest.mark.usefixtures("offline_datalog")
def test_running_nothing_is_rejected() -> None:
    with pytest.raises(ValueError):
        datalog.run()


# ── Acquisition (was: `python -m pinakes_engine.cli fetch` as a subprocess) ───

SPEC: dict[str, Any] = {
    "id": "peruvian-dishes",
    "label": "Dish",
    "description": "Peruvian dishes.",
    "source": {"type": "wikidata-sparql", "query": "SELECT ?item WHERE {}"},
    "dimensions": ["temporal", "geographic"],
}


def _record(name: str) -> RawRecord:
    return RawRecord(
        fields={"itemLabel": name, "qid": "Q1"},
        provenance=Provenance(
            source="wikidata",
            source_url="https://www.wikidata.org/entity/Q1",
            source_query="SELECT ?item WHERE {}",
            retrieved_at="2026-08-02T00:00:00Z",
            confidence=0.9,
        ),
    )


class FixtureAdapter(SourceAdapter):
    """An adapter that yields recorded rows — no network, no subprocess."""

    name = "wikidata-sparql"
    source_type = "wikidata-sparql"

    def __init__(self, records: list[RawRecord], *, fail_after: int | None = None):
        self._records = records
        self._fail_after = fail_after

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        for index, record in enumerate(self._records):
            if self._fail_after is not None and index == self._fail_after:
                raise RuntimeError("one bad row")
            yield record


def test_fetch_returns_records_and_a_report_with_no_subprocess() -> None:
    result = acquisition.fetch(
        SPEC, adapter=FixtureAdapter([_record("Ceviche"), _record("Tiradito")])
    )

    assert [record.fields["itemLabel"] for record in result.records] == [
        "Ceviche",
        "Tiradito",
    ]
    assert result.report.category_id == "peruvian-dishes"
    assert result.report.row_count == 2
    assert result.report.error_count == 0
    # The payload is the engine's own JSON-lines shape, so a caller that used to
    # read the subprocess's `.jsonl` back needs no new parser.
    payload = result.payload()
    assert payload["records"][0]["provenance"]["source"] == "wikidata"
    assert json.dumps(payload)  # JSON-serializable end to end


def test_a_bad_row_is_counted_not_raised() -> None:
    result = acquisition.fetch(
        SPEC,
        adapter=FixtureAdapter(
            [_record("Ceviche"), _record("Tiradito")], fail_after=1
        ),
    )

    assert result.report.row_count == 1
    assert result.report.error_count == 1


def test_an_invalid_spec_is_a_caller_failure() -> None:
    with pytest.raises(EngineFailure):
        acquisition.fetch({"id": "broken"}, adapter=FixtureAdapter([]))


# ── The seam itself is gone ──────────────────────────────────────────────────

#: Literals that would mean a seam came back: the sidecar's base URL or its port,
#: the env var that configured it, or any way of spawning a child process.
#:
#: These match *code*, not prose — `import subprocess` rather than the bare word,
#: so a docstring is still free to explain what was removed. The port number is
#: the exception (there is no code-only form of it), which is why nothing under
#: `src/` names it; if you need to write it, write it in a doc, not here.
FORBIDDEN_SEAMS = (
    "PINAKES_ENGINE_API_URL",
    "8800",
    "import subprocess",
    "subprocess.",
    "Popen",
)


def test_no_sidecar_or_subprocess_seam() -> None:
    """The service reaches the engine by import only.

    An invariant guard in the shape `server/security/*-proxy.test.ts` uses: the
    thing being asserted is an *absence*, which no behavioural test can observe.
    If a future change reintroduces an HTTP hop to :8800 or shells out to the
    CLI, this fails and names the file.
    """
    package = Path(__file__).resolve().parents[1] / "src" / "pinakes"
    offenders: list[str] = []
    for path in sorted(package.rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        for literal in FORBIDDEN_SEAMS:
            if literal in source:
                offenders.append(f"{path.name}: {literal}")
    assert offenders == []
