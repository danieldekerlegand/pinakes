# kaikki.org Wiktionary etymology — coverage & reconciliation (source-breadth US-004)

kaikki.org publishes machine-parsed Wiktionary as newline-delimited JSON (one object
per word sense group), so the broad etymology / cognate / borrowing signal Wiktionary
carries becomes ingestible **without** the heavy wikitext parsing
[`docs/sources-linguistic.md`](sources-linguistic.md) flagged as a research effort. The
`kaikki` JSONL adapter (`src/pinakes_engine/acquire/kaikki.py`) reads such an extract and
yields one **Wordform** node per entry, keyed by the entry's language; the linguistic
linker turns each entry's etymology templates into the canonical edge vocabulary.

- **Category / job:** `categories/kaikki.yml`, `jobs/kaikki.yml`
  (`uv run pinakes_engine run jobs/kaikki.yml`).
- **Fixture slice (committed, network-free):**
  `tests/fixtures/kaikki/etymology.jsonl` (6 entries, 4 languages).
- **Reconcile driver:** `scripts/reconcile_kaikki.py` →
  `out/kaikki/reconciliation/report.{json,md}` (gitignored).

## Etymology relation → canonical edge mapping

`schema/kaikki_etymology.py` is the single, pure bridge from Wiktionary's
etymology-template vocabulary (the `{{bor|…}}`, `{{inh|…}}`, `{{cog|…}}` … templates
wiktextract preserves verbatim in each entry's `etymology_templates`) to the registered
ontology edge `:TYPE`s. Only tokens whose meaning is an unambiguous **directed** relation
between two terms are mapped:

| Wiktionary template token | canonical `:TYPE` |
| --- | --- |
| `bor` `borrowed` `lbor` `slbor` `obor` `ubor` | `BORROWED_FROM` |
| `inh` `inherited` `der` `derived` (`+` variants) | `DERIVED_FROM` |
| `cog` `cognate` | `COGNATE_WITH` |

Every other template token is **unmappable** and is skipped + reported, never coerced
onto an edge type:

- display helpers (`m` / `l` / `mention` / `link`, glosses, `w`, `q`);
- ambiguous calques (`cal` / `clq` — direction not modelled);
- **`ncog` / `noncog`** — the explicit *non*-cognate assertion; mapping it onto
  `COGNATE_WITH` would invert the source's claim.

The borrowing / derivation templates carry the destination language in arg `1` and the
source language / term in args `2` / `3`; the cognate templates carry the cognate
language / term in args `1` / `2`. Each mapped relation becomes one edge from the
wordform to a minimal `Term` node minted for the source-side `(lang, term)` — so the
same etymon referenced by many forms is a single node.

## Provenance & licence

Every wordform node carries `source=kaikki`, a per-entry `source_url` (when the extract
carries a stable id + a configured `url_template`), `retrieved_at`, `confidence=0.8`
(curated-verified — machine-parsed from a curated encyclopaedia), and — the AC2
deliverable — `license=CC-BY-SA-3.0`. Wiktionary text is **CC-BY-SA (dual GFDL)**
(`docs/sources-linguistic.md`); the share-alike licence is stamped on every ingested
node and is queryable by licence class, exactly as for PHOIBLE (also CC-BY-SA-3.0). The
linker-minted source-term stubs carry `source=inferred:linguistic` (they are scaffolding,
not ingested records — per-record licence is a node-level guarantee for the ingest).

## Fixture-slice numbers

Reconciling the committed fixture (`uv run pinakes_engine run jobs/kaikki.yml` then
`uv run python scripts/reconcile_kaikki.py`):

### Etymology edges

| metric | count |
| --- | --- |
| entries | 6 |
| entries with ≥1 etymology edge | 6 |
| **total edges** | **8** |
| `BORROWED_FROM` | 2 |
| `DERIVED_FROM` | 4 |
| `COGNATE_WITH` | 2 |
| unmappable template tokens (skipped) | 3 (`l`×1, `m`×1, `ncog`×1) |

### Language reconciliation

Each distinct wordform language is reconciled against `data/source/lexicons/languages.tsv` by the
**ISO 639-3** join (kaikki carries no glottocode, so the glottocode-first cascade falls
straight to the ISO key). kaikki's `lang_code` is the Wiktionary language code (often ISO
639-1 / a custom code) rather than 639-3, so a language matches only when its code lands
in the lexicon's ISO slot — an unmatched language is a **new** candidate, never
auto-merged. On the 4-language fixture: 0 matched / 4 new / 0 ambiguous.

## Scaling to the full extract

Repoint `categories/kaikki.yml`'s `source.query` at a real gitignored kaikki.org
download — a per-language or all-words `*.jsonl` extract from
<https://kaikki.org/dictionary/> — and rebuild. The adapter streams JSONL line by line,
so memory is bounded by one entry. The extract is gitignored (`out/*` discipline); commit
the category / job / fixture / reconcile module + driver and this narrative summary, never
the download or the built `out/kaikki/` corpus.
