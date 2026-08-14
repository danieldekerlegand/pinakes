# Populated-graph bring-up runbook

How to stand the whole stack up **against real corpus data** — the pinakes service, the
built client, and a Neo4j holding the canonical export — and prove it is populated rather
than merely reachable. This is the reproducible bring-up the browser-verification work
(`tasks/chief/100-browser-verify-populated-graph.json`) runs against, and the one to use
whenever a change needs checking against the live graph instead of fixtures.

**Everything degrades gracefully without it.** `npm run build && npm start` serves the whole
TSV-backed app with no Docker at all; the graph-dependent UI then renders its
`GraphFeatureGate` disabled affordance. This runbook is for when you need the graph *up*.

---

## TL;DR

```bash
npm run dev:full          # graph up + client built + service in the foreground
# …in another shell:
npm run smoke:graph       # 10 checks; must print "0 failed"
```

`dev:full` leaves Neo4j running when it exits. Tear it down with `npm run sidecar:down`.

---

## What "the stack" is (and is not)

Since the cutover (`tasks/chief/completed/80-cutover.json` US-2) there are **two** moving
parts, not four:

| Part | What runs it | Notes |
|---|---|---|
| The pinakes service + the built client | `npm start` → `python -m pinakes` | ONE process. It serves all of `/api` **and** `dist/public`. |
| Neo4j | `docker compose -f infra/docker-compose.yml up -d neo4j` | The shared correlation store; holds the loaded export. |

There is **no sidecar container**. The engine is imported in-process
(`services/api/src/pinakes/engine/`), so the `sidecar: true` field in
`/api/graph/status` means "the in-process corpus reader found a corpus", not "a container
is up". The `pinakes_engine` compose service is unused by this bring-up and does not build
(see the note atop `infra/engine.Dockerfile`) — do not add it back to the path.

---

## The three steps `npm run graph:up` performs

`scripts/graph-up.sh` is the graph half on its own (detached, idempotent, re-runnable).
`dev:full` calls it and then builds + starts the app.

### 1. Start Neo4j and wait for `healthy`

`docker compose -f infra/docker-compose.yml up -d neo4j`, always **from the repo root with
an explicit `-f`**: the compose file mounts `${PWD}` at its own absolute path so the
`file://<abs-path>` LOAD CSV URLs step 3 emits resolve inside the container.

The script polls `docker inspect`'s health status and **fails loudly** with the container
logs rather than continuing into a load that cannot connect.

> **Gotcha — the documented password is shorter than neo4j:5 allows.** `neo4j/pinakes`
> (`.env.example`, every runbook) is 7 characters; `neo4j:5` enforces an 8-character floor
> on the initial password and the container exits **70** on first boot with
> *"A password must be at least 8 characters"*. `infra/docker-compose.yml` therefore sets
> `NEO4J_dbms_security_auth__minimum__password__length: "4"`, which keeps the one documented
> local credential valid. If you ever see a `pinakes-neo4j-1` that exits immediately on a
> fresh volume, check for that message first.

### 2. Build the canonical export

`npx tsx scripts/export-for-engine.ts` — skipped when the export directory already holds a
`nodes/` tree. Force a rebuild with `PINAKES_FORCE_EXPORT=1`.

Current live shape: **6,849 nodes across 17 types + 5,836 edges across 8 types**
(`docs/engine-export-manifest.json` is the committed snapshot).

> **Gotcha — the export directory is in the middle of a move.** The script writes
> `export/pinakes_engine/` today; `tasks/chief/105-export-dir-unify.json` moves it to the
> gitignored `build/corpus/`. `scripts/graph-env.sh` prefers `build/corpus` when it is
> populated and falls back to `export/pinakes_engine`, so this bring-up works either side
> of that change. Override with `PINAKES_ENGINE_CORPUS=<dir>`.

### 3. MERGE the export into Neo4j

`pinakes_engine to-neo4j "$PINAKES_ENGINE_CORPUS" --mode loadcsv` — `MERGE`-on-`csid`
behind `IF NOT EXISTS` constraints, so **re-running changes nothing** (verified: node count
holds at 6,849 across repeated runs). ~37 constraint/index statements + 25 LOAD CSV
statements, a few seconds warm.

Skip it with `PINAKES_SKIP_LOAD=1` when the graph is already loaded.

Loaded shape, by label (`pinakes_engine neo4j-counts`):

