"""The catalog core — languages, families, culture profiles, stats (pinakes:80 US-1).

Six recorded fixtures already grade the response *shapes* of this group
(`test_parity_replay.py`'s `GRADED`). What is asserted here is everything a
shape cannot see: which rows survive each filter, in what order, and what the
two error paths answer.

`conftest.py`'s autouse `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at
an empty temp tree, so every test that wants rows seeds its own TSVs. That is
deliberate — an assertion against the live corpus would be an assertion about
today's row counts, and `test_lexicon_storage.py` is where those belong.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.lexicons import catalog

FAMILY_HEADER = "id\tname\tparent_id\ttaxonomic_level\tregion\tdescription"
LANGUAGE_HEADER = (
    "id\tname\tfamily_id\tnative_name\tstatus\tregion\tlatitude\tlongitude"
)
PROFILE_HEADER = (
    "id\tname\tcivilization_id\tregion\tsubsistence_type\turbanism_level\t"
    "social_organization\ttechnology_level\ttime_period_start\ttime_period_end\t"
    "notable_settlements"
)
SETTLEMENT_HEADER = "id\tname\tlatitude\tlongitude"


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    """The empty lexicons tree this test's requests will read."""
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def ids(rows: list[dict[str, Any]]) -> list[str]:
    """The `id` of each row, which is what almost every assertion here is."""
    return [row["id"] for row in rows]


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


# ── Languages ────────────────────────────────────────────────────────────────


@pytest.fixture
def languages(corpus: Path) -> Path:
    write(
        corpus,
        "languages.tsv",
        LANGUAGE_HEADER,
        "san\tSanskrit\tindo_european\tसंस्कृतम्\textinct\tSouth Asia\t25\t80",
        "hin\tHindi\tindo_european\tहिन्दी\tliving\tSouth Asia\t26\t79",
        "cmn\tMandarin\tsino_tibetan\t官話\tliving\tEast Asia\t35\t110",
        "lat\tLatin\tindo_european\tLatina\textinct\tSouthern Europe\t42\t12",
    )
    return corpus


def test_languages_lists_every_row_unfiltered(
    unbuilt_client: TestClient, languages: Path
) -> None:
    body = unbuilt_client.get("/api/languages").json()
    assert [row["id"] for row in body] == ["san", "hin", "cmn", "lat"]


def test_languages_filters_by_family_exactly(
    unbuilt_client: TestClient, languages: Path
) -> None:
    body = unbuilt_client.get("/api/languages?family=indo_european").json()
    assert [row["id"] for row in body] == ["san", "hin", "lat"]


def test_status_is_repeatable_and_exact(
    unbuilt_client: TestClient, languages: Path
) -> None:
    """Express read `req.query.status` — a string for one, an array for several."""
    one = unbuilt_client.get("/api/languages?status=living").json()
    assert [row["id"] for row in one] == ["hin", "cmn"]
    both = unbuilt_client.get("/api/languages?status=living&status=extinct").json()
    assert [row["id"] for row in both] == ["san", "hin", "cmn", "lat"]
    # Exact and case-sensitive, unlike `region` and `search`.
    assert unbuilt_client.get("/api/languages?status=Living").json() == []


def test_region_is_a_case_insensitive_substring(
    unbuilt_client: TestClient, languages: Path
) -> None:
    body = unbuilt_client.get("/api/languages?region=south").json()
    assert [row["id"] for row in body] == ["san", "hin", "lat"]


def test_search_spans_name_and_native_name(
    unbuilt_client: TestClient, languages: Path
) -> None:
    assert ids(unbuilt_client.get("/api/languages?search=sanskr").json()) == ["san"]
    assert ids(unbuilt_client.get("/api/languages?search=官").json()) == ["cmn"]


def test_a_blank_filter_is_no_filter(
    unbuilt_client: TestClient, languages: Path
) -> None:
    """`if (filters?.region)` — `""` is falsy in JavaScript, so an empty
    parameter returns the whole table rather than matching nothing."""
    assert len(unbuilt_client.get("/api/languages?region=&search=").json()) == 4


def test_a_language_carries_the_three_placeholder_fields(
    unbuilt_client: TestClient, languages: Path
) -> None:
    body = unbuilt_client.get("/api/languages/cmn").json()
    assert body["id"] == "cmn"
    assert body["completionPercentage"] == 0
    assert body["historicalVariants"] == []
    assert body["dialects"] == []


def test_an_unknown_language_is_a_404_with_message_only(
    unbuilt_client: TestClient, languages: Path
) -> None:
    response = unbuilt_client.get("/api/languages/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Language not found"}


# ── Families ─────────────────────────────────────────────────────────────────


