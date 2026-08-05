"""`/api/graph/*` over HTTP: the contract `server/routes/graph.ts` published.

The engine layer's own answers are tested in `test_engine_inprocess.py`; what is
under test here is everything the route adds on top — query-string parsing, the
short-circuits, the read-only Cypher guard, and the status codes a degraded
backend produces. Those are the parts the React client is written against
(`web/src/lib/graph/*`), and the parts a port gets wrong quietly.

Nothing here touches a database or a corpus it did not create: the graph calls run
against the `fake_graph` driver and the corpus calls against `corpus_env`, both
from `conftest.py`. A test that installs *neither* is exercising the genuinely
degraded path — no Neo4j configured, no corpus on disk — which is a state a
developer checkout is in by default and which the routes must answer, not crash on.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from conftest import FakeNode, FakeRelationship, FakeResult

# ── Corpus-backed reads ──────────────────────────────────────────────────────


@pytest.mark.usefixtures("corpus_env")
def test_search_returns_the_corpus_hits(unbuilt_client: TestClient) -> None:
    payload = unbuilt_client.get("/api/graph/search", params={"q": "ceviche"}).json()

    assert payload["query"] == "ceviche"
    assert payload["results"][0]["csid"] == "cs:dish:ceviche"


@pytest.mark.usefixtures("corpus_env")
def test_search_applies_a_positive_limit(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get(
        "/api/graph/search", params={"q": "cs:", "limit": "1"}
    )
    assert len(response.json()["results"]) == 1


@pytest.mark.usefixtures("corpus_env")
def test_a_junk_limit_falls_back_instead_of_422(unbuilt_client: TestClient) -> None:
    """Express reached these through `Number(...)`, so a stale bookmark was never
    an error. A declared `int` param would answer 422 — a different contract."""
    response = unbuilt_client.get(
        "/api/graph/search", params={"q": "cs:", "limit": "abc"}
    )
    assert response.status_code == 200
    assert len(response.json()["results"]) > 1


def test_an_empty_search_short_circuits(unbuilt_client: TestClient) -> None:
    """No corpus is configured here, so an empty query answering 200 is the proof
    that nothing was read."""
    response = unbuilt_client.get("/api/graph/search", params={"q": "   "})

    assert response.status_code == 200
    assert response.json() == {"query": "", "results": []}


@pytest.mark.usefixtures("corpus_env")
def test_metrics_returns_the_canonical_document(unbuilt_client: TestClient) -> None:
    payload = unbuilt_client.get("/api/graph/metrics").json()
    assert payload["node_count"] == 3


def test_a_missing_corpus_is_503_available_false(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/graph/metrics")

    assert response.status_code == 503
    body = response.json()
    assert body["available"] is False
    assert body["error"] == "graph metrics is unavailable"
    assert "no readable corpus" in body["detail"]


# ── Neo4j-backed reads ───────────────────────────────────────────────────────


def _dish() -> FakeNode:
    return FakeNode(
        "4:n:1", ["Dish"], {"csid": "cs:dish:ceviche", "name": "Ceviche"}
    )


def _place() -> FakeNode:
    return FakeNode("4:n:2", ["Place"], {"csid": "cs:place:lima", "name": "Lima"})


def test_node_is_wrapped_in_a_node_key(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([{"n": _dish()}], ["n"]))

    payload = unbuilt_client.get("/api/graph/node/cs:dish:ceviche").json()

    assert payload["node"]["name"] == "Ceviche"


def test_a_missing_node_is_404_with_the_csid(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], ["n"]))

    response = unbuilt_client.get("/api/graph/node/cs:dish:nope")

    assert response.status_code == 404
    assert response.json() == {"error": "node not found", "csid": "cs:dish:nope"}


def test_an_unreachable_store_is_503_available_false(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], []), reachable=False)

    response = unbuilt_client.get("/api/graph/node/cs:dish:ceviche")

    assert response.status_code == 503
    assert response.json()["available"] is False
    assert response.json()["error"] == "graph node lookup is unavailable"


def _neighborhood_result(_cypher: str, _params: dict[str, Any]) -> FakeResult:
    dish, place = _dish(), _place()
    return FakeResult(
        [
            {
                "focus": dish,
                "reachedNodes": [place],
                "pathRels": [FakeRelationship("5:e:1", "LOCATED_IN", dish, place)],
            }
        ],
        ["focus", "reachedNodes", "pathRels"],
    )


def test_neighborhood_defaults_to_one_hop_and_clamps(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(_neighborhood_result)
    url = "/api/graph/neighborhood/cs:dish:ceviche"

    assert unbuilt_client.get(url).json()["depth"] == 1
    assert unbuilt_client.get(url, params={"depth": "9"}).json()["depth"] == 3
    # Non-numeric is a stale bookmark, not a 422 — it falls back to one hop.
    assert unbuilt_client.get(url, params={"depth": "deep"}).json()["depth"] == 1


def test_neighborhood_returns_the_subgraph(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(_neighborhood_result)

    payload = unbuilt_client.get("/api/graph/neighborhood/cs:dish:ceviche").json()

    assert payload["root"]["csid"] == "cs:dish:ceviche"
    assert {node["csid"] for node in payload["nodes"]} == {
        "cs:dish:ceviche",
        "cs:place:lima",
    }
    assert payload["edges"][0]["type"] == "LOCATED_IN"


def test_a_missing_focus_node_is_404(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], []))

    response = unbuilt_client.get("/api/graph/neighborhood/cs:dish:nope")

    assert response.status_code == 404


def test_overview_passes_a_positive_limit_and_ignores_the_rest(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    driver = fake_graph(
        lambda _cypher, _params: FakeResult(
            [{"nodes": [_dish()], "rels": []}], ["nodes", "rels"]
        )
    )

    assert unbuilt_client.get("/api/graph/overview").json()["edges"] == []
    unbuilt_client.get("/api/graph/overview", params={"limit": "10"})
    unbuilt_client.get("/api/graph/overview", params={"limit": "-5"})

    limits = [params["limit"] for _cypher, params in driver.queries]
    assert limits == [250, 10, 250]


def test_an_empty_retrieval_short_circuits(unbuilt_client: TestClient) -> None:
    """The embedder is absent in this environment, so a 200 proves it was never
    consulted."""
    response = unbuilt_client.get("/api/graph/retrieve", params={"q": ""})

    assert response.status_code == 200
    assert response.json() == {"query": "", "seeds": [], "nodes": [], "edges": []}


def test_retrieval_without_an_embedder_is_503_available_false(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/graph/retrieve", params={"q": "ceviche"})

    assert response.status_code == 503
    assert response.json()["available"] is False


# ── The research consoles ────────────────────────────────────────────────────


def test_datalog_requires_a_goal_or_an_example(unbuilt_client: TestClient) -> None:
    for body in ({}, {"goal": "   "}, {"goal": 7}):
        response = unbuilt_client.post("/api/graph/datalog", json=body)
        assert response.status_code == 400
        assert response.json() == {"error": "a datalog goal or example is required"}


def test_datalog_passes_the_outcome_through(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Including a lint error: that is an answer about the query, not a failure of
    the service, and swallowing it is how "nothing happened" bugs are born."""
    from pinakes.engine import datalog as engine_datalog

    outcome = {
        "ran": False,
        "rows": [],
        "problems": ["unknown predicate"],
        "error": "lint",
        "reason": "swipl is not installed",
    }
    monkeypatch.setattr(engine_datalog, "run", lambda **_kwargs: outcome)

    response = unbuilt_client.post("/api/graph/datalog", json={"goal": "main."})

    assert response.status_code == 200
    assert response.json() == outcome


