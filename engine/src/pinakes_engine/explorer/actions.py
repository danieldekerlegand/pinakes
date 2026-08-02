"""Operator actions for a category on the completeness dashboard (T7-US-011).

When a category is stale or incomplete, the dashboard should hand the operator
the exact commands to rebuild or refresh it and point at the artifacts a run
produces — without ever executing a shell from the browser. This module maps a
category id (plus the loaded :class:`~pinakes_engine.explorer.data.Corpus`) to
that operator playbook: the copy-pasteable ``pinakes_engine run`` /
``run --since`` / ``package`` commands, the on-disk Neo4j / Datalog exports and
packaged ``manifest.json`` (each flagged present or absent under the job output
root), and the most recent ``refresh-log.jsonl`` entry when a scheduled refresh
has left one.

It is pure read-only: every artifact is reported as a location to open, never
served, and the commands are text to copy, never run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pinakes_engine.explorer.data import Corpus
from pinakes_engine.orchestrate.schedule import REFRESH_LOG_NAME

#: Export subdirectories under a job output root, mirroring the names
#: :mod:`pinakes_engine.orchestrate.corpus` writes them under (kept local so the
#: read-only explorer need not import the whole build pipeline).
NEO4J_DIRNAME = "corpus-neo4j"
DATALOG_DIRNAME = "corpus-datalog"

#: The ``--since`` window the suggested scheduled-refresh command pre-fills (the
#: weekly cadence ``docs/scheduling.md`` uses for its systemd-timer example).
DEFAULT_REFRESH_WINDOW = "7d"


@dataclass(frozen=True)
class Command:
    """One copy-pasteable shell command surfaced for a category.

    *text* is the full block an operator copies: a leading ``# <category>:``
    comment (so the snippet is self-documenting and names the category it acts
    on) followed by the command itself.
    """

    label: str
    note: str
    text: str


@dataclass(frozen=True)
class Artifact:
    """An on-disk artifact a run produces, reported by location and presence.

    *path* is relative to the job output root; *present* says whether it exists
    there now (so the page can link what is built and grey out what is not).
    """

    label: str
    path: str
    present: bool


@dataclass(frozen=True)
class RefreshLogEntry:
    """The digest of one ``refresh-log.jsonl`` line for the actions page.

    *decision* is this category's own per-category reason from that run, or
    ``""`` when the run did not grade it.
    """

    timestamp: str
    cutoff: str
    refreshed: tuple[str, ...]
    skipped: tuple[str, ...]
    decision: str


@dataclass(frozen=True)
class CategoryActions:
    """The operator playbook for one category: commands, artifacts, last refresh."""

    category_id: str
    label: str
    status: str
    reasons: tuple[str, ...]
    job_spec: str
    output_root: str
    commands: tuple[Command, ...]
    artifacts: tuple[Artifact, ...]
    refresh: RefreshLogEntry | None


def category_actions(corpus: Corpus, category_id: str) -> CategoryActions | None:
    """Build the actions for *category_id*, or ``None`` if the corpus has no such
    category (so the route can render a 404).

    Returns ``None`` for a bare corpus dataset (no job output root) as well, since
    the rebuild/refresh/package commands and artifacts are all rooted at one.
    """
    status = next(
        (s for s in corpus.completeness() if s.category_id == category_id), None
    )
    if status is None or corpus.job_root is None:
        return None

    job_root = corpus.job_root
    job_spec = f"jobs/{job_root.name}.yml"
    output_root = str(job_root)
    return CategoryActions(
        category_id=category_id,
        label=status.label,
        status=status.status,
        reasons=status.reasons,
        job_spec=job_spec,
        output_root=output_root,
        commands=_commands(category_id, job_spec, output_root),
        artifacts=_artifacts(job_root),
        refresh=_last_refresh(job_root, category_id),
    )


def _commands(category_id: str, job_spec: str, output_root: str) -> tuple[Command, ...]:
    """The rebuild / scheduled-refresh / package commands for *category_id*.

    Each command's ``text`` opens with a ``# <category>:`` comment so a copied
    snippet names the category it serves; the commands themselves act on the job
    as a whole (the pipeline has no per-category run target).
    """

    def command(label: str, note: str, line: str) -> Command:
        return Command(label=label, note=note, text=f"# {category_id}: {note}\n{line}")

    return (
        command(
            "Rebuild",
            "rebuild the corpus from the job spec",
            f"pinakes_engine run {job_spec}",
        ),
        command(
            "Scheduled refresh",
            f"refresh categories not rebuilt in the last {DEFAULT_REFRESH_WINDOW}",
            f"pinakes_engine run --since {DEFAULT_REFRESH_WINDOW} {job_spec}",
        ),
        command(
            "Package",
            "package the built corpus into a publishable archive",
            f"pinakes_engine package {output_root}",
        ),
    )


def _artifacts(job_root: Path) -> tuple[Artifact, ...]:
    """The Neo4j / Datalog exports and packaged manifest under *job_root*."""
    manifest = _find_manifest(job_root)
    return (
        Artifact(
            label="Neo4j export",
            path=NEO4J_DIRNAME,
            present=(job_root / NEO4J_DIRNAME).is_dir(),
        ),
        Artifact(
            label="Datalog export",
            path=DATALOG_DIRNAME,
            present=(job_root / DATALOG_DIRNAME).is_dir(),
        ),
        Artifact(
            label="Packaged manifest",
            path=manifest or "*manifest.json",
            present=manifest is not None,
        ),
    )


def _find_manifest(job_root: Path) -> str | None:
    """The name of a packaged manifest under *job_root*, if one was written there.

    ``pinakes_engine package`` writes ``<name>-manifest.json`` beside its archive;
    when the operator points ``--out`` at the job root it lands here.
    """
    matches = sorted(p.name for p in job_root.glob("*manifest.json") if p.is_file())
    return matches[0] if matches else None


def _last_refresh(job_root: Path, category_id: str) -> RefreshLogEntry | None:
    """Parse the last line of ``<job_root>/refresh-log.jsonl``, or ``None``."""
    path = job_root / REFRESH_LOG_NAME
    if not path.is_file():
        return None
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    except OSError:
        return None
    if not lines:
        return None
    try:
        data = json.loads(lines[-1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    decision = ""
    for entry in data.get("decisions", []):
        if isinstance(entry, dict) and entry.get("category") == category_id:
            decision = str(entry.get("reason", ""))
            break
    return RefreshLogEntry(
        timestamp=str(data.get("timestamp", "")),
        cutoff=str(data.get("cutoff", "")),
        refreshed=_as_str_tuple(data.get("refreshed")),
        skipped=_as_str_tuple(data.get("skipped")),
        decision=decision,
    )


def _as_str_tuple(value: object) -> tuple[str, ...]:
    return tuple(str(item) for item in value) if isinstance(value, list) else ()


__all__ = [
    "Artifact",
    "CategoryActions",
    "Command",
    "RefreshLogEntry",
    "category_actions",
]