@pytest.fixture
def families(languages: Path) -> Path:
    write(
        languages,
        "families.tsv",
        FAMILY_HEADER,
        "indo_european\tIndo-European\t\tfamily\tEurasia\t",
        "sino_tibetan\tSino-Tibetan\t\tfamily\tEast Asia\t",
        "indic\tIndic\tindo_european\tsubfamily\tSouth Asia\t",
    )
    return languages


def test_family_counts_are_recursive(
    unbuilt_client: TestClient, families: Path
) -> None:
    families_json = unbuilt_client.get("/api/language-families").json()
    counts = {row["id"]: row["languageCount"] for row in families_json}
    assert counts == {"indo_european": 3, "sino_tibetan": 1, "indic": 0}


def test_the_tree_nests_children_and_languages(
    unbuilt_client: TestClient, families: Path
) -> None:
    tree = unbuilt_client.get("/api/language-families/tree").json()
    assert [node["id"] for node in tree] == ["indo_european", "sino_tibetan"]
    indo = tree[0]
    assert [child["id"] for child in indo["children"]] == ["indic"]
    # Sorted by display name, and each language carries the two empty extras.
    assert [row["name"] for row in indo["languages"]] == ["Hindi", "Latin", "Sanskrit"]
    assert indo["languages"][0]["dialects"] == []


