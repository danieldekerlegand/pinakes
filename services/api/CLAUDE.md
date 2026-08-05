# services/api/ — the `pinakes` FastAPI service

The Python replacement for `server/` (TS/Express). Read
[`README.md`](README.md) for the layout and the commands; this file is the
non-obvious parts.

## Porting a route group

Add **one file**: `src/pinakes/routers/<unit>.py` exposing `router = APIRouter()`.
Do not edit `app.py`, do not add to any list — the whole point of the discovery
pattern is that parallel port tasklists never touch a shared file.

- **Register the baseline path verbatim.** `contracts/parity/openapi.json` uses
  the same `{param}` templating FastAPI does, so `/api/languages/{id}` copies
  across as-is. Renaming the parameter to `{language_id}` is a different string,
  so the route reads as **unported**, keeps its 501 stub registered alongside
  your handler, and the coverage number never moves. (Your handler still wins at
  request time, because routers are registered before stubs — which is exactly
  what makes this failure quiet. The coverage number is the tell.)
- **Grade with the recorded fixtures**, not by eye: each 501 body and each
  `/api/_parity/coverage` entry names the `parityFixtures` for that route.
- A module that fails to import, or has no `router`, raises `RouterModuleError`
  at app construction. That is deliberate — a silently skipped module would let
  a "ported" group fall back to its own 501 stub and look fine.
- Prefix a file with `_` for a shared helper; the scanner skips those.

## The worked example — `routers/graph.py` (pinakes:50 US-2)

The first ported group, and the shape to copy: **one router file, thin over
`pinakes.engine`, plus two test files.** Nothing else was touched to land it.

- **A route is an adapter, not logic.** Parse the query string, call one engine
  function, map `EngineUnavailable`/`EngineFailure` onto 503/502. If a handler
  needs more than that, the missing piece belongs in `src/pinakes/engine/`.
- **Declare a numeric query param as `str | None` and parse it yourself.** Express
  read these through `Number(...)` + `Number.isFinite(...)`, so `?limit=abc` fell
  back to the default; a declared `int` param answers **422**, which is a
  different contract — a stale bookmark must not become a hard failure. The
  `_number`/`_positive`/`_depth` helpers are that JS semantic, including the two
  surprises (absent → `NaN`; present-but-empty → `0`).
- **Grade with `tests/test_parity_replay.py`**, which is generic: it replays every
  recorded fixture whose route the app registers and *skips* the rest by name. A
  port inherits it by landing its router — but add a "this group is actually being
  graded" assertion, because a fully-skipped parametrization is just as green as a
  passing one. `tests/parity_shape.py` is the Python half of
  `contracts/parity/shape.ts`; only the **matcher** is ported, deliberately —
  recording stays Express's job, or this service would author the contract it is
  graded against.
- **Add your fixture id to `GRADED` in `tests/test_parity_replay.py`.** That
  tuple is the list of "a port claims this recording"; the parametrized replay is
  green either way, so the claim is what makes a skipped fixture a failure.
- **`test_not_implemented.py`'s `SAMPLE_REQUESTS` must name only *unported*
  routes.** Porting a group that appears there turns its 501 assertion red; move
  the case into that group's own test.

## Traps

- **`registered_routes()` reads FastAPI internals.** Since 0.139
  `include_router` no longer copies routes into `app.routes` — it appends one
  node holding the original router plus its prefix, so a flat read of
  `app.routes` sees *no* router routes and reports everything unported. The walk
  in `app.py` recurses through `original_router` / `include_context.prefix`;
  `test_registered_routes_flattens_included_routers` is the guard. If a FastAPI
  bump ever makes coverage drop to 0/306, start there.
- **`uv run --project services/api pytest` is not enough.** Both Python suites
  share the root `.venv` and `/pytest.ini` collects both, but `--project` only
  guarantees *this* member's dependency groups — on a cold checkout the engine
  suite then dies in collection on `neo4j` / `problog`. Use
  `uv run --all-packages pytest` (that is what the tasklist verify runs).
- **mypy needs this directory as cwd**: `files = ["src", "tests"]` is resolved
  against the working directory, not the config file. `uv run --directory
  services/api --all-packages mypy`.
- **`dist/public` is gitignored** and the tests never build it — they point
  `create_app(client_directory=…)` at a temp dir with an `index.html`. To see
  the real thing serve, build the client first.

## The second ported group — `routers/{contributions,ai_review}.py` (pinakes:60 US-1)

The contribution queue and the AI-draft review. Unlike the graph port there is no
engine behind it, so the logic below HTTP lives in `src/pinakes/contributions/`
(`store` / `ai_review` / `changelog`) — same discipline as `engine/`: plain
arguments in, JSON-ready dicts out, no FastAPI import.

- **Both servers read one queue during the cutover**, so the on-disk shape is
  reproduced rather than improved. Two rules carry that: `_compact` drops unset
  optionals (`JSON.stringify` emits no key for `undefined`, and a present-but-null
  key is a *different* record to the TypeScript reader), and `js_truthy` spells
  out JavaScript truthiness — `![]` is false in JS and true in Python, so an
  empty-array required field would otherwise be valid on one server and not the
  other. `parse_int_js`/`js_slice` are the same idea for `?limit=abc`, which
  collapses the page to empty rather than 422ing.
- **Absent ≠ null.** `data.get("confidence")` cannot tell them apart and JS can:
  an omitted confidence warns and defaults to 50, a declared `null` is a 400. Use
  `"key" in data` wherever the TypeScript read `!== undefined`.
- **No store singleton.** `store.queue()` is built per call from
  `paths.contributions_dir()`, which re-reads its env override every time — a
  cached listing would be a listing of what *this* process last wrote, and there
  are two processes. It is also the test seam: `conftest.py`'s autouse
  `isolated_data_trees` redirects the queue, changelog **and lexicons** to
  `tmp_path`. Keep that autouse. A test that promoted into the live
  `data/source/lexicons/` would break an unrelated suite one run in six
  (`server/CLAUDE.md`).
