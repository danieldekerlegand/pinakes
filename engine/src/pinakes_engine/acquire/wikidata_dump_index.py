"""On-disk class-membership index over a Wikidata JSON dump.

Resolving a large class straight from the dump means scanning every entity —
and, for the transitive ``P31/P279*`` idiom, scanning it *twice* (once to build
the subclass graph, once to select members). That cost is paid afresh on every
run. This module precomputes it **once** into an on-disk KV store so repeated
runs resolve class membership from a lookup instead of a rescan — and, unlike a
whole-index JSON blob, never has to hold the full class→members mapping in
memory.

The store is a single **SQLite** database (stdlib ``sqlite3``) beside the dump.
It records two relations, both harvested in one streaming pass over the dump:

* ``instances`` — ``(class, member)`` rows: *member* declares *class* via
  ``P31`` (the *class → member QIDs* mapping, and — indexed the other way — the
  *member → classes* mapping).
* ``subclasses`` — ``(parent, child)`` rows: *child* declares *parent* via
  ``P279`` (the superclass → direct-subclass edges), from which the transitive
  ``P279*`` closure of any root is walked with cheap indexed lookups.

Together they answer both directions the adapter needs — *QID → classes* and
*class → member QIDs* — for direct and transitive membership alike, with results
**identical** to a full scan because they are derived from the very same
``P31``/``P279`` statements. Lookups are memory-bounded: only the rows a query
actually touches (a class's members, a root's subclass closure) are read, never
the whole index, and ``P31``/``P279*`` selection never needs a second full dump
scan.

The index stamps the **fingerprint** of the dump it was built from (file name,
byte size, and any ``YYYYMMDD`` date in the name) in a ``meta`` table.
:func:`load_index` recomputes that fingerprint for the dump it is handed and
refuses — with a clear message — to serve an index built from a different dump,
so a stale store can never silently answer for the wrong data. Everything here
is local and offline: the builder reads a dump already on disk and writes the
database beside it.

.. note::

   Earlier revisions wrote a JSON sidecar (``<dump>.index.json``) whose whole
   ``instances``/``subclasses`` maps were loaded into memory. That path is gone:
   the store is now SQLite (``<dump>.index.sqlite3``) and must be rebuilt with
   :func:`build_index`. A JSON file handed to :func:`load_index` is rejected as
   not a pinakes-engine index.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.wikidata_dump import (
    INSTANCE_OF,
    SUBCLASS_OF,
    DumpReadStats,
    claim_entity_ids,
    iter_entities,
)

#: Marks the database as a pinakes-engine dump index (stored in ``meta`` and
#: guards against being pointed at an unrelated SQLite file).
INDEX_FORMAT = "pinakes-engine/wikidata-dump-index"
#: On-disk schema version; bumped if the payload layout changes incompatibly.
#: v2 = SQLite KV store (v1 was the retired in-memory JSON sidecar).
INDEX_VERSION = 2

#: Rows buffered before a bulk ``executemany`` flush, so the build streams the
#: dump with bounded memory instead of accumulating every edge first.
_FLUSH_ROWS = 50_000

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

    ``<dump>.index.sqlite3`` next to the dump, so the adapter can pick it up with
    no extra configuration (e.g. ``latest-all.json.gz`` →
    ``latest-all.json.gz.index.sqlite3``).
    """
    return dump_path.with_name(dump_path.name + ".index.sqlite3")


