"""Extract the Wikidata P279 subclass taxonomy for the corpus's node classes.

The datalog layer closes class membership with
``instance_of(X, C) :- instance_of(X, D), subclass_of(D, C)``
(:mod:`culturescrape.datalog.rules`), but the ``subclass_of`` half is not in the
graph — it lives in Wikidata's ``P279`` (*subclass of*) hierarchy. This module is
the acquisition step that reads it, by **either path the rest of the acquire stack
already offers**:

* a **WDQS SPARQL** query (``wdt:P279*``) — :func:`sparql_ancestor_lookup`;
* the **on-disk dump index** (``P279`` edges, walked with
  :meth:`~culturescrape.acquire.wikidata_dump_index.DumpIndex.class_closure`) —
  :func:`dump_ancestor_lookup`.

Both resolve the same abstraction — the P279 ancestors of a class QID — which
:func:`subclass_edges` turns into the **direct** ``subclass_of`` relations among
the corpus's ``:LABEL`` node types (:data:`CORPUS_CLASS_QIDS`). The result is a
small, provenanced :class:`~culturescrape.datalog.taxonomy.SubclassEdge` set that
:func:`write_subclass_tsv` writes to the committed replay artifact the datalog
export reads back (network-free in CI).

Respect Wikimedia politeness on the SPARQL path — it goes through the shared
:class:`~culturescrape.acquire.http.HttpClient` (cached / retried / identified),
same as :mod:`culturescrape.acquire.wikidata_slice`.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.wikidata import WIKIDATA_SPARQL_ENDPOINT
from culturescrape.acquire.wikidata_dump_index import DumpIndex
from culturescrape.datalog.taxonomy import (
    SUBCLASS_OF_COLUMNS,
    SubclassEdge,
)
from culturescrape.schema.tsvio import encode_value

#: The Wikidata class QID that backs each corpus ``:LABEL`` node type. Only labels
#: with a reliable, single backing class appear — the taxonomy is only as sound as
#: this map, so a label whose Wikidata class is ambiguous (e.g. ``MigrationRoute``,
#: ``UrheimatHypothesis``) is deliberately omitted rather than guessed. Extend it
#: as new node types earn a confident class anchor.
CORPUS_CLASS_QIDS: Mapping[str, str] = {
    "Language": "Q34770",  # language
    "LanguageFamily": "Q25295",  # language family
    "WritingSystem": "Q8192",  # writing system
    "Culture": "Q11042",  # culture
    "ArchaeologicalCulture": "Q465299",  # archaeological culture
    "Religion": "Q9174",  # religion
    "Deity": "Q178885",  # deity
    "ArtTradition": "Q968159",  # art movement
    "LiteraryTradition": "Q2198855",  # literary movement
    "Cuisine": "Q1968435",  # cuisine
    "Ingredient": "Q25403900",  # food ingredient
    "TradeGood": "Q317623",  # commodity
    "Battle": "Q178561",  # battle
    "Place": "Q2221906",  # geographic location
    "Period": "Q11514315",  # historical period
    "MythMotif": "Q1917351",  # motif (narrative)
}

#: The source id every extracted relation carries (mirrors the acquire adapters).
SOURCE = "wikidata"

#: The default confidence for an extracted P279 relation (a machine-read axiom,
#: high but not curated-certain — the backing class map is the weak link).
DEFAULT_CONFIDENCE = 0.9

#: A callable resolving a class QID to the set of its ``P279*`` ancestor QIDs
#: (excluding itself). Both acquisition paths return one of these.
AncestorLookup = Callable[[str], set[str]]


def wikidata_entity_url(qid: str) -> str:
    """The Wikidata entity page for *qid* (where its ``P279`` statement lives)."""
    return f"https://www.wikidata.org/wiki/{qid}"


def ancestor_query(qid: str) -> str:
    """The WDQS query selecting every ``P279*`` superclass of class *qid*."""
    return f"SELECT ?super WHERE {{ wd:{qid} wdt:P279* ?super }}"


class TaxonomyAcquireError(RuntimeError):
    """Raised when the P279 taxonomy cannot be resolved from a source."""


def sparql_ancestor_lookup(
    http: HttpClient, *, endpoint: str = WIKIDATA_SPARQL_ENDPOINT
) -> AncestorLookup:
    """A P279-ancestor lookup backed by a WDQS ``wdt:P279*`` query.

    Each call issues one request (through the shared, polite :class:`HttpClient`)
    and returns the class's ancestor QIDs, minus itself. Raises
    :class:`TaxonomyAcquireError` on a failed request or unparseable body.
    """

    def ancestors_of(qid: str) -> set[str]:
        response = http.get(endpoint, {"query": ancestor_query(qid), "format": "json"})
        if response.status_code >= 400:
            raise TaxonomyAcquireError(
                f"WDQS P279 request for {qid} failed with status "
                f"{response.status_code}"
            )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise TaxonomyAcquireError(
                f"WDQS returned a non-JSON body for {qid}: {exc}"
            ) from exc
        ancestors: set[str] = set()
        for row in payload.get("results", {}).get("bindings", []):
            tail = row.get("super", {}).get("value", "").rsplit("/", 1)[-1]
            if tail.startswith("Q") and tail != qid:
                ancestors.add(tail)
        return ancestors

    return ancestors_of


def dump_ancestor_lookup(
    index: DumpIndex, universe: Sequence[str]
) -> AncestorLookup:
    """A P279-ancestor lookup backed by the on-disk dump index.

    The index answers *descendants* (``class_closure``), so an ancestor query is
    the inverse over the small *universe* of classes we care about: *parent* is an
    ancestor of *child* iff *child* is in *parent*'s transitive P279 closure. The
    universe is the corpus's backing classes (:data:`CORPUS_CLASS_QIDS`), so this
    is a cheap ``O(universe²)`` scan — no full dump pass.
    """
    universe = tuple(dict.fromkeys(universe))  # de-dup, keep order
    closures = {
        parent: index.class_closure((parent,), transitive=True) for parent in universe
    }

    def ancestors_of(qid: str) -> set[str]:
        return {
            parent
            for parent in universe
            if parent != qid and qid in closures[parent]
        }

    return ancestors_of


def subclass_edges(
    ancestors_of: AncestorLookup,
    *,
    retrieved_at: str,
    classes: Mapping[str, str] = CORPUS_CLASS_QIDS,
    confidence: float = DEFAULT_CONFIDENCE,
    source: str = SOURCE,
) -> list[SubclassEdge]:
    """The direct ``subclass_of`` relations among *classes*, via *ancestors_of*.

    For every ordered pair of corpus labels whose backing classes stand in a
    ``P279*`` relation, keep only the **direct** edge: a parent *P* of child *C*
    is dropped when another parent *Q* of *C* already has *P* as an ancestor (so
    *Q* sits between *C* and *P*). The datalog closure rule re-derives the elided
    transitive links one hop at a time, so storing only direct edges keeps the
    artifact minimal without losing any membership. The result is sorted by
    ``(child, parent)`` for a deterministic, idempotent artifact.
    """
    qid_to_label = {qid: label for label, qid in classes.items()}
    universe = set(classes.values())

    # parents[label] = the corpus-label classes strictly above it in P279.
    parents: dict[str, set[str]] = {}
    for label, qid in classes.items():
        ancestor_qids = ancestors_of(qid) & universe
        parents[label] = {qid_to_label[a] for a in ancestor_qids if a != qid}

    edges: list[SubclassEdge] = []
    for child, parent_labels in parents.items():
        for parent in parent_labels:
            # Skip if some other parent Q of `child` is itself below `parent`
            # (parent is Q's ancestor) — then child→parent is transitive, not direct.
            if any(
                other != parent and parent in parents.get(other, set())
                for other in parent_labels
            ):
                continue
            child_qid, parent_qid = classes[child], classes[parent]
            edges.append(
                SubclassEdge(
                    child=child,
                    parent=parent,
                    child_qid=child_qid,
                    parent_qid=parent_qid,
                    source=source,
                    source_url=wikidata_entity_url(child_qid),
                    retrieved_at=retrieved_at,
                    confidence=confidence,
                )
            )
    edges.sort(key=lambda e: (e.child, e.parent))
    return edges


def render_subclass_tsv(edges: Sequence[SubclassEdge]) -> str:
    """Render *edges* as the committed subclass_of TSV text (header + rows).

    Cells go through the strict TSV encoder so a value containing a tab or
    newline cannot corrupt the grid; the output ends with a trailing newline.
    """
    lines = ["\t".join(SUBCLASS_OF_COLUMNS)]
    for edge in edges:
        cells = {
            "child": edge.child,
            "parent": edge.parent,
            "child_qid": edge.child_qid,
            "parent_qid": edge.parent_qid,
            "source": edge.source,
            "source_url": edge.source_url,
            "retrieved_at": edge.retrieved_at,
            "confidence": _format_confidence(edge.confidence),
        }
        lines.append("\t".join(encode_value(cells[c]) for c in SUBCLASS_OF_COLUMNS))
    return "\n".join(lines) + "\n"


def _format_confidence(value: float) -> str:
    """Render a confidence as a compact, stable decimal (``0.9``, not ``0.90``)."""
    text = repr(float(value))
    return text


def write_subclass_tsv(edges: Sequence[SubclassEdge], path: str | Path) -> int:
    """Write the committed subclass_of artifact for *edges*; return the row count."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_subclass_tsv(edges), encoding="utf-8")
    return len(edges)


__all__ = [
    "CORPUS_CLASS_QIDS",
    "DEFAULT_CONFIDENCE",
    "SOURCE",
    "AncestorLookup",
    "TaxonomyAcquireError",
    "ancestor_query",
    "dump_ancestor_lookup",
    "render_subclass_tsv",
    "sparql_ancestor_lookup",
    "subclass_edges",
    "wikidata_entity_url",
    "write_subclass_tsv",
]