- **`ContributionStore.list` shadows the builtin** for every annotation after it
  in the class body, which is why `get_by_entity` is declared above it. mypy says
  `Function ... is not valid as a type` if you move it back.
- **The changelog write is best-effort, and that has outlived the split.** It
  started as the write half of a store whose reader was still Express's; the
  reader landed here in pinakes:61 US-2 and the two now share one module. What
  did not change is that `record_change` swallows its failures — a failed audit
  line must never cost a reviewer their decision.

## The write guard — `contributions/auth.py` + `routers/_auth.py` (pinakes:60 US-2)

API-key auth + per-identity rate limiting on the two contribution **writes**
(`POST /api/contributions`, `PATCH /api/contributions/{id}/review`). Every `GET`
is open, and `PATCH /api/ai-review/{id}` is *not* guarded — neither was on
Express, and adding it here would be new policy rather than a port.

- **Open by default.** `$CONTRIBUTION_API_KEYS` unset ⇒ no keys ⇒ every write
  passes. Configuring the variable is what turns enforcement on; there is no
  second switch. Missing key ⇒ **401**, unknown key ⇒ **403** (constant-time,
  length-guarded compare), over quota ⇒ **429** with `Retry-After` and the
  `X-RateLimit-*` trio. Rate limiting applies even when auth is off, keyed on the
  client address instead of the key.
- **The dependency returns its rejection; it does not raise it.** A raised
  `HTTPException` is serialised as `{"detail": …}` and this surface answers
  `{"message": …}` — so `write_guard` hands back a `WriteGuard` whose `rejection`
  the handler returns as its first statement. That is two lines of ceremony per
  route, bought in exchange for needing **no exception handler on `app.py`** —
  the one file parallel port tasklists must not touch.
- **Config and counters are module state, built from the environment on first
  use** — the counters have to outlive the request that opened their window, and
  Express read its env once too (at registration). `_auth.configure(config=…,
  now=…)` is the injection seam that replaced the TypeScript options bag, and
  `conftest.py`'s autouse `reset_write_guard` is not optional: without it the
  counters accumulate across the session and the 61st write 429s in whichever
  test happens to make it.
- **A NamedTuple field cannot be called `count`** — it shadows `tuple.count` and
  strict mypy rejects the class outright (`_Bucket.hits`). Same family of trap as
  `ContributionStore.list`.
- `server/services/api-auth.ts` is retired but kept: it is the spec, and its unit
  tests are the statement that the two agree. `tests/test_contribution_auth.py`
  is that file's suite, case for case.

## The collaborative stores — `collab/` + `routers/{collections,annotations}.py` (pinakes:61 US-1)

Curated collections and user notes: two JSON-per-record trees under
`data/runtime/`, both **soft-owned**. There is no auth in this project, so a
record belongs to an opaque owner id the client mints and persists per browser,
and `routers/_owner.py` is the single place that knows how to read one.

- **The owner is read header → query → body, in that order, and all three are
  load-bearing.** The client sends `x-owner-id` on reads, `?owner=` is what makes
  a URL work in a second tab, and the **body** field is how a `DELETE` carries an
  owner at all (`use-collections.ts` posts `{owner}` on every mutation). Reading
  it out of the body means a dependency that awaits `request.body()` — safe,
  because Starlette caches the raw body, so a handler declaring its own `Body()`
  still gets the payload.
- **The body is read, not declared.** Express validated `req.body ?? {}` by hand,
  so a junk body is a **400 listing the missing fields**; a declared FastAPI model
  answers **422**, which is a different contract. Same family as `parse_int_js`
  in the contribution port — see `_payload()`.
- **Two ways to be refused, and they are not interchangeable.** Unknown id ⇒
  **404**; someone else's record ⇒ **403**. And *visibility governs reads while
  ownership governs writes*: a public collection is readable by anyone and
  editable by no one but its owner. A collection's share token is a third,
  orthogonal capability — it grants a read of the owner-free projection
  regardless of visibility, which is what "share a private collection by URL"
  means.
- **Reproduce the Express 500 shape.** Every handler over there wrapped its work
  in a try/catch answering `{error: "<doing> failed", detail}`. A bare exception
  here would be a different (and uglier) contract, so each handler has that
  `except` — including one for the access error, ahead of it.
- **`from __future__ import annotations` collides with the `annotations`
  submodule, twice.** In `collab/__init__.py` it binds the name on the *package*,
  so `from pinakes.collab import annotations` yields a `__future__._Feature` and
  every route 500s at request time — that file therefore does **not** have the
  future import, and `test_the_annotations_submodule_is_not_shadowed` guards it.
  In an importing module it binds the name locally, so the store is imported
  under an alias (`as notes`); strict mypy catches that one for you
  ("imported name has type Module, local name has type _Feature").
- `conftest.py`'s autouse `isolated_data_trees` now redirects six trees (US-2
  added `stewardship`). **Add yours the moment a port starts writing one** — every store resolves its
  directory through `pinakes.paths` per call precisely so that fixture is the
  only thing between a test and live user data.

## The changelog, stewardship and citations — `routers/{changelog,stewardship,citations}.py` (pinakes:61 US-2)

Three small route groups that finish the collaborative-runtime band. Two things
here are worth knowing before touching them.

- **`contributions/changelog.py` is now the whole store, not half of it.** The
  write half landed with the review pipeline; this story added filtering,
  sorting, pagination and the aggregate to the *same module* rather than
  splitting along the route boundary — the record shape and the id format are
  what the two servers agree on, and a second module restating them is the drift
  worth not having. `server/services/changelog.ts` is therefore **not retired**:
  its write side is still live over there (field updates, release semver).
