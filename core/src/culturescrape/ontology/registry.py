"""The relationship-type vocabulary, defined formally as data.

``docs/data-model.md`` names the edge ``:TYPE`` vocabulary prose; this module is
the single source of truth the prose points to ("defined formally in
``src/culturescrape/ontology/``"). Linkers that *emit* edges and exporters /
validators that *consume* them both read the same :data:`REGISTRY`, so a type
cannot be produced that the rest of the system does not understand.

Each :class:`RelationType` records the facts a linker or a Datalog rule needs:

* **dimension** — which cross-dimensional axis it belongs to (``docs/data-model.md``
  groups the vocabulary geographic / temporal / linguistic / genetic / structural);
* **domain / range** — the node kinds the edge runs *from* and *to*, as the
  ``:LABEL`` token a node carries (``"entity"`` is the unconstrained wildcard);
* **symmetric** — the edge reads the same in both directions (``A REL B`` ⇒
  ``B REL A``), e.g. ``ADJACENT_TO``;
* **transitive** — the edge chains (``A REL B`` ∧ ``B REL C`` ⇒ ``A REL C``),
  e.g. ``DESCENDS_FROM``; the rules layer (Tasklist 5) materialises the closure.

:func:`lookup` / :func:`get` / :func:`is_registered` are the read API;
:func:`validate_type` is the validator that rejects an edge whose ``:TYPE`` is
not registered.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Dimension(Enum):
    """The cross-dimensional axis a relationship type belongs to."""

    GEOGRAPHIC = "geographic"
    TEMPORAL = "temporal"
    LINGUISTIC = "linguistic"
    GENETIC = "genetic"
    STRUCTURAL = "structural"


class UnknownRelationTypeError(ValueError):
    """Raised when a ``:TYPE`` is not in the registered vocabulary."""


@dataclass(frozen=True)
class RelationType:
    """One registered edge ``:TYPE`` and the algebra a linker needs.

    *name* is the wire token written to a ``:TYPE`` cell (e.g. ``LOCATED_IN``);
    *domain* / *range* are the ``:LABEL`` tokens the edge runs between
    (``"entity"`` = any node). *symmetric* and *transitive* are the algebraic
    flags the inference and export layers act on.
    """

    name: str
    dimension: Dimension
    domain: str
    range: str
    symmetric: bool = False
    transitive: bool = False
    description: str = ""


#: Every relationship type the data model defines, in document order.
_RELATION_TYPES: tuple[RelationType, ...] = (
    # Geographic
    RelationType(
        "LOCATED_IN",
        Dimension.GEOGRAPHIC,
        "entity",
        "place",
        transitive=True,
        description="entity sits within a place (containment chains)",
    ),
    RelationType(
        "ORIGINATES_FROM",
        Dimension.GEOGRAPHIC,
        "entity",
        "place",
        description="entity's place or culture of origin",
    ),
    RelationType(
        "SPOKEN_IN",
        Dimension.GEOGRAPHIC,
        "language",
        "place",
        description="language is spoken in a place",
    ),
    RelationType(
        "ADJACENT_TO",
        Dimension.GEOGRAPHIC,
        "place",
        "place",
        symmetric=True,
        description="two places share a border",
    ),
    # Temporal
    RelationType(
        "CONTEMPORARY_WITH",
        Dimension.TEMPORAL,
        "entity",
        "entity",
        symmetric=True,
        description="entities with overlapping time spans (overlap is not transitive)",
    ),
    RelationType(
        "PRECEDES",
        Dimension.TEMPORAL,
        "entity",
        "entity",
        transitive=True,
        description="entity comes before another in time",
    ),
    RelationType(
        "FOLLOWS",
        Dimension.TEMPORAL,
        "entity",
        "entity",
        transitive=True,
        description="entity comes after another in time (inverse of PRECEDES)",
    ),
    RelationType(
        "PART_OF_PERIOD",
        Dimension.TEMPORAL,
        "entity",
        "period",
        description="entity belongs to a named period",
    ),
    # Linguistic
    RelationType(
        "DESCENDS_FROM",
        Dimension.LINGUISTIC,
        "language",
        "language",
        transitive=True,
        description="language descends from an ancestor language",
    ),
    RelationType(
        "BORROWED_FROM",
        Dimension.LINGUISTIC,
        "term",
        "term",
        description="term is borrowed from a source language or term",
    ),
    RelationType(
        "COGNATE_WITH",
        Dimension.LINGUISTIC,
        "term",
        "term",
        symmetric=True,
        transitive=True,
        description="terms share a common ancestor (an equivalence relation)",
    ),
    RelationType(
        "NAMED_IN",
        Dimension.LINGUISTIC,
        "entity",
        "language",
        description="entity's name is attested in a language",
    ),
    # Genetic / derivation (cultural lineage, not biological)
    RelationType(
        "DERIVED_FROM",
        Dimension.GENETIC,
        "entity",
        "entity",
        transitive=True,
        description="artifact/dish/style derives from an ancestor",
    ),
    RelationType(
        "INFLUENCED_BY",
        Dimension.GENETIC,
        "entity",
        "entity",
        description="entity is influenced by another",
    ),
    RelationType(
        "VARIANT_OF",
        Dimension.GENETIC,
        "entity",
        "entity",
        symmetric=True,
        description="entity is a variant of a canonical form",
    ),
    # Structural / categorical
    RelationType(
        "INSTANCE_OF",
        Dimension.STRUCTURAL,
        "entity",
        "type",
        description="entity is an instance of a type",
    ),
    RelationType(
        "SUBCLASS_OF",
        Dimension.STRUCTURAL,
        "type",
        "type",
        transitive=True,
        description="type is a subclass of a supertype",
    ),
    RelationType(
        "MEMBER_OF_CATEGORY",
        Dimension.STRUCTURAL,
        "entity",
        "category",
        description="entity belongs to a scraped category",
    ),
    RelationType(
        "CREATED_BY",
        Dimension.STRUCTURAL,
        "entity",
        "person",
        description="artifact was created by a person",
    ),
    RelationType(
        "MADE_OF",
        Dimension.STRUCTURAL,
        "entity",
        "material",
        description="artifact is made of a material (Getty AAT)",
    ),
    RelationType(
        "PART_OF",
        Dimension.STRUCTURAL,
        "entity",
        "entity",
        transitive=True,
        description="entity is a component of a larger whole (Wikidata P361; chains)",
    ),
    RelationType(
        "USES",
        Dimension.STRUCTURAL,
        "entity",
        "entity",
        description="entity uses an instrument, material or technique (Wikidata P2283)",
    ),
    # Personal-media vocabulary (canonical schema v1.2). An asset (sha256-identified
    # media node) depicts/mentions a canonical entity; local-only, personal trust
    # tier. Registered so a personal-media ingest has a canonical home; pinakes
    # itself bundles no producer for them.
    RelationType(
        "DEPICTS",
        Dimension.STRUCTURAL,
        "asset",
        "entity",
        description="an asset visually depicts an entity (a vision caption/object)",
    ),
    RelationType(
        "MENTIONS",
        Dimension.STRUCTURAL,
        "asset",
        "entity",
        description="an asset textually mentions an entity (a transcript/text ingest)",
    ),
    # Generated-world vocabulary (Insimul bridge, canonical schema v1.3 —
    # insimul-bridge US-003). Characters / buildings / businesses and their
    # genealogy, occupancy and causality edges; synthetic trust tier, world-scoped
    # provenance (see shared/predicate-mapping.json insimul entries 9-15).
    RelationType(
        "PARENT_OF",
        Dimension.GENETIC,
        "character",
        "character",
        description="a character is a parent of another (Insimul parent_of/2)",
    ),
    RelationType(
        "SPOUSE_OF",
        Dimension.GENETIC,
        "character",
        "character",
        symmetric=True,
        description="two characters are married (Insimul married_to/2)",
    ),
    RelationType(
        "EMPLOYED_BY",
        Dimension.STRUCTURAL,
        "character",
        "business",
        description="a character works for a business (Insimul business_owner/2)",
    ),
    RelationType(
        "RESIDES_IN",
        Dimension.STRUCTURAL,
        "character",
        "building",
        description="a character dwells in a building (Insimul residence_resident/2)",
    ),
    RelationType(
        "CAUSED_BY",
        Dimension.TEMPORAL,
        "entity",
        "entity",
        description="an event happened because of an earlier event (effect, cause)",
    ),
)

#: The registry: ``:TYPE`` name -> :class:`RelationType`, the source of truth.
REGISTRY: dict[str, RelationType] = {rel.name: rel for rel in _RELATION_TYPES}


def get(name: str) -> RelationType | None:
    """Return the :class:`RelationType` for *name*, or ``None`` if unregistered."""
    return REGISTRY.get(name)


def lookup(name: str) -> RelationType:
    """Return the :class:`RelationType` for *name*.

    Raises :class:`UnknownRelationTypeError` if *name* is not registered.
    """
    rel = REGISTRY.get(name)
    if rel is None:
        raise UnknownRelationTypeError(f"unknown relationship type {name!r}")
    return rel


def is_registered(name: str) -> bool:
    """Whether *name* is a registered relationship ``:TYPE``."""
    return name in REGISTRY


def relation_types() -> tuple[RelationType, ...]:
    """Every registered relationship type, in data-model order."""
    return _RELATION_TYPES


def by_dimension(dimension: Dimension) -> tuple[RelationType, ...]:
    """Every registered relationship type on *dimension*, in data-model order."""
    return tuple(rel for rel in _RELATION_TYPES if rel.dimension is dimension)


def validate_type(name: str) -> RelationType:
    """Validate an edge ``:TYPE``, returning its :class:`RelationType`.

    This is the validator the acceptance criteria require: it rejects an edge
    whose ``:TYPE`` is not registered by raising
    :class:`UnknownRelationTypeError`. Returning the matched type lets a caller
    validate and read flags in one step.
    """
    return lookup(name)
