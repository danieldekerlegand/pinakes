"""Reconcile the Glottolog languoid corpus against ``lexicons/languages.tsv``.

Glottolog is the authoritative language-identity source, so a languoid it ingests
often already exists in pinakes's curated lexicon. This module classifies each
Glottolog node against the existing languages by a **two-key cascade** —
**glottocode first** (Glottolog's own primary identifier, carried on the node as
``language_code``), then **ISO 639-3** (the languoid's ``ISO639P3code``, kept in the
node overflow) — so a match is found whichever identifier the lexicon row happens to
carry. A code shared by more than one lexicon row is **ambiguous** (held for triage,
never auto-merged); a languoid whose glottocode *and* ISO both miss is **new**.

The matching (:func:`reconcile_glottolog`) is pure and offline — no network, no live
graph — so it is unit-tested directly on in-memory rows. The driver
``scripts/reconcile_glottolog.py`` is only path-wiring + I/O, and reuses the shared
:class:`~culturescrape.schema.lexicon_reconcile.ReconciliationSummary` report shape
so a Glottolog report reads like the civilizations pilot's.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .ids import mint_csid
from .lexicon_reconcile import DEFAULT_SAMPLE, OutcomeSample, ReconciliationSummary

DELIMITER = "\t"

#: Canonical node type of both sides (Glottolog languoids and lexicon languages).
LANGUAGE_TYPE = "language"

#: Node overflow column holding the unmapped CLDF columns (incl. ``ISO639P3code``).
OVERFLOW_COLUMN = "extra"

#: CLDF column carrying the languoid's ISO 639-3 code (rides in the overflow JSON).
ISO_OVERFLOW_KEY = "ISO639P3code"

#: Sample confidences distinguishing the cascade tier a match came from.
GLOTTOCODE_CONFIDENCE = 1.0
ISO_CONFIDENCE = 0.95


@dataclass(frozen=True)
class GlottologNode:
    """A Glottolog corpus node reduced to its reconciliation keys."""

    csid: str
    name: str
    glottocode: str
    iso: str


@dataclass(frozen=True)
class LexiconLanguage:
    """An existing ``languages.tsv`` row reduced to its reconciliation keys."""

    csid: str
    name: str
    glottocode: str
    iso: str


def _strip_header(cell: str) -> str:
    """Canonical field name for a Neo4j-import header cell (``csid:ID`` → ``csid``)."""
    if cell.startswith(":"):
        return cell
    name, _, _suffix = cell.partition(":")
    return name


def _cell(cells: list[str], idx: dict[str, int], column: str) -> str:
    """The stripped value of *column* in *cells*, or ``""`` when absent."""
    i = idx.get(column, -1)
    return cells[i].strip() if 0 <= i < len(cells) else ""


def _iso_from_overflow(cell: str) -> str:
    """Pull the ISO 639-3 code out of a node's overflow JSON (``""`` when absent)."""
    if not cell:
        return ""
    try:
        data = json.loads(cell)
    except json.JSONDecodeError:
        return ""
    if not isinstance(data, dict):
        return ""
    value = data.get(ISO_OVERFLOW_KEY, "")
    return str(value) if value else ""


def read_glottolog_nodes(path: Path) -> list[GlottologNode]:
    """Load a built Glottolog ``corpus/nodes/language.tsv`` as reconciliation nodes.

    Reads ``language_code`` (the glottocode) directly and lifts ``ISO639P3code`` out
    of the overflow JSON. Both keys are casefolded so the join is case-insensitive.
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = [_strip_header(c) for c in lines[0].split(DELIMITER)]
    idx = {name: i for i, name in enumerate(header)}
    nodes: list[GlottologNode] = []
    for line in lines[1:]:
        if not line:
            continue
        cells = line.split(DELIMITER)
        name = _cell(cells, idx, "name")
        if not name:
            continue
        nodes.append(
            GlottologNode(
                csid=_cell(cells, idx, "csid"),
                name=name,
                glottocode=_cell(cells, idx, "language_code").casefold(),
                iso=_iso_from_overflow(_cell(cells, idx, OVERFLOW_COLUMN)).casefold(),
            )
        )
    return nodes


def read_language_lexicon(
    path: Path,
    *,
    name_column: str = "name",
    id_column: str = "id",
    glottocode_column: str = "glottocode",
    iso_column: str = "iso639_2",
) -> list[LexiconLanguage]:
    """Load ``lexicons/languages.tsv`` as the existing side of the reconciliation.

    Mints an alias-anchored ``csid`` from each row's ``id`` (falling back to the
    name) so a matched Glottolog node points at a stable lexicon identity, and reads
    the ``glottocode`` / ``iso639_2`` (ISO 639-3) blocking keys (casefolded).
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = lines[0].split(DELIMITER)
    idx = {col: i for i, col in enumerate(header)}
    if name_column not in idx:
        raise ValueError(f"{path}: no {name_column!r} column in header")
    languages: list[LexiconLanguage] = []
    for line in lines[1:]:
        if not line:
            continue
        cells = line.split(DELIMITER)
        name = _cell(cells, idx, name_column)
        if not name:
            continue
        row_id = _cell(cells, idx, id_column)
        csid = (
            mint_csid(LANGUAGE_TYPE, alias=row_id)
            if row_id
            else mint_csid(LANGUAGE_TYPE, name=name)
        )
        languages.append(
            LexiconLanguage(
                csid=csid,
                name=name,
                glottocode=_cell(cells, idx, glottocode_column).casefold(),
                iso=_cell(cells, idx, iso_column).casefold(),
            )
        )
    return languages


