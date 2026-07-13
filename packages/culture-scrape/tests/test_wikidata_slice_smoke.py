"""Smoke test over a **real** Wikidata slice, when one is present.

Unlike the committed-fixture smoke test (``test_wikidata_dump_smoke.py``), this
runs only when a real, API-composed slice has actually been built on this machine
(``culturescrape build-slice ...``; see ``docs/wikidata-dump-runbook.md``). CI and
a fresh checkout have no slice — the whole module is ``skipif``-gated on the file
existing, so it never fails a build that hasn't provisioned one. Where a slice is
present it proves the real bytes still satisfy the reader contract: the first N
entities parse cleanly (no skips), carry string QIDs and ``P31`` claims, and the
sidecar manifest documents the three blueprint domains it was built to cover.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from culturescrape.acquire import DumpReadStats, iter_entities
from culturescrape.acquire.wikidata_slice import MANIFEST_FORMAT

#: How many leading entities to inspect — a smoke check, not a full scan.
_SAMPLE = 50
#: Where ``build-slice`` writes by convention (gitignored); overridable by env.
_DEFAULT_SLICE_DIR = Path(__file__).parent.parent / "out" / "wikidata"


def _resolve_slice() -> Path | None:
    """The real slice to smoke-test, or ``None`` when none is present.

    Honours ``CULTURESCRAPE_WIKIDATA_SLICE`` (an explicit path); otherwise looks
    for the newest ``*.json``/``*.json.gz``/``*.json.bz2`` in the conventional
    output dir, ignoring the ``.manifest.json`` sidecars.
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


def test_real_slice_first_entities_parse_cleanly() -> None:
    """The first N real entities read back as well-formed dump entities."""
    assert _SLICE is not None  # narrowed by skipif; reasserted for the type
    stats = DumpReadStats()
    sample: list[dict[str, object]] = []
    for entity in iter_entities(_SLICE, stats=stats):
        sample.append(entity)
        if len(sample) >= _SAMPLE:
            break
    assert sample, "the slice yielded no entities"
    assert stats.skipped == 0, "real slice had malformed lines in the leading sample"
    for entity in sample:
        assert isinstance(entity.get("id"), str) and entity["id"].startswith("Q")
        assert entity.get("labels"), f"{entity['id']} has no labels"
    # Real Wikidata items carry P31 (instance of) claims — the class membership
    # the whole dump path selects on.
    assert any("P31" in entity.get("claims", {}) for entity in sample)


def test_real_slice_manifest_covers_blueprint_domains() -> None:
    """The sidecar manifest records the three domains the slice was built for."""
    assert _SLICE is not None
    sidecar = _SLICE.with_name(_SLICE.name + ".manifest.json")
    if not sidecar.exists():
        pytest.skip(f"slice {_SLICE.name} has no manifest sidecar")
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload["format"] == MANIFEST_FORMAT
    assert payload["entity_total"] > 0
    domains = payload.get("domains", {})
    # A slice built from the three blueprint YAMLs covers exactly these.
    assert {"food-drink", "language", "myth-religion"} <= set(domains)
