"""Quality gates that flag a low-quality scrape before it pollutes the graph.

A category's dataset can be structurally valid (every TSV parses, every csid is
unique — :mod:`culturescrape.schema.validate`) yet still be a *bad* scrape: too
few rows to be the category it claims, duplicates the dedup pass should have
collapsed, facts with no traceable source, edges pointing at nothing, or
entities never reconciled to an external authority. Validation rejects malformed
files; QA grades the *content*.

This module measures five gates over a normalized (or linked) dataset directory
laid out as ``nodes/<type>.tsv`` / ``edges/<type>.tsv``:

* **row count** — node count against a configurable minimum (``min_rows``);
* **duplicate rate** — fraction of nodes that still share a strong identity
  signal (same ``wikidata_qid``, ``getty_id``, or normalized
  ``(name, lang, label)``) *after* dedup, against ``max_duplicate_rate``;
* **provenance completeness** — fraction of rows carrying a full provenance
  trail (``source`` + ``source_url`` + ``retrieved_at``), against
  ``min_provenance_completeness``;
* **dangling-edge rate** — fraction of edges whose endpoint names a csid no node
  defines, against ``max_dangling_edge_rate``;
* **unreconciled-entity rate** — fraction of nodes with neither a Wikidata QID
  nor a Getty id, against ``max_unreconciled_rate``.

Each gate has a configurable threshold (:class:`GateThresholds`); a gate whose
measured value crosses its threshold is a *violation*. :func:`evaluate` does the
arithmetic on already-read rows and :func:`evaluate_directory` reads a directory;
both return a :class:`QaReport`. The report renders to JSON (machine view, one
file per job) and to a printed summary (human view). A :class:`QaPolicy` bundles
the thresholds with the decision of whether a violation should *fail* the run or
merely be reported.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from culturescrape.ontology.metrics import read_dataset
from culturescrape.schema.ids import IdError, normalize_name, normalize_qid
from culturescrape.schema.tsvio import Row

#: Provenance columns a row must all carry non-empty to count as fully sourced.
PROVENANCE_COLUMNS = ("source", "source_url", "retrieved_at")

#: Filename QA reports are written under in a job's ``qa/`` directory.
QA_REPORT_SUFFIX = ".qa.json"


@dataclass(frozen=True)
class GateThresholds:
    """The configurable bound for each quality gate.

    Defaults describe a *healthy* offline scrape: enough rows to be non-empty,
    no residual duplicates, every fact fully sourced, and no dangling edges. The
    unreconciled bound defaults to ``1.0`` (permissive) because the default
    pipeline run is offline and reconciles nothing — tighten it for runs that
    reconcile to Wikidata/Getty.

    Attributes:
        min_rows: Fewest nodes the dataset must hold.
        max_duplicate_rate: Largest tolerated post-dedup duplicate fraction.
        min_provenance_completeness: Smallest tolerated fraction of fully
            sourced rows.
        max_dangling_edge_rate: Largest tolerated fraction of dangling edges.
        max_unreconciled_rate: Largest tolerated fraction of unreconciled nodes.
    """

    min_rows: int = 1
    max_duplicate_rate: float = 0.0
    min_provenance_completeness: float = 1.0
    max_dangling_edge_rate: float = 0.0
    max_unreconciled_rate: float = 1.0

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> GateThresholds:
        """Build thresholds from a mapping, falling back to each default.

        Unknown keys are ignored and missing keys keep their default, so a
        partial override (e.g. only ``min_rows``) is valid. Raises
        :class:`ValueError` if a present value is not a number.
        """
        return cls(
            min_rows=_as_int(data, "min_rows", cls.min_rows),
            max_duplicate_rate=_as_float(
                data, "max_duplicate_rate", cls.max_duplicate_rate
            ),
            min_provenance_completeness=_as_float(
                data, "min_provenance_completeness", cls.min_provenance_completeness
            ),
            max_dangling_edge_rate=_as_float(
                data, "max_dangling_edge_rate", cls.max_dangling_edge_rate
            ),
            max_unreconciled_rate=_as_float(
                data, "max_unreconciled_rate", cls.max_unreconciled_rate
            ),
        )


#: The default gate bounds, reused as the default argument to :func:`evaluate`.
DEFAULT_THRESHOLDS = GateThresholds()


@dataclass(frozen=True)
class GateResult:
    """The outcome of one quality gate.

    Attributes:
        key: Stable gate id (e.g. ``duplicate_rate``).
        label: Human-readable gate name.
        value: The measured value (a rate in ``0..1`` or a count).
        threshold: The bound the value is checked against.
        direction: ``"min"`` if ``value`` must be ``>= threshold`` to pass,
            ``"max"`` if it must be ``<= threshold``.
        passed: Whether the gate held.
        detail: A short human gloss of what was measured.
    """

    key: str
    label: str
    value: float
    threshold: float
    direction: str
    passed: bool
    detail: str

    def to_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "label": self.label,
            "value": self.value,
            "threshold": self.threshold,
            "direction": self.direction,
            "passed": self.passed,
            "detail": self.detail,
        }

    def render(self) -> str:
        """One-line ``PASS``/``FAIL`` summary with the value and bound."""
        status = "PASS" if self.passed else "FAIL"
        bound = "min" if self.direction == "min" else "max"
        return (
            f"[{status}] {self.label}: {_fmt(self.value)} "
            f"({bound} {_fmt(self.threshold)}) — {self.detail}"
        )


@dataclass(frozen=True)
class QaReport:
    """The full QA verdict for one dataset.

    Attributes:
        dataset: The dataset directory the gates were measured over.
        node_count: Nodes considered.
        edge_count: Edges considered.
        gates: One :class:`GateResult` per gate, in declaration order.
    """

    dataset: str
    node_count: int
    edge_count: int
    gates: tuple[GateResult, ...]

    @property
    def ok(self) -> bool:
        """Whether every gate passed."""
        return all(gate.passed for gate in self.gates)

    @property
    def violations(self) -> tuple[GateResult, ...]:
        """The gates that failed, in declaration order."""
        return tuple(gate for gate in self.gates if not gate.passed)

    def to_dict(self) -> dict[str, object]:
        return {
            "dataset": self.dataset,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "ok": self.ok,
            "gates": [gate.to_dict() for gate in self.gates],
        }

    def to_json(self) -> str:
        """Render the report as stable, indented JSON."""
        return json.dumps(self.to_dict(), indent=2, sort_keys=False)

    def render_summary(self) -> str:
        """Render the report as a short, human-readable multi-line summary."""
        status = "ok" if self.ok else f"{len(self.violations)} violation(s)"
        lines = [
            f"QA {self.dataset}: {status} "
            f"({self.node_count} node(s), {self.edge_count} edge(s))"
        ]
        lines.extend(f"  {gate.render()}" for gate in self.gates)
        return "\n".join(lines)

    def write(self, path: str | Path) -> Path:
        """Write the report to *path* as JSON, creating parent directories."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json() + "\n", encoding="utf-8")
        return path


