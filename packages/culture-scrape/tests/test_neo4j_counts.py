"""Tests for the node/edge count smoke queries.

The two queries return primitive ``(label|type, count)`` pairs, so they run
against a fake replay session with no live server. The helpers decode the cursor
to plain dicts; :func:`count_summary` runs both in one session and exposes the
``Entity``-anchored node total and the summed edge total.
"""

from __future__ import annotations

import sys
import types
from typing import Any

from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.neo4j.counts import (
    EDGE_COUNT_QUERY,
    NODE_COUNT_QUERY,
    CountSummary,
    count_summary,
    edge_counts_by_type,
    node_counts_by_label,
)

EMPTY_ENV: dict[str, str] = {}

_NODE_ROWS = [
    {"label": ENTITY_LABEL, "count": 5},
    {"label": "Language", "count": 3},
    {"label": "ArchaeologicalCulture", "count": 2},
]
_EDGE_ROWS = [
    {"type": "DESCENDS_FROM", "count": 4},
    {"type": "CONTEMPORARY_WITH", "count": 1},
]


class _ReplaySession:
    """Replays a per-query fixture list, like a read-only Bolt session."""

    def __init__(self, results: dict[str, list[dict[str, Any]]]) -> None:
        self._results = results

    def __enter__(self) -> _ReplaySession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, query: str, **params: Any) -> list[dict[str, Any]]:
        return self._results[query]


class _FakeDriver:
    def __init__(self, session: Any) -> None:
        self._session = session
        self.closed = False

    def session(self) -> Any:
        return self._session

    def close(self) -> None:
        self.closed = True


def _driver() -> _FakeDriver:
    return _FakeDriver(
        _ReplaySession({NODE_COUNT_QUERY: _NODE_ROWS, EDGE_COUNT_QUERY: _EDGE_ROWS})
    )


def test_node_counts_decoded_to_dict() -> None:
    driver: Any = _driver()
    assert node_counts_by_label(driver) == {
        ENTITY_LABEL: 5,
        "Language": 3,
        "ArchaeologicalCulture": 2,
    }


def test_edge_counts_decoded_to_dict() -> None:
    driver: Any = _driver()
    assert edge_counts_by_type(driver) == {
        "DESCENDS_FROM": 4,
        "CONTEMPORARY_WITH": 1,
    }


def test_count_summary_totals() -> None:
    driver: Any = _driver()
    summary = count_summary(driver=driver)

    assert isinstance(summary, CountSummary)
    # Entity anchor equals the true node total (labels overlap; do not sum).
    assert summary.node_total == 5
    # Edge types never overlap, so the sum is exact.
    assert summary.edge_total == 5
    # A caller-supplied driver is left open for the caller to manage.
    assert driver.closed is False


def test_count_summary_connects_and_closes_when_no_driver(
    monkeypatch: Any,
) -> None:
    driver = _driver()

    class FakeGraphDatabase:
        @staticmethod
        def driver(uri: str, **kwargs: Any) -> _FakeDriver:
            return driver

    fake_module = types.ModuleType("neo4j")
    fake_module.GraphDatabase = FakeGraphDatabase  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "neo4j", fake_module)

    summary = count_summary({"password": "p"}, env=EMPTY_ENV)

    assert summary.nodes_by_label[ENTITY_LABEL] == 5
    # An owned driver (opened from config) is closed before returning.
    assert driver.closed is True


def test_empty_graph_has_zero_totals() -> None:
    driver: Any = _FakeDriver(
        _ReplaySession({NODE_COUNT_QUERY: [], EDGE_COUNT_QUERY: []})
    )
    summary = count_summary(driver=driver)
    assert summary.node_total == 0
    assert summary.edge_total == 0
