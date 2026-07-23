"""Bundle a built corpus into one publishable, verifiable artifact.

The repository stays lean (see ``docs/storage.md``): everything generated under
``out/`` is regenerable from the category specs and is never committed. To
*share* a corpus you publish it as a release artifact instead — and this module
makes that one command. It tars the canonical dataset and its Neo4j / Datalog
exports into a single deterministic ``<name>.tar.gz`` beside a ``manifest.json``
that records the node/edge counts, a per-file SHA-256, and a digest over the
whole bundle, so an upload to a release or object store is one step and a
downloader can verify integrity.

Now that share-alike sources are in the graph, the manifest also self-describes by
**licence** (source-breadth US-005): a ``licenses`` block partitions the corpus's
node records by SPDX id and by redistribution *class* (public-domain / attribution
/ share-alike / non-commercial), embeds the SPDX→class registry, and carries the
plain-language "what may be redistributed under which terms (and what a trained
model inherits)" statement per class — see :mod:`culturescrape.schema.license_class`.

It accepts either a whole job output root (``out/<job>/`` — packaging its
``corpus/`` plus the ``corpus-neo4j`` / ``corpus-datalog`` exports and
``catalog.json``) or a bare corpus dataset directory (one holding ``nodes/`` and
``edges/``). The archive is byte-for-byte reproducible: file order is sorted and
every embedded mtime/owner/mode is normalized, so the same corpus always packs to
the same bytes.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import tarfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from culturescrape.schema.license_class import (
    class_registry,
    partition_by_class,
    redistribution_for,
)

#: Top-level members of a job output root to include, in archive order.
_JOB_MEMBERS = ("corpus", "corpus-neo4j", "corpus-datalog", "catalog.json")

#: Header cell of the per-record SPDX licence column on a canonical node TSV.
_LICENSE_COLUMN = "license"

#: Header cell of the acquisition-``source`` column (both node and edge TSVs).
_SOURCE_COLUMN = "source"

#: TSV field delimiter (matches ``schema.tsvio`` — kept local to avoid the import).
_TSV_DELIMITER = "\t"


class PackageError(ValueError):
    """Raised when the source is not a packageable corpus."""


@dataclass(frozen=True)
class FileEntry:
    """One packaged file: its archive-relative path, SHA-256, and size."""

    path: str
    sha256: str
    bytes: int


@dataclass(frozen=True)
class PackageResult:
    """What a :func:`package_corpus` run produced."""

    archive: Path
    manifest: Path
    name: str
    digest: str
    files: tuple[FileEntry, ...]
    licenses: dict[str, Any]

    @property
    def total_bytes(self) -> int:
        """Total uncompressed size of the packaged files."""
        return sum(entry.bytes for entry in self.files)


def package_corpus(
    source: str | Path, out_dir: str | Path, *, name: str | None = None
) -> PackageResult:
    """Package the corpus at *source* into ``<out_dir>/<name>.tar.gz`` + manifest.

    Args:
        source: A job output root (``out/<job>/``) or a corpus dataset directory
            (one holding ``nodes/`` and ``edges/``).
        out_dir: Directory the archive and manifest are written to.
        name: Artifact name (default: the source directory's name).

    Raises:
        PackageError: If *source* is not a directory or holds no corpus.
    """
    source = Path(source)
    out_dir = Path(out_dir)
    if not source.is_dir():
        raise PackageError(f"{source} is not a directory")

    members = _select_members(source)
    _assert_no_personal_tier(source, members)
    files = _collect(source, members)
    if not files:
        raise PackageError(f"{source} holds no files to package")

    entries = tuple(_entry(rel, abs_path) for rel, abs_path in files)
    digest = _digest(entries)
    name = name or source.name
    node_count, edge_count = _counts(source, members)
    nodes_by_label, edges_by_type = _type_counts(source, members)
    licenses = _license_partition(source, members)

    manifest: dict[str, Any] = {
        "name": name,
        "node_count": node_count,
        "edge_count": edge_count,
        "nodes_by_label": nodes_by_label,
        "edges_by_type": edges_by_type,
        "licenses": licenses,
        "digest": digest,
        "files": [
            {"path": entry.path, "sha256": entry.sha256, "bytes": entry.bytes}
            for entry in entries
        ],
    }
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / f"{name}-manifest.json"
    archive_path = out_dir / f"{name}.tar.gz"
    manifest_path.write_bytes(manifest_bytes)
    _write_archive(archive_path, name, files, manifest_bytes)

    return PackageResult(
        archive=archive_path,
        manifest=manifest_path,
        name=name,
        digest=digest,
        files=entries,
        licenses=licenses,
    )


def _assert_no_personal_tier(source: Path, members: Sequence[str]) -> None:
    """Refuse to package a corpus that holds a contained-tier record.

    A packaged artifact is a shareable / open-data release, so the two contained
    tiers must never enter one:

    * **personal** (analyzer-bridge US-003, the media-bridge mapping spec §6) — a fact derived
      from the user's own files, ingested via the Analyzer bridge; local-only;
    * **synthetic** (insimul-bridge US-003, INSIMUL_SYNC_PLAN.md §7 "License
      leakage") — a fact read out of a *generated* Insimul world; proprietary, and
      it describes a world that does not exist.

    Scans the ``source`` column of every ``nodes/*.tsv`` and ``edges/*.tsv`` under
    the corpus once; a value naming a source in either
    :data:`~culturescrape.orchestrate.tiers.PERSONAL_SOURCES` or
    :data:`~culturescrape.orchestrate.tiers.SYNTHETIC_SOURCES` aborts the package.
    A no-op for a corpus with no bridge ingest (the common case).
    """
    # Lazy import keeps the ``orchestrate`` package init order robust (tiers pulls
    # in the qa/manifest/metrics layer).
    from culturescrape.orchestrate.tiers import (
        is_personal_source,
        is_synthetic_source,
    )

    gates: tuple[tuple[str, Callable[[str], bool], str], ...] = (
        (
            "personal",
            is_personal_source,
            "personal-tier facts are local-only and must never enter a "
            "packaged/open-data release (the media-bridge mapping spec §6)",
        ),
        (
            "synthetic",
            is_synthetic_source,
            "synthetic-tier facts are proprietary generated-world content and "
            "must never enter a packaged/open-data release "
            "(INSIMUL_SYNC_PLAN.md §7 'License leakage')",
        ),
    )
    base = source / "corpus" if "corpus" in members else source
    for kind in ("nodes", "edges"):
        directory = base / kind
        if not directory.is_dir():
            continue
        for tsv in sorted(directory.glob("*.tsv")):
            for tier, predicate, remedy in gates:
                offender = _first_contained_source(tsv, predicate)
                if offender is not None:
                    raise PackageError(
                        f"refusing to package {source}: {tsv} holds a {tier}-tier "
                        f"record (source={offender!r}); {remedy}"
                    )


def _first_contained_source(
    tsv: Path, is_contained: Callable[[str], bool]
) -> str | None:
    """Return the first matching ``source`` cell in *tsv*, or ``None`` if none."""
    try:
        with tsv.open("r", encoding="utf-8") as handle:
            header = handle.readline()
            if not header:
                return None
            columns = header.rstrip("\n").split(_TSV_DELIMITER)
            try:
                idx = columns.index(_SOURCE_COLUMN)
            except ValueError:
                return None
            for line in handle:
                cells = line.rstrip("\n").split(_TSV_DELIMITER)
                if idx < len(cells) and is_contained(cells[idx]):
                    return cells[idx].strip()
    except OSError:
        return None
    return None


def _select_members(source: Path) -> tuple[str, ...]:
    """Return the top-level members to package, or raise if none look like a corpus."""
    if (source / "corpus" / "nodes").is_dir():
        return tuple(m for m in _JOB_MEMBERS if (source / m).exists())
    if (source / "nodes").is_dir():
        return tuple(
            sorted(
                child.name
                for child in source.iterdir()
                if not child.name.startswith(".")
            )
        )
    raise PackageError(
        f"{source} is not a corpus: expected a 'corpus/nodes' subdir "
        "(job output root) or a 'nodes' subdir (corpus dataset)"
    )


def _collect(source: Path, members: Sequence[str]) -> list[tuple[str, Path]]:
    """Resolve *members* under *source* to a sorted ``(relpath, abspath)`` list."""
    found: list[tuple[str, Path]] = []
    for member in members:
        path = source / member
        if path.is_dir():
            for file in path.rglob("*"):
                if file.is_file():
                    found.append((file.relative_to(source).as_posix(), file))
        elif path.is_file():
            found.append((member, path))
    found.sort(key=lambda item: item[0])
    return found


def _entry(relpath: str, abs_path: Path) -> FileEntry:
    data = abs_path.read_bytes()
    return FileEntry(
        path=relpath, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data)
    )


def _digest(entries: Sequence[FileEntry]) -> str:
    """A stable SHA-256 over the (sorted) per-file paths and hashes."""
    hasher = hashlib.sha256()
    for entry in entries:
        hasher.update(entry.path.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(entry.sha256.encode("ascii"))
        hasher.update(b"\n")
    return f"sha256:{hasher.hexdigest()}"


def _counts(source: Path, members: Sequence[str]) -> tuple[int | None, int | None]:
    """Read node/edge counts from the corpus ``metrics.json`` if present."""
    base = source / "corpus" if "corpus" in members else source
    metrics_path = base / "metrics.json"
    if not metrics_path.is_file():
        return None, None
    try:
        data = json.loads(metrics_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, None
    node_count = data.get("node_count")
    edge_count = data.get("edge_count")
    return (
        node_count if isinstance(node_count, int) else None,
        edge_count if isinstance(edge_count, int) else None,
    )


def _type_counts(
    source: Path, members: Sequence[str]
) -> tuple[dict[str, int], dict[str, int]]:
    """Read node/edge *type* counts from the corpus ``manifest.json`` if present.

    The corpus manifest (:class:`~culturescrape.orchestrate.manifest.CorpusManifest`)
    records ``nodes_by_label`` / ``edges_by_type`` — the per-type fingerprint a
    published artifact should carry so a downloader sees what each :LABEL / :TYPE
    contributes without unpacking the bundle. Absent or unreadable ⇒ empty maps.
    """
    base = source / "corpus" if "corpus" in members else source
    manifest_path = base / "manifest.json"
    if not manifest_path.is_file():
        return {}, {}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, {}
    return _int_map(data.get("nodes_by_label")), _int_map(data.get("edges_by_type"))


def _int_map(value: Any) -> dict[str, int]:
    """Coerce a manifest field to a ``{str: int}`` map, dropping bad entries."""
    if not isinstance(value, dict):
        return {}
    return {
        key: count
        for key, count in value.items()
        if isinstance(key, str) and isinstance(count, int)
    }


def _license_partition(source: Path, members: Sequence[str]) -> dict[str, Any]:
    """Partition the corpus's node records by SPDX licence + redistribution class.

    Scans the per-record ``license`` column of every ``nodes/*.tsv`` under the
    corpus and rolls it up into (source-breadth US-005):

    - ``records_by_license`` — ``{SPDX: count}`` (blank cells under ``"(unstamped)"``),
    - ``records_by_class`` — ``{class: count}`` (public-domain / attribution /
      share-alike / non-commercial / unstamped / unknown, permissive → restrictive),
    - ``class_registry`` — ``{SPDX: class}`` for every id present (the embedded
      SPDX registry the AC calls for),
    - ``redistribution`` — the plain-language redistribute/model statement per
      present class,
    - ``record_count`` — total licence-bearing rows scanned.

    So a downloader can see, from the manifest alone, what may be redistributed
    under which terms without unpacking the bundle. Deterministic (sorted keys,
    integer counts), so a packaged corpus's licence profile is reproducible.
    """
    raw_counts = _records_by_license(source, members)
    records_by_class = partition_by_class(raw_counts)
    registry = class_registry(raw_counts)
    redistribution = redistribution_for(tuple(records_by_class))
    # A blank licence cell counts internally under "" (so it classifies as
    # ``unstamped``) but is displayed under a readable sentinel in the manifest.
    records_by_license = {
        (spdx or "(unstamped)"): count for spdx, count in raw_counts.items()
    }
    return {
        "record_count": sum(raw_counts.values()),
        "records_by_license": records_by_license,
        "records_by_class": records_by_class,
        "class_registry": registry,
        "redistribution": redistribution,
    }


def _records_by_license(source: Path, members: Sequence[str]) -> dict[str, int]:
    """Count node rows by their ``license`` cell across the corpus node TSVs.

    Reads the ``nodes/`` directory of the corpus (job-root ``corpus/nodes`` or a
    bare ``nodes``); a blank licence (or a file without a ``license`` column) is
    keyed as ``""`` so it classifies as ``unstamped``. Sorted by key so the
    partition is deterministic.
    """
    base = source / "corpus" if "corpus" in members else source
    nodes_dir = base / "nodes"
    counts: dict[str, int] = {}
    if not nodes_dir.is_dir():
        return counts
    for tsv in sorted(nodes_dir.glob("*.tsv")):
        _tally_license_column(tsv, counts)
    return dict(sorted(counts.items()))


def _tally_license_column(tsv: Path, counts: dict[str, int]) -> None:
    """Add *tsv*'s per-row licence values into *counts* (in place)."""
    try:
        with tsv.open("r", encoding="utf-8") as handle:
            header = handle.readline()
            if not header:
                return
            columns = header.rstrip("\n").split(_TSV_DELIMITER)
            try:
                idx = columns.index(_LICENSE_COLUMN)
            except ValueError:
                idx = None
            for line in handle:
                cells = line.rstrip("\n").split(_TSV_DELIMITER)
                if idx is not None and idx < len(cells):
                    value = cells[idx].strip()
                else:
                    value = ""
                counts[value] = counts.get(value, 0) + 1
    except OSError:
        return


def _write_archive(
    archive: Path, name: str, files: Sequence[tuple[str, Path]], manifest: bytes
) -> None:
    """Write a deterministic gzip tar of *files* (and the manifest) under ``name/``."""
    with archive.open("wb") as raw, gzip.GzipFile(
        filename="", mode="wb", fileobj=raw, mtime=0
    ) as gz, tarfile.open(fileobj=gz, mode="w") as tar:
        _add_bytes(tar, f"{name}/manifest.json", manifest)
        for relpath, abs_path in files:
            info = _normalize(tarfile.TarInfo(f"{name}/{relpath}"))
            info.size = abs_path.stat().st_size
            with abs_path.open("rb") as handle:
                tar.addfile(info, handle)


def _add_bytes(tar: tarfile.TarFile, arcname: str, data: bytes) -> None:
    info = _normalize(tarfile.TarInfo(arcname))
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def _normalize(info: tarfile.TarInfo) -> tarfile.TarInfo:
    """Strip non-reproducible metadata (mtime, owner, mode) from a tar member."""
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mode = 0o644
    return info