@dataclass(frozen=True)
class QaPolicy:
    """How a job applies QA: the thresholds and whether a violation fails it.

    Attributes:
        thresholds: The bound for each gate.
        fail_on_violation: When ``True`` a violating dataset fails its category;
            when ``False`` the report is still written and logged but the run
            proceeds (the default — flag, don't block).
    """

    thresholds: GateThresholds = DEFAULT_THRESHOLDS
    fail_on_violation: bool = False


def evaluate(
    nodes: Sequence[Row],
    edges: Sequence[Row],
    thresholds: GateThresholds = DEFAULT_THRESHOLDS,
    *,
    dataset: str = "",
) -> QaReport:
    """Grade *nodes* and *edges* against *thresholds* (read-only).

    Rates are fractions in ``0..1``; an empty input yields a vacuous rate of
    ``0.0`` (and full provenance completeness of ``1.0``), so the row-count gate
    is what catches an empty dataset.
    """
    node_count = len(nodes)
    edge_count = len(edges)

    gates = (
        _gate(
            "row_count",
            "row count",
            float(node_count),
            float(thresholds.min_rows),
            "min",
            f"{node_count} node(s)",
        ),
        _gate(
            "duplicate_rate",
            "duplicate rate (post-dedup)",
            _duplicate_rate(nodes),
            thresholds.max_duplicate_rate,
            "max",
            "nodes sharing a strong identity key",
        ),
        _gate(
            "provenance_completeness",
            "provenance completeness",
            _provenance_completeness(nodes, edges),
            thresholds.min_provenance_completeness,
            "min",
            f"rows with {'+'.join(PROVENANCE_COLUMNS)}",
        ),
        _gate(
            "dangling_edge_rate",
            "dangling-edge rate",
            _dangling_edge_rate(nodes, edges),
            thresholds.max_dangling_edge_rate,
            "max",
            "edges referencing an unknown csid",
        ),
        _gate(
            "unreconciled_rate",
            "unreconciled-entity rate",
            _unreconciled_rate(nodes),
            thresholds.max_unreconciled_rate,
            "max",
            "nodes with no wikidata_qid or getty_id",
        ),
    )
    return QaReport(
        dataset=dataset,
        node_count=node_count,
        edge_count=edge_count,
        gates=gates,
    )


