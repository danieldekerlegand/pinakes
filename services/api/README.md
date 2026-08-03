# `services/api/` — the unified Python backend (FastAPI)

The **`pinakes`** package: routing, auth, request/response shaping, and serving
the built React client. The rewrite target for today's `server/` (TS/Express)
([`docs/UNIFIED-PROJECT-PLAN.md` §4/§5](../../docs/UNIFIED-PROJECT-PLAN.md)).
Distinct from `pinakes_engine` in [`engine/`](../../engine/) and `pinakes_ml` in
[`ml/`](../../ml/).

**Status: the shell is up; no route group is ported yet.** All 306 baseline
routes answer `501`. Node/Express is still what serves them for real.

```
services/api/
├── src/pinakes/
│   ├── app.py              # create_app() — the four wiring steps, in order
│   ├── routers/            # drop a module in here and it is mounted
│   ├── parity.py           # the Express baseline, read as data
│   ├── not_implemented.py  # the 501 catalog (= baseline minus routers/)
│   ├── client.py           # the built SPA at /, with fallback
│   ├── paths.py            # repo root · dist/public · the parity spec
│   └── __main__.py         # `python -m pinakes`
├── tests/
└── pyproject.toml
```

## Running it

```bash
uv sync --all-packages                        # once, from the repo root
npx vite build --config web/vite.config.ts    # the client, into dist/public
uv run --all-packages python -m pinakes       # http://localhost:3050
```

`$PORT` (default 3050) matches `server/index.ts`, so the client's same-origin
`/api/...` fetches work unchanged. `PINAKES_RELOAD=1` turns on auto-reload.
Without a client build the API still serves; `/` explains what to run.

## Testing it

```bash
uv run --all-packages pytest services/api/tests -q
uv run --all-packages ruff check services/api
uv run --directory services/api --all-packages mypy
```

`--all-packages` matters: this member and `engine/` share one root `.venv`, and
`--project services/api` alone does not install the engine's test toolchain — so
the repo-root `pytest` default (both suites, see `/pytest.ini`) would die during
collection on a cold checkout.

## Adding a route group (what every port tasklist does)

1. Pick a port unit from `/api/_parity/coverage` or from `tags` in
   [`contracts/parity/openapi.json`](../../contracts/parity/openapi.json).
2. Add **one file**: `src/pinakes/routers/<unit>.py`, exposing
   `router = APIRouter()` and registering the baseline's paths **verbatim**.
3. Grade it with that unit's recorded fixtures
   ([`contracts/parity/`](../../contracts/parity/README.md)).

There is nothing else to edit — no router list, no `include_router` call, no
status field. The 501 stub for a route disappears exactly when a router claims
it, because the catalog is computed as *baseline minus routing table*. See
[`src/pinakes/routers/__init__.py`](src/pinakes/routers/__init__.py) for the
full drop-in contract and [`CLAUDE.md`](CLAUDE.md) for the traps.

## Endpoints the shell adds

| route | what |
| --- | --- |
| `GET /api/health` | liveness, discovered routers, whether the client is built |
| `GET /api/_parity/coverage` | every baseline route, split ported/unported, per port unit |

Neither is a parity route — the Express backend has no `/api/health`, and no
baseline path contains `_`.

## The uv workspace

A member of the root virtual workspace ([`/pyproject.toml`](../../pyproject.toml))
alongside `engine/`: one root `uv.lock`, one root `.venv`. It depends on
`pinakes-engine` **as a workspace member** (`[tool.uv.sources]`), which is what
makes "the engine is imported in-process" a resolution fact rather than an
intention.

## Moves in later

| Current | Note |
|---|---|
| `server/` (TS) | rewritten in Python; the `server/services/` legacy TS scraper stack is culled, not ported |
