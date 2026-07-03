# culture-scrape ↔ LinguaScrape: Data-Layer Convergence Plan

**Status:** Data-layer convergence **implemented** (US-001…US-008) · **Last updated:** 2026-07-02
**Decision:** Align the two data layers on a shared canonical schema with Neo4j/Datalog as
the correlation system-of-record. **Do not** rewrite the LinguaScrape backend to Python.

This doc is the *architecture / rationale* view. The concrete, machine-readable contract —
node/edge types, exact column headers, the per-lexicon mapping, export/reconcile/write-back/QA
behaviour — lives in [`docs/canonical-schema.md`](./canonical-schema.md), backed by
[`shared/canonical-schema.json`](../shared/canonical-schema.json) and
[`shared/lexicon-mapping.json`](../shared/lexicon-mapping.json). When the two disagree, the
machine-readable schema wins. §7–§10 below map each convergence capability to the code and to the
section of `canonical-schema.md` that specifies it.

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

## 3. Gap analysis → what the data layer now delivers

Full alignment requires six layers to match. The **Status** column records how the
data-layer-convergence work (US-001…US-008) closed each gap; the code lives under `scripts/`,
`shared/`, and `server/services/`, specified in `docs/canonical-schema.md`.

| Layer | culture-scrape | LinguaScrape today | Status |
|---|---|---|---|
| **Identity** | `csid` derived from Wikidata QID + reconciliation cascade (`wikidata_qid → getty_id → language code → normalized(name,type,region) → fuzzy`) | `id`, `iso639_1`, `iso639_2` on languages; opaque ids elsewhere; **no QIDs** | **DONE** — csid minted `cs:<node-type>:<linguascrape-id>`; `linguascrape_id` kept as round-trip alias; reconciliation keys (ISO codes; normalized name/type/region) emitted by `scripts/reconciliation-report.ts` (US-005). |
| **Entity schema** | `nodes/<type>.tsv`, typed Neo4j headers (`csid:ID`, `:LABEL`) | 57 domain TSVs (`languages.tsv`, `archaeological-cultures.tsv`, …) | **DONE** — every one of the 57 `lexicons/*.tsv` mapped to a canonical node/edge type (or `attribute`/`excluded`) in `shared/lexicon-mapping.json` (US-002); export writes `nodes/<node-type>.tsv` (US-004). |
| **Edges** | `edges/<type>.tsv` (`:START_ID`,`:END_ID`,`:TYPE`,`time_start:int`,`confidence:float`) | `cultural-lineages.tsv` = `source_id,target_id,relationship_type,time_start,time_end,confidence,evidence_types,sources`; archaeological cultures carry `predecessor/successor_culture_ids`; families carry `parent_id`; languages carry `family_id`/`parent_language_id` | **DONE** — `server/services/canonical-edges.ts` extracts edges from the whole-file edge tables **and** embedded FK columns; export writes `edges/<edge-type>.tsv` (US-003/US-004). |
| **Provenance** | every row: `source,source_url,source_query,retrieved_at,confidence` | `confidence` + `sources` on lineages/cultures only | **DONE** — all four provenance columns stamped on **every** node and edge; `source="linguascrape"`; citations preserved in `source_query`; URLs never fabricated; per-type coverage in the export manifest (US-006). |
| **Store / correlation** | Neo4j (graph) + Datalog (`.pl`/`.dl` inference rules) | in-memory TS (`cross-domain-correlation.ts`, `genetic-linguistic-correlation.ts`, relationship scoring) | **Data ready** — export is `neo4j-admin import`-clean; loading into Neo4j + migrating correlation to Cypher/Datalog is the Python side (`packages/culture-scrape/`) + `graph-app-integration`. CPU-domain compute stays TS. |
| **Ontology / dimensions** | temporal / geographic / linguistic / genetic | explorer dims: temporal/spatial/relational/hierarchical/categorical | **Contract ratified** — canonical dimension columns (`time_start`/`time_end`/`period`, `lat`/`lon`/`*_id`, `language_code`/`script`) defined in the schema; explorer-adapter mapping is downstream UI work. |

**Key insight:** `cultural-lineages.tsv` is already a hand-built edge table. culture-scrape
generalizes exactly that pattern across every domain — and the edge extractor now generalizes it
across LinguaScrape's embedded FK columns too.

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
history stays clean). Because both projects now live in one repo, a single Ralph run can modify
either side and commit atomically — there is **no cross-repo split**. Work still splits by
*language/runtime*:

