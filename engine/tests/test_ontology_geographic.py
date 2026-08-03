"""Tests for the geographic linker (LOCATED_IN / ORIGINATES_FROM / ADJACENT_TO)."""

import copy

import pytest

from pinakes_engine.ontology import (
    DEFAULT_REGISTRY,
    PLACE_LABEL,
    Dimension,
    GeographicLinker,
)
from pinakes_engine.ontology.geographic import _haversine_km
from pinakes_engine.schema.ids import mint_csid


def _nodes() -> list[dict[str, str | list[str]]]:
    """A fixture with QID, coords-only, and TGN-id entities, plus places."""
    return [
        # Entity with a place QID -> reuse the existing Peru place node.
        {"csid": "cs:dish:ceviche", ":LABEL": ["Dish"], "name": "Ceviche",
         "place_qid": "Q419"},
        # Entity with only coordinates, near Lima.
        {"csid": "cs:dish:lomo", ":LABEL": ["Dish"], "name": "Lomo",
         "lat": "-12.05", "lon": "-77.04"},
        # Entity with a Getty TGN id and no pre-existing place node.
        {"csid": "cs:monument:huaca", ":LABEL": ["Monument"], "name": "Huaca",
         "tgn_id": "7006550"},
        # Existing place nodes.
        {"csid": "cs:place:Q419", ":LABEL": [PLACE_LABEL], "name": "Peru",
         "wikidata_qid": "Q419"},
        {"csid": "cs:place:Q2868", ":LABEL": [PLACE_LABEL], "name": "Lima",
         "wikidata_qid": "Q2868", "lat": "-12.04", "lon": "-77.03",
         "place_qid": "Q419"},
        {"csid": "cs:place:Q41523", ":LABEL": [PLACE_LABEL], "name": "Cusco",
         "wikidata_qid": "Q41523", "lat": "-13.52", "lon": "-71.97",
         "place_qid": "Q419"},
    ]


def _edge_index(
    edges: list[dict[str, str | list[str]]],
) -> dict[tuple[str, str, str], dict[str, str | list[str]]]:
    return {
        (str(e[":START_ID"]), str(e[":END_ID"]), str(e[":TYPE"])): e for e in edges
    }


def test_links_entity_to_existing_place_by_qid() -> None:
    result = GeographicLinker().link_geography(_nodes(), [])

    edges = _edge_index(result.edges)
    edge = edges[("cs:dish:ceviche", "cs:place:Q419", "LOCATED_IN")]
    assert float(str(edge["confidence"])) == pytest.approx(0.95)
    # Peru already exists, so no place node is created for it.
    assert all(p["csid"] != "cs:place:Q419" for p in result.places)


def test_creates_place_node_from_tgn_id() -> None:
    result = GeographicLinker().link_geography(_nodes(), [])

    created = {str(p["csid"]): p for p in result.places}
    tgn_csid = "cs:place:tgn-7006550"
    assert tgn_csid in created
    assert created[tgn_csid][":LABEL"] == [PLACE_LABEL]
    assert created[tgn_csid]["tgn_id"] == "7006550"
    assert ("cs:monument:huaca", tgn_csid, "LOCATED_IN") in _edge_index(result.edges)


def test_coords_only_attaches_to_nearest_place_with_lower_confidence() -> None:
    result = GeographicLinker(radius_km=50).link_geography(_nodes(), [])

    edge = _edge_index(result.edges)[
        ("cs:dish:lomo", "cs:place:Q2868", "LOCATED_IN")
    ]
    # Lima is nearer than Cusco and the coord-based link is flagged lower.
    assert float(str(edge["confidence"])) == pytest.approx(0.4)
    assert not any(
        e[":END_ID"] == "cs:place:Q41523" and e[":START_ID"] == "cs:dish:lomo"
        for e in result.edges
    )


def test_coords_only_skips_when_outside_radius() -> None:
    result = GeographicLinker(radius_km=1.0).link_geography(_nodes(), [])

    assert not any(e[":START_ID"] == "cs:dish:lomo" for e in result.edges)


def test_origin_labels_emit_originates_from() -> None:
    result = GeographicLinker(origin_labels=frozenset({"Dish"})).link_geography(
        _nodes(), []
    )

    edges = _edge_index(result.edges)
    assert ("cs:dish:ceviche", "cs:place:Q419", "ORIGINATES_FROM") in edges
    # Non-origin labels keep LOCATED_IN.
    assert ("cs:monument:huaca", "cs:place:tgn-7006550", "LOCATED_IN") in edges


def test_adjacent_to_between_places_sharing_a_container() -> None:
    result = GeographicLinker().link_geography(_nodes(), [])

    # Lima and Cusco are both contained in Peru (place_qid=Q419).
    edge = _edge_index(result.edges)[
        ("cs:place:Q2868", "cs:place:Q41523", "ADJACENT_TO")
    ]
    assert float(str(edge["confidence"])) == pytest.approx(0.6)


def test_two_entities_sharing_a_place_reuse_one_created_node() -> None:
    nodes: list[dict[str, str | list[str]]] = [
        {"csid": "cs:dish:a", ":LABEL": ["Dish"], "name": "A", "tgn_id": "7006550"},
        {"csid": "cs:dish:b", ":LABEL": ["Dish"], "name": "B", "tgn_id": "7006550"},
    ]
    result = GeographicLinker().link_geography(nodes, [])

    assert sum(p["csid"] == "cs:place:tgn-7006550" for p in result.places) == 1
    starts = {str(e[":START_ID"]) for e in result.edges}
    assert starts == {"cs:dish:a", "cs:dish:b"}


def test_does_not_duplicate_existing_edges() -> None:
    existing: dict[str, str | list[str]] = {
        ":START_ID": "cs:dish:ceviche",
        ":END_ID": "cs:place:Q419",
        ":TYPE": "LOCATED_IN",
    }
    result = GeographicLinker().link_geography(_nodes(), [existing])

    matches = [
        e
        for e in result.edges
        if (e[":START_ID"], e[":END_ID"], e[":TYPE"])
        == ("cs:dish:ceviche", "cs:place:Q419", "LOCATED_IN")
    ]
    assert matches == []


def test_link_returns_edges_only_and_never_mutates_inputs() -> None:
    nodes = _nodes()
    edges: list[dict[str, str | list[str]]] = []
    before = copy.deepcopy(nodes)

    out = GeographicLinker().link(nodes, edges)

    assert isinstance(out, list)
    assert all(":TYPE" in e for e in out)
    assert nodes == before  # inputs untouched


def test_registered_in_default_registry() -> None:
    linker = DEFAULT_REGISTRY.get("geographic")
    assert isinstance(linker, GeographicLinker)
    assert linker.dimension is Dimension.GEOGRAPHIC


def test_qid_place_csid_matches_mint() -> None:
    # The reused place csid is exactly what mint_csid would produce for the QID.
    result = GeographicLinker().link_geography(_nodes(), [])
    targets = {
        str(e[":END_ID"]) for e in result.edges if e[":START_ID"] == "cs:dish:ceviche"
    }
    assert targets == {mint_csid("place", qid="Q419")}


def test_haversine_zero_distance() -> None:
    assert _haversine_km(10.0, 20.0, 10.0, 20.0) == pytest.approx(0.0)
