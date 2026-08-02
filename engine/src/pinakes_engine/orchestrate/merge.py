"""Compose several dump blueprints and the pinakes export into one corpus.

US-003 proved a *single* blueprint (food-drink) builds from the Wikidata dump
slice offline. US-004 needs the next shape: **several** dump domains (language,
myth-religion) stitched together *and* merged with the existing pinakes
convergence corpus — so a Wikidata language that pinakes already curates
collapses to one node rather than duplicating.

The stitch itself is not new: :func:`pinakes_engine.orchestrate.corpus.build_corpus`
already stitches every category in a job into one graph (same-``csid`` rows
merge, ``docs/data-model.md``), and ``csid`` is QID-anchored, so a shared
Wikidata entity reconciles across the dump and the pinakes export for free.
The only missing piece is *assembly*: turning N blueprints (in dump mode) plus
the pinakes export into the single job whose categories ``build_corpus``
then stitches. That is what :func:`write_merged_job` does — it reuses
:func:`pinakes_engine.orchestrate.generate.generate` (dump mode) per blueprint and
appends a ``pinakes-export`` category, then writes one runnable job.

Run the result with ``pinakes_engine run`` exactly like any other job; the merged
corpus's node/edge counts by label/``:TYPE`` (and pinakes's contribution to
them) land in its committed manifest (:mod:`pinakes_engine.orchestrate.manifest`),
and its idempotent double-load is verifiable offline
(:func:`pinakes_engine.neo4j.merge_load.verify_idempotent_load`).
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from pinakes_engine.orchestrate.generate import DumpSource, generate

#: The category id / filename the pinakes export is written under.
PINAKES_CATEGORY_ID = "pinakes"

#: The dimensions the pinakes export category declares — the canonical rows
#: already carry their own ``:LABEL``/``:TYPE``, so this only names the linker
#: dimensions the merged corpus runs (matching ``categories/pinakes.yml``).
_PINAKES_DIMENSIONS = ("temporal", "geographic", "linguistic", "genetic")


class MergeError(ValueError):
    """Raised when a merged job cannot be assembled (bad blueprint or paths)."""


@dataclass(frozen=True)
class MergeResult:
    """What :func:`write_merged_job` produced."""

    categories: tuple[Path, ...]
    job: Path


def write_merged_job(
    blueprints: Sequence[str | Path],
    out_dir: str | Path,
    job_path: str | Path,
    *,
    dump: DumpSource,
    name: str = "merged-dump",
    pinakes_export: str | Path | None = None,
    force: bool = False,
    min_component_fraction: float | None = None,
    min_provenance_completeness: float | None = None,
    tiered_trust: bool = True,
) -> MergeResult:
    """Expand *blueprints* (dump mode) + the pinakes export into one job.

    Each blueprint is expanded through :func:`generate` in dump mode (every
    ``wikidata_class`` stub retargeted at *dump*) into *out_dir*; when
    *pinakes_export* is given, a ``pinakes-export`` category reading
    that export root is written alongside them. A single runnable job listing
    every category is then written to *job_path*, with *output_root* defaulting
    to ``out/<name>`` (mirroring :func:`generate`) and the two corpus floors
    written when set. ``pinakes_engine run <job>`` stitches the lot into the
    merged corpus.

    Raises:
        MergeError: If no blueprint is given, or the pinakes export path is
            not a directory.
    """
    if not blueprints:
        raise MergeError("write_merged_job needs at least one blueprint")
    out_dir = Path(out_dir)
    job_path = Path(job_path)

    category_paths: list[Path] = []
    for blueprint in blueprints:
        result = generate(blueprint, out_dir, dump=dump, force=force)
        category_paths.extend(result.categories)

    if pinakes_export is not None:
        category_paths.append(
            _write_pinakes_category(
                out_dir, Path(pinakes_export), force=force
            )
        )

    job = _write_job(
        job_path,
        name,
        category_paths,
        force=force,
        min_component_fraction=min_component_fraction,
        min_provenance_completeness=min_provenance_completeness,
        tiered_trust=tiered_trust,
    )
    return MergeResult(categories=tuple(category_paths), job=job)


def _write_pinakes_category(
    out_dir: Path, export_root: Path, *, force: bool
) -> Path:
    """Write a ``pinakes-export`` category reading *export_root*.

    The export root is stored as an **absolute** path so the category resolves
    regardless of the directory ``pinakes_engine run`` is invoked from (the
    adapter reads ``source.query`` relative to the working directory).
    """
    if not export_root.is_dir():
        raise MergeError(
            f"pinakes export root {export_root} is not a directory "
            "(expected a nodes/ + edges/ canonical export)"
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{PINAKES_CATEGORY_ID}.yml"
    if dest.exists() and not force:
        raise MergeError(f"{dest} already exists; pass force=True to overwrite")
    mapping: dict[str, Any] = {
        "id": PINAKES_CATEGORY_ID,
        "label": "Entity",
        "description": (
            "pinakes's canonical nodes/edges export, ingested as a "
            "first-class source for the merged corpus."
        ),
        "source": {
            "type": "dump",
            "query": str(export_root.resolve()),
            "params": {"adapter": "pinakes-export", "source": "pinakes"},
        },
        "dimensions": list(_PINAKES_DIMENSIONS),
        "links": [],
    }
    header = (
        "# Generated by `pinakes_engine merge` — the pinakes convergence\n"
        "# export ingested as a first-class source for the merged corpus.\n"
    )
    dest.write_text(header + _render_yaml(mapping), encoding="utf-8")
    return dest


def _write_job(
    job_path: Path,
    name: str,
    categories: Sequence[Path],
    *,
    force: bool,
    min_component_fraction: float | None,
    min_provenance_completeness: float | None,
    tiered_trust: bool,
) -> Path:
    """Write a runnable job listing *categories*, paths relative to the job."""
    if job_path.exists() and not force:
        raise MergeError(f"{job_path} already exists; pass force=True to overwrite")
    job_path.parent.mkdir(parents=True, exist_ok=True)
    base = job_path.parent
    rels = [os.path.relpath(path, base) for path in categories]
    output_root = os.path.relpath(base.parent / "out" / name, base)
    mapping: dict[str, Any] = {
        "name": name,
        "description": f"Merged dump + pinakes corpus ({name}).",
        "categories": rels,
        "output_root": output_root,
        # A merged corpus stitches several sources that type a shared entity
        # differently; collapse same-QID nodes so one QID is one node.
        "reconcile_shared_qids": True,
        # Auto-admission policy (US-002): QID-anchored + reference-backed facts
        # admit with rubric confidence + tier label, weaker acquired facts
        # quarantine; data/source/lexicons/ are never written. Per-tier QA gates
        # default to
        # tiers.DEFAULT_TIER_GATES (add a `tier_gates:` block to override).
        "tiered_trust": tiered_trust,
    }
    if min_component_fraction is not None:
        mapping["min_component_fraction"] = min_component_fraction
    if min_provenance_completeness is not None:
        mapping["min_provenance_completeness"] = min_provenance_completeness
    header = (
        f"# Generated by `pinakes_engine merge` ({name}).\n"
        f"# Run with: pinakes_engine run {job_path}\n"
    )
    job_path.write_text(header + _render_yaml(mapping), encoding="utf-8")
    return job_path


def _render_yaml(mapping: dict[str, Any]) -> str:
    return yaml.safe_dump(
        mapping, sort_keys=False, allow_unicode=True, default_flow_style=False
    )


__all__ = [
    "PINAKES_CATEGORY_ID",
    "MergeError",
    "MergeResult",
    "write_merged_job",
]
