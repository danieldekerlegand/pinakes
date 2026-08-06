"""The 501 catalog, and the coverage that made it trackable.

**The catalog is empty.** pinakes:80 US-1 ported the last three baseline routes,
so every one of the 306 is served here and `/api/_parity/coverage` reports
306/306. That is what most of this file now asserts.

The catalog's *machinery* is still live code — it is what would answer if a
future baseline grew a route this service does not serve, and it is the thing
that makes such a gap loud rather than a 404 — so it is still exercised, against
a **synthetic** one-route spec handed to :func:`~pinakes.app.create_app`. Every
test below that used to name a concrete unported URL now names one of these two
things instead: the real spec's emptiness, or the synthetic spec's stub. There
is no third option left, and the recurring "repoint the stand-in" chore that ran
through twelve slices of this band is over by construction.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import coverage_of
from pinakes.app import create_app
from pinakes.not_implemented import NOT_IMPLEMENTED_ERROR, NOT_IMPLEMENTED_STATUS
from pinakes.parity import ParityRoute, load_parity_routes, split_coverage

#: A baseline route no router will ever register: the path is not under `/api`,
#: and nothing in this service claims it. Held apart from the real spec so the
#: catalog's behaviour can be asserted without a real gap in coverage — which
#: there is no longer any way to arrange.
PHANTOM_METHOD = "GET"
PHANTOM_PATH = "/phantom/{id}/never-ported"
PHANTOM_UNIT = "phantom"
PHANTOM_SOURCE = "server/routes/phantom.ts"
PHANTOM_FIXTURE = "get-phantom"


@pytest.fixture
def phantom_spec(tmp_path: Path) -> Path:
    """A one-route parity baseline, written to disk the way the real one is."""
    spec = {
        "openapi": "3.0.3",
        "info": {"title": "phantom baseline", "version": "0.0.0"},
        "paths": {
            PHANTOM_PATH: {
                PHANTOM_METHOD.lower(): {
                    "operationId": "get-phantom-never-ported",
                    "tags": [PHANTOM_UNIT],
                    "responses": {"default": {"description": "unrecorded"}},
                    "x-pinakes-parity": {
                        "source": PHANTOM_SOURCE,
                        "clientUsed": True,
                        "fixtures": [PHANTOM_FIXTURE],
                    },
                }
            }
        },
    }
    path = tmp_path / "phantom-openapi.json"
    path.write_text(json.dumps(spec), encoding="utf-8")
    return path


@pytest.fixture
def phantom_client(phantom_spec: Path, tmp_path: Path) -> TestClient:
    """An app whose baseline is the phantom spec — one outstanding route."""
    app = create_app(
        client_directory=tmp_path / "no-dist", parity_spec=phantom_spec
    )
    return TestClient(app)


# ── The real baseline: nothing is outstanding ────────────────────────────────


def test_every_baseline_route_is_registered(
    unbuilt_client: TestClient, baseline_routes: tuple[ParityRoute, ...]
) -> None:
    """The cutover's finish line: the app serves all 306, and none is a stub."""
    coverage = coverage_of(unbuilt_client)
    assert coverage.total == len(baseline_routes)
    assert coverage.unported == ()
    assert {route.key for route in coverage.ported} == {
        route.key for route in baseline_routes
    }


def test_the_coverage_endpoint_reports_a_complete_port(
    unbuilt_client: TestClient,
) -> None:
    payload = unbuilt_client.get("/api/_parity/coverage").json()
    assert payload["total"] == payload["ported"]
    assert payload["unported"] == 0
    assert payload["notImplemented"] == []
    assert payload["portedFraction"] == 1.0
    assert payload["spec"].endswith("openapi.json")

    # Port units still add up to the same total, so the per-group view a port
    # tasklist read is still readable — it just reports zero outstanding.
    per_unit = sum(unit["ported"] + unit["unported"] for unit in payload["byPortUnit"])
    assert per_unit == payload["total"]
    assert all(unit["unported"] == 0 for unit in payload["byPortUnit"])


def test_no_recorded_fixture_belongs_to_an_outstanding_route(
    unbuilt_client: TestClient,
) -> None:
    """Vacuously true now, and worth keeping as the thing that says so.

    It began as `test_501_body_carries_the_grading_fixtures`, reading
    `parityFixtures` off a live 501 to prove a porter is told what will grade
    their port. The last fixture-bearing outstanding route was ported in this
    band's fifth slice and the last outstanding route at all in its thirteenth.
    Should a future `npm run parity:record` add a route this service does not
    serve, the emptiness assertion above is what goes red first; this one says
    which recording was involved.
    """
    outstanding = {
        route.describe(): list(route.fixtures)
        for route in coverage_of(unbuilt_client).unported
    }
    assert outstanding == {}


def test_the_method_matters(unbuilt_client: TestClient) -> None:
    """A method the baseline never served is a 405, not a promise of anything."""
    assert unbuilt_client.delete("/api/languages").status_code == 405


# ── The catalog's machinery, against a synthetic baseline ────────────────────


def test_an_outstanding_route_answers_501(phantom_client: TestClient) -> None:
    response = phantom_client.request(
        PHANTOM_METHOD, "/phantom/abc/never-ported"
    )
    assert response.status_code == NOT_IMPLEMENTED_STATUS
    body = response.json()
    assert body["error"] == NOT_IMPLEMENTED_ERROR
    assert body["method"] == PHANTOM_METHOD
    assert body["path"] == PHANTOM_PATH
    assert body["source"] == PHANTOM_SOURCE
    assert body["coverage"] == "/api/_parity/coverage"
    assert "has not been ported" in body["message"]


def test_the_501_body_carries_the_grading_metadata(
    phantom_client: TestClient,
) -> None:
    """A porter has to be able to read what will grade the port off the 501."""
    body = phantom_client.request(PHANTOM_METHOD, "/phantom/abc/never-ported").json()
    assert body["portUnit"] == PHANTOM_UNIT
    assert body["clientUsed"] is True
    assert body["parityFixtures"] == [PHANTOM_FIXTURE]


def test_a_synthetic_gap_is_visible_in_coverage(phantom_client: TestClient) -> None:
    payload = phantom_client.get("/api/_parity/coverage").json()
    assert payload["total"] == 1
    assert payload["unported"] == 1
    entry = payload["notImplemented"][0]
    assert entry["path"] == PHANTOM_PATH
    assert entry["portUnit"] == PHANTOM_UNIT


def test_the_real_routers_still_answer_beside_a_synthetic_baseline(
    phantom_client: TestClient,
) -> None:
    """The spec decides the *catalog*, never the routing table.

    A future baseline that dropped a route must not un-serve it — coverage is a
    diff, and the app's own routers are the left side of it.
    """
    assert phantom_client.get("/api/health").status_code == 200
    assert phantom_client.get("/api/openapi.json").status_code == 200


# ── The diff itself ──────────────────────────────────────────────────────────


def test_a_ported_route_leaves_the_catalog(unbuilt_client: TestClient) -> None:
    """The catalog is the *complement* of the routing table, not a second list.

    Landing a router removes its stub and moves the coverage number in one step;
    if the two could disagree, the number would be the thing that lies.
    """
    coverage = coverage_of(unbuilt_client)
    ported = {route.key for route in coverage.ported}
    assert ("GET", "/api/graph/search") in ported
    assert ported.isdisjoint({route.key for route in coverage.unported})


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