- **The two failure modes are deliberately opposite, and both are ports.** A
  malformed changelog file **raises** (→ 500): an entry silently dropped from an
  *audit log* is worse than a log that admits it is broken. A malformed
  `stewards.json` **degrades to empty**: a claim can be re-made in one request,
  so failing loudly would cost every reviewer the endpoint. Do not "fix" either
  into the other.
- **`?limit=abc` means different things in different groups.** The contribution
  queue propagates the `NaN` into `Array.slice` and returns an *empty* page;
  `/api/changelog` drops it back to `undefined` and returns the *default* page,
  because `parseFilters` did. `routers/changelog._number` is that second rule and
  is not `store.parse_int_js`.
- **Dates are `Date.parse`, not `fromisoformat`.** `changelog.date_parse_ms`
  special-cases the date-only form to **UTC** (Python reads it as local), and a
  bare `to=YYYY-MM-DD` bound covers the whole day (`T23:59:59.999Z`). Both rules
  are load-bearing for the range filter.
- **`collab/citable.py` is not the corpus storage layer** and must not grow into
  one — it reads five fields out of four TSVs, and the general reader is
  `tasks/chief/63-port-entity-search.json`'s job. Two shapes in it are
  contract, not accident: an undated civilization cites **year 0** (falling back
  to its boundary row first), and a site with no parseable `coordinates` has no
  citation at all.
- **`GET /api/citations` is served by BOTH backends on purpose.** Its recorded
  fixture is replayed against the Express app, so retiring it there would break
  the baseline. It is the one response in the group that is a constant.
- The stewardship port took **three of the five** routes in
  `server/routes/community-verification.ts`; confirm/verification are the
  contribution queue's unit and still 501 here. That split works because both
  servers read one `stewards.json`.

## The analytics engines — `analytics/` + `routers/{analytics,anomalies,correlations}.py` (pinakes:62 US-1)

Four self-contained computations over the lexicon corpus — a DuckDB analytical
index, cross-domain correlation, anomaly detection, genetic↔linguistic overlap —
and the first port band whose *unit of agreement* is a number rather than a
record shape. That changes what the discipline has to be.

