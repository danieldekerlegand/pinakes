"""End-to-end proof that dump hydration feeds the ontology linkers more edges.

Drives the real chain offline — ``wikidata-dump`` adapter →
:func:`~culturescrape.schema.mapper.map_records` → the full linker pipeline
(:func:`~culturescrape.ontology.run.run_linkers`) — over the committed fixture
dump slice, and asserts that turning on hydration makes a strictly richer graph:
the label-only baseline yields no inferred edges, while the hydrated run produces
edges in every dimension (temporal, geographic, genetic, linguistic).
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from culturescrape.acquire import CategorySpec, SourceSpec, WikidataDumpAdapter
from culturescrape.ontology import run_linkers, select_linkers
from culturescrape.schema.mapper import map_records
from culturescrape.schema.tsvio import Row

_DUMP = Path(__file__).parent / "fixtures" / "wikidata" / "peruvian_dishes_dump.json"

#: The class the fixture dishes are instances of (Peruvian dish).
_DISH_CLASS = "Q746549"
#: The class the fixture languages are instances of (language).
_LANGUAGE_CLASS = "Q34770"


def _spec(label: str, cls: str, **params: str) -> CategorySpec:
    return CategorySpec(
        id="c",
        label=label,
        description="d",
        source=SourceSpec(
            type="wikidata-dump",
            params={"path": str(_DUMP), "class": cls, **params},
        ),
        dimensions=(),
    )


def _nodes(label: str, cls: str, **params: str) -> list[Row]:
    spec = _spec(label, cls, **params)
    records = list(WikidataDumpAdapter().fetch(spec))
    return map_records(records, spec)


def _edge_types(label: str, cls: str, **params: str) -> Counter[str]:
    nodes = _nodes(label, cls, **params)
    linked = run_linkers(nodes, [], select_linkers(None))
    return Counter(str(edge.get(":TYPE")) for edge in linked.edges)


def test_baseline_dump_yields_no_inferred_edges() -> None:
    # Without hydration a dump category carries only label+identity, so the
    # linkers have no dimension columns to work from.
    types = _edge_types("Dish;CulturalArtifact", _DISH_CLASS, transitive="true")
    assert types == Counter()


def test_hydration_drives_temporal_geographic_and_genetic_edges() -> None:
    types = _edge_types(
        "Dish;CulturalArtifact",
        _DISH_CLASS,
        hydrate="default",
        transitive="true",
    )
    # temporal: inception years are hydrated onto the nodes as time_start/time_end,
    # but pairwise CONTEMPORARY_WITH/PRECEDES/FOLLOWS are no longer materialised
    # (T-SR-US-001) — they are derived on demand by the Datalog rules over those
    # bounds, so no such edge is stored here.
    assert types["CONTEMPORARY_WITH"] == 0
    assert types["PRECEDES"] == 0
    assert types["FOLLOWS"] == 0
    # geographic: country of origin resolves to a place, one LOCATED_IN per dish.
    assert types["LOCATED_IN"] == 3
    # genetic: "based on" (P144) resolves to a dish in the set.
    assert types["DERIVED_FROM"] == 1


def test_hydration_drives_linguistic_edges() -> None:
    types = _edge_types("Language", _LANGUAGE_CLASS, hydrate="language")
    # linguistic: a parent (P279) gives DESCENDS_FROM, a country gives SPOKEN_IN.
    assert types["DESCENDS_FROM"] >= 1
    assert types["SPOKEN_IN"] >= 1


def test_hydrated_columns_land_on_the_canonical_node() -> None:
    nodes = _nodes(
        "Dish;CulturalArtifact",
        _DISH_CLASS,
        hydrate="default",
        transitive="true",
        hydrate_languages="en;es",
    )
    by_csid = {n["csid"]: n for n in nodes}
    ceviche = by_csid["cs:dish:Q207058"]
    # Temporal / geographic dimension columns are resolved, not raw.
    assert ceviche["time_start"] == "1535"
    assert ceviche["place_qid"] == "Q419"
    assert ceviche["lat"] == "-12.05"
    assert ceviche["lon"] == "-77.05"
    # Multilingual labels became aliases (primary name excluded).
    assert ceviche["aliases"] == ["seviche", "cebiche"]
    # The genetic reference rides onto the node for the linker to resolve.
    assert by_csid["cs:dish:Q3037464"]["derived_from_qid"] == "Q207058"


def test_more_edges_with_hydration_than_without() -> None:
    label = "Dish;CulturalArtifact"
    baseline = sum(_edge_types(label, _DISH_CLASS, transitive="true").values())
    hydrated = sum(
        _edge_types(
            label, _DISH_CLASS, hydrate="default", transitive="true"
        ).values()
    )
    assert hydrated > baseline
