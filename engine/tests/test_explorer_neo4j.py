"""Tests for the explorer's optional live Neo4j view (T7-US-007).

The live database is always mocked: a fake driver replays per-query fixture
records over the same ``session().run(...)`` cursor the real driver exposes, so
the Cypher console, the live graph neighborhood, and every graceful-degradation
path are exercised with no live server. Routes are driven with FastAPI's
TestClient.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from pinakes_engine.explorer import create_app  # noqa: E402
from pinakes_engine.explorer.live import Neo4jLive, load_queries  # noqa: E402
from pinakes_engine.neo4j import Neo4jDriverNotInstalled  # noqa: E402
from pinakes_engine.neo4j.constraints import ENTITY_LABEL  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "explorer-corpus"

#: Config carrying a password so ``configured()`` is True without touching env.
CONFIG = {"password": "secret"}
#: An env mapping with no Neo4j settings, so credentials are absent.
EMPTY_ENV: dict[str, str] = {}

#: A query handler maps (cypher, params) -> (column keys, record dicts).
Handler = Callable[[str, dict[str, Any]], tuple[list[str], list[dict[str, Any]]]]


class _FakeResult:
    def __init__(self, keys: list[str], records: list[dict[str, Any]]) -> None:
        self._keys = keys
        self._records = records

    def keys(self) -> list[str]:
        return self._keys

    def __iter__(self) -> Any:
        return iter(self._records)


class _FakeSession:
    def __init__(self, handler: Handler) -> None:
        self._handler = handler

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(
        self, cypher: str, params: dict[str, Any] | None = None
    ) -> _FakeResult:
        keys, records = self._handler(cypher, params or {})
        return _FakeResult(keys, records)


class _FakeDriver:
    def __init__(self, handler: Handler) -> None:
        self._handler = handler
        self.closed = False

    def session(self) -> _FakeSession:
        return _FakeSession(self._handler)

    def close(self) -> None:
        self.closed = True


def _live(handler: Handler, *, config: dict[str, Any] | None = CONFIG) -> Neo4jLive:
    """A live handle whose injected connect returns a fake driver."""

    def connect(
        cfg: Any = None, *, env: Any = None, **kwargs: Any
    ) -> _FakeDriver:
        return _FakeDriver(handler)

    return Neo4jLive(config=config, env=EMPTY_ENV, connect=connect)


def _raising_live(
    exc: Exception, *, config: dict[str, Any] | None = CONFIG
) -> Neo4jLive:
    def connect(cfg: Any = None, *, env: Any = None, **kwargs: Any) -> _FakeDriver:
        raise exc

    return Neo4jLive(config=config, env=EMPTY_ENV, connect=connect)


def _const_handler(
    keys: list[str], records: list[dict[str, Any]]
) -> Handler:
    """A handler that returns fixed *keys*/*records* for any query."""

    def handler(cypher: str, params: dict[str, Any]) -> tuple[
        list[str], list[dict[str, Any]]
    ]:
        return keys, records

    return handler


# --- Query parsing ----------------------------------------------------------


def test_load_queries_parses_shipped_cypher() -> None:
    queries = {q.name: q for q in load_queries()}

    assert "originates-from-region.cypher" in queries
    q = queries["originates-from-region.cypher"]
    # The leading // comment block is captured as the description.
    assert "originates from a given region" in q.description
    # The $param placeholders are extracted, in order and deduplicated.
    assert q.params == ("region_csid",)
    # Multi-param queries surface every placeholder.
    assert load_queries()  # non-empty
    assert queries["shortest-cultural-path.cypher"].params == (
        "start_csid",
        "end_csid",
    )


# --- Cypher console route ---------------------------------------------------


def test_console_lists_queries_when_unconfigured() -> None:
    # No password anywhere: the console still lists the shipped queries offline.
    live = Neo4jLive(config=None, env=EMPTY_ENV)
    client = TestClient(create_app(FIXTURE_ROOT, live=live))

    response = client.get("/neo4j")

    assert response.status_code == 200
    body = response.text
    assert "originates-from-region.cypher" in body
    assert "No live database configured" in body


def test_console_runs_a_query_against_the_mocked_driver() -> None:
    def handler(
        cypher: str, params: dict[str, Any]
    ) -> tuple[list[str], list[dict[str, Any]]]:
        assert params == {"region_csid": "cs:place:andes"}
        return (
            ["csid", "name", "region"],
            [{"csid": "cs:dish:ceviche", "name": "Ceviche", "region": "Andes"}],
        )

    client = TestClient(create_app(FIXTURE_ROOT, live=_live(handler)))

    response = client.get(
        "/neo4j",
        params={
            "query": "originates-from-region.cypher",
            "region_csid": "cs:place:andes",
            "run": "1",
        },
    )

    assert response.status_code == 200
    body = response.text
    # The returned row and its column headers are rendered.
    assert "cs:dish:ceviche" in body
    assert "Ceviche" in body
    assert "Andes" in body
    assert "1 row" in body


def test_console_renders_an_empty_result() -> None:
    handler = _const_handler(["csid", "name"], [])
    client = TestClient(create_app(FIXTURE_ROOT, live=_live(handler)))

    body = client.get(
        "/neo4j",
        params={"query": "contemporary-with.cypher", "csid": "cs:x", "run": "1"},
    ).text

    assert "No rows returned" in body


def test_console_degrades_when_driver_absent() -> None:
    live = _raising_live(Neo4jDriverNotInstalled())
    client = TestClient(create_app(FIXTURE_ROOT, live=live))

    response = client.get(
        "/neo4j",
        params={
            "query": "originates-from-region.cypher",
            "region_csid": "cs:place:andes",
            "run": "1",
        },
    )

    # The rest of the app keeps working; the failure is shown, not raised.
    assert response.status_code == 200
    assert "pinakes_engine[neo4j]" in response.text


def test_console_degrades_on_connection_failure() -> None:
    live = _raising_live(RuntimeError("connection refused"))
    client = TestClient(create_app(FIXTURE_ROOT, live=live))

    response = client.get(
        "/neo4j",
        params={
            "query": "originates-from-region.cypher",
            "region_csid": "cs:place:andes",
            "run": "1",
        },
    )

    assert response.status_code == 200
    assert "Could not reach Neo4j" in response.text


# --- Graph view backed by the live database ---------------------------------


def _graph_handler(
    cypher: str, params: dict[str, Any]
) -> tuple[list[str], list[dict[str, Any]]]:
    """Replay a tiny live graph: a center node with one neighbor and one edge."""
    if "labels(n)" in cypher:  # the neighborhood-node query
        assert params["csid"] == "cs:place:lima"
        return (
            ["csid", "name", "labels"],
            [
                {
                    "csid": "cs:place:lima",
                    "name": "Lima",
                    "labels": ["Place", ENTITY_LABEL],
                },
                {
                    "csid": "cs:dish:ceviche",
                    "name": "Ceviche",
                    "labels": ["Dish", ENTITY_LABEL],
                },
            ],
        )
    # the edge query
    assert set(params["ids"]) == {"cs:place:lima", "cs:dish:ceviche"}
    return (
        ["start", "end", "type"],
        [
            {
                "start": "cs:dish:ceviche",
                "end": "cs:place:lima",
                "type": "LOCATED_IN",
            }
        ],
    )


def test_graph_api_uses_live_database_when_configured() -> None:
    client = TestClient(create_app(FIXTURE_ROOT, live=_live(_graph_handler)))

    payload = client.get("/api/graph/cs:place:lima", params={"depth": 1}).json()

    assert payload["backend"] == "neo4j"
    by_id = {n["data"]["id"]: n["data"] for n in payload["nodes"]}
    assert set(by_id) == {"cs:place:lima", "cs:dish:ceviche"}
    # The Entity anchor is dropped; the primary type label drives colour.
    assert by_id["cs:place:lima"]["label"] == "Place"
    assert by_id["cs:place:lima"]["center"] is True
    # The single edge is styled on its ontology dimension.
    (edge,) = payload["edges"]
    assert edge["data"]["type"] == "LOCATED_IN"
    assert edge["data"]["dimension"] == "geographic"


def test_graph_api_live_404s_for_unknown_csid() -> None:
    handler = _const_handler(["csid", "name", "labels"], [])  # no node matched
    client = TestClient(create_app(FIXTURE_ROOT, live=_live(handler)))

    response = client.get("/api/graph/cs:does:not-exist")

    assert response.status_code == 404
    assert "unknown csid" in response.json()["error"]


def test_graph_api_falls_back_to_tsv_on_live_failure() -> None:
    # Configured, but the driver cannot connect: the TSV neighborhood answers.
    live = _raising_live(RuntimeError("connection refused"))
    client = TestClient(create_app(FIXTURE_ROOT, live=live))

    payload = client.get("/api/graph/cs:place:lima", params={"depth": 1}).json()

    assert payload["backend"] == "tsv"
    by_id = {n["data"]["id"] for n in payload["nodes"]}
    assert "cs:place:lima" in by_id


def test_graph_api_uses_tsv_when_unconfigured() -> None:
    live = Neo4jLive(config=None, env=EMPTY_ENV)
    client = TestClient(create_app(FIXTURE_ROOT, live=live))

    payload = client.get("/api/graph/cs:place:lima", params={"depth": 1}).json()

    assert payload["backend"] == "tsv"


def test_graph_view_reports_its_backend() -> None:
    live_client = TestClient(create_app(FIXTURE_ROOT, live=_live(_graph_handler)))
    assert "Neo4j" in live_client.get("/graph").text

    tsv_client = TestClient(
        create_app(FIXTURE_ROOT, live=Neo4jLive(config=None, env=EMPTY_ENV))
    )
    assert "canonical TSV" in tsv_client.get("/graph").text


def test_driver_is_closed_after_a_query() -> None:
    drivers: list[_FakeDriver] = []

    def connect(cfg: Any = None, *, env: Any = None, **kwargs: Any) -> _FakeDriver:
        driver = _FakeDriver(lambda c, p: (["n"], [{"n": "1"}]))
        drivers.append(driver)
        return driver

    live = Neo4jLive(config=CONFIG, env=EMPTY_ENV, connect=connect)
    live.run("RETURN 1 AS n")

    assert drivers and all(d.closed for d in drivers)
