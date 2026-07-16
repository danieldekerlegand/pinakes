# culture-scrape ↔ Pinakes: Data-Layer Convergence Plan

**Status:** Data-layer convergence **implemented** (US-001…US-008) · app-side graph
integration **implemented** (`graph-app-integration` US-001…US-011) · **Last updated:** 2026-07-03
**Decision:** Align the two data layers on a shared canonical schema with Neo4j/Datalog as
the correlation system-of-record. **Do not** rewrite the Pinakes backend to Python.

This doc is the *architecture / rationale* view. The concrete, machine-readable contract —
node/edge types, exact column headers, the per-lexicon mapping, export/reconcile/write-back/QA
behaviour — lives in [`docs/canonical-schema.md`](./canonical-schema.md), backed by
[`shared/canonical-schema.json`](../shared/canonical-schema.json) and
[`shared/lexicon-mapping.json`](../shared/lexicon-mapping.json). When the two disagree, the
machine-readable schema wins. §7–§10 below map each convergence capability to the code and to the
section of `canonical-schema.md` that specifies it.

---

## 1. Goal

Make Pinakes's data and culture-scrape's data **one correlatable body of knowledge** —
so a language, an archaeological culture, a cuisine, a deity, and a trade good can be related,
traversed, and reasoned over together — without discarding Pinakes's TypeScript app or
culture-scrape's Python pipeline.

The principle: **alignment is a schema-and-store problem, not a language problem.** Two systems
converge through a shared *data contract* (identity, entity/edge schema, provenance, a common
store), which a TS service speaks as well as a Python one (Neo4j ships a first-class TS driver).

## 2. Why not a Python rewrite

- A Python rewrite of Pinakes's ~40k-LOC Express backend would **not itself create
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

| Layer | culture-scrape | Pinakes today | Status |
|---|---|---|---|
| **Identity** | `csid` derived from Wikidata QID + reconciliation cascade (`wikidata_qid → getty_id → language code → normalized(name,type,region) → fuzzy`) | `id`, `iso639_1`, `iso639_2` on languages; opaque ids elsewhere; **no QIDs** | **DONE** — csid QID-anchored `cs:<node-type>:<QID>` when a row carries a `wikidata_qid`, else `cs:<node-type>:<pinakes-id>` (US-005); `pinakes_id` kept as round-trip alias; reconciliation keys (ISO codes; normalized name/type/region) emitted by `scripts/reconciliation-report.ts`. |
| **Entity schema** | `nodes/<type>.tsv`, typed Neo4j headers (`csid:ID`, `:LABEL`) | 57 domain TSVs (`languages.tsv`, `archaeological-cultures.tsv`, …) | **DONE** — every one of the 57 `lexicons/*.tsv` mapped to a canonical node/edge type (or `attribute`/`excluded`) in `shared/lexicon-mapping.json` (US-002); export writes `nodes/<node-type>.tsv` (US-004). |
| **Edges** | `edges/<type>.tsv` (`:START_ID`,`:END_ID`,`:TYPE`,`time_start:int`,`confidence:float`) | `cultural-lineages.tsv` = `source_id,target_id,relationship_type,time_start,time_end,confidence,evidence_types,sources`; archaeological cultures carry `predecessor/successor_culture_ids`; families carry `parent_id`; languages carry `family_id`/`parent_language_id` | **DONE** — `server/services/canonical-edges.ts` extracts edges from the whole-file edge tables **and** embedded FK columns; export writes `edges/<edge-type>.tsv` (US-003/US-004). |
| **Provenance** | every row: `source,source_url,source_query,retrieved_at,confidence` | `confidence` + `sources` on lineages/cultures only | **DONE** — all four provenance columns stamped on **every** node and edge; `source="pinakes"`; citations preserved in `source_query`; URLs never fabricated; per-type coverage in the export manifest (US-006). |
| **Store / correlation** | Neo4j (graph) + Datalog (`.pl`/`.dl` inference rules) | in-memory TS (`cross-domain-correlation.ts`, `genetic-linguistic-correlation.ts`, relationship scoring) | **Data ready** — export is `neo4j-admin import`-clean; loading into Neo4j + migrating correlation to Cypher/Datalog is the Python side (`packages/culture-scrape/`) + `graph-app-integration`. CPU-domain compute stays TS. |
| **Ontology / dimensions** | temporal / geographic / linguistic / genetic | explorer dims: temporal/spatial/relational/hierarchical/categorical | **Contract ratified** — canonical dimension columns (`time_start`/`time_end`/`period`, `lat`/`lon`/`*_id`, `language_code`/`script`) defined in the schema; explorer-adapter mapping is downstream UI work. |

