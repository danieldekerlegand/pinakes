"""Bulk Wikidata acquisition into the review queue (pinakes:65 US-1).

The half of `server/services/engine-acquisition.ts` that carries meaning — the
catalog, the query, the record → contribution mapping and the run — now backing
the MCP `reconcile` tool. `engine-acquisition.test.ts` is this file's suite on
the other side; the numbers and the skip rules are the same.

Everything runs against a **fixture adapter**, so no SPARQL leaves the machine.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import Provenance, RawRecord

from pinakes.acquire import catalog, job
from pinakes.contributions.store import ContributionStore


class FixtureAdapter(SourceAdapter):
    """Yields recorded rows — the seam `pinakes.engine.acquisition` already has."""

    name = "wikidata-sparql"
    source_type = "wikidata-sparql"

    def __init__(self, records: list[RawRecord]) -> None:
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from self._records


def record(**fields: str) -> RawRecord:
    return RawRecord(
        fields=dict(fields),
        provenance=Provenance(
            source="wikidata",
            source_url=fields.get("item", ""),
            source_query="SELECT ?item WHERE {}",
            retrieved_at="2026-08-05T00:00:00Z",
            confidence=0.9,
        ),
    )


# ── The catalog ──────────────────────────────────────────────────────────────


def test_the_four_domains_are_the_ones_the_dashboard_offers() -> None:
    assert [c.domain for c in catalog.list_acquisition_categories()] == [
        "civilizations",
        "sites",
        "figures",
        "trade-goods",
    ]


def test_an_absent_or_unknown_domain_resolves_to_nothing() -> None:
    assert catalog.resolve_acquisition_category(None) is None
    assert catalog.resolve_acquisition_category("") is None
    assert catalog.resolve_acquisition_category("moons") is None
    assert (
        catalog.resolve_acquisition_category("sites")
        is catalog.ACQUISITION_CATALOG["sites"]
    )


def test_a_coordinate_required_domain_binds_the_coordinate_triple() -> None:
    """Bound, not OPTIONAL — so every returned row has what the bucket requires."""
    sites = catalog.ACQUISITION_CATALOG["sites"]
    civilizations = catalog.ACQUISITION_CATALOG["civilizations"]

    assert "  ?item wdt:P625 ?coord ." in catalog.build_acquisition_query(sites)
    assert "OPTIONAL { ?item wdt:P625 ?coord . }" in catalog.build_acquisition_query(
        civilizations
    )


def test_a_positive_limit_bounds_the_query_and_anything_else_does_not() -> None:
    civilizations = catalog.ACQUISITION_CATALOG["civilizations"]

    assert catalog.build_acquisition_query(civilizations, 25).endswith("LIMIT 25")
    assert "LIMIT" not in catalog.build_acquisition_query(civilizations, 0)
    assert "LIMIT" not in catalog.build_acquisition_query(civilizations, None)


def test_the_spec_is_what_the_engine_parses() -> None:
    """It used to be YAML for a child process; it is a mapping for an import."""
    from pinakes.engine import acquisition

    spec = catalog.category_spec(catalog.ACQUISITION_CATALOG["figures"], 5)
    parsed = acquisition.category(spec)

    assert parsed.id == "wikidata-historical-figures"
    assert parsed.label == "Concept;CulturalArtifact"


# ── WKT coordinates ──────────────────────────────────────────────────────────


def test_a_wkt_point_is_read_longitude_first() -> None:
    assert job.parse_wkt_point("Point(-77.0428 -12.0464)") == {
        "lat": -12.0464,
        "lng": -77.0428,
    }


@pytest.mark.parametrize(
    "value", [None, "", "POLYGON(1 2)", "Point(200 0)", "Point(0 91)", "Point(a b)"]
)
def test_an_unusable_coordinate_is_none_not_a_guess(value: str | None) -> None:
    assert job.parse_wkt_point(value) is None


# ── Record → contribution ────────────────────────────────────────────────────


def test_a_row_becomes_an_auto_derived_add_awaiting_review() -> None:
    civilizations = catalog.ACQUISITION_CATALOG["civilizations"]

    draft = job.record_to_contribution(
        record(itemLabel="Sumer", qid="Q35355", image="https://img.example/s.jpg"),
        civilizations,
    )

    assert draft is not None
    assert draft["entityType"] == "civilization"
    assert draft["action"] == "add"
    assert draft["entityData"]["source"] == "pinakes_engine-wikidata"
    assert draft["entityData"]["autoDerived"] is True
    # A structured source, not an LLM — the review UI keys off this.
    assert draft["entityData"]["aiGenerated"] is False
    assert draft["entityData"]["wikidataQid"] == "Q35355"
    assert draft["entityData"]["imageUrl"] == "https://img.example/s.jpg"
    # 0.9 → 90, and always < 100 so it reads as needs-review.
    assert draft["confidence"] == 90


def test_an_unlabeled_item_is_skipped_when_the_label_service_echoes_the_qid() -> (
    None
):
    civilizations = catalog.ACQUISITION_CATALOG["civilizations"]

    echoed = record(itemLabel="Q42", qid="Q42")
    blank = record(itemLabel="  ", qid="Q42")

    assert job.record_to_contribution(echoed, civilizations) is None
    assert job.record_to_contribution(blank, civilizations) is None


def test_a_coordinate_required_domain_skips_a_row_without_one() -> None:
    sites = catalog.ACQUISITION_CATALOG["sites"]

    missing = record(itemLabel="Nowhere", qid="Q1")
    assert job.record_to_contribution(missing, sites) is None
    kept = job.record_to_contribution(
        record(itemLabel="Caral", qid="Q2", coord="Point(-77.52 -10.89)"), sites
    )
    assert kept is not None
    assert kept["entityData"]["coordinates"] == {"lat": -10.89, "lng": -77.52}


def test_the_source_url_falls_back_to_the_qid_page() -> None:
    civilizations = catalog.ACQUISITION_CATALOG["civilizations"]

    draft = job.record_to_contribution(
        record(itemLabel="Sumer", qid="Q35355"), civilizations
    )

    assert draft is not None
    assert draft["sources"][0]["url"] == "https://www.wikidata.org/wiki/Q35355"
    assert draft["sources"][0]["title"] == "Wikidata Q35355 via pinakes-engine"


# ── The run ──────────────────────────────────────────────────────────────────


def test_a_run_queues_every_usable_row_and_counts_the_rest(tmp_path: Path) -> None:
    store = ContributionStore(tmp_path / "queue")

    outcome = job.run(
        catalog.ACQUISITION_CATALOG["civilizations"],
        adapter=FixtureAdapter(
            [
                record(itemLabel="Sumer", qid="Q35355"),
                record(itemLabel="Akkad", qid="Q35355"),
                # Unlabeled: the label service echoed the QID.
                record(itemLabel="Q42", qid="Q42"),
            ]
        ),
        contributions=store,
        cache_dir=tmp_path / "cache",
    )

    assert outcome.acquired == 3
    assert outcome.queued == 2
    assert outcome.skipped == 1
    assert len(outcome.contribution_ids) == 2
    # Never a live TSV write — the rows are in the review queue.
    queued = store.load_all()
    assert {c["entityData"]["name"] for c in queued} == {"Sumer", "Akkad"}
    assert all(c["status"] == "pending" for c in queued)


def test_the_outcome_is_json_ready_for_the_tool_result(tmp_path: Path) -> None:
    outcome = job.run(
        catalog.ACQUISITION_CATALOG["trade-goods"],
        adapter=FixtureAdapter([record(itemLabel="Lapis lazuli", qid="Q3")]),
        contributions=ContributionStore(tmp_path / "queue"),
        cache_dir=tmp_path / "cache",
    )

    payload = outcome.as_dict()
    assert payload["domain"] == "trade-goods"
    assert payload["queued"] == 1
    assert payload["report"]["category_id"] == "wikidata-trade-goods"
