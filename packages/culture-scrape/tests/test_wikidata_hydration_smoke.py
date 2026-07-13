"""Rich hydration exercised over a **real** Wikidata slice (US-005).

The unit tests in ``test_wikidata_hydration`` drive multi-value / qualifier /
reference extraction on synthetic entities; this companion proves the same
:data:`~culturescrape.acquire.wikidata_hydration.LANGUAGE_PROFILE` upgrade holds
on genuine dump bytes — that real language entities actually carry the multiple
parents, the countries, and the P854 citations the richer profile now aggregates.

Like the other real-data smoke tests it is ``skipif``-gated on a slice being
present (built with ``culturescrape build-slice``; see
``docs/wikidata-dump-runbook.md``), so CI and a fresh checkout skip the whole
module rather than fail it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from culturescrape.acquire.wikidata_dump import iter_entities
from culturescrape.acquire.wikidata_dump_index import default_index_path, load_index
from culturescrape.acquire.wikidata_hydration import LANGUAGE_PROFILE, hydrate_entity
from culturescrape.schema.tsvio import MULTI_DELIMITER

#: Where ``build-slice`` writes by convention (gitignored); overridable by env.
_DEFAULT_SLICE_DIR = Path(__file__).parent.parent / "out" / "wikidata"


def _resolve_slice() -> Path | None:
    """The real slice to smoke-test, or ``None`` when none is present.

    Mirrors ``test_wikidata_slice_smoke`` / ``test_blueprint_food_drink_dump_smoke``:
    honours ``CULTURESCRAPE_WIKIDATA_SLICE`` (an explicit path), else the newest
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


def _language_members(slice_path: Path) -> set[str]:
    """QIDs of the slice's language-domain members, from the manifest + index."""
    manifest = json.loads(Path(f"{slice_path}.manifest.json").read_text("utf-8"))
    classes = tuple(
        c["class"] for c in manifest["domains"]["language"]["classes"]
    )
    index = load_index(default_index_path(slice_path), slice_path)
    try:
        return index.member_qids(classes, transitive=True)
    finally:
        index.close()


def test_language_profile_aggregates_real_multi_values_and_citations() -> None:
    """The richer language profile recovers values a single-value read would drop."""
    assert _SLICE is not None
    members = _language_members(_SLICE)
    assert members, "the slice carries no language members to hydrate"

    hydrated = 0
    multi_parent = 0  # entities whose parent_qids holds MORE than parent_qid
    with_references = 0
    for entity in iter_entities(_SLICE):
        if entity["id"] not in members:
            continue
        fields = hydrate_entity(entity, LANGUAGE_PROFILE, alias_languages=("en",))
        hydrated += 1
        parents = fields.get("parent_qids", "")
        if parents:
            # The single-value field is always the first of the multi field.
            assert parents.split(MULTI_DELIMITER)[0] == fields["parent_qid"]
            if MULTI_DELIMITER in parents:
                multi_parent += 1
        references = fields.get("references", "")
        if references:
            with_references += 1
            urls = references.split(MULTI_DELIMITER)
            assert all(part.startswith("http") for part in urls)

    assert hydrated > 0
    # The real slice genuinely exercises both new capabilities (measured: 54 and
    # 18 for the reference build; assert only that the mechanism fires at all so
    # the test is robust to a differently-built slice).
    assert multi_parent > 0, "no language had >1 P279 parent — multi not exercised"
    assert with_references > 0, "no language carried a P854 citation — refs absent"
