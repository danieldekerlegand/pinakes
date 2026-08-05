"""`server/services/cross-domain-correlation*.test.ts`, case for case.

The shared-fixture idea is the TypeScript's and is what makes this a parity
suite rather than a re-derivation: **one** set of :class:`DomainEntity` records
feeds both the reference scorer and the graph path (as nodes rebuilt from them),
so if the projection is faithful the two paths must produce identical ranked
results. That is the guarantee the ``source`` field rests on.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from conftest import FakeNode, FakeResult
from pinakes.analytics import correlation
from pinakes.analytics.correlation import DomainEntity
from pinakes.engine import graph as engine_graph
from pinakes.engine.errors import EngineFailure, EngineUnavailable

NOW_YEAR = 2026

LANGUAGES = [
    DomainEntity(
        id="lat",
        name="Latin",
        domain="language",
        language_ids=["lat"],
        region="Southern Europe",
        coordinates={"lat": 41.9, "lng": 12.5},
        time_start=-700,
        time_end=600,
    ),
    DomainEntity(
        id="grc",
        name="Ancient Greek",
        domain="language",
        language_ids=["grc"],
        region="Southern Europe",
        coordinates={"lat": 38.0, "lng": 23.7},
        time_start=-800,
        time_end=300,
    ),
]

CUISINES = [
    DomainEntity(
        id="roman",
        name="Roman Cuisine",
        domain="cuisine",
        language_ids=["lat"],
        region="Southern Europe",
        coordinates={"lat": 41.9, "lng": 12.5},
        time_start=-500,
        time_end=400,
    ),
    DomainEntity(
        id="greek",
        name="Greek Cuisine",
        domain="cuisine",
        language_ids=["grc"],
        region="Southern Europe",
        coordinates={"lat": 38.0, "lng": 23.7},
        time_start=-600,
        time_end=200,
    ),
]


def to_graph_node(entity: DomainEntity) -> dict[str, Any]:
    """Rebuild a graph node from a fixture entity — the projection's inverse."""
    properties: dict[str, Any] = {
        "pinakes_id": entity.id,
        "associated_language_ids": entity.language_ids,
    }
    if entity.region:
        properties["region"] = entity.region
    if entity.coordinates:
        properties["lat"] = entity.coordinates["lat"]
        properties["lon"] = entity.coordinates["lng"]
    if entity.time_start is not None:
        properties["time_start"] = entity.time_start
    if entity.time_end is not None:
        properties["time_end"] = entity.time_end
    return {
        "csid": f"cs:{entity.domain}:{entity.id}",
        "labels": [correlation.DOMAIN_LABELS.get(entity.domain, "Entity")],
        "name": entity.name,
        "properties": properties,
    }


class RecordingLoader:
    """A fake node loader that answers each domain's label from the fixture."""

    def __init__(self) -> None:
        self.labels: list[str] = []
        self._by_label = {
            correlation.DOMAIN_LABELS["language"]: [
                to_graph_node(entity) for entity in LANGUAGES
            ],
            correlation.DOMAIN_LABELS["cuisine"]: [
                to_graph_node(entity) for entity in CUISINES
            ],
        }

    def __call__(self, label: str) -> list[dict[str, Any]]:
        self.labels.append(label)
        return self._by_label.get(label, [])


def reference(relationship_type: str) -> dict[str, Any]:
    """What the in-memory path computes for the fixture."""
    return correlation.rank_correlations(
        "language",
        "cuisine",
        relationship_type,
        correlation.score_correlations(
            relationship_type, LANGUAGES, CUISINES, NOW_YEAR
        ),
    )


# ── The scorers ──────────────────────────────────────────────────────────────


def test_co_occurrence_scores_jaccard_similarity_of_language_sets() -> None:
    scored = correlation.compute_co_occurrence(LANGUAGES, CUISINES)
    by_pair = {
        (entry["entityA"]["id"], entry["entityB"]["id"]): entry for entry in scored
    }
    assert set(by_pair) == {("lat", "roman"), ("grc", "greek")}
    # One shared id out of a one-element union.
    assert by_pair[("lat", "roman")]["score"] == 1
    assert by_pair[("lat", "roman")]["evidence"] == [
        "Shared language IDs: lat",
        "Jaccard similarity: 1/1",
    ]


def test_an_entity_with_no_languages_never_co_occurs() -> None:
    orphan = DomainEntity(
        id="x",
        name="X",
        domain="cuisine",
        language_ids=[],
        region=None,
        coordinates=None,
        time_start=None,
        time_end=None,
    )
    assert correlation.compute_co_occurrence(LANGUAGES, [orphan]) == []