```
node counts by label (total 6849):
  Entity: 6849 · Ingredient: 2208 · Place: 1213 · Language: 1099 · LanguageFamily: 636
  Culture: 341 · ArchaeologicalCulture: 286 · ArtTradition: 237 · Deity: 230
  WritingSystem: 115 · MigrationRoute: 104 · Cuisine: 101 · LiteraryTradition: 62
  MythMotif: 61 · TradeGood: 59 · Battle: 53 · UrheimatHypothesis: 24 · Religion: 20
edge counts by type (total 2267):
  DESCENDS_FROM: 1683 · SYNCRETIZED_WITH: 242 · ABSORBED_INTO: 103 · INFLUENCED_BY: 102
  BORROWED_FROM: 50 · SPLIT_FROM: 47 · COGNATE_WITH: 27 · DERIVED_FROM: 13
```

> The loaded **edge** total (2,267) is lower than the exported one (5,836): the load
> `MERGE`s on the `(start, type, end)` triple, so edges the export emits more than once
> between the same pair collapse. Node counts are 1:1 with the export.

---

## Verifying it is populated — `npm run smoke:graph`

`scripts/smoke-graph.ts` is the gate. Against the bring-up above it prints:

```
▶ Live-graph smoke test against http://localhost:3050

  ✓ status — available=true neo4j=true sidecar=true
  ✓ metrics — node_count=6849, edge_count=5836
  ✓ domain: civilizations — :Culture → 341 node(s)
  ✓ domain: sites — :Place → 1213 node(s)
  ✓ domain: deities — :Deity → 230 node(s)
  ✓ domain: writing systems — :WritingSystem → 115 node(s)
  ✓ domain: languages — :Language → 1099 node(s)
  ✓ search — q="a" → 5 hit(s), first csid=cs:archaeological-culture:Q277797
  ✓ node/:id — cs:culture:Q128904 "Elam" [Entity, Culture]
  ✓ neighborhood/:id — 2 node(s), 1 edge(s) at depth 1

✓ Smoke test: 10 passed, 0 failed, 0 skipped.
```

Two properties make it a *populated*-graph gate rather than a reachability one:

- **The five `domain:` checks** assert each core corpus label is non-empty, via one
  read-only label-count query through `POST /api/graph/cypher`. A graph that is up but
  empty — or holding the 9-node `tests/fixtures/explorer-corpus` fixture the compose file
  defaults to — passes status/metrics/search and **fails here**. Negative control: point one
  entry of `CORE_DOMAINS` at a label that does not exist and the run exits **1**.
- **The probe node is chosen because it has an edge.** `discoverCsid` first asks for a core
  domain node with at least one relationship, so `neighborhood/:id` proves a real traversal;
  an empty edge list on such a probe is a failure, not a shrug. (It still falls back to a
  search hit, then `/overview`, so the check runs when only one backend is up.)

**Exit-code contract is unchanged:** `0` = passed *or* gracefully skipped (nothing up —
absent services are not a failure); `1` = a backend was up but a check returned empty or
wrong data.

---

## Browser-verifying the atlas against it — `npm run test:e2e:graph`

`npm run smoke:graph` proves the **API** answers with real data; the Playwright suite proves
the **UI** renders it. One command does the whole thing (pinakes:100 US-2):

```bash
npm run test:e2e:graph        # graph:up → install chromium → playwright test
```

`scripts/e2e-graph.sh` is `graph-up.sh` plus the two things that make the browser run see
real data:

1. It **exports** the `graph-env.sh` variables. `webServer.env` in
   `web/playwright.config.ts` merges with `process.env`, so the service Playwright boots
   reads the same `PINAKES_ENGINE_CORPUS` / `NEO4J_*` the loader used, and
   `/api/graph/status` answers `neo4j: true` inside the run.
2. It runs `npx playwright install chromium`. **`npm install` does not install the
   browser** — only the `@playwright/test` package is a dependency, so a fresh checkout
   otherwise fails every spec with *"Executable doesn't exist"*, which looks like 19 spec
   failures and is none.

The suite is green in **both** graph states, and the specs branch rather than hedge:

| Graph | Result | What ran |
|---|---|---|
| down (`npm run test:e2e`) | 15 passed, 4 skipped | the graceful-degradation describe; the populated-graph one skips |
| up (`npm run test:e2e:graph`) | 15 passed, 4 skipped | the populated-graph describe; the degradation one skips |

The probe is `e2e/support/graph-state.ts` (`/api/graph/status`, once per worker). "The gate
is dimmed" and "the live control rendered real data" are mutually exclusive claims about
the same DOM, so an `.or()` of them would pass whichever one regressed — see `e2e/CLAUDE.md`.

> **Gotcha — Playwright REUSES a server already on the port.** A reused server keeps the
> environment *it* was started with, not the one the script exported, so a stale
> `npm start` on `3055` would silently send the run down the graph-DOWN branch. The script
> probes the port first and **exits 1** with instructions rather than "verifying" the wrong
> stack. Stop the stale server, or start it with `PORT=3055 npm run dev:full`.

`PINAKES_SKIP_GRAPH=1 npm run test:e2e:graph` skips the bring-up when the graph is already
loaded; extra arguments pass straight through (`npm run test:e2e:graph -- --headed`).

