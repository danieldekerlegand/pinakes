"""Reconcile the WALS / PHOIBLE typology & phonology facts to the language lexicon.

WALS structural features and PHOIBLE phoneme inventories are ingested (categories
``wals.yml`` / ``phoible.yml``) as *attribute-fact* nodes — one node per (language,
feature) value or (language, segment) — each keyed by the language's **glottocode**
(carried on the node as ``language_code``) with its **ISO 639-3** code on ``lang``.
They enrich language nodes but are not themselves a genealogy, so the join to the
Glottolog-anchored languages is a **reconciliation**, not a graph descent edge.

This module rolls the facts up **per language** and classifies each distinct language
against ``data/source/lexicons/languages.tsv`` by the same **glottocode-first,
then ISO 639-3**
cascade the Glottolog reconciler uses (reused here via
:func:`~pinakes_engine.schema.glottolog_reconcile.reconcile_glottolog`), and reports the
**coverage** the acceptance asks for: how many facts, of which licence class, over how
many distinct languages, and how many of those languages are already curated. The
matching is pure and offline; the driver ``scripts/reconcile_typology.py`` is only
path-wiring + I/O.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .glottolog_reconcile import (
    GlottologNode,
    LexiconLanguage,
    read_language_lexicon,
    reconcile_glottolog,
)
from .lexicon_reconcile import DEFAULT_SAMPLE, ReconciliationSummary

DELIMITER = "\t"

#: Node overflow column holding the unmapped source columns (incl. ``Language_Name``).
OVERFLOW_COLUMN = "extra"

#: Overflow key carrying the human-readable language name (for a readable report).
LANGUAGE_NAME_KEY = "Language_Name"


@dataclass(frozen=True)
class FactNode:
    """A WALS / PHOIBLE fact node reduced to its reconciliation + coverage keys."""

    csid: str
    name: str
    glottocode: str
    iso: str
    license: str
    node_type: str
    language_name: str


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


def _language_name_from_overflow(cell: str) -> str:
    """Pull ``Language_Name`` out of a node's overflow JSON (``""`` when absent)."""
    if not cell:
        return ""
    try:
        data = json.loads(cell)
    except json.JSONDecodeError:
        return ""
    if not isinstance(data, dict):
        return ""
    value = data.get(LANGUAGE_NAME_KEY, "")
    return str(value) if value else ""


def read_fact_nodes(path: Path, *, node_type: str) -> list[FactNode]:
    """Load a built fact node TSV (``corpus/nodes/<type>.tsv``) as reconciliation facts.

    Reads the glottocode from ``language_code`` and the ISO 639-3 code from ``lang``
    (both casefolded so the join is case-insensitive), the per-record ``license``, and
    lifts ``Language_Name`` out of the overflow JSON for a readable report. Returns an
    empty list if *path* does not exist or is empty.
    """
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = [_strip_header(c) for c in lines[0].split(DELIMITER)]
    idx = {name: i for i, name in enumerate(header)}
    facts: list[FactNode] = []
    for line in lines[1:]:
        if not line:
            continue
        cells = line.split(DELIMITER)
        name = _cell(cells, idx, "name")
        if not name:
            continue
        facts.append(
            FactNode(
                csid=_cell(cells, idx, "csid"),
                name=name,
                glottocode=_cell(cells, idx, "language_code").casefold(),
                iso=_cell(cells, idx, "lang").casefold(),
                license=_cell(cells, idx, "license"),
                node_type=node_type,
                language_name=_language_name_from_overflow(
                    _cell(cells, idx, OVERFLOW_COLUMN)
                ),
            )
        )
    return facts


def _language_key(fact: FactNode) -> str:
    """The blocking key that identifies the language a *fact* is about."""
    return fact.glottocode or fact.iso or fact.language_name.casefold() or fact.csid


def distinct_language_nodes(facts: list[FactNode]) -> list[GlottologNode]:
    """Collapse *facts* to one :class:`GlottologNode` per distinct language.

    Facts are grouped by glottocode (falling back to ISO, then name), and each group
    yields a single language node carrying that language's glottocode + ISO keys, so
    the language-level reconciliation counts every language once regardless of how many
    facts it carries. Ordered by first appearance for a deterministic report.
    """
    seen: dict[str, GlottologNode] = {}
    for fact in facts:
        key = _language_key(fact)
        if key in seen:
            continue
        seen[key] = GlottologNode(
            csid=f"cs:language:{fact.glottocode or fact.iso or key}",
            name=fact.language_name or fact.glottocode or fact.iso or fact.name,
            glottocode=fact.glottocode,
            iso=fact.iso,
        )
    return list(seen.values())


