"""Reconcile the Lexibank wordlist corpus against ``lexicons/languages.tsv``.

A Lexibank CLDF wordlist (category ``lexibank-abvd.yml``, job ``jobs/lexibank.yml``)
is ingested as **Wordform** attribute-fact nodes — one node per (language, concept)
form — each keyed by the language's **glottocode** (carried on the node as
``language_code``) with its **ISO 639-3** code on ``lang`` and its cognate-set id in
the ``extra`` overflow. Forms sharing a cognate set are linked into ``COGNATE_WITH``
representative stars by the linguistic linker.

Like the WALS/PHOIBLE typology corpus, a wordlist is *enrichment*: it does not by
itself yield a language genealogy, so the join to the Glottolog-anchored languages is
a **reconciliation**, not a graph descent edge. This module reuses the typology
reconciler's per-language roll-up (:func:`~culturescrape.schema.typology_reconcile.\
build_coverage`, which runs the glottocode-first-then-ISO cascade against the lexicon)
and layers on the **cognacy** coverage a wordlist adds: how many cognate sets, how
many forms carry one, and how many ``COGNATE_WITH`` edges were materialised. The
matching is pure and offline; the driver ``scripts/reconcile_lexibank.py`` is only
path-wiring + I/O.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .glottolog_reconcile import LexiconLanguage, read_language_lexicon
from .lexicon_reconcile import DEFAULT_SAMPLE
from .typology_reconcile import (
    DELIMITER,
    OVERFLOW_COLUMN,
    FactNode,
    TypologyCoverage,
    build_coverage,
    read_fact_nodes,
)

#: The node type a Lexibank wordlist form lands as (category ``label: Wordform``).
WORDFORM_TYPE = "wordform"

#: Overflow key carrying the form's cognate-set id (Lexibank ``Cognateset_ID``).
COGNATESET_KEY = "cognateset"

#: The linker-materialised cognate edge type + its on-disk corpus file name.
COGNATE_EDGE_TYPE = "COGNATE_WITH"
COGNATE_EDGE_FILE = "cognate-with.tsv"


@dataclass(frozen=True)
class CognateCoverage:
    """How much cognacy the wordlist corpus carries and materialised as edges."""

    #: Distinct cognate-set ids present across the ingested forms.
    cognate_sets: int
    #: Forms carrying a cognate-set id (the rest are un-cognated wordforms).
    forms_with_cognateset: int
    #: ``COGNATE_WITH`` edges emitted (a representative star per multi-member set).
    cognate_edges: int


@dataclass(frozen=True)
class LexibankCoverage:
    """Language reconciliation + cognacy coverage for the wordlist corpus."""

    coverage: TypologyCoverage
    cognates: CognateCoverage

    def to_dict(self) -> dict[str, object]:
        """A JSON-serialisable mapping (dataclass tree → primitives)."""
        return {"coverage": self.coverage.to_dict(), "cognates": asdict(self.cognates)}


def _strip_header(cell: str) -> str:
    """Canonical field name for a Neo4j-import header cell (``csid:ID`` → ``csid``)."""
    if cell.startswith(":"):
        return cell
    name, _, _suffix = cell.partition(":")
    return name


def _cell(cells: list[str], idx: dict[str, int], column: str) -> str:
    """The value of *column* in *cells*, or ``""`` when absent."""
    i = idx.get(column, -1)
    return cells[i].strip() if 0 <= i < len(cells) else ""


def _overflow_value(cell: str, key: str) -> str:
    """Pull *key* out of a node's overflow JSON (``""`` when absent/unparseable)."""
    if not cell:
        return ""
    try:
        data = json.loads(cell)
    except json.JSONDecodeError:
        return ""
    if not isinstance(data, dict):
        return ""
    value = data.get(key, "")
    return str(value) if value else ""


