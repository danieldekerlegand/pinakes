"""Compose several dump blueprints and the LinguaScrape export into one corpus.

US-003 proved a *single* blueprint (food-drink) builds from the Wikidata dump
slice offline. US-004 needs the next shape: **several** dump domains (language,
myth-religion) stitched together *and* merged with the existing LinguaScrape
convergence corpus — so a Wikidata language that LinguaScrape already curates
collapses to one node rather than duplicating.

The stitch itself is not new: :func:`culturescrape.orchestrate.corpus.build_corpus`
already stitches every category in a job into one graph (same-``csid`` rows
merge, ``docs/data-model.md``), and ``csid`` is QID-anchored, so a shared
Wikidata entity reconciles across the dump and the LinguaScrape export for free.
The only missing piece is *assembly*: turning N blueprints (in dump mode) plus
the LinguaScrape export into the single job whose categories ``build_corpus``
then stitches. That is what :func:`write_merged_job` does — it reuses
:func:`culturescrape.orchestrate.generate.generate` (dump mode) per blueprint and
appends a ``linguascrape-export`` category, then writes one runnable job.

Run the result with ``culturescrape run`` exactly like any other job; the merged
corpus's node/edge counts by label/``:TYPE`` (and LinguaScrape's contribution to
them) land in its committed manifest (:mod:`culturescrape.orchestrate.manifest`),
and its idempotent double-load is verifiable offline
(:func:`culturescrape.neo4j.merge_load.verify_idempotent_load`).
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from culturescrape.orchestrate.generate import DumpSource, generate

#: The category id / filename the LinguaScrape export is written under.
LINGUASCRAPE_CATEGORY_ID = "linguascrape"

#: The dimensions the LinguaScrape export category declares — the canonical rows
#: already carry their own ``:LABEL``/``:TYPE``, so this only names the linker
#: dimensions the merged corpus runs (matching ``categories/linguascrape.yml``).
_LINGUASCRAPE_DIMENSIONS = ("temporal", "geographic", "linguistic", "genetic")


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
    linguascrape_export: str | Path | None = None,
    force: bool = False,
    min_component_fraction: float | None = None,
    min_provenance_completeness: float | None = None,
) -> MergeResult:
    """Expand *blueprints* (dump mode) + the LinguaScrape export into one job.

    Each blueprint is expanded through :func:`generate` in dump mode (every
    ``wikidata_class`` stub retargeted at *dump*) into *out_dir*; when
    *linguascrape_export* is given, a ``linguascrape-export`` category reading
    that export root is written alongside them. A single runnable job listing
    every category is then written to *job_path*, with *output_root* defaulting
    to ``out/<name>`` (mirroring :func:`generate`) and the two corpus floors
    written when set. ``culturescrape run <job>`` stitches the lot into the
    merged corpus.

    Raises:
        MergeError: If no blueprint is given, or the LinguaScrape export path is
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

    if linguascrape_export is not None:
        category_paths.append(
            _write_linguascrape_category(
                out_dir, Path(linguascrape_export), force=force
            )
        )

    job = _write_job(
        job_path,
        name,
        category_paths,
        force=force,
        min_component_fraction=min_component_fraction,
        min_provenance_completeness=min_provenance_completeness,
    )
    return MergeResult(categories=tuple(category_paths), job=job)


def _write_linguascrape_category(
    out_dir: Path, export_root: Path, *, force: bool
) -> Path:
    """Write a ``linguascrape-export`` category reading *export_root*.

    The export root is stored as an **absolute** path so the category resolves
    regardless of the directory ``culturescrape run`` is invoked from (the
    adapter reads ``source.query`` relative to the working directory).
    """
    if not export_root.is_dir():
        raise MergeError(
            f"LinguaScrape export root {export_root} is not a directory "
            "(expected a nodes/ + edges/ canonical export)"
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{LINGUASCRAPE_CATEGORY_ID}.yml"
    if dest.exists() and not force:
        raise MergeError(f"{dest} already exists; pass force=True to overwrite")
    mapping: dict[str, Any] = {
        "id": LINGUASCRAPE_CATEGORY_ID,
        "label": "Entity",
        "description": (
            "LinguaScrape's canonical nodes/edges export, ingested as a "
            "first-class source for the merged corpus."
        ),
        "source": {
            "type": "dump",
            "query": str(export_root.resolve()),
            "params": {"adapter": "linguascrape-export", "source": "linguascrape"},
        },
        "dimensions": list(_LINGUASCRAPE_DIMENSIONS),
        "links": [],
    }
    header = (
        "# Generated by `culturescrape merge` — the LinguaScrape convergence\n"
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
        "description": f"Merged dump + LinguaScrape corpus ({name}).",
        "categories": rels,
        "output_root": output_root,
        # A merged corpus stitches several sources that type a shared entity
        # differently; collapse same-QID nodes so one QID is one node.
        "reconcile_shared_qids": True,
    }
    if min_component_fraction is not None:
        mapping["min_component_fraction"] = min_component_fraction
    if min_provenance_completeness is not None:
        mapping["min_provenance_completeness"] = min_provenance_completeness
    header = (
        f"# Generated by `culturescrape merge` ({name}).\n"
        f"# Run with: culturescrape run {job_path}\n"
    )
    job_path.write_text(header + _render_yaml(mapping), encoding="utf-8")
    return job_path


def _render_yaml(mapping: dict[str, Any]) -> str:
    return yaml.safe_dump(
        mapping, sort_keys=False, allow_unicode=True, default_flow_style=False
    )


__all__ = [
    "LINGUASCRAPE_CATEGORY_ID",
    "MergeError",
    "MergeResult",
    "write_merged_job",
]