### What the real-data run caught

Both were invisible to the ~2,600-test vitest suite, and one was invisible to the e2e suite
as it stood — which is the argument for this runbook:

- **`page.route` never fired.** The suite drives the *production* client, which registers
  `/sw.js`; a service worker's fetches bypass Playwright's interception, so every "graph up"
  mock in `graph-ui.spec.ts` was asserting against whatever the real server answered. Fixed
  with `serviceWorkers: "block"`.
- **The neighborhood legend collapsed to a single "Entity".** Every node in the canonical
  export carries the umbrella `:Entity` label alongside its specific one, and Neo4j gives no
  ordering guarantee — so `primaryLabel()`'s `labels[0]` typed and coloured whole
  neighborhoods identically, *nondeterministically*. The fixtures list the specific label
  first, so no unit test could reach it. Fixed in
  `web/src/lib/graph/neighborhood-graph.ts`.

---

## Environment

All of it is defaulted by `scripts/graph-env.sh` (sourced by `graph-up.sh` and
`dev-full.sh`), so the loader, the service and the smoke can never disagree about which
corpus is "the corpus". Every value is `:=`-defaulted — your own export always wins.

| Variable | Default | Purpose |
|---|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` | Bolt endpoint (matches the compose port map). |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `pinakes` | The documented dev credential. |
| `NEO4J_AUTH` | `$NEO4J_USER/$NEO4J_PASSWORD` | What the container reads. Must match the pair. |
| `PINAKES_ENGINE_CORPUS` | `build/corpus` if populated, else `export/pinakes_engine` | The corpus **both** the loader and the in-process reader use. |
| `PORT` | `3050` | The one published port (service + client). |
| `PINAKES_FORCE_EXPORT` | unset | Rebuild the export even when present. |
| `PINAKES_SKIP_LOAD` | unset | Skip the Neo4j load. |
| `PINAKES_SKIP_GRAPH` | unset | `dev:full` only — start the app with no graph at all. |

---

## Running it by hand (or in CI)

The scripts are convenience over these commands; nothing hides:

```bash
docker compose -f infra/docker-compose.yml up -d neo4j       # 1
npx tsx scripts/export-for-engine.ts                         # 2
uv run --all-packages pinakes_engine to-neo4j \
    export/pinakes_engine --mode loadcsv                     # 3
uv run --all-packages pinakes_engine neo4j-counts            #    (inspect)

npm run build && npm start                                   # 4
npm run smoke:graph                                          # 5
npx playwright install chromium                              # 6
npx playwright test --config web/playwright.config.ts        # 7
```

Steps 1–3 are `npm run graph:up`; 1–4 are `npm run dev:full`; 1–3 + 6–7 are
`npm run test:e2e:graph`. Because every step is idempotent, a CI job can run
`npm run graph:up` and then start the app with the same environment exported — see
`scripts/graph-env.sh` for the variables to carry across.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pinakes-neo4j-1` exits 70 immediately | Password below the 8-char floor — see step 1's gotcha. |
| `smoke:graph` prints "Stack down" and exits 0 | The service is not on `$PORT`. That is the graceful path, not a pass. |
| `neo4j=false` in `/api/graph/status` | Neo4j not up, or `NEO4J_*` disagree with `NEO4J_AUTH`. |
| `sidecar=false` in `/api/graph/status` | `PINAKES_ENGINE_CORPUS` points at a directory with no `nodes/`. |
| `node/:id` 404s on a csid `search` just returned | The in-process corpus and Neo4j were loaded from **different** exports. Re-run `npm run graph:up` so both read `$PINAKES_ENGINE_CORPUS`. |
| The load's output is 37 paragraphs of "already exists" | Expected on a re-run; `graph-up.sh` filters those lines and shows them in full only when the load fails. |
| Every e2e spec fails with "Executable doesn't exist" | The Chromium build is not installed — `npx playwright install chromium`. `npm install` does not fetch it. |
| `test:e2e:graph` exits 1 before running any spec | A stale server on `$E2E_PORT` does not see the populated graph. Stop it; Playwright will boot its own with the right environment. |
| The populated-graph specs all report *skipped* | `/api/graph/status` answered `neo4j: false`, so the suite took its graph-down branch. Same cause as the row above. |

## See also

- [`docs/civilizations-neo4j-load.md`](./civilizations-neo4j-load.md) — the original load
  procedure and the csid-migration note (its inline counts are a period record).
- [`docs/engine-integration.md`](./engine-integration.md) — the degradation contract.
- [`e2e/CLAUDE.md`](../e2e/CLAUDE.md) — the Playwright suite, which treats the graph as optional.
- [`scripts/CLAUDE.md`](../scripts/CLAUDE.md) — the smoke test's design rules.
