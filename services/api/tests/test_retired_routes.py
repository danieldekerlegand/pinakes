"""The retired acquisition routes (pinakes:80 US-1).

Thirty-one paths whose capability is `pinakes_engine fetch`, not an endpoint.
What these assert is that the *answer* survived the port: same status, same
discriminator, same actionable command — and that the routes left the
`not_ported` catalog, which is the only reason the coverage number moved.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import coverage_of
from pinakes.not_implemented import NOT_IMPLEMENTED_ERROR
from pinakes.paths import repo_root
from pinakes.routers.retired import (
    ACQUISITION_RETIRED_TO,
    MIGRATION_TABLE,
    RETIRED_ERROR,
    RETIRED_ROUTES,
    RETIRED_STATUS,
    retired_body,
)

#: Concrete URLs for the two templated rows, so a request can actually be made.
_URLS = {
    "/api/enrichment/culture-profiles/jobs/{id}": (
        "/api/enrichment/culture-profiles/jobs/abc"
    ),
    "/api/enrichment/jobs/{id}": "/api/enrichment/jobs/abc",
}


def _url(path: str) -> str:
    return _URLS.get(path, path)


def test_the_table_is_the_whole_retired_surface() -> None:
    """Thirty-one routes, no duplicates. The count is the statement pinakes:70
    made on the Express side; a row lost in a rebase would otherwise just look
    like a route that was never claimed."""
    assert len(RETIRED_ROUTES) == 31
    keys = [(method, path) for method, path, _, _ in RETIRED_ROUTES]
    assert len(set(keys)) == len(keys)


@pytest.mark.parametrize(
    ("method", "path", "express_route", "categories"),
    [pytest.param(*row, id=f"{row[0]} {row[1]}") for row in RETIRED_ROUTES],
)
def test_each_retired_route_answers_501_retired(
    unbuilt_client: TestClient,
    method: str,
    path: str,
    express_route: str,
    categories: tuple[str, ...],
) -> None:
    response = unbuilt_client.request(method, _url(path))
    assert response.status_code == RETIRED_STATUS
    assert response.json() == retired_body(express_route, categories)


def test_the_body_is_retired_not_ported_and_not_not_ported(
    unbuilt_client: TestClient,
) -> None:
    """Three 501s exist in this service and they mean different things.

    `not_ported` sends the caller to the TypeScript backend, `ported` sends it to
    another path here — and for these routes both would be a lie, because the
    capability is a CLI now. Getting this wrong is invisible in the status code.
    """
    body = unbuilt_client.post("/api/scraping/glottolog").json()
    assert body["error"] == RETIRED_ERROR
    assert body["error"] != NOT_IMPLEMENTED_ERROR
    assert "no longer scrapes" in body["message"]
    assert body["acquiredBy"] == ACQUISITION_RETIRED_TO
    assert body["migrationTable"] == MIGRATION_TABLE
    assert body["run"] == ["pinakes_engine fetch inputs/categories/glottolog.yml"]


def test_a_generic_top_up_route_names_no_category(unbuilt_client: TestClient) -> None:
    """`categories` is empty only where the replacement is the generation adapter
    itself rather than any one spec — the command then shows a placeholder rather
    than pretending there is a spec to run."""
    body = unbuilt_client.post("/api/enrichment/batch").json()
    assert body["categories"] == []
    assert body["run"] == ["pinakes_engine fetch inputs/categories/<category>.yml"]


def test_the_route_field_keeps_the_express_spelling(
    unbuilt_client: TestClient,
) -> None:
    """`route` is prose naming the retired route as it was recorded, so it keeps
    `:id`; the *registration* is the `{id}` template, because that literal is
    what the parity diff matches. Conflating the two moves the coverage number
    the wrong way and nothing else notices."""
    body = unbuilt_client.get("/api/enrichment/jobs/abc").json()
    assert body["route"] == "GET /api/enrichment/jobs/:id"
    assert "{id}" not in body["message"]


def test_every_named_category_spec_exists() -> None:
    """The actionable half has to be actionable.

    This is the same guard `engine/tests/test_scraper_migration.py` makes about
    the module table, made about the *route* table — and it is the one that
    outlives `server/`, which is where these strings were copied from.
    """
    categories = repo_root() / "engine" / "inputs" / "categories"
    missing = sorted(
        {
            identifier
            for _, _, _, ids in RETIRED_ROUTES
            for identifier in ids
            if not (categories / f"{identifier}.yml").is_file()
        }
    )
    assert missing == []


def test_the_retired_routes_are_ported_not_stubbed(unbuilt_client: TestClient) -> None:
    """They must be gone from the 501 catalog, or both would be registered and
    the coverage number would still count them outstanding."""
    coverage = coverage_of(unbuilt_client)
    ported = {route.key for route in coverage.ported}
    unported = {route.key for route in coverage.unported}
    for method, path, _, _ in RETIRED_ROUTES:
        assert (method, path) in ported, f"{method} {path} is not registered"
        assert (method, path) not in unported
