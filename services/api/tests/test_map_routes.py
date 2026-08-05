"""The geospatial corpus — the map's layers and the four flat groups (pinakes:80 US-1).

Two recorded fixtures grade `/api/map/civilizations` and nothing records the
other fifteen routes, so this file is the rest of the grading. It asserts what a
live diff against Express proved over 235 requests and a shape check never
could: which of the three temporal filters each route uses, which layers merge
the viewport `meta` into their `metadata` and which echo the raw `bbox` string,
and the two spellings of a 404 and of a 500.

`conftest.py`'s autouse `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at
an empty temp tree, so every test seeds its own TSVs; row counts against the live
corpus belong in `test_lexicon_storage.py`.
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


def ids(features: list[dict[str, Any]]) -> list[str]:
    return [feature["id"] for feature in features]


def line(*points: tuple[float, float]) -> str:
    return json.dumps({"type": "LineString", "coordinates": [list(p) for p in points]})


def square(west: float, south: float, east: float, north: float) -> str:
    return json.dumps(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [west, south],
                    [west, north],
                    [east, north],
                    [east, south],
                    [west, south],
                ]
            ],
        }
    )


# ── Language ranges and range polygons ───────────────────────────────────────

RANGE_HEADER = (
    "id\tlanguage_id\tfamily_id\tgeometry\trange_type\ttime_period_start\t"
    "time_period_end\ttime_period_label\tconfidence\tsources\tnotes"
)


@pytest.fixture
def ranges(corpus: Path) -> Path:
    for filename in ("language-ranges.tsv", "language-range-polygons.tsv"):
        write(
            corpus,
            filename,
            RANGE_HEADER,
            f"west\tlat\titalic\t{square(0, 40, 10, 50)}\thistorical\t-500\t500\t"
            'Classical\t80\t["a"]\t',
            f"east\tsan\tindic\t{square(70, 20, 80, 30)}\tattested\t-1500\t\t"
            "Vedic\t\t\t",
            "broken\tnah\tuto\t\thistorical\t0\t100\t\t50\t\t",
        )
    return corpus


def test_a_range_row_with_no_geometry_does_not_exist(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """`rows.filter(row => row[geoIdx] && row[geoIdx].trim())` — dropped, not empty."""
    body = unbuilt_client.get("/api/map/language-ranges").json()
    assert ids(body["features"]) == ["west", "east"]


def test_a_range_carries_its_id_twice_as_both_id_and_display_name(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """The TypeScript's "will be enriched later" that nothing ever enriches."""
    properties = unbuilt_client.get("/api/map/language-ranges").json()["features"][0][
        "properties"
    ]
    assert properties["languageId"] == properties["languageName"] == "lat"
    assert properties["familyId"] == properties["familyName"] == "italic"


