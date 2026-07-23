"""Stitch per-category outputs into one graph where shared entities are one node.

Each category is normalized on its own (``culturescrape.schema.pipeline`` produces
one :class:`~culturescrape.schema.pipeline.NormalizationResult` per
``categories/<name>.yml``), so the *same* real-world entity scraped under two
categories appears as two separate node rows — once per category. Left alone the
categories would stay disjoint islands. This module joins them: the same entity
becomes **one** node so the categories interconnect through it.

Two node rows are the same entity when they share a ``csid`` — the canonical
primary key minted deterministically per entity (``docs/data-model.md``), so the
same entity reconciles to the same id in every category. Those same-``csid`` rows
are collapsed by **reusing the entity-resolution logic**
(:func:`culturescrape.schema.merge.merge_rows`), which unions their aliases and
provenance and keeps the highest-confidence value per column — the merge is
applied per ``csid`` so a surviving node always keeps that id and no edge is left
dangling.

A stitched entity keeps its ``MEMBER_OF_CATEGORY`` edge to **every** category it
was scraped under (those edges differ only in their target category node, so all
survive), while the duplicate structural edges every category emits for it (e.g.
the identical ``INSTANCE_OF`` edge) collapse to one. The cross-category shared
entities — those left belonging to more than one category — are reported in
:attr:`StitchResult.shared`.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass

from culturescrape.ontology.linker import Edge, Node
from culturescrape.schema.categorize import CATEGORY_LABEL, MEMBER_OF_CATEGORY
from culturescrape.schema.merge import DEFAULT_FUZZY_THRESHOLD, merge_rows
from culturescrape.schema.pipeline import NormalizationResult

LOGGER = logging.getLogger("culturescrape.ontology.stitch")


@dataclass(frozen=True)
class SharedEntity:
    """An entity that ended up belonging to more than one category.

    Attributes:
        csid: The shared entity's canonical id.
        name: Its canonical display name (``""`` if the node carries none).
        categories: The names of the categories it belongs to, sorted.
    """

    csid: str
    name: str
    categories: list[str]


@dataclass(frozen=True)
class StitchResult:
    """The result of stitching several category outputs into one graph.

    Attributes:
        nodes: The combined node rows, with same-``csid`` duplicates merged.
        edges: The combined edge rows, with duplicate structural edges collapsed
            while every ``MEMBER_OF_CATEGORY`` edge is retained.
        shared: The cross-category shared entities, ordered by ``csid``.
    """

    nodes: list[Node]
    edges: list[Edge]
    shared: list[SharedEntity]


def stitch_categories(
    results: Iterable[NormalizationResult],
    *,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> StitchResult:
    """Merge per-category *results* so entities shared across categories are one node.

    Node rows sharing a ``csid`` are collapsed with
    :func:`~culturescrape.schema.merge.merge_rows` (the merge runs per ``csid`` so
    the surviving node keeps that id), edges are concatenated with duplicate
    structural edges removed, and the entities left in more than one category are
    reported. Inputs are never mutated.
    """
    all_nodes: list[Node] = []
    all_edges: list[Edge] = []
    for result in results:
        all_nodes.extend(result.nodes)
        all_edges.extend(result.edges)

    nodes = _merge_by_csid(all_nodes, fuzzy_threshold)
    edges = _dedupe_edges(all_edges)
    shared = _shared_entities(nodes, edges)
    if shared:
        LOGGER.info(
            "stitched %d entit%s shared across categories",
            len(shared),
            "y" if len(shared) == 1 else "ies",
        )
    return StitchResult(nodes=nodes, edges=edges, shared=shared)


def _merge_by_csid(nodes: Iterable[Node], fuzzy_threshold: float) -> list[Node]:
    """Collapse rows sharing a ``csid`` into one, keeping first-seen order.

    Each ``csid`` group is resolved through
    :func:`~culturescrape.schema.merge.merge_rows`, so duplicates of one entity
    are merged exactly as acquisition duplicates are; a singleton group passes
    through untouched.
    """
    groups: dict[str, list[Node]] = {}
    for node in nodes:
        groups.setdefault(_csid(node), []).append(node)
    out: list[Node] = []
    for group in groups.values():
        if len(group) == 1:
            out.append(group[0])
        else:
            out.extend(merge_rows(group, fuzzy_threshold=fuzzy_threshold))
    return out


def _dedupe_edges(edges: Iterable[Edge]) -> list[Edge]:
    """Drop edges duplicating an earlier one on ``(:START_ID, :END_ID, :TYPE)``.

    Every category re-emits an entity's ``INSTANCE_OF`` edge, so a shared entity
    yields identical copies that collapse here; its ``MEMBER_OF_CATEGORY`` edges
    point at different category nodes, so each one survives.
    """
    seen: set[tuple[str, str, str]] = set()
    out: list[Edge] = []
    for edge in edges:
        key = (_scalar(edge, ":START_ID"), _scalar(edge, ":END_ID"), _edge_type(edge))
        if key not in seen:
            seen.add(key)
            out.append(edge)
    return out


def _shared_entities(
    nodes: Iterable[Node], edges: Iterable[Edge]
) -> list[SharedEntity]:
    """Report entities whose ``MEMBER_OF_CATEGORY`` edges reach >1 category."""
    category_name = {_csid(n): _scalar(n, "name") for n in nodes if _is_category(n)}
    entity_name = {_csid(n): _scalar(n, "name") for n in nodes}

    by_entity: dict[str, set[str]] = {}
    for edge in edges:
        if _edge_type(edge) == MEMBER_OF_CATEGORY:
            start, end = _scalar(edge, ":START_ID"), _scalar(edge, ":END_ID")
            if end in category_name:
                by_entity.setdefault(start, set()).add(end)

    shared: list[SharedEntity] = []
    for csid, cat_csids in by_entity.items():
        if len(cat_csids) > 1:
            categories = sorted(category_name[c] for c in cat_csids)
            shared.append(
                SharedEntity(
                    csid=csid, name=entity_name.get(csid, ""), categories=categories
                )
            )
    return sorted(shared, key=lambda s: s.csid)


def render_report(shared: Iterable[SharedEntity]) -> str:
    """Render *shared* entities as a human-readable, line-per-entity report."""
    lines = [
        f"{s.name or s.csid} ({s.csid}): {', '.join(s.categories)}" for s in shared
    ]
    if not lines:
        return "No entities are shared across categories."
    noun = "entity" if len(lines) == 1 else "entities"
    header = f"{len(lines)} {noun} shared across categories:"
    return "\n".join([header, *lines])


def _csid(node: Node) -> str:
    return _scalar(node, "csid")


def _is_category(node: Node) -> bool:
    labels = node.get(":LABEL")
    return isinstance(labels, list) and CATEGORY_LABEL in labels


def _scalar(row: Node | Edge, key: str) -> str:
    """Return *row*'s scalar cell for *key*, stripped, or ``""``."""
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


def _edge_type(edge: Edge) -> str:
    return _scalar(edge, ":TYPE")
