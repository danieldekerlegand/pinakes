"""Tests for collapsing duplicate node rows.

The fixture below mixes the four ways two rows can name one real-world thing —
a QID duplicate, a Getty-id duplicate, an exact normalized ``(name, lang, type)``
duplicate, and a fuzzy near-duplicate — alongside genuinely distinct rows and an
identifier *conflict* (same name, different QIDs) that must never collapse. So
the precedence, the merge mechanics (alias union, highest-confidence-per-column,
provenance concatenation), and the auditable/reversible record are all exercised
end-to-end.
"""

import json

from culturescrape.schema import (
    MERGE_KEY,
    OVERFLOW_KEY,
    MergeReason,
    Row,
    merge_rows,
    merged_csid_remap,
)


def _row(csid: str, **cells: object) -> Row:
    base: Row = {
        "csid": csid,
        ":LABEL": ["Dish"],
        "lang": "en",
        "source": "wikidata",
        "source_url": f"https://example.test/{csid}",
        "retrieved_at": "2026-06-16T00:00:00Z",
        "confidence": "0.8",
    }
    base.update(cells)  # type: ignore[arg-type]
    return base


# --- precedence: clustering signals ----------------------------------------


def test_identical_qid_merges_despite_different_names() -> None:
    rows = [
        _row("cs:dish:Q1", name="Ceviche", wikidata_qid="Q1", confidence="0.9"),
        _row("cs:dish:Q1b", name="Cebiche", wikidata_qid="Q1", confidence="0.7"),
    ]
    merged = merge_rows(rows)
    assert len(merged) == 1
    record = json.loads(merged[0][OVERFLOW_KEY])[MERGE_KEY]  # type: ignore[arg-type]
    assert record["reason"] == MergeReason.WIKIDATA_QID.value


def test_identical_getty_id_merges() -> None:
    rows = [
        _row("cs:material:a", name="Bronze", getty_id="300010957"),
        _row("cs:material:b", name="Bronze alloy", getty_id="300010957"),
    ]
    merged = merge_rows(rows)
    assert len(merged) == 1
    record = json.loads(merged[0][OVERFLOW_KEY])[MERGE_KEY]  # type: ignore[arg-type]
    assert record["reason"] == MergeReason.GETTY_ID.value


def test_exact_normalized_name_lang_type_merges() -> None:
    rows = [
        _row("cs:dish:a", name="Lomo Saltado"),
        _row("cs:dish:b", name="  lomo   saltado "),
    ]
    merged = merge_rows(rows)
    assert len(merged) == 1
    record = json.loads(merged[0][OVERFLOW_KEY])[MERGE_KEY]  # type: ignore[arg-type]
    assert record["reason"] == MergeReason.EXACT_NAME.value


def test_fuzzy_near_duplicate_name_merges() -> None:
    rows = [
        _row("cs:dish:a", name="Anticuchos"),
        _row("cs:dish:b", name="Anticucho"),
    ]
    merged = merge_rows(rows)
    assert len(merged) == 1
    record = json.loads(merged[0][OVERFLOW_KEY])[MERGE_KEY]  # type: ignore[arg-type]
    assert record["reason"] == MergeReason.FUZZY_NAME.value


def test_strongest_reason_is_recorded_when_several_apply() -> None:
    # Same QID *and* same exact name — the QID (stronger) is reported.
    rows = [
        _row("cs:dish:a", name="Ceviche", wikidata_qid="Q1"),
        _row("cs:dish:b", name="Ceviche", wikidata_qid="Q1"),
    ]
    merged = merge_rows(rows)
    record = json.loads(merged[0][OVERFLOW_KEY])[MERGE_KEY]  # type: ignore[arg-type]
    assert record["reason"] == MergeReason.WIKIDATA_QID.value


# --- precedence: conflicts and non-duplicates ------------------------------


def test_different_qids_never_merge_even_with_same_name() -> None:
    rows = [
        _row("cs:dish:Q1", name="Sopa", wikidata_qid="Q1"),
        _row("cs:dish:Q2", name="Sopa", wikidata_qid="Q2"),
    ]
    assert len(merge_rows(rows)) == 2


def test_different_languages_do_not_fuzzy_merge() -> None:
    rows = [
        _row("cs:dish:a", name="Anticuchos", lang="en"),
        _row("cs:dish:b", name="Anticucho", lang="es"),
    ]
    assert len(merge_rows(rows)) == 2


def test_distinct_rows_pass_through_untouched() -> None:
    rows = [_row("cs:dish:a", name="Tacu Tacu")]
    merged = merge_rows(rows)
    assert merged == rows
    assert OVERFLOW_KEY not in merged[0]  # no merge record on a singleton


def test_order_and_count_track_the_input() -> None:
    rows = [
        _row("cs:dish:solo", name="Causa"),
        _row("cs:dish:a", name="Ceviche", wikidata_qid="Q1"),
        _row("cs:dish:b", name="Cebiche", wikidata_qid="Q1"),
        _row("cs:dish:last", name="Aji"),
    ]
    merged = merge_rows(rows)
    assert [r["name"] for r in merged] == ["Causa", "Ceviche", "Aji"]


