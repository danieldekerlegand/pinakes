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

## Deliberate divergences from `server/`

- Unknown `/api/*`, `/mcp*`, `/.well-known/*` URLs return **404 JSON**, not the
  SPA shell. Express's `app.use("*")` hands back `index.html` with status 200,
  which turns a typo'd fetch into an HTML parse error somewhere far away.
- A missing client build is a **503 with instructions at `/`**, not a startup
  crash (`serveStatic` throws). The API half is useful without a build.
- `/api/health` and `/api/_parity/coverage` are additive; the baseline has
  neither, and no baseline path contains `_`.
