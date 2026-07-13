"""Typed node/edge headers matching ``docs/data-model.md``.

The data model adopts Neo4j's CSV header conventions (but tab-delimited) so
``neo4j-admin import`` consumes our TSV files directly and APOC export can
reproduce them. A header *cell* is one of:

* a structural column — ``csid:ID``, ``:LABEL`` (nodes) or ``:START_ID``,
  ``:END_ID``, ``:TYPE`` (edges);
* a property column — ``name`` (string) or ``name:int`` / ``name:float``.

:class:`NodeSchema` and :class:`EdgeSchema` model a whole header row as an
ordered tuple of :class:`Column` objects. They validate that the required
structural columns are present and — crucially — that every property column
whose name the data model types carries the *matching* suffix: ``time_start``
must be ``:int``, ``confidence`` must be ``:float``, and so on. A mismatch
(``confidence:int``) is rejected, keeping files import-compatible.

:func:`render_node_header` / :func:`parse_node_header` (and their edge twins)
round-trip a header row to schema objects and back.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

#: Column delimiter for the TSV file family (see ``docs/data-model.md``).
DELIMITER = "\t"


class SchemaError(ValueError):
    """Raised when a header row violates the data model."""


class PropertyType(Enum):
    """A supported Neo4j property type and its header suffix.

    Only the types the data model uses are supported; any other suffix
    (``:bool``, ``:datetime``, ...) is rejected as import-incompatible.
    """

    STRING = "string"
    INT = "int"
    FLOAT = "float"

    @property
    def suffix(self) -> str:
        """The header suffix for this type (``""`` for the default string)."""
        return "" if self is PropertyType.STRING else f":{self.value}"


#: Nameless structural header cells and the family each is valid in.
_STRUCTURAL = frozenset({":LABEL", ":START_ID", ":END_ID", ":TYPE"})


@dataclass(frozen=True)
class IdColumn:
    """The primary-key column, rendered ``<name>:ID`` (e.g. ``csid:ID``)."""

    name: str = "csid"

    @property
    def header(self) -> str:
        return f"{self.name}:ID"


@dataclass(frozen=True)
class StructuralColumn:
    """A nameless structural column: ``:LABEL``, ``:START_ID``, etc."""

    field: str

    def __post_init__(self) -> None:
        if self.field not in _STRUCTURAL:
            raise SchemaError(f"unknown structural column {self.field!r}")

    @property
    def header(self) -> str:
        return self.field


@dataclass(frozen=True)
class PropertyColumn:
    """A typed data column, rendered ``<name>`` or ``<name>:<type>``."""

    name: str
    type: PropertyType = PropertyType.STRING

    def __post_init__(self) -> None:
        if not self.name:
            raise SchemaError("property column must have a name")

    @property
    def header(self) -> str:
        return f"{self.name}{self.type.suffix}"


#: Any single header cell.
Column = IdColumn | StructuralColumn | PropertyColumn


def parse_column(cell: str) -> Column:
    """Parse one header *cell* into a :class:`Column`.

    Raises :class:`SchemaError` for an empty cell, a misplaced name on a
    nameless structural column, or an unsupported type suffix.
    """
    if not cell:
        raise SchemaError("empty header cell")
    if ":" not in cell:
        return PropertyColumn(cell)
    head, tail = cell.rsplit(":", 1)
    if tail == "ID":
        return IdColumn(head)
    if f":{tail}" in _STRUCTURAL:
        if head:
            raise SchemaError(f"structural column :{tail} must not be named")
        return StructuralColumn(f":{tail}")
    try:
        ptype = PropertyType(tail)
    except ValueError:
        raise SchemaError(f"unsupported type suffix {tail!r} in {cell!r}") from None
    return PropertyColumn(head, ptype)


#: Property names the node data model types, with their required type.
#: A property column whose name appears here must carry the matching suffix.
NODE_PROPERTY_TYPES: dict[str, PropertyType] = {
    "time_start": PropertyType.INT,
    "time_end": PropertyType.INT,
    "lat": PropertyType.FLOAT,
    "lon": PropertyType.FLOAT,
    "confidence": PropertyType.FLOAT,
}

#: Property names the edge data model types, with their required type.
EDGE_PROPERTY_TYPES: dict[str, PropertyType] = {
    "weight": PropertyType.FLOAT,
    "confidence": PropertyType.FLOAT,
}


def _check_property_types(
    columns: tuple[Column, ...], typed: dict[str, PropertyType]
) -> None:
    """Reject property columns whose suffix conflicts with the data model."""
    for column in columns:
        if isinstance(column, PropertyColumn):
            expected = typed.get(column.name)
            if expected is not None and column.type is not expected:
                raise SchemaError(
                    f"property {column.name!r} must be {expected.value}, "
                    f"got {column.type.value}"
                )


@dataclass(frozen=True)
class NodeSchema:
    """An ordered node header: an ``:ID``, a ``:LABEL``, and properties.

    Construction validates that the required structural columns are present,
    that no edge-only column leaks in, and that typed properties carry the
    suffix the data model mandates.
    """

    columns: tuple[Column, ...]

    def __post_init__(self) -> None:
        if not any(isinstance(c, IdColumn) for c in self.columns):
            raise SchemaError("node header requires an :ID column")
        labels = [
            c for c in self.columns
            if isinstance(c, StructuralColumn) and c.field == ":LABEL"
        ]
        if not labels:
            raise SchemaError("node header requires a :LABEL column")
        edge_only = {":START_ID", ":END_ID", ":TYPE"}
        if any(
            isinstance(c, StructuralColumn) and c.field in edge_only
            for c in self.columns
        ):
            raise SchemaError("node header must not contain edge columns")
        if not any(
            isinstance(c, PropertyColumn) and c.name == "name"
            for c in self.columns
        ):
            raise SchemaError("node header requires a 'name' column")
        _check_property_types(self.columns, NODE_PROPERTY_TYPES)

    @classmethod
    def canonical(cls) -> NodeSchema:
        """The full data-model node header (``docs/data-model.md``)."""
        return cls(
            (
                IdColumn("csid"),
                StructuralColumn(":LABEL"),
                PropertyColumn("name"),
                PropertyColumn("lang"),
                PropertyColumn("wikidata_qid"),
                PropertyColumn("getty_id"),
                PropertyColumn("aliases"),
                PropertyColumn("description"),
                PropertyColumn("time_start", PropertyType.INT),
                PropertyColumn("time_end", PropertyType.INT),
                PropertyColumn("time_start_iso"),
                PropertyColumn("period"),
                PropertyColumn("lat", PropertyType.FLOAT),
                PropertyColumn("lon", PropertyType.FLOAT),
                PropertyColumn("place_qid"),
                PropertyColumn("tgn_id"),
                PropertyColumn("pleiades_id"),
                PropertyColumn("language_code"),
                PropertyColumn("script"),
                PropertyColumn("etymology"),
                PropertyColumn("derived_from_csid"),
                PropertyColumn("parent_code"),
                PropertyColumn("source"),
                PropertyColumn("source_url"),
                PropertyColumn("source_query"),
                PropertyColumn("retrieved_at"),
                PropertyColumn("confidence", PropertyType.FLOAT),
                PropertyColumn("license"),
            )
        )


@dataclass(frozen=True)
class EdgeSchema:
    """An ordered edge header: ``:START_ID``, ``:END_ID``, ``:TYPE``, props.

    Construction validates the required structural columns, rejects node-only
    columns, and enforces the data model's typed-property suffixes.
    """

    columns: tuple[Column, ...]

    def __post_init__(self) -> None:
        present = {
            c.field for c in self.columns if isinstance(c, StructuralColumn)
        }
        for required in (":START_ID", ":END_ID", ":TYPE"):
            if required not in present:
                raise SchemaError(f"edge header requires a {required} column")
        if any(isinstance(c, IdColumn) for c in self.columns):
            raise SchemaError("edge header must not contain an :ID column")
        if ":LABEL" in present:
            raise SchemaError("edge header must not contain a :LABEL column")
        _check_property_types(self.columns, EDGE_PROPERTY_TYPES)

    @classmethod
    def canonical(cls) -> EdgeSchema:
        """The full data-model edge header (``docs/data-model.md``)."""
        return cls(
            (
                StructuralColumn(":START_ID"),
                StructuralColumn(":END_ID"),
                StructuralColumn(":TYPE"),
                PropertyColumn("weight", PropertyType.FLOAT),
                PropertyColumn("source"),
                PropertyColumn("source_url"),
                PropertyColumn("retrieved_at"),
                PropertyColumn("confidence", PropertyType.FLOAT),
            )
        )


def render_node_header(schema: NodeSchema) -> str:
    """Render a node *schema* to a tab-delimited header row."""
    return DELIMITER.join(c.header for c in schema.columns)


def render_edge_header(schema: EdgeSchema) -> str:
    """Render an edge *schema* to a tab-delimited header row."""
    return DELIMITER.join(c.header for c in schema.columns)


def parse_node_header(row: str) -> NodeSchema:
    """Parse a tab-delimited node header *row* into a :class:`NodeSchema`."""
    return NodeSchema(tuple(parse_column(cell) for cell in row.split(DELIMITER)))


def parse_edge_header(row: str) -> EdgeSchema:
    """Parse a tab-delimited edge header *row* into an :class:`EdgeSchema`."""
    return EdgeSchema(tuple(parse_column(cell) for cell in row.split(DELIMITER)))