# --- merge mechanics -------------------------------------------------------


def test_highest_confidence_value_per_column_is_kept() -> None:
    rows = [
        _row("cs:dish:Q1", name="Ceviche", wikidata_qid="Q1", confidence="0.6"),
        _row(
            "cs:dish:Q1b",
            name="Cebiche",
            wikidata_qid="Q1",
            description="Citrus-cured fish",
            confidence="0.95",
        ),
    ]
    merged = merge_rows(rows)[0]
    # The 0.95 row wins the canonical name and supplies the description.
    assert merged["name"] == "Cebiche"
    assert merged["description"] == "Citrus-cured fish"


def test_aliases_union_includes_losing_names() -> None:
    rows = [
        _row(
            "cs:dish:Q1",
            name="Ceviche",
            wikidata_qid="Q1",
            confidence="0.95",
            aliases=["Seviche"],
        ),
        _row(
            "cs:dish:Q1b",
            name="Cebiche",
            wikidata_qid="Q1",
            confidence="0.6",
            aliases=["Sebiche"],
        ),
    ]
    merged = merge_rows(rows)[0]
    assert merged["name"] == "Ceviche"
    # Both alias lists unite and the losing name "Cebiche" is preserved.
    assert set(merged["aliases"]) == {"Seviche", "Sebiche", "Cebiche"}
    assert "Ceviche" not in merged["aliases"]  # the canonical name is not an alias


def test_provenance_is_concatenated_and_confidence_is_the_highest() -> None:
    rows = [
        _row(
            "cs:dish:Q1",
            name="Ceviche",
            wikidata_qid="Q1",
            source="wikidata",
            confidence="0.6",
        ),
        _row(
            "cs:dish:Q1b",
            name="Ceviche",
            wikidata_qid="Q1",
            source="petscan",
            confidence="0.9",
        ),
    ]
    merged = merge_rows(rows)[0]
    assert set(str(merged["source"]).split(";")) == {"wikidata", "petscan"}
    assert merged["confidence"] == repr(0.9)


def test_labels_union_across_the_cluster() -> None:
    rows = [
        _row("cs:dish:Q1", name="Ceviche", wikidata_qid="Q1", **{":LABEL": ["Dish"]}),
        _row(
            "cs:dish:Q1b",
            name="Ceviche",
            wikidata_qid="Q1",
            **{":LABEL": ["Dish", "CulturalArtifact"]},
        ),
    ]
    merged = merge_rows(rows)[0]
    assert merged[":LABEL"] == ["Dish", "CulturalArtifact"]


# --- audit and reverse -----------------------------------------------------


def test_merge_record_is_auditable_and_reversible() -> None:
    rows = [
        _row("cs:dish:Q1", name="Ceviche", wikidata_qid="Q1", confidence="0.9"),
        _row("cs:dish:Q1b", name="Cebiche", wikidata_qid="Q1", confidence="0.7"),
    ]
    record = json.loads(merge_rows(rows)[0][OVERFLOW_KEY])[MERGE_KEY]  # type: ignore[arg-type]
    assert record["primary"] == "cs:dish:Q1"  # highest-confidence row survives
    # Every original row is snapshotted, so the merge can be reversed.
    assert [m["csid"] for m in record["members"]] == ["cs:dish:Q1", "cs:dish:Q1b"]
    assert record["members"] == rows


def test_existing_overflow_is_preserved_through_a_merge() -> None:
    rows = [
        _row(
            "cs:dish:Q1",
            name="Ceviche",
            wikidata_qid="Q1",
            confidence="0.9",
            **{OVERFLOW_KEY: json.dumps({"spice": "high"})},
        ),
        _row("cs:dish:Q1b", name="Cebiche", wikidata_qid="Q1", confidence="0.7"),
    ]
    overflow = json.loads(merge_rows(rows)[0][OVERFLOW_KEY])  # type: ignore[arg-type]
    assert overflow["spice"] == "high"  # carried from the primary
    assert overflow[MERGE_KEY]["reason"] == MergeReason.WIKIDATA_QID.value


def test_empty_input_returns_empty() -> None:
    assert merge_rows([]) == []


# --- merged_csid_remap: redirect map for edge endpoints --------------------


def test_merged_csid_remap_maps_losers_to_the_primary() -> None:
    # Two rows name one thing (exact name) so one csid is collapsed; the remap
    # lets a caller redirect edges that still name the merged-away csid.
    merged = merge_rows(
        [
            _row("cs:dish:a", name="Ceviche"),
            _row("cs:dish:b", name="Ceviche"),
        ]
    )
    assert len(merged) == 1
    primary = merged[0]["csid"]
    remap = merged_csid_remap(merged)
    loser = "cs:dish:b" if primary == "cs:dish:a" else "cs:dish:a"
    assert remap == {loser: primary}


def test_merged_csid_remap_is_empty_without_merges() -> None:
    # Distinct rows pass through unmerged, so nothing is redirected.
    merged = merge_rows(
        [_row("cs:dish:a", name="Ceviche"), _row("cs:dish:b", name="Bronze")]
    )
    assert len(merged) == 2
    assert merged_csid_remap(merged) == {}
