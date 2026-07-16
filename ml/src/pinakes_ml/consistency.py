"""Logical-consistency checker — the symbolic ratchet (NEUROSYMBOLIC_ROADMAP Phase 2).

The differentiating benefit of the symbolic layer is that a statistical model's
predictions can be *checked against the rules*. This module consumes a predictions
file in the PyKEEN-native triples format (``head\\trelation\\ttail``) and reports
the ways those predicted edges violate the corpus's logical constraints:

* **Descent acyclicity** — ``DESCENDS_FROM`` is a genealogical relation, so its
  graph must be a DAG. A cycle (``A`` descends from ``B`` … descends from ``A``, or a
  self-loop) is logically impossible. This is the ML analogue of the datalog
  ``descends_from`` transitive-closure rule (T-SR-US-001).
* **Canonical-schema type breaches** — every edge type declares the node types
  allowed on each end in the machine-readable ``shared/canonical-schema.json``
  (``edgeTypes[].from`` / ``.to``). A prediction whose endpoints (read off the
  ``cs:<node-type>:<id>`` csid) fall outside those sets is a breach. An empty
  ``from``/``to`` list means "unconstrained" (polymorphic edge — not checked).
* **Asymmetry / inverse violations** — genealogical / derivational relations are
  antisymmetric: ``A r B`` and ``B r A`` cannot both hold, and a self-loop ``A r A``
  is incoherent. (The symmetric relations — ``COGNATE_WITH`` / ``SYNCRETIZED_WITH`` —
  are excluded; both directions are legitimate there.)

Everything here is a **pure** function over an in-memory list of triples (no
wall-clock, no network, no torch), so the CI ratchet recomputes the violation
counts deterministically from a committed predictions file — the same shape as the
``docs/convergence-qa-baseline.json`` drift gate on the TS side. The trained-model
prediction generation (the only torch-touching step) lives in the thin CLI
:mod:`pinakes_ml.check_consistency`.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from pinakes_ml.triples import Triple

# A csid is ``cs:<node-type>:<id>``; the node type is the second colon field
# (``archaeological-culture`` is hyphenated but colon-free, so this is unambiguous).
_CSID_RE = re.compile(r"^cs:([a-z0-9-]+):")

# Symmetric relations store BOTH directions in the canonical corpus, so a
# prediction in one direction logically entails the other — never an asymmetry
# violation. Excluded from the antisymmetric check.
SYMMETRIC_RELATIONS = frozenset({"COGNATE_WITH", "SYNCRETIZED_WITH"})

# Antisymmetric relations: ``A r B`` and ``B r A`` cannot both hold, and ``A r A``
# is incoherent. These are the genealogical / derivational descent relations whose
# Horn rules the symbolic layer materializes.
ANTISYMMETRIC_RELATIONS = frozenset(
    {"DESCENDS_FROM", "SPLIT_FROM", "ABSORBED_INTO", "BORROWED_FROM", "DERIVED_FROM"}
)

# The genealogical relation whose graph must be acyclic (a DAG).
DESCENT_RELATION = "DESCENDS_FROM"

# Bound the samples embedded in a report so it stays small + deterministic.
SAMPLE_LIMIT = 20

# The violation categories, in a fixed order for the doc + ratchet.
VIOLATION_KEYS: tuple[str, ...] = (
    "descentCycles",
    "schemaTypeBreaches",
    "asymmetryViolations",
)


# --- schema constraints -------------------------------------------------------

EdgeConstraint = tuple[frozenset[str] | None, frozenset[str] | None]


def node_type_of(csid: str) -> str | None:
    """Node type in a ``cs:<node-type>:<id>`` csid, or ``None`` if malformed."""
    match = _CSID_RE.match(csid)
    return match.group(1) if match else None


def load_edge_constraints(schema_path: Path | str) -> dict[str, EdgeConstraint]:
    """Map each edge ``:TYPE`` to its ``(from, to)`` allowed node-type sets.

    Read from the machine-readable ``shared/canonical-schema.json``. An empty
    ``from``/``to`` list in the schema means the edge is polymorphic on that end
    (no constraint) and is represented here as ``None`` — such an end is skipped by
    :func:`check_schema_type_breaches`.
    """
    schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    constraints: dict[str, EdgeConstraint] = {}
    for edge in schema.get("edgeTypes", []):
        rel = edge["type"]
        from_types = edge.get("from") or []
        to_types = edge.get("to") or []
        constraints[rel] = (
            frozenset(from_types) if from_types else None,
            frozenset(to_types) if to_types else None,
        )
    return constraints


# --- individual checks --------------------------------------------------------


def check_schema_type_breaches(
    triples: list[Triple], constraints: dict[str, EdgeConstraint]
) -> list[dict[str, str]]:
    """Predictions whose endpoint node types violate the schema ``from``/``to`` sets.

    Relations absent from the schema, or with an unconstrained end (``None``), are
    not checked on that end. A malformed csid (no parseable node type) against a
    constrained end counts as a breach (the endpoint provably isn't an allowed type).
    """
    breaches: list[dict[str, str]] = []
    for t in triples:
        constraint = constraints.get(t.relation)
        if constraint is None:
            continue
        from_types, to_types = constraint
        head_type = node_type_of(t.head)
        tail_type = node_type_of(t.tail)
        if from_types is not None and head_type not in from_types:
            breaches.append(
                {"triple": t.as_row(), "end": "from", "type": head_type or "?"}
            )
        if to_types is not None and tail_type not in to_types:
            breaches.append(
                {"triple": t.as_row(), "end": "to", "type": tail_type or "?"}
            )
    return breaches


def _strongly_connected_components(
    adjacency: dict[str, list[str]],
) -> list[list[str]]:
    """Tarjan's SCC (iterative), deterministic node order — no recursion limit."""
    index_of: dict[str, int] = {}
    low_of: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    result: list[list[str]] = []
    counter = 0

    nodes = sorted(adjacency)
    for root in nodes:
        if root in index_of:
            continue
        # Explicit DFS stack of (node, next-neighbour-index).
        work: list[tuple[str, int]] = [(root, 0)]
        while work:
            node, next_i = work[-1]
            if next_i == 0:
                index_of[node] = low_of[node] = counter
                counter += 1
                stack.append(node)
                on_stack.add(node)
            neighbours = adjacency.get(node, ())
            if next_i < len(neighbours):
                work[-1] = (node, next_i + 1)
                nxt = neighbours[next_i]
                if nxt not in index_of:
                    work.append((nxt, 0))
                elif nxt in on_stack:
                    low_of[node] = min(low_of[node], index_of[nxt])
            else:
                if low_of[node] == index_of[node]:
                    component: list[str] = []
                    while True:
                        w = stack.pop()
                        on_stack.discard(w)
                        component.append(w)
                        if w == node:
                            break
                    result.append(sorted(component))
                work.pop()
                if work:
                    parent = work[-1][0]
                    low_of[parent] = min(low_of[parent], low_of[node])
    return result


def check_descent_cycles(triples: list[Triple]) -> list[list[str]]:
    """Cycles in the ``DESCENDS_FROM`` graph (``head`` descends from ``tail``).

    Returns each cycle as a sorted list of node ids. A self-loop (``A`` descends
    from ``A``) is a length-1 cycle; a mutual/longer cycle is an SCC of size > 1.
    Sorted output ⇒ deterministic.
    """
    adjacency: dict[str, list[str]] = defaultdict(list)
    self_loops: set[str] = set()
    for t in triples:
        if t.relation != DESCENT_RELATION:
            continue
        if t.head == t.tail:
            self_loops.add(t.head)
        adjacency[t.head].append(t.tail)
    for node in adjacency:
        adjacency[node] = sorted(adjacency[node])

    cycles: list[list[str]] = []
    for component in _strongly_connected_components(adjacency):
        if len(component) > 1 or component[0] in self_loops:
            cycles.append(component)
    return sorted(cycles)


def check_asymmetry_violations(triples: list[Triple]) -> list[dict[str, str]]:
    """Antisymmetric relations predicted in both directions (or as a self-loop).

    For a relation in :data:`ANTISYMMETRIC_RELATIONS`, a self-loop ``A r A`` or a
    mutual pair (``A r B`` and ``B r A``) is a logical violation. Each mutual pair
    is reported once (canonicalised on the sorted endpoint order).
    """
    present: set[tuple[str, str, str]] = {
        (t.relation, t.head, t.tail)
        for t in triples
        if t.relation in ANTISYMMETRIC_RELATIONS
    }
    violations: list[dict[str, str]] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    for rel, head, tail in sorted(present):
        if head == tail:
            violations.append({"relation": rel, "a": head, "b": tail, "kind": "self"})
            continue
        if (rel, tail, head) in present:
            key = (rel, *sorted((head, tail)))
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            violations.append(
                {"relation": rel, "a": key[1], "b": key[2], "kind": "mutual"}
            )
    return violations


# --- report -------------------------------------------------------------------


@dataclass
class ConsistencyReport:
    """Violation counts (+ bounded samples) for one model's predictions."""

    model: str
    num_predictions: int
    counts: dict[str, int]
    samples: dict[str, list]

    def as_dict(self) -> dict[str, object]:
        return {
            "model": self.model,
            "numPredictions": self.num_predictions,
            "counts": dict(self.counts),
            "samples": self.samples,
        }


def evaluate_consistency(
    model: str,
    triples: list[Triple],
    constraints: dict[str, EdgeConstraint],
) -> ConsistencyReport:
    """Run all three checks over one model's predictions and package the counts."""
    cycles = check_descent_cycles(triples)
    breaches = check_schema_type_breaches(triples, constraints)
    asymmetry = check_asymmetry_violations(triples)
    counts = {
        "descentCycles": len(cycles),
        "schemaTypeBreaches": len(breaches),
        "asymmetryViolations": len(asymmetry),
    }
    samples = {
        "descentCycles": cycles[:SAMPLE_LIMIT],
        "schemaTypeBreaches": breaches[:SAMPLE_LIMIT],
        "asymmetryViolations": asymmetry[:SAMPLE_LIMIT],
    }
    return ConsistencyReport(
        model=model,
        num_predictions=len(triples),
        counts=counts,
        samples=samples,
    )


# --- predictions I/O ----------------------------------------------------------


def parse_predictions(path: Path | str) -> list[Triple]:
    """Parse a PyKEEN-native ``head\\trelation\\ttail`` predictions TSV (no header)."""
    out: list[Triple] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        cols = line.split("\t")
        if len(cols) != 3:
            raise ValueError(f"{path}: expected 3 columns, got {len(cols)}: {line!r}")
        head, rel, tail = cols
        out.append(Triple(relation=rel, head=head, tail=tail))
    return out


def render_predictions(triples: list[Triple]) -> str:
    """Serialize predictions to the PyKEEN-native TSV (sorted, trailing newline)."""
    rows = [t.as_row() for t in sorted(triples)]
    return ("\n".join(rows) + "\n") if rows else ""


# --- ratchet ------------------------------------------------------------------


def build_baseline(reports: list[ConsistencyReport]) -> dict[str, object]:
    """Committed ratchet baseline: per-model max-allowed violation counts.

    Mirrors ``docs/convergence-qa-baseline.json`` — a monotone gate: a later run
    may hold or lower any count, never exceed it without a deliberate re-baseline.
    """
    return {
        "//": (
            "Logical-consistency ratchet baseline (ml US-005). A monotone gate over "
            "the committed PyKEEN baseline predictions (ml/predictions/<model>.tsv): "
            "descent-cycle / canonical-schema-type / antisymmetry violation counts "
            "may hold or lower, never exceed, without a deliberate re-baseline. "
            "Regenerate: uv run pinakes-check-consistency --write-baseline"
        ),
        "models": {
            report.model.lower(): dict(report.counts)
            for report in sorted(reports, key=lambda r: r.model.lower())
        },
    }


def compare_to_baseline(
    reports: list[ConsistencyReport], baseline: dict[str, object]
) -> list[dict[str, object]]:
    """Regressions vs the committed baseline (empty ⇒ ratchet green).

    A regression is any model/category whose fresh count exceeds the baseline, or a
    model present in the fresh reports but missing from the baseline (an un-ratcheted
    model — must be added by a deliberate re-baseline).
    """
    baseline_models = baseline.get("models", {})
    assert isinstance(baseline_models, dict)
    regressions: list[dict[str, object]] = []
    for report in reports:
        key = report.model.lower()
        base_counts = baseline_models.get(key)
        if base_counts is None:
            regressions.append({"model": key, "reason": "not-in-baseline"})
            continue
        for category, count in report.counts.items():
            allowed = int(base_counts.get(category, 0))
            if count > allowed:
                regressions.append(
                    {
                        "model": key,
                        "category": category,
                        "count": count,
                        "baseline": allowed,
                    }
                )
    return regressions
