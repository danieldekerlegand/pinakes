"""Lossless tab-delimited row IO.

TSV is the source of truth (``docs/data-model.md``), so writing a field that
itself contains a tab, newline, or backslash must never corrupt the file. This
module defines a deterministic escape that the writer applies and the reader
reverses *exactly*::

    \\   ->  \\\\
    TAB  ->  \\t
    CR   ->  \\r
    LF   ->  \\n

Multi-value columns (e.g. ``:LABEL``, ``aliases``) join their parts with ``;``;
a literal ``;`` inside a part is escaped as ``\\;``. Decoding is a single
left-to-right scan so an escaped backslash is never mistaken for the start of
another escape (``\\\\t`` decodes to a literal ``\\t``, never to a tab).

The header is always the first physical line and column order is preserved on
write and reported in file order on read, keeping files git-diffable and
:func:`read_rows`/:func:`write_rows` an exact round trip.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from pathlib import Path

from culturescrape.schema.headers import (
    DELIMITER,
    Column,
    EdgeSchema,
    IdColumn,
    NodeSchema,
    StructuralColumn,
    parse_column,
)

#: Delimiter that separates parts of a multi-value field.
MULTI_DELIMITER = ";"

#: The single escape character.
ESCAPE = "\\"

#: Column keys whose cell holds a ``;``-separated list rather than a scalar.
MULTI_VALUE_KEYS = frozenset({":LABEL", "aliases"})

#: Characters that must be escaped in any field value.
_ENCODE: dict[str, str] = {
    "\\": "\\\\",
    "\t": "\\t",
    "\r": "\\r",
    "\n": "\\n",
}

#: As :data:`_ENCODE`, plus the multi-value delimiter (escaped inside parts).
_ENCODE_MULTI: dict[str, str] = {**_ENCODE, MULTI_DELIMITER: "\\;"}

#: The escaped character (the char after ``\\``) mapped back to its literal.
_DECODE: dict[str, str] = {
    "\\": "\\",
    "t": "\t",
    "r": "\r",
    "n": "\n",
    ";": ";",
}

#: A decoded row: scalar columns map to ``str``, multi-value columns to a list.
Row = dict[str, str | list[str]]


class TsvError(ValueError):
    """Raised when a value or line cannot be encoded or decoded losslessly."""


def encode_value(value: str) -> str:
    """Escape *value* so it survives a single tab-delimited cell."""
    return "".join(_ENCODE.get(ch, ch) for ch in value)


def encode_values(values: Sequence[str]) -> str:
    """Encode *values* into one ``;``-separated cell (literal ``;`` escaped)."""
    return MULTI_DELIMITER.join(
        "".join(_ENCODE_MULTI.get(ch, ch) for ch in value) for value in values
    )


def _unescape(text: str) -> str:
    """Reverse :func:`encode_value` via a single left-to-right scan."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == ESCAPE:
            if i + 1 >= n:
                raise TsvError(f"dangling escape at end of {text!r}")
            nxt = text[i + 1]
            literal = _DECODE.get(nxt)
            if literal is None:
                raise TsvError(f"invalid escape '\\{nxt}' in {text!r}")
            out.append(literal)
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def decode_value(cell: str) -> str:
    """Reverse :func:`encode_value`, recovering the original scalar string."""
    return _unescape(cell)


def decode_values(cell: str) -> list[str]:
    """Reverse :func:`encode_values`, splitting on *unescaped* ``;`` only.

    An empty *cell* decodes to an empty list (the canonical form of "no
    values"), so an empty list and ``[""]`` both serialize to ``""``.
    """
    if cell == "":
        return []
    parts: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(cell)
    while i < n:
        ch = cell[i]
        if ch == ESCAPE and i + 1 < n:
            # Keep the escape pair intact; _unescape resolves it per part.
            buf.append(ch)
            buf.append(cell[i + 1])
            i += 2
        elif ch == MULTI_DELIMITER:
            parts.append("".join(buf))
            buf = []
            i += 1
        else:
            buf.append(ch)
            i += 1
    parts.append("".join(buf))
    return [_unescape(part) for part in parts]


def column_key(column: Column) -> str:
    """The dict key a row uses for *column* (its name or structural field)."""
    if isinstance(column, IdColumn):
        return column.name
    if isinstance(column, StructuralColumn):
        return column.field
    return column.name  # PropertyColumn


def _encode_cell(key: str, value: str | Sequence[str]) -> str:
    """Encode one row *value* for *key*, honouring multi-value columns."""
    if key in MULTI_VALUE_KEYS:
        if isinstance(value, str):
            raise TsvError(
                f"multi-value column {key!r} expects a sequence, got a string"
            )
        return encode_values(value)
    if not isinstance(value, str):
        raise TsvError(f"scalar column {key!r} expects a string, got {type(value)}")
    return encode_value(value)


