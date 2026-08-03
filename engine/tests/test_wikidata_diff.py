"""Content-fingerprinted diff of two Wikidata dump slices (US-006).

The incremental corpus update path must know **which** entities changed upstream
without a live feed: it diffs the slice the corpus was built from (*old*) against a
fresher one (*new*), keyed on QID, classifying every id as added / changed / removed
/ unchanged. The classification hangs entirely on a **content fingerprint** — a hash
over exactly the parts the corpus derives from (labels/descriptions/aliases/claims/
sitelinks) and nothing volatile (``lastrevid``/``modified``/``pageid``) — so a no-op
re-export of the same knowledge does not register as a change. These tests pin that
contract on fixtures.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pinakes_engine.acquire.wikidata_diff import (
    DumpDiff,
    diff_dumps,
    entity_fingerprint,
    fingerprint_dump,
    write_delta_dump,
)
from pinakes_engine.acquire.wikidata_dump import iter_entities
from pinakes_engine.acquire.wikidata_slice import write_dump

_FIXTURE = Path(__file__).parent / "fixtures" / "wikidata" / "sample-dump.json"


def _entity(qid: str, label: str = "thing", **extra: Any) -> dict[str, Any]:
    """A minimal but well-formed dump entity for *qid*."""
    entity: dict[str, Any] = {
        "type": "item",
        "id": qid,
        "labels": {"en": {"language": "en", "value": label}},
        "descriptions": {},
        "aliases": {},
        "claims": {},
        "sitelinks": {},
    }
    entity.update(extra)
    return entity


# --- entity_fingerprint --------------------------------------------------------


def test_fingerprint_is_stable_across_key_order() -> None:
    """The same knowledge hashes identically regardless of dict key order."""
    a = {"labels": {"en": {"value": "x"}}, "claims": {}, "descriptions": {}}
    b = {"descriptions": {}, "claims": {}, "labels": {"en": {"value": "x"}}}
    assert entity_fingerprint(a) == entity_fingerprint(b)


def test_fingerprint_ignores_revision_metadata() -> None:
    """Volatile revision metadata must not flip the fingerprint (no-op re-export)."""
    base = _entity("Q1", "universe")
    churned = {
        **base,
        "lastrevid": 999999,
        "modified": "2026-06-01T00:00:00Z",
        "pageid": 12345,
        "ns": 0,
        "title": "Q1",
    }
    assert entity_fingerprint(base) == entity_fingerprint(churned)


def test_fingerprint_changes_on_label_edit() -> None:
    """Editing a label (content the corpus reads) flips the fingerprint."""
    before = _entity("Q1", "universe")
    after = _entity("Q1", "the cosmos")
    assert entity_fingerprint(before) != entity_fingerprint(after)


def test_fingerprint_changes_on_claim_edit() -> None:
    """Editing a claim flips the fingerprint even when the label is untouched."""
    before = _entity("Q1", "universe", claims={"P31": [{"rank": "normal"}]})
    after = _entity("Q1", "universe", claims={"P31": [{"rank": "preferred"}]})
    assert entity_fingerprint(before) != entity_fingerprint(after)


def test_fingerprint_dump_maps_every_entity(tmp_path: Path) -> None:
    """``fingerprint_dump`` streams a dump into a ``{qid: hash}`` map."""
    fps = fingerprint_dump(_FIXTURE)
    # The committed fixture holds Q1, Q42, Q146 and the P31 property (its malformed
    # line is skipped by the reader).
    assert set(fps) == {"Q1", "Q42", "Q146", "P31"}
    assert all(len(h) == 64 for h in fps.values())  # SHA-256 hex


# --- diff_dumps ----------------------------------------------------------------


def _dump(entities: list[dict[str, Any]], path: Path) -> Path:
    write_dump(entities, path)
    return path


def test_diff_classifies_added_changed_removed_unchanged(tmp_path: Path) -> None:
    old = _dump(
        [_entity("Q1", "universe"), _entity("Q2", "gone"), _entity("Q3", "same")],
        tmp_path / "wikidata-20260101-old.json",
    )
    new = _dump(
        [
            _entity("Q1", "the cosmos"),  # changed
            _entity("Q3", "same"),  # unchanged
            _entity("Q4", "new"),  # added
            # Q2 dropped -> removed
        ],
        tmp_path / "wikidata-20260601-new.json",
    )

    diff = diff_dumps(old, new)

    assert diff.added == ("Q4",)
    assert diff.changed == ("Q1",)
    assert diff.removed == ("Q2",)
    assert diff.unchanged == 1  # Q3
    assert diff.upsert_qids == ("Q1", "Q4")  # added ∪ changed, sorted
    assert diff.has_changes
    assert "1 added, 1 changed, 1 removed, 1 unchanged" == diff.summary


def test_diff_of_identical_slices_has_no_changes(tmp_path: Path) -> None:
    """Re-diffing the same content is a clean no-op — nothing to upsert."""
    entities = [_entity("Q1", "universe"), _entity("Q42", "Douglas Adams")]
    old = _dump(entities, tmp_path / "wikidata-20260101-a.json")
    new = _dump(list(entities), tmp_path / "wikidata-20260101-b.json")

    diff = diff_dumps(old, new)

    assert diff == DumpDiff(added=(), changed=(), removed=(), unchanged=2)
    assert diff.upsert_qids == ()
    assert not diff.has_changes


def test_diff_ignores_revision_churn_end_to_end(tmp_path: Path) -> None:
    """A slice that only bumped revision metadata diffs to zero changes."""
    old = _dump([_entity("Q1", "universe")], tmp_path / "wikidata-20260101-a.json")
    churned = _entity("Q1", "universe")
    churned["lastrevid"] = 12345
    churned["modified"] = "2026-06-01T00:00:00Z"
    new = _dump([churned], tmp_path / "wikidata-20260601-b.json")

    assert not diff_dumps(old, new).has_changes


# --- write_delta_dump ----------------------------------------------------------


def test_write_delta_dump_carves_only_requested_qids(tmp_path: Path) -> None:
    new = _dump(
        [_entity("Q1", "universe"), _entity("Q2", "second"), _entity("Q3", "third")],
        tmp_path / "wikidata-20260601-new.json",
    )
    delta = tmp_path / "wikidata-delta-20260601.json.gz"

    written = write_delta_dump(new, ["Q1", "Q3"], delta)

    assert written == 2
    round_tripped = {e["id"] for e in iter_entities(delta)}
    assert round_tripped == {"Q1", "Q3"}  # the reader accepts the carved dump


def test_write_delta_dump_skips_absent_qids(tmp_path: Path) -> None:
    """A requested QID absent from the new slice is silently skipped (count < asked)."""
    new = _dump([_entity("Q1", "u")], tmp_path / "wikidata-20260601-new.json")
    delta = tmp_path / "delta.json"

    written = write_delta_dump(new, ["Q1", "Q999"], delta)

    assert written == 1
    assert [e["id"] for e in iter_entities(delta)] == ["Q1"]
