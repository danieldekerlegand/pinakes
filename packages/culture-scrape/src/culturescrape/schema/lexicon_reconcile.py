"""Reconcile an acquired corpus of nodes against an existing LinguaScrape lexicon.

A domain expansion (e.g. the civilizations pilot, ``docs/prd`` §15) acquires many
rows from Wikidata and must fold them into the corpus **without duplicating** the
entities LinguaScrape already curates in ``lexicons/<domain>.tsv``. The decision
logic is :func:`reconcile_linguascrape`'s offline cascade — language code, then
exact ``(name, type, region)``, then fuzzy name — which classifies every acquired
row *matched* (already curated → merge, keep provenance), *new* (stands as its own
node), or *ambiguous* (rival curated rows → never auto-merged, held for triage).

This module is the thin data layer around that cascade: two loaders (a canonical
node TSV produced by ``culturescrape run``; a raw ``lexicons/*.tsv`` file) and a
serialisable :class:`ReconciliationSummary` (counts + bounded samples) suitable for
a committed report. It adds no matching logic of its own.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .ids import mint_csid
from .mapper import OVERFLOW_KEY
from .reconcile import (
    LocalOutcome,
    LocalReconciliationReport,
    reconcile_linguascrape,
)
from .tsvio import Row

#: The delimiter for the canonical/lexicon TSV family.
DELIMITER = "\t"

#: How many rows of each outcome to keep in a summary's bounded sample lists.
DEFAULT_SAMPLE = 25

#: Fuzzy-name threshold for cross-source (Wikidata → lexicon) matching. Stricter
#: than :data:`reconcile.DEFAULT_LOCAL_FUZZY_THRESHOLD` (0.85) because a *wrong*
#: merge silently corrupts a curated node, whereas a missed match merely surfaces
#: a duplicate for human triage — so borderline names (``German Empire`` vs
#: ``Roman Empire``, 0.88) are kept apart as ``new`` rather than wrongly merged.
DEFAULT_CROSS_SOURCE_FUZZY = 0.93


def _strip_header(cell: str) -> str:
    """The canonical field name for a Neo4j-import header cell.

    ``csid:ID`` → ``csid``; ``confidence:float`` → ``confidence``; a structural
    cell (``:LABEL``) is kept verbatim; an untyped cell (``name``) is unchanged.
    """
    if cell.startswith(":"):
        return cell
    name, _, _suffix = cell.partition(":")
    return name


def read_corpus_nodes(path: Path) -> list[Row]:
    """Load a canonical node TSV (``<corpus>/nodes/<type>.tsv``) as reconciler rows.

    Each row's ``:LABEL`` is wrapped in a list (the shape the cascade reads) and
    every other cell is carried as a plain string; empty cells are dropped so the
    blocking keys see ``""`` uniformly. Raises ``FileNotFoundError`` if absent.
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    fields = [_strip_header(cell) for cell in lines[0].split(DELIMITER)]
    rows: list[Row] = []
    for line in lines[1:]:
        if not line:
            continue
        cells = line.split(DELIMITER)
        row: Row = {}
        for name, value in zip(fields, cells, strict=False):
            if value == "":
                continue
            # The overflow column carries the stitch's merge-provenance JSON; the
            # offline cascade never needs it and its raw cell is not re-parseable
            # in isolation, so drop it rather than feed the reconciler bad JSON.
            if name == OVERFLOW_KEY:
                continue
            if name == ":LABEL":
                row[":LABEL"] = value.split(";") if value else []
            else:
                row[name] = value
        rows.append(row)
    return rows


