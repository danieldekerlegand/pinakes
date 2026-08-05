"""`server/services/hypothesis-generation.test.ts` and its route spec, case for case.

The TypeScript engine stays as the graded spec; this file is the statement that
the two agree — on the clustering, on the two structural exclusions that make a
cluster a *lead*, on the corridor-gap heuristic and its uncertainty radius, and
on the projection that turns three lexicon files into corridors and known sites.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.analytics import hypothesis
from pinakes.analytics.anomaly import CultureNode, NodeFeature
from pinakes.analytics.hypothesis import Corridor

# Rough anchors, all more than 2000 km apart pairwise.
IBERIA = {"lat": 37.0, "lng": -5.0}
JAVA = {"lat": -7.0, "lng": 110.0}
ANDES = {"lat": -13.0, "lng": -72.0}
JAPAN = {"lat": 36.0, "lng": 138.0}


def feat(type_: str, key: str, label: str | None = None) -> NodeFeature:
    return NodeFeature(type=type_, key=key, label=label if label is not None else key)


def node(identifier: str, **overrides: Any) -> CultureNode:
    fields: dict[str, Any] = {
        "id": identifier,
        "name": overrides.pop("name", identifier),
        "domain": overrides.pop("domain", "test"),
        "features": overrides.pop("features", []),
    }
    fields.update(overrides)
    return CultureNode(**fields)


def fillers(count: int, key: str = "common") -> list[CultureNode]:
    """A pool of common-feature nodes, so a shared trait reads as rare."""
    return [
        node(
            f"filler{index}",
            coordinates={"lat": 10.0 + index, "lng": 20.0 + index},
            group_ids=[f"fill{index}"],
            features=[feat("music-scale", key)],
        )
        for index in range(count)
    ]


# ── Geometry helpers ─────────────────────────────────────────────────────────


def test_centroid_averages_and_spread_finds_the_widest_leg() -> None:
    centroid = hypothesis.centroid_of([IBERIA, JAVA])
    assert centroid is not None
    assert centroid["lat"] == 15.0
    # Iberia↔Java is the widest leg here.
    spread = hypothesis.max_spread_km([IBERIA, JAVA, ANDES])
    assert spread is not None
    assert spread > 11000


def test_centroid_and_spread_are_none_for_empty_and_single_inputs() -> None:
    assert hypothesis.centroid_of([]) is None
    assert hypothesis.max_spread_km([IBERIA]) is None


# ── Common-ancestor hypotheses ───────────────────────────────────────────────


def test_a_rare_trait_across_three_unrelated_distant_cultures_is_a_lead() -> None:
    rare = "step-fret"
    nodes = [
        node(
            "a",
            name="Andean textiles",
            coordinates=ANDES,
            group_ids=["quechua"],
            features=[feat("art-motif", rare, "step-fret motif")],
            sources=["Reindel 2009"],
        ),
        node(
            "b",
            name="Iberian pottery",
            coordinates=IBERIA,
            group_ids=["iberian"],
            features=[feat("art-motif", rare, "step-fret motif")],
            sources=["Garcia 2011"],
        ),
        node(
            "c",
            name="Javanese batik",
            coordinates=JAVA,
            group_ids=["javanese"],
            features=[feat("art-motif", rare, "step-fret motif")],
        ),
        *fillers(20),
    ]

    found = hypothesis.generate_ancestor_hypotheses(nodes)
    assert len(found) == 1
    lead = found[0]
    assert lead["kind"] == "common-ancestor"
    assert sorted(member["id"] for member in lead["members"]) == ["a", "b", "c"]
    assert lead["sharedTraits"][0]["key"] == rare
    assert lead["speculative"] is True
    assert lead["generated"] is True
    assert lead["spreadKm"] > 2000
    assert lead["centroid"] is not None
    # Provenance is the union of the members' citations.
    assert set(lead["provenance"]) == {"Reindel 2009", "Garcia 2011"}
    # Framed as a lead, not a conclusion.
    assert "lead" in lead["hypothesis"].lower()


def test_a_same_lineage_cluster_is_an_expected_similarity() -> None:
    rare = "kurgan-burial"
    nodes = [
        node("a", coordinates=IBERIA, group_ids=["ie"], features=[feat("rite", rare)]),
        node("b", coordinates=JAVA, group_ids=["ie"], features=[feat("rite", rare)]),
        node("c", coordinates=ANDES, group_ids=["ie"], features=[feat("rite", rare)]),
        *fillers(20),
    ]
    assert hypothesis.generate_ancestor_hypotheses(nodes) == []


def test_a_cluster_below_the_member_threshold_is_not_reported() -> None:
    rare = "rare-x"
    nodes = [
        node("a", coordinates=IBERIA, group_ids=["x"], features=[feat("t", rare)]),
        node("b", coordinates=JAVA, group_ids=["y"], features=[feat("t", rare)]),
        *fillers(20),
    ]
    # Two carriers, and the default minimum is three.
    assert hypothesis.generate_ancestor_hypotheses(nodes) == []
    # Lowering the threshold surfaces the pair.
    assert len(hypothesis.generate_ancestor_hypotheses(nodes, min_members=2)) == 1


def test_nearby_cultures_are_not_distant_enough_to_be_a_lead() -> None:
    rare = "rare-y"
    nodes = [
        node(
            "a",
            coordinates={"lat": 40.0, "lng": 10.0},
            group_ids=["a"],
            features=[feat("t", rare)],
        ),
        node(
            "b",
            coordinates={"lat": 40.2, "lng": 10.1},
            group_ids=["b"],
            features=[feat("t", rare)],
        ),
        node(
            "c",
            coordinates={"lat": 40.1, "lng": 10.3},
            group_ids=["c"],
            features=[feat("t", rare)],
        ),
        *fillers(20),
    ]
    assert hypothesis.generate_ancestor_hypotheses(nodes) == []


def test_a_trait_carried_by_many_cultures_anchors_nothing() -> None:
    nodes = [
        node(
            "a",
            coordinates=IBERIA,
            group_ids=["a"],
            features=[feat("music-scale", "common")],
        ),
        node(
            "b",
            coordinates=JAVA,
            group_ids=["b"],
            features=[feat("music-scale", "common")],
        ),
        node(
            "c",
            coordinates=ANDES,
            group_ids=["c"],
            features=[feat("music-scale", "common")],
        ),
        *fillers(4),
    ]
    assert hypothesis.generate_ancestor_hypotheses(nodes) == []


def test_corroborating_traits_are_gathered_and_rank_a_cluster_higher() -> None:
    pottery = feat("material-category", "cord-marked", "cord-marked pottery")
    haplogroup = feat("haplogroup-marker", "r1b", "Y-DNA R1b")
    spiral = feat("art-motif", "spiral", "spiral")
    both = [pottery, haplogroup]
    nodes = [
        node("a", coordinates=IBERIA, group_ids=["a"], features=both, sources=["s1"]),
        node("b", coordinates=JAVA, group_ids=["b"], features=both, sources=["s2"]),
        node("c", coordinates=ANDES, group_ids=["c"], features=both, sources=["s3"]),
        # A distant single-trait cluster, for contrast.
        node("d", coordinates=IBERIA, group_ids=["d"], features=[spiral]),
        node("e", coordinates=JAVA, group_ids=["e"], features=[spiral]),
        node("f", coordinates=ANDES, group_ids=["f"], features=[spiral]),
        *fillers(20),
    ]
    found = hypothesis.generate_ancestor_hypotheses(nodes)
    by_members = {
        "".join(member["id"] for member in lead["members"]): lead for lead in found
    }
    multi = by_members["abc"]
    single = by_members["def"]
    # The two-trait cluster carries both traits as its evidence...
    assert sorted(trait["key"] for trait in multi["sharedTraits"]) == [
        "cord-marked",
        "r1b",
    ]
    # ...and outranks the single-trait one.
    assert multi["confidence"] > single["confidence"]
    assert found[0] is multi


def test_one_member_set_yields_one_hypothesis_however_many_traits_anchor_it() -> None:
    first = feat("t", "rare1")
    second = feat("t", "rare2")
    nodes = [
        node("a", coordinates=IBERIA, group_ids=["a"], features=[first, second]),
        node("b", coordinates=JAVA, group_ids=["b"], features=[first, second]),
        node("c", coordinates=ANDES, group_ids=["c"], features=[first, second]),
        *fillers(20),
    ]
    found = hypothesis.generate_ancestor_hypotheses(nodes)
    assert len(found) == 1
    assert len(found[0]["sharedTraits"]) == 2


# ── Site-location prediction ─────────────────────────────────────────────────


def test_sampling_adds_a_midpoint_to_every_leg() -> None:
    sampled = hypothesis.sample_corridor(
        [{"lat": 0.0, "lng": 0.0}, {"lat": 0.0, "lng": 10.0}]
    )
    assert sampled == [
        {"lat": 0.0, "lng": 0.0},
        {"lat": 0.0, "lng": 5.0},
        {"lat": 0.0, "lng": 10.0},
    ]


def test_nearest_known_is_the_closest_site_and_infinity_when_there_are_none() -> None:
    distance = hypothesis.nearest_known_km(
        {"lat": 0.0, "lng": 0.0},
        [{"lat": 0.0, "lng": 10.0}, {"lat": 0.0, "lng": 1.0}],
    )
    # ~111 km to the point one degree east.
    assert 100 < distance < 120
    assert hypothesis.nearest_known_km({"lat": 0.0, "lng": 0.0}, []) == math.inf


SILK_ROAD = Corridor(
    id="silk-road",
    name="Silk Road",
    peoples=["Sogdians"],
    points=[
        {"lat": 39.9, "lng": 116.4},  # Beijing
        {"lat": 43.3, "lng": 76.9},  # Almaty
        {"lat": 41.3, "lng": 69.2},  # Tashkent
        {"lat": 39.6, "lng": 66.9},  # Samarkand
    ],
)


def test_corridor_gaps_far_from_any_known_site_become_predicted_regions() -> None:
    # Known sites only near the endpoints, so the middle legs are gaps.
    known = [{"lat": 39.9, "lng": 116.4}, {"lat": 39.6, "lng": 66.9}]
    predictions = hypothesis.predict_site_regions([SILK_ROAD], known, min_gap_km=300)
    assert predictions
    first = predictions[0]
    assert first["kind"] == "site-location"
    assert first["speculative"] is True
    assert first["generated"] is True
    assert first["basedOn"]["corridorId"] == "silk-road"
    assert first["nearestKnownKm"] >= 300
    assert first["uncertaintyRadiusKm"] > 0
    assert 0 < first["confidence"] <= 0.85
    # Ranked widest-gap first.
    assert first["nearestKnownKm"] >= predictions[-1]["nearestKnownKm"]


def test_a_corridor_whose_every_sample_is_known_predicts_nothing() -> None:
    covered = hypothesis.sample_corridor(SILK_ROAD.points)
    assert (
        hypothesis.predict_site_regions([SILK_ROAD], covered, min_gap_km=300) == []
    )


def test_the_uncertainty_radius_is_clamped() -> None:
    predictions = hypothesis.predict_site_regions(
        [SILK_ROAD], [], min_gap_km=100, max_uncertainty_km=150
    )
    assert predictions
    assert all(found["uncertaintyRadiusKm"] <= 150 for found in predictions)


def test_a_corpus_with_no_known_site_at_all_is_the_strongest_lead() -> None:
    """``inf`` is a capped gap, not a dropped one — see NO_KNOWN_SITE_GAP_KM."""
    predictions = hypothesis.predict_site_regions([SILK_ROAD], [], min_gap_km=300)
    assert predictions
    assert all(
        found["nearestKnownKm"] == hypothesis.NO_KNOWN_SITE_GAP_KM
        for found in predictions
    )


def test_predictions_project_to_lng_lat_geojson_carrying_the_radius() -> None:
    predictions = hypothesis.predict_site_regions(
        [
            Corridor(
                id="r",
                name="Route",
                points=[{"lat": 0.0, "lng": 0.0}, {"lat": 0.0, "lng": 40.0}],
            )
        ],
        [],
        min_gap_km=100,
    )
    collection = hypothesis.site_predictions_to_geojson(predictions)
    assert collection["type"] == "FeatureCollection"
    assert len(collection["features"]) == len(predictions)
    feature = collection["features"][0]
    assert feature["geometry"]["type"] == "Point"
    # GeoJSON order is [lng, lat].
    assert feature["geometry"]["coordinates"][0] == predictions[0]["center"]["lng"]
    assert feature["geometry"]["coordinates"][1] == predictions[0]["center"]["lat"]
    assert (
        feature["properties"]["uncertaintyRadiusKm"]
        == predictions[0]["uncertaintyRadiusKm"]
    )
    assert feature["properties"]["speculative"] is True


# ── The orchestrator ─────────────────────────────────────────────────────────


def test_both_families_honest_stats_and_the_two_framing_notes() -> None:
    nodes = [
        node("a", coordinates=IBERIA, group_ids=["a"], features=[feat("t", "rare")]),
        node("b", coordinates=JAVA, group_ids=["b"], features=[feat("t", "rare")]),
        node("c", coordinates=JAPAN, group_ids=["c"], features=[feat("t", "rare")]),
        *fillers(20),
    ]
    corridors = [
        Corridor(
            id="r",
            name="Route",
            points=[{"lat": 0.0, "lng": 0.0}, {"lat": 0.0, "lng": 40.0}],
        )
    ]
    result = hypothesis.generate_hypotheses(nodes, corridors, [])

    assert len(result["ancestorHypotheses"]) == 1
    assert result["sitePredictions"]
    assert result["stats"]["clustersFound"] == 1
    assert result["stats"]["corridorsScanned"] == 1
    assert result["stats"]["nodesConsidered"] == len(nodes)
    assert result["disclaimer"] == hypothesis.DISCLAIMER
    assert result["distinctFromCurated"] == hypothesis.DISTINCT_FROM_CURATED
    for lead in result["ancestorHypotheses"]:
        assert lead["speculative"] is True
        assert lead["generated"] is True
    for prediction in result["sitePredictions"]:
        assert prediction["speculative"] is True
        assert prediction["generated"] is True


# ── The corpus projection ────────────────────────────────────────────────────


def test_waypoints_parse_a_geojson_linestring_into_ordered_points() -> None:
    points = hypothesis.waypoints_to_points(
        {"type": "LineString", "coordinates": [[116.4, 39.9], [66.9, 39.6]]}
    )
    assert points == [
        {"lat": 39.9, "lng": 116.4},
        {"lat": 39.6, "lng": 66.9},
    ]


def test_malformed_waypoints_yield_no_points() -> None:
    assert hypothesis.waypoints_to_points(None) == []
    assert hypothesis.waypoints_to_points({}) == []
    assert hypothesis.waypoints_to_points({"coordinates": "nope"}) == []
    assert hypothesis.waypoints_to_points({"coordinates": [["a", "b"]]}) == []


def write_hypothesis_corpus(lexicons: Path) -> None:
    """Two corridors and both known-site files, each with a row that survives."""
    (lexicons / "migration-routes.tsv").write_text(
        "id\tname\troute_type\twaypoints\tstart_date\tend_date\tpeoples\n"
        "silk-road\tSilk Road\ttrade\t"
        + json.dumps(
            {"type": "LineString", "coordinates": [[116.4, 39.9], [66.9, 39.6]]}
        )
        + '\t-200\t1400\t["Sogdians"]\n'
        # One waypoint is not a corridor.
        "stub\tStub\tmigration\t"
        + json.dumps({"type": "LineString", "coordinates": [[0, 0]]})
        + "\t0\t1\t[]\n"
        # An unparseable geometry cell is not a corridor either.
        "broken\tBroken\tmigration\t{not json\t0\t1\t[]\n",
        encoding="utf-8",
    )
    (lexicons / "archaeological-sites.tsv").write_text(
        "id\tname\tcoordinates\tsite_type\n"
        "xian\tXi'an\t" + json.dumps({"lat": 34.3, "lng": 108.9}) + "\tcity\n"
        # A blank coordinate cell is not a site.
        "nowhere\tNowhere\t\tcity\n",
        encoding="utf-8",
    )
    (lexicons / "settlements.tsv").write_text(
        "id\tname\tlatitude\tlongitude\ttype\n"
        "samarkand\tSamarkand\t39.6\t66.9\tcity\n"
        # An unparseable coordinate reads as the origin, as it always has.
        "unplaced\tUnplaced\t\t\tcity\n",
        encoding="utf-8",
    )


def test_the_projection_reads_corridors_and_both_known_site_files(
    isolated_data_trees: dict[str, Path],
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    write_hypothesis_corpus(lexicons)

    corridors = hypothesis.load_corridors(lexicons)
    assert [corridor.id for corridor in corridors] == ["silk-road"]
    assert corridors[0].peoples == ["Sogdians"]
    assert corridors[0].points == [
        {"lat": 39.9, "lng": 116.4},
        {"lat": 39.6, "lng": 66.9},
    ]

    sites = hypothesis.load_known_sites(lexicons)
    assert sites == [
        {"lat": 34.3, "lng": 108.9},
        {"lat": 39.6, "lng": 66.9},
        {"lat": 0.0, "lng": 0.0},
    ]


def test_an_absent_corpus_projects_to_nothing(tmp_path: Path) -> None:
    assert hypothesis.load_corridors(tmp_path) == []
    assert hypothesis.load_known_sites(tmp_path) == []


# ── The route ────────────────────────────────────────────────────────────────


def write_route_corpus(lexicons: Path) -> None:
    """Three distant, unrelated art traditions sharing one rare motif."""
    write_hypothesis_corpus(lexicons)
    rows = [
        ("iberia", "Iberian pottery", IBERIA, "iberian", "step-fret"),
        ("java", "Javanese batik", JAVA, "javanese", "step-fret"),
        ("japan", "Jomon ware", JAPAN, "japanese", "step-fret"),
        *[
            (
                f"filler{index}",
                f"Filler {index}",
                {"lat": 10.0 + index, "lng": 20.0 + index},
                f"fill{index}",
                "spiral",
            )
            for index in range(15)
        ],
    ]
    (lexicons / "art-traditions.tsv").write_text(
        "id\tname\tcategory\torigin_coordinates\tassociated_civilizations\t"
        "associated_languages\tkey_features\tnotable_examples\n"
        + "".join(
            f"{identifier}\t{name}\t\t{json.dumps(coordinates)}\t\t"
            f'["{group}"]\t["{motif}"]\t[]\n'
            for identifier, name, coordinates, group, motif in rows
        ),
        encoding="utf-8",
    )


def test_the_route_returns_both_families_the_overlay_and_honest_framing(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_route_corpus(isolated_data_trees["lexicons"])
    payload = unbuilt_client.get("/api/hypotheses").json()

    assert len(payload["ancestorHypotheses"]) == 1
    lead = payload["ancestorHypotheses"][0]
    assert lead["kind"] == "common-ancestor"
    assert sorted(member["id"] for member in lead["members"]) == [
        "art:iberia",
        "art:japan",
        "art:java",
    ]
    assert lead["sharedTraits"][0]["key"] == "step-fret"
    assert lead["speculative"] is True
    assert lead["generated"] is True

    assert payload["sitePredictions"]
    for prediction in payload["sitePredictions"]:
        assert prediction["kind"] == "site-location"
        assert prediction["uncertaintyRadiusKm"] > 0
        assert prediction["speculative"] is True

    # The overlay mirrors the predictions.
    assert payload["geojson"]["type"] == "FeatureCollection"
    assert len(payload["geojson"]["features"]) == len(payload["sitePredictions"])

    assert payload["disclaimer"] == hypothesis.DISCLAIMER
    assert "urheimat" in payload["distinctFromCurated"].lower()
    assert payload["stats"]["nodesConsidered"] == 18
    assert payload["stats"]["corridorsScanned"] == 1


def test_the_route_honours_min_members_and_min_gap(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_route_corpus(isolated_data_trees["lexicons"])
    # Raising the member floor above the cluster size drops the lead.
    raised = unbuilt_client.get("/api/hypotheses?minMembers=5").json()
    assert raised["ancestorHypotheses"] == []
    # A gap threshold nothing can clear suppresses the predictions.
    far = unbuilt_client.get("/api/hypotheses?minGapKm=100000").json()
    assert far["sitePredictions"] == []
    assert far["geojson"]["features"] == []


def test_the_route_honours_limit_across_both_families(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_route_corpus(isolated_data_trees["lexicons"])
    limited = unbuilt_client.get("/api/hypotheses?limit=1").json()
    assert len(limited["ancestorHypotheses"]) <= 1
    assert len(limited["sitePredictions"]) <= 1


def test_an_unparseable_query_param_falls_back_rather_than_422(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """A stale bookmark must not become a hard failure — see the router docstring."""
    write_route_corpus(isolated_data_trees["lexicons"])
    default = unbuilt_client.get("/api/hypotheses").json()
    junk = unbuilt_client.get(
        "/api/hypotheses?minMembers=lots&minRarity=high&minGapKm=far&limit=all"
    )
    assert junk.status_code == 200
    assert junk.json() == default


def test_a_broken_corpus_is_a_500_naming_the_failure(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The loader-throws path: a required column gone is broken, not empty."""
    lexicons = isolated_data_trees["lexicons"]
    write_route_corpus(lexicons)
    (lexicons / "migration-routes.tsv").write_text(
        "name\twaypoints\nSilk Road\t{}\n", encoding="utf-8"
    )
    response = unbuilt_client.get("/api/hypotheses")
    assert response.status_code == 500
    assert response.json()["error"] == "hypothesis generation failed"


def test_an_absent_corpus_is_an_empty_generation_not_a_500(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/hypotheses")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ancestorHypotheses"] == []
    assert payload["sitePredictions"] == []
    assert payload["stats"]["knownSites"] == 0