- **JavaScript's arithmetic is part of the contract, and Python disagrees with
  it in three places.** `analytics/jsmath.py` is those three: `Math.round` breaks
  ties toward +∞ (Python's `round` goes to even), `toFixed` breaks them away from
  zero on the value's *exact binary* expansion (`format(.2f)` goes to even), and
  `toLocaleString("en-US")` groups thousands. Every expectation in
  `tests/test_analytics_js_semantics.py` came out of node. **And `sum()` is not
  `Array.reduce`**: since 3.12 the builtin uses Neumaier compensated summation,
  which is *more* accurate and therefore wrong here — it moved a correlation
  summary's `avg score` by a digit. Accumulate in a loop.
- **`analytics/tsv.py` is the reader's dialect, not a parser.** `getIdx` throws
  and `indexOf` returns `-1`, and which one a column gets is the difference
  between a broken corpus and an empty one. `Number()` must match the whole
  string while `parseInt`/`parseFloat` read a prefix, and all three reach a real
  cell or query parameter here.
- **DuckDB was kept, deliberately.** The TypeScript's contract was `read_csv`'s
  exact TSV dialect plus SQL's exact ordering; a hand-rolled Python equivalent
  would be a rewrite whose output happens to agree, and the first disagreement
  (collation, blank cells, tie-breaking) would surface as a corpus-shaped bug in
  a facet list. `duckdb` is therefore a declared dependency of this service. The
  TypeScript's `query()` escape hatch is **not** ported: no route reaches it, so
  bringing it across would add an unrouted SQL entry point rather than port one.
- **The index singleton is keyed on the directory it mirrors.**
  `paths.lexicons_dir()` re-reads its env override per call precisely so a test
  can point one request at a temp corpus; an index cached without that check
  would be an index of whatever the first caller asked for.
- **A blank coordinate cell is the origin, not nothing.** Three loaders default
  `coordinates` to `{0, 0}` and the correlation projection reads them through a
  nullish coalesce, which does not replace an object — so such rows really do
  score geographic proximity to each other at Null Island. Reproduced, not fixed.
- **The graph-backed correlation path came too**, including
  `engine/graph.nodes_by_label` (the one graph read not addressed by csid). It is
  off by default (`CORRELATION_GRAPH_ENABLED`), and `EngineUnavailable` — not any
  exception — is what degrades it to the in-memory path. The shared-fixture test
  in `tests/test_correlation.py` feeds one set of entities to both paths, which
  is what the answer's `source` field rests on.
- **Two `500` spellings live side by side, and that is a port.** The handlers
  extracted into `server/routes/*.ts` answer `{error, detail}`; the ones that
  stayed inline in `routes.ts` answer `{message, error}`. `routers/analytics.py`
  and `routers/anomalies.py` use the first, `routers/correlations.py` the second.
- Half of `server/services/genetic-linguistic-correlation.ts` is deliberately
  left behind: `mapHaplogroupsToAncestry` backs `/api/ancestry/*`, a different
  port unit. When it lands it should read `analytics/genetic.NOTABLE_DIVERGENCES`
  rather than carry a second copy.

## The band's second half — `analytics/{hypothesis,quality}.py` + `routers/{hypotheses,data_quality}.py` (pinakes:62 US-2)

Hypothesis generation and the corpus's own report card. Both are graded against
the TypeScript on the **live** corpus, which is what US-1's discipline was
building toward; four notes are worth keeping.

- **`analytics/hypothesis.py` imports the anomaly primitives rather than
  restating them** (`feature_key`, `compute_feature_prevalence`,
  `feature_rarity`, `haversine_km`), exactly as the TypeScript did — the n-way
  cluster is the pairwise anomaly generalized, not a second scorer. It also
  reuses `anomaly.load_nodes`: on Express the same music/art/material projection
  was written out twice, in two route files, with a "keep in sync" comment
  between the copies. There is one copy here.
- **`analytics/quality.py` carries its own TSV split, and that is not laziness.**
  The TypeScript scorer had a private `parseTsvFile` that differs from the
  storage reader's in two ways the report *publishes*: an empty file has **no
  header** (`columnCount: 0`, not one blank column), and the split is on `"\n"`
  alone, so a CRLF file keeps a `\r` on its last column — the live
  `families.tsv` genuinely reports a `language_count\r` field. That second one
  needs `open(..., newline="")`: Python's universal-newline translation
  "fixes" it silently, and the only symptom is one field name per CRLF file.
- **The tier policy is imported, the tier *list* is not.**
  `pinakes_engine.orchestrate.tiers.classify_tier` is the same policy
  `@contracts/trust-tier` mirrors, so it is called rather than restated — but
  `ALL_TIERS` has six entries and this report's `byTier` has four. Personal and
  synthetic are provenance partitions on a different axis and no lexicon row can
  be either, so `quality.TRUST_TIERS` names the four trust rungs from the
  engine's own constants. Do not swap it for `ALL_TIERS`.
- **A missing corpus is a 500 here, uniquely.** Every other reader in this
  service degrades an absent file to an empty domain; `readdirSync` threw, and a
  quality report that graded a corpus that is not there would answer with a clean
  bill of health for nothing at all (`server/CLAUDE.md` — a missing directory is
  how the lexicon move was caught in the first place). Its 500 body is
  `{message}` alone, the inline-`routes.ts` spelling.

## The general corpus reader — `lexicons/` + `routers/{entity_resolver,summaries}.py` (pinakes:63 US-1)

Canonical per-entity URLs and progressive summary/detail — and, under both of them, the
thing two earlier ports kept deferring: `server/tsv-storage.ts`'s loaders, as
`lexicons/storage.py`. `collab/citable.py` (one row, four files) and `analytics/corpus.py`
(nine files, the columns four computations score on) both say in their docstring that they
are *not* the storage layer. This is what they were pointing at; **neither was folded into
it**, because a reader that serves one purpose exactly is easier to keep honest than one
that serves three approximately.

- **The package is `lexicons/`, not `corpus/`.** Two other things in this service already
  own that word — `engine.corpus` is the engine's `build/corpus` artifact and
  `analytics.corpus` is the analytics slice of these same TSVs.
- **Nothing is cached, deliberately.** The TypeScript memoised each table on its storage
  singleton; here every loader re-reads, for the same reason `contributions.store` builds its
  queue per call — `paths.lexicons_dir()` re-reads its env override every time, and that
  override is the only thing between a test and the live corpus. The largest file is ~1,100
  rows.
- **A missing *file* is an empty domain; a missing required *column* is a 500.**
  `readFileIfExists` returning null and `getIdx` throwing were two different statements over
  there. The two **language** loaders are the exception — they catch their own `getIdx` and
  degrade to `[]` — and `trade-goods` is the opposite extreme, reading all nine columns as
  required. Both kept as found.
- **Three JS coercions are load-bearing and disagree with each other.** `?? "living"` on a
  language's status is *nullish* (a blank cell stays blank, only a short row defaults);
  `row[idx] || ""` everywhere else is truthy; and `Number("")` is **0**, so a language with a
  latitude and a blank longitude sits on the prime meridian rather than dropping out. Only a
  cell that is not a number at all yields a null coordinate.
- **`GET /api/entity/religion/:id` resolves with a null region, and that is a port.** The
  Express fetcher reads `region`, which a `Religion` record calls `originRegion`. Fixing it
  here would make the two backends disagree about the same entity during the cutover.
- **Both entity routes and both summary *list* routes still answer on Express** — their
  fixtures are replayed against that app (`server/routes/entity-resolver.ts`). Only
  `/api/summaries/{domain}/{id}` was retired to 501. That is safe here in a way it would not
  be for a store: both sides only read, and `test_lexicon_storage.py` pins the reader to the
  live corpus's row counts.
- **`test_parity_replay.py` now links a fixture to its operation through the spec**, not by
  string equality. A fixture spells its route the Express way (`/api/entity/:domain/:id`) and
  the spec spells it the OpenAPI way (`/api/entity/{domain}/{id}`), so **every parameterized
  fixture had been silently skipping** — green either way, which is exactly what `GRADED`
  exists to catch. `test_every_fixture_binds_to_an_operation_in_the_spec` is the guard.
  The file also points `$PINAKES_LEXICONS_DIR` back at the **live** corpus for the duration
  of a replay: a recording of `/api/entity/language/cmn` cannot be reproduced by a service
  with no languages. Every recorded request is required to be side-effect free, so that read
  is safe — do not extend it to anything that writes.

## Deliberate divergences from `server/`

- Unknown `/api/*`, `/mcp*`, `/.well-known/*` URLs return **404 JSON**, not the
  SPA shell. Express's `app.use("*")` hands back `index.html` with status 200,
  which turns a typo'd fetch into an HTML parse error somewhere far away.
- A missing client build is a **503 with instructions at `/`**, not a startup
  crash (`serveStatic` throws). The API half is useful without a build.
- `/api/health` and `/api/_parity/coverage` are additive; the baseline has
  neither, and no baseline path contains `_`.

## The engine layer — `src/pinakes/engine/` (pinakes:50 US-1)

Everything this service asks of `pinakes_engine` goes through here, and it is
**not** a route layer: plain arguments in, JSON-ready dicts out. A router is a
thin adapter over it (`corpus.search(...)`, `graph.node(...)`, `datalog.run(...)`,
`acquisition.fetch(...)`), which is what lets the same call run from a job or a
test with no HTTP anywhere.

- **The payload builders reproduce the sidecar's bodies field for field.** Those
  shapes are what the client parses; the port preserves them rather than
  improving them. Where a value can be *imported* from the engine instead of
  restated it is (`COMPLETENESS_SORTS`, `ontology.metrics.to_json`,
  `orchestrate.tiers.PERSONAL_SOURCES`) — that is what stops the two drifting.
- **Two error classes, two status codes.** `EngineUnavailable` → **503**
  `{available:false}` (no corpus, no Neo4j config, driver extra absent, store
  down, no embedder); `EngineFailure` → **502** (a reachable backend rejected the
  request — a Cypher syntax error is the canonical case). Do not collapse them:
  503 says retry, 502 says the request was wrong.
- **Every backend is injectable, and that is the test seam.** `graph.configure(
  connect=…, retriever=…)` and `datalog.configure(console)`; `acquisition.fetch`
  takes an `adapter=`. `conftest.py` ships a `fake_graph` fixture and a
  `corpus_root`/`corpus_env` pair, so the whole layer is exercised with no
  database, no model, and no network. Reset in teardown (`reset_handles()`).
- **The corpus is `$PINAKES_ENGINE_CORPUS`, else `build/corpus`.** Same variable
  the sidecar's docker service read, same artifact. `load_corpus` is `lru_cache`d
  on the resolved path in the engine, so nothing caches it here.
- **`test_no_sidecar_or_subprocess_seam` is an absence guard**, in the shape of
  `server/security/*-proxy.test.ts`: it greps `src/pinakes/**.py` for a sidecar
  URL, the port number, or a child-process spawn. Its literals match *code*
  (`import subprocess`, not the bare word) so prose can still explain what was
  removed — except the port number, which has no code-only form, so do not write
  it under `src/`.
- **`pinakes_engine` ships `py.typed`** (added by the same story). Without it a
  strict-mypy consumer silently degrades every engine value to `Any`; with it,
  engine types are real here. If a `pinakes_engine.*` import ever starts reporting
  `import-untyped`, the marker fell out of `engine/pyproject.toml`'s package-data.

## Search, place resolution and viewport culling — `search/` + `geo/` + `routers/{search,places}.py` (pinakes:63 US-2)

`GET /api/search` and its three natural-language siblings, the three
`/api/map/places/*` endpoints, and — with no route of its own — the map layers'
bbox culling. Coverage 52/306 → 59/306. The band's headline is the one the
tasklist named: **the graph half of federated search is now in-process**
(`pinakes.engine.corpus.search`) rather than an HTTP call to the sidecar.

- **The corpus reader grew ten loaders and no new reader.** `lexicons/storage.py`
  now covers `words-base`, `music-traditions`, `musical-instruments`,
  `cuisine-items`, `migration-routes`, `art-traditions`, `architectural-styles`,
  `kinship-systems`, `foodway-events` and `settlements` — every one checked
  against the same `storage.get*()` call on the live corpus before its row count
  was pinned in `test_lexicon_storage.py`. Three shapes in them are corpus, not
  slips: `waypoints` is a geometry so its fallback is `{}` and not `[]`,
  `foodway-events` carries `[lat, lng]` **pairs** where art traditions carry
  `{lat, lng}` objects, and `kinship-systems` has **no name column at all**
  (which is why search displays `"<system type> (<id>)"`).
- **`load_base_words` is the one loader that RAISES on a missing file**, because
  `readFileOrThrow` did. That makes `/api/search` a 500 on a corpus with no
  `words-base.tsv` rather than a search that silently finds no words — and the
  empty lexicons tree `conftest.py` hands every test is exactly that corpus, so
  a route test has to seed the file. Kept deliberately: the concept list is the
  vocabulary spine, and an empty one reads as a corpus without vocabulary rather
  than a broken one.
- **Facets are computed over the full, unfiltered match set** — before filtering
  and before the 50-result cap — so the chip counts stay stable while a filter is
  active. `totalCount` is the *filtered* count. The two disagreeing is the
  contract, not a bug.
- **`search/graph_resolver.py` landed here for the dedup, not for
  `/api/graph/resolve`** (a different port unit, still 501). Two things about it
  are load-bearing. It **refuses** rather than guesses: two distinct csids tying
  the best score resolve to `None`, because a wrong link merges two entities into
  one result. And it is the **only** reader in this service that is not
  `lexicons.storage` — it reads every node file through the contract's column
  mapping, including the eleven no typed loader covers.
- **The app's entity types are not the schema's node types, and search passes the
  app's.** `civilization` never matches `culture`, `archaeological-site` never
  matches `place` — so those domains simply do not dedup against the graph. That
  is the Express behaviour; narrowing it here would make the two backends
  disagree about which results are duplicates mid-cutover.
- **This resolver IS cached, keyed on the directory it indexes** — unlike every
  loader in `lexicons/`, because building one reads ~24 files and federated
  search wants one per request. Same rule as `analytics.index`; `conftest.py`'s
  autouse `reset_alias_index` clears it between tests.
- **`urllib`, not a new HTTP dependency.** GeoNames/Nominatim live behind
  `places.PlaceResolverDeps` and the live implementation is stdlib — this service
  declares no runtime HTTP client (`httpx` is a *dev* dependency, for
  `TestClient`), and taking one on for two optional geocoders would be a poor
  trade. No `$GEONAMES_USERNAME` ⇒ `fetch_geonames` raises ⇒ Nominatim, which is
  the normal state of a checkout. The Nominatim **rate-limit sleep did not come
  across**: it guarded a module-level timestamp in a single-threaded event loop,
  and the local-results short-circuit is what actually caps request volume.
- **`geo/bbox.py` has no route and that is on purpose.** The `/api/map/*` layers
  are a different port unit; it landed with the place resolver because they are
  the two halves of `server/services/*` the map sits on. `test_geo_bbox.py` is
  therefore its only gate — including the three behaviours a rewrite would
  quietly "improve": an uncomputable geometry is **kept**, a malformed bbox is a
  **no-op**, and swapped corners are **normalized**.
- **One irreducible divergence, and it is in the last ULP.** `distanceKm` on
  `/api/search/spatial` differs from Express in the ~14th significant digit,
  because V8's `Math.cos` and CPython's differ by one unit in the last place. The
  haversine here is spelled operation for operation as the TypeScript spelled it
  (`(x * pi) / 180` not `math.radians`, `sin(x) * sin(x)` not `sin(x) ** 2`, same
  left-to-right association) — that closed every *other* gap; a whole-corpus diff
  of 27 recorded queries is byte-identical apart from these distances.
- **`GET /api/search` is served by BOTH backends**, like `GET /api/citations` and
  the two entity-resolver routes: its `get-search` fixture is replayed against
  Express. The other six routes in the band are fixture-free and retired to 501.

## Single-entity ingest — `ingest/` + `routers/{extract,translate}.py` (pinakes:64 US-1)

`POST /api/extract/{text,url}` and `POST /api/translate`: three small pipelines that turn
one paste into one reviewable draft (or one translated string). Coverage 59/306 → 62/306.
This is the first band whose routes **reach the open internet**, and that is what shapes
it.

- **There is one door out, and it is the engine's.** Every outbound fetch goes through
  `ingest/http.py`, which hands out `pinakes_engine.acquire.http.HttpClient` — the same
  polite client the acquisition adapters use: per-host rate limiting, exponential backoff
  honouring `Retry-After`, a real User-Agent, and an on-disk cache. The TypeScript called
  bare `fetch` four times over and had none of it; a throttled model read as a failed
  extraction on the first try. **Do not construct a second client anywhere in this
  package.**
- **A client is built per *source*, once, and shared** — a per-call client would rate-limit
  nothing, because each one starts unthrottled. `WIKIMEDIA` keeps the one-second spacing the
  Wikimedia User-Agent policy asks for; `GOOGLE` deliberately keeps **none**: those
  endpoints are key-authenticated and quota-metered, and the client translates a vocabulary
  word by word, so a one-second floor would be a minute of waiting per fifty words. Both
  keep the retry budget. `conftest.py`'s autouse `reset_ingest_clients` is not optional —
  without it a test that forgot to configure a fake would talk to the real Wikidata.
- **The engine's client grew a `post()` for this** (never cached — a POST is a request to
  *do* something, and replaying a stored answer would skip the doing; the cache counters
  record neither a hit nor a miss). Its `Transport` protocol gained an optional `body`
  keyword, and `HttpClient._send` passes it **only when there is one**, because every
  transport written before POST existed takes no such keyword —
  `test_a_get_never_passes_a_body_to_its_transport` is that guard.
