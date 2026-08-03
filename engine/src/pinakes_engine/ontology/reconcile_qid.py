"""Collapse nodes that share a Wikidata QID but were minted under different types.

Stitching several dump domains with the pinakes convergence export (US-004)
surfaces a class of identity damage the per-``csid`` stitch cannot fix on its own:
the **same** real-world entity acquires **different** ``csid``\\ s when two sources
type it differently, because ``csid`` is ``cs:<node-type>:<QID>``. Observed on the
reference merge:

* a deity typed ``Concept`` by the myth-religion blueprint vs ``Deity`` by
  pinakes (``cs:concept:Q146007`` vs ``cs:deity:Q146007``);
* a script typed ``Language`` by the language blueprint's writing-systems category
  vs ``WritingSystem`` by pinakes (``cs:language:Q145625`` vs
  ``cs:writing-system:Q145625``);
* a geographic **place hub** the linker mints for a QID that pinakes already
  curates as a ``Culture`` (``cs:place:Q11767`` vs ``cs:culture:Q11767``).

A Wikidata QID is a *global* identity (one QID ⇒ one entity), so all of these are
genuinely the same node and must collapse — otherwise the corpus carries duplicate
identities (the ``duplicate rate`` QA gate trips) and Neo4j would hold two nodes
for one entity. :func:`reconcile_shared_qids` performs that collapse: it groups
nodes by normalized QID, merges each group through the tested
:func:`~pinakes_engine.schema.merge.merge_rows` machinery (which unions their label
sets, aliases, and provenance and keeps the richest value per field), and
redirects every edge endpoint onto the survivor so nothing dangles. It is
**QID-only** — nodes without a QID, and nodes whose QIDs differ, are never touched
— so it cannot over-merge on a shared name the way a full corpus-wide dedup could.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass

from pinakes_engine.ontology.linker import Edge, Node
from pinakes_engine.schema.ids import IdError, normalize_qid
from pinakes_engine.schema.merge import (
    DEFAULT_FUZZY_THRESHOLD,
    merge_rows,
    merged_csid_remap,
)

LOGGER = logging.getLogger("pinakes_engine.ontology.reconcile_qid")


@dataclass(frozen=True)
class QidReconcileResult:
    """The nodes/edges after a shared-QID collapse, with what it changed.

    Attributes:
        nodes: The reconciled node rows (same-QID duplicates merged into one).
        edges: The reconciled edge rows, endpoints redirected onto survivors and
            newly dangling / self-loop edges dropped.
        collapsed: How many duplicate nodes were removed (``0`` when nothing
            shared a QID across types).
    """

    nodes: list[Node]
    edges: list[Edge]
    collapsed: int


def reconcile_shared_qids(
    nodes: Sequence[Node],
    edges: Sequence[Edge],
    *,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> QidReconcileResult:
    """Merge nodes sharing a normalized ``wikidata_qid`` and redirect their edges.

    Nodes are grouped by normalized QID; a group of two or more is merged with
    :func:`~pinakes_engine.schema.merge.merge_rows` (they share the QID, so they
    cluster into one survivor whose labels/aliases/provenance union). Nodes with
    no QID pass through untouched. Every ``:START_ID`` / ``:END_ID`` is then
    rewritten through the merge remap and an edge that would dangle or become a
    self-loop after the redirect is dropped. Inputs are never mutated.
    """
    grouped: dict[str, list[Node]] = {}
    passthrough: list[Node] = []
    for node in nodes:
        qid = _normalized_qid(node)
        if qid:
            grouped.setdefault(qid, []).append(node)
        else:
            passthrough.append(node)

    merged: list[Node] = list(passthrough)
    collapsed = 0
    for group in grouped.values():
        if len(group) == 1:
            merged.append(group[0])
            continue
        survivors = merge_rows(group, fuzzy_threshold=fuzzy_threshold)
        collapsed += len(group) - len(survivors)
        merged.extend(survivors)

    reconciled_edges = _redirect_edges(edges, merged)
    if collapsed:
        LOGGER.info(
            "reconciled %d node(s) sharing a QID across types into one",
            collapsed,
            extra={"event": "reconcile_qid.collapsed", "collapsed": collapsed},
        )
    return QidReconcileResult(
        nodes=merged, edges=reconciled_edges, collapsed=collapsed
    )


def _normalized_qid(node: Node) -> str:
    """The node's ``wikidata_qid`` normalized (``Q…``), or ``""`` when absent."""
    value = node.get("wikidata_qid", "")
    qid = value.strip() if isinstance(value, str) else ""
    if not qid:
        return ""
    try:
        return normalize_qid(qid)
    except IdError:
        return qid


def _redirect_edges(edges: Sequence[Edge], nodes: Sequence[Node]) -> list[Edge]:
    """Rewrite edge endpoints onto merge survivors, dropping dangling/self-loops.

    Mirrors ``schema.pipeline._redirect_edges``: each endpoint is redirected
    through :func:`~pinakes_engine.schema.merge.merged_csid_remap`; an edge whose
    (redirected) start or end names no surviving node, or which the redirect turns
    into a self-loop (its two endpoints are now one node), is dropped.
    """
    remap = merged_csid_remap(nodes)
    surviving = {
        csid for node in nodes if isinstance((csid := node.get("csid")), str) and csid
    }
    out: list[Edge] = []
    for edge in edges:
        start = _redirect(edge, ":START_ID", remap)
        end = _redirect(edge, ":END_ID", remap)
        if start not in surviving or end not in surviving or start == end:
            continue
        if start == _scalar(edge, ":START_ID") and end == _scalar(edge, ":END_ID"):
            out.append(edge)
        else:
            redirected = dict(edge)
            redirected[":START_ID"] = start
            redirected[":END_ID"] = end
            out.append(redirected)
    return out


def _redirect(edge: Edge, key: str, remap: dict[str, str]) -> str:
    csid = _scalar(edge, key)
    return remap.get(csid, csid)


def _scalar(row: Node | Edge, key: str) -> str:
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


__all__ = ["QidReconcileResult", "reconcile_shared_qids"]
