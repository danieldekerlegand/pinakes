"""Validate node/edge TSV files before they are imported or exported.

TSV is the source of truth (``docs/data-model.md``), so a malformed file must be
caught *here* rather than corrupting a Neo4j import or a Datalog projection
downstream. This module reads every ``*.tsv`` file in a directory and checks the
invariants the data model guarantees:

* **required headers present** — node files carry ``csid:ID``, ``:LABEL``,
  ``name`` and provenance columns; edge files carry ``:START_ID``, ``:END_ID``,
  ``:TYPE`` and provenance columns;
* **typed columns parse** — every ``:int`` / ``:float`` cell holds a value that
  actually parses as that type (an empty cell is the nullable case and passes);
* **``csid`` unique** — the primary key is non-empty and distinct across *all*
  node files;
* **edges reference existing csids** — every ``:START_ID`` / ``:END_ID`` names a
  ``csid`` that some node file defines;
* **edge ``:TYPE`` is registered** — every edge's ``:TYPE`` is a relationship
  type the formal ontology (``culturescrape.ontology``) defines, so a linker
  cannot emit nor an exporter accept a type the rest of the system does not
  understand;
* **provenance non-empty** — every row names a ``source`` ("no fact without a
  source").

Each problem is reported as a :class:`ValidationError` carrying the file, the
line (``1`` is the header), and the offending column, so failures point straight
at the cell to fix. :func:`validate_directory` returns every error it finds;
:func:`main`'s ``validate`` subcommand exits non-zero when the list is non-empty.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

# Import from the leaf registry module, not the ``ontology`` package, to avoid a
# circular import: the package pulls in the linkers, which depend on the schema.
from culturescrape.ontology.registry import is_registered
from culturescrape.schema.headers import Column, SchemaError
from culturescrape.schema.tsvio import Row, TsvError, column_key, read_rows

#: Header strings every node file must carry (structural keys + provenance).
REQUIRED_NODE_HEADERS = (
    "csid:ID",
    ":LABEL",
    "name",
    "source",
    "source_url",
    "retrieved_at",
    "confidence:float",
)

#: Header strings every edge file must carry (structural keys + provenance).
REQUIRED_EDGE_HEADERS = (
    ":START_ID",
    ":END_ID",
    ":TYPE",
    "source",
    "source_url",
    "retrieved_at",
    "confidence:float",
)

#: The provenance column whose value must be non-empty on every row.
PROVENANCE_KEY = "source"


@dataclass(frozen=True)
class ValidationError:
    """One validation failure, located precisely enough to fix.

    *line* is the 1-based physical line (``1`` is the header) or ``None`` for a
    whole-file problem; *column* is the header the error concerns or ``None``.
    """

    file: Path
    line: int | None
    column: str | None
    message: str

    def __str__(self) -> str:
        location = str(self.file)
        if self.line is not None:
            location += f":{self.line}"
        if self.column is not None:
            location += f":{self.column}"
        return f"{location}: {self.message}"


def validate_directory(directory: str | Path) -> list[ValidationError]:
    """Validate every node and edge TSV file under *directory*.

    Returns every :class:`ValidationError` found, sorted by file then line, so
    the caller sees the full picture in one pass. An empty list means the
    directory is import/export ready.
    """
    directory = Path(directory)
    errors: list[ValidationError] = []
    node_csids: dict[str, tuple[Path, int]] = {}
    edge_files: list[tuple[Path, tuple[Column, ...], list[tuple[int, Row]]]] = []

    for path in sorted(directory.rglob("*.tsv")):
        kind, columns, numbered, read_errors = _load(path)
        if read_errors:
            errors.extend(read_errors)
            continue
        if kind == "node":
            errors.extend(_check_required_headers(path, columns, REQUIRED_NODE_HEADERS))
            errors.extend(_check_typed_columns(path, columns, numbered))
            errors.extend(_check_provenance(path, numbered))
            errors.extend(_collect_csids(path, numbered, node_csids))
        else:  # "edge"
            errors.extend(_check_required_headers(path, columns, REQUIRED_EDGE_HEADERS))
            errors.extend(_check_typed_columns(path, columns, numbered))
            errors.extend(_check_provenance(path, numbered))
            errors.extend(_check_edge_types(path, numbered))
            edge_files.append((path, columns, numbered))

    known = set(node_csids)
    for path, _columns, numbered in edge_files:
        errors.extend(_check_edge_references(path, numbered, known))

    return sorted(errors, key=lambda e: (str(e.file), e.line or 0, e.column or ""))


#: What :func:`_load` returns: kind, header columns, numbered rows, read errors.
_Loaded = tuple[
    "str | None", tuple[Column, ...], list[tuple[int, Row]], list[ValidationError]
]


def _load(path: Path) -> _Loaded:
    """Read *path*, classify it as a node or edge file, and number its rows.

    A read failure (bad escape, ragged row, malformed header) or a header that
    is neither a node nor an edge header yields a single whole-file error and no
    rows, so validation of the *other* files still proceeds.
    """
    try:
        columns, rows = read_rows(path)
    except (TsvError, SchemaError) as exc:
        return None, (), [], [ValidationError(path, None, None, str(exc))]
    kind = _classify(path, columns)
    if kind is None:
        return (
            None,
            (),
            [],
            [
                ValidationError(
                    path, 1, None, "file is neither a node nor an edge TSV"
                )
            ],
        )
    numbered = [(index + 2, row) for index, row in enumerate(rows)]
    return kind, columns, numbered, []


def _classify(path: Path, columns: tuple[Column, ...]) -> str | None:
    """Return ``"node"``, ``"edge"``, or ``None`` for *path*.

    The data model lays files out as ``nodes/<type>.tsv`` and
    ``edges/<type>.tsv``, so the parent directory decides; failing that the
    presence of ``csid:ID`` (node) or ``:START_ID`` (edge) in the header does.
    """
    parent = path.parent.name
    if parent == "nodes":
        return "node"
    if parent == "edges":
        return "edge"
    headers = {c.header for c in columns}
    if "csid:ID" in headers:
        return "node"
    if ":START_ID" in headers:
        return "edge"
    return None


def _check_required_headers(
    path: Path, columns: tuple[Column, ...], required: tuple[str, ...]
) -> list[ValidationError]:
    """Report every *required* header string missing from *columns*."""
    present = {c.header for c in columns}
    return [
        ValidationError(path, 1, header, f"missing required header {header!r}")
        for header in required
        if header not in present
    ]


#: Header type suffix -> the predicate that accepts a parsable cell value.
_PARSERS: dict[str, Callable[[str], bool]] = {
    "int": lambda v: _parses(int, v),
    "float": lambda v: _parses(float, v),
}


def _check_typed_columns(
    path: Path, columns: tuple[Column, ...], numbered: list[tuple[int, Row]]
) -> list[ValidationError]:
    """Report cells whose value does not parse as the column's declared type."""
    typed: list[tuple[str, str, str]] = []
    for column in columns:
        suffix = column.header.rsplit(":", 1)[-1]
        if suffix in _PARSERS:
            typed.append((column_key(column), column.header, suffix))
    errors: list[ValidationError] = []
    for line, row in numbered:
        for key, header, suffix in typed:
            value = _scalar(row, key)
            if value and not _PARSERS[suffix](value):
                errors.append(
                    ValidationError(
                        path, line, header, f"{value!r} is not a valid {suffix}"
                    )
                )
    return errors


