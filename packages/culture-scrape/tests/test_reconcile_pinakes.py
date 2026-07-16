"""Tests for the offline reconciliation of Pinakes-origin rows.

Unlike :mod:`test_schema_reconcile` (which drives the Wikidata *network*
reconciler), these exercise the offline cascade that settles a Pinakes
row's identity against the nodes already in the corpus using only local signals:
a shared language code, an exact ``(name, type, region)``, then a fuzzy name.
Each cascade tier, the ambiguity path (never auto-merged), and the provenance-
preserving merge are covered on hand-built fixtures — no network, no live graph.
"""

import json

from culturescrape.schema import (
    PINAKES_ID_KEY,
    OVERFLOW_KEY,
    RECONCILIATION_LOCAL_KEY,
    LocalMatchTier,
    LocalOutcome,
    Row,
    reconcile_pinakes,
)


def _existing(*, label: str = "Language", **overrides: object) -> Row:
    base: Row = {
        "csid": "cs:language:Q1",
        ":LABEL": [label],
        "name": "Proto-Indo-European",
        "lang": "en",
        "wikidata_qid": "Q1",
        "language_code": "ine-pro",
        "source": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q1",
        "confidence": "0.9",
    }
    base.update(overrides)  # type: ignore[arg-type]
    return base


def _incoming(*, label: str = "Language", **overrides: object) -> Row:
    base: Row = {
        "csid": "cs:language:pie",
        ":LABEL": [label],
        "name": "Proto-Indo-European",
        "lang": "en",
        "language_code": "ine-pro",
        PINAKES_ID_KEY: "pie",
        "source": "pinakes",
        "confidence": "0.8",
    }
    base.update(overrides)  # type: ignore[arg-type]
    return base


def _local_record(row: Row) -> dict[str, object]:
    raw = row[OVERFLOW_KEY]
    assert isinstance(raw, str)
    overflow = json.loads(raw)
    assert isinstance(overflow, dict)
    record = overflow[RECONCILIATION_LOCAL_KEY]
    assert isinstance(record, dict)
    return record


# --- cascade tiers ---------------------------------------------------------


def test_language_code_tier_matches_across_spellings() -> None:
    # Same ISO code, different name spelling — the code carries the identity.
    incoming = _incoming(name="Proto Indo European", csid="cs:language:pie")
    report = reconcile_pinakes([incoming], [_existing()])

    result = report.results[0]
    assert result.outcome is LocalOutcome.MATCHED
    assert result.tier is LocalMatchTier.LANGUAGE_CODE
    assert result.matched_csid == "cs:language:Q1"
    assert result.confidence == 1.0


def test_name_region_tier_matches_without_a_code() -> None:
    existing = _existing(
        csid="cs:archaeological-culture:Q9",
        label="ArchaeologicalCulture",
        name="Yamnaya",
        wikidata_qid="Q9",
        language_code="",
        region="pontic steppe",
    )
    incoming = _incoming(
        csid="cs:archaeological-culture:yamnaya",
        label="ArchaeologicalCulture",
        name="  yamnaya ",  # normalized to the same key
        language_code="",
        region="Pontic Steppe",
    )
    report = reconcile_pinakes([incoming], [existing])

    result = report.results[0]
    assert result.outcome is LocalOutcome.MATCHED
    assert result.tier is LocalMatchTier.NAME_REGION
    assert result.matched_csid == "cs:archaeological-culture:Q9"


def test_name_region_key_is_region_scoped() -> None:
    # Same name + type but a different region does not match on the exact tier.
    existing = _existing(
        label="ArchaeologicalCulture",
        name="Beaker",
        language_code="",
        region="iberia",
    )
    incoming = _incoming(
        label="ArchaeologicalCulture",
        name="Beaker",
        language_code="",
        region="britain",
    )
    report = reconcile_pinakes([incoming], [existing])
    assert report.results[0].outcome is LocalOutcome.NEW


def test_fuzzy_tier_matches_near_names_in_the_same_block() -> None:
    existing = _existing(
        csid="cs:place:Q5",
        label="Place",
        name="Mohenjo-daro",
        wikidata_qid="Q5",
        language_code="",
    )
    incoming = _incoming(
        csid="cs:place:mohenjodaro",
        label="Place",
        name="Mohenjodaro",
        language_code="",
    )
    report = reconcile_pinakes([incoming], [existing])

    result = report.results[0]
    assert result.outcome is LocalOutcome.MATCHED
    assert result.tier is LocalMatchTier.FUZZY_NAME
    assert 0.85 <= result.confidence < 1.0


def test_new_when_no_tier_fires() -> None:
    existing = _existing()
    incoming = _incoming(
        csid="cs:deity:inti",
        label="Deity",
        name="Inti",
        language_code="",
    )
    report = reconcile_pinakes([incoming], [existing])

    result = report.results[0]
    assert result.outcome is LocalOutcome.NEW
    assert result.tier is None
    assert result.matched_csid is None
    assert result.confidence == 0.0
    assert result.candidates == ()


# --- ambiguity (never auto-merged) -----------------------------------------


def test_two_existing_nodes_sharing_a_code_are_ambiguous() -> None:
    rival_a = _existing(csid="cs:language:Q1", wikidata_qid="Q1")
    rival_b = _existing(csid="cs:language:Q2", wikidata_qid="Q2", name="PIE")
    report = reconcile_pinakes([_incoming()], [rival_a, rival_b])

    result = report.results[0]
    assert result.outcome is LocalOutcome.AMBIGUOUS
    assert result.matched_csid is None
    assert {c.csid for c in result.candidates} == {"cs:language:Q1", "cs:language:Q2"}
    # Ambiguous rows are held back — never silently merged into the corpus.
    assert report.rows == ()
    assert report.ambiguous == (result,)