def test_cypher_requires_a_query(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post("/api/graph/cypher", json={"query": "  "})

    assert response.status_code == 400
    assert response.json() == {"error": "a cypher query is required"}


@pytest.mark.parametrize(
    "query",
    [
        "CREATE (n:Dish)",
        "MATCH (n) DELETE n",
        "match (n) set n.name = 'x'",
        "LOAD  CSV FROM 'file:///x.csv' AS row RETURN row",
    ],
)
def test_a_write_clause_is_rejected_before_the_store(
    unbuilt_client: TestClient, fake_graph: Any, query: str
) -> None:
    driver = fake_graph(lambda _cypher, _params: FakeResult([], []))

    response = unbuilt_client.post("/api/graph/cypher", json={"query": query})

    assert response.status_code == 400
    assert response.json()["error"] == "the research console is read-only"
    # The guard is the point: the store was never asked, not even probed.
    assert driver.queries == []
    assert driver.probes == 0


def test_a_read_only_query_runs(unbuilt_client: TestClient, fake_graph: Any) -> None:
    fake_graph(
        lambda _cypher, _params: FakeResult([{"name": "Ceviche"}], ["name"]),
    )

    response = unbuilt_client.post(
        "/api/graph/cypher", json={"query": "MATCH (n) RETURN n.name AS name"}
    )

    assert response.status_code == 200
    assert response.json() == {"columns": ["name"], "rows": [["Ceviche"]]}


def test_a_rejected_query_is_502_not_503(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    """A reachable store that refused the query: retrying will not help, so the
    client must not be told to."""
    from neo4j.exceptions import ClientError

    def explode(_cypher: str, _params: dict[str, Any]) -> FakeResult:
        raise ClientError("Invalid input 'RETRUN'")

    fake_graph(explode)

    response = unbuilt_client.post(
        "/api/graph/cypher", json={"query": "MATCH (n) RETRUN n"}
    )

    assert response.status_code == 502
    assert response.json()["available"] is True


# ── Availability ─────────────────────────────────────────────────────────────


def test_status_reports_both_halves(
    unbuilt_client: TestClient, fake_graph: Any
) -> None:
    fake_graph(lambda _cypher, _params: FakeResult([], []))

    payload = unbuilt_client.get("/api/graph/status").json()

    assert payload["neo4j"] is True
    assert payload["available"] is True
    # No corpus on disk in this environment — the half the sidecar used to serve.
    assert payload["sidecar"] is False
    assert isinstance(payload["checkedAt"], int)


def test_status_is_200_even_with_both_halves_down(
    unbuilt_client: TestClient,
) -> None:
    """It is a health probe, not itself graph-dependent — a 5xx here would take
    out the client's whole availability polling loop."""
    response = unbuilt_client.get("/api/graph/status")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "neo4j": False,
        "sidecar": False,
        "checkedAt": response.json()["checkedAt"],
    }


# ── Lexicon-backed resolution ────────────────────────────────────────────────


def seed_languages(lexicons: Path) -> None:
    """A two-row corpus the alias index can be built from."""
    (lexicons / "languages.tsv").write_text(
        "id\tname\tregion\n"
        "lat\tLatin\tEurope\n"
        "cmn\tMandarin\tChina\n",
        encoding="utf-8",
    )


def test_resolve_returns_the_csid_with_its_method_and_confidence(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_languages(isolated_data_trees["lexicons"])

    payload = unbuilt_client.get(
        "/api/graph/resolve", params={"type": "language", "id": "lat"}
    ).json()

    assert payload["resolved"] == {
        "csid": "cs:language:lat",
        "confidence": 1.0,
        "method": "alias",
    }


def test_resolve_falls_back_to_a_fuzzy_name_match(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_languages(isolated_data_trees["lexicons"])

    payload = unbuilt_client.get(
        "/api/graph/resolve", params={"type": "language", "name": "Latin"}
    ).json()

    assert payload["resolved"]["csid"] == "cs:language:lat"
    assert payload["resolved"]["method"] == "fuzzy"


def test_resolve_answers_null_rather_than_guessing(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`null` covers both a no-match and an ambiguous one; 200 either way."""
    seed_languages(isolated_data_trees["lexicons"])

    response = unbuilt_client.get(
        "/api/graph/resolve", params={"type": "language", "name": "Klingon"}
    )

    assert response.status_code == 200
    assert response.json()["resolved"] is None


def test_resolve_answers_while_the_graph_is_offline(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The whole reason this route is not engine-backed.

    No `fake_graph`, no `corpus_env`: the state a developer checkout is in. The
    alias table is read off the local lexicons, so resolution still succeeds —
    which is what lets a "Show in graph" affordance decide whether to render.
    """
    seed_languages(isolated_data_trees["lexicons"])

    payload = unbuilt_client.get(
        "/api/graph/resolve", params={"type": "language", "id": "cmn"}
    ).json()

    assert payload["resolved"]["csid"] == "cs:language:cmn"


def test_resolve_requires_a_type(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/graph/resolve", params={"id": "lat"})

    assert response.status_code == 400
    assert response.json() == {"error": "type is required"}


# ── Not this story's routes ──────────────────────────────────────────────────


def test_the_connection_narrative_still_answers_501(
    unbuilt_client: TestClient,
) -> None:
    """The LLM narrative is its own port (pinakes:65 US-2) — it must read as
    outstanding, not silently missing."""
    response = unbuilt_client.post("/api/graph/explain")

    assert response.status_code == 501
    assert response.json()["error"] == "not_ported"
