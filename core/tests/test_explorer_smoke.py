"""End-to-end smoke test for every explorer route (T7-US-012).

A single offline pass that drives every HTTP route the explorer serves with
FastAPI's TestClient — no live server, no live Neo4j, no ``swipl`` — against the
shipped fixture corpus, asserting each returns 200 with the content the matching
view in ``docs/gui.md`` promises. It is the guardrail that keeps the documented
walkthrough from silently rotting: add a route, document it, cover it here.
"""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from culturescrape.explorer import create_app  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
#: The full job output root fixture: corpus/ TSV plus catalog/metrics/qa.
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "explorer-corpus"

#: Every HTML route, with params and the content each view must render. The
#: tour mirrors docs/gui.md: overview, tables, completeness, metrics, graph,
#: Neo4j, and Datalog, plus search and the per-entity detail and action pages.
ROUTES: tuple[tuple[str, dict[str, str], tuple[str, ...]], ...] = (
    ("/", {}, ("culture-scrape explorer", "Overview", "Datalog")),
    ("/search", {}, ('name="q"',)),
    ("/search", {"q": "ceviche"}, ("Ceviche", "/nodes/cs:dish:ceviche")),
    ("/nodes", {}, ("csid:ID", "Ceviche")),
    ("/nodes", {"label": "Place"}, ("Lima",)),
    ("/nodes/cs:place:lima", {}, ("Lima", "Outgoing edges", "Incoming edges")),
    ("/edges", {}, ("LOCATED_IN",)),
    ("/edges", {"type": "LOCATED_IN"}, ("LOCATED_IN", "/nodes/cs:place:lima")),
    ("/completeness", {}, ("peruvian-dishes", "andean-context")),
    (
        "/completeness/peruvian-dishes",
        {},
        ("culturescrape run jobs/", "culturescrape package"),
    ),
    ("/metrics", {}, ("components", "geographic", "LOCATED_IN")),
    ("/graph", {}, ("cytoscape", "data-csid=")),
    (
        "/graph",
        {"csid": "cs:place:lima"},
        ('data-csid="cs:place:lima"', "/nodes/cs:place:lima"),
    ),
    ("/neo4j", {}, ("Neo4j", "cypher/*.cypher")),
    ("/neo4j", {"csid": "cs:place:lima"}, ("MATCH (n:Entity", "Lima")),
    ("/datalog", {}, ("ancestry-of-dish.pl", "Full ancestry of a dish")),
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    """A TestClient bound to the fixture corpus, shared across the smoke pass."""
    return TestClient(create_app(FIXTURE_ROOT))


@pytest.mark.parametrize(
    ("path", "params", "expected"),
    ROUTES,
    ids=[f"{path}?{'&'.join(params)}" for path, params, _ in ROUTES],
)
def test_route_returns_200_with_expected_content(
    client: TestClient,
    path: str,
    params: dict[str, str],
    expected: tuple[str, ...],
) -> None:
    response = client.get(path, params=params)

    assert response.status_code == 200, f"{path} -> {response.status_code}"
    body = response.text
    for fragment in expected:
        assert fragment in body, f"{path} missing {fragment!r}"


def test_graph_neighborhood_api_returns_self_contained_json(
    client: TestClient,
) -> None:
    response = client.get("/api/graph/cs:place:lima", params={"depth": 1})

    assert response.status_code == 200
    payload = response.json()
    assert payload["center"] == "cs:place:lima"
    assert payload["backend"] == "tsv"  # no live Neo4j configured
    ids = {n["data"]["id"] for n in payload["nodes"]}
    # Every edge endpoint is in the node set, so Cytoscape can draw it.
    assert all(
        e["data"]["source"] in ids and e["data"]["target"] in ids
        for e in payload["edges"]
    )
