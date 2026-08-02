"""Tests for the dump-backed corpus enrichment pass."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.wikidata_dump import iter_entities
from pinakes_engine.acquire.wikidata_enrich import (
    ENRICHED_KEY,
    EnrichmentReport,
    build_qid_lookup,
    corpus_qids,
    enrich_nodes,
    entity_named_languages,
    resolve_dump_version,
)
from pinakes_engine.acquire.wikidata_hydration import DEFAULT_PROFILE
from pinakes_engine.schema.tsvio import Row

_DUMP = Path(__file__).parent / "fixtures" / "wikidata" / "peruvian_dishes_dump.json"

_PROVENANCE: dict[str, str] = {
    "source": "wikidata",
    "source_url": "https://www.wikidata.org/wiki/",
    "source_query": "wikidata-sparql",
    "retrieved_at": "2026-06-01T00:00:00+00:00",
    "confidence": "1.0",
}


def _node(qid: str, name: str, **extra: str) -> Row:
    return {
        "csid": f"cs:dish:{qid}",
        ":LABEL": ["Dish"],
        "name": name,
        "lang": "en",
        "wikidata_qid": qid,
        **_PROVENANCE,
        **extra,
    }


def _lookup(*qids: str) -> dict[str, dict[str, Any]]:
    return build_qid_lookup(_DUMP, qids)


def _enrich(
    nodes: list[Row], *, languages: tuple[str, ...] = ("en", "es")
) -> tuple[list[Row], EnrichmentReport]:
    lookup = build_qid_lookup(_DUMP, corpus_qids(nodes))
    return enrich_nodes(
        nodes,
        lookup,
        profile=DEFAULT_PROFILE,
        languages=languages,
        dump_version="20240101",
    )


def test_build_qid_lookup_keeps_only_wanted_entities() -> None:
    lookup = _lookup("Q207058", "Q3037464")
    assert set(lookup) == {"Q207058", "Q3037464"}
    assert lookup["Q207058"]["labels"]["en"]["value"] == "ceviche"


def test_build_qid_lookup_empty_request_does_not_scan() -> None:
    assert build_qid_lookup(_DUMP, []) == {}


def test_corpus_qids_collects_well_formed_qids_only() -> None:
    nodes = [_node("Q207058", "ceviche"), _node("", "anon"), _node("not-a-qid", "x")]
    assert corpus_qids(nodes) == {"Q207058"}


def test_enrichment_fills_missing_dimension_columns() -> None:
    enriched, report = _enrich([_node("Q207058", "ceviche")])
    node = enriched[0]
    assert node["time_start"] == "1535"  # inception -> temporal
    assert node["place_qid"] == "Q419"  # country of origin -> geographic
    assert node["lat"] == "-12.05"
    assert node["lon"] == "-77.05"
    # en alias + es label (the en primary name itself is excluded).
    assert node["aliases"] == ["seviche", "cebiche"]
    assert report.nodes_enriched == 1
    assert report.fields_filled["time_start"] == 1


def test_enrichment_carries_reference_fields_for_the_linkers() -> None:
    # tiradito is "based on" (P144) ceviche; the ref rides onto the node so the
    # genetic linker can resolve it, but it is not a persisted column.
    enriched, _ = _enrich([_node("Q3037464", "tiradito")])
    assert enriched[0]["derived_from_qid"] == "Q207058"


def test_enrichment_attests_languages_for_named_in() -> None:
    enriched, _ = _enrich([_node("Q207058", "ceviche")], languages=("en", "es", "qu"))
    # ceviche has en + es names but no Quechua label in the fixture.
    assert enriched[0]["named_in_langs"] == ["en", "es"]


def test_enrichment_never_clobbers_an_existing_value() -> None:
    # A pre-existing (presumed authoritative) place wins over the dump's.
    enriched, report = _enrich([_node("Q207058", "ceviche", place_qid="Q298")])
    node = enriched[0]
    assert node["place_qid"] == "Q298"  # not overwritten by the dump's Q419
    assert "place_qid" not in report.fields_filled
    assert node["time_start"] == "1535"  # the empty column is still filled


def test_enrichment_records_dump_provenance_in_extra() -> None:
    enriched, _ = _enrich([_node("Q207058", "ceviche")])
    extra = json.loads(enriched[0]["extra"])  # type: ignore[arg-type]
    assert extra[ENRICHED_KEY]["dump"] == "20240101"
    assert "time_start" in extra[ENRICHED_KEY]["fields"]
    assert "lat" in extra[ENRICHED_KEY]["fields"]


def test_enrichment_does_not_mutate_the_input_rows() -> None:
    nodes = [_node("Q207058", "ceviche")]
    _enrich(nodes)
    assert "time_start" not in nodes[0]
    assert "extra" not in nodes[0]


def test_enrichment_is_idempotent() -> None:
    once, _ = _enrich([_node("Q207058", "ceviche")])
    twice, report = enrich_nodes(
        once,
        build_qid_lookup(_DUMP, corpus_qids(once)),
        profile=DEFAULT_PROFILE,
        languages=("en", "es"),
        dump_version="20240101",
    )
    assert twice == once  # re-enriching an enriched corpus changes nothing
    # The provenance note still lists the dump-sourced columns the first run set.
    extra = json.loads(twice[0]["extra"])  # type: ignore[arg-type]
    assert "time_start" in extra[ENRICHED_KEY]["fields"]


def test_enrichment_skips_nodes_absent_from_the_dump() -> None:
    enriched, report = _enrich([_node("Q999999", "ghost")])
    assert "time_start" not in enriched[0]
    assert report.nodes_with_qid == 1
    assert report.nodes_found == 0
    assert report.nodes_enriched == 0


def test_entity_named_languages_orders_by_request() -> None:
    entity = next(e for e in iter_entities(_DUMP) if e["id"] == "Q207058")
    assert entity_named_languages(entity, ["es", "en", "fr"]) == ["es", "en"]


def test_resolve_dump_version_reads_the_filename_date(tmp_path: Path) -> None:
    dated = tmp_path / "wikidata-20240131-all.json"
    dated.write_text("[]\n", encoding="utf-8")
    assert resolve_dump_version(dated) == "20240131"
    assert resolve_dump_version(_DUMP) == "unknown"
