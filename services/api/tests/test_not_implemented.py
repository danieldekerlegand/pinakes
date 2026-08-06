"""The 501 catalog and the coverage it makes trackable."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import coverage_of
from pinakes.not_implemented import NOT_IMPLEMENTED_ERROR, NOT_IMPLEMENTED_STATUS
from pinakes.parity import ParityRoute, load_parity_routes, split_coverage

#: Concrete URLs standing in for templated baseline routes, chosen across
#: methods and port units. The value is that they are *client* URLs — the shapes
#: the React app actually asks for. Keep them **unported**: a route that lands a
#: router stops being a 501 and belongs in that group's own test instead.
SAMPLE_REQUESTS = [
    # Were `/api/languages` + `/api/languages/{id}` until pinakes:80 US-1 ported
    # them (coverage: `test_catalog_routes.py`), then `/api/media-assets` +
    # `/api/media-assets/{id}` until its seventh slice (`test_media_routes.py`).
    # `/api/openapi.json` is the **last** route the cutover ports — it goes with
    # US-2, because porting it decides whether `openapi-spec.test.ts`'s
    # byte-equal snapshot moves too — so this pair should not need repointing
    # again before the Express backend is deleted outright.
    ("GET", "/api/openapi.json", "/api/openapi.json"),
    # `/api/openapi.json` takes no path parameter, so a *templated* stand-in has
    # to sit beside it — that is the whole job of this second entry. Was
    # `/api/export/datasets/{id}` until pinakes:80 US-1's ninth slice ported the
    # publication group (`test_export_routes.py`). Only two templated routes are
    # left unported at all, and both are the confirm/verification pair below.
    ("POST", "/api/contributions/{id}/confirm", "/api/contributions/nope/confirm"),
    # Was `POST /api/scraping-jobs` until pinakes:80 US-1's fifth slice ported
    # the scraper dashboard, then `POST /api/text-analysis/compare` until its
    # tenth — `test_scraping_routes.py` and `test_text_analysis_routes.py`.
    ("POST", "/api/scraping/mythology", "/api/scraping/mythology"),
    # Was `/api/summaries/{domain}` until pinakes:63 US-1 ported it, then
    # `/api/religions` until pinakes:80 US-1's second slice and `/api/haplogroups`
    # until its fourth — a sample here has to name a route that is still
    # *un*ported, or the 501 assertion goes red the day the group lands. Those
    # groups' own coverage is `test_summary_routes.py`, `test_domain_routes.py`
    # and `test_ethnography_routes.py`. Then `/api/media/prompts` until the
    # seventh slice and `/api/visualizations/chord` until the tenth —
    # `test_media_routes.py` and `test_visualization_routes.py`. There is no
    # concrete unported GET left to name: `/api/openapi.json` is already the
    # entry above, and `/api/languages/preservation` was never usable here
    # either — it was **shadowed** by `catalog.py`'s `/api/languages/{id}` and
    # 404'd rather than 501ing, and the eleventh slice ported it
    # (`test_preservation_routes.py`). The verification read is the honest
    # stand-in, templated like its POST sibling.
    (
        "GET",
        "/api/contributions/{id}/verification",
        "/api/contributions/nope/verification",
    ),
    # Was `/api/graph/resolve` + `/.well-known/kcb-manifest.json` until
    # pinakes:65 US-1 ported them; their coverage is `test_graph_routes.py` and
    # `test_capability_bus.py`. Then `/api/graph/explain` +
    # `/api/ancestry/haplogroups` went the same way in US-2 —
    # `test_connection_narrative.py` and `test_ancestry.py`.
    # Was `/api/cross-domain/timeline` until pinakes:80 US-1's sixth slice; its
    # coverage is `test_cross_domain_routes.py`. Picked from the *back* of the
    # remaining port order — confirm/verification is the last third of a group
    # pinakes:61 split deliberately, and lands near the end of the cutover.
    (
        "GET",
        "/api/contributions/{id}/verification",
        "/api/contributions/nonexistent/verification",
    ),
    # Was `/api/empires-timeline` until pinakes:80 US-1's third slice ported the
    # geospatial corpus and `/api/linguistic-distance/available-languages` until
    # its eighth; their coverage is `test_map_routes.py` and
    # `test_linguistic_distance.py`. `/api/openapi.json` is the end of the port
    # order by construction — it ports with US-2, because doing so decides
    # whether `openapi-spec.test.ts`'s byte-equal snapshot moves too — so this
    # chore should not recur again.
    ("GET", "/api/openapi.json", "/api/openapi.json"),
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


def test_501_body_carries_the_grading_metadata(unbuilt_client: TestClient) -> None:
    """A porter needs to know what will grade the port, from the 501 itself."""
    body = unbuilt_client.get("/api/openapi.json").json()
    assert body["portUnit"] == "openapi.json"
    assert body["clientUsed"] is True
    assert body["parityFixtures"] == []


def test_no_outstanding_route_still_carries_a_recorded_fixture(
    unbuilt_client: TestClient,
) -> None:
    """Every recorded parity fixture now belongs to a **ported** route.

    This assertion used to be the other way round: `test_501_body_carries_the
    _grading_fixtures` read `parityFixtures` off a 501 to prove a porter is told
    what will grade the port. `get-scraping-jobs` was the last recording whose
    route was outstanding, and pinakes:80 US-1's fifth slice ported it — so the
    list is empty by construction now, and the useful statement is that it
    *stays* empty.

    What it means for the cutover: the routes still outstanding are the ones no
    fixture was ever recorded for, so a porter's grading is their own test file,
    not a replay. Should a future `npm run parity:record` add a recording for an
    outstanding route, this goes red and says which — which is the moment to put
    it back in `GRADED` instead.
    """
    outstanding = {
        route.describe(): list(route.fixtures)
        for route in coverage_of(unbuilt_client).unported
        if route.fixtures
    }
    assert outstanding == {}


def test_the_method_matters(unbuilt_client: TestClient) -> None:
    """A method the baseline never served is a 405, not a 501 promise."""
    assert unbuilt_client.delete("/api/languages").status_code == 405


def test_coverage_endpoint_matches_the_catalog(unbuilt_client: TestClient) -> None:
    payload = unbuilt_client.get("/api/_parity/coverage").json()
    assert payload["total"] == payload["ported"] + payload["unported"]
    assert len(payload["notImplemented"]) == payload["unported"]
    assert payload["spec"].endswith("openapi.json")

    entry = next(
        item
        for item in payload["notImplemented"]
        if item["path"] == "/api/openapi.json"
    )
    assert entry["portUnit"] == "openapi.json"
    assert entry["method"] == "GET"

    # Port units add up to the same total, so progress is trackable per group.
    per_unit = sum(unit["ported"] + unit["unported"] for unit in payload["byPortUnit"])
    assert per_unit == payload["total"]


def test_a_ported_route_leaves_the_catalog(unbuilt_client: TestClient) -> None:
    """The catalog is the *complement* of the routing table, not a second list.

    Landing a router has to remove its stubs and move the coverage number in one
    step; if the two could disagree, the number would be the thing that lies.
    """
    coverage = coverage_of(unbuilt_client)
    ported = {route.key for route in coverage.ported}
    assert ("GET", "/api/graph/search") in ported

    stubbed = {route.key for route in coverage.unported}
    assert ported.isdisjoint(stubbed)

    payload = unbuilt_client.get("/api/_parity/coverage").json()
    assert payload["portedFraction"] == len(coverage.ported) / coverage.total
    assert all(
        entry["path"] != "/api/graph/search" for entry in payload["notImplemented"]
    )


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
