"""The analytical index — the port of `server/services/analytical-index.ts`.

A read-only, in-memory **DuckDB** mirror of `data/source/lexicons/*.tsv`, so
heavy *tabular* work (facet counts, GROUP BY aggregates) runs in one indexed
pass instead of re-parsing files and looping per request. The index is derived:
it never writes back, and it is not on the TSV write path.

DuckDB is kept rather than substituted, and that is the point of the port. The
TypeScript's contract was `read_csv`'s exact TSV dialect plus SQL's exact
ordering; reimplementing both in Python would be a rewrite whose output happens
to agree, and the first hand-rolled disagreement (collation, blank cells,
tie-breaking) would show up as a corpus-shaped bug in a facet list. The two
engines answering the same SQL is what makes this a port.

The read is byte-faithful in the same way `server/tsv-storage.ts` is: tab
delimiter, header row, every column VARCHAR, quoting and escaping **disabled**,
and empty cells preserved as ``""`` via a nullstr sentinel that cannot occur in
real data. So an index cell compares equal to the raw string cell the in-memory
loaders in :mod:`pinakes.analytics.corpus` read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb

#: A `read_csv` nullstr that cannot occur in real data, so empty cells stay `""`.
NULL_SENTINEL = "__PINAKES_NEVER_NULL_SENTINEL__"

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


class UnknownTableError(LookupError):
    """No such table in the index. The route maps this to a 404."""


class UnknownColumnError(LookupError):
    """No such column in that table. The route maps this to a 404."""


@dataclass(frozen=True)
class _Tracked:
    """What the index remembers about one indexed file, for incremental refresh."""

    file: str
    path: Path
    mtime_ns: int
    size: int
    columns: tuple[str, ...]


@dataclass(frozen=True)
class RefreshResult:
    """Which tables an incremental :meth:`AnalyticalIndex.refresh` changed."""

    rebuilt: list[str]
    dropped: list[str]


def table_name_for_file(file_base: str) -> str:
    """``language-ranges.tsv`` → ``language_ranges``.

    Table names are the only SQL identifiers built from filenames, so this is
    the sole place a filename touches SQL: non-alphanumerics collapse to ``_``,
    and a leading digit is prefixed so the result is always a valid identifier.
    """
    stem = re.sub(r"\.tsv$", "", file_base, flags=re.IGNORECASE).lower()
    name = _NON_ALNUM.sub("_", stem).strip("_")
    if not name:
        name = "table"
    if name[0].isdigit():
        name = f"t_{name}"
    return name


def _assert_identifier(name: str, kind: str) -> None:
    if not _IDENTIFIER.fullmatch(name):
        raise ValueError(f"Invalid {kind} identifier: {name!r}")


def _sql_string(value: str) -> str:
    """A SQL string literal, single quotes doubled."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