**Key insight:** `cultural-lineages.tsv` is already a hand-built edge table. culture-scrape
generalizes exactly that pattern across every domain — and the edge extractor now generalizes it
across Pinakes's embedded FK columns too.

## 4. Target architecture

```
 ┌─────────── culture-scrape (Python) — canonical data + correlation engine ───────────┐
 │  YAML categories/blueprints → acquire (Wikidata dump/SPARQL, Getty, Pleiades,        │
 │                                + NEW: Pinakes lexicons via the tabular adapter) │
 │      → normalize → reconcile (csid / wikidata_qid) → ontology link → QA gates         │
 │      → canonical nodes/edges TSV → Neo4j (graph) → Datalog (.pl/.dl inference)        │
 └───────────────────────────────────────────────────────────────────────────────────────┘
        ▲ TSV = portable source of truth (both projects agree)   │ Cypher · Datalog · REST
  human-curated edits (write-back) ──────────────────────────────▼
 ┌─────────── Pinakes (TypeScript) — presentation + domain compute ───────────────┐
 │  Express: Neo4j TS driver (relational queries) + FastAPI proxy (search / Datalog);   │
 │           keeps TS-only domain compute (linguistic distance, etymology)              │
 │  React/Vite: UnifiedExplorer adapters, graph neighborhood views, provenance UI       │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

- **One canonical model, one reconciliation cascade, one provenance model, one correlation
  store.** TSV stays the portable, git-diffable source of truth on both sides.
- culture-scrape's `tabular.py` already ingests arbitrary TSV/CSV, so Pinakes's `lexicons/`
  become **just another acquisition source**.
- Pinakes queries the shared graph two ways: **Neo4j TS driver** for relational/graph
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
  `pleiades_id`/`tgn_id` (places). Pinakes ids retained as an alias column for round-trip.
- **Provenance on every row:** `source`, `source_url`, `retrieved_at`, `confidence` — with
  `source = "pinakes"` for Pinakes-origin rows and original `sources` preserved.

## 6. Vendored monorepo (single repo, single history)

culture-scrape is **vendored into this repo at `packages/culture-scrape/`** (a fresh copy of its
tracked files — its 105-commit upstream history is intentionally *not* imported, so Pinakes's
history stays clean). Because both projects now live in one repo, a single Ralph run can modify
either side and commit atomically — there is **no cross-repo split**. Work still splits by
*language/runtime*:

| Work | Runtime | Location |
|---|---|---|
| Canonical schema contract doc + machine-readable schema | shared | `docs/`, `shared/`, PRD `tasks/ralph/data-layer-convergence.json` |
| Lexicons ingestion adapter/job; edge extraction; Datalog rules; Neo4j load; reconciliation tuning | **Python** | `packages/culture-scrape/`, PRD `tasks/ralph/pinakes-convergence-python.json` |
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

**Live snapshot** (committed): the export produces **6,835 nodes** across 17 node types and
**5,836 edges** across 8 edge types — see [`docs/culturescrape-export-manifest.json`](./culturescrape-export-manifest.json)
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
      │              (source="pinakes" provenance; csid = cs:<node-type>:<QID>, else <pinakes-id>)
      │
      │ 2. RECONCILE (dry-run, network-free)   npx tsx scripts/reconciliation-report.ts
      ▼              → keys.tsv + report.json  (matched / ambiguous / likely-new buckets)
      │
      │ 3. INGEST + RECONCILE + LOAD  (Python — packages/culture-scrape/)
      ▼   tabular adapter → normalize → reconcile.py/merge.py → Neo4j load → Datalog
 shared graph  (Neo4j nodes/edges under shared labels + Datalog inference facts)
      │
      │ 4. CONSUME  (Pinakes TS)
      ▼   Neo4j TS driver (relational/graph queries) + FastAPI proxy (search / Datalog)
 Pinakes app  (UnifiedExplorer adapters, graph views, provenance UI)
      │
      │ 5. WRITE-BACK  npx tsx scripts/import-from-culturescrape.ts  [--overwrite]
      ▼   reads enriched canonical nodes/*.tsv → fills blank lexicon cells (gap-fill only)
 lexicons/*.tsv   (enriched; conflicts reported, never silently resolved)

 GATE (any time, CI):  npx tsx scripts/convergence-qa.ts   # exits 1 on schema/id drift
```