- **These handlers are `def`, not `async def`.** The engine's client is synchronous
  (`requests` + `time.sleep`), so FastAPI runs them in its threadpool where blocking is
  fine. Declared `async` they would block the event loop for the whole process while
  Wikidata answers — and the rate limiter's own sleep would block it *deliberately*.
- **The model is REST, not an SDK.** `@google/generative-ai` has no equivalent here worth
  taking on for one route, so `text_extractor.LiveDeps` posts to `generateContent` with the
  same prompt and the same response schema (the REST enum spells its types in upper case).
  The key rides in an `x-goog-api-key` **header**: a query parameter is logged by every hop
  between here and the model. Same rule made `translate` a POST rather than the GET form
  that would have been cacheable — a cached response carries the URL it was fetched from.
- **Both extractors write only to the contribution queue.** That was already true on
  Express and is the premise of the surface: a paste is a *draft*, and the corpus changes
  when a reviewer promotes it (`routers/ai_review.py`).
- **The three Python suites are graded against the TypeScript's own recorded fixtures**
  (`server/services/fixtures/{text,url}-extractor/`), read out of the repo rather than
  copied. That is what makes them a port rather than a rewrite that happens to agree —
  and it is why `server/services/{text-extractor,url-extractor,translate}.ts` are kept as
  the graded spec while their *routes* are retired to 501.