def evaluate_directory(
    directory: str | Path, thresholds: GateThresholds = DEFAULT_THRESHOLDS
) -> QaReport:
    """Read the dataset under *directory* and grade it against *thresholds*."""
    directory = Path(directory)
    nodes, edges = read_dataset(directory)
    return evaluate(nodes, edges, thresholds, dataset=str(directory))


def _gate(
    key: str,
    label: str,
    value: float,
    threshold: float,
    direction: str,
    detail: str,
) -> GateResult:
    """Build a :class:`GateResult`, deciding pass/fail by *direction*."""
    passed = value >= threshold if direction == "min" else value <= threshold
    return GateResult(
        key=key,
        label=label,
        value=value,
        threshold=threshold,
        direction=direction,
        passed=passed,
        detail=detail,
    )


def _duplicate_rate(nodes: Sequence[Row]) -> float:
    """Fraction of nodes that are redundant copies under a strong identity key.

    Each node is reduced to its strongest available identity signal —
    ``wikidata_qid``, then ``getty_id``, then normalized ``(name, lang, label)``
    (the same precedence dedup uses, ``docs/data-model.md``). Any key shared by
    *n* nodes contributes ``n - 1`` duplicates; the rate is duplicates over
    nodes. Dedup should drive this to ``0``.
    """
    if not nodes:
        return 0.0
    counts: Counter[tuple[str, ...]] = Counter(_identity_key(node) for node in nodes)
    duplicates = sum(count - 1 for count in counts.values())
    return duplicates / len(nodes)


def _identity_key(node: Row) -> tuple[str, ...]:
    """The strongest identity key for *node* (qid > getty > name tuple)."""
    qid = _scalar(node, "wikidata_qid")
    if qid:
        try:
            return ("qid", normalize_qid(qid))
        except IdError:
            return ("qid", qid)
    getty = _scalar(node, "getty_id")
    if getty:
        return ("getty", getty)
    label = _first_label(node)
    return ("name", normalize_name(_scalar(node, "name")), _scalar(node, "lang"), label)


def _provenance_completeness(nodes: Sequence[Row], edges: Sequence[Row]) -> float:
    """Fraction of all rows carrying every column in :data:`PROVENANCE_COLUMNS`."""
    rows = list(nodes) + list(edges)
    if not rows:
        return 1.0
    complete = sum(
        1
        for row in rows
        if all(_scalar(row, column) for column in PROVENANCE_COLUMNS)
    )
    return complete / len(rows)


def _dangling_edge_rate(nodes: Sequence[Row], edges: Sequence[Row]) -> float:
    """Fraction of edges whose ``:START_ID`` or ``:END_ID`` names no known node."""
    if not edges:
        return 0.0
    known = {csid for node in nodes if (csid := _scalar(node, "csid"))}
    dangling = sum(
        1
        for edge in edges
        if _scalar(edge, ":START_ID") not in known
        or _scalar(edge, ":END_ID") not in known
    )
    return dangling / len(edges)


def _unreconciled_rate(nodes: Sequence[Row]) -> float:
    """Fraction of nodes carrying neither a ``wikidata_qid`` nor a ``getty_id``."""
    if not nodes:
        return 0.0
    unreconciled = sum(
        1
        for node in nodes
        if not _scalar(node, "wikidata_qid") and not _scalar(node, "getty_id")
    )
    return unreconciled / len(nodes)


def _first_label(node: Row) -> str:
    """The node's first ``:LABEL`` value, used to scope a name-based identity."""
    value = node.get(":LABEL")
    if isinstance(value, list):
        return value[0] if value else ""
    return value if isinstance(value, str) else ""


def _scalar(row: Row, key: str) -> str:
    """The scalar value at *key*, stripped (a multi-value list is not scalar)."""
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


def _fmt(value: float) -> str:
    """Format a gate value: an integer as-is, a rate to three decimals."""
    if value == int(value):
        return str(int(value))
    return f"{value:.3f}"


def _as_int(data: dict[str, object], key: str, default: int) -> int:
    if key not in data:
        return default
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"QA threshold {key!r} must be an integer, got {value!r}")
    return value


def _as_float(data: dict[str, object], key: str, default: float) -> float:
    if key not in data:
        return default
    value = data[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"QA threshold {key!r} must be a number, got {value!r}")
    return float(value)
