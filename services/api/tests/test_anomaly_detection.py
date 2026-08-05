"""`server/services/anomaly-detection.test.ts` and its route spec, case for case.

The TypeScript engine stays as the graded spec; this file is the statement that
the two agree — on the scoring, on the three structural exclusions, and on the
projection that turns three lexicon files into scannable nodes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.analytics import anomaly
from pinakes.analytics.anomaly import CultureNode, NodeFeature

# Rough anchors: Iberia (Bell Beaker origin) vs. central Java.
IBERIA = {"lat": 37.0, "lng": -5.0}
JAVA = {"lat": -7.0, "lng": 110.0}
NEAR_IBERIA = {"lat": 38.0, "lng": -4.0}


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


# ── Pure helpers ─────────────────────────────────────────────────────────────


def test_haversine_is_zero_for_a_point_and_large_across_hemispheres() -> None:
    assert anomaly.haversine_km(IBERIA, IBERIA) == 0
    assert anomaly.haversine_km(IBERIA, JAVA) > 11000


def test_prevalence_counts_each_node_at_most_once_per_feature() -> None:
    nodes = [
        node("a", features=[feat("music-scale", "raga"), feat("music-scale", "raga")]),
        node("b", features=[feat("music-scale", "raga")]),
        node("c", features=[feat("music-scale", "pelog")]),
    ]
    prevalence = anomaly.compute_feature_prevalence(nodes)
    assert prevalence["music-scale::raga"] == 2
    assert prevalence["music-scale::pelog"] == 1


def test_rarer_features_carry_higher_self_information() -> None:
    assert anomaly.feature_rarity(1, 100) > anomaly.feature_rarity(50, 100)
    assert anomaly.feature_rarity(1, 100) <= 1
    # A feature carried by every node is uninformative.
    assert anomaly.feature_rarity(100, 100) == 0


def test_separation_uses_great_circle_distance_when_both_have_coordinates() -> None:
    sep = anomaly.separation(
        node("a", coordinates=IBERIA), node("b", coordinates=JAVA)
    )
    assert sep["km"] is not None
    assert sep["km"] > 11000
    assert sep["distant"] is True
    assert sep["factor"] > 0.5
    assert sep["basis"] == f"~{sep['km']:,} km apart"


def test_geographically_near_nodes_are_not_distant() -> None:
    sep = anomaly.separation(
        node("a", coordinates=IBERIA), node("b", coordinates=NEAR_IBERIA)
    )
    assert sep["distant"] is False


def test_separation_falls_back_to_region_and_group_mismatch() -> None:
    distant = anomaly.separation(
        node("a", region="Europe", group_ids=["ie"]),
        node("b", region="Oceania", group_ids=["austronesian"]),
    )
    assert distant["km"] is None
    assert distant["distant"] is True

    same_region = anomaly.separation(
        node("a", region="Europe"), node("b", region="Europe")
    )
    assert same_region["distant"] is False


# ── One pair ─────────────────────────────────────────────────────────────────

TOTAL = 100
PREVALENCE = {
    "music-scale::slendro": 2,  # rare
    "music-scale::pentatonic": 90,  # common
    "material-category::pottery": 100,  # universal
}


def test_a_rare_trait_across_great_distance_is_high_surprise() -> None:
    found = anomaly.pair_anomaly(
        node(
            "a",
            name="Iberian",
            coordinates=IBERIA,
            features=[feat("music-scale", "slendro", "slendro scale")],
        ),
        node(
            "b",
            name="Javanese",
            coordinates=JAVA,
            features=[feat("music-scale", "slendro", "slendro scale")],
        ),
        PREVALENCE,
        TOTAL,
    )
    assert found is not None
    assert found["surpriseScore"] > 0.4
    assert len(found["sharedFeatures"]) == 1
    assert found["sharedFeatures"][0]["key"] == "slendro"
    assert found["speculative"] is True
    assert "Iberian" in found["hypothesis"]
    assert "Javanese" in found["hypothesis"]


def test_a_shared_lineage_group_is_an_expected_similarity() -> None:
    assert (
        anomaly.pair_anomaly(
            node(
                "a",
                coordinates=IBERIA,
                group_ids=["ie"],
                features=[feat("music-scale", "slendro")],
            ),
            node(
                "b",
                coordinates=JAVA,
                group_ids=["ie"],
                features=[feat("music-scale", "slendro")],
            ),
            PREVALENCE,
            TOTAL,
        )
        is None
    )


def test_a_nearby_similarity_is_expected() -> None:
    assert (
        anomaly.pair_anomaly(
            node("a", coordinates=IBERIA, features=[feat("music-scale", "slendro")]),
            node(
                "b", coordinates=NEAR_IBERIA, features=[feat("music-scale", "slendro")]
            ),
            PREVALENCE,
            TOTAL,
        )
        is None
    )


def test_a_universal_feature_carries_no_surprise() -> None:
    assert (
        anomaly.pair_anomaly(
            node(
                "a",
                coordinates=IBERIA,
                features=[feat("material-category", "pottery")],
            ),
            node(
                "b", coordinates=JAVA, features=[feat("material-category", "pottery")]
            ),
            PREVALENCE,
            TOTAL,
        )
        is None
    )


def test_provenance_merges_both_nodes_and_raises_confidence() -> None:
    found = anomaly.pair_anomaly(
        node(
            "a",
            coordinates=IBERIA,
            sources=["Smith 1990"],
            features=[feat("music-scale", "slendro")],
        ),
        node(
            "b",
            coordinates=JAVA,
            sources=["Jones 2001", "Smith 1990"],
            features=[feat("music-scale", "slendro")],
        ),
        PREVALENCE,
        TOTAL,
    )
    assert found is not None
    # Deduped, order-preserving across the two records.
    assert found["provenance"] == ["Smith 1990", "Jones 2001"]
    assert found["confidence"] > 0.5


def test_the_min_surprise_threshold_is_respected() -> None:
    assert (
        anomaly.pair_anomaly(
            node("a", coordinates=IBERIA, features=[feat("music-scale", "slendro")]),
            node("b", coordinates=JAVA, features=[feat("music-scale", "slendro")]),
            PREVALENCE,
            TOTAL,
            min_surprise=0.99,
        )
        is None
    )


# ── The corpus scan ──────────────────────────────────────────────────────────


def test_the_scan_ranks_by_surprise_excludes_expected_pairs_and_caps() -> None:
    fillers = [
        node(
            f"f{i}",
            coordinates={"lat": 10.0 + i, "lng": 10.0 + i},
            features=[feat("music-scale", "pentatonic")],
        )
        for i in range(20)
    ]
    rare_a = node(
        "rareA",
        name="Iberian",
        coordinates=IBERIA,
        features=[feat("music-scale", "slendro")],
    )
    rare_b = node(
        "rareB",
        name="Javanese",
        coordinates=JAVA,
        features=[feat("music-scale", "slendro")],
    )
    # Distant and sharing a trait, but same group — never reported.
    expected_a = node(
        "expA",
        coordinates=IBERIA,
        group_ids=["fam"],
        features=[feat("music-scale", "gamut")],
    )
    expected_b = node(
        "expB",
        coordinates=JAVA,
        group_ids=["fam"],
        features=[feat("music-scale", "gamut")],
    )

    result = anomaly.detect_anomalies(
        [*fillers, rare_a, rare_b, expected_a, expected_b], limit=5
    )

    assert result["disclaimer"] == anomaly.DISCLAIMER
    assert result["stats"]["nodesConsidered"] == 24
    assert result["anomalies"][0]["sharedFeatures"][0]["key"] == "slendro"
    reported = {
        entity["id"]
        for found in result["anomalies"]
        for entity in (found["entityA"], found["entityB"])
    }
    assert "expA" not in reported
    assert "expB" not in reported
    assert len(result["anomalies"]) <= 5


def test_an_all_similar_co_located_corpus_has_no_anomalies() -> None:
    nodes = [
        node(
            f"n{i}",
            coordinates={"lat": 40.0 + i * 0.1, "lng": 0.0},
            features=[feat("music-scale", "pentatonic")],
        )
        for i in range(3)
    ]
    assert anomaly.detect_anomalies(nodes)["anomalies"] == []


# ── The corpus projection ────────────────────────────────────────────────────


def write_anomaly_corpus(lexicons: Path) -> None:
    """Three feature-bearing domains, each with one row that survives projection."""
    (lexicons / "music-traditions.tsv").write_text(
        "id\tname\tregion\tcoordinates\tassociated_language_ids\tinstruments\t"
        "scales\trhythmic_patterns\tsources\n"
        "gamelan\tGamelan\tSoutheast Asia\t"
        f"{json.dumps(JAVA)}\t"
        '["jav"]\t["gong"]\t["Slendro"]\t[]\t["Sumarsam 1995"]\n'
        "flamenco\tFlamenco\tSouthern Europe\t"
        f"{json.dumps(IBERIA)}\t"
        '["spa"]\t["guitar"]\t["Slendro"]\t[]\t[]\n'
        # No traits at all — dropped before it can be half of a pair.
        "silent\tSilent\tEurope\t"
        f"{json.dumps(IBERIA)}\t"
        "[]\t[]\t[]\t[]\t[]\n",
        encoding="utf-8",
    )
    (lexicons / "art-traditions.tsv").write_text(
        "id\tname\tcategory\tstyle_period\torigin_date\tend_date\t"
        "origin_coordinates\tdescription\tassociated_civilizations\t"
        "associated_languages\tkey_features\tnotable_examples\n"
        "batik\tBatik\ttextile\tclassical\t700\t0\t"
        f"{json.dumps(JAVA)}\t\tMajapahit\t"
        '["jav"]\t["wax resist"]\t["Parang"]\n',
        encoding="utf-8",
    )
    (lexicons / "material-culture.tsv").write_text(
        "id\tname\tcategory\torigin_date\torigin_coordinates\tspread_data\t"
        "description\tassociated_languages\tsignificance\n"
        "beaker\tBell Beaker\tpottery\t-2800\t[37, -5]\t[]\t\tcelt\t\n",
        encoding="utf-8",
    )


def test_the_projection_reads_three_domains_and_drops_featureless_rows(
    isolated_data_trees: dict[str, Path],
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    write_anomaly_corpus(lexicons)

    nodes = anomaly.load_nodes(lexicons)
    by_id = {node.id: node for node in nodes}

    assert set(by_id) == {
        "music:gamelan",
        "music:flamenco",
        "art:batik",
        "material:beaker",
    }
    assert "music:silent" not in by_id

    gamelan = by_id["music:gamelan"]
    assert gamelan.domain == "music-tradition"
    assert gamelan.group_ids == ["jav"]
    assert gamelan.sources == ["Sumarsam 1995"]
    assert NodeFeature("music-scale", "slendro", "Slendro") in gamelan.features

    # `[lat, lng]` in the file, `{lat, lng}` on the node — normalized here only.
    assert by_id["material:beaker"].coordinates == {"lat": 37.0, "lng": -5.0}
    # An art tradition has no region column; its civilizations stand in.
    assert by_id["art:batik"].region == "Majapahit"


# ── The route ────────────────────────────────────────────────────────────────


def test_the_route_returns_ranked_hypothesis_framed_anomalies(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_anomaly_corpus(isolated_data_trees["lexicons"])
    payload = unbuilt_client.get("/api/anomalies").json()

    assert payload["disclaimer"] == anomaly.DISCLAIMER
    assert payload["stats"]["nodesConsidered"] == 4
    top = payload["anomalies"][0]
    assert top["speculative"] is True
    assert top["hypothesis"]
    assert top["sharedFeatures"][0]["key"] == "slendro"


def test_the_route_filters_by_domain(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_anomaly_corpus(isolated_data_trees["lexicons"])
    payload = unbuilt_client.get("/api/anomalies?domains=music-tradition").json()
    assert payload["stats"]["nodesConsidered"] == 2
    domains = {
        entity["domain"]
        for found in payload["anomalies"]
        for entity in (found["entityA"], found["entityB"])
    }
    assert domains <= {"music-tradition"}


def test_the_route_honours_min_surprise_and_limit(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_anomaly_corpus(isolated_data_trees["lexicons"])
    assert unbuilt_client.get("/api/anomalies?minSurprise=1").json()["anomalies"] == []
    limited = unbuilt_client.get("/api/anomalies?limit=1").json()
    assert len(limited["anomalies"]) <= 1


def test_an_unparseable_query_param_falls_back_rather_than_422(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """A stale bookmark must not become a hard failure — see the router docstring."""
    write_anomaly_corpus(isolated_data_trees["lexicons"])
    default = unbuilt_client.get("/api/anomalies").json()
    junk = unbuilt_client.get("/api/anomalies?minSurprise=high&limit=abc")
    assert junk.status_code == 200
    assert junk.json() == default


def test_an_absent_corpus_is_an_empty_scan_not_a_500(
    unbuilt_client: TestClient,
) -> None:
    payload = unbuilt_client.get("/api/anomalies")
    assert payload.status_code == 200
    assert payload.json()["anomalies"] == []