def cognate_coverage(nodes_path: Path, edges_path: Path) -> CognateCoverage:
    """Count distinct cognate sets, cognated forms, and ``COGNATE_WITH`` edges.

    The cognate-set id rides in each wordform node's ``extra`` overflow (an unmapped
    ``cognateset`` cell); the edges are counted from the linker's ``cognate-with.tsv``
    (data lines only). A missing file contributes zero.
    """
    cognate_sets: set[str] = set()
    forms_with_cognateset = 0
    if nodes_path.is_file():
        lines = nodes_path.read_text(encoding="utf-8").splitlines()
        if lines:
            header = [_strip_header(c) for c in lines[0].split(DELIMITER)]
            idx = {name: i for i, name in enumerate(header)}
            for line in lines[1:]:
                if not line:
                    continue
                cells = line.split(DELIMITER)
                cs = _overflow_value(
                    _cell(cells, idx, OVERFLOW_COLUMN), COGNATESET_KEY
                )
                if cs:
                    cognate_sets.add(cs)
                    forms_with_cognateset += 1

    cognate_edges = 0
    if edges_path.is_file():
        edge_lines = edges_path.read_text(encoding="utf-8").splitlines()
        cognate_edges = max(0, len([ln for ln in edge_lines if ln]) - 1)

    return CognateCoverage(
        cognate_sets=len(cognate_sets),
        forms_with_cognateset=forms_with_cognateset,
        cognate_edges=cognate_edges,
    )


def build_lexibank_coverage(
    facts: list[FactNode],
    languages: list[LexiconLanguage],
    cognates: CognateCoverage,
    *,
    domain: str = "lexibank",
    sample: int = DEFAULT_SAMPLE,
) -> LexibankCoverage:
    """Roll *facts* into a :class:`LexibankCoverage` reconciled against *languages*."""
    coverage = build_coverage(facts, languages, domain=domain, sample=sample)
    return LexibankCoverage(coverage=coverage, cognates=cognates)


def reconcile_lexibank_against_languages(
    nodes_path: Path,
    edges_path: Path,
    languages_tsv: Path,
    *,
    domain: str = "lexibank",
    sample: int = DEFAULT_SAMPLE,
) -> LexibankCoverage:
    """Load the wordform corpus + language lexicon and build the coverage report."""
    facts = read_fact_nodes(nodes_path, node_type=WORDFORM_TYPE)
    languages = read_language_lexicon(languages_tsv)
    cognates = cognate_coverage(nodes_path, edges_path)
    return build_lexibank_coverage(
        facts, languages, cognates, domain=domain, sample=sample
    )


def render_markdown(result: LexibankCoverage) -> str:
    """A human-readable Markdown coverage + reconciliation report for *result*."""
    c = result.coverage
    r = c.reconciliation
    g = result.cognates
    lines = [
        f"# Lexibank wordlist coverage — {c.domain}",
        "",
        "A Lexibank CLDF wordlist ingested via the tabular-dump adapter as "
        "language-keyed **Wordform** attribute facts (category `lexibank-abvd.yml`). "
        "Each distinct language is reconciled against `lexicons/languages.tsv` by the "
        "**glottocode-first, then ISO 639-3** cascade (`reconcile_glottolog`); a code "
        "shared by more than one lexicon row is **ambiguous** and is never "
        "auto-merged. Forms sharing a cognate set are linked into `COGNATE_WITH` "
        "representative stars.",
        "",
        "## Coverage",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| total forms | {c.total_facts} |",
        f"| distinct languages | {c.distinct_languages} |",
        f"| cognate sets | {g.cognate_sets} |",
        f"| forms with a cognate set | {g.forms_with_cognateset} |",
        f"| COGNATE_WITH edges | {g.cognate_edges} |",
    ]
    for lic, count in c.facts_by_license.items():
        lines.append(f"| forms — licence `{lic}` | {count} |")
    lines += [
        "",
        "## Language reconciliation",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| distinct languages (incoming) | {r.incoming_total} |",
        f"| existing languages (lexicon) | {r.existing_total} |",
        f"| matched (already curated) | {r.matched} |",
        f"| new (candidates to add) | {r.new} |",
        f"| ambiguous (held for triage) | {r.ambiguous} |",
        f"| **union distinct** | **{r.union_distinct}** |",
        "",
        f"### Matched languages (first {len(r.matched_samples)})",
        "",
    ]
    if r.matched_samples:
        lines.append("| language | matched csid | confidence |")
        lines.append("| --- | --- | --- |")
        for s in r.matched_samples:
            lines.append(f"| {s.name} | {s.matched_csid or ''} | {s.confidence} |")
    else:
        lines.append("_none_")
    lines += ["", f"### New languages (first {len(r.new_samples)})", ""]
    if r.new_samples:
        lines.append("| language | csid |")
        lines.append("| --- | --- |")
        for s in r.new_samples:
            lines.append(f"| {s.name} | {s.csid} |")
    else:
        lines.append("_none_")
    lines.append("")
    return "\n".join(lines) + "\n"
