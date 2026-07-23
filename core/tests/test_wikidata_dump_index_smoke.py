"""Smoke test building the class-membership index over a **real** slice.

Companion to ``test_wikidata_slice_smoke.py``: it runs only when a real,
API-composed slice has actually been built on this machine (see
``docs/wikidata-dump-runbook.md``). CI and a fresh checkout have no slice — the
whole module is ``skipif``-gated on the file existing, so it never fails a build
that hasn't provisioned one. Where a slice is present it proves the on-disk KV
index (US-002) builds against genuine bytes, round-trips through disk, and
answers ``P31``/``P279*`` membership with memory-bounded lookups.

The index is written to a **temp dir** (never beside the gitignored slice) so a
smoke run leaves no artifact behind.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from culturescrape.acquire.wikidata_dump import (
    INSTANCE_OF,
    DumpReadStats,
    claim_entity_ids,
    iter_entities,
)
from culturescrape.acquire.wikidata_dump_index import (
    build_index,
    dump_fingerprint,
    load_index,
)

#: Where ``build-slice`` writes by convention (gitignored); overridable by env.
_DEFAULT_SLICE_DIR = Path(__file__).parent.parent / "out" / "wikidata"


def _resolve_slice() -> Path | None:
    """The real slice to smoke-test, or ``None`` when none is present.

    Mirrors ``test_wikidata_slice_smoke``: honours
    ``CULTURESCRAPE_WIKIDATA_SLICE`` (an explicit path), else the newest
    ``*.json``/``*.json.gz``/``*.json.bz2`` in the conventional output dir
    (ignoring ``.manifest.json`` sidecars).
    """
    env = os.environ.get("CULTURESCRAPE_WIKIDATA_SLICE")
    if env:
        path = Path(env)
        return path if path.exists() else None
    if not _DEFAULT_SLICE_DIR.is_dir():
        return None
    candidates = [
        p
        for p in _DEFAULT_SLICE_DIR.iterdir()
        if p.is_file()
        and not p.name.endswith(".manifest.json")
        and p.name.endswith((".json", ".json.gz", ".json.bz2"))
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


_SLICE = _resolve_slice()

pytestmark = pytest.mark.skipif(
    _SLICE is None,
    reason="no real Wikidata slice present "
    "(build one with `culturescrape build-slice`; see docs/wikidata-dump-runbook.md)",
)


def _first_p31_pair(slice_path: Path) -> tuple[str, str] | None:
    """Return a real ``(member_qid, class_qid)`` P31 pair from the slice."""
    for entity in iter_entities(slice_path):
        classes = claim_entity_ids(entity, INSTANCE_OF)
        if classes:
            return entity["id"], classes[0]
    return None


def test_index_builds_and_queries_real_slice(tmp_path: Path) -> None:
    """Build the index over the real slice; it round-trips and answers lookups."""
    assert _SLICE is not None  # narrowed by skipif; reasserted for the type
    index_path = tmp_path / "slice.index.sqlite3"
    stats = DumpReadStats()
    built = build_index(_SLICE, index_path, stats=stats)
    try:
        assert stats.entities > 0
        assert index_path.exists()
        # The fingerprint stamped on the index is the slice's own.
        assert built.fingerprint == dump_fingerprint(_SLICE)
        # A real slice has classes with members and a subclass graph.
        assert built.class_count > 0
        assert built.subclass_parent_count > 0
    finally:
        built.close()

    pair = _first_p31_pair(_SLICE)
    assert pair is not None, "the real slice carries no P31 statements"
    member, cls = pair

    # Round-trip through disk: a freshly loaded index agrees with the built one.
    loaded = load_index(index_path, _SLICE)
    try:
        direct = loaded.member_qids((cls,), transitive=False)
        transitive = loaded.member_qids((cls,), transitive=True)
        assert member in direct, f"{member} should be a direct P31 member of {cls}"
        # Transitive membership adds P279 descendants' instances — never fewer.
        assert direct <= transitive
        # classes_of inverts instances: the member reports its class.
        assert cls in loaded.classes_of(member)
    finally:
        loaded.close()