| Work | Runtime | Location |
|---|---|---|
| Canonical schema contract doc + machine-readable schema | shared | `docs/`, `shared/`, PRD `tasks/ralph/data-layer-convergence.json` |
| Lexicons ingestion adapter/job; edge extraction; Datalog rules; Neo4j load; reconciliation tuning | **Python** | `packages/culture-scrape/`, PRD `tasks/ralph/linguascrape-convergence-python.json` |
| Neo4j TS driver, proxy routes, explorer adapter, graph views, provenance UI, write-back export | **TypeScript** | `server/`, `client/`, PRDs `tasks/ralph/{data-layer-convergence,graph-app-integration}.json` |

→ The Python-side ingestion/reconciliation/Datalog work is an in-repo concern under
`packages/culture-scrape/`, driven by its own Ralph PRD. Everything references this doc as the
source of truth.

## 7. The convergence toolchain (what's built)

The data-layer-convergence PRD delivered these artifacts. Each is specified in a section of
[`docs/canonical-schema.md`](./canonical-schema.md) and typecheck-clean under
`scripts/tsconfig.json` (note: `scripts/` is excluded from root `npm run check` — see
`scripts/CLAUDE.md`).

| Story | Capability | Code | Spec |
|---|---|---|---|
| US-001 | Canonical node/edge schema (17 node types, 14 edge types), identity + provenance columns | `shared/canonical-schema.json` (+ `.ts` types/validators) | §1–§5 |
| US-002 | Mapping of all 57 `lexicons/*.tsv` → canonical node/edge type, per-column disposition | `shared/lexicon-mapping.json` (+ `.ts`) | §6 |
| US-003 | Edge extraction from whole-file edge tables + embedded FK columns | `server/services/canonical-edges.ts` | §6.4 |
| US-004 | Export lexicons to canonical `nodes/*.tsv` + `edges/*.tsv` (idempotent, import-clean) | `scripts/export-for-culturescrape.ts` | §7 |
| US-005 | Reconciliation keys + dry-run bucket report (matched / ambiguous / likely-new) | `scripts/reconciliation-report.ts` | §8 |
| US-006 | Provenance on 100% of exported rows + per-type coverage metric | `scripts/export-for-culturescrape.ts` (`provenance` block) | §4.3, §7 |
| US-007 | Bidirectional write-back (graph → lexicons), conflict-safe, ambiguous-id-safe | `scripts/import-from-culturescrape.ts` | §9 |
| US-008 | Network-free QA gate: id-overlap, unreconciled rate, provenance, **schema-drift hard-fail** | `scripts/convergence-qa.ts` | §10 |

**Live snapshot** (committed): the export produces **5,351 nodes** across 17 node types and
**5,526 edges** across 7 edge types — see [`docs/culturescrape-export-manifest.json`](./culturescrape-export-manifest.json)
and [`docs/reconciliation-report.json`](./reconciliation-report.json). The `export/culturescrape/`
tree itself is gitignored (regenerate with the CLIs below).

## 8. End-to-end data flow

The round trip, with the exact command and artifact at each hop:

```
 lexicons/*.tsv  (source of truth, human-curated)
      │
      │ 1. EXPORT   npx tsx scripts/export-for-culturescrape.ts
      ▼
 export/culturescrape/nodes/<node-type>.tsv + edges/<edge-type>.tsv + manifest.json
      │              (source="linguascrape" provenance; csid = cs:<node-type>:<linguascrape-id>)
      │
      │ 2. RECONCILE (dry-run, network-free)   npx tsx scripts/reconciliation-report.ts
      ▼              → keys.tsv + report.json  (matched / ambiguous / likely-new buckets)
      │
      │ 3. INGEST + RECONCILE + LOAD  (Python — packages/culture-scrape/)
      ▼   tabular adapter → normalize → reconcile.py/merge.py → Neo4j load → Datalog
 shared graph  (Neo4j nodes/edges under shared labels + Datalog inference facts)
      │
      │ 4. CONSUME  (LinguaScrape TS)
      ▼   Neo4j TS driver (relational/graph queries) + FastAPI proxy (search / Datalog)
 LinguaScrape app  (UnifiedExplorer adapters, graph views, provenance UI)
      │
      │ 5. WRITE-BACK  npx tsx scripts/import-from-culturescrape.ts  [--overwrite]
      ▼   reads enriched canonical nodes/*.tsv → fills blank lexicon cells (gap-fill only)
 lexicons/*.tsv   (enriched; conflicts reported, never silently resolved)

 GATE (any time, CI):  npx tsx scripts/convergence-qa.ts   # exits 1 on schema/id drift
```

