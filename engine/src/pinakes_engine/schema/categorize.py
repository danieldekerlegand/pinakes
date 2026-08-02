"""Link each entity to its scraped category and its type.

Acquisition draws every node *from* a declared category (``categories/<name>.yml``)
and stamps each node with one or more labels, the first of which is its type
(``docs/data-model.md``). This module makes both facts queryable as first-class
graph structure:

* a :data:`MEMBER_OF_CATEGORY` edge from every node to the **category node** for
  the :class:`~pinakes_engine.acquire.categories.CategorySpec` it was scraped
  under, and
* an :data:`INSTANCE_OF` edge from every node to the **type node** for its
  primary label.

The category and type nodes the edges point at are synthesized here and
**deduplicated by ``csid``** — every node in a category shares one category node,
and every node of a given type shares one type node — so the structural nodes are
created idempotently whether or not they already existed. Their ids are minted
deterministically (:func:`~pinakes_engine.schema.ids.mint_csid`), so a re-run
reproduces the identical graph.

Every emitted edge **carries the provenance of its source node row**
(``source`` / ``source_url`` / ``retrieved_at`` / ``confidence``), so no link
travels without the source that justified it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.schema.ids import mint_csid
from pinakes_engine.schema.tsvio import Row

#: Relationship ``:TYPE`` from an entity to the category it was scraped under.
MEMBER_OF_CATEGORY = "MEMBER_OF_CATEGORY"

#: Relationship ``:TYPE`` from an entity to its type (primary ``:LABEL``).
INSTANCE_OF = "INSTANCE_OF"

#: ``:LABEL`` of a synthesized scraped-category node.
CATEGORY_LABEL = "Category"

#: ``:LABEL`` of a synthesized type node.
TYPE_LABEL = "Type"

#: ``source`` stamped on synthesized category/type nodes (they are structural,
#: not acquired from any external source).
SYNTHETIC_SOURCE = "pinakes_engine"

#: ``confidence`` stamped on synthesized nodes — the structure is certain.
_FULL_CONFIDENCE = repr(1.0)

#: Provenance columns copied from a source node row onto each emitted edge.
_EDGE_PROVENANCE = ("source", "source_url", "retrieved_at", "confidence")


class CategorizeError(ValueError):
    """Raised when a node row cannot be linked to its category and type."""


@dataclass(frozen=True)
class Categorization:
    """The structural result of linking entities to category and type.

    Attributes:
        nodes: The synthesized category and type nodes, deduplicated by ``csid``
            and ordered category-first then by first appearance.
        edges: The :data:`MEMBER_OF_CATEGORY` and :data:`INSTANCE_OF` edge rows,
            two per source node, in source-row order.
    """

    nodes: list[Row]
    edges: list[Row]


def category_node(category: CategorySpec) -> Row:
    """Build the node representing the scraped *category* itself."""
    return {
        "csid": mint_csid(CATEGORY_LABEL, name=category.id),
        ":LABEL": [CATEGORY_LABEL],
        "name": category.id,
        "description": category.description,
        "source": SYNTHETIC_SOURCE,
        "confidence": _FULL_CONFIDENCE,
    }


def type_node(type_name: str) -> Row:
    """Build the node representing the entity type named *type_name*."""
    return {
        "csid": mint_csid(TYPE_LABEL, name=type_name),
        ":LABEL": [TYPE_LABEL],
        "name": type_name,
        "source": SYNTHETIC_SOURCE,
        "confidence": _FULL_CONFIDENCE,
    }


def categorize_rows(rows: Iterable[Row], category: CategorySpec) -> Categorization:
    """Link every node in *rows* to *category* and to its type.

    For each row a :data:`MEMBER_OF_CATEGORY` edge to *category*'s node and an
    :data:`INSTANCE_OF` edge to the node for its primary label are emitted, both
    carrying the row's provenance. The single category node and one node per
    distinct type are synthesized and returned deduplicated by ``csid``.

    Raises:
        CategorizeError: If any row lacks a ``csid`` or a primary ``:LABEL``.
    """
    cat = category_node(category)
    cat_csid = _require_str(cat["csid"])
    nodes_by_csid: dict[str, Row] = {cat_csid: cat}
    edges: list[Row] = []

    for row in rows:
        node_csid = _csid(row)
        if not node_csid:
            raise CategorizeError("node row has no csid to link from")
        type_name = _primary_label(row)
        if not type_name:
            raise CategorizeError(
                f"node {node_csid!r} has no primary :LABEL to type it"
            )
        tnode = type_node(type_name)
        nodes_by_csid.setdefault(_require_str(tnode["csid"]), tnode)

        edges.append(_edge(node_csid, cat_csid, MEMBER_OF_CATEGORY, row))
        edges.append(_edge(node_csid, _require_str(tnode["csid"]), INSTANCE_OF, row))

    return Categorization(nodes=list(nodes_by_csid.values()), edges=edges)


def _edge(start: str, end: str, rel_type: str, source: Row) -> Row:
    """Build one edge row, carrying *source*'s provenance."""
    edge: Row = {":START_ID": start, ":END_ID": end, ":TYPE": rel_type}
    for column in _EDGE_PROVENANCE:
        value = source.get(column)
        if isinstance(value, str) and value:
            edge[column] = value
    return edge


def _csid(row: Row) -> str:
    """The row's ``csid`` as a stripped scalar, or ``""`` if absent."""
    value = row.get("csid")
    return value.strip() if isinstance(value, str) else ""


def _primary_label(row: Row) -> str:
    """The row's first ``:LABEL`` segment (its type), or ``""`` if none."""
    labels = row.get(":LABEL")
    if isinstance(labels, list):
        for label in labels:
            if label.strip():
                return label.strip()
    return ""


def _require_str(value: str | list[str]) -> str:
    """Narrow a freshly-minted ``csid`` cell to ``str`` for the type checker."""
    assert isinstance(value, str)  # category/type nodes always mint a str csid
    return value
