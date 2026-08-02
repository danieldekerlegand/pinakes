# WALS + PHOIBLE typology/phonology coverage (source-breadth Phase 4, US-002)

Point-in-time snapshot of the **acquire → normalize → reconcile** step of the WALS
(typology) and PHOIBLE (phonology) ingestion (`docs/sources-linguistic.md`; Phase 4 of
the neurosymbolic roadmap). Reproduce with:

```bash
uv run pinakes_engine run jobs/typology.yml           # ingest WALS + PHOIBLE → stitch
uv run python scripts/reconcile_typology.py          # reconcile → out/.../reconciliation
```

The machine-readable report (`out/typology/reconciliation/report.{json,md}`) is
gitignored (it tracks the built corpus); this doc is the committed summary. Both sources
are ingested via the existing **tabular-dump adapter** (no new adapter code) as
language-keyed **attribute facts** — one node per (language, feature) WALS value and per
(language, segment) PHOIBLE inventory entry. Unlike Glottolog (a genealogy), typology and
phonology enrich language nodes but do not themselves yield linguistic *edges*, so the
join to the language lexicon is a **reconciliation**, not a graph descent edge.

## Modelling (categories `wals.yml` / `phoible.yml`)

- **Keyed by glottocode.** Each fact carries the language's Glottocode on
  `language_code` (the reconciler's primary blocking key) and its ISO 639-3 code on
  `lang`. `lang` does double duty: it is the reconciler's ISO fallback key **and** the
  entity-resolution fuzzy-merge block key — so the same feature/segment on two languages
  ("SVO" for English vs Mandarin, or `/m/` in both) is never collapsed into one node.
- **Per-record licence** rides on every node's `license` column, so the packaged corpus
  is queryable by licence class: **WALS = `CC-BY-4.0`**, **PHOIBLE = `CC-BY-SA-3.0`**
  (share-alike). Building both in one job puts the two licence classes in one graph.
- **Reconciliation** (`pinakes_engine.schema.typology_reconcile`) rolls the facts up per
  language and classifies each distinct language against `lexicons/languages.tsv` by the
  same **glottocode-first, then ISO 639-3** cascade the Glottolog reconciler uses
  (reused via `reconcile_glottolog`). A code shared by >1 lexicon row is **ambiguous**
  and is **never** auto-merged.

## Result (committed fixture slices)

The job runs network-free out of the box against committed slices
(`tests/fixtures/wals/values.csv`, `tests/fixtures/phoible/values.csv`); repoint each
category's `source.query` at a full denormalised CLDF download (gitignored) to ingest the
whole catalogues (WALS ~2.6k languages × ~190 features; PHOIBLE ~2.1k languages).

### Coverage

| metric | count |
| --- | --- |
| total facts | **19** |
| distinct languages | **8** |
| facts — `typology` (WALS) | 9 (5 languages) |
| facts — `phoneme` (PHOIBLE) | 10 (5 languages) |
| facts — licence `CC-BY-4.0` (WALS) | 9 |
| facts — licence `CC-BY-SA-3.0` (PHOIBLE, share-alike) | 10 |

### Language reconciliation

| metric | count |
| --- | --- |
| distinct languages (incoming) | 8 |
| existing (curated `lexicons/languages.tsv`) | 1 099 |
| matched (already curated) | 6 |
| new (candidates to add) | 2 |
| ambiguous (held for triage) | 0 |
| **union distinct** | **1 101** |

- **Both cascade tiers exercised:** English, Mandarin, Japanese, Turkish and Hawaiian
  matched by **glottocode** (`stan1293` / `mand1415` / `nucl1643` / `nucl1301` /
  `hawa1245`, confidence 1.0); **Swahili** matched by the **ISO 639-3 fallback** (`swa`)
  because the lexicon's Swahili row carries no glottocode — exactly the
  glottocode-first-then-ISO behaviour the story requires.
- **New candidates:** Abui (`abui1241`) and Pirahã (`pira1253`) share no glottocode or
  ISO code with any existing row, so they land as `new`, never merged onto a look-alike.
- **Cross-source dedup:** English and Mandarin appear in **both** WALS and PHOIBLE; the
  per-language roll-up keys them by glottocode, so each counts once toward the 8 distinct
  languages.
- **Provenance & QA:** every WALS/PHOIBLE node carries `source` (`wals`/`phoible`),
  `source_url`, `source_query`, `retrieved_at` (ISO-8601 UTC), `confidence=0.8`
  (curated-verified rubric) and its `license`. The corpus QA gate passes (provenance
  completeness ≥ 0.5, duplicate-rate 0, dangling-edge 0). Connectivity is relaxed
  (`min_component_fraction: 0.0` in `jobs/typology.yml`): typology/phonology facts are
  disjoint per-language attribute stars linking only to their synthetic type/category
  hubs, so the language join is the reconciliation, not descent connectivity.

## Repointing at the real CLDF downloads

The tabular-dump adapter reads one file, so a real ingest stages a **denormalised** CSV
carrying `Glottocode` + `ISO639P3code` + a per-fact `Name` per row:

- **PHOIBLE** — `cldf/values.csv` is already glottocode-keyed (`Language_ID` references
  `languages.csv.ID` = the Glottocode); denormalisation only lifts `Glottocode` /
  `ISO639P3code` from `languages.csv` and uses the `Value` column as the segment `Name`.
- **WALS** — `cldf/values.csv` is keyed by WALS's own `Language_ID`, so join
  `values.csv` → `languages.csv` (`Language_ID` → `Glottocode` / `ISO639P3code`) and
  `parameters.csv`/`codes.csv` (feature + value labels), and synthesise a `Name`
  (`"<Language>: <Feature>"`). Within one language the feature names stay distinct, so
  no two facts collide.
