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
- **The changelog write-half only.** `GET /api/changelog` is a different port
  unit; `contributions/changelog.py` just appends records in the same shape and
  directory, best-effort — a failed audit line must never cost a reviewer their
  decision.

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
- `conftest.py`'s autouse `isolated_data_trees` now redirects five trees. **Add
  yours the moment a port starts writing one** — every store resolves its
  directory through `pinakes.paths` per call precisely so that fixture is the
  only thing between a test and live user data.

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
