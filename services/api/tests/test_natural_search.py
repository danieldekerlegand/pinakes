"""`server/services/natural-language-search.ts`'s parser and spatial search.

The parser's edges are the whole story — it is a keyword matcher, and the port's
job was to keep every edge rather than tidy it. The route half lives in
`test_search_routes.py`; what is here is the parse, the two different
"read this bound as a year" rules, and the live-corpus spatial answers.
"""

from __future__ import annotations

import pytest
from pinakes_contracts import contracts_dir

from pinakes.search import natural

LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"


# ── Parsing (pure) ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("3000 BCE", -3000),
        ("3000bc", -3000),
        ("500 CE", 500),
        ("500ad", 500),
        ("in 1200", 1200),
        ("in 99", None),  # below the four-digit floor
        ("35.5, 44.2", None),  # a coordinate is not a date
    ],
)
def test_year_parsing(text: str, expected: int | None) -> None:
    assert natural.parse_year(text) == expected


def test_bce_wins_over_a_bare_four_digit_year() -> None:
    assert natural.parse_year("1200 BCE") == -1200


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("35.5, 44.2", {"lat": 35.5, "lng": 44.2}),
        ("-35.5,-44.2", {"lat": -35.5, "lng": -44.2}),
        ("200, 44.2", None),  # out of range
        ("no numbers here", None),
    ],
)
def test_coordinate_parsing(text: str, expected: dict[str, float] | None) -> None:
    assert natural.parse_coordinates(text) == expected


def test_the_longest_matching_location_wins() -> None:
    """Otherwise "south africa" would resolve as "africa"."""
    match = natural.parse_location_name("cultures of south africa")
    assert match is not None and match[0] == "south africa"


def test_the_first_entity_type_keyword_in_declaration_order_wins() -> None:
    """`ENTITY_TYPE_KEYWORDS` is an ordered table and the scan stops at a hit."""
    assert natural.detect_entity_type("music and art") == "music-tradition"
    assert natural.detect_entity_type("art in egypt") == "art-tradition"
    assert natural.detect_entity_type("nothing relevant") is None


def test_an_explicit_coordinate_beats_the_named_locations_point() -> None:
    parsed = natural.parse_natural_language_query(
        "civilizations in egypt at 10.5, 20.5"
    )
    assert parsed["locationName"] == "egypt"
    assert parsed["coordinates"] == {"lat": 10.5, "lng": 20.5}


def test_a_blank_query_parses_to_the_empty_shape() -> None:
    assert natural.parse_natural_language_query("  ") == {
        "raw": "",
        "entityType": None,
        "locationName": None,
        "coordinates": None,
        "year": None,
        "radiusKm": natural.DEFAULT_RADIUS_KM,
    }


# ── Time-range reading ───────────────────────────────────────────────────────


def test_a_query_with_no_year_matches_every_range() -> None:
    assert natural.in_time_range(None, 100, 200) is True


@pytest.mark.parametrize(
    ("year", "start", "end", "expected"),
    [
        (150, 100, 200, True),
        (50, 100, 200, False),
        (150, 100, None, True),
        (50, None, 200, True),
        (50, "", "", True),  # unbounded both ways
        (-2000, "3000 BCE", "1000 BCE", True),
        (150, "100", None, True),  # the integer-prefix fallback
    ],
)
def test_range_filtering(
    year: int, start: object, end: object, expected: bool
) -> None:
    assert natural.in_time_range(year, start, end) is expected


def test_the_label_rule_is_stricter_than_the_filter_rule() -> None:
    """A bound of ``"50"`` filters as year 50 but renders as ``?``.

    Two readings of one value, and both are the TypeScript's — the filter runs
    through `parseInt` when `parseYear` declines, the label does not.
    """
    # The filter reads it (via the `parseInt` fallback)…
    assert natural.in_time_range(50, "50", None) is True
    assert natural.in_time_range(49, "50", None) is False
    # …and the label does not, because `parseYear` alone declines a two-digit
    # number and the label rule has no fallback behind it.
    assert natural.format_year(natural.parse_year("50")) is None


