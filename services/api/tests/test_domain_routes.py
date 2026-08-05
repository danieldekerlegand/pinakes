"""The flat catalog domains — forty routes over eighteen TSVs (pinakes:80 US-1).

No fixture in `contracts/parity/` records any of these, so this file *is* the
grading. What it asserts is what a live diff against Express proved and a shape
check never could: which rows survive each filter, what the `filters` echo emits
for a blank and for a malformed parameter, and which of the two 404 and two 500
spellings each group uses.

`conftest.py`'s autouse `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at
an empty temp tree, so every test seeds its own TSVs — row counts against the
live corpus belong in `test_lexicon_storage.py`, not here.
"""

from __future__ import annotations

import json
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


# ── Religions ────────────────────────────────────────────────────────────────

RELIGION_HEADER = (
    "id\tname\treligion_type\torigin_region\ttime_origin\ttime_end\t"
    "associated_language_ids"
)


@pytest.fixture
def religions(corpus: Path) -> Path:
    write(
        corpus,
        "religions.tsv",
        RELIGION_HEADER,
        'vedic\tVedic\tpolytheistic\tSouth Asia\t-1500\t-500\t["san"]',
        'zoro\tZoroastrianism\tdualistic\tIranian Plateau\t-1200\t\t["ave"]',
        'olympian\tOlympian\tPolytheistic\tAegean\t\t-100\t["grc"]',
    )
    return corpus


def test_religions_answers_the_three_key_envelope(
    unbuilt_client: TestClient, religions: Path
) -> None:
    body = unbuilt_client.get("/api/religions").json()
    assert set(body) == {"religions", "count", "filters"}
    assert body["count"] == 3
    assert body["filters"] == {}


def test_a_year_matches_an_open_ended_period_at_either_end(
    unbuilt_client: TestClient, religions: Path
) -> None:
    """`timeOrigin ?? -Infinity` and `timeEnd ?? Infinity`, nullish both ways."""
    assert ids(unbuilt_client.get("/api/religions?year=-800").json()["religions"]) == [
        "vedic",
        "zoro",
        "olympian",
    ]
    assert ids(unbuilt_client.get("/api/religions?year=1900").json()["religions"]) == [
        "zoro"
    ]


def test_a_malformed_year_empties_the_result_and_echoes_null(
    unbuilt_client: TestClient, religions: Path
) -> None:
    """`parseInt("soon")` is `NaN`: present (so the filter applies) and matching
    nothing, and `JSON.stringify` writes it as `null`."""
    body = unbuilt_client.get("/api/religions?year=soon").json()
    assert body["count"] == 0
    assert body["filters"] == {"year": None}


def test_a_blank_parameter_filters_nothing_but_still_echoes(
    unbuilt_client: TestClient, religions: Path
) -> None:
    """`""` is falsy in JavaScript, so `?year=&region=` is no filter at all.

    The echo is where the two part company, and it is the difference between
    `undefined` and `""`: `year` was read through `req.query.year ? parseInt(…)
    : undefined` and so emits **no key**, while `region` was read raw and so
    comes back as the empty string it was.
    """
    body = unbuilt_client.get("/api/religions?year=&region=").json()
    assert body["count"] == 3
    assert body["filters"] == {"region": ""}


def test_a_parsed_year_echoes_as_an_integer(
    unbuilt_client: TestClient, religions: Path
) -> None:
    """`parseInt` yields a Python float; `50.0` on the wire is not Express's."""
    raw = unbuilt_client.get("/api/religions?year=-800").text
    assert '"year":-800' in raw


def test_region_is_a_substring_of_origin_region_but_type_is_exact(
    unbuilt_client: TestClient, religions: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/religions?region=south").json()["religions"]
    ) == ["vedic"]
    assert ids(
        unbuilt_client.get("/api/religions?religionType=polytheistic").json()[
            "religions"
        ]
    ) == ["vedic"]


