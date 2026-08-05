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

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import coverage_of
from parity_shape import ParityFixture, load_fixtures, replay, report
from pinakes.paths import parity_spec_path

FIXTURES_DIR: Path = parity_spec_path().parent / "fixtures"
FIXTURES: tuple[ParityFixture, ...] = load_fixtures(FIXTURES_DIR)


def test_the_fixtures_are_where_the_baseline_says_they_are() -> None:
    """A silent zero-fixture run would look exactly like a passing one."""
    assert FIXTURES, f"no recorded fixtures under {FIXTURES_DIR}"


@pytest.mark.parametrize(
    "fixture", FIXTURES, ids=[fixture.id for fixture in FIXTURES]
)
def test_a_ported_route_still_answers_its_recorded_shape(
    unbuilt_client: TestClient, fixture: ParityFixture
) -> None:
    ported = {route.key for route in coverage_of(unbuilt_client).ported}
    if (fixture.method, fixture.route) not in ported:
        pytest.skip(f"{fixture.method} {fixture.route} is not ported yet (501)")
    mismatches = replay(fixture, unbuilt_client)
    assert not mismatches, report(fixture, mismatches)


#: Fixtures a landed port claims as its grade. Each entry is one port tasklist
#: saying "this recording is replayed against my router" — without them the
#: parametrized test above would pass just as green with every case skipped,
#: which is what "ported" would then be resting on.
GRADED: tuple[str, ...] = (
    "get-graph-status",  # pinakes:50 US-2
    "get-contributions-stats",  # pinakes:60 US-1
)


@pytest.mark.parametrize("fixture_id", GRADED)
def test_a_ported_group_is_actually_being_graded(
    unbuilt_client: TestClient, fixture_id: str
) -> None:
    ported = {route.key for route in coverage_of(unbuilt_client).ported}
    graded = {
        fixture.id
        for fixture in FIXTURES
        if (fixture.method, fixture.route) in ported
    }
    assert fixture_id in graded