def read_lexicon_nodes(
    path: Path,
    *,
    label: str,
    node_type: str,
    name_column: str = "name",
    id_column: str = "id",
    region_column: str | None = None,
) -> list[Row]:
    """Load a raw ``lexicons/*.tsv`` file as existing-corpus reconciler rows.

    Mints a QID-free ``csid`` from the row's name (``cs:<node_type>:<slug>``) so
    the existing rows carry the identity anchor the merge keeps, tags every row
    with the canonical *label*, and — when *region_column* is given and present —
    supplies the region blocking key via the row's overflow JSON (the canonical
    schema has no dedicated ``region`` column).
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = lines[0].split(DELIMITER)
    idx = {col: i for i, col in enumerate(header)}
    if name_column not in idx:
        raise ValueError(f"{path}: no {name_column!r} column in header")
    rows: list[Row] = []
    for line in lines[1:]:
        if not line:
            continue
        cells = line.split(DELIMITER)
        name = _cell_at(cells, idx, name_column)
        if not name:
            continue
        local_id = _cell_at(cells, idx, id_column)
        csid = (
            mint_csid(node_type, alias=local_id)
            if local_id
            else mint_csid(node_type, name=name)
        )
        row: Row = {
            "csid": csid,
            ":LABEL": [label],
            "name": name,
        }
        region = _cell_at(cells, idx, region_column) if region_column else ""
        if region:
            row[OVERFLOW_KEY] = json.dumps({"region": region})
        rows.append(row)
    return rows


def _cell_at(cells: list[str], idx: dict[str, int], col: str) -> str:
    """The stripped value of column *col* in *cells*, or ``""`` when absent."""
    i = idx.get(col, -1)
    return cells[i].strip() if 0 <= i < len(cells) else ""


@dataclass(frozen=True)
class OutcomeSample:
    """One acquired row's reconciliation decision (for a report's sample list)."""

    csid: str
    name: str
    matched_csid: str | None = None
    confidence: float = 0.0


@dataclass(frozen=True)
class ReconciliationSummary:
    """A serialisable roll-up of a domain reconciliation.

    ``union_distinct`` is the deduplicated size of ``existing ∪ acquired``: every
    existing row, plus each acquired *new* row (matched rows collapse onto their
    existing node; ambiguous rows are withheld, not counted as distinct).
    """

    domain: str
    incoming_total: int
    existing_total: int
    matched: int
    new: int
    ambiguous: int
    union_distinct: int
    matched_samples: list[OutcomeSample] = field(default_factory=list)
    new_samples: list[OutcomeSample] = field(default_factory=list)
    ambiguous_samples: list[OutcomeSample] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        """A JSON-serialisable mapping (dataclass tree → primitives)."""
        return asdict(self)


def summarize(
    report: LocalReconciliationReport,
    *,
    domain: str,
    existing_total: int,
    sample: int = DEFAULT_SAMPLE,
) -> ReconciliationSummary:
    """Roll a :class:`LocalReconciliationReport` up into a bounded summary."""
    matched: list[OutcomeSample] = []
    new: list[OutcomeSample] = []
    ambiguous: list[OutcomeSample] = []
    for result in report.results:
        item = OutcomeSample(
            csid=result.csid,
            name=result.name,
            matched_csid=result.matched_csid,
            confidence=round(result.confidence, 4),
        )
        if result.outcome is LocalOutcome.MATCHED:
            matched.append(item)
        elif result.outcome is LocalOutcome.AMBIGUOUS:
            ambiguous.append(item)
        else:
            new.append(item)
    return ReconciliationSummary(
        domain=domain,
        incoming_total=len(report.results),
        existing_total=existing_total,
        matched=len(matched),
        new=len(new),
        ambiguous=len(ambiguous),
        union_distinct=existing_total + len(new),
        matched_samples=sorted(matched, key=lambda s: s.name)[:sample],
        new_samples=sorted(new, key=lambda s: s.name)[:sample],
        ambiguous_samples=sorted(ambiguous, key=lambda s: s.name)[:sample],
    )


def render_markdown(summary: ReconciliationSummary) -> str:
    """A human-readable Markdown report for *summary* (committed pilot artifact)."""
    s = summary
    lines = [
        f"# Reconciliation report — {s.domain}",
        "",
        "Offline cascade (`reconcile_linguascrape`): each acquired row classified "
        "against the existing curated lexicon by language code → exact "
        "`(name, type, region)` → fuzzy name. Ambiguous rows are **never** "
        "auto-merged.",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| acquired (incoming) | {s.incoming_total} |",
        f"| existing (lexicon) | {s.existing_total} |",
        f"| matched (already curated) | {s.matched} |",
        f"| new (candidates to add) | {s.new} |",
        f"| ambiguous (held for triage) | {s.ambiguous} |",
        f"| **union distinct** | **{s.union_distinct}** |",
        "",
    ]

    def _table(title: str, samples: list[OutcomeSample], *, matched: bool) -> None:
        lines.append(f"## {title} (first {len(samples)})")
        lines.append("")
        if not samples:
            lines.append("_none_")
            lines.append("")
            return
        if matched:
            lines.append("| name | matched csid | confidence |")
            lines.append("| --- | --- | --- |")
            for s2 in samples:
                lines.append(
                    f"| {s2.name} | {s2.matched_csid or ''} | {s2.confidence} |"
                )
        else:
            lines.append("| name | csid |")
            lines.append("| --- | --- |")
            for s2 in samples:
                lines.append(f"| {s2.name} | {s2.csid} |")
        lines.append("")

    _table("Matched", s.matched_samples, matched=True)
    _table("Ambiguous", s.ambiguous_samples, matched=True)
    _table("New", s.new_samples, matched=False)
    return "\n".join(lines) + "\n"


def reconcile_corpus_against_lexicon(
    corpus_nodes: Path,
    lexicon_tsv: Path,
    *,
    domain: str,
    label: str,
    node_type: str,
    region_column: str | None = None,
    fuzzy_threshold: float = DEFAULT_CROSS_SOURCE_FUZZY,
    sample: int = DEFAULT_SAMPLE,
) -> tuple[LocalReconciliationReport, ReconciliationSummary]:
    """Load both sides, run the offline cascade, and summarise the outcome.

    Returns the full :class:`LocalReconciliationReport` (per-row decisions +
    load-safe merged rows) alongside the bounded :class:`ReconciliationSummary`.
    """
    incoming = read_corpus_nodes(corpus_nodes)
    existing = read_lexicon_nodes(
        lexicon_tsv,
        label=label,
        node_type=node_type,
        region_column=region_column,
    )
    report = reconcile_linguascrape(
        incoming, existing, fuzzy_threshold=fuzzy_threshold
    )
    summary = summarize(
        report, domain=domain, existing_total=len(existing), sample=sample
    )
    return report, summary
