"""On-disk class-membership index over a Wikidata JSON dump.

Resolving a large class straight from the dump means scanning every entity —
and, for the transitive ``P31/P279*`` idiom, scanning it *twice* (once to build
the subclass graph, once to select members). That cost is paid afresh on every
run. This module precomputes it **once** into a small JSON sidecar so repeated
runs resolve class membership from a lookup instead of a rescan.

The index records two relations, both harvested in a single pass over the dump:

* ``instances`` — class QID → the QIDs that declare it via ``P31`` (the inverse
  *class → member QIDs* mapping).
* ``subclasses`` — class QID → the QIDs that declare it via ``P279`` (the
  superclass → direct-subclass edges), from which the transitive ``P279*``
  closure of any root is walked in memory.

Together they answer both directions the adapter needs — *QID → classes* and
*class → member QIDs* — for direct and transitive membership alike, with results
**identical** to a full scan because they are derived from the very same
``P31``/``P279`` statements.

The index stamps the **fingerprint** of the dump it was built from (file name,
byte size, and any ``YYYYMMDD`` date in the name). :func:`load_index` recomputes
that fingerprint for the dump it is handed and refuses — with a clear message —
to serve an index built from a different dump, so a stale sidecar can never
silently answer for the wrong data. Everything here is local and offline: the
builder reads a dump already on disk and writes a file beside it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from culturescrape.acquire.wikidata_dump import (
    INSTANCE_OF,
    SUBCLASS_OF,
    DumpReadStats,
    claim_entity_ids,
    iter_entities,
)

#: Marks the JSON payload as a culture-scrape dump index (guards against being
#: pointed at an unrelated JSON file).
INDEX_FORMAT = "culture-scrape/wikidata-dump-index"
#: On-disk schema version; bumped if the payload layout changes incompatibly.
INDEX_VERSION = 1

#: A ``YYYYMMDD`` run-date as it appears in an official dump's file name
#: (e.g. ``wikidata-20240101-all.json.gz``).
_DATE_RE = re.compile(r"(\d{8})")


class DumpIndexError(RuntimeError):
    """Raised when an index file is missing, malformed, or built from a
    different dump than the one it is being used against."""


@dataclass(frozen=True)
class DumpFingerprint:
    """Identity of the dump an index was built from.

    Attributes:
        name: The dump's file name (carries the run date for official dumps).
        size: The dump's size in bytes — a cheap, reliable change signal.
        version: The ``YYYYMMDD`` date parsed from *name*, or ``"unknown"`` when
            the name carries none. Informational; equality is decided by all
            three fields together.
    """

    name: str
    size: int
    version: str

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "size": self.size, "version": self.version}

    @classmethod
    def from_dict(cls, data: Any) -> DumpFingerprint:
        if not isinstance(data, dict):
            raise DumpIndexError("index 'dump' fingerprint is not an object")
        try:
            return cls(
                name=str(data["name"]),
                size=int(data["size"]),
                version=str(data["version"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise DumpIndexError(
                f"index 'dump' fingerprint is malformed: {exc}"
            ) from exc


def dump_version(path: Path) -> str:
    """Return the ``YYYYMMDD`` date in *path*'s name, or ``"unknown"``."""
    match = _DATE_RE.search(path.name)
    return match.group(1) if match else "unknown"


def dump_fingerprint(path: Path) -> DumpFingerprint:
    """Fingerprint the dump at *path* (name, byte size, parsed date).

    Raises:
        DumpIndexError: If *path* does not exist (its size cannot be read).
    """
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise DumpIndexError(f"cannot stat Wikidata dump {path}: {exc}") from exc
    return DumpFingerprint(name=path.name, size=size, version=dump_version(path))


def default_index_path(dump_path: Path) -> Path:
    """The conventional sidecar location for *dump_path*'s index.

    ``<dump>.index.json`` next to the dump, so the adapter can pick it up with no
    extra configuration (e.g. ``latest-all.json.gz`` →
    ``latest-all.json.gz.index.json``).
    """
    return dump_path.with_name(dump_path.name + ".index.json")


@dataclass
class DumpIndex:
    """A loaded class-membership index, queryable for members and classes.

    Attributes:
        fingerprint: The dump this index was built from.
        instances: class QID → sorted direct ``P31`` member QIDs.
        subclasses: class QID → sorted direct ``P279`` subclass QIDs.
    """

    fingerprint: DumpFingerprint
    instances: dict[str, list[str]]
    subclasses: dict[str, list[str]]
    #: Lazily-built inverse of ``instances`` (QID → its classes), for
    #: :meth:`classes_of`; cached on first use.
    _reverse: dict[str, set[str]] | None = None

    def class_closure(self, roots: tuple[str, ...], transitive: bool) -> set[str]:
        """The set of classes whose instances count as members of *roots*.

        Direct membership is just *roots*; transitive membership adds every
        ``P279`` descendant, walked in memory over :attr:`subclasses` — the same
        closure the adapter's fallback computes with an extra dump pass.
        """
        closure = set(roots)
        if not transitive:
            return closure
        stack = list(roots)
        while stack:
            for child in self.subclasses.get(stack.pop(), ()):
                if child not in closure:
                    closure.add(child)
                    stack.append(child)
        return closure

    def member_qids(self, roots: tuple[str, ...], transitive: bool) -> set[str]:
        """The QIDs that are members of any of *roots* (``P31`` / ``P279*``)."""
        members: set[str] = set()
        for cls in self.class_closure(roots, transitive):
            members.update(self.instances.get(cls, ()))
        return members

    def classes_of(self, qid: str) -> list[str]:
        """The classes *qid* is a direct ``P31`` instance of (sorted).

        The forward *QID → classes* direction, served by inverting
        :attr:`instances` once and caching the result.
        """
        if self._reverse is None:
            reverse: dict[str, set[str]] = {}
            for cls, members in self.instances.items():
                for member in members:
                    reverse.setdefault(member, set()).add(cls)
            self._reverse = reverse
        return sorted(self._reverse.get(qid, ()))