- **`?entityType=""` is not `entityType` absent.** `draft_to_contribution` resolves its
  default with `??`, not `or`, so an explicitly blank type reaches the queue and is
  rejected there — the same answer Express gave, and a clearer one than silently filing a
  paste as a civilization. Same family as `"key" in data` in the contribution store.

## Archaeological acquisition — `ingest/{archaeology,jobs}.py` + `routers/archaeology.py` (pinakes:64 US-2)

`GET /api/scraping/archaeology/sources` and `POST /api/scraping/archaeology`: Open Context
and tDAR, acquired into the contribution queue. Coverage 62/306 → 64/306. It is the same
band as the extractors — one external record becomes one reviewable draft — but the unit
is a *job* rather than a request, and that is what everything below is about.

- **The POST answers 202 and works afterwards, as a `BackgroundTasks` task.** For a `def`
  callable that means Starlette's threadpool, which is where the ingest layer's synchronous
  client belongs. **`TestClient` runs a background task to completion before returning the
  response**, so a test asserts on a settled job on the very next line — which is why the
  TypeScript route's `onJobSettled` hook has no counterpart here. It existed only to make
  the same thing deterministic.
- **`ingest/jobs.py` has no route, and that is the point to know.** `/api/scraping-jobs` is
  a different port unit and is still Express's, so a job started here is not visible to the
  dashboard's poll yet. The acquisition is unaffected — it writes `data/runtime/contributions`,
  which both servers read — but its *progress* is in-process until that group lands.
  Do not "fix" this by having the store write to disk: Express's reader is an in-memory
  `Map` and would not read it, so the only thing that would change is that a transient
  would have become an artifact. `conftest.py`'s autouse `reset_scraping_jobs` is the same
  class of module state as `reset_write_guard`.
