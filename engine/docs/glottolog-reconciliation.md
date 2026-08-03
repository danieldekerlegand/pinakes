# Glottolog reconciliation report (source-breadth Phase 4, US-001)

Point-in-time snapshot of the **acquire → normalize → reconcile** step of the
Glottolog ingestion (`docs/sources-linguistic.md`; Phase 4 of the neurosymbolic
roadmap). Reproduce with:

```bash
uv run pinakes_engine run jobs/glottolog.yml          # ingest (tabular-dump) → stitch
uv run python scripts/reconcile_glottolog.py         # reconcile → out/.../reconciliation
```

The machine-readable report (`out/glottolog/reconciliation/report.{json,md}`) is
gitignored (it tracks the built corpus); this doc is the committed summary. Matching
logic: `pinakes_engine.schema.glottolog_reconcile` runs a **two-key offline cascade** —
**glottocode first** (Glottolog's own primary identifier, carried on each node as
`language_code`), then **ISO 639-3** (the languoid's `ISO639P3code`, kept in the node
overflow). A code shared by more than one lexicon row is **ambiguous** and is **never**
auto-merged.

## Result (committed fixture slice, `tests/fixtures/glottolog/languages.csv`)

The job runs network-free out of the box against a committed 8-languoid Sino-Tibetan
slice; repoint `categories/glottolog.yml`'s `source.query` at a full Glottolog CLDF
`languages.csv` download (gitignored) to reconcile the whole ~26k-languoid catalogue.

| metric | count |
| --- | --- |
| ingested languoids (corpus `:Language` nodes) | **8** |
| existing (curated `data/source/lexicons/languages.tsv`) | 1 099 |
| matched (already curated) | 4 |
| new (candidates to add) | 4 |
| ambiguous (held for triage) | 0 |
| **union distinct** | **1 103** |

- **Cascade exercised both tiers:** Mandarin Chinese, Burmese and Dzongkha matched by
  **glottocode** (`mand1415` / `nucl1310` / `dzon1239`, confidence 1.0); **Yue Chinese**
  matched by the **ISO 639-3 fallback** (`yue`) because the lexicon's Cantonese row
  carries no glottocode — exactly the glottocode-first-then-ISO behaviour the story
  requires.
- **New candidates:** the two families (Sino-Tibetan, Tibetic), one dialect (Beijing
  Mandarin) and one uncurated language (Lolopo) — none share a glottocode or ISO code
  with an existing row, so they land as `new`, never merged onto a look-alike.
- **Provenance:** every ingested `:Language` node carries `source=glottolog`,
  `source_url=https://glottolog.org/resource/languoid/id/<glottocode>`, `source_query`,
  `retrieved_at` (ISO-8601 UTC), `confidence=0.8` (curated-verified rubric) and
  `license=CC-BY-4.0`. The corpus QA gate passes (provenance completeness ≥ 0.5,
  duplicate-rate 0, dangling-edge 0, 100 % single connected component).
- **Genealogy:** the linguistic linker resolves each languoid's `parent_code`
  (its Glottolog `Family_ID`) to a `DESCENDS_FROM` edge, so the slice stitches into one
  connected descent graph rooted at Sino-Tibetan.
- **Ambiguity is withheld, not guessed:** a glottocode / ISO code shared by two lexicon
  rows (e.g. the collective `tot` across the Totonac lects) is reported as `ambiguous`
  and never auto-merged — a human resolves it.