class AnalyticalIndex:
    """An in-memory DuckDB index over a directory of TSV files.

    Build it with :meth:`create`. In production it is the lazy singleton
    :func:`get_analytical_index`, but it is freely constructable against a
    fixture directory in tests — nothing here is module state.
    """

    def __init__(self, connection: duckdb.DuckDBPyConnection, lexicons: Path) -> None:
        self._connection = connection
        self._lexicons = lexicons
        self._tracked: dict[str, _Tracked] = {}

    @classmethod
    def create(cls, lexicons: Path) -> AnalyticalIndex:
        """Build an index over every `*.tsv` in *lexicons*."""
        index = cls(duckdb.connect(":memory:"), Path(lexicons))
        index.refresh()
        return index

    @property
    def lexicons(self) -> Path:
        """The directory this index mirrors."""
        return self._lexicons

    def refresh(self) -> RefreshResult:
        """Re-sync with the directory on mtime + size.

        New or changed files are rebuilt and tables whose file disappeared are
        dropped, so an edited `*.tsv` re-syncs one table rather than forcing a
        full reload.
        """
        rebuilt: list[str] = []
        dropped: list[str] = []

        files = (
            sorted(
                entry.name
                for entry in self._lexicons.iterdir()
                if entry.name.lower().endswith(".tsv")
            )
            if self._lexicons.is_dir()
            else []
        )
        seen: set[str] = set()

        for file in files:
            table = table_name_for_file(file)
            seen.add(table)
            path = self._lexicons / file
            stat = path.stat()
            prior = self._tracked.get(table)
            if (
                prior is not None
                and prior.mtime_ns == stat.st_mtime_ns
                and prior.size == stat.st_size
            ):
                continue
            columns = self._build_table(table, path)
            self._tracked[table] = _Tracked(
                file=file,
                path=path,
                mtime_ns=stat.st_mtime_ns,
                size=stat.st_size,
                columns=columns,
            )
            rebuilt.append(table)

        for table in list(self._tracked):
            if table in seen:
                continue
            _assert_identifier(table, "table")
            self._connection.execute(f'DROP TABLE IF EXISTS "{table}"')
            del self._tracked[table]
            dropped.append(table)

        return RefreshResult(rebuilt=rebuilt, dropped=dropped)

    def _build_table(self, table: str, path: Path) -> tuple[str, ...]:
        _assert_identifier(table, "table")
        read_csv = (
            f"read_csv({_sql_string(str(path))}, delim='\t', header=true, "
            f"all_varchar=true, quote='', escape='', "
            f"nullstr={_sql_string(NULL_SENTINEL)}, "
            "sample_size=-1, ignore_errors=false)"
        )
        self._connection.execute(
            f'CREATE OR REPLACE TABLE "{table}" AS SELECT * FROM {read_csv}'
        )
        described = self._connection.execute(f'SELECT * FROM "{table}" LIMIT 0')
        return tuple(column[0] for column in described.description or ())

    def tables(self) -> list[str]:
        """Names of all indexed tables, sorted."""
        return sorted(self._tracked)

    def has_table(self, table: str) -> bool:
        return table in self._tracked

    def _require(self, table: str) -> _Tracked:
        tracked = self._tracked.get(table)
        if tracked is None:
            raise UnknownTableError(f"No indexed table: {table}")
        return tracked

    def columns(self, table: str) -> list[str]:
        """Column names of an indexed table, in header order."""
        return list(self._require(table).columns)

    def count(self, table: str) -> int:
        """Row count of a table."""
        self._require(table)
        _assert_identifier(table, "table")
        rows = self._connection.execute(
            f'SELECT CAST(COUNT(*) AS BIGINT) AS n FROM "{table}"'
        ).fetchall()
        return int(rows[0][0]) if rows else 0

    def describe(self) -> list[dict[str, Any]]:
        """Metadata for every indexed table: file, columns, row count."""
        return [
            {
                "table": table,
                "file": self._require(table).file,
                "columns": list(self._require(table).columns),
                "rowCount": self.count(table),
            }
            for table in self.tables()
        ]

    def facet_counts(self, table: str, column: str) -> list[dict[str, Any]]:
        """Distinct values of *column* and how many rows carry each.

        Ordered by count descending then value ascending, which is what makes
        the answer deterministic across two rows with the same count.
        """
        tracked = self._require(table)
        if column not in tracked.columns:
            raise UnknownColumnError(f'No column "{column}" in table {table}')
        _assert_identifier(table, "table")
        rows = self._connection.execute(
            f'SELECT "{column}" AS value, CAST(COUNT(*) AS BIGINT) AS n '
            f'FROM "{table}" GROUP BY "{column}" '
            f'ORDER BY COUNT(*) DESC, "{column}" ASC'
        ).fetchall()
        return [
            {"value": row[0] if row[0] is not None else "", "count": int(row[1])}
            for row in rows
        ]

    def close(self) -> None:
        """Release the connection. Safe to call more than once."""
        self._connection.close()
        self._tracked.clear()


# ── Lazy singleton (production wiring) ───────────────────────────────────────

_index: AnalyticalIndex | None = None


def get_analytical_index(lexicons: Path) -> AnalyticalIndex:
    """The process-wide index over *lexicons*, built on first use.

    Cached, but **keyed on the directory**: `pinakes.paths.lexicons_dir()` reads
    its environment override on every call precisely so a test can point one
    request at a temporary corpus, and an index cached without that check would
    be an index of whatever the first caller happened to ask for.
    """
    global _index
    resolved = Path(lexicons).resolve()
    if _index is not None and _index.lexicons == resolved:
        return _index
    if _index is not None:
        _index.close()
    _index = AnalyticalIndex.create(resolved)
    return _index


def close_analytical_index() -> None:
    """Drop the cached index (shutdown / test teardown)."""
    global _index
    if _index is not None:
        _index.close()
        _index = None