def test_language_id_matches_a_whole_entry_of_the_array(
    unbuilt_client: TestClient, religions: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/religions?languageId=grc").json()["religions"]
    ) == ["olympian"]


def test_a_missing_religion_names_the_id_in_its_404(
    unbuilt_client: TestClient, religions: Path
) -> None:
    response = unbuilt_client.get("/api/religions/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Religion 'nope' not found"}


# ── Mythology ────────────────────────────────────────────────────────────────

DEITY_HEADER = "id\tname\tpantheon\tdomain\ttime_origin\ttime_end\tequivalent_deity_ids"
MOTIF_HEADER = "id\tname\tmotif_type\tassociated_deity_ids"


@pytest.fixture
def mythology(corpus: Path) -> Path:
    write(
        corpus,
        "deities.tsv",
        DEITY_HEADER,
        'zeus\tZeus\tGreek\t["Sky","Thunder"]\t-800\t400\t["jupiter"]',
        'jupiter\tJupiter\tRoman\t["Sky"]\t-500\t400\t[]',
        'indra\tIndra\tVedic\t["Storm"]\t-1500\t\t[]',
    )
    write(
        corpus,
        "myth-motifs.tsv",
        MOTIF_HEADER,
        'flood\tGreat Flood\tcatastrophe\t["zeus","indra"]',
        'theft\tTheft of Fire\ttrickster\t["prometheus"]',
    )
    return corpus


def test_mythology_is_case_insensitive_and_whole_but_domain_is_a_substring(
    unbuilt_client: TestClient, mythology: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/deities?mythology=greek").json()["deities"]
    ) == ["zeus"]
    assert unbuilt_client.get("/api/deities?mythology=gree").json()["count"] == 0
    assert ids(unbuilt_client.get("/api/deities?domain=sky").json()["deities"]) == [
        "zeus",
        "jupiter",
    ]


def test_equivalents_are_read_off_the_subject_not_searched_for(
    unbuilt_client: TestClient, mythology: Path
) -> None:
    """One-directional: Zeus names Jupiter, Jupiter names nobody."""
    assert ids(
        unbuilt_client.get("/api/deities/zeus/equivalents").json()["equivalents"]
    ) == ["jupiter"]
    assert unbuilt_client.get("/api/deities/jupiter/equivalents").json() == {
        "equivalents": [],
        "count": 0,
    }


def test_an_unknown_deity_is_an_empty_list_on_both_sub_resources(
    unbuilt_client: TestClient, mythology: Path
) -> None:
    """Neither sub-resource reads the deity, so neither can 404 — as on Express."""
    assert unbuilt_client.get("/api/deities/nope/equivalents").status_code == 200
    assert unbuilt_client.get("/api/deities/nope/motifs").json() == {
        "motifs": [],
        "count": 0,
    }


def test_motifs_by_deity_reads_the_motif_side_of_the_join(
    unbuilt_client: TestClient, mythology: Path
) -> None:
    assert ids(unbuilt_client.get("/api/deities/indra/motifs").json()["motifs"]) == [
        "flood"
    ]


def test_the_deity_sub_resources_do_not_shadow_the_deity_route(
    unbuilt_client: TestClient, mythology: Path
) -> None:
    assert unbuilt_client.get("/api/deities/zeus").json()["name"] == "Zeus"


# ── Cuisines ─────────────────────────────────────────────────────────────────


@pytest.fixture
def cuisines(corpus: Path) -> Path:
    write(
        corpus,
        "cuisines.tsv",
        "id\tname\tregion\ttime_origin\ttime_end",
        "peruvian\tPeruvian\tSouth America\t-1000\t",
        "roman\tRoman\tMediterranean\t-500\t476",
    )
    write(
        corpus,
        "cuisine-items.tsv",
        "id\tcuisine_id\tname\tfood_type\ttime_origin\ttime_end",
        "ceviche\tperuvian\tCeviche\tdish\t-500\t",
        "garum\troman\tGarum\tcondiment\t-300\t476",
        "chicha\tperuvian\tChicha\tbeverage\t1500\t",
    )
    return corpus