def build_index(
    dump_path: Path | str,
    index_path: Path | str | None = None,
    *,
    stats: DumpReadStats | None = None,
) -> DumpIndex:
    """Build the on-disk class-membership index for a dump in a single pass.

    Streams every entity once, accumulating the ``P31`` instance edges and
    ``P279`` subclass edges, then writes the index as JSON to *index_path*
    (default: :func:`default_index_path`). Returns the in-memory
    :class:`DumpIndex` so a caller can build and query without a reload.

    Args:
        dump_path: Local path to the dump (never fetched).
        index_path: Where to write the index; defaults to the sidecar location.
        stats: Optional :class:`DumpReadStats` to accumulate the read tally into.

    Raises:
        WikidataDumpError: If the dump path is missing or cannot be opened.
    """
    dump = Path(dump_path)
    out = Path(index_path) if index_path is not None else default_index_path(dump)

    instances: dict[str, set[str]] = {}
    subclasses: dict[str, set[str]] = {}
    for entity in iter_entities(dump, stats=stats):
        qid = entity["id"]
        for cls in claim_entity_ids(entity, INSTANCE_OF):
            instances.setdefault(cls, set()).add(qid)
        for parent in claim_entity_ids(entity, SUBCLASS_OF):
            subclasses.setdefault(parent, set()).add(qid)

    fingerprint = dump_fingerprint(dump)
    sorted_instances = {cls: sorted(qids) for cls, qids in sorted(instances.items())}
    sorted_subclasses = {cls: sorted(qids) for cls, qids in sorted(subclasses.items())}
    payload = {
        "format": INDEX_FORMAT,
        "version": INDEX_VERSION,
        "dump": fingerprint.as_dict(),
        "instances": sorted_instances,
        "subclasses": sorted_subclasses,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return DumpIndex(
        fingerprint=fingerprint,
        instances=sorted_instances,
        subclasses=sorted_subclasses,
    )


def load_index(index_path: Path | str, dump_path: Path | str) -> DumpIndex:
    """Load the index at *index_path*, verifying it matches *dump_path*.

    Raises:
        DumpIndexError: If the file is missing, not a culture-scrape index of a
            supported version, malformed, or was built from a different dump than
            *dump_path* (the fingerprints disagree).
    """
    index_file = Path(index_path)
    if not index_file.exists():
        raise DumpIndexError(f"index not found: {index_file}")
    try:
        payload = json.loads(index_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DumpIndexError(f"cannot read index {index_file}: {exc}") from exc
    if not isinstance(payload, dict):
        raise DumpIndexError(f"index {index_file} is not an object")
    if payload.get("format") != INDEX_FORMAT:
        raise DumpIndexError(
            f"{index_file} is not a {INDEX_FORMAT} index "
            f"(format={payload.get('format')!r})"
        )
    if payload.get("version") != INDEX_VERSION:
        raise DumpIndexError(
            f"index {index_file} is version {payload.get('version')!r}, "
            f"expected {INDEX_VERSION}; rebuild it"
        )

    built_from = DumpFingerprint.from_dict(payload.get("dump"))
    current = dump_fingerprint(Path(dump_path))
    if built_from != current:
        raise DumpIndexError(
            f"index {index_file} was built from a different dump "
            f"(index: {built_from.name} v{built_from.version}, "
            f"{built_from.size} bytes; dump: {current.name} v{current.version}, "
            f"{current.size} bytes); rebuild the index for this dump"
        )

    return DumpIndex(
        fingerprint=current,
        instances=_str_lists(payload.get("instances"), index_file, "instances"),
        subclasses=_str_lists(payload.get("subclasses"), index_file, "subclasses"),
    )


def _str_lists(value: Any, index_file: Path, field: str) -> dict[str, list[str]]:
    """Validate a ``{str: [str, ...]}`` mapping from the index payload."""
    if not isinstance(value, dict):
        raise DumpIndexError(f"index {index_file} '{field}' is not an object")
    result: dict[str, list[str]] = {}
    for key, members in value.items():
        if not isinstance(key, str) or not isinstance(members, list):
            raise DumpIndexError(f"index {index_file} '{field}' has a malformed entry")
        result[key] = [m for m in members if isinstance(m, str)]
    return result