def test_temporal_correlation_needs_a_start_and_scores_the_overlap() -> None:
    scored = correlation.compute_temporal_correlation(LANGUAGES, CUISINES, NOW_YEAR)
    latin_roman = next(
        entry
        for entry in scored
        if (entry["entityA"]["id"], entry["entityB"]["id"]) == ("lat", "roman")
    )
    # -500..400 inside -700..600: 900 of the 1300-year span, plus a 0.05 boost
    # for the shared `lat` id.
    assert latin_roman["score"] == 0.74
    assert latin_roman["evidence"] == [
        "Temporal overlap: 900 years (-500 to 400)",
        "Also share languages: lat",
    ]


def test_an_open_ended_span_is_closed_at_now_year() -> None:
    living = DomainEntity(
        id="ita",
        name="Italian",
        domain="language",
        language_ids=["ita"],
        region=None,
        coordinates=None,
        time_start=1000,
        time_end=None,
    )
    modern = DomainEntity(
        id="pizza",
        name="Pizza",
        domain="cuisine",
        language_ids=[],
        region=None,
        coordinates=None,
        time_start=1700,
        time_end=None,
    )
    (scored,) = correlation.compute_temporal_correlation([living], [modern], NOW_YEAR)
    assert scored["evidence"] == [
        f"Temporal overlap: {NOW_YEAR - 1700} years (1700 to {NOW_YEAR})"
    ]


def test_the_diagonal_is_dropped_on_id_and_domain_together() -> None:
    """Correlating a domain with itself is legal; only the self-pair goes."""
    scored = correlation.compute_co_occurrence(LANGUAGES, LANGUAGES)
    assert all(
        entry["entityA"]["id"] != entry["entityB"]["id"] for entry in scored
    )


def test_geographic_overlap_reads_distance_region_and_shared_languages() -> None:
    scored = correlation.compute_geographic_overlap(LANGUAGES, CUISINES)
    latin_roman = next(
        entry
        for entry in scored
        if (entry["entityA"]["id"], entry["entityB"]["id"]) == ("lat", "roman")
    )
    # Same coordinates ⇒ proximity 1, capped after the shared-language boost.
    assert latin_roman["score"] == 1
    assert latin_roman["evidence"] == [
        "Geographic distance: 0 km",
        "Shared region: Southern Europe",
        "Shared languages: lat",
    ]


def test_a_pair_with_no_evidence_is_not_a_correlation() -> None:
    far = DomainEntity(
        id="far",
        name="Far",
        domain="cuisine",
        language_ids=[],
        region="Oceania",
        coordinates={"lat": -30.0, "lng": 150.0},
        time_start=None,
        time_end=None,
    )
    assert correlation.compute_geographic_overlap(LANGUAGES, [far]) == []


def test_ranking_sorts_descending_caps_at_fifty_and_summarizes() -> None:
    many = [
        {
            "entityA": {"id": f"a{i}", "name": "A", "domain": "language"},
            "entityB": {"id": f"b{i}", "name": "B", "domain": "cuisine"},
            "score": i / 100,
            "evidence": [],
        }
        for i in range(60)
    ]
    ranked = correlation.rank_correlations("language", "cuisine", "co-occurrence", many)
    assert len(ranked["correlations"]) == correlation.RESULT_LIMIT
    assert ranked["correlations"][0]["score"] == 0.59
    assert ranked["summary"] == (
        "Found 50 co-occurrence correlations between language and cuisine "
        "domains (avg score: 0.35)."
    )


def test_an_empty_result_still_summarizes() -> None:
    ranked = correlation.rank_correlations("language", "music", "co-occurrence", [])
    assert ranked["correlations"] == []
    assert ranked["summary"].endswith("(avg score: 0.00).")


# ── The graph projection ─────────────────────────────────────────────────────


def test_the_projection_reads_the_canonical_node_properties() -> None:
    node = {
        "csid": "cs:language:lat",
        "labels": ["Language"],
        "name": "Latin",
        "properties": {
            "pinakes_id": "lat",
            "associated_language_ids": ["lat"],
            "region": "Southern Europe",
            "lat": 41.9,
            "lon": 12.5,
            "time_start": -700,
            "time_end": 600,
        },
    }
    assert correlation.graph_node_to_domain_entity(node, "language") == LANGUAGES[0]


def test_the_projection_falls_back_to_csid_and_drops_partial_coordinates() -> None:
    node = {
        "csid": "cs:cuisine:roman",
        "labels": ["Cuisine"],
        "name": "Roman Cuisine",
        "properties": {"lat": 41.9},  # no lon ⇒ no coordinates
    }
    assert correlation.graph_node_to_domain_entity(node, "cuisine") == DomainEntity(
        id="cs:cuisine:roman",
        name="Roman Cuisine",
        domain="cuisine",
        language_ids=[],
        region=None,
        coordinates=None,
        time_start=None,
        time_end=None,
    )