def _check_provenance(
    path: Path, numbered: list[tuple[int, Row]]
) -> list[ValidationError]:
    """Report rows with an empty ``source`` (every row needs provenance)."""
    return [
        ValidationError(path, line, PROVENANCE_KEY, "row has empty provenance source")
        for line, row in numbered
        if not _scalar(row, PROVENANCE_KEY)
    ]


def _collect_csids(
    path: Path, numbered: list[tuple[int, Row]], seen: dict[str, tuple[Path, int]]
) -> list[ValidationError]:
    """Record each row's ``csid``, reporting empty or duplicate keys."""
    errors: list[ValidationError] = []
    for line, row in numbered:
        csid = _scalar(row, "csid")
        if not csid:
            errors.append(ValidationError(path, line, "csid:ID", "row has empty csid"))
            continue
        if csid in seen:
            prior_file, prior_line = seen[csid]
            errors.append(
                ValidationError(
                    path,
                    line,
                    "csid:ID",
                    f"duplicate csid {csid!r} (first seen at "
                    f"{prior_file}:{prior_line})",
                )
            )
        else:
            seen[csid] = (path, line)
    return errors


def _check_edge_types(
    path: Path, numbered: list[tuple[int, Row]]
) -> list[ValidationError]:
    """Report edges whose ``:TYPE`` is not a registered relationship type.

    The formal ontology (``culturescrape.ontology``) is the single source of
    truth for the edge vocabulary; an unregistered ``:TYPE`` would corrupt a
    Neo4j import or Datalog projection, so it is rejected here.
    """
    return [
        ValidationError(
            path, line, ":TYPE", f"unregistered relationship type {rel_type!r}"
        )
        for line, row in numbered
        if (rel_type := _scalar(row, ":TYPE")) and not is_registered(rel_type)
    ]


def _check_edge_references(
    path: Path, numbered: list[tuple[int, Row]], known: set[str]
) -> list[ValidationError]:
    """Report edge endpoints that name a ``csid`` no node file defines."""
    errors: list[ValidationError] = []
    for line, row in numbered:
        for key in (":START_ID", ":END_ID"):
            csid = _scalar(row, key)
            if csid and csid not in known:
                errors.append(
                    ValidationError(
                        path, line, key, f"edge references unknown csid {csid!r}"
                    )
                )
    return errors


def _scalar(row: Row, key: str) -> str:
    """The scalar value at *key* (a multi-value list is not a scalar)."""
    value = row.get(key, "")
    return value if isinstance(value, str) else ""


def _parses(cast: Callable[[str], object], value: str) -> bool:
    """Whether *value* survives *cast* (``int`` / ``float``) without error."""
    try:
        cast(value)
    except ValueError:
        return False
    return True
