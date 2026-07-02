# culture-scrape ↔ LinguaScrape: Data-Layer Convergence Plan

**Status:** Design / planning · **Last updated:** 2026-07-02
**Decision:** Align the two data layers on a shared canonical schema with Neo4j/Datalog as
the correlation system-of-record. **Do not** rewrite the LinguaScrape backend to Python.

---

## 1. Goal

Make LinguaScrape's data and culture-scrape's data **one correlatable body of knowledge** —
so a language, an archaeological culture, a cuisine, a deity, and a trade good can be related,
traversed, and reasoned over together — without discarding LinguaScrape's TypeScript app or
culture-scrape's Python pipeline.

The principle: **alignment is a schema-and-store problem, not a language problem.** Two systems
converge through a shared *data contract* (identity, entity/edge schema, provenance, a common
store), which a TS service speaks as well as a Python one (Neo4j ships a first-class TS driver).

## 2. Why not a Python rewrite

- A Python rewrite of LinguaScrape's ~40k-LOC Express backend would **not itself create
  alignment** — two differently-shaped schemas are misaligned regardless of language.
- The ~91k-LOC React/Vite frontend stays TypeScript no matter what, so the rewrite buys nothing
  for the UI.
- Data production, reconciliation, and correlation belong in a pipeline — and culture-scrape
  **already is** that pipeline, in Python. The move is to *consolidate data-production there*,
  not to port the app.
- What stays best in TS: interactive visualizations, and CPU-domain compute that is already
  written and tested (linguistic distance / LDND+IPA, etymology tracing, phonetic weighting).

## 3. Current-state gap analysis

Full alignment requires six layers to match. LinguaScrape is already close in the ones that matter:

| Layer | culture-scrape | LinguaScrape today | Work |
|---|---|---|---|
| **Identity** | `csid` derived from Wikidata QID + reconciliation cascade (`wikidata_qid → getty_id → normalized(name,lang,type) → fuzzy`) | `id`, `iso639_1`, `iso639_2` on languages; opaque ids elsewhere; **no QIDs** | Reconcile via culture-scrape's cascade; ISO codes are a real language join key |
| **Entity schema** | `nodes/<type>.tsv`, typed Neo4j headers (`csid:ID`, `:LABEL`) | 57 domain TSVs (`languages.tsv`, `archaeological-cultures.tsv`, …), 137k rows | Map each domain TSV → a canonical node type |
| **Edges** | `edges/<type>.tsv` (`:START_ID`,`:END_ID`,`:TYPE`,`time_start:int`,`confidence:float`) | `cultural-lineages.tsv` = `source_id,target_id,relationship_type,time_start,time_end,confidence,evidence_types,sources`; archaeological cultures carry `predecessor/successor_culture_ids`; families carry `parent_id`; languages carry `family_id`/`parent_language_id` | **Near 1:1** — extract edges from existing columns |
| **Provenance** | every row: `source,source_url,source_query,retrieved_at,confidence` | `confidence` + `sources` on lineages/cultures only | Extend provenance to all origin rows |
| **Store / correlation** | Neo4j (graph) + Datalog (`.pl`/`.dl` inference rules) | in-memory TS (`cross-domain-correlation.ts`, `genetic-linguistic-correlation.ts`, relationship scoring) | Migrate correlation to Cypher/Datalog; keep domain compute in TS |
| **Ontology / dimensions** | temporal / geographic / linguistic / genetic | explorer dims: temporal/spatial/relational/hierarchical/categorical | Map the two dimension vocabularies |

**Key insight:** `cultural-lineages.tsv` is already a hand-built edge table. culture-scrape
generalizes exactly that pattern across every domain.

## 4. Target architecture

