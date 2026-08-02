"""Reconcile the kaikki.org Wiktionary etymology corpus to the language lexicon,
and report its edge volume + the etymology-template tokens skipped as unmappable.

kaikki entries are ingested (category ``kaikki.yml``) as language-keyed **Wordform**
nodes; the linguistic linker turns each entry's etymology relations into
``BORROWED_FROM`` / ``DERIVED_FROM`` / ``COGNATE_WITH`` edges to the source-side
terms (source-breadth US-004). This module records what the acceptance asks for:

* the **language coverage** of the ingested wordforms — reusing
  :func:`~pinakes_engine.schema.typology_reconcile.build_coverage`'s per-language
  glottocode → ISO 639-3 cascade against ``data/source/lexicons/languages.tsv``
  (kaikki carries
  no glottocode, so every language joins on the ISO code on ``lang``); and
* the **edge volume** by canonical ``:TYPE`` plus every etymology-template token that
  named no canonical relation and was **skipped** — computed straight from the source
  extract with :func:`~pinakes_engine.schema.kaikki_etymology.extract_relations`, so
  the report states exactly which relation tokens were dropped (never mis-typed).

The matching + tallying is pure and offline; the driver ``scripts/reconcile_kaikki.py``
is only path-wiring + I/O.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .glottolog_reconcile import LexiconLanguage, read_language_lexicon
from .kaikki_etymology import extract_relations
from .lexicon_reconcile import DEFAULT_SAMPLE
from .typology_reconcile import (
    TypologyCoverage,
    build_coverage,
    read_fact_nodes,
)

#: The node type the kaikki wordform corpus writes (category ``label: Wordform``).
WORDFORM_TYPE = "wordform"


@dataclass(frozen=True)
class EtymologyReport:
    """Edge volume + skipped-token tally over a kaikki etymology extract.

    ``edges_by_type`` counts the canonical edges each mappable relation yields;
    ``unmappable_tokens`` counts every etymology-template token that named no
    canonical relation (display helpers, ambiguous calques, ``ncog`` non-cognate
    assertions) — the "skipped and reported" the acceptance requires.
    """

    total_entries: int
    entries_with_edges: int
    total_edges: int
    edges_by_type: dict[str, int]
    total_unmappable: int
    unmappable_tokens: dict[str, int]
    distinct_languages: int

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def analyze_entries(entries: Iterable[Mapping[str, Any]]) -> EtymologyReport:
    """Tally edge volume + skipped tokens over raw kaikki *entries*.

    Reads each entry's etymology templates (never the built corpus), so the report
    is a pure function of the source extract and needs no corpus build to run.
    """
    edges_by_type: dict[str, int] = {}
    unmappable: dict[str, int] = {}
    languages: set[str] = set()
    total_entries = 0
    entries_with_edges = 0
    total_edges = 0
    for entry in entries:
        total_entries += 1
        if code := str(entry.get("lang_code", "")).strip():
            languages.add(code.casefold())
        result = extract_relations(entry)
        if result.relations:
            entries_with_edges += 1
        for relation in result.relations:
            edges_by_type[relation.edge_type] = (
                edges_by_type.get(relation.edge_type, 0) + 1
            )
            total_edges += 1
        for token in result.skipped_tokens:
            unmappable[token] = unmappable.get(token, 0) + 1
    return EtymologyReport(
        total_entries=total_entries,
        entries_with_edges=entries_with_edges,
        total_edges=total_edges,
        edges_by_type=dict(sorted(edges_by_type.items())),
        total_unmappable=sum(unmappable.values()),
        unmappable_tokens=dict(sorted(unmappable.items())),
        distinct_languages=len(languages),
    )


@dataclass(frozen=True)
class KaikkiCoverage:
    """The kaikki corpus's language reconciliation + etymology edge report."""

    coverage: TypologyCoverage
    etymology: EtymologyReport

    def to_dict(self) -> dict[str, object]:
        return {
            "coverage": self.coverage.to_dict(),
            "etymology": self.etymology.to_dict(),
        }


def build_kaikki_coverage(
    wordform_nodes: Path,
    entries: Iterable[Mapping[str, Any]],
    languages: list[LexiconLanguage],
    *,
    sample: int = DEFAULT_SAMPLE,
) -> KaikkiCoverage:
    """Roll the built wordform nodes + source entries into a :class:`KaikkiCoverage`.

    *wordform_nodes* is the built ``corpus/nodes/wordform.tsv`` (the ingested kaikki
    entries — the linker-minted source-term stubs land in ``term.tsv`` and are not
    counted here); *entries* is the raw source extract used for the edge / skipped-
    token report; *languages* is the parsed language lexicon.
    """
    facts = read_fact_nodes(wordform_nodes, node_type=WORDFORM_TYPE)
    coverage = build_coverage(
        facts, languages, domain="kaikki-etymology", sample=sample
    )
    etymology = analyze_entries(entries)
    return KaikkiCoverage(coverage=coverage, etymology=etymology)


def reconcile_kaikki_against_languages(
    wordform_nodes: Path,
    entries: Iterable[Mapping[str, Any]],
    languages_tsv: Path,
    *,
    sample: int = DEFAULT_SAMPLE,
) -> KaikkiCoverage:
    """Load the language lexicon and build the kaikki coverage + etymology report."""
    languages = read_language_lexicon(languages_tsv)
    return build_kaikki_coverage(
        wordform_nodes, entries, languages, sample=sample
    )


def render_markdown(kc: KaikkiCoverage) -> str:
    """A human-readable Markdown coverage + etymology report for *kc*."""
    e = kc.etymology
    r = kc.coverage.reconciliation
    lines = [
        "# kaikki.org Wiktionary etymology — coverage & reconciliation",
        "",
        "kaikki.org machine-parsed Wiktionary extracts ingested via the dedicated "
        "`kaikki` JSONL adapter as language-keyed **Wordform** nodes; each entry's "
        "etymology templates are mapped onto the canonical edge vocabulary "
        "(`BORROWED_FROM` / `DERIVED_FROM` / `COGNATE_WITH`) by "
        "`schema/kaikki_etymology.py`. Template tokens that name no canonical "
        "relation (display helpers, ambiguous calques, and the `ncog`/`noncog` "
        "**non**-cognate assertion) are skipped and reported below, never coerced "
        "onto an edge type. Each distinct language is reconciled against "
        "`data/source/lexicons/languages.tsv` by the **ISO 639-3** join (kaikki "
        "carries no "
        "glottocode); a code shared by more than one lexicon row is **ambiguous** "
        "and is never auto-merged.",
        "",
        "## Etymology edges",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| entries | {e.total_entries} |",
        f"| entries with ≥1 etymology edge | {e.entries_with_edges} |",
        f"| **total edges** | **{e.total_edges}** |",
    ]
    for edge_type, count in e.edges_by_type.items():
        lines.append(f"| edges — `{edge_type}` | {count} |")
    lines += [
        f"| total unmappable template tokens (skipped) | {e.total_unmappable} |",
    ]
    for token, count in e.unmappable_tokens.items():
        lines.append(f"| skipped token — `{token}` | {count} |")
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
    lines.append("")
    return "\n".join(lines) + "\n"
