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

from culturescrape.ontology.metrics import LINGUASCRAPE_SOURCE, read_dataset
from culturescrape.schema.ids import IdError, normalize_name, normalize_qid
from culturescrape.schema.mapper import LINGUASCRAPE_ID_KEY
from culturescrape.schema.tsvio import Row

#: Provenance columns a row must all carry non-empty to count as fully sourced.
PROVENANCE_COLUMNS = ("source", "source_url", "retrieved_at")

#: Filename QA reports are written under in a job's ``qa/`` directory (JSON).
QA_REPORT_SUFFIX = ".qa.json"

#: Filename the human-readable QA report artifact is written under.
QA_REPORT_MD_SUFFIX = ".qa.md"

#: Delimiter :mod:`culturescrape.schema.merge` joins concatenated provenance
#: ``source`` values with, so a reconciled row carries ``"wikidata;linguascrape"``.
_SOURCE_DELIMITER = ";"


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
        min_linguascrape_provenance_completeness: Smallest tolerated fraction of
            LinguaScrape-origin rows still carrying the ``linguascrape`` source
            stamp (defaults to ``1.0`` — merging must never drop it).
        max_linguascrape_duplicate_rate: Largest tolerated post-dedup duplicate
            fraction among LinguaScrape-origin nodes.
        max_linguascrape_dangling_edge_rate: Largest tolerated fraction of
            LinguaScrape-origin edges pointing at an unknown csid.
        max_linguascrape_unreconciled_rate: Largest tolerated fraction of
            LinguaScrape-origin nodes never merged to a graph node (defaults to
            ``1.0`` — informational unless a reconciling run tightens it).
    """

    min_rows: int = 1
    max_duplicate_rate: float = 0.0
    min_provenance_completeness: float = 1.0
    max_dangling_edge_rate: float = 0.0
    max_unreconciled_rate: float = 1.0
    min_linguascrape_provenance_completeness: float = 1.0
    max_linguascrape_duplicate_rate: float = 0.0
    max_linguascrape_dangling_edge_rate: float = 0.0
    max_linguascrape_unreconciled_rate: float = 1.0

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
            min_linguascrape_provenance_completeness=_as_float(
                data,
                "min_linguascrape_provenance_completeness",
                cls.min_linguascrape_provenance_completeness,
            ),
            max_linguascrape_duplicate_rate=_as_float(
                data,
                "max_linguascrape_duplicate_rate",
                cls.max_linguascrape_duplicate_rate,
            ),
            max_linguascrape_dangling_edge_rate=_as_float(
                data,
                "max_linguascrape_dangling_edge_rate",
                cls.max_linguascrape_dangling_edge_rate,
            ),
            max_linguascrape_unreconciled_rate=_as_float(
                data,
                "max_linguascrape_unreconciled_rate",
                cls.max_linguascrape_unreconciled_rate,
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

    def render_markdown(self) -> str:
        """Render the report as a human-readable Markdown QA artifact."""
        status = "✅ ok" if self.ok else f"❌ {len(self.violations)} violation(s)"
        lines = [
            f"# QA report — {self.dataset or 'dataset'}",
            "",
            f"- **Status:** {status}",
            f"- **Nodes:** {self.node_count}",
            f"- **Edges:** {self.edge_count}",
            "",
            "| Gate | Result | Value | Bound | Detail |",
            "| --- | --- | --- | --- | --- |",
        ]
        for gate in self.gates:
            result = "PASS" if gate.passed else "FAIL"
            bound = f"{gate.direction} {_fmt(gate.threshold)}"
            lines.append(
                f"| {gate.label} | {result} | {_fmt(gate.value)} | {bound} "
                f"| {gate.detail} |"
            )
        return "\n".join(lines)

    def write(self, path: str | Path) -> Path:
        """Write the report to *path* as JSON, creating parent directories."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json() + "\n", encoding="utf-8")
        return path

    def write_markdown(self, path: str | Path) -> Path:
        """Write the human-readable Markdown report to *path*."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.render_markdown() + "\n", encoding="utf-8")
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

    When the corpus contains at least one LinguaScrape-origin row, four extra
    gates scoped to those rows are appended (provenance completeness, duplicate
    rate, dangling-edge rate, unreconciled rate) so LinguaScrape ingestion cannot
    silently degrade the merged corpus. A native-only corpus keeps the five base
    gates unchanged.
    """
    node_count = len(nodes)
    edge_count = len(edges)

    gates: tuple[GateResult, ...] = (
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
    gates += _linguascrape_gates(nodes, edges, thresholds)
    return QaReport(
        dataset=dataset,
        node_count=node_count,
        edge_count=edge_count,
        gates=gates,
    )


def _linguascrape_gates(
    nodes: Sequence[Row],
    edges: Sequence[Row],
    thresholds: GateThresholds,
) -> tuple[GateResult, ...]:
    """The LinguaScrape-scoped gates, or ``()`` when the corpus has no LS rows.

    A row is LinguaScrape-origin if it retains a ``linguascrape_id`` alias or a
    ``linguascrape`` token in its (possibly merge-concatenated) ``source``
    provenance. Duplicate/unreconciled gates cover LinguaScrape *nodes*; the
    dangling-edge gate checks LinguaScrape *edges* against **every** node (a
    LinguaScrape edge may legitimately point at a native node); provenance
    completeness covers all LinguaScrape-origin rows.
    """
    ls_nodes = [node for node in nodes if _is_linguascrape(node)]
    ls_edges = [edge for edge in edges if _is_linguascrape(edge)]
    if not ls_nodes and not ls_edges:
        return ()

    ls_count = len(ls_nodes) + len(ls_edges)
    return (
        _gate(
            "linguascrape_provenance_completeness",
            "LinguaScrape provenance completeness",
            _linguascrape_provenance_completeness(ls_nodes, ls_edges),
            thresholds.min_linguascrape_provenance_completeness,
            "min",
            f"{ls_count} LinguaScrape-origin row(s) keeping the source stamp",
        ),
        _gate(
            "linguascrape_duplicate_rate",
            "LinguaScrape duplicate rate (post-dedup)",
            _duplicate_rate(ls_nodes),
            thresholds.max_linguascrape_duplicate_rate,
            "max",
            "LinguaScrape nodes sharing a strong identity key",
        ),
        _gate(
            "linguascrape_dangling_edge_rate",
            "LinguaScrape dangling-edge rate",
            _dangling_edge_rate(nodes, ls_edges),
            thresholds.max_linguascrape_dangling_edge_rate,
            "max",
            "LinguaScrape edges referencing an unknown csid",
        ),
        _gate(
            "linguascrape_unreconciled_rate",
            "LinguaScrape unreconciled-entity rate",
            _unreconciled_rate(ls_nodes),
            thresholds.max_linguascrape_unreconciled_rate,
            "max",
            "LinguaScrape nodes not merged to a graph node",
        ),
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


def _is_linguascrape(row: Row) -> bool:
    """Whether *row* is LinguaScrape-origin (has the alias or the source stamp).

    Identity survives a reconcile merge: the row keeps its ``linguascrape_id``
    alias, and its ``source`` provenance holds the ``linguascrape`` token (joined
    with the native source when both merged). Either signal is enough.
    """
    if _scalar(row, LINGUASCRAPE_ID_KEY):
        return True
    return LINGUASCRAPE_SOURCE in _source_tokens(row)


def _source_tokens(row: Row) -> set[str]:
    """The distinct ``source`` provenance tokens on *row* (merge-split)."""
    source = _scalar(row, "source")
    return {token.strip() for token in source.split(_SOURCE_DELIMITER) if token.strip()}


def _linguascrape_provenance_completeness(
    nodes: Sequence[Row], edges: Sequence[Row]
) -> float:
    """Fraction of LinguaScrape-origin rows keeping the ``linguascrape`` stamp.

    A row identified as LinguaScrape-origin (typically by its surviving
    ``linguascrape_id`` alias) whose ``source`` provenance no longer names
    :data:`~culturescrape.ontology.metrics.LINGUASCRAPE_SOURCE` has lost its
    stamp — the merge dropped its provenance. An empty subset is vacuously
    complete (``1.0``).
    """
    rows = list(nodes) + list(edges)
    if not rows:
        return 1.0
    stamped = sum(1 for row in rows if LINGUASCRAPE_SOURCE in _source_tokens(row))
    return stamped / len(rows)


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
