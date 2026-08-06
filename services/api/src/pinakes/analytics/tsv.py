"""Reading the lexicon corpus the way `server/tsv-storage.ts` reads it.

The TypeScript loaders these engines were ported off share two helpers —
``parseTsv`` (a plain `split("\\t")`, blank lines dropped) and ``getIdx`` (a
required column, or throw) — plus a per-loader vocabulary of "this cell may be
absent" reads that is reproduced here rather than tidied, because every one of
them is observable through the API:

* ``header.indexOf(name)`` returning ``-1`` is how an **optional** column is
  read; ``getIdx`` throwing is how a **required** one is. A corpus that has lost
  its `id` column is broken, not empty.
* ``row[idx] || fallback`` means a blank cell falls back, and JavaScript hands
  back ``undefined`` for a short row — so a row with fewer cells than the header
  reads as blank rather than raising.
* A JSON-array cell that fails to parse is an **empty list**, never an error.
  Half the corpus's array columns are hand-authored.
* ``parseInt(cell, 10)`` stops at the first non-digit, and the literal string
  ``"null"`` is a deliberate sentinel the loaders test for by name.

:mod:`pinakes.collab.citable` carries private copies of the first two. They stay
separate on purpose: that module resolves *one row by id* out of four files and
is documented as not being the corpus storage layer, while everything here reads
whole tables. The general reader is still `tasks/chief/63-port-entity-search.json`'s
job, and neither module is a head start on it.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

_LINES = re.compile(r"\r?\n")

#: The leading-integer prefix `parseInt(x, 10)` consumes.
_LEADING_INT = re.compile(r"\s*[+-]?\d+")

#: A `Number(x)`-parseable numeric literal, which — unlike `parseInt` — must
#: match the *whole* (trimmed) string.
_FULL_NUMBER = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")

#: The decimal prefix `parseFloat(x)` consumes, `Infinity` included.
_LEADING_FLOAT = re.compile(
    r"\s*[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)"
)


class MissingColumnError(RuntimeError):
    """A lexicon file is missing a column the loader requires (``getIdx`` threw)."""


def parse_tsv(text: str) -> tuple[list[str], list[list[str]]]:
    """Split a TSV into ``(header, rows)``. Blank lines are dropped."""
    lines = [line for line in _LINES.split(text) if line.strip() != ""]
    if not lines:
        return [""], []
    return lines[0].split("\t"), [line.split("\t") for line in lines[1:]]


def read_tsv(lexicons: Path, filename: str) -> tuple[list[str], list[list[str]]] | None:
    """``readFileIfExists`` + ``parseTsv``: ``None`` when the file is not there.

    An absent file is an empty domain, never an error — that is the contract the
    TypeScript loaders were built on, and it is why a mistyped path there failed
    quietly (`server/CLAUDE.md`). Assert on counts, not on a 200.
    """
    path = Path(lexicons) / filename
    if not path.is_file():
        return None
    return parse_tsv(path.read_text(encoding="utf-8"))


def index_of(header: list[str], name: str) -> int:
    """``header.indexOf(name)`` — ``-1`` for a column that may be absent."""
    return header.index(name) if name in header else -1


def required_index(header: list[str], name: str) -> int:
    """``getIdx(header, name)`` — the column's position, or raise."""
    position = index_of(header, name)
    if position < 0:
        raise MissingColumnError(f"Missing column '{name}' in TSV header")
    return position


def cell(row: list[str], index: int) -> str:
    """One cell. A negative index or short row is blank, as ``undefined`` was."""
    return row[index] if 0 <= index < len(row) else ""


def text_cell(row: list[str], index: int, fallback: str = "") -> str:
    """``idx >= 0 ? row[idx] || fallback : fallback`` — a blank cell falls back."""
    return cell(row, index) or fallback


def optional_text(row: list[str], index: int) -> str | None:
    """``idx >= 0 ? (row[idx] || null) : null`` — a blank cell is *absent*."""
    return cell(row, index) or None


def json_array(row: list[str], index: int) -> list[str]:
    """A JSON-array cell. Blank, absent or unparseable is an empty list."""
    raw = cell(row, index)
    if index < 0 or not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def json_cell(row: list[str], index: int, fallback: Any) -> Any:
    """A JSON cell of any shape, falling back on absent/blank/unparseable."""
    raw = cell(row, index)
    if index < 0 or not raw:
        return fallback
    try:
        return json.loads(raw)
    except ValueError:
        return fallback


def js_parse_int(raw: str) -> float:
    """``parseInt(raw, 10)``: the leading integer, else ``NaN``."""
    match = _LEADING_INT.match(raw)
    return float(match.group(0)) if match else math.nan


def js_parse_float(raw: str) -> float:
    """``parseFloat(raw)``: the longest numeric *prefix*, else ``NaN``.

    Not the same rule as :func:`js_number`, which is ``Number()`` and must match
    the whole string: ``parseFloat("0.4abc")`` is ``0.4`` where ``Number`` of it
    is ``NaN``. Both reach a query-string parameter somewhere in this package.
    """
    match = _LEADING_FLOAT.match(raw)
    if match is None:
        return math.nan
    return float(match.group(0))


def nullable_int(row: list[str], index: int) -> int | None:
    """The ``idx >= 0 && cell && cell !== "null" ? parseInt(cell) : null`` read.

    The literal ``"null"`` is a real sentinel in the corpus — several columns
    were written by a serializer that stringified it — and every loader tests
    for it by name.
    """
    raw = cell(row, index)
    if index < 0 or not raw or raw == "null":
        return None
    parsed = js_parse_int(raw)
    return None if math.isnan(parsed) else int(parsed)


def truthy_int(row: list[str], index: int) -> int | None:
    """``cell ? parseInt(cell) || null : null`` — and **a zero reads as absent**.

    Not :func:`nullable_int`, which keeps a ``0``: the ``|| null`` here runs on
    the *parsed* number, so a cell of ``"0"`` and a cell of ``"nope"`` both come
    back as ``None``. Both media-asset readers spell their `width`/`height` this
    way, which is why a zero-pixel dimension has always meant "unrecorded".
    """
    raw = cell(row, index)
    if index < 0 or not raw:
        return None
    parsed = js_parse_int(raw)
    if math.isnan(parsed) or parsed == 0:
        return None
    return int(parsed)


def int_or_zero(row: list[str], index: int) -> int:
    """``parseInt(cell, 10) || 0`` — an unparseable or zero cell is ``0``."""
    parsed = js_parse_int(cell(row, index))
    return 0 if math.isnan(parsed) else int(parsed)


def js_number(raw: str) -> float:
    """``Number(raw)``: the whole trimmed string, or ``NaN``. Empty is ``0``.

    Decimal literals only. `Number` also reads ``0x10``, ``0b1``, ``0o7`` and
    ``Infinity``; none of those is a lexicon cell, and every caller here feeds
    the result through a finiteness or truthiness guard that treats the two
    readings the same way.
    """
    trimmed = raw.strip()
    if not trimmed:
        return 0.0
    if not _FULL_NUMBER.fullmatch(trimmed):
        return math.nan
    return float(trimmed)


def number_or_none(row: list[str], index: int) -> float | None:
    """``idx >= 0 ? (Number(cell) || null) : null`` — ``0`` reads as absent too.

    That last part is the TypeScript's, not a slip: ``Number("0") || null`` is
    ``null``, so a zero speaker count has always meant "unknown" here.
    """
    if index < 0:
        return None
    value = js_number(cell(row, index))
    if math.isnan(value) or value == 0:
        return None
    return value