def write_rows(
    path: str | Path,
    columns: Sequence[Column],
    rows: Iterable[Mapping[str, str | Sequence[str]]],
) -> int:
    """Write *rows* to *path* under *columns*, returning the number written.

    The header (``columns`` rendered in order) is always the first line. Each
    row is a mapping from :func:`column_key` to its value; a missing key writes
    an empty cell. The parent directory is created if missing.
    """
    columns = tuple(columns)
    keys = [column_key(c) for c in columns]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(DELIMITER.join(c.header for c in columns))
        handle.write("\n")
        for row in rows:
            cells = [
                _encode_cell(key, row[key]) if key in row else ""
                for key in keys
            ]
            handle.write(DELIMITER.join(cells))
            handle.write("\n")
            count += 1
    return count


def _sort_key(
    row: Mapping[str, str | Sequence[str]], keys: Sequence[str]
) -> tuple[str, ...]:
    """The ordering tuple for *row* over the scalar *keys* (missing -> ``""``).

    Sort columns are always structural scalars (``csid``, ``:START_ID``, ...),
    so a list value signals a caller error rather than a sortable key.
    """
    out: list[str] = []
    for key in keys:
        value = row.get(key, "")
        if not isinstance(value, str):
            raise TsvError(f"sort column {key!r} must be a scalar string")
        out.append(value)
    return tuple(out)


def write_node_rows(
    path: str | Path,
    schema: NodeSchema,
    rows: Iterable[Mapping[str, str | Sequence[str]]],
) -> int:
    """Write node *rows* sorted by ``csid`` in *schema*'s canonical column order.

    Sorting makes the file a deterministic function of the logical row set:
    writing the same rows in any input order yields byte-identical output, so
    TSV diffs are meaningful and Neo4j round-trips are stable.
    """
    id_key = next(
        column_key(c) for c in schema.columns if isinstance(c, IdColumn)
    )
    ordered = sorted(rows, key=lambda row: _sort_key(row, (id_key,)))
    return write_rows(path, schema.columns, ordered)


def write_edge_rows(
    path: str | Path,
    schema: EdgeSchema,
    rows: Iterable[Mapping[str, str | Sequence[str]]],
) -> int:
    """Write edge *rows* sorted by ``(:START_ID, :END_ID, :TYPE)``.

    As with :func:`write_node_rows`, the canonical column order and total sort
    order make the output a byte-stable function of the logical edge set.
    """
    sort_keys = (":START_ID", ":END_ID", ":TYPE")
    ordered = sorted(rows, key=lambda row: _sort_key(row, sort_keys))
    return write_rows(path, schema.columns, ordered)


def _strip_eol(line: str) -> str:
    """Drop the single trailing ``\\n`` a physical line carries, if any.

    Matches ``text.split("\\n")`` semantics exactly: the writer escapes any
    ``\\n`` inside a value, so a physical newline is only ever a row terminator.
    Files are read in universal-newline mode, so ``\\r\\n`` is already ``\\n``.
    """
    return line[:-1] if line.endswith("\n") else line


def open_rows(path: str | Path) -> tuple[tuple[Column, ...], Iterator[Row]]:
    """Stream *path* written by :func:`write_rows`: header now, rows lazily.

    The header line is read eagerly (so *columns* — and any malformed-header
    error — are available immediately), then a generator yields one decoded
    :data:`Row` per physical line without ever materialising the whole file.
    The generator keeps the file open until it is exhausted (or closed), so the
    projection layer (:mod:`culturescrape.datalog`) can process a dump-scale file
    a row at a time. :func:`read_rows` is the eager ``list(...)`` wrapper.

    Physical newlines separate rows and physical tabs separate columns; because
    the writer escapes both inside values, this split is unambiguous. Each cell
    is decoded with :func:`decode_value`, or :func:`decode_values` for a
    multi-value column.
    """
    path = Path(path)
    handle = path.open(encoding="utf-8")
    try:
        header = handle.readline()
        if header == "":
            raise TsvError(f"{path} has no header line")
        columns = tuple(
            parse_column(cell) for cell in _strip_eol(header).split(DELIMITER)
        )
    except BaseException:
        handle.close()
        raise
    keys = [column_key(c) for c in columns]

    def _rows() -> Iterator[Row]:
        lineno = 1
        try:
            for raw in handle:
                lineno += 1
                cells = _strip_eol(raw).split(DELIMITER)
                if len(cells) != len(keys):
                    raise TsvError(
                        f"{path}:{lineno} has {len(cells)} cells, "
                        f"expected {len(keys)}"
                    )
                row: Row = {}
                for key, cell in zip(keys, cells, strict=True):
                    if key in MULTI_VALUE_KEYS:
                        row[key] = decode_values(cell)
                    else:
                        row[key] = decode_value(cell)
                yield row
        finally:
            handle.close()

    return columns, _rows()


def read_rows(path: str | Path) -> tuple[tuple[Column, ...], list[Row]]:
    """Read *path* written by :func:`write_rows` back to columns and rows.

    The eager wrapper over :func:`open_rows`: it drains the streaming row
    iterator into a list, so a caller that wants the whole file at once (and the
    same fail-fast on a wrong cell count) keeps the original behaviour.
    """
    columns, rows = open_rows(path)
    return columns, list(rows)
