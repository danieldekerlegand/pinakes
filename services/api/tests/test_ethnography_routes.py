"""The ethnographic / material / literary reads — 35 routes (pinakes:80 US-1).

The other half of the cutover's fourth slice, graded the way
`test_domain_routes.py` and `test_linguistics_routes.py` are: no fixture in
`contracts/parity/` records any of these, so this file is what says the port
agrees with Express about which rows survive, which envelope comes back and
which of the two 404 and two 500 spellings each group uses.

Five behaviours here would be plausible either way and are only right one way:
`?parentId=null` selecting the roots of the haplogroup tree, a `social_class`
filter **keeping** the ``"all"`` rows, the lineage walks returning *edges*
(so a doubly-reachable one appears twice), `GET /api/cultural-lineages`
answering a bare array, and `?freshDays=abc` being no override rather than a
`NaN` one.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


def ids(rows: list[dict[str, Any]]) -> list[str]:
    return [row["id"] for row in rows]


# ── Haplogroups ──────────────────────────────────────────────────────────────


@pytest.fixture
def haplogroups(corpus: Path) -> Path:
    write(
        corpus,
        "haplogroups.tsv",
        "id\tname\tparent_id\tassociated_language_family_ids\ttime_origin",
        'R\tR\tnull\t["indo_european"]\t27000',
        'R1a\tR1a\tR\t["indo_european"]\t22000',
        "R1b\tR1b\tR\t[]\t20000",
        "N\tN\t\t[]\tnull",
    )
    return corpus


def test_the_string_null_selects_the_roots_and_a_blank_selects_nothing(
    unbuilt_client: TestClient, haplogroups: Path
) -> None:
    """`parentId` is presence-tested, not truthiness-tested, and compared to the
    literal ``"null"`` — which is how the client asks for the top of the tree."""
    roots = unbuilt_client.get("/api/haplogroups?parentId=null").json()
    assert ids(roots["haplogroups"]) == ["R", "N"]
    assert roots["filters"] == {"parentId": "null"}
    blank = unbuilt_client.get("/api/haplogroups?parentId=").json()
    assert blank["count"] == 0
    assert blank["filters"] == {"parentId": ""}


def test_older_than_reads_years_before_present_and_drops_the_undated(
    unbuilt_client: TestClient, haplogroups: Path
) -> None:
    body = unbuilt_client.get("/api/haplogroups?olderThan=22000").json()
    assert ids(body["haplogroups"]) == ["R1a", "R1b"]
    assert body["filters"] == {"olderThan": 22000}


def test_an_unparseable_older_than_echoes_null_and_matches_nothing(
    unbuilt_client: TestClient, haplogroups: Path
) -> None:
    """`parseInt("soon")` is `NaN`: every `<=` against it is false, and
    `JSON.stringify` writes it as `null` — which `JSONResponse` cannot do at all
    unless the handler converts it first."""
    body = unbuilt_client.get("/api/haplogroups?olderThan=soon").json()
    assert body["count"] == 0
    assert body["filters"] == {"olderThan": None}


def test_the_tree_route_outranks_the_id_route(
    unbuilt_client: TestClient, haplogroups: Path
) -> None:
    """Registration order is routing here, as it was on Express."""
    body = unbuilt_client.get("/api/haplogroups/tree").json()
    assert set(body) == {"haplogroups", "count"}
    assert body["count"] == 4


def test_a_haplogroup_carries_its_direct_children_and_their_count(
    unbuilt_client: TestClient, haplogroups: Path
) -> None:
    body = unbuilt_client.get("/api/haplogroups/R").json()
    assert body["haplogroup"]["id"] == "R"
    assert ids(body["children"]) == ["R1a", "R1b"]
    assert body["childCount"] == 2
    response = unbuilt_client.get("/api/haplogroups/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Haplogroup 'nope' not found"}


# ── Building types, and the retirement that outranks them ────────────────────


@pytest.fixture
def building_types(corpus: Path) -> Path:
    write(
        corpus,
        "building-types.tsv",
        "id\tname\tcategory\tparent_type_id\tdescription\thistorical_period"
        "\tregions\tassociated_styles\tstructural_features\tcultural_function",
        'ziggurat\tZiggurat\tReligious\t\t-\t-\t["Mesopotamia"]\t[]\t[]\ttemple',
        "insula\tInsula\tdomestic\t\t-\t-\t[]\t[]\t[]\thousing",
    )
    return corpus


def test_the_retired_categories_route_outranks_the_building_type_id_route(
    unbuilt_client: TestClient, building_types: Path
) -> None:
    """`routers/retired.py` owns this path, but sorts *after* `ethnography` in
    the discovery order — so without the local re-registration the `{id}`
    wildcard would swallow it and answer a 404."""
    response = unbuilt_client.get("/api/building-types/categories")
    assert response.status_code == 501
    body = response.json()
    assert body["error"] == "retired"
    assert body["route"] == "GET /api/building-types/categories"
    assert body["categories"] == ["building-types"]


def test_a_building_type_category_is_case_folded_and_whole(
    unbuilt_client: TestClient, building_types: Path
) -> None:
    body = unbuilt_client.get("/api/building-types?category=religious").json()
    assert set(body) == {"buildingTypes", "count"}
    assert ids(body["buildingTypes"]) == ["ziggurat"]
    assert unbuilt_client.get("/api/building-types?category=relig").json()["count"] == 0


def test_a_missing_building_type_is_a_bare_404(
    unbuilt_client: TestClient, building_types: Path
) -> None:
    response = unbuilt_client.get("/api/building-types/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Building type not found"}


# ── City layouts and the culture-profile sub-resource ────────────────────────


@pytest.fixture
def city_layouts(corpus: Path) -> Path:
    write(
        corpus,
        "city-layouts.tsv",
        "id\tsettlement_id\tculture_profile_id\tlayout_type\tkey_features",
        "l1\turuk\tsumer\tOrganic\tziggurat | walls",
        "l2\tmohenjo\tharappa\tgrid\tdrains",
    )
    return corpus


def test_the_live_city_layouts_handler_does_not_read_settlement_id(
    unbuilt_client: TestClient, city_layouts: Path
) -> None:
    """`routes.ts` registers this path twice; the first registration wins and it
    has no `settlement_id` filter, so the parameter is simply ignored."""
    both = unbuilt_client.get("/api/city-layouts?settlement_id=uruk").json()
    assert both["count"] == 2


def test_city_layout_filters_are_case_folded_unlike_social_structures(
    unbuilt_client: TestClient, city_layouts: Path
) -> None:
    body = unbuilt_client.get("/api/city-layouts?culture_profile_id=SUMER").json()
    assert ids(body["layouts"]) == ["l1"]
    assert ids(
        unbuilt_client.get("/api/city-layouts?layout_type=organic").json()["layouts"]
    ) == ["l1"]


def test_the_culture_profile_layout_sub_resource_shares_the_envelope(
    unbuilt_client: TestClient, city_layouts: Path
) -> None:
    body = unbuilt_client.get("/api/culture-profiles/sumer/city-layouts").json()
    assert body == {
        "layouts": [
            layout
            for layout in unbuilt_client.get("/api/city-layouts").json()["layouts"]
            if layout["id"] == "l1"
        ],
        "count": 1,
    }


# ── Social organisation and structures ───────────────────────────────────────


@pytest.fixture
def social(corpus: Path) -> Path:
    write(
        corpus,
        "social-organization.tsv",
        "id\tname\tculture_or_language\tregion\tpolitical_structure"
        "\tstratification_type\tsubsistence_pattern\tmarriage_system"
        "\tdescent_system\tresidence_pattern\tkinship_terminology"
        "\tproperty_inheritance",
        "so1\tNuer\tnuer\tEast Africa\tsegmentary lineage\tegalitarian"
        "\tpastoralism\tpolygyny\tpatrilineal\tvirilocal\tomaha\tsons",
        "so2\tHopi\thopi\tSouthwest\tvillage council\tegalitarian"
        "\thorticulture\tmonogamy\tmatrilineal\tuxorilocal\tcrow\tdaughters",
    )
    write(
        corpus,
        "social-structures.tsv",
        "id\tculture_profile_id\tstructure_type\tname\tdescription\tkey_roles"
        "\tinheritance_pattern\tdecision_making\trelated_kinship_system_id"
        "\ttime_period_start\ttime_period_end\tsources",
        "ss1\tsumer\tclass\tEn\t-\ten|lugal\t-\t-\t\t\t\t",
        "ss2\tharappa\tguild\tPotters\t-\t\t-\t-\t\t\t\t",
    )
    return corpus


def test_social_organization_mixes_three_substrings_with_one_exact_filter(
    unbuilt_client: TestClient, social: Path
) -> None:
    """`descentSystem` is the exact one — its vocabulary is closed where the
    other three are prose."""
    body = unbuilt_client.get(
        "/api/social-organization?political_structure=SEGMENT"
    ).json()
    assert set(body) == {"organizations", "count"}
    assert ids(body["organizations"]) == ["so1"]
    assert (
        unbuilt_client.get("/api/social-organization?descent_system=Patrilineal").json()[
            "count"
        ]
        == 0
    )
    assert ids(
        unbuilt_client.get("/api/social-organization?region=africa").json()[
            "organizations"
        ]
    ) == ["so1"]


def test_social_structure_filters_are_exact_and_its_500_omits_the_error(
    unbuilt_client: TestClient, corpus: Path, social: Path
) -> None:
    assert (
        unbuilt_client.get("/api/social-structures?culture_profile_id=SUMER").json()[
            "count"
        ]
        == 0
    )
    response = unbuilt_client.get("/api/social-structures/nope")
    assert response.json() == {"message": "Social structure 'nope' not found"}
    write(corpus, "social-structures.tsv", "culture_profile_id", "sumer")
    broken = unbuilt_client.get("/api/social-structures")
    assert broken.status_code == 500
    assert broken.json() == {"message": "Failed to fetch social structures"}


# ── Daily life ───────────────────────────────────────────────────────────────


@pytest.fixture
def daily_life(corpus: Path) -> Path:
    write(
        corpus,
        "daily-life.tsv",
        "id\tculture_profile_id\tcategory\ttitle\tdescription\tsocial_class"
        "\tgender_context\tage_group\tseason\ttime_period_start"
        "\ttime_period_end\tsources",
        "d1\tsumer\tfood\tBread\t-\tall\tall\tadult\t\t\t\t[]",
        "d2\tsumer\tfood\tBanquet\t-\telite\tmale\tadult\t\t\t\t[]",
        "d3\tsumer\twork\tWeaving\t-\tcommoner\tfemale\tadult\t\t\t\t[]",
    )
    return corpus


def test_a_social_class_filter_keeps_the_rows_marked_all(
    unbuilt_client: TestClient, daily_life: Path
) -> None:
    """Most of this table is ``"all"``; an exact match would empty every query."""
    body = unbuilt_client.get("/api/daily-life?social_class=elite").json()
    assert set(body) == {"entries", "count"}
    assert ids(body["entries"]) == ["d1", "d2"]
    assert ids(
        unbuilt_client.get("/api/daily-life?gender_context=female").json()["entries"]
    ) == ["d1", "d3"]


def test_a_daily_life_category_is_exact_and_case_sensitive(
    unbuilt_client: TestClient, daily_life: Path
) -> None:
    assert unbuilt_client.get("/api/daily-life?category=Food").json()["count"] == 0
    assert unbuilt_client.get("/api/daily-life?category=food").json()["count"] == 2


def test_the_culture_daily_life_sub_resource_groups_by_category_uncounted(
    unbuilt_client: TestClient, daily_life: Path
) -> None:
    body = unbuilt_client.get("/api/culture-profiles/sumer/daily-life").json()
    assert set(body) == {"cultureProfileId", "categories"}
    assert {key: ids(rows) for key, rows in body["categories"].items()} == {
        "food": ["d1", "d2"],
        "work": ["d3"],
    }
    assert unbuilt_client.get("/api/culture-profiles/zzz/daily-life").json() == {
        "cultureProfileId": "zzz",
        "categories": {},
    }


# ── Rivers and waters ────────────────────────────────────────────────────────


@pytest.fixture
def rivers(corpus: Path) -> Path:
    write(
        corpus,
        "rivers-and-waters.tsv",
        "id\tname\twater_type\tregion\ttime_start\ttime_end"
        "\thistorical_importance\tlength_km",
        "nile\tNile\triver\tNortheast Africa\t-5000\t2100\tcritical\t6650",
        "tigris\tTigris\tRiver\tMesopotamia\t-4000\t-500\thigh\t1850",
        "undated\tUnnamed Wadi\twadi\tArabia\t\t\tlow\t",
    )
    return corpus


def test_an_undated_water_feature_survives_every_temporal_bound(
    unbuilt_client: TestClient, rivers: Path
) -> None:
    """Both bounds carry an explicit null escape rather than an infinity
    substitution — the opposite default from the archaeological-culture filter."""
    assert ids(
        unbuilt_client.get("/api/rivers-and-waters?time_start=0").json()["features"]
    ) == ["nile", "undated"]
    assert ids(
        unbuilt_client.get("/api/rivers-and-waters?time_end=-3000").json()["features"]
    ) == ["nile", "tigris", "undated"]
    assert ids(
        unbuilt_client.get("/api/rivers-and-waters?time_start=0&time_end=-3000").json()[
            "features"
        ]
    ) == ["nile", "undated"]


def test_a_water_type_is_folded_and_a_historical_importance_is_not(
    unbuilt_client: TestClient, rivers: Path
) -> None:
    body = unbuilt_client.get("/api/rivers-and-waters?water_type=RIVER").json()
    assert set(body) == {"features", "count"}
    assert ids(body["features"]) == ["nile", "tigris"]
    assert (
        unbuilt_client.get("/api/rivers-and-waters?historical_importance=High").json()[
            "count"
        ]
        == 0
    )


def test_a_missing_water_feature_is_a_bare_404_with_no_error_key(
    unbuilt_client: TestClient, rivers: Path
) -> None:
    response = unbuilt_client.get("/api/rivers-and-waters/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "River/water feature not found"}


# ── Cultural lineages ────────────────────────────────────────────────────────


@pytest.fixture
def lineages(corpus: Path) -> Path:
    write(
        corpus,
        "cultural-lineages.tsv",
        "id\tsource_id\ttarget_id\trelationship_type\tconfidence",
        "n1\tsumer\takkad\tdescended_from\t80",
        "n2\takkad\tbabylon\tdescended_from\t70",
        "n3\tsumer\tbabylon\tinfluenced\t50",
        "n4\tbabylon\tassyria\tdescended_from\t60",
    )
    return corpus


def test_cultural_lineages_answer_a_bare_array(
    unbuilt_client: TestClient, lineages: Path
) -> None:
    """Alone in the slice: no count, no filters envelope."""
    body = unbuilt_client.get("/api/cultural-lineages").json()
    assert isinstance(body, list)
    assert ids(body) == ["n1", "n2", "n3", "n4"]
    assert ids(
        unbuilt_client.get("/api/cultural-lineages?source_id=sumer").json()
    ) == ["n1", "n3"]


def test_the_descendant_walk_returns_edges_so_a_doubled_path_repeats(
    unbuilt_client: TestClient, lineages: Path
) -> None:
    """`babylon` is reachable from `sumer` two ways, and both edges into it are
    collected — only the *entities* are visited-once."""
    body = unbuilt_client.get("/api/cultural-lineages/descendants/sumer").json()
    assert body["entityId"] == "sumer"
    assert ids(body["lineages"]) == ["n1", "n3", "n2", "n4"]
    assert body["count"] == 4


def test_max_depth_counts_rounds_of_expansion_and_zero_returns_nothing(
    unbuilt_client: TestClient, lineages: Path
) -> None:
    assert ids(
        unbuilt_client.get(
            "/api/cultural-lineages/descendants/sumer?maxDepth=1"
        ).json()["lineages"]
    ) == ["n1", "n3"]
    assert (
        unbuilt_client.get(
            "/api/cultural-lineages/descendants/sumer?maxDepth=0"
        ).json()["count"]
        == 0
    )


def test_an_unparseable_max_depth_is_nan_and_bounds_nothing(
    unbuilt_client: TestClient, lineages: Path
) -> None:
    """`parseInt("abc")` is `NaN` and `depth < NaN` is false on the first
    round — so a junk depth is an *empty* walk, not the 20-round default."""
    assert (
        unbuilt_client.get(
            "/api/cultural-lineages/descendants/sumer?maxDepth=abc"
        ).json()["count"]
        == 0
    )
    assert (
        unbuilt_client.get(
            "/api/cultural-lineages/descendants/sumer?maxDepth="
        ).json()["count"]
        == 4
    )


def test_the_ancestor_walk_climbs_the_other_way(
    unbuilt_client: TestClient, lineages: Path
) -> None:
    body = unbuilt_client.get("/api/cultural-lineages/ancestors/assyria").json()
    assert ids(body["lineages"]) == ["n4", "n2", "n3", "n1"]


def test_a_missing_lineage_is_a_templated_404(
    unbuilt_client: TestClient, lineages: Path
) -> None:
    response = unbuilt_client.get("/api/cultural-lineages/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Cultural lineage 'nope' not found"}


# ── Literature ───────────────────────────────────────────────────────────────


@pytest.fixture
def literature(corpus: Path) -> Path:
    write(
        corpus,
        "literary-traditions.tsv",
        "id\tname\tregion\torigin_date\tend_date\torigin_coordinates"
        "\tassociated_language_ids\tgenre_focus\tkey_themes\tdescription"
        "\tnotable_authors\tinfluences\tsources",
        'akkadian\tAkkadian\tMesopotamia\t-2500\tnull\t{"lat":32,"lng":45}'
        '\t["akk"]\t["epic","hymn"]\t[]\t-\t[]\t[]\t[]',
        'greek\tGreek\tAegean\t-800\t-146\t{"lat":38,"lng":23}'
        '\t["grc"]\t["epic"]\t[]\t-\t[]\t[]\t[]',
    )
    write(
        corpus,
        "literary-works.tsv",
        "id\ttitle\tauthor\ttradition_id\tlanguage_id\tdate_composed"
        "\tdate_published\tgenre\tform\tdescription\tsignificance"
        "\toriginal_script\tcoordinates",
        "gilgamesh\tGilgamesh\t-\takkadian\takk\t-2100\tnull\tepic\tverse"
        "\t-\t-\tcuneiform\t{}",
        "iliad\tIliad\tHomer\tgreek\tgrc\t-750\tnull\tepic\tverse"
        "\t-\t-\tgreek\t{}",
    )
    return corpus


def test_a_literary_tradition_carries_its_works_and_their_count(
    unbuilt_client: TestClient, literature: Path
) -> None:
    body = unbuilt_client.get("/api/literary-traditions/akkadian").json()
    assert set(body) == {"tradition", "works", "workCount"}
    assert body["tradition"]["id"] == "akkadian"
    assert ids(body["works"]) == ["gilgamesh"]
    assert body["workCount"] == 1


def test_a_missing_literary_tradition_is_a_bare_404(
    unbuilt_client: TestClient, literature: Path
) -> None:
    response = unbuilt_client.get("/api/literary-traditions/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Literary tradition not found"}


def test_a_tradition_region_is_exact_and_its_genre_is_a_membership_test(
    unbuilt_client: TestClient, literature: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/literary-traditions?genre=hymn").json()["traditions"]
    ) == ["akkadian"]
    assert (
        unbuilt_client.get("/api/literary-traditions?region=mesopotamia").json()[
            "count"
        ]
        == 0
    )


def test_a_literary_work_end_date_of_the_string_null_is_absent(
    unbuilt_client: TestClient, literature: Path
) -> None:
    iliad = unbuilt_client.get("/api/literary-works/iliad").json()
    assert iliad["datePublished"] is None
    assert (
        unbuilt_client.get("/api/literary-traditions/akkadian").json()["tradition"][
            "endDate"
        ]
        is None
    )


# ── Narratives ───────────────────────────────────────────────────────────────


def test_narratives_take_no_filters_at_all(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "narratives.tsv",
        "id\ttitle\tdescription\tsteps",
        "n1\tSilk Road\t-\t[]",
    )
    body = unbuilt_client.get("/api/narratives?id=nope").json()
    assert set(body) == {"narratives", "count"}
    assert body["count"] == 1
    response = unbuilt_client.get("/api/narratives/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Narrative not found"}


# ── Culture-profile sub-resources ────────────────────────────────────────────


def test_evolution_events_come_back_oldest_first(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "culture-events.tsv",
        "id\tculture_profile_id\tyear\tlane\tevent_type\ttitle\tdescription"
        "\tmagnitude\tsources",
        "e1\tsumer\t-2300\tpolitical\tconquest\tAkkad\t-\tmajor\t[]",
        "e2\tsumer\t-3100\tpolitical\tfounding\tUruk\t-\tmajor\t[]",
        "e3\tharappa\t-2600\turban\tfounding\tMohenjo\t-\tmajor\t[]",
    )
    body = unbuilt_client.get("/api/culture-profiles/sumer/evolution-events").json()
    assert set(body) == {"cultureProfileId", "events", "count"}
    assert ids(body["events"]) == ["e2", "e1"]
    assert unbuilt_client.get(
        "/api/culture-profiles/zzz/evolution-events"
    ).json() == {"cultureProfileId": "zzz", "events": [], "count": 0}


def test_socio_cultural_resolves_references_and_drops_the_dangling_ones(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """An id that names nothing is simply absent from the resolved list; the
    profile is never rejected for a dangling reference."""
    write(
        corpus,
        "culture-profiles.tsv",
        "id\tname\tcivilization_id\tassociated_language_ids"
        "\tassociated_religion_ids\tassociated_writing_system_ids"
        "\tnotable_settlements",
        'sumer\tSumer\tsumer\t["akk","zzz"]\t["mesopotamian"]\t["cuneiform"]'
        '\t["Uruk"]',
    )
    write(
        corpus,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus",
        "akk\tAkkadian\tafro_asiatic\textinct",
    )
    write(
        corpus,
        "religions.tsv",
        "id\tname\treligion_type",
        "mesopotamian\tMesopotamian\tpolytheistic",
    )
    write(corpus, "writing-systems.tsv", "id\tname", "cuneiform\tCuneiform")
    write(
        corpus,
        "settlements.tsv",
        "id\tname\tcivilization_id\tlatitude\tlongitude",
        "uruk\turuk\tzzz\t31.32\t45.64",
        "kish\tKish\tsumer\t32.54\t44.6",
        "athens\tAthens\tgreece\t37.98\t23.72",
    )
    body = unbuilt_client.get("/api/culture-profiles/sumer/socio-cultural").json()
    assert set(body) == {
        "profile",
        "languages",
        "religions",
        "writingSystems",
        "settlements",
    }
    assert body["languages"] == [{"id": "akk", "name": "Akkadian"}]
    assert body["religions"] == [{"id": "mesopotamian", "name": "Mesopotamian"}]
    assert body["writingSystems"] == [{"id": "cuneiform", "name": "Cuneiform"}]
    # `uruk` matches by case-folded *name*, `kish` by shared `civilizationId`.
    assert ids(body["settlements"]) == ["uruk", "kish"]


def test_an_unknown_culture_profile_socio_cultural_is_a_bare_404(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "culture-profiles.tsv", "id\tname", "sumer\tSumer")
    response = unbuilt_client.get("/api/culture-profiles/zzz/socio-cultural")
    assert response.status_code == 404
    assert response.json() == {"message": "Culture profile not found"}


# ── Corpus freshness ─────────────────────────────────────────────────────────


def test_data_freshness_names_and_counts_every_tsv(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "sample-texts.tsv", "id\tlanguage_id", "t1\takk", "t2\tgrc")
    write(corpus, "narratives.tsv", "id\ttitle\tdescription\tsteps")
    (corpus / "notes.md").write_text("ignored\n", encoding="utf-8")
    body = unbuilt_client.get("/api/data-freshness").json()
    assert [entry["file"] for entry in body["datasets"]] == [
        "narratives.tsv",
        "sample-texts.tsv",
    ]
    assert [entry["name"] for entry in body["datasets"]] == [
        "Narratives",
        "Sample Texts",
    ]
    assert [entry["recordCount"] for entry in body["datasets"]] == [0, 2]
    assert body["totalDatasets"] == 2
    assert body["totalRecords"] == 2
    assert body["freshCount"] == 2
    assert body["generatedAt"].endswith("Z")


def test_a_zero_or_unparseable_threshold_is_no_override_at_all(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`freshDays || agingDays` is JavaScript-truthy: `0` is falsy, and so is
    `NaN` — which Python disagrees about, so a junk parameter would otherwise
    make every file `stale`."""
    write(corpus, "sample-texts.tsv", "id\tlanguage_id", "t1\takk")
    for query in ("", "?freshDays=0", "?freshDays=abc", "?agingDays=abc"):
        body = unbuilt_client.get(f"/api/data-freshness{query}").json()
        assert body["datasets"][0]["staleness"] == "fresh", query
    narrowed = unbuilt_client.get("/api/data-freshness?agingDays=0.0001").json()
    assert narrowed["datasets"][0]["staleness"] == "fresh"