def test_a_blank_confidence_cell_defaults_to_fifty(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    features = unbuilt_client.get("/api/map/language-ranges").json()["features"]
    assert [f["properties"]["confidence"] for f in features] == [80, 50]


def test_an_open_ended_range_survives_a_start_bound(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """`end ?? Infinity` — the overlap test `filterByTime` applies."""
    body = unbuilt_client.get("/api/map/language-ranges?timeStart=1000").json()
    assert ids(body["features"]) == ["east"]


def test_a_malformed_year_filters_nothing_and_echoes_null(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """`parseInt("soon")` is `NaN`, which compares false against every bound."""
    body = unbuilt_client.get("/api/map/language-ranges?timeStart=soon").json()
    assert ids(body["features"]) == ["west", "east"]
    assert body["metadata"]["timeStart"] is None


def test_a_blank_year_is_the_filters_absence_and_echoes_no_key(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    body = unbuilt_client.get("/api/map/language-ranges?timeStart=").json()
    assert "timeStart" not in body["metadata"]


def test_one_family_id_becomes_a_one_element_set(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    body = unbuilt_client.get("/api/map/language-ranges?familyIds=indic").json()
    assert ids(body["features"]) == ["east"]
    assert body["metadata"]["familyIds"] == ["indic"]


def test_a_single_blank_family_id_is_no_filter_but_a_repeated_one_is(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """`""` is falsy so one blank is `undefined`; two values are a truthy array.

    The array keeps the blank, which then matches nothing — so the same
    parameter spelled twice selects strictly less than spelled once.
    """
    blank = unbuilt_client.get("/api/map/language-ranges?familyIds=").json()
    assert ids(blank["features"]) == ["west", "east"]
    assert "familyIds" not in blank["metadata"]

    repeated = unbuilt_client.get(
        "/api/map/language-ranges?familyIds=&familyIds=indic"
    ).json()
    assert ids(repeated["features"]) == ["east"]
    assert repeated["metadata"]["familyIds"] == ["", "indic"]


def test_range_polygons_add_an_exact_range_type_filter(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    body = unbuilt_client.get(
        "/api/map/language-range-polygons?rangeType=attested"
    ).json()
    assert ids(body["features"]) == ["east"]
    assert body["metadata"]["rangeType"] == "attested"


# ── The viewport contract ────────────────────────────────────────────────────


def test_the_viewport_meta_overwrites_the_raw_bbox_string(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """`{...filters, ...meta}` — `filters.bbox` is a string, `meta.bbox` a box."""
    body = unbuilt_client.get("/api/map/language-ranges?bbox=0,40,10,50").json()
    assert ids(body["features"]) == ["west"]
    assert body["metadata"]["bbox"] == {
        "west": 0.0,
        "south": 40.0,
        "east": 10.0,
        "north": 50.0,
    }
    assert body["metadata"]["total"] == 1
    assert body["metadata"]["hasMore"] is False


def test_a_malformed_bbox_is_a_no_op_and_reports_null(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    body = unbuilt_client.get("/api/map/language-ranges?bbox=12abc,2,3,4").json()
    assert ids(body["features"]) == ["west", "east"]
    assert body["metadata"]["bbox"] is None


def test_paging_reports_what_it_withheld(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    body = unbuilt_client.get("/api/map/language-ranges?limit=1").json()
    assert ids(body["features"]) == ["west"]
    assert body["metadata"]["total"] == 2
    assert body["metadata"]["returned"] == 1
    assert body["metadata"]["hasMore"] is True


def test_a_repeated_bbox_is_not_a_string_and_so_is_no_viewport(
    unbuilt_client: TestClient, ranges: Path
) -> None:
    """`typeof v === "string"` in `viewportOptionsFromQuery`: an array is absent."""
    body = unbuilt_client.get(
        "/api/map/language-ranges?bbox=0,40,10,50&bbox=0,0,1,1"
    ).json()
    assert ids(body["features"]) == ["west", "east"]
    assert body["metadata"]["bbox"] is None


# ── Archaeological sites ─────────────────────────────────────────────────────

SITE_HEADER = (
    "id\tname\tcoordinates\tsite_type\ttime_period_start\ttime_period_end\t"
    "time_period_label\tassociated_language_ids\tassociated_culture_ids\t"
    "excavation_status\tfindings\timportance\tconfidence\tsources\tdescription"
)


@pytest.fixture
def sites(corpus: Path) -> Path:
    write(
        corpus,
        "archaeological-sites.tsv",
        SITE_HEADER,
        'catal\tCatalhoyuk\t{"lat": 37.6, "lng": 32.8}\tsettlement\t-7400\t-6000\t'
        "Neolithic\t[]\t[]\texcavated\t[]\t90\t85\t[]\tA tell.",
        'uruk\tUruk\t{"lat": 31.3, "lng": 45.6}\tcity\t-4000\t-300\t'
        "Sumerian\t[]\t[]\tpartial\t[]\t95\t90\t[]\tA city.",
    )
    return corpus


def test_a_site_is_a_point_in_lng_lat_order(
    unbuilt_client: TestClient, sites: Path
) -> None:
    feature = unbuilt_client.get("/api/map/archaeological-sites").json()["features"][0]
    assert feature["geometry"] == {"type": "Point", "coordinates": [32.8, 37.6]}


def test_site_types_filter_exactly(unbuilt_client: TestClient, sites: Path) -> None:
    body = unbuilt_client.get("/api/map/archaeological-sites?siteTypes=city").json()
    assert ids(body["features"]) == ["uruk"]


# ── Civilizations — the graded layer ─────────────────────────────────────────

CIV_HEADER = (
    "id\tname\tnative_name\ttime_period_start\ttime_period_end\ttime_period_label\t"
    "associated_language_ids\twriting_systems\tpolitical_structure\tcapital\t"
    "population\tsources\tdescription\twikidata_qid\tsource_url\tretrieved_at\t"
    "confidence"
)
BOUNDARY_HEADER = (
    "civilization_id\tgeometry\ttime_period_start\ttime_period_end\ttime_period_label"
)


@pytest.fixture
def civilizations(corpus: Path) -> Path:
    write(
        corpus,
        "civilizations.tsv",
        CIV_HEADER,
        "sumer\tSumer\t\t-4500\t-1900\tEarly Dynastic\t[]\t[]\t\tUr\t\t[]\t\t\t\t\t",
        "rome\tRome\t\t-753\t476\tClassical\t[]\t[]\t\tRome\t\t[]\t\t\t\t\t",
    )
    write(
        corpus,
        "civilization-boundaries.tsv",
        BOUNDARY_HEADER,
        f"sumer\t{square(44, 30, 48, 34)}\t-4500\t-1900\tEarly Dynastic",
        f"rome\t{square(6, 36, 19, 47)}\t-753\t476\tClassical",
    )
    return corpus


def test_civilizations_cull_to_the_viewport(
    unbuilt_client: TestClient, civilizations: Path
) -> None:
    body = unbuilt_client.get("/api/map/civilizations?bbox=0,30,25,50").json()
    assert ids(body["features"]) == ["rome"]
    assert body["metadata"]["total"] == 1


def test_a_civilization_with_no_boundary_gets_the_placeholder_ring(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "civilizations.tsv",
        CIV_HEADER,
        "hittite\tHittites\t\t-1600\t-1178\tLate Bronze\t[]\t[]\t\tHattusa\t\t[]\t"
        "\t\t\t\t",
    )
    feature = unbuilt_client.get("/api/map/civilizations").json()["features"][0]
    assert feature["geometry"]["coordinates"] == [
        [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
    ]


# ── Historical routes, and the two `/api/trade-routes` registrations ─────────

MIGRATION_HEADER = (
    "id\tname\troute_type\twaypoints\tstart_date\tend_date\tpeoples\t"
    "associated_languages\tdescription\tconsequences"
)
GOODS_HEADER = (
    "id\tname\tcategory\torigin_region\torigin_coordinates\ttrade_routes\t"
    "time_period\teconomic_significance\tassociated_languages"
)


@pytest.fixture
def routes(corpus: Path) -> Path:
    write(
        corpus,
        "migration-routes.tsv",
        MIGRATION_HEADER,
        f"silk\tSilk Road\ttrade\t{line((116, 40), (28, 41))}\t-130\t1450\t[]\t"
        '["zho"]\tEast to west.\tLoanwords.',
        f"bantu\tBantu\tmigration\t{line((10, 5), (30, -20))}\t-1500\t500\t[]\t"
        '["bnt"]\tSouthward.\t',
        "novel\tNo geometry\tcaravan\t\t-100\t100\t[]\t[]\tNo line.\t",
    )
    write(
        corpus,
        "trade-goods.tsv",
        GOODS_HEADER,
        'silk-cloth\tSilk\ttextile\tChina\t{"lat": 34, "lng": 108}\t["silk"]\t'
        "Han\thigh\t[]",
    )
    return corpus


def test_a_route_with_no_linestring_does_not_exist(
    unbuilt_client: TestClient, routes: Path
) -> None:
    body = unbuilt_client.get("/api/map/routes").json()
    assert ids(body["features"]) == ["silk", "bantu"]


def test_traded_goods_are_joined_in_from_the_goods_side(
    unbuilt_client: TestClient, routes: Path
) -> None:
    """A good names its routes; the route has to be indexed back out of them."""
    features = unbuilt_client.get("/api/map/routes").json()["features"]
    assert features[0]["properties"]["tradedGoods"] == ["Silk"]
    assert "tradedGoods" not in features[1]["properties"]


def test_map_routes_echoes_the_raw_bbox_and_culls_nothing(
    unbuilt_client: TestClient, routes: Path
) -> None:
    """This layer never calls `applyViewport` — `bbox` is decoration here."""
    body = unbuilt_client.get("/api/map/routes?bbox=0,0,1,1").json()
    assert ids(body["features"]) == ["silk", "bantu"]
    assert body["metadata"]["bbox"] == "0,0,1,1"
    assert "total" not in body["metadata"]


def test_trade_routes_reads_migration_routes_not_trade_routes(
    unbuilt_client: TestClient, routes: Path
) -> None:
    """`routes.ts` registers `GET /api/trade-routes` twice; the first wins.

    The winning registration is the GeoJSON view over `migration-routes.tsv`
    filtered to `routeTypes: ["trade"]` — so this route answers a
    FeatureCollection with a `count`, and `trade-routes.tsv` (which is not even
    seeded here) is never opened.
    """
    body = unbuilt_client.get("/api/trade-routes").json()
    assert body["type"] == "FeatureCollection"
    assert ids(body["features"]) == ["silk"]
    assert body["count"] == 1
    assert "routes" not in body


TRADE_ROUTE_HEADER = (
    "id\tname\troute_type\twaypoints\tstart_date\tend_date\ttraded_goods\t"
    "key_cities\tcontrolling_powers\tassociated_languages\tdescription\t"
    "economic_impact"
)


def test_the_trade_route_id_route_reads_the_file_the_list_ignores(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Two halves of one client-visible resource, over two different files."""
    write(
        corpus,
        "trade-routes.tsv",
        TRADE_ROUTE_HEADER,
        'incense\tIncense Route\tcaravan\t{}\t-700\t200\t["myrrh"]\t[]\t[]\t[]\t'
        "Arabia to Levant.\thigh",
    )
    found = unbuilt_client.get("/api/trade-routes/incense").json()
    assert found["name"] == "Incense Route"
    assert found["tradedGoods"] == ["myrrh"]
    missing = unbuilt_client.get("/api/trade-routes/nope")
    assert missing.status_code == 404
    assert missing.json() == {"message": "Trade route 'nope' not found"}


def test_a_json_column_holding_a_scalar_is_kept_as_the_scalar(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`JSON.parse` with no array check — the bug the live diff caught.

    `tsv.json_array` would map `str` over the items and answer `[]` for a
    non-list; these loaders spell a bare `JSON.parse` with a `[]` *fallback*, so
    a cell holding `150000` reaches the client as the number `150000`.
    """
    write(
        corpus,
        "trade-routes.tsv",
        TRADE_ROUTE_HEADER,
        "odd\tOdd\tcaravan\t{}\t-700\t200\t150000\t[]\t[]\t[]\t\t",
    )
    assert unbuilt_client.get("/api/trade-routes/odd").json()["tradedGoods"] == 150000


# ── Material culture ─────────────────────────────────────────────────────────

MATERIAL_HEADER = (
    "id\tname\tcategory\torigin_date\torigin_coordinates\tspread_data\t"
    "description\tassociated_languages\tsignificance"
)


@pytest.fixture
def material(corpus: Path) -> Path:
    spread = json.dumps(
        [
            {
                "date": -2500,
                "coordinates": [48.8, 2.3],
                "associated_civilization": "Gaul",
            }
        ]
    )
    write(
        corpus,
        "material-culture.tsv",
        MATERIAL_HEADER,
        f"beaker\tBell Beaker\tpottery\t-2800\t[37, -5]\t{spread}\t"
        "A pot.\tibe, cel\tWide.",
        "wheel\tSpoked wheel\ttransport\t-2000\t[45, 60]\t[]\tA wheel.\t\tWide.",
    )
    return corpus


def test_material_culture_items_answer_their_own_envelope(
    unbuilt_client: TestClient, material: Path
) -> None:
    body = unbuilt_client.get("/api/material-culture").json()
    assert set(body) == {"items", "count"}
    assert body["count"] == 2


def test_a_comma_separated_language_column_is_split_and_trimmed(
    unbuilt_client: TestClient, material: Path
) -> None:
    """The one string-list column in this file — not JSON, unlike its neighbours."""
    item = unbuilt_client.get("/api/material-culture/beaker").json()
    assert item["associatedLanguages"] == ["ibe", "cel"]
    assert (
        unbuilt_client.get("/api/material-culture/wheel").json()["associatedLanguages"]
        == []
    )


def test_a_missing_material_culture_item_is_the_bare_404(
    unbuilt_client: TestClient, material: Path
) -> None:
    response = unbuilt_client.get("/api/material-culture/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Material culture item not found"}


def test_one_item_becomes_one_distribution_point_per_date(
    unbuilt_client: TestClient, material: Path
) -> None:
    body = unbuilt_client.get("/api/map/material-cultures").json()
    assert set(body) == {"distributions", "metadata"}
    points = body["distributions"]
    assert [p["cultureId"] for p in points] == ["beaker", "beaker", "wheel"]
    assert points[0] == {
        "lat": 37,
        "lng": -5,
        "intensity": 1,
        "cultureId": "beaker",
        "timePeriod": {"start": -2800, "end": -2500, "label": "Bell Beaker"},
    }


def test_a_spread_point_decays_with_distance_in_time(
    unbuilt_client: TestClient, material: Path
) -> None:
    """`Math.max(0.2, 1 - |date - origin| / 10000)` — 300 years is 0.97."""
    points = unbuilt_client.get("/api/map/material-cultures").json()["distributions"]
    assert points[1]["intensity"] == pytest.approx(0.97)
    assert points[1]["timePeriod"]["label"] == "Bell Beaker - Gaul"


def test_the_heat_map_reads_its_bounds_for_truthiness_not_presence(
    unbuilt_client: TestClient, material: Path
) -> None:
    """`!filters?.timeStart` — so `?timeStart=0` is **no filter at all** here.

    Every other temporal filter in this module tests `!== undefined`, where a
    bound of zero is a real bound. The two disagree deliberately.
    """
    unfiltered = unbuilt_client.get("/api/map/material-cultures").json()
    zeroed = unbuilt_client.get("/api/map/material-cultures?timeStart=0").json()
    assert zeroed["distributions"] == unfiltered["distributions"]

    bounded = unbuilt_client.get("/api/map/material-cultures?timeStart=-2400").json()
    assert [p["cultureId"] for p in bounded["distributions"]] == ["wheel"]


# ── Archaeological cultures ──────────────────────────────────────────────────

CULTURE_HEADER = (
    "id\tname\tregion\tcoordinates\tboundary_geometry\ttime_period_start\t"
    "time_period_end\ttime_period_label\tsubsistence_pattern\tpottery_style\t"
    "burial_practices\tmaterial_culture_traits\tprobable_language_family\t"
    "probable_haplogroups\tpredecessor_culture_ids\tsuccessor_culture_ids\t"
    "confidence\tsources\tdescription\twikidata_qid\tsource_url\tretrieved_at"
)


@pytest.fixture
def cultures(corpus: Path) -> Path:
    write(
        corpus,
        "archaeological-cultures.tsv",
        CULTURE_HEADER,
        'yamnaya\tYamnaya\tPontic Steppe\t{"lat": 47, "lng": 40}\t\t-3300\t-2600\t'
        "Early Bronze\tpastoral\tcorded\tkurgan\t[]\tpie\t[]\t[]\t[]\t85\t[]\t"
        "Steppe herders.\t\t\t",
        'corded\tCorded Ware\tCentral Europe\t{"lat": 51, "lng": 15}\t\t-2900\t-2350\t'
        "Late Neolithic\tmixed\tcorded\tsingle\t[]\tpie\t[]\t[]\t[]\t80\t[]\t"
        "Beaker neighbours.\t\t\t",
    )
    return corpus


def test_the_flat_culture_group_answers_cultures_and_count(
    unbuilt_client: TestClient, cultures: Path
) -> None:
    body = unbuilt_client.get("/api/archaeological-cultures").json()
    assert set(body) == {"cultures", "count"}
    assert [c["id"] for c in body["cultures"]] == ["yamnaya", "corded"]


def test_region_is_a_case_insensitive_substring(
    unbuilt_client: TestClient, cultures: Path
) -> None:
    body = unbuilt_client.get("/api/archaeological-cultures?region=steppe").json()
    assert [c["id"] for c in body["cultures"]] == ["yamnaya"]


def test_the_language_filter_selects_nothing_because_the_column_is_absent(
    unbuilt_client: TestClient, cultures: Path
) -> None:
    """`associated_language_ids` is not a column of this file, and the loader
    reads it optionally — so every culture carries `[]` and `?language=` is a
    filter that can only ever empty the list. Reproduced from Express."""
    body = unbuilt_client.get("/api/archaeological-cultures?language=pie").json()
    assert body["cultures"] == []


def test_the_map_layer_wraps_the_same_flat_records_as_a_feature_collection(
    unbuilt_client: TestClient, cultures: Path
) -> None:
    """They are not GeoJSON features and the envelope says they are anyway."""
    body = unbuilt_client.get("/api/map/archaeological-cultures").json()
    assert body["type"] == "FeatureCollection"
    assert body["features"][0]["coordinates"] == {"lat": 47, "lng": 40}
    assert "geometry" not in body["features"][0]


def test_the_map_layer_uses_camel_case_where_the_flat_group_uses_snake(
    unbuilt_client: TestClient, cultures: Path
) -> None:
    layer = unbuilt_client.get(
        "/api/map/archaeological-cultures?timeStart=-2500"
    ).json()
    flat = unbuilt_client.get("/api/archaeological-cultures?time_start=-2500").json()
    assert ids(layer["features"]) == ["corded"]
    assert [c["id"] for c in flat["cultures"]] == ["corded"]


def test_a_missing_culture_is_the_bare_404(
    unbuilt_client: TestClient, cultures: Path
) -> None:
    response = unbuilt_client.get("/api/archaeological-cultures/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Archaeological culture not found"}


# ── Empire timeline: two loaders, one file ───────────────────────────────────

EMPIRE_HEADER = (
    "id\tempire_id\tempire_name\tyear\tevent_type\tterritory_change\tcapital\t"
    "population_estimate\truler\tgovernment_type\tvassal_states\trival_empires\t"
    "associated_language_ids\tdescription"
)


@pytest.fixture
def empires(corpus: Path) -> Path:
    write(
        corpus,
        "empires-timeline.tsv",
        EMPIRE_HEADER,
        "rome-founding\troman-empire\tRoman Kingdom\t-753\tfounding\t+0\tRome\t"
        '50000\tRomulus\tmonarchy\t[]\t[]\t["lat"]\tThe founding.',
        "rome-peak\troman-empire\tRoman Empire\t117\tpeak\t+5000000\tRome\t"
        '60000000\tTrajan\timperial\t[]\t["parthia"]\t["lat"]\tGreatest extent.',
        "han-founding\than-dynasty\tWestern Han\tunknown\tfounding\t+0\tChang'an\t"
        "\tLiu Bang\timperial\t[]\t[]\t[]\tThe founding.",
    )
    return corpus


def test_the_flat_empire_group_reads_the_event_vocabulary(
    unbuilt_client: TestClient, empires: Path
) -> None:
    body = unbuilt_client.get("/api/empires-timeline").json()
    assert set(body) == {"events", "count"}
    assert body["count"] == 3
    assert body["events"][0]["year"] == -753


def test_an_unreadable_year_is_null_and_drops_out_of_a_bounded_query(
    unbuilt_client: TestClient, empires: Path
) -> None:
    """Containment, not overlap — and `NaN >= x` is false, so it is excluded.

    The opposite default to `filterByTime`, where a `NaN` keeps a feature.
    """
    unfiltered = unbuilt_client.get("/api/empires-timeline").json()["events"]
    assert unfiltered[2]["year"] is None
    bounded = unbuilt_client.get(
        "/api/empires-timeline?year_start=-1000&year_end=1000"
    ).json()
    assert [e["id"] for e in bounded["events"]] == ["rome-founding", "rome-peak"]


def test_a_zero_population_estimate_reads_as_unknown(
    unbuilt_client: TestClient, empires: Path
) -> None:
    events = unbuilt_client.get("/api/empires-timeline").json()["events"]
    assert events[2]["populationEstimate"] is None


def test_a_missing_empire_event_is_the_bare_404_and_the_plain_500_spelling(
    unbuilt_client: TestClient, empires: Path
) -> None:
    response = unbuilt_client.get("/api/empires-timeline/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Empire timeline event not found"}


def test_the_map_layer_over_the_same_file_is_a_500(
    unbuilt_client: TestClient, empires: Path
) -> None:
    """`loadEmpiresTimeline` requires a `name` column this file does not have.

    Both backends answer this 500 on the live corpus. It is the one route in
    this module that is a faithful port of a failure, and it becomes a 200 the
    day the corpus grows the phase vocabulary — which is why the assertion is on
    the message rather than on the status alone.
    """
    response = unbuilt_client.get("/api/map/empires-timeline")
    assert response.status_code == 500
    assert response.json() == {
        "message": "Failed to fetch empires timeline",
        "error": "Missing column 'name' in TSV header",
    }


# ── The bulk layer fetch ─────────────────────────────────────────────────────


def test_the_bulk_fetch_refuses_an_empty_layer_list(
    unbuilt_client: TestClient, civilizations: Path
) -> None:
    bodies: list[dict[str, Any]] = [
        {"layers": []},
        {"layers": "civilizations"},
        {},
    ]
    for body in bodies:
        response = unbuilt_client.post("/api/map/features", json=body)
        assert response.status_code == 400
        assert response.json() == {"message": "layers must be a non-empty array"}


def test_an_unknown_layer_is_an_empty_collection_not_a_refusal(
    unbuilt_client: TestClient, civilizations: Path
) -> None:
    body = unbuilt_client.post(
        "/api/map/features", json={"layers": ["civilizations", "nope"]}
    ).json()
    assert ids(body["civilizations"]["features"]) == ["sumer", "rome"]
    assert body["nope"] == {"type": "FeatureCollection", "features": []}


def test_the_bulk_metadata_echoes_only_the_keys_the_body_carried(
    unbuilt_client: TestClient, civilizations: Path
) -> None:
    bare = unbuilt_client.post(
        "/api/map/features", json={"layers": ["civilizations"]}
    ).json()
    assert bare["metadata"] == {"layers": ["civilizations"]}

    filtered = unbuilt_client.post(
        "/api/map/features", json={"layers": ["civilizations"], "timeStart": -2000}
    ).json()
    assert filtered["metadata"] == {"layers": ["civilizations"], "timeStart": -2000}


def test_the_bulk_filters_are_unparsed_and_compare_as_javascript_would(
    unbuilt_client: TestClient, civilizations: Path
) -> None:
    """A string year in the body is coerced by `<`/`>`, not rejected — and is
    echoed back as the string it arrived as."""
    body = unbuilt_client.post(
        "/api/map/features", json={"layers": ["civilizations"], "timeStart": "0"}
    ).json()
    assert ids(body["civilizations"]["features"]) == ["rome"]
    assert body["metadata"]["timeStart"] == "0"


def test_a_layer_named_metadata_loses_to_the_metadata_key(
    unbuilt_client: TestClient, civilizations: Path
) -> None:
    """`{...result, metadata}` — the spread is first, so `metadata` wins."""
    body = unbuilt_client.post(
        "/api/map/features", json={"layers": ["metadata"]}
    ).json()
    assert body["metadata"] == {"layers": ["metadata"]}
