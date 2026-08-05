"""`server/services/place-resolver.test.ts` + the three `/api/map/places/*` routes.

The external geocoders are behind :class:`~pinakes.search.places.PlaceResolverDeps`,
so every test here runs with **no network**: a fake answers, raises, or returns
nothing, and the three degradation paths are graded on that. The local half runs
against a seeded temp corpus and against the live one.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contracts_dir

from pinakes.search import places

LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"

GEONAMES_ROW = {
    "geonameId": 98182,
    "name": "Baghdad",
    "lat": "33.34058",
    "lng": "44.40088",
    "fcodeName": "capital of a political entity",
    "countryName": "Iraq",
    "adminName1": "Baghdad",
}

NOMINATIM_ROW = {
    "place_id": 1234,
    "display_name": "Baghdad, Iraq",
    "lat": "33.3",
    "lon": "44.4",
    "boundingbox": ["33.0", "33.5", "44.0", "44.9"],
}


class FakeDeps:
    """A recorded geocoder: either answers, or raises what the live one raises."""

    def __init__(
        self,
        geonames: list[dict[str, Any]] | Exception,
        nominatim: list[dict[str, Any]] | Exception,
    ) -> None:
        self.geonames = geonames
        self.nominatim = nominatim
        self.calls: list[str] = []

    def fetch_geonames(self, query: str, limit: int) -> list[dict[str, Any]]:
        self.calls.append("geonames")
        if isinstance(self.geonames, Exception):
            raise self.geonames
        return self.geonames

    def fetch_nominatim(self, query: str, limit: int) -> list[dict[str, Any]]:
        self.calls.append("nominatim")
        if isinstance(self.nominatim, Exception):
            raise self.nominatim
        return self.nominatim


# ── Normalization and scoring (pure) ─────────────────────────────────────────


def test_normalization_trims_before_stripping_punctuation() -> None:
    """Which is why a trailing space can survive — and the dedup key rests on it."""
    assert places.normalize("  Ur !  ") == "ur "
    assert places.normalize("Ur") == "ur"


def test_a_non_latin_name_normalizes_to_blank_and_scores_nothing() -> None:
    assert places.normalize("𒅴𒂠") == ""
    assert places.fuzzy_score("sumerian", "𒅴𒂠") == 0.0


@pytest.mark.parametrize(
    ("query", "target", "expected"),
    [
        ("ur", "Ur", 1.0),
        ("meso", "Mesopotamia", 0.9),
        ("potam", "Mesopotamia", 0.7),
        ("great ur", "Ur of the Chaldees", 0.3),
        ("nothing", "Ur", 0.0),
    ],
)
def test_the_fuzzy_tiers(query: str, target: str, expected: float) -> None:
    assert places.fuzzy_score(query, target) == pytest.approx(expected)


def test_an_alias_can_beat_the_name() -> None:
    assert places.best_fuzzy_score("kemet", "Egypt", ["kemet"]) == 1.0


# ── The mappers (pure) ───────────────────────────────────────────────────────


def test_a_nominatim_bounding_box_is_reordered_to_south_west_north_east() -> None:
    """Nominatim sends ``[south, north, west, east]``; this app wants s/w/n/e."""
    result = places.nominatim_to_place_result(NOMINATIM_ROW, 0)
    assert result["bbox"] == [33.0, 44.0, 33.5, 44.9]
    assert places.nominatim_to_canonical(NOMINATIM_ROW)["bbox"] == [
        33.0,
        44.0,
        33.5,
        44.9,
    ]


def test_geonames_outranks_nominatim() -> None:
    assert places.geonames_to_place_result(GEONAMES_ROW, 0)["relevance"] == 0.68
    assert places.nominatim_to_place_result(NOMINATIM_ROW, 0)["relevance"] == 0.6


def test_a_nominatim_name_is_the_first_display_name_segment() -> None:
    assert places.nominatim_to_place_result(NOMINATIM_ROW, 0)["name"] == "Baghdad"
    assert places.nominatim_to_canonical(NOMINATIM_ROW)["name"] == "Baghdad"


def test_only_a_geonames_record_carries_a_geonames_id() -> None:
    assert places.geonames_to_canonical(GEONAMES_ROW)["geonamesId"] == 98182
    assert places.nominatim_to_canonical(NOMINATIM_ROW)["geonamesId"] is None


def test_a_geonames_record_with_no_labels_still_gets_a_description() -> None:
    bare = {"geonameId": 1, "name": "X", "lat": "0", "lng": "0"}
    assert places.geonames_to_place_result(bare, 0)["description"] == "GeoNames place"


# ── The local corpus half ────────────────────────────────────────────────────


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "settlements.tsv").write_text(
        "id\tname\talternate_names\tlatitude\tlongitude\ttype\tfounded_year"
        "\tabandoned_year\tmodern_name\tregion\n"
        'ur\tUr\t["Urim"]\t30.96\t46.10\tcity-state\t-3800\t-500\tTell el-Muqayyar'
        "\tSumer\n",
        encoding="utf-8",
    )
    (lexicons / "archaeological-sites.tsv").write_text(
        "id\tname\tcoordinates\tsite_type\n"
        'troy\tTroy\t{"lat": 39.9, "lng": 26.2}\tsettlement\n',
        encoding="utf-8",
    )
    (lexicons / "battles.tsv").write_text(
        "id\tname\tdate\tcoordinates\twar_name\n"
        "kadesh\tBattle of Kadesh\t1274 BCE\t[36.5, 34.5]\tEgyptian-Hittite wars\n",
        encoding="utf-8",
    )
    return lexicons


def test_a_blank_query_searches_nothing(corpus: Path) -> None:
    assert places.search_places("  ", corpus) == {"results": [], "query": ""}


def test_a_settlement_carries_its_period_its_aliases_and_its_modern_name(
    corpus: Path,
) -> None:
    result = places.search_places("Urim", corpus)["results"][0]
    assert result["id"] == "settlement-ur"
    assert result["category"] == "settlement"
    assert result["timePeriod"] == "3800 BCE – 500 BCE"
    # `type.replace(/-/g, " ")` then capitalize the FIRST letter only.
    assert result["description"] == "City state · Sumer · Modern: Tell el-Muqayyar"
    assert result["relevance"] == 1.0


def test_a_known_region_answers_with_a_bounding_box(corpus: Path) -> None:
    result = places.search_places("mesopotamia", corpus)["results"][0]
    assert result["geometryType"] == "bbox"
    assert result["bbox"] == [29.0, 38.0, 37.0, 49.0]
    assert result["id"] == "region-mesopotamia"


def test_sites_and_battles_rank_below_settlements(corpus: Path) -> None:
    site = places.search_places("Troy", corpus)["results"][0]
    battle = places.search_places("Battle of Kadesh", corpus)["results"][0]
    assert site["relevance"] == pytest.approx(0.95)
    assert battle["relevance"] == pytest.approx(0.9)
    assert battle["lat"] == 34.5 and battle["lng"] == 36.5  # `[lng, lat]` pair


def test_autocomplete_needs_two_characters_and_never_leaves_the_corpus(
    corpus: Path,
) -> None:
    assert places.autocomplete_places("u", corpus) == []
    hits = places.autocomplete_places("ur", corpus)
    # The exact settlement outranks the known regions whose names merely
    # *contain* "ur" (Europe, southeast europe) — 1.0 against 0.7.
    assert hits[0]["id"] == "settlement-ur"
    assert {hit["category"] for hit in hits} <= {"settlement", "region"}


def test_the_live_corpus_resolves_a_real_settlement() -> None:
    answer = places.search_places("babylon", LIVE_LEXICONS, 15)
    assert answer["results"], "no live match for babylon"
    assert answer["results"][0]["category"] in {"settlement", "region"}


# ── The geocoder fallback chain ──────────────────────────────────────────────


def test_a_strong_local_answer_never_reaches_the_network(corpus: Path) -> None:
    """Three hits with a >= 0.7 best is the whole rate-limit strategy."""
    deps = FakeDeps([GEONAMES_ROW], [NOMINATIM_ROW])
    # "e" matches several known regions strongly enough to short-circuit.
    answer = places.search_places_with_geocoder("egypt", corpus, 15, deps)
    assert deps.calls in ([], ["geonames"])
    assert answer["query"] == "egypt"


def test_a_thin_local_answer_is_topped_up_from_geonames(corpus: Path) -> None:
    deps = FakeDeps([GEONAMES_ROW], [NOMINATIM_ROW])
    answer = places.search_places_with_geocoder("Baghdad", corpus, 15, deps)
    assert deps.calls == ["geonames"]
    assert [result["category"] for result in answer["results"]] == ["geonames"]


def test_geonames_failing_falls_back_to_nominatim(corpus: Path) -> None:
    deps = FakeDeps(RuntimeError("GEONAMES_USERNAME not configured"), [NOMINATIM_ROW])
    answer = places.search_places_with_geocoder("Baghdad", corpus, 15, deps)
    assert deps.calls == ["geonames", "nominatim"]
    assert [result["category"] for result in answer["results"]] == ["modern"]


def test_geonames_answering_nothing_also_falls_back(corpus: Path) -> None:
    deps = FakeDeps([], [NOMINATIM_ROW])
    places.search_places_with_geocoder("Baghdad", corpus, 15, deps)
    assert deps.calls == ["geonames", "nominatim"]


def test_both_authorities_failing_is_the_local_answer_not_an_error(
    corpus: Path,
) -> None:
    deps = FakeDeps(RuntimeError("down"), RuntimeError("also down"))
    answer = places.search_places_with_geocoder("Baghdad", corpus, 15, deps)
    assert answer["results"] == []


def test_resolve_prefers_geonames_and_names_its_source() -> None:
    deps = FakeDeps([GEONAMES_ROW], [NOMINATIM_ROW])
    answer = places.resolve_place("Baghdad", 10, deps)
    assert answer["source"] == "geonames"
    assert answer["results"][0]["geonamesId"] == 98182
    assert deps.calls == ["geonames"]


def test_resolve_falls_back_and_reports_no_source_when_nothing_matched() -> None:
    assert places.resolve_place("x", 10, FakeDeps([], []))["source"] is None
    assert places.resolve_place("  ", 10, FakeDeps([], []))["query"] == ""
    both_down = FakeDeps(RuntimeError("a"), RuntimeError("b"))
    assert places.resolve_place("x", 10, both_down) == {
        "results": [],
        "query": "x",
        "source": None,
    }


def test_resolve_consults_no_local_data_at_all(corpus: Path) -> None:
    """Unlike `/search`: the point of the endpoint is a standardized record."""
    assert places.resolve_place("Ur", 10, FakeDeps([], []))["results"] == []


# ── The routes ───────────────────────────────────────────────────────────────


def test_the_three_empty_answers_are_all_different(
    unbuilt_client: TestClient,
) -> None:
    assert unbuilt_client.get("/api/map/places/search").json() == {
        "results": [],
        "query": "",
    }
    assert unbuilt_client.get("/api/map/places/autocomplete?q=u").json() == []
    assert unbuilt_client.get("/api/map/places/resolve").json() == {
        "results": [],
        "query": "",
        "source": None,
    }


def test_autocomplete_answers_over_the_seeded_corpus(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/map/places/autocomplete?q=ur").json()
    assert body[0]["id"] == "settlement-ur"


def test_an_unparseable_limit_pages_to_empty_rather_than_422(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.get("/api/map/places/autocomplete?q=ur&limit=abc")
    assert response.status_code == 200
    assert response.json() == []


def test_the_geonames_username_being_unset_is_the_normal_state() -> None:
    """No account ⇒ the live deps raise ⇒ the resolver falls back. Not an error."""
    import os

    assert places.GEONAMES_USERNAME_ENV not in os.environ or os.environ[
        places.GEONAMES_USERNAME_ENV
    ]
    if places.GEONAMES_USERNAME_ENV not in os.environ:
        with pytest.raises(RuntimeError):
            places.LiveDeps().fetch_geonames("Baghdad", 5)
