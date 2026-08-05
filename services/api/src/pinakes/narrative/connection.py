"""The narrative core — the port of `server/services/connection-narrative.ts`.

Given two csids: traverse the shared graph for the shortest connecting path
(:func:`pinakes.engine.graph.find_path`), optionally augment it with Datalog
inference, and ask a model to write a short, **sourced** explanation of the
link. Every claim is backed by an edge or an inferred fact whose provenance
travels with it, so a reader can check the prose against the graph.

Everything here is pure over its dependencies. The graph traversal, the model
and the inference are all parameters (:class:`NarrativeDeps`), which is what
lets the whole pipeline run in a test with no Neo4j, no model and no engine.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol

from pinakes.analytics.jsmath import js_number, round_to, to_fixed

#: Aggregate path confidence below this reads as "weak/uncertain".
LOW_CONFIDENCE_THRESHOLD: Final = 0.4

#: Confidence assumed for an edge that carries none. An unweighted graph should
#: still yield a usable — if hedged — score rather than collapsing to zero.
NEUTRAL_PRIOR: Final = 0.7


@dataclass(frozen=True, slots=True)
class Endpoint:
    """A minimal reference to one entity being explained."""

    csid: str
    name: str | None = None

    def payload(self) -> dict[str, Any]:
        """The wire shape, with an absent name omitted as ``JSON.stringify`` did."""
        return (
            {"csid": self.csid}
            if self.name is None
            else {
                "csid": self.csid,
                "name": self.name,
            }
        )

    def label(self) -> str:
        """``from.name?.trim() || from.csid`` — what a reader is shown."""
        return self.name.strip() if self.name and self.name.strip() else self.csid


@dataclass(frozen=True, slots=True)
class DatalogFact:
    """A Datalog-inferred fact linking the two endpoints."""

    relation: str
    statement: str
    csids: list[str] = field(default_factory=list)


class NarrativeLlm(Protocol):
    """Runs the narrative model over a prompt and returns its prose."""

    def generate(self, prompt: str) -> str: ...


@dataclass(frozen=True, slots=True)
class NarrativeDeps:
    """Everything the orchestration reaches outside itself for."""

    find_path: Callable[[str, str], dict[str, Any] | None]
    llm: NarrativeLlm
    infer_facts: Callable[[str, str], list[DatalogFact]] | None = None


def humanize_relationship(edge_type: str) -> str:
    """``DESCENDS_FROM`` / ``descends-from`` → ``descends from``."""
    humanized = edge_type
    for separator in ("_", "-"):
        humanized = humanized.replace(separator, " ")
    # `/[_-]+/g` collapses a run to one space; the two passes above leave a run
    # of spaces behind, so squeeze them.
    while "  " in humanized:
        humanized = humanized.replace("  ", " ")
    return humanized.strip().lower()


def _node_label(node: Mapping[str, Any] | None, csid: str) -> str:
    if node is None:
        return csid
    name = node.get("name")
    return name if isinstance(name, str) and name.strip() else csid


def _first_string(properties: Mapping[str, Any], keys: Sequence[str]) -> str | None:
    for key in keys:
        value = properties.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _first_number(properties: Mapping[str, Any], keys: Sequence[str]) -> float | None:
    for key in keys:
        value = properties.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
    return None


def extract_path_evidence(path: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Turn a graph path into ordered, provenance-bearing evidence.

    Each edge becomes one record, **oriented along the path direction** so the
    chain reads forward from A to B even where the underlying relationship
    points the other way.
    """
    nodes: Sequence[Mapping[str, Any]] = path.get("nodes") or []
    node_by_csid = {node["csid"]: node for node in nodes}
    order = {node["csid"]: index for index, node in enumerate(nodes)}

    evidence: list[dict[str, Any]] = []
    for edge in path.get("edges") or []:
        start_csid = edge.get("startCsid", "")
        end_csid = edge.get("endCsid", "")
        forward = order.get(start_csid, 0) <= order.get(end_csid, 0)
        from_csid = start_csid if forward else end_csid
        to_csid = end_csid if forward else start_csid
        relationship = humanize_relationship(str(edge.get("type", "")))
        from_label = _node_label(node_by_csid.get(from_csid), from_csid)
        to_label = _node_label(node_by_csid.get(to_csid), to_csid)

        properties: Mapping[str, Any] = edge.get("properties") or {}
        source = _first_string(properties, ("source", "source_query", "citation"))
        source_url = _first_string(properties, ("source_url", "url"))
        weight = edge.get("weight")
        if isinstance(weight, (int, float)) and not isinstance(weight, bool):
            confidence: float | None = float(weight)
        else:
            confidence = _first_number(properties, ("confidence", "weight"))

        record: dict[str, Any] = {
            "kind": "edge",
            "statement": f"{from_label} — {relationship} — {to_label}",
            "fromCsid": from_csid,
            "toCsid": to_csid,
            "relationship": edge.get("type"),
        }
        if source is not None:
            record["source"] = source
        if source_url is not None:
            record["sourceUrl"] = source_url
        if confidence is not None:
            record["confidence"] = js_number(max(0.0, min(1.0, confidence)))
        evidence.append(record)
    return evidence


def path_confidence(evidence: Sequence[Mapping[str, Any]]) -> float:
    """Aggregate 0..1 confidence: the **product** of the per-edge confidences.

    A chain is only as trustworthy as its weakest link, compounding — which is
    why this multiplies rather than averages. An edge with no confidence
    contributes :data:`NEUTRAL_PRIOR`.
    """
    if not evidence:
        return 0
    product = 1.0
    for record in evidence:
        value = record.get("confidence")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            value = NEUTRAL_PRIOR
        product *= max(0.0, min(1.0, float(value)))
    return js_number(round_to(product, 3))