# ── Parity: the graph path equals the in-memory path ─────────────────────────


@pytest.mark.parametrize("relationship_type", correlation.RELATIONSHIP_TYPES)
def test_the_graph_path_matches_the_in_memory_path(relationship_type: str) -> None:
    from_graph = correlation.correlate_via_graph(
        "language",
        "cuisine",
        relationship_type,
        load_nodes=RecordingLoader(),
        now_year=NOW_YEAR,
    )
    expected = reference(relationship_type)
    assert from_graph == expected
    # Sanity: the fixture really does correlate, so this is not a trivial match.
    assert from_graph["correlations"]


def test_each_domain_is_loaded_from_its_canonical_label() -> None:
    loader = RecordingLoader()
    correlation.correlate_via_graph(
        "language", "cuisine", "co-occurrence", load_nodes=loader, now_year=NOW_YEAR
    )
    assert loader.labels == ["Language", "Cuisine"]


def test_a_domain_with_no_graph_label_is_unavailable() -> None:
    with pytest.raises(EngineUnavailable):
        correlation.correlate_via_graph(
            "music", "cuisine", "co-occurrence", load_nodes=RecordingLoader()
        )


# ── The feature flag and the degradation ─────────────────────────────────────


def _fallback() -> dict[str, Any]:
    return reference("co-occurrence")


def test_the_flag_is_off_by_default_and_reads_the_usual_truthy_words() -> None:
    enabled = correlation.is_graph_correlation_enabled
    assert enabled({}) is False
    assert enabled({"CORRELATION_GRAPH_ENABLED": "false"}) is False
    assert enabled({"CORRELATION_GRAPH_ENABLED": "true"}) is True


def test_domains_map_to_canonical_labels() -> None:
    assert correlation.graph_domain_label("civilization") == "Culture"
    assert correlation.graph_domain_label("music") is None
    assert correlation.is_graph_eligible("language", "religion") is True
    assert correlation.is_graph_eligible("language", "music") is False


def test_a_disabled_flag_never_touches_the_graph() -> None:
    loader = RecordingLoader()
    result, source = correlation.correlate_with_graph_fallback(
        "language",
        "cuisine",
        "co-occurrence",
        _fallback,
        load_nodes=loader,
        now_year=NOW_YEAR,
        env={},
    )
    assert source == "memory"
    assert loader.labels == []
    assert result == _fallback()


def test_an_ineligible_domain_never_touches_the_graph() -> None:
    loader = RecordingLoader()
    _, source = correlation.correlate_with_graph_fallback(
        "haplogroup",
        "cuisine",
        "co-occurrence",
        _fallback,
        load_nodes=loader,
        now_year=NOW_YEAR,
        env={"CORRELATION_GRAPH_ENABLED": "true"},
    )
    assert source == "memory"
    assert loader.labels == []


def test_an_enabled_eligible_query_is_served_from_the_graph() -> None:
    result, source = correlation.correlate_with_graph_fallback(
        "language",
        "cuisine",
        "co-occurrence",
        _fallback,
        load_nodes=RecordingLoader(),
        now_year=NOW_YEAR,
        env={"CORRELATION_GRAPH_ENABLED": "1"},
    )
    assert source == "graph"
    assert result == _fallback()


def test_an_unreachable_graph_degrades_to_the_in_memory_path() -> None:
    def unavailable(_label: str) -> list[dict[str, Any]]:
        raise EngineUnavailable("Neo4j down")

    result, source = correlation.correlate_with_graph_fallback(
        "language",
        "cuisine",
        "co-occurrence",
        _fallback,
        load_nodes=unavailable,
        now_year=NOW_YEAR,
        env={"CORRELATION_GRAPH_ENABLED": "yes"},
    )
    assert source == "memory"
    assert result == _fallback()


def test_any_other_failure_propagates_rather_than_being_masked() -> None:
    def boom(_label: str) -> list[dict[str, Any]]:
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        correlation.correlate_with_graph_fallback(
            "language",
            "cuisine",
            "co-occurrence",
            _fallback,
            load_nodes=boom,
            env={"CORRELATION_GRAPH_ENABLED": "on"},
        )


# ── The corpus loaders ───────────────────────────────────────────────────────