- **Steps 1, 2, 5, GATE are TypeScript in this repo** (`scripts/`). Step 3 is Python under
  `packages/culture-scrape/`; step 4 is the Pinakes app + the `graph-app-integration` PRD.
- **Step 3 is itself a one-command, offline, reproducible recipe:** `culturescrape run
  jobs/pinakes.yml` (re)builds the Pinakes-inclusive corpus — ingest → reconcile →
  link → Datalog/Neo4j — from the committed fixture export, with a committed manifest
  (`packages/culture-scrape/docs/convergence-manifest.json`) asserted against a fresh build in
  CI. The full operational recipe — build the *live* corpus, load Neo4j, materialize Datalog,
  smoke-test from the app, plus refresh cadence and the add-a-domain checklist — is the
  runbook [`packages/culture-scrape/docs/convergence-build.md`](../packages/culture-scrape/docs/convergence-build.md).
- **TSV is the source of truth at both ends.** Nothing in the graph is authoritative for a
  human-curated lexicon column — the graph enriches blanks and owns edges (see §10).
- **Provenance survives the whole trip:** every exported row carries `source`/`source_url`/
  `retrieved_at`/`confidence`; the original citation rides in the node `source_query`.

## 9. Add a new Pinakes domain to the graph

To bring a new (or newly-relevant) `lexicons/<file>.tsv` into the shared graph:

1. **Map the file** in [`shared/lexicon-mapping.json`](../shared/lexicon-mapping.json): add an
   entry with a `kind` (`node` / `edge` / `attribute` / `excluded`) and, for a `node`/`edge`
   file, a `node` type from `shared/canonical-schema.json`. If the domain needs a node type that
   doesn't exist yet, add it to `nodeTypes` (or an edge to `edgeTypes`) in the canonical schema
   **and** to the §1/§2 tables in `canonical-schema.md` first.