@dataclass(frozen=True)
class TypologyCoverage:
    """Coverage roll-up for the WALS / PHOIBLE fact corpus.

    ``reconciliation`` is the language-level glottocode → ISO cascade outcome (its
    ``incoming_total`` is :attr:`distinct_languages`); the fact/language counts by node
    type and by licence class are the coverage numbers the acceptance records.
    """

    domain: str
    total_facts: int
    distinct_languages: int
    facts_by_type: dict[str, int]
    languages_by_type: dict[str, int]
    facts_by_license: dict[str, int]
    reconciliation: ReconciliationSummary
    licenses: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        """A JSON-serialisable mapping (dataclass tree → primitives)."""
        return asdict(self)


def build_coverage(
    facts: list[FactNode],
    languages: list[LexiconLanguage],
    *,
    domain: str = "typology",
    sample: int = DEFAULT_SAMPLE,
) -> TypologyCoverage:
    """Roll *facts* into a :class:`TypologyCoverage` reconciled against *languages*."""
    facts_by_type: dict[str, int] = {}
    facts_by_license: dict[str, int] = {}
    languages_by_type: dict[str, set[str]] = {}
    for fact in facts:
        facts_by_type[fact.node_type] = facts_by_type.get(fact.node_type, 0) + 1
        lic = fact.license or "(none)"
        facts_by_license[lic] = facts_by_license.get(lic, 0) + 1
        languages_by_type.setdefault(fact.node_type, set()).add(_language_key(fact))

    language_nodes = distinct_language_nodes(facts)
    reconciliation = reconcile_glottolog(
        language_nodes, languages, sample=sample
    )
    # The reconciliation summary is language-scoped: relabel its domain so the report
    # reads as a typology coverage report rather than a Glottolog one.
    reconciliation = ReconciliationSummary(
        domain=domain,
        incoming_total=reconciliation.incoming_total,
        existing_total=reconciliation.existing_total,
        matched=reconciliation.matched,
        new=reconciliation.new,
        ambiguous=reconciliation.ambiguous,
        union_distinct=reconciliation.union_distinct,
        matched_samples=reconciliation.matched_samples,
        new_samples=reconciliation.new_samples,
        ambiguous_samples=reconciliation.ambiguous_samples,
    )
    return TypologyCoverage(
        domain=domain,
        total_facts=len(facts),
        distinct_languages=len(language_nodes),
        facts_by_type=dict(sorted(facts_by_type.items())),
        languages_by_type={
            k: len(v) for k, v in sorted(languages_by_type.items())
        },
        facts_by_license=dict(sorted(facts_by_license.items())),
        reconciliation=reconciliation,
        licenses=sorted(facts_by_license),
    )


def render_markdown(coverage: TypologyCoverage) -> str:
    """A human-readable Markdown coverage + reconciliation report for *coverage*."""
    c = coverage
    r = c.reconciliation
    lines = [
        f"# Typology & phonology coverage — {c.domain}",
        "",
        "WALS structural features and PHOIBLE phoneme inventories ingested via the "
        "tabular-dump adapter as language-keyed **attribute facts** (categories "
        "`wals.yml` / `phoible.yml`). Each distinct language is reconciled against "
        "`data/source/lexicons/languages.tsv` by the **glottocode-first, then ISO "
        "639-3** cascade "
        "(`reconcile_glottolog`); a code shared by more than one lexicon row is "
        "**ambiguous** and is never auto-merged.",
        "",
        "## Coverage",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| total facts | {c.total_facts} |",
        f"| distinct languages | {c.distinct_languages} |",
    ]
    for node_type, count in c.facts_by_type.items():
        langs = c.languages_by_type.get(node_type, 0)
        lines.append(f"| facts — `{node_type}` | {count} ({langs} languages) |")
    for lic, count in c.facts_by_license.items():
        lines.append(f"| facts — licence `{lic}` | {count} |")
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
        "### Matched languages "
        f"(first {len(r.matched_samples)})",
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


def reconcile_typology_against_languages(
    node_files: dict[str, Path],
    languages_tsv: Path,
    *,
    domain: str = "typology",
    sample: int = DEFAULT_SAMPLE,
) -> TypologyCoverage:
    """Load the fact node files + language lexicon and build the coverage report.

    *node_files* maps each node type (e.g. ``"typology"`` / ``"phoneme"``) to its
    built ``corpus/nodes/<type>.tsv`` path; a missing file contributes no facts.
    """
    facts: list[FactNode] = []
    for node_type, path in node_files.items():
        facts.extend(read_fact_nodes(path, node_type=node_type))
    languages = read_language_lexicon(languages_tsv)
    return build_coverage(facts, languages, domain=domain, sample=sample)