def test_fuzzy_ambiguity_lists_all_rival_candidates() -> None:
    rival_a = _existing(
        csid="cs:place:Q5", label="Place", name="Kalibangan", language_code=""
    )
    rival_b = _existing(
        csid="cs:place:Q6", label="Place", name="Kalibanga", language_code=""
    )
    incoming = _incoming(
        csid="cs:place:kalibangaa",
        label="Place",
        name="Kalibangaa",
        language_code="",
    )
    report = reconcile_pinakes([incoming], [rival_a, rival_b])

    result = report.results[0]
    assert result.outcome is LocalOutcome.AMBIGUOUS
    assert result.tier is LocalMatchTier.FUZZY_NAME
    assert {c.csid for c in result.candidates} == {"cs:place:Q5", "cs:place:Q6"}


def test_fuzzy_threshold_is_configurable() -> None:
    existing = _existing(
        csid="cs:place:Q5", label="Place", name="Harappa", language_code=""
    )
    incoming = _incoming(
        csid="cs:place:harappaa",
        label="Place",
        name="Harappan",
        language_code="",
    )
    loose = reconcile_pinakes([incoming], [existing], fuzzy_threshold=0.5)
    strict = reconcile_pinakes([incoming], [existing], fuzzy_threshold=0.99)
    assert loose.results[0].outcome is LocalOutcome.MATCHED
    assert strict.results[0].outcome is LocalOutcome.NEW


# --- merge preserves both sources' provenance ------------------------------


def test_matched_merge_preserves_both_provenance_and_identity() -> None:
    existing = _existing(source="wikidata", source_url="https://wd/Q1")
    incoming = _incoming(source="pinakes", source_url="")
    report = reconcile_pinakes([incoming], [existing])

    assert len(report.rows) == 1
    merged = report.rows[0]
    # existing node's identity is kept
    assert merged["csid"] == "cs:language:Q1"
    assert merged["wikidata_qid"] == "Q1"
    # both sources survive in provenance
    assert merged["source"] == "wikidata;pinakes"
    assert merged["source_url"] == "https://wd/Q1"
    # Pinakes's round-trip id is retained
    assert merged[PINAKES_ID_KEY] == "pie"
    # confidence is the higher of the pair
    assert merged["confidence"] == repr(0.9)


def test_matched_merge_enriches_blank_columns_and_unions_aliases() -> None:
    existing = _existing(name="Proto-Indo-European", description="")
    incoming = _incoming(
        name="Proto Indo European",  # matched on code; becomes an alias
        description="reconstructed ancestor",
        aliases=["PIE"],
    )
    report = reconcile_pinakes([incoming], [existing])
    merged = report.rows[0]

    assert merged["description"] == "reconstructed ancestor"  # blank enriched
    aliases = merged["aliases"]
    assert isinstance(aliases, list)
    assert "Proto Indo European" in aliases  # incoming name preserved as alias
    assert "PIE" in aliases


def test_decision_is_recorded_in_overflow_for_matched_and_new() -> None:
    matched_in = _incoming()
    new_in = _incoming(
        csid="cs:deity:inti", label="Deity", name="Inti", language_code=""
    )
    report = reconcile_pinakes([matched_in, new_in], [_existing()])

    merged, fresh = report.rows
    merged_record = _local_record(merged)
    assert merged_record["outcome"] == "matched"
    assert merged_record["tier"] == "language_code"
    assert merged_record["matched_csid"] == "cs:language:Q1"

    new_record = _local_record(fresh)
    assert new_record["outcome"] == "new"
    assert "matched_csid" not in new_record


# --- report shape ----------------------------------------------------------


def test_report_counts_and_buckets() -> None:
    matched_in = _incoming()
    new_in = _incoming(
        csid="cs:deity:inti", label="Deity", name="Inti", language_code=""
    )
    rival_a = _existing(csid="cs:language:Q1", wikidata_qid="Q1")
    rival_b = _existing(csid="cs:language:Q2", wikidata_qid="Q2")
    ambiguous_in = _incoming(csid="cs:language:pie2", name="PIE")

    report = reconcile_pinakes(
        [matched_in, new_in, ambiguous_in], [rival_a, rival_b, _existing()]
    )
    # rival_a/rival_b share code ine-pro with a third existing -> every code
    # lookup is ambiguous, so matched_in is ambiguous too; only new_in stands.
    counts = report.counts()
    assert counts["new"] == 1
    assert counts["ambiguous"] == 2
    assert len(report.new) == 1
    assert len(report.ambiguous) == 2
    # only the new row is safe to load; ambiguous rows are withheld
    assert len(report.rows) == 1
    assert report.rows[0]["csid"] == "cs:deity:inti"


def test_results_are_in_input_order() -> None:
    a = _incoming(csid="cs:deity:a", label="Deity", name="A", language_code="")
    b = _incoming(csid="cs:deity:b", label="Deity", name="B", language_code="")
    report = reconcile_pinakes([a, b], [])
    assert [r.csid for r in report.results] == ["cs:deity:a", "cs:deity:b"]


def test_empty_existing_corpus_makes_everything_new() -> None:
    report = reconcile_pinakes([_incoming()], [])
    assert report.results[0].outcome is LocalOutcome.NEW
    assert len(report.rows) == 1
