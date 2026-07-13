"""Extract Wikidata property constraints (P2302) for the corpus's edge vocabulary.

The datalog layer turns a property constraint into an inference or integrity rule
(:mod:`culturescrape.datalog.constraints`), but the constraints themselves are not in
the graph — they live as ``P2302`` statements on the Wikidata *property* entities the
corpus's edge ``:TYPE`` vocabulary is built from. This module is the acquisition step
that reads them, via a **WDQS SPARQL** query (:func:`sparql_constraint_lookup`), and
resolves each into a corpus-scoped
:class:`~culturescrape.datalog.constraints.PropertyConstraint`.

All the Wikidata↔corpus resolution happens here, so the datalog translator never needs
the mapping (no ``datalog → acquire`` import):

* a property PID → the corpus edge ``:TYPE`` it backs (:data:`EDGE_PROPERTY_PIDS`);
* an *inverse* constraint's target PID → that property's ``:TYPE`` (blank when the
  inverse property is outside the vocabulary — the translator then skips-and-reports);
* a *type* constraint's class QID → the node ``:LABEL`` it maps to
  (:data:`~culturescrape.acquire.taxonomy.CORPUS_CLASS_QIDS`, reused — blank when the
  class is not a corpus backing class).

The resolved constraints are written to the committed replay artifact
(:data:`~culturescrape.datalog.constraints.PROPERTY_CONSTRAINTS_TSV`) that CI reads
back,
never touching the network — the same network-free discipline the taxonomy extractor
(:mod:`culturescrape.acquire.taxonomy`) uses. Respect Wikimedia politeness on the SPARQL
path — it goes through the shared :class:`~culturescrape.acquire.http.HttpClient`.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.taxonomy import CORPUS_CLASS_QIDS
from culturescrape.acquire.wikidata import WIKIDATA_SPARQL_ENDPOINT
from culturescrape.datalog.constraints import (
    CONSTRAINT_KIND_BY_QID,
    DEFAULT_CONFIDENCE,
    PROPERTY_CONSTRAINT_COLUMNS,
    PropertyConstraint,
)
from culturescrape.schema.tsvio import encode_value

#: The Wikidata property PID that backs each corpus edge ``:TYPE`` whose constraints
#: we lift. Conservative on purpose (like
#: :data:`~culturescrape.acquire.taxonomy.CORPUS_CLASS_QIDS`): only ``:TYPE``\\ s with a
#: single, reliable backing property appear — a constraint is only as sound as this
#: map, so an edge type whose Wikidata property is ambiguous is omitted, not guessed.
#: Extend it as new edge types earn a confident property anchor.
EDGE_PROPERTY_PIDS: Mapping[str, str] = {
    "ADJACENT_TO": "P47",  # shares border with (symmetric + geographic type)
    "PART_OF": "P361",  # part of (inverse of P527 has part)
}

#: The source id every extracted constraint carries.
SOURCE = "wikidata"


class ConstraintAcquireError(RuntimeError):
    """Raised when property constraints cannot be resolved from a source."""


def wikidata_property_url(pid: str) -> str:
    """The Wikidata property page for *pid* (where its ``P2302`` statements live)."""
    return f"https://www.wikidata.org/wiki/Property:{pid}"


def constraint_query(pid: str) -> str:
    """The WDQS query selecting every ``P2302`` constraint statement of *pid*.

    Each row is one constraint statement with its constraint-type item and the
    qualifiers we translate: ``P2306`` (the property, for inverse constraints),
    ``P2308``/``P2309`` (the class and its relation, for type constraints).
    """
    return (
        "SELECT ?statement ?constraintType ?class ?relation ?property WHERE { "
        f"wd:{pid} p:P2302 ?statement . "
        "?statement ps:P2302 ?constraintType . "
        "OPTIONAL { ?statement pq:P2308 ?class . } "
        "OPTIONAL { ?statement pq:P2309 ?relation . } "
        "OPTIONAL { ?statement pq:P2306 ?property . } }"
    )


#: One raw constraint statement, as parsed from WDQS before corpus resolution.
RawConstraint = dict[str, str]

#: A callable resolving a property PID to its raw ``P2302`` constraint statements.
ConstraintLookup = Callable[[str], list[RawConstraint]]


def _entity_tail(value: str) -> str:
    """The last path segment of a Wikidata entity/statement URI (``""`` if blank)."""
    return value.rsplit("/", 1)[-1] if value else ""


def sparql_constraint_lookup(
    http: HttpClient, *, endpoint: str = WIKIDATA_SPARQL_ENDPOINT
) -> ConstraintLookup:
    """A P2302-constraint lookup backed by a WDQS query.

    Each call issues one request (through the shared, polite :class:`HttpClient`)
    and returns the property's constraint statements as raw dicts, merging the
    optional qualifier rows a single statement can span. Raises
    :class:`ConstraintAcquireError` on a failed request or unparseable body.
    """

    def constraints_of(pid: str) -> list[RawConstraint]:
        response = http.get(
            endpoint, {"query": constraint_query(pid), "format": "json"}
        )
        if response.status_code >= 400:
            raise ConstraintAcquireError(
                f"WDQS P2302 request for {pid} failed with status "
                f"{response.status_code}"
            )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise ConstraintAcquireError(
                f"WDQS returned a non-JSON body for {pid}: {exc}"
            ) from exc
        merged: dict[str, RawConstraint] = {}
        for row in payload.get("results", {}).get("bindings", []):
            statement = _entity_tail(row.get("statement", {}).get("value", ""))
            if not statement:
                continue
            record = merged.setdefault(
                statement,
                {
                    "statement": statement,
                    "constraintType": "",
                    "class": "",
                    "relation": "",
                    "property": "",
                },
            )
            record["constraintType"] = record["constraintType"] or _entity_tail(
                row.get("constraintType", {}).get("value", "")
            )
            for key in ("class", "relation", "property"):
                record[key] = record[key] or _entity_tail(
                    row.get(key, {}).get("value", "")
                )
        return list(merged.values())

    return constraints_of


def property_constraints(
    constraints_of: ConstraintLookup,
    *,
    retrieved_at: str,
    properties: Mapping[str, str] = EDGE_PROPERTY_PIDS,
    class_labels: Mapping[str, str] = CORPUS_CLASS_QIDS,
    confidence: float = DEFAULT_CONFIDENCE,
    source: str = SOURCE,
) -> list[PropertyConstraint]:
    """The resolved P2302 constraints for every property in *properties*.

    Fetches each property's constraint statements via *constraints_of* and resolves
    them against the corpus: the property's own edge ``:TYPE``, an inverse
    constraint's target ``:TYPE`` (blank when out of vocabulary), and a type
    constraint's class ``:LABEL`` (blank when the class is not a corpus backing
    class). The result is sorted by ``(edge_type, constraint_qid, statement_id)`` for
    a deterministic, idempotent artifact — the *translation* (which of these become
    rules and which are reported) is the datalog layer's job.
    """
    pid_to_edge = {pid: edge for edge, pid in properties.items()}
    qid_to_label = {qid: label for label, qid in class_labels.items()}

    resolved: list[PropertyConstraint] = []
    for edge_type, pid in properties.items():
        for raw in constraints_of(pid):
            constraint_qid = raw.get("constraintType", "")
            inverse_pid = raw.get("property", "")
            class_qid = raw.get("class", "")
            resolved.append(
                PropertyConstraint(
                    property_id=pid,
                    edge_type=edge_type,
                    constraint_kind=CONSTRAINT_KIND_BY_QID.get(constraint_qid, "other"),
                    constraint_qid=constraint_qid,
                    statement_id=raw.get("statement", ""),
                    inverse_pid=inverse_pid,
                    inverse_edge_type=pid_to_edge.get(inverse_pid, ""),
                    class_qid=class_qid,
                    class_label=qid_to_label.get(class_qid, ""),
                    relation_qid=raw.get("relation", ""),
                    source=source,
                    source_url=wikidata_property_url(pid),
                    retrieved_at=retrieved_at,
                    confidence=confidence,
                )
            )
    resolved.sort(key=lambda c: (c.edge_type, c.constraint_qid, c.statement_id))
    return resolved


def _format_confidence(value: float) -> str:
    """Render a confidence as a compact, stable decimal (``0.9``, not ``0.90``)."""
    return repr(float(value))


def render_property_constraints_tsv(constraints: Sequence[PropertyConstraint]) -> str:
    """Render *constraints* as the committed artifact TSV text (header + rows)."""
    lines = ["\t".join(PROPERTY_CONSTRAINT_COLUMNS)]
    for c in constraints:
        cells = {
            "property_id": c.property_id,
            "edge_type": c.edge_type,
            "constraint_kind": c.constraint_kind,
            "constraint_qid": c.constraint_qid,
            "statement_id": c.statement_id,
            "inverse_pid": c.inverse_pid,
            "inverse_edge_type": c.inverse_edge_type,
            "class_qid": c.class_qid,
            "class_label": c.class_label,
            "relation_qid": c.relation_qid,
            "source": c.source,
            "source_url": c.source_url,
            "retrieved_at": c.retrieved_at,
            "confidence": _format_confidence(c.confidence),
        }
        lines.append(
            "\t".join(encode_value(cells[col]) for col in PROPERTY_CONSTRAINT_COLUMNS)
        )
    return "\n".join(lines) + "\n"


def write_property_constraints_tsv(
    constraints: Sequence[PropertyConstraint], path: str | Path
) -> int:
    """Write the committed property-constraint artifact; return the row count."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_property_constraints_tsv(constraints), encoding="utf-8")
    return len(constraints)


__all__ = [
    "EDGE_PROPERTY_PIDS",
    "SOURCE",
    "ConstraintAcquireError",
    "ConstraintLookup",
    "RawConstraint",
    "constraint_query",
    "property_constraints",
    "render_property_constraints_tsv",
    "sparql_constraint_lookup",
    "wikidata_property_url",
    "write_property_constraints_tsv",
]