- **Steps 1, 2, 5, GATE are TypeScript in this repo** (`scripts/`). Step 3 is Python under
  `packages/culture-scrape/`; step 4 is the LinguaScrape app + the `graph-app-integration` PRD.
- **Step 3 is itself a one-command, offline, reproducible recipe:** `culturescrape run
  jobs/linguascrape.yml` (re)builds the LinguaScrape-inclusive corpus — ingest → reconcile →
  link → Datalog/Neo4j — from the committed fixture export, with a committed manifest
  (`packages/culture-scrape/docs/convergence-manifest.json`) asserted against a fresh build in
  CI. See [`packages/culture-scrape/docs/convergence-build.md`](../packages/culture-scrape/docs/convergence-build.md).
- **TSV is the source of truth at both ends.** Nothing in the graph is authoritative for a
  human-curated lexicon column — the graph enriches blanks and owns edges (see §10).
- **Provenance survives the whole trip:** every exported row carries `source`/`source_url`/
  `retrieved_at`/`confidence`; the original citation rides in the node `source_query`.

## 9. Add a new LinguaScrape domain to the graph

To bring a new (or newly-relevant) `lexicons/<file>.tsv` into the shared graph:

1. **Map the file** in [`shared/lexicon-mapping.json`](../shared/lexicon-mapping.json): add an
   entry with a `kind` (`node` / `edge` / `attribute` / `excluded`) and, for a `node`/`edge`
   file, a `node` type from `shared/canonical-schema.json`. If the domain needs a node type that
   doesn't exist yet, add it to `nodeTypes` (or an edge to `edgeTypes`) in the canonical schema
   **and** to the §1/§2 tables in `canonical-schema.md` first.
2. **Give every column a disposition** (`target` / `edge` / `property` / `drop`). Follow the
   naming conventions in `canonical-schema.md` §6.2 (`id → linguascrape_id`, `name → name`,
   `sources → source`, `latitude/longitude → lat/lon`, …). A `drop` needs a documented `reason`.
3. **Embedded relationships** (FK columns like `parent_id`, `*_culture_ids`): give them the
   `edge` disposition and, if the target `:TYPE` value vocabulary is free-text, add it to the
   `EDGE_TYPE_VALUE_MAPS` in `server/services/canonical-edges.ts` (US-003).
4. **Run the mapping validator:** `npx vitest run shared/lexicon-mapping.test.ts` — it asserts
   totality (all `lexicons/*.tsv` accounted for) and that every referenced column is real.
5. **Regenerate the export & snapshots:**
   `npx tsx scripts/export-for-culturescrape.ts` then
   `npx tsx scripts/reconciliation-report.ts`, and refresh the committed snapshots
   (`docs/culturescrape-export-manifest.json`, `docs/reconciliation-report.json`) — the
   live-corpus tests assert the snapshots match a fresh build.
6. **Add reconciliation keys** if the domain has a global anchor (a language code, a Getty/Wikidata
   id if ever present); otherwise it lands as `likely-new` and is fine.
7. **Run the gate:** `npx tsx scripts/convergence-qa.ts` must exit `0` (no drift).
8. **Python side:** if the new node/edge type needs bespoke reconcile/ontology handling, cross-link
   the work under `packages/culture-scrape/` (see §10) — the tabular adapter ingests the new
   `nodes/`/`edges/` files without code changes as long as headers match the canonical schema.

## 10. Which side owns which step

| Step | Owner (runtime / location) | Reference |
|---|---|---|
| Canonical schema + lexicon mapping (contract) | **shared** — `shared/`, `docs/` | `canonical-schema.md` §1–§6 |
| Export / reconcile dry-run / write-back / QA gate | **LinguaScrape (TS)** — `scripts/`, `server/services/` | `canonical-schema.md` §7–§10 |
| Tabular ingestion, reconcile/merge, ontology linking, Neo4j load, Datalog rules | **culture-scrape (Python)** — `packages/culture-scrape/` | see below |
| Neo4j TS driver, FastAPI proxy, explorer adapters, graph/provenance UI | **LinguaScrape (TS)** — `server/`, `client/` | `graph-app-integration` PRD |

Python-side cross-links (same repo, `packages/culture-scrape/`):