def facts_to_evidence(facts: Sequence[DatalogFact]) -> list[dict[str, Any]]:
    """Render Datalog inference rows as evidence records."""
    evidence: list[dict[str, Any]] = []
    for fact in facts:
        record: dict[str, Any] = {
            "kind": "datalog",
            "statement": fact.statement,
            "relationship": fact.relation,
        }
        if len(fact.csids) >= 1:
            record["fromCsid"] = fact.csids[0]
        if len(fact.csids) >= 2:
            record["toCsid"] = fact.csids[-1]
        evidence.append(record)
    return evidence


def build_narrative_prompt(
    source: Endpoint,
    target: Endpoint,
    evidence: Sequence[Mapping[str, Any]],
    facts: Sequence[DatalogFact],
    confidence: float,
) -> str:
    """The grounding prompt.

    It hands the model **only** the extracted evidence and forbids anything
    outside it, so the prose cannot outrun the graph. That instruction is the
    honesty guarantee for the case where a path *does* exist but is thin.
    """
    evidence_lines = []
    for index, record in enumerate(evidence):
        parts = [f"{index + 1}. {record['statement']}"]
        value = record.get("confidence")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            parts.append(f"(confidence {to_fixed(float(value), 2)})")
        if record.get("source"):
            parts.append(f"[source: {record['source']}]")
        evidence_lines.append(" ".join(parts))
    fact_lines = [
        f"D{index + 1}. {fact.statement} [inferred: {fact.relation}]"
        for index, fact in enumerate(facts)
    ]

    evidence_block = (
        "\n".join(evidence_lines) if evidence_lines else "(no direct edges)"
    )
    fact_block = (
        f"\n\nInferred (Datalog) facts:\n{chr(10).join(fact_lines)}"
        if fact_lines
        else ""
    )

    return (
        "You are explaining how two cultural/historical entities are connected, "
        "for a curious but careful reader.\n"
        "\n"
        f"Entity A: {source.label()}\n"
        f"Entity B: {target.label()}\n"
        "\n"
        "Below is the ONLY evidence you may use — a chain of relationships drawn "
        "from a knowledge graph, in order from A to B. Do not introduce any fact, "
        "entity, date, or claim that is not present in this evidence. If the "
        "evidence is thin or indirect, say so plainly.\n"
        "\n"
        f"Graph path (A → B):\n{evidence_block}{fact_block}\n"
        "\n"
        f"Aggregate confidence in this connection: {to_fixed(confidence, 2)} "
        "(0 = speculative, 1 = well-attested).\n"
        "\n"
        "Write 2–4 sentences explaining the connection between A and B. Walk the "
        "chain in order. Reference the intermediate steps so the reader can follow "
        "the path. If the aggregate confidence is low (< 0.4), explicitly caveat "
        "that the link is tentative. Do not fabricate. Return prose only — no "
        "preamble, no markdown headings."
    )


def _safe_infer(
    infer: Callable[[str, str], list[DatalogFact]], source: str, target: str
) -> list[DatalogFact]:
    """Run an inference callback, swallowing any failure into ``[]``."""
    try:
        return infer(source, target)
    except Exception:  # noqa: BLE001 - inference is best-effort by contract
        return []


def explain_connection(
    source: Endpoint, target: Endpoint, deps: NarrativeDeps
) -> dict[str, Any]:
    """Explain the connection between two entities.

    With **no path and no inferred fact** the model is not called: the answer is
    a plain, non-AI "no connection found" that is careful to say the absence is
    about the data, not about history.
    """
    path = deps.find_path(source.csid, target.csid)
    facts = (
        _safe_infer(deps.infer_facts, source.csid, target.csid)
        if deps.infer_facts is not None
        else []
    )

    path_evidence = extract_path_evidence(path) if path else []
    evidence = [*path_evidence, *facts_to_evidence(facts)]
    confidence = path_confidence(path_evidence)
    length = int(path["length"]) if path else 0

    if not evidence:
        return {
            "from": source.payload(),
            "to": target.payload(),
            "connected": False,
            "explanation": (
                f"No connection was found between {source.label()} and "
                f"{target.label()} in the shared graph. This does not mean none "
                "exists — only that the current data records no path between them."
            ),
            "evidence": [],
            "confidence": 0,
            "lowConfidence": True,
            "pathLength": 0,
            "aiGenerated": False,
        }

    prompt = build_narrative_prompt(source, target, path_evidence, facts, confidence)
    prose = deps.llm.generate(prompt).strip()

    return {
        "from": source.payload(),
        "to": target.payload(),
        "connected": True,
        "explanation": prose,
        "evidence": evidence,
        "confidence": confidence,
        "lowConfidence": confidence < LOW_CONFIDENCE_THRESHOLD,
        "pathLength": length,
        "aiGenerated": True,
    }


__all__ = [
    "LOW_CONFIDENCE_THRESHOLD",
    "NEUTRAL_PRIOR",
    "DatalogFact",
    "Endpoint",
    "NarrativeDeps",
    "NarrativeLlm",
    "build_narrative_prompt",
    "explain_connection",
    "extract_path_evidence",
    "facts_to_evidence",
    "humanize_relationship",
    "path_confidence",
]