class DumpIndex:
    """A loaded class-membership index, queryable for members and classes.

    Backed by an on-disk SQLite connection; queries touch only the rows they
    need, so memory stays bounded by the *result* size, never the whole index.
    Close it with :meth:`close` (or use it as a context manager) when done.
    """

    def __init__(self, fingerprint: DumpFingerprint, conn: sqlite3.Connection) -> None:
        self.fingerprint = fingerprint
        self._conn = conn

    # -- lifecycle ---------------------------------------------------------

    def close(self) -> None:
        """Close the underlying database connection."""
        self._conn.close()

    def __enter__(self) -> DumpIndex:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- membership queries ------------------------------------------------

    def members_of(self, cls: str) -> list[str]:
        """The QIDs that are direct ``P31`` instances of *cls* (sorted)."""
        rows = self._conn.execute(
            "SELECT member FROM instances WHERE class = ? ORDER BY member",
            (cls,),
        )
        return [row[0] for row in rows]

    def subclasses_of(self, cls: str) -> list[str]:
        """The QIDs that declare *cls* as a direct ``P279`` superclass (sorted)."""
        rows = self._conn.execute(
            "SELECT child FROM subclasses WHERE parent = ? ORDER BY child",
            (cls,),
        )
        return [row[0] for row in rows]

    def class_closure(self, roots: tuple[str, ...], transitive: bool) -> set[str]:
        """The set of classes whose instances count as members of *roots*.

        Direct membership is just *roots*; transitive membership adds every
        ``P279`` descendant, walked over the ``subclasses`` table with indexed
        lookups — the same closure the adapter's fallback computes with an extra
        dump pass, but without rescanning the dump.
        """
        closure = set(roots)
        if not transitive:
            return closure
        stack = list(roots)
        while stack:
            for child in self.subclasses_of(stack.pop()):
                if child not in closure:
                    closure.add(child)
                    stack.append(child)
        return closure

    def member_qids(self, roots: tuple[str, ...], transitive: bool) -> set[str]:
        """The QIDs that are members of any of *roots* (``P31`` / ``P279*``)."""
        members: set[str] = set()
        for cls in self.class_closure(roots, transitive):
            for row in self._conn.execute(
                "SELECT member FROM instances WHERE class = ?", (cls,)
            ):
                members.add(row[0])
        return members

    def classes_of(self, qid: str) -> list[str]:
        """The classes *qid* is a direct ``P31`` instance of (sorted).

        The forward *QID → classes* direction, served straight from the
        ``instances`` table's member index — no whole-index inversion.
        """
        rows = self._conn.execute(
            "SELECT class FROM instances WHERE member = ? ORDER BY class",
            (qid,),
        )
        return [row[0] for row in rows]

    # -- summary counts (for build reporting) ------------------------------

    @property
    def class_count(self) -> int:
        """Number of distinct classes with at least one ``P31`` member."""
        row = self._conn.execute("SELECT COUNT(DISTINCT class) FROM instances")
        return int(row.fetchone()[0])

    @property
    def subclass_parent_count(self) -> int:
        """Number of distinct classes with at least one ``P279`` subclass."""
        row = self._conn.execute("SELECT COUNT(DISTINCT parent) FROM subclasses")
        return int(row.fetchone()[0])


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE instances (class TEXT NOT NULL, member TEXT NOT NULL);
        CREATE TABLE subclasses (parent TEXT NOT NULL, child TEXT NOT NULL);
        """
    )


def _create_indexes(conn: sqlite3.Connection) -> None:
    """Create the lookup indexes *after* the bulk insert (much faster)."""
    conn.executescript(
        """
        CREATE INDEX idx_instances_class ON instances (class);
        CREATE INDEX idx_instances_member ON instances (member);
        CREATE INDEX idx_subclasses_parent ON subclasses (parent);
        """
    )


def _write_meta(conn: sqlite3.Connection, fingerprint: DumpFingerprint) -> None:
    conn.executemany(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        [
            ("format", INDEX_FORMAT),
            ("version", str(INDEX_VERSION)),
            ("dump_name", fingerprint.name),
            ("dump_size", str(fingerprint.size)),
            ("dump_version", fingerprint.version),
        ],
    )


def build_index(
    dump_path: Path | str,
    index_path: Path | str | None = None,
    *,
    stats: DumpReadStats | None = None,
) -> DumpIndex:
    """Build the on-disk class-membership index for a dump in a single pass.

    Streams every entity once, buffering the ``P31`` instance edges and ``P279``
    subclass edges into a SQLite database at *index_path* (default:
    :func:`default_index_path`) in bounded-memory batches, then builds the lookup
    indexes and stamps the dump fingerprint. Returns the open :class:`DumpIndex`
    so a caller can build and query without a reload.

    Any pre-existing index at *index_path* is replaced.

    Args:
        dump_path: Local path to the dump (never fetched).
        index_path: Where to write the index; defaults to the sidecar location.
        stats: Optional :class:`DumpReadStats` to accumulate the read tally into.

    Raises:
        WikidataDumpError: If the dump path is missing or cannot be opened.
    """
    dump = Path(dump_path)
    out = Path(index_path) if index_path is not None else default_index_path(dump)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    conn = sqlite3.connect(out)
    try:
        _create_schema(conn)
        inst_buf: list[tuple[str, str]] = []
        sub_buf: list[tuple[str, str]] = []
        for entity in iter_entities(dump, stats=stats):
            qid = entity["id"]
            for cls in set(claim_entity_ids(entity, INSTANCE_OF)):
                inst_buf.append((cls, qid))
            for parent in set(claim_entity_ids(entity, SUBCLASS_OF)):
                sub_buf.append((parent, qid))
            if len(inst_buf) >= _FLUSH_ROWS:
                conn.executemany(
                    "INSERT INTO instances (class, member) VALUES (?, ?)", inst_buf
                )
                inst_buf.clear()
            if len(sub_buf) >= _FLUSH_ROWS:
                conn.executemany(
                    "INSERT INTO subclasses (parent, child) VALUES (?, ?)", sub_buf
                )
                sub_buf.clear()
        if inst_buf:
            conn.executemany(
                "INSERT INTO instances (class, member) VALUES (?, ?)", inst_buf
            )
        if sub_buf:
            conn.executemany(
                "INSERT INTO subclasses (parent, child) VALUES (?, ?)", sub_buf
            )

        fingerprint = dump_fingerprint(dump)
        _write_meta(conn, fingerprint)
        _create_indexes(conn)
        conn.commit()
    except BaseException:
        conn.close()
        out.unlink(missing_ok=True)
        raise
    return DumpIndex(fingerprint, conn)


def _read_meta(conn: sqlite3.Connection, index_file: Path) -> dict[str, str]:
    """Read the ``meta`` table into a dict, mapping any SQLite error to
    :class:`DumpIndexError` (e.g. the file is not a pinakes-engine index)."""
    try:
        rows = conn.execute("SELECT key, value FROM meta").fetchall()
    except sqlite3.Error as exc:
        raise DumpIndexError(
            f"{index_file} is not a {INDEX_FORMAT} index: {exc}"
        ) from exc
    return {str(key): str(value) for key, value in rows}


def load_index(index_path: Path | str, dump_path: Path | str) -> DumpIndex:
    """Load the index at *index_path*, verifying it matches *dump_path*.

    Raises:
        DumpIndexError: If the file is missing, not a pinakes-engine index of a
            supported version, malformed, or was built from a different dump than
            *dump_path* (the fingerprints disagree).
    """
    index_file = Path(index_path)
    if not index_file.exists():
        raise DumpIndexError(f"index not found: {index_file}")

    try:
        conn = sqlite3.connect(index_file)
    except sqlite3.Error as exc:
        raise DumpIndexError(f"cannot open index {index_file}: {exc}") from exc

    try:
        meta = _read_meta(conn, index_file)
        if meta.get("format") != INDEX_FORMAT:
            raise DumpIndexError(
                f"{index_file} is not a {INDEX_FORMAT} index "
                f"(format={meta.get('format')!r})"
            )
        if meta.get("version") != str(INDEX_VERSION):
            raise DumpIndexError(
                f"index {index_file} is version {meta.get('version')!r}, "
                f"expected {INDEX_VERSION}; rebuild it"
            )

        built_from = DumpFingerprint.from_dict(
            {
                "name": meta.get("dump_name"),
                "size": meta.get("dump_size"),
                "version": meta.get("dump_version"),
            }
        )
        current = dump_fingerprint(Path(dump_path))
        if built_from != current:
            raise DumpIndexError(
                f"index {index_file} was built from a different dump "
                f"(index: {built_from.name} v{built_from.version}, "
                f"{built_from.size} bytes; dump: {current.name} v{current.version}, "
                f"{current.size} bytes); rebuild the index for this dump"
            )
    except BaseException:
        conn.close()
        raise

    return DumpIndex(current, conn)