2. **Give every column a disposition** (`target` / `edge` / `property` / `drop`). Follow the
   naming conventions in `canonical-schema.md` §6.2 (`id → pinakes_id`, `name → name`,
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

Steps 1–8 map the domain; to then land it in the **live** graph (rebuild the full corpus →
load Neo4j → materialize Datalog → smoke-test from the app), follow the operational runbook
[`convergence-build.md` "Add a new domain to the live graph"](../packages/culture-scrape/docs/convergence-build.md).

## 10. Which side owns which step

| Step | Owner (runtime / location) | Reference |
|---|---|---|
| Canonical schema + lexicon mapping (contract) | **shared** — `shared/`, `docs/` | `canonical-schema.md` §1–§6 |
| Export / reconcile dry-run / write-back / QA gate | **Pinakes (TS)** — `scripts/`, `server/services/` | `canonical-schema.md` §7–§10 |
| Tabular ingestion, reconcile/merge, ontology linking, Neo4j load, Datalog rules | **culture-scrape (Python)** — `packages/culture-scrape/` | see below |
| Neo4j TS driver, FastAPI proxy, explorer adapters, graph/provenance UI | **Pinakes (TS)** — `server/`, `client/` | `graph-app-integration` PRD |

Python-side cross-links (same repo, `packages/culture-scrape/`):

- **Ingesting the export:** [`docs/reconcile-pinakes.md`](../packages/culture-scrape/docs/reconcile-pinakes.md)
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

The browser talks only to the Pinakes origin. `server/routes/graph.ts`
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
| `POST /api/graph/datalog` | sidecar `/datalog` | `{ ran, rows[][], problems[], error, reason }` | research console (US-011); body `{ goal }` (ad-hoc `main/0`) or `{ example }` (shipped slug); neither → **400**; sidecar lint `error`/`reason` passed through, not swallowed |
| `POST /api/graph/cypher` | sidecar `/neo4j` | `{ columns[], rows[][] }` | research console (US-011); body `{ query }`; **read-only** — empty query or a write clause (CREATE/MERGE/DELETE/SET/REMOVE/DROP/FOREACH/LOAD CSV) → **400** before the sidecar is called; a sidecar syntax error surfaces as **502** |
| `GET /api/graph/resolve?type=&id=&name=&region=` | graph-resolver (lexicons) | `{ resolved: { csid, confidence, method } \| null }` | resolves a Pinakes entity ref → csid (US-006); lexicon-backed so it works even when Neo4j is offline; `null` covers no-match **and** ambiguous; missing `type` → **400** |
| `GET /api/graph/status` | both | `{ available, neo4j, sidecar, checkedAt }` | always **200**; `available = neo4j \|\| sidecar`; served from the short-cached graph-health service |

**Sidecar JSON contract (US-003).** The FastAPI explorer's `/search`, `/metrics`, and
`/completeness` views content-negotiate on `Accept`: a browser gets the HTML explorer, and
the TS client's `Accept: application/json` (same URLs) gets JSON with the shapes
`culturescrape-client.ts` models — `/search` → `{ query, results[] }` (`SearchHit` rows),
`/metrics` → `culturescrape.ontology.metrics.to_json` (a corpus with no readable metrics
answers a zeroed document), `/completeness` → `{ qa, rows[] }`. The two representations are
built from the same corpus data (parity); the negotiation lives in
`packages/culture-scrape/src/culturescrape/explorer/app.py` (`_wants_json`).

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

**Provenance & confidence surfacing (US-010).** Graph facts carry the culture-scrape
provenance columns as node/edge properties (`source`, `source_url`, `retrieved_at`,
`confidence`). The pure module `client/src/lib/graph/provenance.ts` normalises these into a
`Provenance` record and holds the display logic:

- **Sourced vs derived.** `classifyProvenance` marks a fact **sourced** when it carries a
  citation URL or a non-inference `source`, and **derived** when its `source` is an inference
  marker (`inference` / `datalog` / `derived` / `computed` / `correlation`) or it has nothing to
  cite. The Datalog layer is a *derived* view of the TSV source of truth, so materialised
  edges/nodes read as derived.
- **Low-confidence flag.** `isLowConfidence` flags `confidence ≤ 0.5`; `formatConfidence`
  renders a rounded percent.
- **Safe links.** `safeExternalUrl` only returns `http(s)` URLs, so the source link is rendered
  as `<a target="_blank" rel="noopener noreferrer">` and never an unsafe scheme.

The reusable components live in `client/src/components/graph/Provenance.tsx`: `<ProvenanceBadge>`
(compact sourced/derived pill + confidence chip) and `<ProvenanceList>` (full breakdown with the
safe source link). They are used in the explorer detail panel (`UnifiedExplorer` renders
`DetailDescriptor.provenance` via `<ProvenanceList>`; the culturescrape adapter's `detail`
supplies it) and in the graph neighborhood view (root-node `<ProvenanceBadge>`). The pure
classification/formatting logic is unit-tested in `client/src/lib/graph/provenance.test.ts` (the
repo has no jsdom, so the "component tests" exercise that module — same convention as US-007/008).

**Datalog/Cypher research console (US-011).** An advanced, experimental surface at
`/advanced-tools` (`client/src/pages/advanced-tools.tsx`) — intentionally **not** linked from the
primary navigation — lets a researcher run read-only inference queries against the shared graph:
Datalog goals over culture-scrape's rule set (`POST /api/graph/datalog`) and Cypher reads against
Neo4j (`POST /api/graph/cypher`). It ships example presets (`contemporary_with/2`, `same_region/2`
via `within_region/2`, and transitive `descends_from` via `ancestor/2` for Datalog; `descends_from`
edges and a language sample for Cypher — `client/src/lib/graph/research-console.ts`). Queries are
**read-only** on both sides: the UI states it and the server rejects Cypher write clauses with 400
before the sidecar is called. Sidecar errors are surfaced, not swallowed — a Datalog lint
`error`/`reason` (e.g. when `swipl` is absent) renders in the panel, and a Cypher syntax error comes
back as 502 with its detail. The whole tool is wrapped in `<GraphFeatureGate backend="sidecar">` so
its Run buttons disable with an explanatory tooltip when the sidecar is offline (US-005). Route
degradation (success + unavailable) is covered by `server/routes/graph.test.ts`; the pure preset /
result-normalisation logic by `client/src/lib/graph/research-console.test.ts`.

## 10c. App-side runbook (run · deploy · extend)

The `graph-app-integration` PRD (US-001…US-011) wires the shared graph into the running app.
This section is the operator/contributor runbook for that integration: how to configure it, run
it locally, deploy it, and extend it. It is accurate against the code as of US-001…US-011.

### Environment variables

All graph config lives in `.env` (copy from [`.env.example`](../.env.example)). The server reads
these; the app **degrades gracefully** and runs local-only when they are absent or the services are
down (see the degradation contract in §10b).

| Var | Read by | Default | Purpose |
| --- | --- | --- | --- |
| `CULTURESCRAPE_API_URL` | `server/services/culturescrape-client.ts` | `http://localhost:8800` | Base URL of the FastAPI sidecar (search / metrics / datalog / cypher). |
| `CULTURESCRAPE_ENABLED` | `culturescrape-client.ts` | `true` | Falsey ⇒ `isAvailable()` returns false, sidecar-backed features disable without errors. |
| `CULTURESCRAPE_TIMEOUT_MS` | `culturescrape-client.ts` | `10000` | Per-request timeout for the sidecar HTTP client. |
| `CULTURESCRAPE_CORPUS` | docker-compose (`culturescrape` service) | `tests/fixtures/explorer-corpus` | Corpus the sidecar serves; point at a mounted built corpus for real data. |
| `NEO4J_URI` | `server/services/graph-store.ts` | `bolt://localhost:7687` | Bolt endpoint of the shared graph store. |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `graph-store.ts` | `neo4j` / *(empty)* | Neo4j credentials. |
| `NEO4J_AUTH` | docker-compose (`neo4j` service) | `neo4j/pinakes` | `user/password` for the container; **must equal** `NEO4J_USER`/`NEO4J_PASSWORD`. |
| `NEO4J_DATABASE` | `graph-store.ts` | `neo4j` | Target database name. |
| `NEO4J_QUERY_TIMEOUT_MS` / `NEO4J_CONNECTION_TIMEOUT_MS` | `graph-store.ts` | `10000` / `5000` | Driver query + connection-acquisition timeouts. |
| `NEO4J_MAX_POOL_SIZE` | `graph-store.ts` | `50` | Connection-pool ceiling. |
| `GRAPH_HEALTH_TTL_MS` | `server/services/graph-health.ts` | `5000` | TTL of the cached `/api/graph/status` verdict. |
| `CORRELATION_GRAPH_ENABLED` | `server/services/cross-domain-correlation-graph.ts` | *(off)* | Truthy ⇒ `POST /api/cross-domain/correlate` serves graph-eligible domains from Neo4j (US-007, §10d), falling back to the in-memory path when the graph is down. |

### Local development

- **App only (no graph)** — `npm run dev`. Graph-dependent UI (the "Show in graph" button, the
  Shared Culture Graph explorer dataset, the `/advanced-tools` console, graph search hits) is
  disabled with an explanatory tooltip; everything else works. Nothing needs Docker.
- **App + sidecar + Neo4j** — `npm run dev:full` (`scripts/dev-full.sh`). Starts the
  `culturescrape` and `neo4j` docker-compose services detached, waits for the sidecar health
  endpoint, then runs `npm run dev` in the foreground and stops the services on exit. Requires
  Docker; if the sidecar/graph never come up the app still starts and degrades.
- **Just the services** — `npm run sidecar:up` (build + start `culturescrape` + `neo4j`) and
  `npm run sidecar:down`. Useful when running the app from an IDE.

`docker-compose.yml` defines two services: `culturescrape` (built from `packages/culture-scrape/`,
port **8800**) and `neo4j` (`neo4j:5`, HTTP **7474** / Bolt **7687**). Neo4j sits behind the
`graph` compose profile (it is heavy) so a bare `docker compose up` starts only the sidecar; the
scripts above name both services explicitly, or use `docker compose --profile graph up`. Verify
reachability: `curl -sf http://localhost:8800/` (sidecar) and open `http://localhost:7474`
(Neo4j browser).

### Production deployment

The app is deployed as today (`npm run build` → `npm start`, a single Express+static bundle). The
graph integration adds **two out-of-process dependencies** that the server reaches over the network:

1. **Neo4j** — a managed instance (Aura or self-hosted). Set `NEO4J_URI` (use `neo4j+s://` for
   TLS in prod), `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`. The driver is lazily created,
   pooled, and torn down on `SIGTERM`/`SIGINT` (`closeGraphStore()` in `server/index.ts`).
2. **culture-scrape FastAPI sidecar** — run `culturescrape serve` (the `packages/culture-scrape/`
   Dockerfile) as a sibling service pointed at a built corpus (`CULTURESCRAPE_CORPUS`); set
   `CULTURESCRAPE_API_URL` to its internal URL. Keep it on the private network — the browser never
   talks to it directly (all access is proxied through `/api/graph/*`).

Both are **optional at runtime**: if either is unset or unreachable the server logs it, answers the
affected routes with 503 `{ available:false }`, and the client hides/disables graph UI (§10b). So a
deploy without the graph stack is a valid, degraded-but-working configuration. Health for
monitoring: `GET /api/graph/status` (always 200; `{ available, neo4j, sidecar, checkedAt }`).

### Add a new proxied / graph endpoint

To surface a new shared-graph capability at the app origin:

1. **Pick the backend.** Relational/graph traversal → add a typed method to
   `server/services/graph-store.ts` (parameterized Cypher, coerce Neo4j `Integer`s at the boundary,
   throw `GraphUnavailableError` when the driver is down). A sidecar-served capability (search,
   metrics, datalog, cypher, completeness) → add a **zod-validated** wrapper to
   `server/services/culturescrape-client.ts` (throw `CultureScrapeUnavailableError` for
   transport/timeout/5xx/disabled, `CultureScrapeError` for 4xx/malformed).
2. **Add the route** in `server/routes/graph.ts` under `registerGraphRoutes`. Reuse the shared
   `handleError()` so `GraphUnavailableError`/`CultureScrapeUnavailableError` → **503**
   `{ available:false, error, detail }` and `CultureScrapeError` → **502**. For a body-consuming
   `POST`, attach the route-scoped `jsonBody` middleware (see the datalog/cypher routes). Never let
   an unreachable backend crash the process.
3. **Test it** in `server/routes/graph.test.ts`: add the new service fn to both the
   `vi.hoisted(mocks)` object and the matching `vi.mock(…, importOriginal)` return (so the real
   error classes survive for `instanceof`), then exercise success **and** the unavailable path over
   real HTTP.
4. **Gate the UI** on the right backend with `<GraphFeatureGate backend="neo4j"|"sidecar"|"any">`
   (`client/src/components/graph/GraphFeatureGate.tsx`) so the feature disables with a tooltip when
   its backend is offline.
5. **Document the row** in the §10b route catalog (method, backend, success shape, degradation).

To add a whole new **dataset** to the shared graph instead, see §9 (map the lexicon file, regenerate
the export). To add it to the explorer, follow the `culturescrape.adapter.ts` pattern (§10b, US-008).

### Cross-links

- **Convergence (data-layer) work — Pinakes-side tasklist 15:** the export / reconcile /
  write-back / QA toolchain (§7) is driven by
  [`tasks/ralph/completed/data-layer-convergence.json`](../tasks/ralph/completed/data-layer-convergence.json),
  specified in [`docs/canonical-schema.md`](./canonical-schema.md). It produces the canonical
  `nodes/`/`edges/` TSVs this integration consumes once loaded into Neo4j.
- **Python-side convergence — tasklist 16:**
  [`tasks/ralph/completed/pinakes-convergence-python.json`](../tasks/ralph/completed/pinakes-convergence-python.json)
  and the vendored engine under [`packages/culture-scrape/`](../packages/culture-scrape/) —
  ingestion ([`docs/reconcile-pinakes.md`](../packages/culture-scrape/docs/reconcile-pinakes.md)),
  Neo4j load ([`docs/neo4j.md`](../packages/culture-scrape/docs/neo4j.md)) and Datalog
  ([`docs/datalog.md`](../packages/culture-scrape/docs/datalog.md)). Use its own toolchain
  (`mypy` / `pytest` / `ruff`), not the app's.
- **This app-side PRD:** `tasks/ralph/graph-app-integration.json` (US-001…US-012).

## 10d. Migrating a correlation from in-memory TS to the graph (US-007)

The first correlation moved off the bespoke in-memory TSV joins and onto the shared
graph is the **cross-domain correlation** (`POST /api/cross-domain/correlate`). This is
the template for retiring the remaining hand-rolled joins (`cross-domain-correlation.ts`,
`genetic-linguistic-correlation.ts`) as the live graph fills in.

- **The scoring is a single pure core, shared by both paths.**
  `cross-domain-correlation.ts` exposes `scoreCorrelations` (co-occurrence Jaccard /
  temporal-overlap / geographic) + `rankCorrelations` (sort → top-50 → summary), and the
  in-memory `CrossDomainCorrelation.queryCorrelation` now just loads entities from
  `TsvStorage` and calls them. The graph path
  (`cross-domain-correlation-graph.ts`) loads the **same** `DomainEntity` shape from Neo4j
  via `graph-store.getNodesByLabel(<:LABEL>)` and calls the identical core. Because the
  math is shared, the two paths produce **bit-identical** ranked results on a shared
  fixture — that is the parity guarantee (`cross-domain-correlation-graph.test.ts`).
- **Domain → `:LABEL` map** (`DOMAIN_LABELS`): `language→Language`, `cuisine→Cuisine`,
  `religion→Religion`, `civilization→Culture`. `music`/`haplogroup` are Pinakes-only
  domains with no graph node type, so a query touching them is not graph-eligible and
  always uses the in-memory path. Node props project as: `pinakes_id`→id (fallback
  csid), `lat`/`lon`→coordinates, `time_start`/`time_end`, `region`, and
  `associated_language_ids`→`languageIds`.
- **Feature-flagged + degrades cleanly.** `correlateWithGraphFallback` is the single
  decision point the route calls: it uses the graph only when
  `CORRELATION_GRAPH_ENABLED` is truthy **and** both domains are graph-eligible **and**
  Neo4j is reachable; a `GraphUnavailableError` (graph down, or a non-graph domain) falls
  back to the in-memory path. The flag is **off by default**, so the app keeps serving the
  in-memory path out of the box. The response carries a `source: "graph" | "memory"` field.

## 11. Non-goals

- Rewriting Pinakes's backend or frontend language.
- Abandoning TSV — it remains the portable source of truth on both sides.
- Moving CPU-domain compute (linguistic distance, etymology) out of TS.

## 12. Ralph PRDs

The work is driven by [Ralph](../docs/ralph-workflow.md) PRDs under `tasks/ralph/` (run via
`scripts/ralph/run-all.sh`). Convergence-related PRDs, in dependency order:
`data-layer-convergence` (**implemented**, §7) → `pinakes-convergence-python` (Python side,
**implemented**) → `graph-app-integration` (app-side graph integration, **implemented**, §10b/§10c).
The first two now live in `tasks/ralph/completed/`; the app-side runbook is §10c.
The remaining roadmap PRDs (`data-acquisition`, `narrative-education`, `platform-infra`,
`speculative`) build on them.