- **Ingesting the export:** [`docs/reconcile-linguascrape.md`](../packages/culture-scrape/docs/reconcile-linguascrape.md)
  — how the export flows through reconcile, and which side owns each merge decision.
- **Reconciliation cascade:** `src/culturescrape/schema/reconcile.py` (QID lookup) +
  `merge.py` (clustering/merge); see [`docs/data-model.md`](../packages/culture-scrape/docs/data-model.md).
- **Typed import headers:** `src/culturescrape/schema/headers.py` — the canonical column contract
  in §4 deliberately mirrors these so the export is `neo4j-admin import`-clean.
- **Neo4j / Datalog:** [`docs/neo4j.md`](../packages/culture-scrape/docs/neo4j.md),
  [`docs/datalog.md`](../packages/culture-scrape/docs/datalog.md),
  [`docs/ontology.md`](../packages/culture-scrape/docs/ontology.md).
- **Python-side Ralph PRDs:** `packages/culture-scrape/ralph/` (acquisition, schema/entity-resolution,
  ontology-linking, neo4j-converter, datalog-exporter, …).

## 10b. App-side graph API routes (`/api/graph/*`)

The browser talks only to the LinguaScrape origin. `server/routes/graph.ts`
(`registerGraphRoutes`, wired in `server/routes.ts`) exposes a first-party proxy over
the shared graph. Node/neighborhood lookups run through the Neo4j driver layer
(`server/services/graph-store.ts`); search/metrics run through the FastAPI sidecar client
(`server/services/culturescrape-client.ts`).

