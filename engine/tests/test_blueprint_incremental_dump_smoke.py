"""End-to-end offline proof of an incremental upsert on a **real** dump slice.

US-006: a living corpus must not require full re-ingestion when a few upstream
entities change. This is the companion to the fixture-only
``test_orchestrate_incremental``: it runs only where an API-composed slice has been
built on this machine (see ``docs/wikidata-dump-runbook.md``), so CI and a fresh
checkout — which have no slice — skip the whole module rather than fail it.

It builds a small **base** corpus from the real slice, then synthesises a *fresher*
slice by editing one real entity's label and diffs the two: ``run_upsert`` must
re-hydrate exactly that one changed entity into a delta corpus and prove the delta
MERGE-loads over the base to a fixed point — an in-place update, no duplicate. The
acquisition adapter is driven with an HTTP factory that *raises*, so any accidental
network call fails the test loudly.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from pinakes_engine.acquire.factory import build_adapter
from pinakes_engine.acquire.wikidata_dump import (
    INSTANCE_OF,
    claim_entity_ids,
    iter_entities,
)
from pinakes_engine.acquire.wikidata_slice import write_dump
from pinakes_engine.orchestrate.corpus import DEFAULT_CORPUS_QA, build_corpus
from pinakes_engine.orchestrate.generate import DumpSource, generate
from pinakes_engine.orchestrate.incremental import run_upsert
from pinakes_engine.orchestrate.jobs import load_job

_DEFAULT_SLICE_DIR = Path(__file__).parent.parent / "out" / "wikidata"


def _resolve_slice() -> Path | None:
    """The real slice to smoke-test, or ``None`` when none is present."""
    env = os.environ.get("PINAKES_ENGINE_WIKIDATA_SLICE")
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
    return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None


_SLICE = _resolve_slice()

pytestmark = pytest.mark.skipif(
    _SLICE is None,
    reason="no real Wikidata slice present "
    "(build one with `pinakes_engine build-slice`; see docs/wikidata-dump-runbook.md)",
)

#: A dish is present in every food-drink slice (Q746549); one class keeps it fast.
_BLUEPRINT = {
    "defaults": {"label": "Dish;CulturalArtifact", "dimensions": ["temporal"]},
    "categories": [{"id": "dishes", "name": "dish", "wikidata_class": "Q746549"}],
}

_DISH_CLASS = "Q746549"


def _raise_no_network():  # type: ignore[no-untyped-def]
    raise AssertionError("the incremental path must not open a network connection")


def _factory(spec):  # type: ignore[no-untyped-def]
    return build_adapter(spec, http_factory=_raise_no_network)


def _first_member(slice_path: Path, class_qid: str) -> dict:
    """The first entity in *slice_path* that is a direct P31 instance of *class_qid*."""
    for entity in iter_entities(slice_path):
        if class_qid in claim_entity_ids(entity, INSTANCE_OF):
            return entity
    raise AssertionError(f"no direct instance of {class_qid} in {slice_path}")


def test_incremental_upsert_of_one_real_changed_entity(tmp_path: Path) -> None:
    assert _SLICE is not None
    slice_path = _SLICE.resolve()

    # 1. A base corpus of dishes, built offline from the real slice.
    root = tmp_path / "base"
    root.mkdir()
    blueprint = root / "bp.yml"
    blueprint.write_text(yaml.safe_dump(_BLUEPRINT), encoding="utf-8")
    result = generate(
        blueprint,
        root / "categories",
        job=root / "bp.job.yml",
        dump=DumpSource(path=slice_path, hydrate="default", transitive=True),
    )
    assert result.job is not None
    job = load_job(result.job)
    base = build_corpus(
        job,
        adapter_factory=_factory,
        force=True,
        workers=2,
        qa=DEFAULT_CORPUS_QA,
        min_component_fraction=0.0,
    )
    assert base.metrics.node_count > 0

    # 2. A fresher slice: every entity unchanged except one real dish whose English
    #    label we edit — the single upstream change the corpus must pick up.
    target = _first_member(slice_path, _DISH_CLASS)
    target_qid = target["id"]
    edited = {
        **target,
        "labels": {
            **target.get("labels", {}),
            "en": {"language": "en", "value": "SMOKE-EDITED LABEL"},
        },
    }
    new_entities = (
        edited if e["id"] == target_qid else e for e in iter_entities(slice_path)
    )
    new_slice = tmp_path / "wikidata-20990101-fresher.json.gz"
    write_dump(new_entities, new_slice)

    # 3. Upsert: only the edited dish re-hydrates, and it MERGE-loads idempotently.
    upsert = run_upsert(
        job,
        slice_path,
        new_slice,
        work_dir=tmp_path / "sync",
        corpus_dir=base.dataset_dir,
        adapter_factory=_factory,
        workers=2,
    )

    assert upsert.rebuilt
    assert upsert.plan.changed_in_corpus == (target_qid,)
    assert upsert.plan.upsert_qids == (target_qid,)
    assert upsert.categories == ("dishes",)
    assert upsert.delta_dump is not None
    assert [e["id"] for e in iter_entities(upsert.delta_dump)] == [target_qid]
    assert upsert.delta_report is not None and upsert.delta_report.idempotent
    assert upsert.upsert_report is not None and upsert.upsert_report.idempotent
    assert upsert.idempotent
