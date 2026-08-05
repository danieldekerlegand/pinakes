"""The seven `/api/cross-domain/*` reads (pinakes:80 US-1, slice 6).

No fixture in `contracts/parity/` records any of these — no outstanding route
carries one any more — so this file *is* the grading, alongside the live diff
against Express that proved the slice (105 of 107 requests byte-identical; the
two exceptions are the repeated-query-parameter divergence every flat-catalog
port here shares, where Express raises a `TypeError` on an array and Starlette
hands back one value).

What it pins is what a shape check cannot: which keys each of the six
projections *omits*, how the three relationship signals accumulate, and the
`NaN` propagation that decides whether an empire appears on the timeline at all.

`conftest.py`'s autouse `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at
an empty temp tree, so every test seeds its own TSVs.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.analytics import cross_domain, cross_domain_timeline
from pinakes.lexicons import storage


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


CUISINE_HEADER = (
    "id\tname\tnative_name\tregion\tcoordinates\tassociated_language_ids\t"
    "time_origin\ttime_end\tdescription"
)
MUSIC_HEADER = (
    "id\tname\tnative_name\tregion\tcoordinates\ttime_origin\ttime_end\t"
    "associated_language_ids\tdescription"
)
RELIGION_HEADER = (
    "id\tname\tnative_name\treligion_type\torigin_region\tcoordinates\t"
    "time_origin\ttime_end\tassociated_language_ids\tdescription"
)
HAPLOGROUP_HEADER = (
    "id\tname\tparent_id\thaplogroup_type\tdescription\t"
    "associated_language_family_ids\tassociated_civilization_ids\t"
    "geographic_origin\ttime_origin"
)
CIVILIZATION_HEADER = (
    "id\tname\tnative_name\ttime_period_start\ttime_period_end\t"
    "time_period_label\tassociated_language_ids"
)
SITE_HEADER = (
    "id\tname\tcoordinates\tsite_type\ttime_period_start\ttime_period_end\t"
    "time_period_label\tassociated_language_ids"
)


@pytest.fixture
def six_domains(corpus: Path) -> Path:
    """One row per domain, wired so every relationship signal is reachable."""
    write(
        corpus,
        "cuisines.tsv",
        CUISINE_HEADER,
        'levantine\tLevantine\tمطبخ\tLevant\t{"lat":33.9,"lng":35.5}\t["ara"]\t'
        "-1000\t-200\tOlive, wheat and sesame",
        'nordic\tNordic\t\tScandinavia\t{"lat":60,"lng":10}\t["non"]\t800\t\t',
    )
    write(
        corpus,
        "music-traditions.tsv",
        MUSIC_HEADER,
        'maqam\tMaqam\tمقام\tLevant\t{"lat":33.5,"lng":36.3}\t-800\t-100\t'
        '["ara"]\tModal system',
    )
    write(
        corpus,
        "religions.tsv",
        RELIGION_HEADER,
        'canaanite\tCanaanite\t\tpolytheistic\tLevant\t{"lat":34,"lng":35}\t'
        '-2000\t-300\t["ara"]\tBronze Age pantheon',
    )
    write(
        corpus,
        "haplogroups.tsv",
        HAPLOGROUP_HEADER,
        'j1\tJ-M267\t\tY-chromosome\tSemitic marker\t["afroasiatic"]\t[]\t'
        "Near East\t-20000",
    )
    write(
        corpus,
        "civilizations.tsv",
        CIVILIZATION_HEADER,
        'phoenicia\tPhoenicia\tKen\'ani\t-1500\t-300\tIron Age\t["ara"]',
        "unnamed\t\t\t-400\t\t\t[]",
    )
    write(
        corpus,
        "archaeological-sites.tsv",
        SITE_HEADER,
        'byblos\tByblos\t{"lat":34.1,"lng":35.6}\tsettlement\t-5000\t-300\t'
        'Neolithic\t["ara"]',
    )
    return corpus


# ── The projection ───────────────────────────────────────────────────────────


def test_the_six_domains_come_back_in_getallentities_order(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/entities").json()
    assert [entity["entityType"] for entity in body["entities"]] == [
        "cuisine",
        "cuisine",
        "music-tradition",
        "religion",
        "haplogroup",
        "civilization",
        "civilization",
        "archaeological-site",
    ]
    assert body["count"] == 8
    assert body["filters"] == {}


def test_each_projection_omits_a_different_set_of_keys(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """`JSON.stringify` drops an `undefined`, so absence is part of the shape."""
    by_type = {
        entity["entityType"]: entity
        for entity in unbuilt_client.get("/api/cross-domain/entities").json()[
            "entities"
        ]
    }
    assert set(by_type["cuisine"]) == {
        "id",
        "name",
        "nativeName",
        "entityType",
        "region",
        "coordinates",
        "timeOrigin",
        "timeEnd",
        "associatedLanguageIds",
        "description",
    }
    # A haplogroup has a region but never a native name or a coordinate.
    assert "nativeName" not in by_type["haplogroup"]
    assert "coordinates" not in by_type["haplogroup"]
    assert by_type["haplogroup"]["region"] == "Near East"
    assert by_type["haplogroup"]["timeEnd"] is None
    # A civilization and a site carry neither region, coordinate nor description.
    for entity_type in ("civilization", "archaeological-site"):
        assert "region" not in by_type[entity_type]
        assert "coordinates" not in by_type[entity_type]
        assert "description" not in by_type[entity_type]
    assert by_type["archaeological-site"]["id"] == "byblos"


def test_a_civilization_without_a_native_name_omits_the_key(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    civilizations = [
        entity
        for entity in unbuilt_client.get(
            "/api/cross-domain/entities?types=civilization"
        ).json()["entities"]
    ]
    assert "nativeName" in civilizations[0]
    assert "nativeName" not in civilizations[1]


def test_a_religion_reads_its_region_from_originregion(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/entities?types=religion").json()
    assert body["entities"][0]["region"] == "Levant"


def test_only_three_of_the_six_domains_are_filtered(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """`?year=`/`?region=` never reach haplogroups, civilizations or sites."""
    body = unbuilt_client.get("/api/cross-domain/entities?year=1900").json()
    assert [entity["entityType"] for entity in body["entities"]] == [
        "cuisine",  # nordic — open-ended
        "haplogroup",
        "civilization",
        "civilization",
        "archaeological-site",
    ]
    body = unbuilt_client.get("/api/cross-domain/entities?region=nowhere").json()
    assert [entity["entityType"] for entity in body["entities"]] == [
        "haplogroup",
        "civilization",
        "civilization",
        "archaeological-site",
    ]


def test_a_blank_types_parameter_is_no_filter_at_all(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """`req.query.types ? ... : undefined` — blank is falsy, so it is absent."""
    assert unbuilt_client.get("/api/cross-domain/entities?types=").json()["count"] == 8
    assert (
        unbuilt_client.get("/api/cross-domain/entities?types=nonsense").json()["count"]
        == 0
    )
    assert (
        unbuilt_client.get(
            "/api/cross-domain/entities?types=cuisine,religion"
        ).json()["count"]
        == 3
    )


def test_the_filters_echo_keeps_a_blank_region_and_nulls_a_junk_year(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """The `_echo` rules again: `undefined` emits no key, `NaN` emits `null`."""
    assert unbuilt_client.get("/api/cross-domain/entities?region=").json()[
        "filters"
    ] == {"region": ""}
    assert (
        unbuilt_client.get("/api/cross-domain/entities?year=").json()["filters"] == {}
    )
    assert unbuilt_client.get("/api/cross-domain/entities?year=soon").json()[
        "filters"
    ] == {"year": None}
    assert unbuilt_client.get("/api/cross-domain/entities?year=-500").json()[
        "filters"
    ] == {"year": -500}


# ── Search ───────────────────────────────────────────────────────────────────


def test_search_without_a_query_is_a_400(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    for url in ("/api/cross-domain/search", "/api/cross-domain/search?q="):
        response = unbuilt_client.get(url)
        assert response.status_code == 400
        assert response.json() == {"message": "Query parameter 'q' is required"}


def test_search_ranks_a_name_above_a_description(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/search?q=maqam").json()
    assert body["query"] == "maqam"
    assert [entity["id"] for entity in body["entities"]] == ["maqam"]

    # "levant" is a name (3) + a region (1) on the cuisine, and a region alone
    # on the music tradition and the religion. The civilization and the site
    # have no region key at all, so they cannot match it.
    body = unbuilt_client.get("/api/cross-domain/search?q=levant").json()
    assert [entity["id"] for entity in body["entities"]] == [
        "levantine",
        "maqam",
        "canaanite",
    ]


def test_a_junk_search_limit_returns_an_empty_page(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """`slice(0, NaN)` clamps to nothing — not the whole list, and not a 422."""
    assert unbuilt_client.get("/api/cross-domain/search?q=levant&limit=abc").json()[
        "count"
    ] == 0
    assert unbuilt_client.get("/api/cross-domain/search?q=levant&limit=2").json()[
        "count"
    ] == 2
    # Blank is falsy, so the default of 50 applies.
    assert unbuilt_client.get("/api/cross-domain/search?q=levant&limit=").json()[
        "count"
    ] == 3
    # A negative limit is `slice(0, -1)`, which drops the last row.
    assert unbuilt_client.get("/api/cross-domain/search?q=levant&limit=-1").json()[
        "count"
    ] == 2


# ── Connections ──────────────────────────────────────────────────────────────


def test_connections_for_an_unknown_entity_is_an_empty_200(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get(
        "/api/cross-domain/connections/cuisine/no-such-thing"
    ).json()
    assert body == {
        "entityId": "no-such-thing",
        "entityType": "cuisine",
        "relationships": [],
        "count": 0,
    }


def test_the_three_signals_accumulate_into_one_strength(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get(
        "/api/cross-domain/connections/cuisine/levantine"
    ).json()
    by_target = {
        item["target"]["id"]: item for item in body["relationships"]
    }
    maqam = by_target["maqam"]
    # 0.2 (one shared language) + 0.2 (identical region) + a temporal share.
    assert maqam["relationshipType"] == "shared-language"
    assert maqam["sharedAttributes"][:2] == [
        "shared languages: ara",
        "shared region: Levant",
    ]
    assert maqam["sharedAttributes"][2].endswith(" years")
    assert 0.4 < maqam["strength"] <= 1
    # A civilization has no region key at all, so only two signals can fire.
    phoenicia = by_target["phoenicia"]
    assert not any(
        attribute.startswith("shared region")
        for attribute in phoenicia["sharedAttributes"]
    )


def test_a_haplogroups_languages_are_family_ids_and_match_nothing_else(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/connections/haplogroup/j1").json()
    assert all(
        not any(
            attribute.startswith("shared languages")
            for attribute in item["sharedAttributes"]
        )
        for item in body["relationships"]
    )


def test_connections_are_strongest_first_and_honour_the_limit(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get(
        "/api/cross-domain/connections/cuisine/levantine?limit=2"
    ).json()
    strengths = [item["strength"] for item in body["relationships"]]
    assert body["count"] == 2
    assert strengths == sorted(strengths, reverse=True)


def test_a_relationship_below_the_floor_is_not_reported(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """`strength < 0.1` answers `null` — the pair is not a relationship."""
    assert (
        cross_domain.compute_relationship(
            {"associatedLanguageIds": [], "timeOrigin": None, "timeEnd": None},
            {"associatedLanguageIds": [], "timeOrigin": None, "timeEnd": None},
            now_year=2026,
        )
        is None
    )


def test_an_undated_span_runs_to_the_current_year(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """`source.timeEnd ?? new Date().getFullYear()` — an open span is live."""
    relationship = cross_domain.compute_relationship(
        {"associatedLanguageIds": [], "timeOrigin": 1000, "timeEnd": None},
        {"associatedLanguageIds": [], "timeOrigin": 1500, "timeEnd": None},
        now_year=2000,
    )
    assert relationship is not None
    assert relationship["relationshipType"] == "temporal-overlap"
    assert relationship["sharedAttributes"] == ["temporal overlap: 500 years"]


# ── by-language, by-time and summary ─────────────────────────────────────────


def test_by_language_scans_every_domain(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/by-language/ara").json()
    assert body["languageId"] == "ara"
    assert [entity["id"] for entity in body["entities"]] == [
        "levantine",
        "maqam",
        "canaanite",
        "phoenicia",
        "byblos",
    ]
    assert unbuilt_client.get("/api/cross-domain/by-language/xxx").json()["count"] == 0


def test_an_unparseable_year_segment_is_a_200_echoing_null(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    """A declared `int` path parameter would answer 422; `parseInt` gives `NaN`."""
    body = unbuilt_client.get("/api/cross-domain/by-time/soon").json()
    assert body["year"] is None
    # The three dated domains filter to nothing; the three undated ones remain.
    assert [entity["entityType"] for entity in body["entities"]] == [
        "haplogroup",
        "civilization",
        "civilization",
        "archaeological-site",
    ]


def test_by_time_dates_the_three_filtered_domains(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/by-time/-500").json()
    assert body["year"] == -500
    assert {entity["id"] for entity in body["entities"]} >= {
        "levantine",
        "maqam",
        "canaanite",
    }


def test_the_summary_counts_by_type_and_ranges_over_origins_only(
    unbuilt_client: TestClient, six_domains: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/summary").json()
    assert body["totalEntities"] == 8
    assert body["byType"] == {
        "cuisine": 2,
        "music-tradition": 1,
        "religion": 1,
        "haplogroup": 1,
        "civilization": 2,
        "archaeological-site": 1,
    }
    assert body["languageCoverage"] == 3  # ara, non, afroasiatic
    # `max` is over `timeOrigin`, so the 800 CE cuisine wins — not any end year.
    assert body["temporalRange"] == {"min": -20000, "max": 800}


def test_a_summary_with_no_dated_entity_reports_zeroes(corpus: Path) -> None:
    assert cross_domain.summarize([]) == {
        "totalEntities": 0,
        "byType": {},
        "languageCoverage": 0,
        "temporalRange": {"min": 0, "max": 0},
    }


# ── The timeline ─────────────────────────────────────────────────────────────

EMPIRE_HEADER = (
    "id\tempire_id\tempire_name\tyear\tevent_type\tterritory_change\tcapital\t"
    "population_estimate\truler\tgovernment_type\tvassal_states\t"
    "rival_empires\tassociated_language_ids\tdescription"
)
BATTLE_HEADER = (
    "id\tname\tdate\tcoordinates\tbelligerents\toutcome\tcasualties_estimate\t"
    "significance\tassociated_language_changes\twar_name"
)
ART_HEADER = (
    "id\tname\tcategory\tstyle_period\torigin_date\tend_date\t"
    "origin_coordinates\tdescription\tassociated_civilizations\t"
    "associated_languages\tkey_features\tnotable_examples"
)
MIGRATION_HEADER = (
    "id\tname\troute_type\twaypoints\tstart_date\tend_date\tpeoples\t"
    "associated_languages\tdescription\tconsequences"
)


@pytest.fixture
def timeline_corpus(six_domains: Path) -> Path:
    write(
        six_domains,
        "empires-timeline.tsv",
        EMPIRE_HEADER,
        "e1\takkad\tAkkadian Empire\t-2334\tfounding\t\t\t\t\t\t[]\t[]\t"
        '["akk"]\tSargon unites Sumer',
        "e2\takkad\tAkkadian Empire\t-2154\tcollapse\t\t\t\t\t\t[]\t[]\t"
        '["akk"]\tGutian invasion',
        "e3\tsolo\tSolo Empire\t-500\tfounding\t\t\t\t\t\t[]\t[]\t[]\tOnce",
        "e4\tbroken\tBroken Empire\tphase\tfounding\t\t\t\t\t\t[]\t[]\t[]\tX",
        "e5\tbroken\tBroken Empire\t-900\tcollapse\t\t\t\t\t\t[]\t[]\t[]\tY",
    )
    write(
        six_domains,
        "battles.tsv",
        BATTLE_HEADER,
        "b1\tKadesh\t-1274\t[0,0]\t[]\tstalemate\t\tFirst recorded treaty\t\t"
        "Egyptian-Hittite War",
        "b2\tUndated\tsometime\t[0,0]\t[]\t\t\t\t\t",
    )
    write(
        six_domains,
        "migration-routes.tsv",
        MIGRATION_HEADER,
        'm1\tSea Peoples\tmigration\t{}\t-1200\t-1150\t[]\t["ara"]\tRaids\t',
    )
    write(
        six_domains,
        "art-traditions.tsv",
        ART_HEADER,
        "a1\tMinoan Fresco\tpainting\tBronze Age\t-1700\t-1450\t"
        '{"lat":35,"lng":25}\tMarine style\t\t["grc"]\t[]\t[]',
    )
    return six_domains


def test_the_timeline_is_sorted_by_start_year_across_domains(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/timeline").json()
    years = [event["startYear"] for event in body["events"]]
    assert years == sorted(years)
    assert body["count"] == len(body["events"])
    assert body["temporalRange"]["min"] == years[0]


def test_an_undated_event_annihilates_the_whole_empire_span(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    """`Math.min(x, NaN)` is `NaN`, where Python's `min(x, nan)` is `x`.

    On the live corpus this is not an edge case: `empires-timeline.tsv` holds
    two concatenated tables and the second one's rows put a phase word where the
    year belongs, so most empires drop out on both backends.
    """
    body = unbuilt_client.get("/api/cross-domain/timeline?domains=empire").json()
    assert [event["id"] for event in body["events"]] == ["empire-akkad", "empire-solo"]
    akkad = body["events"][0]
    assert akkad["startYear"] == -2334
    assert akkad["endYear"] == -2154
    # A single-event empire has no end year rather than a zero-length span.
    assert body["events"][1]["endYear"] is None


def test_a_battle_with_an_unparseable_date_is_dropped(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    body = unbuilt_client.get("/api/cross-domain/timeline?domains=battle").json()
    assert [event["id"] for event in body["events"]] == ["battle-b1"]
    assert body["events"][0]["metadata"] == {
        "warName": "Egyptian-Hittite War",
        "outcome": "stalemate",
    }


def test_metadata_and_region_are_per_domain_keys(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    events = {
        event["domain"]: event
        for event in unbuilt_client.get("/api/cross-domain/timeline").json()["events"]
    }
    assert set(events["art-tradition"]["metadata"]) == {"category", "stylePeriod"}
    assert events["music-tradition"]["region"] == "Levant"
    assert "region" not in events["battle"]
    assert "metadata" not in events["migration"]
    # Civilizations and sites carry no description key at all.
    assert "description" not in events["civilization"]
    assert "description" not in events["archaeological-site"]


def test_the_two_bounds_are_asymmetric(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    """`yearStart` tests the end, `yearEnd` tests the start — an overlap window."""
    body = unbuilt_client.get(
        "/api/cross-domain/timeline?domains=migration&yearStart=-1160"
    ).json()
    assert body["count"] == 1  # starts -1200 but runs to -1150
    body = unbuilt_client.get(
        "/api/cross-domain/timeline?domains=migration&yearEnd=-1250"
    ).json()
    assert body["count"] == 0


def test_a_junk_bound_empties_the_timeline(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    """`>= NaN` is false for every event; the bound is not ignored."""
    body = unbuilt_client.get("/api/cross-domain/timeline?yearStart=soon").json()
    assert body == {
        "events": [],
        "domains": [],
        "temporalRange": {"min": -3000, "max": 2024},
        "count": 0,
    }


def test_a_blank_domains_parameter_selects_every_domain(
    unbuilt_client: TestClient, timeline_corpus: Path
) -> None:
    everything = unbuilt_client.get("/api/cross-domain/timeline").json()["count"]
    assert (
        unbuilt_client.get("/api/cross-domain/timeline?domains=").json()["count"]
        == everything
    )
    assert (
        unbuilt_client.get("/api/cross-domain/timeline?domains=nope").json()["count"]
        == 0
    )


def test_parse_year_takes_no_bce_marker(corpus: Path) -> None:
    """Unlike `candidates.parse_yearish`, `"500 BC"` here is the year **500**."""
    assert cross_domain_timeline.parse_year("500 BC") == 500
    assert cross_domain_timeline.parse_year("-1274") == -1274
    assert cross_domain_timeline.parse_year("  ") is None
    assert cross_domain_timeline.parse_year("sometime") is None
    assert cross_domain_timeline.parse_year(None) is None


def test_the_timeline_500_carries_the_message_and_error_pair(
    unbuilt_client: TestClient, corpus: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The inline-`routes.ts` spelling, not the extracted `{error, detail}` one."""

    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("corpus is on fire")

    monkeypatch.setattr(storage, "load_battles", boom)
    response = unbuilt_client.get("/api/cross-domain/timeline")
    assert response.status_code == 500
    assert response.json() == {
        "message": "Failed to fetch cross-domain timeline",
        "error": "corpus is on fire",
    }