@pytest.mark.parametrize(
    ("year", "expected"), [(-3000, "3000 BCE"), (500, "500 CE"), (None, None)]
)
def test_year_formatting(year: int | None, expected: str | None) -> None:
    assert natural.format_year(year) == expected


# ── Spatial search, against the live corpus ──────────────────────────────────


def test_an_empty_parse_short_circuits_rather_than_returning_the_corpus() -> None:
    empty = natural.parse_natural_language_query("")
    assert natural.spatial_search(empty, LIVE_LEXICONS) == {
        "results": [],
        "query": empty,
        "totalCount": 0,
    }


def test_a_typed_query_searches_exactly_that_domain() -> None:
    parsed = natural.parse_natural_language_query(
        "What languages were spoken in Mesopotamia in 3000 BCE?"
    )
    assert parsed["entityType"] == "language"
    assert parsed["locationName"] == "mesopotamia"
    assert parsed["year"] == -3000
    answer = natural.spatial_search(parsed, LIVE_LEXICONS)
    assert answer["totalCount"] > 0
    assert {result["entityType"] for result in answer["results"]} == {"language"}


def test_results_are_nearest_first_and_capped() -> None:
    answer = natural.what_was_here(33.3, 44.4, None, LIVE_LEXICONS, radius_km=5000)
    distances = [result["distanceKm"] for result in answer["results"]]
    assert distances == sorted(distances)
    assert len(answer["results"]) <= natural.RESULT_LIMIT
    assert answer["totalCount"] >= len(answer["results"])


def test_a_point_query_drops_everything_with_no_coordinates() -> None:
    """There is no distance to compare, so the record cannot be ranked."""
    answer = natural.what_was_here(33.3, 44.4, None, LIVE_LEXICONS)
    assert all(result["coordinates"] is not None for result in answer["results"])
    assert all(result["distanceKm"] is not None for result in answer["results"])


def test_the_map_click_query_carries_its_own_two_decimal_label() -> None:
    answer = natural.what_was_here(33.333, -44.005, None, LIVE_LEXICONS, radius_km=1)
    assert answer["query"]["raw"] == "What was here? (33.33, -44.01)"
    assert answer["query"]["radiusKm"] == 1


def test_every_civilization_passes_the_year_filter_and_that_is_a_port() -> None:
    """The projection reads `properties.startYear`; the feature has none.

    Reproduced rather than fixed: correcting it here would make the two
    backends answer differently about the same query mid-cutover.
    """
    at_3000_bce = natural.spatial_search(
        {
            "coordinates": None,
            "locationName": None,
            "year": -3000,
            "entityType": "civilization",
            "radiusKm": 500,
        },
        LIVE_LEXICONS,
    )
    unconstrained = natural.spatial_search(
        {
            "coordinates": None,
            "locationName": None,
            "year": None,
            "entityType": "civilization",
            "radiusKm": 500,
        },
        LIVE_LEXICONS,
    )
    assert at_3000_bce["totalCount"] == unconstrained["totalCount"]


# ── Suggestions ──────────────────────────────────────────────────────────────


def test_no_input_offers_nothing() -> None:
    assert natural.query_suggestions("  ") == []


def test_suggestions_are_deduped_and_capped_at_eight() -> None:
    suggestions = natural.query_suggestions("me")
    assert len(suggestions) == len(set(suggestions))
    assert len(suggestions) <= 8


def test_the_location_pass_matches_a_prefix_or_a_three_letter_stem() -> None:
    """Which is what makes "me" offer both Mesopotamia and the Mediterranean."""
    suggestions = natural.query_suggestions("me")
    assert any("mesopotamia" in item.lower() for item in suggestions)


def test_a_what_query_falls_through_to_the_canned_examples() -> None:
    suggestions = natural.query_suggestions("what")
    assert "What civilizations existed in 3000 BCE?" in suggestions


def test_an_unmatched_stem_falls_back_to_the_query_patterns() -> None:
    assert natural.query_suggestions("reli") == ["Religions in {location}"]