| Method & path | Backend | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/graph/search?q=&limit=` | sidecar `/search` | `{ query, results[] }` | empty `q` → `{ query:"", results:[] }` without hitting the sidecar |
| `GET /api/graph/node/:id` | Neo4j `getNode` | `{ node }` | `:id` is the csid; missing node → **404** |
| `GET /api/graph/neighborhood/:id?depth=` | Neo4j `getNeighborhood` | `{ root, nodes[], edges[], depth }` | `depth` clamped to 1..3 (default 1); missing focus node → **404** |
| `GET /api/graph/overview?limit=` | Neo4j `getGraphOverview` | `{ nodes[], edges[] }` | bounded snapshot (first `limit` nodes + edges among them; `limit` clamped 1..1000, default 250) powering the shared-graph explorer dataset (US-008) |
| `GET /api/graph/metrics` | sidecar `/metrics` | graph-level metrics | — |
| `GET /api/graph/resolve?type=&id=&name=&region=` | graph-resolver (lexicons) | `{ resolved: { csid, confidence, method } \| null }` | resolves a LinguaScrape entity ref → csid (US-006); lexicon-backed so it works even when Neo4j is offline; `null` covers no-match **and** ambiguous; missing `type` → **400** |
| `GET /api/graph/status` | both | `{ available, neo4j, sidecar, checkedAt }` | always **200**; `available = neo4j \|\| sidecar`; served from the short-cached graph-health service |

**Degradation contract.** When a backend is unreachable the query routes answer
**HTTP 503** with a structured `{ available: false, error, detail }` body and never crash
(`GraphUnavailableError` / `CultureScrapeUnavailableError` → 503). A malformed/unusable
upstream response (`CultureScrapeError`) maps to **502**. `/api/graph/status` is itself a
health probe and always returns 200 so the client can gate graph-dependent UI (US-005).

**Health & graceful degradation (US-005).** `/api/graph/status` delegates to
`server/services/graph-health.ts` (`getGraphHealth()`), which aggregates both backends'
`isAvailable()` into one verdict, pull-through cached for `GRAPH_HEALTH_TTL_MS` (default 5s)
so a burst of probes issues at most one round of checks. On the client, the
`useGraphAvailability()` hook (`client/src/hooks/use-graph-availability.tsx`) polls that
route (30s interval, `retry:false`, fails closed) and exposes `{ available, neo4j, sidecar,
isEnabled(backend), unavailableReason(backend) }`. Graph-dependent UI wraps its
trigger/tab in `<GraphFeatureGate backend=… mode="disable"|"hide">`
(`client/src/components/graph/GraphFeatureGate.tsx`), which dims + tooltips (or hides) the
feature when its backend is offline. Pure decision logic lives in
`client/src/lib/graph/availability.ts` (`isGraphFeatureEnabled` / `graphUnavailableReason`).

Integration tests: `server/routes/graph.test.ts` mounts the routes on a real Express app
with both services module-mocked and exercises every route including the unavailable path.

**Neighborhood visualization (US-007).** Entity detail panels (language, culture profile)
carry a `<ShowInGraphButton entity={{ type, id, name, region }}>`
(`client/src/components/graph/ShowInGraphButton.tsx`). The trigger is gated on the `neo4j`
backend via `GraphFeatureGate`; clicking it opens a dialog that resolves the entity to a
csid through `GET /api/graph/resolve` (US-006) and then `React.lazy`-loads
`GraphNeighborhoodView` (`client/src/components/graph/GraphNeighborhoodView.tsx`). That view
fetches `GET /api/graph/neighborhood/:id?depth=`, projects the payload through the pure
transforms in `client/src/lib/graph/neighborhood-graph.ts` (nodes coloured/typed by first
`:LABEL`, edges labelled by `:TYPE`), and renders it with the shared force-directed
`NetworkGraph`. Depth is adjustable 1–3; loading, empty, and graph-unavailable states are all
handled. The heavy d3 renderer is code-split into its own chunk so it only loads on open.

**Shared-graph explorer dataset (US-008).** The shared graph is exposed through the existing
adapter-driven UnifiedExplorer as the **"Shared Culture Graph"** dataset
(`client/src/lib/visualization/adapters/culturescrape.adapter.ts`, registered in
`registry.ts`). Its `endpoint` is `GET /api/graph/overview`; `unwrap` pairs each node with
its incident edges, and `project` maps the `{ nodes, edges }` payload into **all five**
explorer dimensions — relational (nodes coloured by `:LABEL`, links by `:TYPE`), hierarchical
(a containment/descent forest derived from parent-type edges like `DESCENDS_FROM` / `PART_OF`),
temporal (`time_start`/`time_end`), spatial (coordinates), and categorical. Because it declares
every dimension it renders through every Generic\* visualization (Tree, Timeline, Map, 3D Map,
Network, Lineage, Table). `filterableFacets` expose entity type (`:LABEL`), time period (500-year
bands) and region; `detail` builds a `DetailDescriptor` including provenance (source, source_url,
retrieved_at, confidence) so graph facts stay attributable. Pure transforms are unit-tested in
`culturescrape.adapter.test.ts`.

**Federated global search (US-009).** The unified search box (`GET /api/search`,
`server/services/global-search.ts`, dialog `client/src/components/global-search-dialog.tsx`)
merges local-corpus hits with shared-graph hits from the sidecar `/search`. `federatedSearch`
runs the existing `globalSearch` (local) and the culture-scrape client `search` in sequence;
`mergeGraphResults` combines them:

- **Ranking.** Local hits keep their fuzzy token score (`[0, 1]`). A graph hit that matched an
  authoritative field (`csid` / `wikidata_qid`) ranks `1.0`; a name-only match ranks by the same
  fuzzy scorer against the query (floored at `0.4` so a real hit is never dropped). Both sets are
  merged and sorted by relevance descending, capped at 50.
- **Dedup by csid alias.** Each local result is resolved to its csid via the US-006 resolver
  (`getGraphResolver`); any graph hit sharing that csid is dropped — the **local result wins**
  because it carries an in-app navigable link. Duplicate csids inside the sidecar payload are
  also collapsed.
- **Graceful degradation.** If the sidecar is unavailable, disabled, or returns a malformed
  payload, the graph error is swallowed and the query returns **local-only** results — no error
  is surfaced to the user.
- Each result carries a `source: "local" | "graph"` badge; graph results additionally carry
  `csid`, `confidence`, and a `provenance` object (`source`, `qid`, `matchField`, `graphLink`)
  rendered in the dialog. Merge/dedup/ranking + the local-only fallback are unit-tested in
  `server/services/global-search.test.ts` (no storage / network / Neo4j).

## 11. Non-goals

- Rewriting LinguaScrape's backend or frontend language.
- Abandoning TSV — it remains the portable source of truth on both sides.
- Moving CPU-domain compute (linguistic distance, etymology) out of TS.

## 12. Ralph PRDs

The work is driven by [Ralph](../docs/ralph-workflow.md) PRDs under `tasks/ralph/` (run via
`scripts/ralph/run-all.sh`). Convergence-related PRDs, in dependency order:
`data-layer-convergence` (**implemented**, §7) → `linguascrape-convergence-python` (Python side) →
`graph-app-integration`.
The remaining roadmap PRDs (`data-acquisition`, `narrative-education`, `platform-infra`,
`speculative`) build on them.
