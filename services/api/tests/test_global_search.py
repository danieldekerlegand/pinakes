"""`server/services/global-search.test.ts`, plus the live-corpus statement.

Three halves. The **pure** one grades the facet arithmetic, the filter parsing
and the scorer against the TypeScript's own cases. The **merge** one drives
`merge_graph_results` with a fake resolver and hand-written graph hits, which is
how the dedup and the two tier rules are pinned without a graph. The **live** one
runs the real eighteen-domain search over the committed corpus and asserts the
exact response `contracts/parity/fixtures/get-search.json` recorded off Express —
that is the statement that the two backends answer the same about the same rows.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pinakes_contracts import contracts_dir

from pinakes.search import global_search as gs
from pinakes.search.graph_resolver import EntityRef, ResolvedCsid

LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"


# ── Faceting and filters (pure) ──────────────────────────────────────────────


def test_facets_sort_by_count_descending_then_value_ascending() -> None:
    results = [
        {"entityType": "language", "source": "local"},
        {"entityType": "battle", "source": "local"},
        {"entityType": "battle", "source": "graph"},
        {"entityType": "cuisine", "source": "local"},
    ]
    facets = gs.compute_facets(results)
    assert facets["entityType"] == [
        {"value": "battle", "count": 2},
        {"value": "cuisine", "count": 1},
        {"value": "language", "count": 1},
    ]
    assert facets["source"] == [
        {"value": "local", "count": 3},
        {"value": "graph", "count": 1},
    ]


def test_a_blank_facet_value_is_not_a_bucket() -> None:
    """``if (!value) continue`` — absent and empty-string are both skipped."""
    facets = gs.compute_facets(
        [{"entityType": "", "source": "local"}, {"source": "local"}]
    )
    assert facets["entityType"] == []
    assert facets["source"] == [{"value": "local", "count": 2}]


def test_combining_facets_sums_per_value_and_re_sorts() -> None:
    left = {"entityType": [{"value": "language", "count": 2}], "source": []}
    right = {
        "entityType": [
            {"value": "language", "count": 1},
            {"value": "place", "count": 4},
        ],
        "source": [],
    }
    assert gs.combine_facets(left, right)["entityType"] == [
        {"value": "place", "count": 4},
        {"value": "language", "count": 3},
    ]


def test_filters_are_or_within_a_dimension_and_and_across_them() -> None:
    results = [
        {"entityType": "language", "source": "local"},
        {"entityType": "battle", "source": "graph"},
        {"entityType": "language", "source": "graph"},
    ]
    filtered = gs.apply_facet_filters(
        results, {"entityTypes": ["language", "battle"], "sources": ["graph"]}
    )
    assert filtered == [
        {"entityType": "battle", "source": "graph"},
        {"entityType": "language", "source": "graph"},
    ]


def test_no_filter_is_a_no_op_not_an_empty_page() -> None:
    results = [{"entityType": "language", "source": "local"}]
    assert gs.apply_facet_filters(results, {}) == results
    empty: dict[str, list[str]] = {"entityTypes": [], "sources": []}
    assert gs.apply_facet_filters(results, empty) == results


@pytest.mark.parametrize(
    ("types", "sources", "expected"),
    [
        (None, None, {}),
        ("", "", {}),
        ("language, battle ,", None, {"entityTypes": ["language", "battle"]}),
        (None, "graph,nonsense", {"sources": ["graph"]}),
        (None, "nonsense", {}),
    ],
)
def test_filter_parsing_drops_blanks_and_unknown_sources(
    types: str | None, sources: str | None, expected: dict[str, object]
) -> None:
    """An empty dimension is **absent**, not an empty list — the object is echoed."""
    assert gs.parse_search_filters(types, sources) == expected


# ── Scoring (pure) ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "query", "expected"),
    [
        ("sumer", "sumer", 1.0),  # exact: 1 + 0.3 + 0.5, capped
        ("Sumerian", "sumer", 1.0),  # substring: 1 + 0.3
        ("Sumerian Empire", "sumer empire", 1.0),
        ("Sumerian Empire", "sumer akkad", 0.5),  # one of two tokens
        ("Sumerian", "akkad", 0.0),
    ],
)
def test_the_fuzzy_scorer_matches_the_typescript(
    text: str, query: str, expected: float
) -> None:
    assert gs.fuzzy_match(text, query.split()) == pytest.approx(expected)


def test_best_score_ignores_blank_fields() -> None:
    assert gs.best_score(["sumer"], None, "", "Sumerian") == pytest.approx(1.0)
    assert gs.best_score(["sumer"], None, "") == 0.0


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Language", "language"),
        ("MUSIC_TRADITION", "music-tradition"),
        (" Place ", "place"),
    ],
)
def test_a_graph_label_becomes_the_apps_hyphenated_entity_type(
    label: str, expected: str
) -> None:
    assert gs.label_to_entity_type(label) == expected


def test_a_qid_anchored_graph_hit_is_auto_admitted_and_a_bare_one_quarantined() -> None:
    """The search payload has no `source_url`, so the tier is this coarse."""
    assert gs.graph_hit_tier({"qid": "Q123"}) == "auto-admitted"
    assert gs.graph_hit_tier({"qid": "  "}) == "quarantine"
    assert gs.graph_hit_tier({}) == "quarantine"


# ── Merging (pure, over a fake resolver) ─────────────────────────────────────


class FakeResolver:
    """Resolves exactly the `(type, id)` pairs it was handed."""

    def __init__(self, mapping: dict[tuple[str, str], str]) -> None:
        self._mapping = mapping

    def resolve(self, ref: EntityRef) -> ResolvedCsid | None:
        csid = self._mapping.get((ref.type, ref.id or ""))
        if csid is None:
            return None
        return ResolvedCsid(csid=csid, confidence=1.0, method="alias")


LOCAL_HIT = {
    "entityType": "language",
    "id": "sux",
    "displayName": "Sumerian",
    "description": "Sumerian",
    "linkPath": "/languages/sux",
    "relevance": 1.0,
    "source": "local",
    "tier": "curated",
}


def test_a_graph_hit_sharing_a_local_csid_is_dropped_and_the_local_one_wins() -> None:
    resolver = FakeResolver({("language", "sux"): "cs:language:sux"})
    results, graph_count, facets = gs.merge_graph_results(
        [LOCAL_HIT],
        [{"csid": "cs:language:sux", "name": "Sumerian", "label": "Language"}],
        resolver,
        "sumer",
    )
    assert graph_count == 0
    assert [result["source"] for result in results] == ["local"]
    assert results[0]["csid"] == "cs:language:sux"
    assert facets["source"] == []


def test_duplicate_csids_within_the_graph_payload_collapse_to_one() -> None:
    resolver = FakeResolver({})
    hit = {"csid": "cs:place:ur", "name": "Ur", "label": "Place"}
    results, graph_count, _ = gs.merge_graph_results(
        [], [hit, dict(hit)], resolver, "ur"
    )
    assert graph_count == 1
    assert len(results) == 1


def test_an_authoritative_field_match_ranks_1_and_a_name_match_has_a_floor() -> None:
    resolver = FakeResolver({})
    results, _, _ = gs.merge_graph_results(
        [],
        [
            {"csid": "cs:place:a", "name": "Nothing alike", "label": "Place"},
            {
                "csid": "cs:place:b",
                "name": "Whatever",
                "label": "Place",
                "field": "wikidata_qid",
                "qid": "Q42",
            },
        ],
        resolver,
        "ur",
    )
    exact, floored = results
    assert (exact["relevance"], exact["confidence"]) == (1.0, 1.0)
    assert exact["tier"] == "auto-admitted"
    assert floored["relevance"] == gs.GRAPH_NAME_FLOOR
    assert floored["confidence"] == gs.GRAPH_NAME_FLOOR
    assert floored["tier"] == "quarantine"


def test_a_graph_hits_provenance_omits_a_blank_qid_but_keeps_the_link() -> None:
    """``|| undefined`` drops a key; a null `graph` is a real "no view"."""
    resolver = FakeResolver({})
    results, _, _ = gs.merge_graph_results(
        [], [{"csid": "cs:place:a", "name": "A", "label": "Place", "graph": None}],
        resolver, "a",
    )
    assert results[0]["provenance"] == {
        "source": "pinakes-engine graph",
        "graphLink": None,
    }
    assert results[0]["linkPath"] == ""


def test_graph_facets_cover_the_unfiltered_contribution() -> None:
    """So the UI can still offer a graph-only facet while a filter is active."""
    resolver = FakeResolver({})
    results, graph_count, facets = gs.merge_graph_results(
        [LOCAL_HIT],
        [{"csid": "cs:place:ur", "name": "Ur", "label": "Place"}],
        resolver,
        "ur",
        {"entityTypes": ["language"]},
    )
    assert graph_count == 0
    assert [result["source"] for result in results] == ["local"]
    assert facets["entityType"] == [{"value": "place", "count": 1}]


# ── Federation ───────────────────────────────────────────────────────────────


def test_a_graph_failure_degrades_to_local_only_and_is_never_surfaced(
    tmp_path: Path,
) -> None:
    """Bare `except`, deliberately: the TypeScript's `catch {}` covered every
    way the sidecar could fail, and narrowing it would 500 a route that used to
    answer."""

    def exploding(query: str, limit: int) -> dict[str, object]:
        raise RuntimeError("graph is down")

    local = {
        "results": [LOCAL_HIT],
        "query": "sumer",
        "totalCount": 1,
        "facets": gs.compute_facets([LOCAL_HIT]),
        "filters": {},
    }
    answer = gs.federated_search(
        "sumer",
        tmp_path,
        local=lambda query, lexicons, filters: local,
        graph=exploding,
    )
    assert answer is local


def test_a_blank_query_never_reaches_the_graph_at_all(tmp_path: Path) -> None:
    calls: list[str] = []

    def graph(query: str, limit: int) -> dict[str, object]:
        calls.append(query)
        return {"results": []}

    answer = gs.federated_search("   ", tmp_path, graph=graph)
    assert calls == []
    assert answer["totalCount"] == 0
    assert answer["facets"] == gs.empty_facets()


def test_total_count_sums_both_halves_and_facets_are_combined(tmp_path: Path) -> None:
    local = {
        "results": [LOCAL_HIT],
        "query": "ur",
        "totalCount": 1,
        "facets": gs.compute_facets([LOCAL_HIT]),
        "filters": {},
    }
    answer = gs.federated_search(
        "ur",
        tmp_path,
        local=lambda query, lexicons, filters: local,
        graph=lambda query, limit: {
            "results": [{"csid": "cs:place:ur", "name": "Ur", "label": "Place"}]
        },
        resolver=FakeResolver({}),
    )
    assert answer["totalCount"] == 2
    assert answer["facets"]["source"] == [
        {"value": "graph", "count": 1},
        {"value": "local", "count": 1},
    ]


# ── The live corpus ──────────────────────────────────────────────────────────


def test_the_live_corpus_answers_the_recorded_express_response() -> None:
    """The whole `get-search` fixture sample, value for value.

    Not just the shape the parity replay checks: the exact five results, their
    order, their descriptions and the facet counts Express recorded for
    ``?q=sumer``.
    """
    answer = gs.local_search("sumer", LIVE_LEXICONS)
    assert answer["query"] == "sumer"
    assert answer["totalCount"] == 5
    assert [
        (result["entityType"], result["id"], result["displayName"])
        for result in answer["results"]
    ] == [
        ("language", "sux", "Sumerian"),
        ("language-family", "sumerian-family", "Sumerian"),
        ("language-family", "sumerian__sumerian_language", "Sumerian Language"),
        ("writing-system", "ws_026", "Cuneiform (Sumero-Akkadian)"),
        ("civilization", "sumerian", "Sumer"),
    ]
    assert answer["facets"]["entityType"] == [
        {"value": "language-family", "count": 2},
        {"value": "civilization", "count": 1},
        {"value": "language", "count": 1},
        {"value": "writing-system", "count": 1},
    ]
    assert answer["facets"]["source"] == [{"value": "local", "count": 5}]
    assert all(result["tier"] == "curated" for result in answer["results"])


def test_a_broad_live_query_is_capped_at_fifty_but_counts_them_all() -> None:
    answer = gs.local_search("a", LIVE_LEXICONS)
    assert len(answer["results"]) == gs.RESULT_LIMIT
    assert answer["totalCount"] > gs.RESULT_LIMIT
    # Facets describe the FULL match set, which is what keeps the chip counts
    # stable while a filter is active.
    assert sum(bucket["count"] for bucket in answer["facets"]["source"]) == (
        answer["totalCount"]
    )


def test_the_live_search_reaches_domains_beyond_the_fixtures_five() -> None:
    """A missing loader would show up as a domain that can never match."""
    reached = set()
    for query in ("silk", "gothic", "iroquois", "maize", "sitar", "sushi"):
        for result in gs.local_search(query, LIVE_LEXICONS)["results"]:
            reached.add(result["entityType"])
    assert {
        "trade-good",
        "architectural-style",
        "kinship-system",
        "foodway-event",
        "musical-instrument",
        "cuisine-item",
    } <= reached


def test_a_live_filter_narrows_results_without_moving_the_facet_counts() -> None:
    unfiltered = gs.local_search("a", LIVE_LEXICONS)
    filtered = gs.local_search("a", LIVE_LEXICONS, {"entityTypes": ["language"]})
    assert filtered["facets"] == unfiltered["facets"]
    assert filtered["totalCount"] < unfiltered["totalCount"]
    assert {result["entityType"] for result in filtered["results"]} == {"language"}