def _index(
    languages: list[LexiconLanguage], key: str
) -> dict[str, list[LexiconLanguage]]:
    """Group *languages* by a non-empty blocking key (``glottocode`` / ``iso``)."""
    out: dict[str, list[LexiconLanguage]] = {}
    for language in languages:
        value = getattr(language, key)
        if value:
            out.setdefault(value, []).append(language)
    return out


def reconcile_glottolog(
    nodes: list[GlottologNode],
    languages: list[LexiconLanguage],
    *,
    sample: int = DEFAULT_SAMPLE,
) -> ReconciliationSummary:
    """Classify each Glottolog *node* against the existing *languages*.

    Glottocode is tried first; only a languoid whose glottocode finds no lexicon row
    falls back to its ISO 639-3 code. Exactly one candidate ⇒ ``matched``; more than
    one ⇒ ``ambiguous`` (never auto-merged); none ⇒ ``new``.
    """
    by_glottocode = _index(languages, "glottocode")
    by_iso = _index(languages, "iso")
    matched: list[OutcomeSample] = []
    new: list[OutcomeSample] = []
    ambiguous: list[OutcomeSample] = []
    for node in nodes:
        candidates: list[LexiconLanguage] | None = None
        confidence = 0.0
        if node.glottocode and node.glottocode in by_glottocode:
            candidates = by_glottocode[node.glottocode]
            confidence = GLOTTOCODE_CONFIDENCE
        elif node.iso and node.iso in by_iso:
            candidates = by_iso[node.iso]
            confidence = ISO_CONFIDENCE
        if not candidates:
            new.append(OutcomeSample(csid=node.csid, name=node.name))
        else:
            item = OutcomeSample(
                csid=node.csid,
                name=node.name,
                matched_csid=candidates[0].csid,
                confidence=confidence,
            )
            (matched if len(candidates) == 1 else ambiguous).append(item)
    return ReconciliationSummary(
        domain="glottolog",
        incoming_total=len(nodes),
        existing_total=len(languages),
        matched=len(matched),
        new=len(new),
        ambiguous=len(ambiguous),
        union_distinct=len(languages) + len(new),
        matched_samples=sorted(matched, key=lambda s: s.name)[:sample],
        new_samples=sorted(new, key=lambda s: s.name)[:sample],
        ambiguous_samples=sorted(ambiguous, key=lambda s: s.name)[:sample],
    )


def render_markdown(summary: ReconciliationSummary) -> str:
    """A human-readable Markdown report for a Glottolog reconciliation *summary*."""
    s = summary
    lines = [
        f"# Reconciliation report — {s.domain}",
        "",
        "Two-key offline cascade (`reconcile_glottolog`): each Glottolog languoid is "
        "classified against the existing `lexicons/languages.tsv` by **glottocode "
        "first**, then **ISO 639-3**. A code shared by more than one lexicon row is "
        "**ambiguous** and is never auto-merged.",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| ingested languoids (incoming) | {s.incoming_total} |",
        f"| existing languages (lexicon) | {s.existing_total} |",
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
            for row in samples:
                lines.append(
                    f"| {row.name} | {row.matched_csid or ''} | {row.confidence} |"
                )
        else:
            lines.append("| name | csid |")
            lines.append("| --- | --- |")
            for row in samples:
                lines.append(f"| {row.name} | {row.csid} |")
        lines.append("")

    _table("Matched", s.matched_samples, matched=True)
    _table("Ambiguous", s.ambiguous_samples, matched=True)
    _table("New", s.new_samples, matched=False)
    return "\n".join(lines) + "\n"


def reconcile_glottolog_against_languages(
    corpus_nodes: Path,
    languages_tsv: Path,
    *,
    sample: int = DEFAULT_SAMPLE,
) -> ReconciliationSummary:
    """Load both sides and run the glottocode → ISO 639-3 cascade end to end."""
    nodes = read_glottolog_nodes(corpus_nodes)
    languages = read_language_lexicon(languages_tsv)
    return reconcile_glottolog(nodes, languages, sample=sample)