def test_the_tree_sorts_the_way_localecompare_does(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Not a code-point sort. An accent ties with its base letter and a click
    letter sorts before any letter — both of which a code-point comparison gets
    backwards, and both of which occur in the live corpus."""
    write(
        corpus,
        "families.tsv",
        FAMILY_HEADER,
        "khoe\tKhoe\t\tfamily\tSouthern Africa\t",
    )
    write(
        corpus,
        "languages.tsv",
        LANGUAGE_HEADER,
        "gwj\tG|ui\tkhoe\t\tliving\t\t\t",
        "gnk\tG||ana\tkhoe\t\tliving\t\t\t",
        "ach\tAchi\tkhoe\t\tliving\t\t\t",
        "acn\tAché\tkhoe\t\tliving\t\t\t",
    )
    tree = unbuilt_client.get("/api/language-families/tree").json()
    assert [row["id"] for row in tree[0]["languages"]] == ["acn", "ach", "gnk", "gwj"]


def test_stats_counts_families_by_depth(
    unbuilt_client: TestClient, families: Path
) -> None:
    write(
        families,
        "words-base.tsv",
        "number\tid_nelex\tgloss_en",
        "1\tw1\twater",
        "2\tw2\tfire",
    )
    body = unbuilt_client.get("/api/stats").json()
    assert body["totalLanguages"] == 4
    assert body["totalFamilies"] == 2
    assert body["totalSubfamilies"] == 1
    assert body["baseWords"] == 2
    assert body["languagesWithCoordinates"] == 4
    # Counted work the retired scraper stack did; reported as the zero the
    # read-only TSV mode has always reported.
    assert body["wordListsScraped"] == 0
    assert body["scrapingQueue"] == 0


def test_base_words_raises_where_every_other_loader_degrades(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`readFileOrThrow` — a corpus with no concept list is broken, not empty."""
    response = unbuilt_client.get("/api/base-words")
    assert response.status_code == 500
    assert response.json() == {"message": "Failed to fetch base words"}


# ── Culture profiles ─────────────────────────────────────────────────────────


@pytest.fixture
def profiles(corpus: Path) -> Path:
    write(
        corpus,
        "culture-profiles.tsv",
        PROFILE_HEADER,
        "sumer\tSumer\tSUMER\tMesopotamia\tagriculture\turban\tstate\tbronze\t"
        "-3500\t-2000\t[\"Uruk\"]",
        "maya\tMaya\tmaya\tMesoamerica\tagriculture\turban\tstate\tstone\t"
        "-2000\t900\t[\"Tikal\"]",
        "scythia\tScythia\tscythia\tSteppe\tpastoral\tnone\ttribe\tiron\t"
        "-900\t\t[]",
    )
    return corpus


def test_profiles_answer_an_envelope_with_a_count(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    body = unbuilt_client.get("/api/culture-profiles").json()
    assert body["count"] == 3
    assert [row["id"] for row in body["profiles"]] == ["sumer", "maya", "scythia"]


def test_region_substring_but_trait_equality(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    meso = unbuilt_client.get("/api/culture-profiles?region=meso").json()
    assert ids(meso["profiles"]) == ["sumer", "maya"]
    # A trait is whole-value equality, case-insensitively — `urban` must not
    # match a hypothetical `suburban`, which a substring test would.
    upper = unbuilt_client.get("/api/culture-profiles?urbanism_level=URBAN").json()
    assert ids(upper["profiles"]) == ["sumer", "maya"]


def test_the_civilization_filter_is_case_insensitive(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    body = unbuilt_client.get("/api/culture-profiles?civilization_id=sumer").json()
    assert [row["id"] for row in body["profiles"]] == ["sumer"]


def test_an_open_ended_period_matches_every_lower_bound(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    """`p.timePeriodEnd ?? Infinity` — Scythia has no recorded end, so it
    survives a `time_start` far later than anything it records."""
    body = unbuilt_client.get("/api/culture-profiles?time_start=1500").json()
    assert [row["id"] for row in body["profiles"]] == ["scythia"]


def test_the_two_bounds_are_an_overlap_test(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    """Scythia is excluded by the upper bound (it starts after it), not by the
    lower one — its open end would otherwise carry it through both."""
    body = unbuilt_client.get(
        "/api/culture-profiles?time_start=-3000&time_end=-1000"
    ).json()
    assert [row["id"] for row in body["profiles"]] == ["sumer", "maya"]


def test_an_unparseable_year_empties_the_page_rather_than_422ing(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    """`parseInt("abc", 10)` is `NaN` and every comparison against it is false.
    A declared `int` parameter would answer 422, which is a different contract —
    a stale bookmark must not become a hard failure."""
    response = unbuilt_client.get("/api/culture-profiles?time_start=abc")
    assert response.status_code == 200
    assert response.json() == {"profiles": [], "count": 0}


def test_by_civilization_is_not_guarded_by_truthiness(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    body = unbuilt_client.get("/api/culture-profiles/by-civilization/SuMeR").json()
    assert [row["id"] for row in body["profiles"]] == ["sumer"]
    assert unbuilt_client.get("/api/culture-profiles/by-civilization/nope").json() == {
        "profiles": [],
        "count": 0,
    }


def test_by_location_joins_through_settlement_names(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    """A culture profile carries no geometry — the search finds settlements in
    range and keeps the profiles that *name* one."""
    write(
        profiles,
        "settlements.tsv",
        SETTLEMENT_HEADER,
        "uruk\tUruk\t31.32\t45.64",
        "tikal\tTikal\t17.22\t-89.62",
    )
    body = unbuilt_client.get("/api/culture-profiles/by-location/31.3/45.6").json()
    assert [row["id"] for row in body["profiles"]] == ["sumer"]

    wide = unbuilt_client.get(
        "/api/culture-profiles/by-location/31.3/45.6?radius=20000"
    ).json()
    assert [row["id"] for row in wide["profiles"]] == ["sumer", "maya"]


def test_a_profile_with_no_settlements_is_never_near_anywhere(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    write(profiles, "settlements.tsv", SETTLEMENT_HEADER, "x\tX\t0\t0")
    body = unbuilt_client.get("/api/culture-profiles/by-location/0/0").json()
    assert body["profiles"] == []


def test_non_numeric_coordinates_are_a_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/culture-profiles/by-location/north/44")
    assert response.status_code == 400
    assert response.json() == {"message": "Invalid coordinates"}


def test_an_unparseable_radius_empties_the_result(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    """`radius` is parsed but unchecked: `NaN` fails every `<=`, so the answer is
    empty rather than a 400. That asymmetry with the coordinates is Express's."""
    write(profiles, "settlements.tsv", SETTLEMENT_HEADER, "uruk\tUruk\t31.32\t45.64")
    response = unbuilt_client.get(
        "/api/culture-profiles/by-location/31.3/45.6?radius=wide"
    )
    assert response.status_code == 200
    assert response.json()["profiles"] == []


def test_by_civilization_outranks_the_id_route(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    """Registration order is the routing: `by-civilization` must not be read as
    a profile id, which is the failure a reordered file would introduce."""
    assert unbuilt_client.get("/api/culture-profiles/by-civilization/maya").json() == {
        "profiles": [
            row
            for row in unbuilt_client.get("/api/culture-profiles").json()["profiles"]
            if row["id"] == "maya"
        ],
        "count": 1,
    }


def test_an_unknown_profile_is_a_404(
    unbuilt_client: TestClient, profiles: Path
) -> None:
    response = unbuilt_client.get("/api/culture-profiles/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Culture profile not found"}


# ── The pure layer, directly ─────────────────────────────────────────────────


def test_an_undated_start_matches_every_upper_bound() -> None:
    rows = [{"id": "a", "timePeriodStart": None, "timePeriodEnd": None}]
    assert catalog.filter_culture_profiles(rows, time_end=-9000) == rows


def test_year_zero_is_a_bound_not_an_absence() -> None:
    """`?? -Infinity` is nullish; `or` would replace a recorded year of 0."""
    rows = [{"id": "a", "timePeriodStart": 0, "timePeriodEnd": 0}]
    assert catalog.filter_culture_profiles(rows, time_end=-1) == []
    assert catalog.filter_culture_profiles(rows, time_end=1) == rows
