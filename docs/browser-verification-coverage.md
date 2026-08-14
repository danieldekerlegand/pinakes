# Browser-verification coverage — the atlas UI against the populated graph

**What this closes.** ROADMAP [Phase A](../ROADMAP.md#phase-a--real-data-production-hardening)
row 1 / [`prd-pinakes-deep-history-roadmap.md`](roadmap/prd-pinakes-deep-history-roadmap.md)
§16 + §"Not yet hardened" — *"several UI stories were gated on unit tests rather than browser
runs"*. This file is the record of **which** of those stories are now browser-confirmed
against real data, **which spec proves each one**, and **which are still unverified and why**.

A surface is listed as **verified** only when a Playwright spec asserts on *content the running
service actually served* — a named lineage, the real option set of a quiz question, a re-derived
node/edge count — not merely that the route mounted. Everything else is in
[Not browser-verified](#not-browser-verified) with a reason. A gap written down is a gap; a gap
left off the table reads as coverage.

Reproduce the whole thing with one command — `npm run test:e2e:graph`. Bring-up details:
[`populated-graph-runbook.md`](populated-graph-runbook.md). Spec conventions and the per-spec
surface table: [`e2e/CLAUDE.md`](../e2e/CLAUDE.md).

## The run of record — 2026-08-14

| Gate | Command | Result |
|---|---|---|
| Browser suite, populated stack | `npm run test:e2e:graph` | **37 passed, 4 skipped, 0 failed** (23.5s) |
| Browser suite, graph down | `NEO4J_URI=bolt://localhost:7699 npm run test:e2e` | **37 passed, 4 skipped, 0 failed** (36.2s) |
| Live-graph smoke | `npm run smoke:graph` | **10 passed, 0 failed, 0 skipped** |

The two suite runs skip **complementary** halves, by design: `graph-ui.spec.ts`'s graph-**down**
describe (4 tests) skips when the graph is up, and its **populated-graph** describe (4 tests)
skips when it is down. The two make mutually exclusive claims about the same DOM, so the specs
**branch** on `/api/graph/status` rather than `.or()`-ing the outcomes together (an `.or()`
passes whichever half regresses). See `e2e/support/graph-state.ts`. Verified by reading which
tests actually ran, not the totals — they are 37/4 either way, so the counts alone would not
tell you the branch flipped.

Pointing `NEO4J_URI` at a dead port is how the graph-down leg was run here without stopping the
shared container (the compose project is not per-worktree). It exercises the real degradation
path: the service's availability probe fails and `/api/graph/status` reports the graph down.

**The stack under test.** Neo4j loaded from the canonical export — **6,849 nodes / 2,267
relationships** (the load MERGEs on the `(start,type,end)` triple, so it collapses the export's
5,836 edge rows), `/api/graph/status` reporting `neo4j: true` **and** `sidecar: true` (the two
are separate halves — Neo4j serves `neighborhood`/`overview`/`cypher`, the in-process corpus
reader serves `/api/graph/search`). Per-domain graph population, from `smoke:graph`:
`:Culture` 341 · `:Place` 1,213 · `:Language` 1,099 · `:Deity` 230 · `:WritingSystem` 115.

## The corpus the run verified against

Read live from **`GET /api/data-quality`** during the run — the same endpoint the atlas's own
Data Overview grades the corpus with, so this record cannot drift from what the app reports:

- **57 lexicon files · 139,019 rows · overall quality score 0.9374**
- **Coverage: 14/15 domains at target**, 1 under — `language-range-polygons` at 133/200 (67%),
  closed in Phase B (`chief/109`), not here.

Those are the same numbers as the committed [`coverage-report.md`](coverage-report.md) /
[`coverage-report.json`](coverage-report.json) snapshots — both `/api/data-quality`'s coverage
section and the committed report compute from `ROADMAP_TARGETS` over the same lexicon row
counts (`services/api/src/pinakes/analytics/quality.py` ·
`scripts/lib/data-quality-scorer.ts`), which is what keeps this verification tracking the
atlas's own coverage numbers rather than a second, independently-drifting tally. Per-domain
counts live in that report; they are deliberately **not** duplicated here.

## Browser-verified UI stories

`Data` = what the assertion reads: **graph** = Neo4j / the in-process corpus reader via
`/api/graph/*`; **corpus** = the TSV corpus via `/api`. Both are "real data" — a corpus-backed
surface is not less verified for not touching Neo4j, it simply has no graph leg to verify.

| UI story | Surface | Proved by | Data | The claim the spec makes |
|---|---|---|---|---|
| Graph neighborhood view | `?panel=explore` → entity → Show in graph | `graph-ui.spec.ts` › *the neighborhood view draws an entity's real neighbours* | graph | circle count == the entity's real neighbour count from `/api/graph/neighborhood`; the legend == the real distinct labels |
| Explorer graph adapter | `?panel=explore&ds=graph` | `graph-ui.spec.ts` › *the explorer graph adapter projects real graph nodes* | graph | the item count == `/api/graph/overview`'s size |
| Federated search | global search | `graph-ui.spec.ts` › *federated search merges a real graph-sourced hit* | graph | a graph-sourced hit under its **real display name** (`"Sumer"` — a term with no local twin to dedup against) |
| Provenance UI | entity panel provenance badge | `graph-ui.spec.ts` › *neighborhood view + provenance badge render* | graph | badge + source attribution render for a graph entity |
| Research console graph run | research console | `graph-ui.spec.ts` › *the research console's graph run control is live* | graph | the gate is live, not dimmed, and runs |
| Graceful degradation (graph down) | all four above | `graph-ui.spec.ts` › *degrades gracefully* (4 tests) | — | each affordance is dimmed with a tooltip / shows its error state; **runs only with the graph down** |
| Core shell + map + explorer | `/`, `?view=map`, `?panel=explore` | `smoke.spec.ts` (4 tests) | corpus | the shell mounts, Leaflet gets a canvas, the explorer loads a dataset, the graph affordance renders in whichever state the graph is in |
| Expanded civilizations (§8.1/§15) | `?view=map&layers=civilizations`, `ds=civilizations` | `civilizations.spec.ts` (4 tests) | corpus | ≥150 map features; **Ancient Crete** in the explorer with a `provenance-list` linking `wikidata.org/entity/Q4752820` |
| Cultural lineage explorer (§7) | `?view=lineage` | `lineage.spec.ts` (3 tests) | corpus | the drawn `<g>`/`<line>` counts == the `/api/cultural-lineages` join; a named corpus culture is drawn + searchable; selecting it highlights its real ancestry |
| DNA-to-culture ancestry mapper (§14.1) | `/ancestry` | `lineage.spec.ts` (2 tests) | corpus | a synthesized R1b raw-DNA file infers in-browser and its `/api/ancestry/map` language families render; a file with no Y calls explains itself |
| Cross-domain correlation flows (§4/§10) | `?panel=correlation` | `flows.spec.ts` (3 tests) | corpus | the Sankey `<rect>`/`<path>` join re-derived from `/api/cross-domain/correlate` and labelled with real entity names; the scatter view is the same result |
| Etymology analyzer (§1) | `/word-etymology` | `etymology.spec.ts` (3 tests) | corpus | a word the corpus can actually trace, its real related words drawn as `<text>`; a word with no relations says so |
| Narrative journeys (§12) | `/stories`, `/stories/:id` | `stories.spec.ts` (3 tests) | corpus | every narrative `/api/narratives` serves, its step count, step 1's verbatim text; an unknown id 404s gracefully |
| Quizzes + shareable results (§12) | `/quiz`, `/shared/quiz/:token` | `quiz.spec.ts` (4 tests) | corpus | the asked language and all four options are real corpus names; a played score round-trips through the share token |
| Immersive globe & virtual museum (§14) | `/immersive` | `immersive.spec.ts` (4 tests) | corpus | the mode toggle offers exactly what this browser can draw; gallery tiles ARE `/api/material-culture`'s items in the component's order; the fly-through names a real migration route |

## Not browser-verified

### Deliberately excluded — the reason is the point

Full text in [`e2e/CLAUDE.md`](../e2e/CLAUDE.md) → *"What is deliberately NOT browser-covered"*.

| Surface | Why not |
|---|---|
| WebXR / headset sessions (`/immersive`, `/ar-history`) | headless Chromium exposes no `navigator.xr`, so the "Headset ready" branch is unreachable. The decision logic is unit-covered against an injected environment (`detectImmersiveSupport`); `immersive.spec.ts` verifies both *other* branches by reading the capability badge |
| `SankeyDiagramVisualization` / `ChordDiagramVisualization` | **not mounted anywhere** — their only importers are themselves unreferenced, so no URL puts them on screen. Wiring an orphan into a surface is a feature change, not verification. `flows.spec.ts` covers the Sankey a user *can* reach |
| A treemap | there isn't one. `VisualizationType` has no `treemap` member and no component draws one |
| `/explore`'s Sankey/Chord tiles | they render `PlaceholderRenderer` — an icon and a caption. Asserting on them would file placeholder text as flow-diagram coverage |
| `drag_sort` / `map_click` quiz answering | `quiz.spec.ts` verifies both types **render**; answering them is HTML5 drag-and-drop and a Leaflet coordinate click — interaction-shaped, not data-shaped, and the scoring they feed is unit-covered on both sides |

### Not yet browser-covered — outside this tasklist's scope

`chief/100` US-3 enumerated the surfaces it would cover; these were never in it. They remain
**unit-tested only**, and each is an honest gap in Phase A's *"confirm the unit-test-gated UI
works with real data"*, not a claim of coverage. None is known-broken — none has been driven in
a browser against real data, which is a different statement.

| Surface | Route / view | Status |
|---|---|---|
| Family tree · Network · Timeline | `?view=tree` / `network` / `timeline` | unit-tested only |
| 3D map | `?view=map-3d` | unit-tested only (distinct from `/immersive`, which **is** covered) |
| Contribute | `?view=contribute` | unit-tested only — writes to the contribution pipeline |
| Data Overview | `?panel=data-overview` | unit-tested only — the in-app `/api/data-quality` surface this file reads from the API side |
| Text analyzer · Word comparison · Linguistic distance | `?panel=text-analyzer` / `comparison` / `distance` | unit-tested only |
| Phonology (IPA) · Grammar · Writing systems · Verb paradigms | the Specialist panels | unit-tested only |
| Mesopotamia showcase | `/mesopotamia` | unit-tested only |
| Civilization timeline | `/civilization-timeline` | unit-tested only |
| Endangered-language dashboard | `/endangered-languages` | unit-tested only |
| Collections + share view | `/collections`, `/shared/collection/:token` | unit-tested only |
| Stable entity URLs | `/entity/:domain/:id` | unit-tested only |
| Culture-profile report | `/culture-profile/:id/report` | unit-tested only |
| Embed view | `/embed` | unit-tested only |
| Advanced tools | `/advanced-tools` | unit-tested only |
| Hypothesis & site-location generation | `/hypotheses` | unit-tested only |
| Scraper dashboard · AI review queue | `/scraper`, `/ai-review` | unit-tested only — operator surfaces, and the AI paths need live model credentials |
| Living dataset / DOI snapshots | `/living-dataset` | unit-tested only; the first real DOI snapshot is Phase A `chief/102` |

### Known gap the browser run exposed but did not fix

**All four "Interesting Queries" in the correlation explorer return zero correlations.** Each
curated entry pairs a domain couple with a relationship type the corpus cannot satisfy —
`ie-r1b` asks language×haplogroup *co-occurrence* (0 results) where the same pair under
*geographic-overlap* yields 50. `PREBUILT_QUERIES` is a frozen parity payload pinned by
`services/api/tests/test_correlation.py`, so re-curating it is its own task. `flows.spec.ts`
**branches**: it asserts the diagram when a query correlates and the empty-state notice when it
does not, so the spec stays honest either way rather than passing vacuously.

## What the browser run actually caught

Evidence that "unit-tested" and "verified" are different claims. Every defect below was invisible
to the ~2,600-test vitest suite, and all are fixed:

1. **Playwright's `page.route` mocks never fired.** The suite drives the *production* client,
   which registers `/sw.js`, and a service worker's fetches bypass interception entirely — so
   every "graph up" mock silently no-opped. Fixed with `serviceWorkers: "block"`.
2. **`primaryLabel()` collapsed a whole neighborhood to one "Entity" legend entry.** Every
   exported node carries the umbrella `:Entity` *alongside* its specific label and **Neo4j does
   not order a node's labels** — so `labels[0]` mistyped neighborhoods *nondeterministically*.
   Unreachable from fixtures, which list the specific label first.
3. **Three envelope-vs-payload defects** — `/api/etymology-relations/trace/:word` answers
   `{tree, …}` (every trace said "no relations found"),
   `/api/cultural-lineages/{ancestors,descendants}/:id` answer `{entityId, lineages, count}`
   (clicking *any* lineage node crashed the visualization with `TypeError: … is not iterable`),
   and `/api/languages` answers a **bare array** where two pages expected `{items, count}` (two
   permanently empty language pickers). A hand-written fixture is written to the shape the
   component wants, so no unit run can see any of them.
4. **The quiz offered two categories `/api/quiz` rejects** — the client was wrong, not the
   service (`validCategories` is pinned by `test_quiz_routes.py`).
5. **Three unlabelled Radix comboboxes** — the quiz setup pickers had no accessible name at all,
   for a screen reader or for `getByRole`.

Plus the bring-up defects US-1 found: Neo4j never started (the documented 7-character dev
password is under `neo4j:5`'s 8-character floor), and `dev:full` ran a `pinakes_engine` compose
service that does not build.

## Re-verifying

```sh
npm run test:e2e:graph   # graph up + chromium install + the whole suite (the gate above)
npm run test:e2e         # the same suite with the graph down — must also be green
npm run graph:up && npm start && npm run smoke:graph   # the 10-check live-graph smoke
curl -s localhost:3050/api/data-quality | jq '.coverage.domainsMet, .totalRows'
```

`npm install` does **not** fetch the browser (`test:e2e:graph` runs `npx playwright install
chromium` for you), and Playwright **reuses** a server already listening on `E2E_PORT` — keeping
the environment *it* was started with, which would quietly send a populated-graph run down the
graph-down branch. `scripts/e2e-graph.sh` probes the port and refuses rather than report a
false pass.
