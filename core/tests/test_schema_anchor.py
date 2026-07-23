"""Tests for anchoring node rows to Getty AAT/TGN/ULAN ids.

A small ``anchor_index.nt`` excerpt is read through the real Getty dump adapter
(Tasklist 1) and folded into a :class:`GettyIndex`, so the in-memory index, the
normalized-label key, and the label+type decision (match / ambiguous / none)
are exercised end-to-end without a multi-gigabyte real dump. The fixture carries
an intra-vocabulary label collision (`"mercury"`) so the no-false-anchor rule is
genuinely tested, not merely asserted.
"""

import json
import logging
from pathlib import Path

import pytest

from culturescrape.acquire import CategorySpec, GettyDumpAdapter, SourceSpec
from culturescrape.schema import (
    ANCHOR_KEY,
    OVERFLOW_KEY,
    AnchorDecision,
    GettyEntry,
    GettyIndex,
    Row,
    anchor_row,
    anchor_rows,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "getty" / "anchor_index.nt"


def _spec() -> CategorySpec:
    return CategorySpec(
        id="getty-anchors",
        label="Concept",
        description="Getty vocabulary anchors",
        source=SourceSpec(type="dump", query=str(_FIXTURE), params={}),
        dimensions=(),
    )


def _index() -> GettyIndex:
    return GettyIndex.from_records(GettyDumpAdapter().fetch(_spec()))


def _row(**overrides: object) -> Row:
    base: Row = {":LABEL": ["Material"], "name": "Frescoes (Paintings)"}
    base.update(overrides)  # type: ignore[arg-type]
    return base


# --- building the index ----------------------------------------------------


def test_index_is_keyed_by_normalized_label() -> None:
    # "Frescoes (Paintings)" indexed under its normalized (casefolded) form.
    hits = _index().candidates("  frescoes   (paintings) ")
    assert [entry.getty_id for entry in hits] == ["300132410"]


def test_foreign_namespace_subjects_are_not_indexed() -> None:
    assert _index().candidates("Not a Getty entity") == ()


def test_collision_keeps_both_entries_under_one_key() -> None:
    ids = sorted(entry.getty_id for entry in _index().candidates("MERCURY"))
    assert ids == ["300011099", "300312000"]


def test_from_records_skips_unlabelled_entries() -> None:
    index = GettyIndex()
    index.add(GettyEntry("300", "", "getty_aat", "", "uri"))  # empty label
    assert len(index) == 0


# --- resolving -------------------------------------------------------------


def test_resolve_matches_single_compatible_candidate() -> None:
    result = _index().resolve("Roma", {"getty_tgn"})
    assert result.decision is AnchorDecision.MATCHED
    assert result.getty_id == "7000874"
    assert result.vocabulary == "getty_tgn"


def test_resolve_is_none_when_vocabulary_excludes_the_match() -> None:
    # "Roma" exists, but only in TGN; an AAT-only query finds nothing.
    result = _index().resolve("Roma", {"getty_aat"})
    assert result.decision is AnchorDecision.NONE
    assert result.getty_id is None


def test_resolve_is_ambiguous_for_a_label_collision() -> None:
    result = _index().resolve("mercury", {"getty_aat"})
    assert result.decision is AnchorDecision.AMBIGUOUS
    assert result.getty_id is None
    assert len(result.candidates) == 2


def test_resolve_is_none_for_unknown_name() -> None:
    assert _index().resolve("nonesuch", {"getty_aat"}).decision is AnchorDecision.NONE


# --- anchoring a row -------------------------------------------------------


def test_match_attaches_getty_id() -> None:
    row = _row()
    result = anchor_row(row, _index())
    assert result is not None and result.decision is AnchorDecision.MATCHED
    assert row["getty_id"] == "300132410"


def test_place_row_anchors_to_tgn() -> None:
    row = _row(name="Roma", **{":LABEL": ["Place"]})
    anchor_row(row, _index())
    assert row["getty_id"] == "7000874"


def test_person_row_anchors_to_ulan() -> None:
    row = _row(name="Diego Rivera", **{":LABEL": ["Person"]})
    anchor_row(row, _index())
    assert row["getty_id"] == "500002600"


def test_ambiguous_match_is_skipped_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    row = _row(name="mercury")
    with caplog.at_level(logging.WARNING, logger="culturescrape.schema.anchor"):
        result = anchor_row(row, _index())

    assert result is not None and result.decision is AnchorDecision.AMBIGUOUS
    assert "getty_id" not in row  # no false anchor
    assert "ambiguous Getty anchor for 'mercury'" in caplog.text
    assert "300011099" in caplog.text and "300312000" in caplog.text


def test_type_mismatch_does_not_anchor() -> None:
    # The name matches a TGN place, but the row is typed as a Material (AAT).
    row = _row(name="Roma")
    result = anchor_row(row, _index())
    assert result is not None and result.decision is AnchorDecision.NONE
    assert "getty_id" not in row


def test_unmapped_label_is_skipped() -> None:
    row = _row(name="Frescoes (Paintings)", **{":LABEL": ["Dish"]})
    assert anchor_row(row, _index()) is None
    assert "getty_id" not in row


def test_row_with_existing_getty_id_is_skipped() -> None:
    row = _row(getty_id="300999999")
    assert anchor_row(row, _index()) is None
    assert row["getty_id"] == "300999999"  # untouched


def test_row_without_name_is_skipped() -> None:
    row: Row = {":LABEL": ["Material"]}
    assert anchor_row(row, _index()) is None
    assert "getty_id" not in row


def test_decision_is_recorded_in_provenance() -> None:
    row = _row()
    anchor_row(row, _index())
    record = json.loads(row[OVERFLOW_KEY])[ANCHOR_KEY]  # type: ignore[arg-type]
    assert record["decision"] == "matched"
    assert record["getty_id"] == "300132410"
    assert record["vocabulary"] == "getty_aat"
    assert record["candidates"] == 1


def test_recording_preserves_existing_overflow() -> None:
    row = _row(name="mercury", **{OVERFLOW_KEY: json.dumps({"hazard": "toxic"})})
    anchor_row(row, _index())
    overflow = json.loads(row[OVERFLOW_KEY])  # type: ignore[arg-type]
    assert overflow["hazard"] == "toxic"  # untouched raw field
    assert overflow[ANCHOR_KEY]["decision"] == "ambiguous"


def test_anchor_rows_processes_each_row() -> None:
    rows = [_row(), _row(name="Roma", **{":LABEL": ["Place"]})]
    out = anchor_rows(rows, _index())
    assert out[0]["getty_id"] == "300132410"
    assert out[1]["getty_id"] == "7000874"
