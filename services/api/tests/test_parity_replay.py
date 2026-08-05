"""Recorded Express responses, replayed against this service.

`contracts/parity/README.md` §2: a route group counts as ported when it passes
the *same* fixtures that grade the Express app. This is that replay — the
Python-side twin of `contracts/parity/parity.test.ts`, sharing its fixtures and
its matching rules (`tests/parity_shape.py`).

It selects itself: every fixture whose route the app has registered is graded,
and every fixture whose route is still a 501 stub is skipped with that named as
the reason. So a port tasklist inherits this gate by landing its router — there
is no list here to remember to extend.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contracts_dir

from conftest import coverage_of
from parity_shape import ParityFixture, load_fixtures, replay, report
from pinakes import paths
from pinakes.parity import load_parity_routes
from pinakes.paths import parity_spec_path

FIXTURES_DIR: Path = parity_spec_path().parent / "fixtures"
FIXTURES: tuple[ParityFixture, ...] = load_fixtures(FIXTURES_DIR)

#: Fixture id → the baseline operation it was recorded against.
#:
#: A fixture names its route the way *Express* templates one (`/api/entity/
#: :domain/:id`) and the spec names it the way OpenAPI (and FastAPI) does
#: (`/api/entity/{domain}/{id}`), so the two strings never match for a
#: parameterized route. The link that does hold in both directions is the spec's
#: own `x-pinakes-parity.fixtures` list, which is what this reads. Comparing the
#: raw strings instead silently *skipped* every fixture with a path parameter —
#: green either way, which is exactly the failure `GRADED` exists to catch.
OPERATION_OF: dict[str, tuple[str, str]] = {
    fixture_id: route.key
    for route in load_parity_routes()
    for fixture_id in route.fixtures
}


@pytest.fixture(autouse=True)
def live_corpus(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Replay against the corpus the fixtures were recorded against.

    `conftest.py`'s autouse `isolated_data_trees` points every data tree at an
    empty temp directory, which is right for anything that *writes* — but a
    recording of `/api/entity/language/cmn` cannot be reproduced by a service
    with no languages, and would grade as a 404 against a 200. Every entry in
    `contracts/parity/requests.json` is required to be side-effect free, so
    reading the real corpus here is safe; nothing in this file makes a request
    that writes.
    """
    monkeypatch.setenv(
        paths.LEXICONS_DIR_ENV, str(contracts_dir().parent / paths.LEXICONS_RELPATH)
    )
    yield


def test_the_fixtures_are_where_the_baseline_says_they_are() -> None:
    """A silent zero-fixture run would look exactly like a passing one."""
    assert FIXTURES, f"no recorded fixtures under {FIXTURES_DIR}"


def test_every_fixture_binds_to_an_operation_in_the_spec() -> None:
    """An unlinked fixture would skip forever and never say so."""
    unlinked = [fixture.id for fixture in FIXTURES if fixture.id not in OPERATION_OF]
    assert not unlinked, (
        f"fixtures no baseline operation claims: {unlinked} — regenerate the spec "
        "(npx tsx scripts/gen-parity-spec.ts)"
    )


@pytest.mark.parametrize(
    "fixture", FIXTURES, ids=[fixture.id for fixture in FIXTURES]
)
def test_a_ported_route_still_answers_its_recorded_shape(
    unbuilt_client: TestClient, fixture: ParityFixture
) -> None:
    ported = {route.key for route in coverage_of(unbuilt_client).ported}
    operation = OPERATION_OF.get(fixture.id, (fixture.method, fixture.route))
    if operation not in ported:
        pytest.skip(f"{operation[0]} {operation[1]} is not ported yet (501)")
    mismatches = replay(fixture, unbuilt_client)
    assert not mismatches, report(fixture, mismatches)


#: Fixtures a landed port claims as its grade. Each entry is one port tasklist
#: saying "this recording is replayed against my router" — without them the
#: parametrized test above would pass just as green with every case skipped,
#: which is what "ported" would then be resting on.
GRADED: tuple[str, ...] = (
    "get-graph-status",  # pinakes:50 US-2
    "get-contributions-stats",  # pinakes:60 US-1
    "get-citations-index",  # pinakes:61 US-2
    "get-entities",  # pinakes:63 US-1
    "get-entity",  # pinakes:63 US-1
    "get-summaries-index",  # pinakes:63 US-1
    "get-summaries-domain",  # pinakes:63 US-1
    "get-search",  # pinakes:63 US-2
    "get-kcb-manifest",  # pinakes:65 US-1
    "post-graph-explain-invalid",  # pinakes:65 US-2
    "post-timeline-event-invalid",  # pinakes:65 US-2
    "get-language-families",  # pinakes:80 US-1
    "get-languages",  # pinakes:80 US-1
    "get-language-by-id",  # pinakes:80 US-1
    "get-language-missing",  # pinakes:80 US-1
    "get-culture-profiles",  # pinakes:80 US-1
    "get-culture-profile-by-id",  # pinakes:80 US-1
    "get-map-civilizations",  # pinakes:80 US-1
    "get-map-civilizations-viewport",  # pinakes:80 US-1
    "get-scraping-jobs",  # pinakes:80 US-1
)


@pytest.mark.parametrize("fixture_id", GRADED)
def test_a_ported_group_is_actually_being_graded(
    unbuilt_client: TestClient, fixture_id: str
) -> None:
    ported = {route.key for route in coverage_of(unbuilt_client).ported}
    graded = {
        fixture.id
        for fixture in FIXTURES
        if OPERATION_OF.get(fixture.id, (fixture.method, fixture.route)) in ported
    }
    assert fixture_id in graded