def test_a_missing_corpus_is_an_empty_freshness_report(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """Unlike `/api/data-quality`, which 500s — this one is a dashboard tile and
    an empty tile is an honest one."""
    body = unbuilt_client.get("/api/data-freshness").json()
    assert body["datasets"] == []
    assert body["oldestDataset"] is None
    assert body["newestDataset"] is None


# ── Wikimedia Commons images ─────────────────────────────────────────────────


def test_commons_images_are_empty_when_the_file_is_absent(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Which is the state of this checkout, and of both backends' live answer."""
    assert unbuilt_client.get("/api/wikimedia-commons-images").json() == {
        "images": [],
        "count": 0,
    }


def test_commons_filters_are_two_substrings_around_one_whole_value(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "wikimedia-commons-images.tsv",
        "id\ttitle\timage_url\tassociated_culture\tartifact_type\tregion",
        "w1\tVase\thttps://x/1\tSumerian\tpottery\tMesopotamia",
        "w2\tStele\thttps://x/2\tAkkadian\tsculpture\tMesopotamia",
    )
    assert ids(
        unbuilt_client.get("/api/wikimedia-commons-images?culture=sumer").json()[
            "images"
        ]
    ) == ["w1"]
    assert ids(
        unbuilt_client.get(
            "/api/wikimedia-commons-images?artifact_type=POTTERY"
        ).json()["images"]
    ) == ["w1"]
    assert (
        unbuilt_client.get("/api/wikimedia-commons-images?artifact_type=pot").json()[
            "count"
        ]
        == 0
    )
    assert (
        unbuilt_client.get("/api/wikimedia-commons-images?region=MESO").json()["count"]
        == 2
    )


# ── The two 500 shapes, side by side ─────────────────────────────────────────


def test_the_two_500_spellings_live_in_this_one_file(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`social-structures` answers `{message}` and `narratives` answers
    `{message, error}`, for the same class of broken corpus. Express's split."""
    write(corpus, "social-structures.tsv", "culture_profile_id", "sumer")
    write(corpus, "narratives.tsv", "title\tdescription", "Tour\t-")
    plain = unbuilt_client.get("/api/social-structures")
    detailed = unbuilt_client.get("/api/narratives")
    assert plain.status_code == detailed.status_code == 500
    assert set(plain.json()) == {"message"}
    assert set(detailed.json()) == {"message", "error"}


@pytest.mark.parametrize(
    ("path", "key"),
    [
        ("/api/haplogroups", "haplogroups"),
        ("/api/dance-traditions", "traditions"),
        ("/api/cooking-techniques", "cookingTechniques"),
        ("/api/art-style-evolutions", "evolutions"),
        ("/api/building-types", "buildingTypes"),
        ("/api/city-layouts", "layouts"),
        ("/api/social-organization", "organizations"),
        ("/api/social-structures", "structures"),
        ("/api/daily-life", "entries"),
        ("/api/rivers-and-waters", "features"),
        ("/api/literary-traditions", "traditions"),
        ("/api/literary-works", "works"),
        ("/api/narratives", "narratives"),
    ],
)
def test_an_absent_file_is_an_empty_domain_rather_than_a_500(
    unbuilt_client: TestClient, corpus: Path, path: str, key: str
) -> None:
    body = unbuilt_client.get(path).json()
    assert body[key] == []
    assert body["count"] == 0
