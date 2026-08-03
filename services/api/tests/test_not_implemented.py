"""The 501 catalog and the coverage it makes trackable."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import coverage_of
from pinakes.not_implemented import NOT_IMPLEMENTED_ERROR, NOT_IMPLEMENTED_STATUS
from pinakes.parity import ParityRoute, load_parity_routes, split_coverage

#: Concrete URLs standing in for templated baseline routes, chosen across
#: methods and port units. The value is that they are *client* URLs — the shapes
#: the React app actually asks for.
SAMPLE_REQUESTS = [
    ("GET", "/api/languages", "/api/languages"),
    ("GET", "/api/languages/{id}", "/api/languages/lang-42"),
    ("POST", "/api/scraping-jobs", "/api/scraping-jobs"),
    ("GET", "/api/summaries/{domain}", "/api/summaries/religions"),
    ("GET", "/api/graph/status", "/api/graph/status"),
    ("GET", "/.well-known/kcb-manifest.json", "/.well-known/kcb-manifest.json"),
]


def test_every_baseline_route_is_registered_or_stubbed(
    unbuilt_client: TestClient, baseline_routes: tuple[ParityRoute, ...]
) -> None:
    """No baseline route may simply be missing — the shell answers for all 306."""
    coverage = coverage_of(unbuilt_client)
    assert coverage.total == len(baseline_routes)
    covered = {route.key for route in coverage.ported} | {
        route.key for route in coverage.unported
    }
    assert covered == {route.key for route in baseline_routes}


@pytest.mark.parametrize(("method", "template", "url"), SAMPLE_REQUESTS)
def test_unported_routes_answer_501(
    unbuilt_client: TestClient, method: str, template: str, url: str
) -> None:
    response = unbuilt_client.request(method, url)
    assert response.status_code == NOT_IMPLEMENTED_STATUS
    body = response.json()
    assert body["error"] == NOT_IMPLEMENTED_ERROR
    assert body["method"] == method
    assert body["path"] == template
    assert body["source"].startswith("server/")
    assert body["coverage"] == "/api/_parity/coverage"
    assert "has not been ported" in body["message"]


def test_501_body_carries_the_grading_fixtures(unbuilt_client: TestClient) -> None:
    """A porter needs to know what will grade the port, from the 501 itself."""
    body = unbuilt_client.get("/api/scraping-jobs").json()
    assert body["portUnit"] == "scraping-jobs"
    assert body["parityFixtures"] == ["get-scraping-jobs"]
    assert body["clientUsed"] is True


def test_the_method_matters(unbuilt_client: TestClient) -> None:
    """A method the baseline never served is a 405, not a 501 promise."""
    assert unbuilt_client.delete("/api/languages").status_code == 405


def test_coverage_endpoint_matches_the_catalog(unbuilt_client: TestClient) -> None:
    payload = unbuilt_client.get("/api/_parity/coverage").json()
    assert payload["total"] == payload["ported"] + payload["unported"]
    assert len(payload["notImplemented"]) == payload["unported"]
    assert payload["spec"].endswith("openapi.json")

    entry = next(
        item for item in payload["notImplemented"] if item["path"] == "/api/languages"
    )
    assert entry["portUnit"] == "languages"
    assert entry["method"] == "GET"

    # Port units add up to the same total, so progress is trackable per group.
    per_unit = sum(
        unit["ported"] + unit["unported"] for unit in payload["byPortUnit"]
    )
    assert per_unit == payload["total"]


def test_nothing_is_ported_yet(unbuilt_client: TestClient) -> None:
    """The shell ports no route group; that is the next tasklist's job."""
    coverage = coverage_of(unbuilt_client)
    assert coverage.ported == ()
    assert unbuilt_client.get("/api/_parity/coverage").json()["portedFraction"] == 0.0


def test_split_coverage_matches_on_method_and_template() -> None:
    routes = load_parity_routes()
    target = next(route for route in routes if route.key == ("GET", "/api/languages"))

    ported = split_coverage(routes, {target.key})
    assert target in ported.ported

    # Same path, different method — and a renamed path parameter — must not count.
    assert target in split_coverage(routes, {("POST", "/api/languages")}).unported
    renamed = next(
        route for route in routes if route.key == ("GET", "/api/languages/{id}")
    )
    assert (
        renamed
        in split_coverage(routes, {("GET", "/api/languages/{language_id}")}).unported
    )