- **A fetch failure fails the *job*, not the request.** The 202 has already been sent, so
  the job carries `status: "failed"` + `errorMessage` and there is nowhere else to report
  it. A body this service can refuse *before* starting — an unknown source, a non-positive
  limit — is a **400**, and starts no job at all. Neither is a 5xx.
- **`Number(body.limit)`, not a declared `int`.** `"50"` is fifty and `"soon"` is a 400
  rather than a 422 — the same rule `routers/graph.py` follows for its numeric params. The
  refusal message reads `${body.source ?? "(none)"}`: *nullish*, so an explicitly blank
  source is reported as the blank it was. Same family as `??` vs `or` in the extractors.
- **Only the bottom half of `server/services/archaeological-site-scraper.ts` came across.**
  That file is 1,376 lines and the split is the one it already drew in its own banner
  comment: the Pleiades/UNESCO `ArchaeologicalSiteScraper` class above it writes TSVs
  directly and is reached by no route. Porting a *route group* means porting what a route
  reaches; the rest stays as the graded spec, and `tests/test_archaeology.py` reads the
  same recorded fixtures its TypeScript suite does.
- **Three refusals in the mappers are contract, not defensiveness**: a record with no name
  is dropped, one off the globe is dropped, and one at **exactly `[0, 0]`** is dropped —
  in this data that is never Null Island but always coordinates nobody filled in. A dropped
  record is counted as `skipped`, never queued with a guess.
- **The `AbortSignal` did not come across.** The TypeScript route never passed one and no
  caller here could; a run is bounded by `limit`, which is what the dashboard sets.
- `ingest/http.py` gained `OPEN_CONTEXT` and `TDAR`, both back on the one-second floor
  `WIKIMEDIA` keeps — they are small unkeyed scholarly publishers, and an acquisition asks
  each of them for exactly one page.
## The capability bus, the agent-card and MCP — `kcb/` + `acquire/` + `routers/{capability_bus,a2a,mcp}.py` (pinakes:65 US-1)

How Pinakes publishes *itself* on the Koine control plane, plus `/api/graph/resolve`,
the last non-engine-backed route in the graph group. Coverage 59/306 → 68/306. Full
contract in `docs/capability-bus.md`; what is worth knowing before touching it:

- **The manifest is read, never restated.** `kcb/manifest.py` calls
  `pinakes_contracts.capability_manifest.document()` and mutates its own clone, so
  `contracts/capability-manifest.json` stays the one source. That is what makes the
  proof possible: with no origin, no signing key and no registry, the served
  well-known document is **byte-identical to the contract on disk**, which is the
  self-describing-participant guarantee `server/routes/participation-self-sufficiency.test.ts`
  makes on the other side.
- **`canonical_json` needs `ensure_ascii=False`, and that is load-bearing.** The
  manifest is full of `—` and `§`; `JSON.stringify` writes them literally, and a
  Python escape to `\uXXXX` would be a different byte string and therefore a
  different **signature**. A signature minted here verifies over there and vice
  versa, the derived `key_id` matches digit for digit, and there is a test for both
  — do not "tidy" that call.
- **`cryptography` is a new runtime dependency, for Ed25519 only.** `node:crypto`
  gave the Express front this for free and the stdlib has none. Serving unsigned
  where an operator configured a key would be a silent downgrade, not a degrade —
  which is the one thing the optional-env pattern must not do.
- **`registry.ensure_published()` fires on the first `/api/kcb` request, not at
  startup.** Express published at route-registration time; an `APIRouter` has no
  startup hook and `app.py` is the file parallel port tasklists must not touch. The
  push runs off the event loop and the outcome is module state — hence
  `conftest.py`'s autouse `reset_kcb`, which also clears the three env vars that
  change what the fronts serve.
- **The agent-card is a reimplementation, not a port, because the SDK is the spec.**
  Express builds it through `@a2a-js/sdk`'s codec, which **drops** empty and
  default-valued fields (`tenant: ""`, `required: false`, the empty
  `examples`/`inputModes`/`securitySchemes`/`signatures`). `kcb/agent_card.py` emits
  the already-normalized document; `test_agent_card.py` pins the key set. Adding a
  field means checking what the codec does with it first.