```
 ┌─────────── culture-scrape (Python) — canonical data + correlation engine ───────────┐
 │  YAML categories/blueprints → acquire (Wikidata dump/SPARQL, Getty, Pleiades,        │
 │                                + NEW: LinguaScrape lexicons via the tabular adapter) │
 │      → normalize → reconcile (csid / wikidata_qid) → ontology link → QA gates         │
 │      → canonical nodes/edges TSV → Neo4j (graph) → Datalog (.pl/.dl inference)        │
 └───────────────────────────────────────────────────────────────────────────────────────┘
        ▲ TSV = portable source of truth (both projects agree)   │ Cypher · Datalog · REST
  human-curated edits (write-back) ──────────────────────────────▼
 ┌─────────── LinguaScrape (TypeScript) — presentation + domain compute ───────────────┐
 │  Express: Neo4j TS driver (relational queries) + FastAPI proxy (search / Datalog);   │
 │           keeps TS-only domain compute (linguistic distance, etymology)              │
 │  React/Vite: UnifiedExplorer adapters, graph neighborhood views, provenance UI       │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

- **One canonical model, one reconciliation cascade, one provenance model, one correlation
  store.** TSV stays the portable, git-diffable source of truth on both sides.
- culture-scrape's `tabular.py` already ingests arbitrary TSV/CSV, so LinguaScrape's `lexicons/`
  become **just another acquisition source**.
- LinguaScrape queries the shared graph two ways: **Neo4j TS driver** for relational/graph
  traversal, and the **FastAPI proxy** for full-text search and Datalog inference consoles.
- Correlation the user wants ("in useful ways") lives in the **Datalog/Neo4j layer** — rules like
  `contemporary_with/2`, `same_region/2`, transitive `descends_from`, and
  `genetic_linguistic_correlation` become *derived, queryable facts* instead of bespoke joins.

## 5. The shared canonical contract (what both target)

- **Node types:** language, language-family, writing-system, culture, archaeological-culture,
  urheimat-hypothesis, religion, deity, myth-motif, art-tradition, literary-tradition, cuisine,
  ingredient, trade-good, battle, place, migration-route (extensible).
- **Edge types:** descended-from, split-from, merged-with, influenced-by, conquered-by,
  absorbed-into, spoken-in, located-in, contemporary-with, part-of-period, borrowed-from,
  cognate-with, derived-from, syncretized-with (extensible).
- **Identity:** `csid` primary; anchors `wikidata_qid`, `iso639_3`/`glottocode` (languages),
  `pleiades_id`/`tgn_id` (places). LinguaScrape ids retained as an alias column for round-trip.
- **Provenance on every row:** `source`, `source_url`, `retrieved_at`, `confidence` — with
  `source = "linguascrape"` for LinguaScrape-origin rows and original `sources` preserved.

## 6. Vendored monorepo (single repo, single history)

culture-scrape is **vendored into this repo at `packages/culture-scrape/`** (a fresh copy of its
tracked files — its 105-commit upstream history is intentionally *not* imported, so LinguaScrape's
history stays clean). Because both projects now live in one repo, `ralphy` can modify either side
and commit atomically — there is **no cross-repo split**. Work still splits by *language/runtime*:

| Work | Runtime | Location |
|---|---|---|
| Canonical schema contract doc + machine-readable schema | shared | `docs/`, `shared/`, authored by `ralph/15` |
| Lexicons ingestion adapter/job; edge extraction; Datalog rules; Neo4j load; reconciliation tuning | **Python** | `packages/culture-scrape/` (its own `ralph/` tasklists live at `packages/culture-scrape/ralph/`) |
| Neo4j TS driver, proxy routes, explorer adapter, graph views, provenance UI, write-back export | **TypeScript** | `server/`, `client/`, authored by `ralph/15`–`16` |

→ The Python-side ingestion/reconciliation/Datalog work is now an in-repo concern under
`packages/culture-scrape/`; it can be driven by a dedicated LinguaScrape `ralph/` tasklist or by
culture-scrape's own vendored tasklists. Everything references this doc as the source of truth.

## 7. Phased convergence

1. **Contract** — ratify the canonical node/edge schema + id/provenance scheme (this doc + a
   machine-readable schema + per-TSV mapping table).
2. **Ingest** — culture-scrape ingests LinguaScrape `lexicons/*.tsv` (tabular adapter + mapping),
   extracting edges from `cultural-lineages`, family/parent links, and predecessor/successor ids.
3. **Reconcile** — merge LinguaScrape entities with Wikidata-sourced nodes (ISO for languages;
   name+type+region for cultures); log ambiguity; never silently mis-link.
4. **Store** — load the unified corpus into Neo4j under shared labels/constraints; materialize
   Datalog inference (including ported LinguaScrape correlations).
5. **Consume** — LinguaScrape gains a Neo4j TS driver layer + proxy; correlation queries migrate
   from in-memory TS to Cypher/Datalog incrementally; domain compute stays TS.
6. **Write-back** — human-curated LinguaScrape edits export to TSV and re-ingest; a QA gate
   detects drift (id overlap, unreconciled rate, schema changes).

## 8. Non-goals

- Rewriting LinguaScrape's backend or frontend language.
- Abandoning TSV — it remains the portable source of truth on both sides.
- Moving CPU-domain compute (linguistic distance, etymology) out of TS.

## 9. Ralph tasklists

See `ralph/README.md`. Convergence is tasklist **15** (foundation + shared schema, LinguaScrape
side), app graph consumption is **16**; the Python-side ingestion/reconciliation/Datalog work lives
in-repo under **`packages/culture-scrape/`** (its own tasklists at `packages/culture-scrape/ralph/`).