def write_correlation_corpus(lexicons: Path) -> None:
    (lexicons / "languages.tsv").write_text(
        "id\tname\tfamily_id\tregion\tstatus\tlatitude\tlongitude\n"
        "lat\tLatin\titalic\tSouthern Europe\thistorical\t41.9\t12.5\n"
        "grc\tAncient Greek\thellenic\tSouthern Europe\thistorical\t38.0\t23.7\n"
        # No family_id ⇒ not a language.
        "xxx\tOrphan\t\tNowhere\tliving\t0\t0\n",
        encoding="utf-8",
    )
    (lexicons / "cuisines.tsv").write_text(
        "id\tname\tregion\tcoordinates\tassociated_language_ids\ttime_origin\ttime_end\n"
        'roman\tRoman Cuisine\tSouthern Europe\t{"lat": 41.9, "lng": 12.5}\t'
        '["lat"]\t-500\t400\n'
        # A blank coordinate cell is the origin, not nothing — see corpus.py.
        "nowhere\tNowhere Cuisine\t\t\t[]\tnull\tnull\n",
        encoding="utf-8",
    )


def test_the_language_loader_skips_a_row_with_no_family(
    isolated_data_trees: dict[str, Path],
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    write_correlation_corpus(lexicons)
    entities = correlation.load_domain("language", lexicons)
    assert [entity.id for entity in entities] == ["lat", "grc"]
    assert entities[0].coordinates == {"lat": 41.9, "lng": 12.5}
    # A language's only "associated language" is itself.
    assert entities[0].language_ids == ["lat"]


def test_a_blank_coordinate_cell_reads_as_the_origin(
    isolated_data_trees: dict[str, Path],
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    write_correlation_corpus(lexicons)
    nowhere = next(
        entity
        for entity in correlation.load_domain("cuisine", lexicons)
        if entity.id == "nowhere"
    )
    assert nowhere.coordinates == {"lat": 0.0, "lng": 0.0}
    # The literal "null" cell is the corpus's absent-year sentinel.
    assert nowhere.time_start is None


def test_an_unknown_domain_loads_nothing(tmp_path: Path) -> None:
    assert correlation.load_domain("not-a-domain", tmp_path) == []


# ── The routes ───────────────────────────────────────────────────────────────


def test_correlate_answers_from_the_in_memory_path_by_default(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_correlation_corpus(isolated_data_trees["lexicons"])
    response = unbuilt_client.post(
        "/api/cross-domain/correlate",
        json={
            "domainA": "language",
            "domainB": "cuisine",
            "relationshipType": "co-occurrence",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "memory"
    assert payload["domainA"] == "language"
    assert payload["correlations"][0]["entityA"]["id"] == "lat"
    assert payload["summary"].startswith("Found 1 co-occurrence correlations")


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"domainA": "language"},
        {"domainA": "language", "domainB": "cuisine"},
        {"domainA": "", "domainB": "cuisine", "relationshipType": "co-occurrence"},
        [1, 2, 3],
    ],
)
def test_a_missing_field_is_a_400_naming_all_three(
    unbuilt_client: TestClient, body: Any
) -> None:
    response = unbuilt_client.post("/api/cross-domain/correlate", json=body)
    assert response.status_code == 400
    assert response.json() == {
        "message": "Missing required fields: domainA, domainB, relationshipType"
    }


def test_the_prebuilt_queries_are_the_curated_catalog(
    unbuilt_client: TestClient,
) -> None:
    payload = unbuilt_client.get("/api/cross-domain/prebuilt-queries").json()
    assert payload["count"] == len(correlation.PREBUILT_QUERIES) == 4
    assert [query["id"] for query in payload["queries"]] == [
        "ie-r1b",
        "islam-arabic",
        "austronesian-outrigger",
        "roman-roads-romance",
    ]
    assert payload["queries"][0]["request"] == {
        "domainA": "language",
        "domainB": "haplogroup",
        "relationshipType": "co-occurrence",
    }


# ── The graph read behind it ─────────────────────────────────────────────────


def test_nodes_by_label_matches_on_the_label_and_projects_each_node(
    fake_graph: Any,
) -> None:
    """`graph.nodes_by_label` is the one engine read not addressed by csid."""
    node = FakeNode(
        "4:n:1",
        ["Language", "Entity"],
        {"csid": "cs:language:lat", "name": "Latin", "pinakes_id": "lat"},
    )
    driver = fake_graph(lambda _cypher, _params: FakeResult([{"n": node}], ["n"]))

    assert engine_graph.nodes_by_label("Language") == [
        {
            "csid": "cs:language:lat",
            "labels": ["Language", "Entity"],
            "name": "Latin",
            "properties": {"pinakes_id": "lat"},
        }
    ]
    ((cypher, _params),) = driver.queries
    assert cypher == "MATCH (n:`Language`) RETURN n"


def test_a_label_that_is_not_an_identifier_never_reaches_cypher(
    fake_graph: Any,
) -> None:
    """A `:LABEL` has no parameter slot, so refusing the string is the defence."""
    driver = fake_graph(lambda _cypher, _params: FakeResult([], ["n"]))
    with pytest.raises(EngineFailure):
        engine_graph.nodes_by_label("Language` ) DETACH DELETE n //")
    assert driver.queries == []