def test_a_cuisine_spreads_its_pair_and_counts_its_items(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    body = unbuilt_client.get("/api/cuisines/peruvian").json()
    assert set(body) == {"cuisine", "items", "itemCount", "filters"}
    assert body["cuisine"]["id"] == "peruvian"
    assert body["itemCount"] == 2


def test_a_dated_cuisine_filters_only_its_items(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    body = unbuilt_client.get("/api/cuisines/peruvian?year=0").json()
    assert ids(body["items"]) == ["ceviche"]
    assert body["itemCount"] == 1
    assert body["filters"] == {"year": 0}


def test_the_cuisine_id_filter_is_exact_where_food_type_is_a_substring(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    assert unbuilt_client.get("/api/cuisine-items?cuisineId=peru").json()["count"] == 0
    assert ids(
        unbuilt_client.get("/api/cuisine-items?foodType=DISH").json()["items"]
    ) == ["ceviche"]


def test_a_missing_cuisine_names_the_id(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    response = unbuilt_client.get("/api/cuisines/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Cuisine 'nope' not found"}


# ── Music ────────────────────────────────────────────────────────────────────


@pytest.fixture
def music(corpus: Path) -> Path:
    write(
        corpus,
        "music-traditions.tsv",
        "id\tname\tregion\ttime_origin\ttime_end\tassociated_language_ids",
        'carnatic\tCarnatic\tSouth India\t1200\t\t["tam"]',
        'gagaku\tGagaku\tJapan\t700\t\t["jpn"]',
    )
    write(
        corpus,
        "musical-instruments.tsv",
        "id\tname\tinstrument_family\ttime_origin\tassociated_tradition_ids",
        'veena\tVeena\tchordophone\t-1000\t["carnatic"]',
        'shou\tShō\taerophone\t700\t["gagaku"]',
        "lyre\tLyre\tchordophone\t\t[]",
    )
    return corpus


def test_a_tradition_joins_on_the_instruments_tradition_ids(
    unbuilt_client: TestClient, music: Path
) -> None:
    body = unbuilt_client.get("/api/music-traditions/carnatic").json()
    assert set(body) == {"tradition", "instruments", "instrumentCount"}
    assert ids(body["instruments"]) == ["veena"]
    assert body["instrumentCount"] == 1


def test_older_than_is_a_ceiling_on_time_origin_and_excludes_the_undated(
    unbuilt_client: TestClient, music: Path
) -> None:
    """An instrument with no recorded origin is dropped, not treated as ancient."""
    body = unbuilt_client.get("/api/musical-instruments?olderThan=0").json()
    assert ids(body["instruments"]) == ["veena"]
    assert body["filters"] == {"olderThan": 0}


def test_the_instrument_family_folds_case(
    unbuilt_client: TestClient, music: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/musical-instruments?family=CHORDOPHONE").json()[
            "instruments"
        ]
    ) == ["veena", "lyre"]


# ── Writing systems ──────────────────────────────────────────────────────────


@pytest.fixture
def writing_systems(corpus: Path) -> Path:
    write(
        corpus,
        "writing-systems.tsv",
        "id\tname\ttype\tdirection\tparent_system_id\tis_active",
        "phoenician\tPhoenician\tabjad\trtl\t\tfalse",
        "greek\tGreek\talphabet\tltr\tphoenician\ttrue",
        "latin\tLatin\talphabet\tltr\tgreek\ttrue",
        "cyrillic\tCyrillic\talphabet\tltr\tgreek\ttrue",
    )
    return corpus


def test_writing_systems_answer_two_keys_with_no_filters_echo(
    unbuilt_client: TestClient, writing_systems: Path
) -> None:
    assert set(unbuilt_client.get("/api/writing-systems").json()) == {
        "systems",
        "count",
    }


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("?is_active=true", ["greek", "latin", "cyrillic"]),
        ("?is_active=false", ["phoenician"]),
        # `!== undefined`, not truthiness: a *blank* parameter still filters,
        # and `"" === "true"` is false — so it selects the inactive systems.
        ("?is_active=", ["phoenician"]),
        ("?is_active=yes", ["phoenician"]),
    ],
)
def test_is_active_is_tested_for_presence_not_truth(
    unbuilt_client: TestClient, writing_systems: Path, query: str, expected: list[str]
) -> None:
    assert ids(
        unbuilt_client.get(f"/api/writing-systems{query}").json()["systems"]
    ) == (expected)


def test_descendants_walk_breadth_first_and_carry_the_parent(
    unbuilt_client: TestClient, writing_systems: Path
) -> None:
    body = unbuilt_client.get("/api/writing-systems/phoenician/descendants").json()
    assert body["parent"]["id"] == "phoenician"
    assert ids(body["descendants"]) == ["greek", "latin", "cyrillic"]
    assert body["count"] == 3


def test_descendants_404_on_the_parent_before_walking(
    unbuilt_client: TestClient, writing_systems: Path
) -> None:
    response = unbuilt_client.get("/api/writing-systems/nope/descendants")
    assert response.status_code == 404
    assert response.json() == {"message": "Writing system 'nope' not found"}


# ── Battles and migration routes ─────────────────────────────────────────────


@pytest.fixture
def battles(corpus: Path) -> Path:
    write(
        corpus,
        "battles.tsv",
        "id\tname\tdate\tbelligerents\twar_name",
        'kadesh\tKadesh\t-1274\t[{"name":"Egypt","civilization_id":"egypt"}]'
        "\tEgyptian-Hittite Wars",
        'hastings\tHastings\t1066\t[{"name":"Normans","civilization_id":"normans"}]'
        "\tNorman Conquest",
        "undated\tUndated\tsometime\t[]\t",
    )
    return corpus


def test_belligerents_stay_objects_on_the_wire(
    unbuilt_client: TestClient, battles: Path
) -> None:
    """`json_array` stringifies its items; this cell is an array of records.

    Found porting the route — the loader had used the string reader, which made
    every belligerent `"{'name': …}"` and `?civilization_id=` match nothing.
    """
    body = unbuilt_client.get("/api/battles/kadesh").json()
    assert body["belligerents"] == [{"name": "Egypt", "civilization_id": "egypt"}]


def test_a_civilization_filter_reads_into_the_belligerents(
    unbuilt_client: TestClient, battles: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/battles?civilization_id=egypt").json()["battles"]
    ) == ["kadesh"]


def test_both_sides_of_a_date_bound_are_parse_int(
    unbuilt_client: TestClient, battles: Path
) -> None:
    """An unparseable `date` cell is `NaN` and drops out of every bound while
    still appearing unfiltered."""
    assert ids(unbuilt_client.get("/api/battles?start_date=0").json()["battles"]) == [
        "hastings"
    ]
    assert unbuilt_client.get("/api/battles").json()["count"] == 3


def test_a_missing_battle_names_the_id(
    unbuilt_client: TestClient, battles: Path
) -> None:
    assert unbuilt_client.get("/api/battles/nope").json() == {
        "message": "Battle 'nope' not found"
    }


@pytest.fixture
def migration_routes(corpus: Path) -> Path:
    write(
        corpus,
        "migration-routes.tsv",
        "id\tname\troute_type\tstart_date\tend_date",
        "bantu\tBantu expansion\tland\t-3000\t500",
        "austronesian\tAustronesian\tmaritime\t-3000\t1200",
    )
    return corpus


def test_migration_dates_are_compared_as_strings(
    unbuilt_client: TestClient, migration_routes: Path
) -> None:
    """`r.startDate >= startDate` on the raw cells: `"-3000" >= "-500"` is false
    lexicographically even though the years say otherwise. The TypeScript's
    comparison, kept — parsing it would re-answer every bounded query."""
    assert (
        unbuilt_client.get("/api/migration-routes?start_date=-500").json()["count"] == 0
    )
    assert (
        unbuilt_client.get("/api/migration-routes?start_date=-3000").json()["count"]
        == 2
    )


# ── Foodways, art and architecture ───────────────────────────────────────────


@pytest.fixture
def foodways(corpus: Path) -> Path:
    write(
        corpus,
        "foodway-events.tsv",
        "id\tname\tfood_item\torigin_region\torigin_coordinates\t"
        "destination_region\tdestination_coordinates\tdate\tmechanism",
        "maize\tMaize eastward\tMaize\tMesoamerica\t[19,-99]\tIberia\t[40,-4]"
        "\t1500\ttrade",
        "chili\tChili\tChili\tMesoamerica\t[19,-99]\tIndia\t[20,78]"
        "\t1550\tcolumbian-exchange",
    )
    return corpus


def test_foodway_events_bound_a_single_date_from_both_ends(
    unbuilt_client: TestClient, foodways: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/foodway-events?date_end=1520").json()["events"]
    ) == ["maize"]
    assert ids(
        unbuilt_client.get("/api/foodway-events?food_item=chi").json()["events"]
    ) == ["chili"]


def test_the_six_bare_404s_do_not_name_the_id(
    unbuilt_client: TestClient, foodways: Path
) -> None:
    response = unbuilt_client.get("/api/foodway-events/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Foodway event not found"}


ART_HEADER = (
    "id\tname\tcategory\tstyle_period\torigin_date\tend_date\torigin_coordinates\t"
    "description\tassociated_languages\tkey_features\tnotable_examples"
)
ARCH_HEADER = (
    "id\tname\tstyle_period\torigin_date\tend_date\torigin_coordinates\tregion\t"
    "description\tassociated_languages\tkey_features\tnotable_examples\tbuilding_types"
)


@pytest.fixture
def crafts(corpus: Path) -> Path:
    write(
        corpus,
        "art-traditions.tsv",
        ART_HEADER,
        "gandhara\tGandhara\tsculpture\tClassical\t-100\t500\t{}\t\t[]\t[]\t[]",
        "ukiyo\tUkiyo-e\tprintmaking\tEdo\t1600\t1868\t{}\t\t[]\t[]\t[]",
    )
    write(
        corpus,
        "architectural-styles.tsv",
        ARCH_HEADER,
        'doric\tDoric\tClassical\t-600\t-100\t{}\tAegean\t\t[]\t[]\t[]\t["temple"]',
        "gothic\tGothic\tMedieval\t1140\t1500\t{}\tNorthern Europe\t\t[]\t[]\t[]"
        '\t["cathedral","temple"]',
    )
    return corpus


def test_art_filters_are_exact_where_the_architectural_region_is_a_substring(
    unbuilt_client: TestClient, crafts: Path
) -> None:
    assert (
        unbuilt_client.get("/api/art-traditions?category=Sculpture").json()["count"]
        == 0
    )
    assert ids(
        unbuilt_client.get("/api/architectural-styles?region=northern").json()["styles"]
    ) == ["gothic"]


def test_by_building_type_matches_a_whole_entry(
    unbuilt_client: TestClient, crafts: Path
) -> None:
    body = unbuilt_client.get(
        "/api/architectural-styles/by-building-type/temple"
    ).json()
    assert ids(body["styles"]) == ["doric", "gothic"]
    assert unbuilt_client.get(
        "/api/architectural-styles/by-building-type/temp"
    ).json() == {"styles": [], "count": 0}


def test_by_building_type_is_not_read_as_a_style_id(
    unbuilt_client: TestClient, crafts: Path
) -> None:
    """The two paths differ in segment count, so `{id}` cannot swallow it — but
    the pair is the one place in this file where a wrong route would still be a
    200, so it is asserted rather than assumed."""
    assert (
        "styles"
        in unbuilt_client.get(
            "/api/architectural-styles/by-building-type/cathedral"
        ).json()
    )


# ── Kinship, trade and innovation ────────────────────────────────────────────


@pytest.fixture
def economy(corpus: Path) -> Path:
    write(
        corpus,
        "trade-goods.tsv",
        "id\tname\tcategory\torigin_region\torigin_coordinates\ttrade_routes\t"
        "time_period\teconomic_significance\tassociated_languages",
        "silk\tSilk\tTextile\tEast Asia\t{}\t[]\tHan Dynasty\thigh\t[]",
        "lapis\tLapis Lazuli\tMineral\tBadakhshan\t{}\t[]\tBronze Age\thigh\t[]",
    )
    write(
        corpus,
        "innovations.tsv",
        "id\tname\tcategory\tculture_profile_ids\tyear_invented\tregion_of_origin\t"
        "description\tdiffusion_path\trelated_innovations\tassociated_languages\tsources",
        'wheel\tWheel\tTransport\t["sumer"]\t-3500\tMesopotamia\t\t[]\t[]\t[]\t[]',
        'writing\tWriting\tCommunication\t["sumer","egypt"]\t-3200\tMesopotamia\t\t[]\t[]\t[]\t[]',
    )
    write(
        corpus,
        "kinship-systems.tsv",
        "id\tsystem_type\tlanguage_ids\tterminology\tdescent_rule\tresidence_rule",
        "iroquois\tIroquois\t[]\t{}\tmatrilineal\tmatrilocal",
        "eskimo\tEskimo\t[]\t{}\tbilateral\tneolocal",
    )
    return corpus


def test_the_trade_good_category_folds_case_but_its_time_period_does_not(
    unbuilt_client: TestClient, economy: Path
) -> None:
    """The file's one case-sensitive substring, beside a case-folding equality."""
    assert ids(
        unbuilt_client.get("/api/trade-goods?category=textile").json()["goods"]
    ) == ["silk"]
    assert ids(
        unbuilt_client.get("/api/trade-goods?time_period=Bronze").json()["goods"]
    ) == ["lapis"]
    assert (
        unbuilt_client.get("/api/trade-goods?time_period=bronze").json()["count"] == 0
    )


def test_the_innovation_category_folds_case_and_the_profile_id_does_not(
    unbuilt_client: TestClient, economy: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/innovations?category=transport").json()["innovations"]
    ) == ["wheel"]
    assert ids(
        unbuilt_client.get("/api/innovations?culture_profile_id=egypt").json()[
            "innovations"
        ]
    ) == ["writing"]


def test_kinship_filters_are_exact_and_its_404_is_bare(
    unbuilt_client: TestClient, economy: Path
) -> None:
    assert ids(
        unbuilt_client.get("/api/kinship-systems?descent_rule=matrilineal").json()[
            "systems"
        ]
    ) == ["iroquois"]
    assert unbuilt_client.get("/api/kinship-systems/nope").json() == {
        "message": "Kinship system not found"
    }


# ── Urheimat hypotheses ──────────────────────────────────────────────────────


@pytest.fixture
def urheimat(corpus: Path) -> Path:
    write(
        corpus,
        "urheimat-hypotheses.tsv",
        "id\tlanguage_family_id\thypothesis_name\tproposed_region\t"
        "proposed_coordinates\tproposed_boundary\ttime_range_start\ttime_range_end\t"
        "supporting_evidence\tcompeting_hypotheses\tscholarly_consensus_level\t"
        "key_proponents\tsources",
        "steppe\tindo_european\tSteppe\tPontic-Caspian\t{}\t{}\t-4500\t-2500\t{}\t[]\t8\t[]\t[]",
        "anatolian\tindo_european\tAnatolian\tAnatolia\t{}\t{}\t-7000\t-6000\t{}\t[]\t3\t[]\t[]",
    )
    return corpus


def test_the_urheimat_echo_uses_the_handlers_names_not_the_query_string(
    unbuilt_client: TestClient, urheimat: Path
) -> None:
    """`?language_family=` comes back as `languageFamilyId`, `?consensus_min=`
    as `consensusMin` — the local variables Express echoed, not its parameters."""
    body = unbuilt_client.get(
        "/api/urheimat-hypotheses?language_family=indo_european&consensus_min=5"
    ).json()
    assert body["filters"] == {"languageFamilyId": "indo_european", "consensusMin": 5}
    assert ids(body["hypotheses"]) == ["steppe"]


def test_a_fractional_consensus_floor_survives_the_echo(
    unbuilt_client: TestClient, urheimat: Path
) -> None:
    body = unbuilt_client.get("/api/urheimat-hypotheses?consensus_min=3.5").json()
    assert body["filters"] == {"consensusMin": 3.5}
    assert ids(body["hypotheses"]) == ["steppe"]


# ── Settlements ──────────────────────────────────────────────────────────────


@pytest.fixture
def settlements(corpus: Path) -> Path:
    write(
        corpus,
        "settlements.tsv",
        "id\tname\tlatitude\tlongitude\ttype\tculture_id\tcivilization_id\t"
        "founded_year\tabandoned_year\tregion",
        "ur\tUr\t30.96\t46.10\tcity\tsumerian\tsumer\t-3800\t-500\tMesopotamia",
        "uruk\tUruk\t31.32\t45.64\tcity\tsumerian\tsumer\t-4000\t\tMesopotamia",
        "teo\tTeotihuacan\t19.69\t-98.84\tcity\tnahua\tteotihuacan\t\t550\tMesoamerica",
    )
    return corpus


def test_a_still_occupied_settlement_matches_every_lower_bound(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    """`abandonedYear ?? Infinity` against `time_start`, `foundedYear ??
    -Infinity` against `time_end` — an overlap test read from opposite ends."""
    assert ids(
        unbuilt_client.get("/api/settlements?time_start=0").json()["settlements"]
    ) == ["uruk", "teo"]
    assert ids(
        unbuilt_client.get("/api/settlements?time_end=-3900").json()["settlements"]
    ) == ["uruk", "teo"]


def test_the_bounding_box_is_all_four_corners_or_none(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    """Three corners is not a rejection and not a partial cull — the box simply
    does not apply, because `if (a && b && c && d)` was false."""
    four = "/api/settlements?min_lat=30&max_lat=32&min_lng=45&max_lng=47"
    assert ids(unbuilt_client.get(four).json()["settlements"]) == ["ur", "uruk"]
    three = "/api/settlements?min_lat=30&max_lat=32&min_lng=45"
    assert unbuilt_client.get(three).json()["count"] == 3


def test_the_settlement_type_and_civilization_fold_case(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    assert unbuilt_client.get("/api/settlements?type=CITY").json()["count"] == 3
    assert ids(
        unbuilt_client.get("/api/settlements/by-civilization/SUMER").json()[
            "settlements"
        ]
    ) == ["ur", "uruk"]


def test_nearby_culls_by_haversine_and_orders_nearest_first(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    body = unbuilt_client.get("/api/settlements/nearby/31.32/45.64?radius=200").json()
    assert ids(body["settlements"]) == ["uruk", "ur"]
    assert body["center"] == {"lat": 31.32, "lng": 45.64}
    assert body["radiusKm"] == 200


def test_nearby_defaults_to_a_hundred_kilometres(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    """`getSettlementsNearby`'s default parameter — *not* the 500 km the culture
    profile proximity search uses. The two were written apart and both are live."""
    body = unbuilt_client.get("/api/settlements/nearby/31.32/45.64").json()
    assert body["radiusKm"] == 100


def test_a_non_numeric_coordinate_is_a_400_but_a_junk_radius_is_not(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    """`parseFloat` on the segments, checked; on the radius, unchecked — every
    `<=` against `NaN` is false, so the answer is empty rather than rejected."""
    bad = unbuilt_client.get("/api/settlements/nearby/here/45.64")
    assert bad.status_code == 400
    assert bad.json() == {"message": "Invalid coordinates"}
    body = unbuilt_client.get("/api/settlements/nearby/31.32/45.64?radius=near").json()
    assert body == {
        "settlements": [],
        "count": 0,
        "center": {"lat": 31.32, "lng": 45.64},
        "radiusKm": None,
    }


def test_the_settlement_404_is_bare(
    unbuilt_client: TestClient, settlements: Path
) -> None:
    assert unbuilt_client.get("/api/settlements/nope").json() == {
        "message": "Settlement not found"
    }


# ── The two 500 spellings ────────────────────────────────────────────────────


def test_a_broken_corpus_answers_message_and_error_for_most_groups(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """These handlers lived inline in `routes.ts`, which spells a 500 that way."""
    write(corpus, "trade-goods.tsv", "id\tname", "silk\tSilk")
    response = unbuilt_client.get("/api/trade-goods")
    assert response.status_code == 500
    body = response.json()
    assert body["message"] == "Failed to fetch trade goods"
    assert "category" in body["error"]


def test_a_broken_corpus_answers_message_alone_for_the_settlements(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """The four settlement routes are the exception, and it is theirs, not ours."""
    write(corpus, "settlements.tsv", "name\tlatitude", "Ur\t30.96")
    response = unbuilt_client.get("/api/settlements")
    assert response.status_code == 500
    assert response.json() == {"message": "Failed to fetch settlements"}


# ── The group is registered, and reads as ported ─────────────────────────────


def test_every_route_in_this_band_reads_as_ported(unbuilt_client: TestClient) -> None:
    """The coverage number is the only tell that a path was spelled wrong.

    A handler registered at `/api/settlements/{settlement_id}` serves requests
    fine and still reads as unported, because the parity spec's `{id}` is matched
    literally (`services/api/CLAUDE.md`). Asserting on a 200 would not catch it.
    """
    coverage = unbuilt_client.get("/api/_parity/coverage").json()
    unported = {
        item["path"] for item in coverage["notImplemented"] if item["method"] == "GET"
    }
    assert not unported & {
        "/api/religions",
        "/api/religions/{id}",
        "/api/urheimat-hypotheses",
        "/api/urheimat-hypotheses/{id}",
        "/api/deities",
        "/api/deities/{id}",
        "/api/deities/{id}/equivalents",
        "/api/deities/{id}/motifs",
        "/api/myth-motifs",
        "/api/myth-motifs/{id}",
        "/api/cuisines",
        "/api/cuisines/{id}",
        "/api/cuisine-items",
        "/api/music-traditions",
        "/api/music-traditions/{id}",
        "/api/musical-instruments",
        "/api/writing-systems",
        "/api/writing-systems/{id}",
        "/api/writing-systems/{id}/descendants",
        "/api/battles",
        "/api/battles/{id}",
        "/api/migration-routes",
        "/api/migration-routes/{id}",
        "/api/foodway-events",
        "/api/foodway-events/{id}",
        "/api/art-traditions",
        "/api/art-traditions/{id}",
        "/api/architectural-styles",
        "/api/architectural-styles/{id}",
        "/api/architectural-styles/by-building-type/{buildingTypeId}",
        "/api/kinship-systems",
        "/api/kinship-systems/{id}",
        "/api/trade-goods",
        "/api/trade-goods/{id}",
        "/api/innovations",
        "/api/innovations/{id}",
        "/api/settlements",
        "/api/settlements/{id}",
        "/api/settlements/by-civilization/{civilizationId}",
        "/api/settlements/nearby/{lat}/{lng}",
    }


def test_an_absent_domain_file_is_an_empty_list_not_a_500(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`readFileIfExists` — a corpus with no `deities.tsv` has no deities."""
    body = unbuilt_client.get("/api/deities").json()
    assert body == {"deities": [], "count": 0, "filters": {}}
    assert json.loads(unbuilt_client.get("/api/battles").text)["count"] == 0