- **`/mcp` is hand-rolled JSON-RPC, and that is the stateless transport's whole
  surface**: `initialize` / `ping` / `tools/list` / `tools/call`, a notification
  answered with **202 and no body**, GET/DELETE answered **405 with a JSON-RPC error
  body** (not FastAPI's `{"detail": …}`). The `Accept` header is deliberately not
  enforced — this front only ever answers JSON, so rejecting a JSON-only client
  would be stricter than what it implements.
- **Two MCP tools are advertised and not dispatchable here, on purpose.**
  `finetune`/`finetune_subscribe` wrap the private `lugh` checkout by spawning a
  subprocess, which `test_engine_inprocess.test_no_sidecar_or_subprocess_seam`
  forbids under `src/`. Advertising them keeps `tools/list` in step with the
  manifest (a describe surface that disagreed would tell a router Pinakes is not a
  finetune provider at all); the *invoke* degrades naming the Express front. That is
  also why `/mcp` still answers over there — retiring it would leave the capability
  invocable nowhere.
- **`acquire/` is not a bus concept and should not move under `kcb/`.** It is the
  meaningful half of `server/services/engine-acquisition.ts` — the four-domain
  catalog, the SPARQL, the record → contribution mapping — and today only the MCP
  `reconcile` tool calls it. When `tasks/chief/70-unify-scrapers` ports
  `POST /api/scraping/engine` it should wrap `acquire.job.run` and bring the job
  store with it. The **spec is a dict, not YAML**: the YAML only ever existed to
  hand a file to a child process.
- **`reconcile` returns the outcome, not a job id.** Express minted a `jobStore` job
  and streamed progress through `GET /api/scraping-jobs`, which this backend does
  not serve — a `jobId` here would be one nothing can be polled about.
- **`/api/graph/resolve` lives in `routers/graph.py` but is not engine-backed.** It
  reads the alias table off the local lexicons, so it answers while Neo4j is down —
  which is the entire reason the client can decide whether to render a "Show in
  graph" affordance. It has no 503/502 path; `null` covers a no-match *and* an
  ambiguous match, because a wrong link merges two entities into one.
- **Three routes are served by BOTH backends**, the `GET /api/citations` precedent
  with a reason each: `/api/kcb/manifest` (its `get-kcb-manifest` fixture is
  replayed against Express), `/.well-known/{kcb-manifest.json,agent-card.json}` (the
  self-sufficiency guard drives them) and `/mcp` (the KFT pair above). All three are
  pure functions of a committed JSON file, and the byte equality is asserted.

## Authoring, suggestions and the connection narrative — `authoring/` + `narrative/` + `routers/{timeline,drawn_geometry,relationships,ancestry}.py` (pinakes:65 US-2)

The eleven routes that finish the graph-adjacent band: the three in-app authoring
surfaces (a timeline entry, a drawn geometry, a typed edge), the suggestions that
propose the third, DNA→culture ancestry, and `POST /api/graph/explain`. Coverage
68/306 → **79/306**, and the whole `graph` port unit is now ported.

- **`authoring/_js.py` is the load-bearing file, not `_`-prefixed by accident.** Two
  recorded fixtures grade this band and both record a **400 body**, so an error string
  is a contract. Three JavaScript distinctions decide those bodies and Python makes
  none of them for free: `MISSING` keeps *absent* apart from *null* (an omitted
  confidence warns and defaults, a declared `null` is a 400 — the same trap
  `contributions/store` documents), `is_finite_number` refuses a bool where
  `isinstance(True, int)` would accept year 1, and `number_text` prints an integral
  float as `2500` rather than `2500.0`.
- **`jsmath.js_number` is the fourth, and it is about the wire.** Every JavaScript
  number is a double but an *integral* one serialises with no fractional part, so a
  Jaccard ratio of exactly 1 is `1` and not `1.0`. Apply it to a **derived** value
  reaching a response (`suggestions.compute_proximity`, `connection.path_confidence`);
  a value read straight out of a request or a TSV already has the source's type.
  `jsmath.locale_key` is the ordering counterpart — `localeCompare` sorts by base
  letter and case *last*, so a code-point sort pushes every lowercase display name
  behind every capitalised one.
- **The whole band was proved byte-identical to the TypeScript before landing**, with
  the throwaway-script method the US-1 notes describe: both 400 bodies, all three
  contribution mappings, the relationship summary + the 21 canonical type options, the
  path evidence + aggregate confidence + the **full LLM prompt**, the ranked
  suggestions, the live-corpus ancestry map, and all **5,836 canonical edges / 1,531
  skips**. Those last two numbers are pinned in `tests/test_canonical_edges.py`.
- **`lexicons/canonical_edges.py` is the *dedup* reader, and merging it with the
  TypeScript would break the exporter.** `server/services/canonical-edges.ts` is still
  read by `scripts/export-for-engine.ts` to write `build/corpus/`. One gotcha the port
  had to reproduce: that file's private `readTsv` **trims header cells** where
  `analytics.tsv.parse_tsv` does not, and an untrimmed header makes every column of
  that file read as absent.
- **The candidate pool is a second projection of the same TSVs, deliberately.**
  `authoring/candidates.py` ports `getAllEntities`, which differs from
  `analytics.correlation.load_domain` in three ways that change what gets suggested:
  the music domain is `music-tradition` not `music`, `archaeological-site` is included,
  and a civilization is read through its GeoJSON `properties.timePeriod`. Collapsing
  them would silently re-rank one consumer.
- **A dimension neither entity carries is *unmeasured*, not zero** —
  `combined_confidence` averages over the applicable dimensions only. A language with
  no coordinates is not far away, and diluting its score would rank it below a
  genuinely weaker match. This is the rule most likely to be "simplified" away.
- **`narrative/` splits pure from networked, and the honesty guarantee lives in the
  split.** With no path *and* no inferred fact the model is never called, so
  `aiGenerated: false` is the absence of prose rather than a judgement about it. The
  Datalog augmentation is `pinakes.engine.datalog` **in process** where Express posted
  to the sidecar console, and it degrades to `[]` on any failure.
- **`narrative/llm.py` is `urllib` against the Gemini REST endpoint, not the vendor
  SDK** — the same trade as `kcb/registry.py` and `search/places.py`. A missing
  `$GEMINI_API_KEY` **raises** (→ 502 naming the reason); degrading to empty prose
  would read exactly like the honest "no connection found", which is the one answer
  this surface must never fake. `$GEMINI_API_BASE_URL` exists so a test can point at a
  stub instead of monkeypatching `urllib`.
- **`engine/graph.find_path` withholds a whole path that traverses a personal-tier
  node**, rather than pruning the node — a partial chain would misrepresent how the two
  ends are connected. Same posture as `node()` returning `None`.
- **Two routes are served by BOTH backends**, the `GET /api/citations` precedent:
  `POST /api/timeline/event` and `POST /api/graph/explain` carry recorded fixtures
  replayed against Express. Safe for a stronger reason than usual — both recordings are
  **validation rejections**, refused before either backend touches a store, a graph or
  a model, and `test_timeline_event.py` / `test_connection_narrative.py` pin the two
  400 bodies. The other nine routes are fixture-free and retired to 501.
