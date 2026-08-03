# `services/api/` — the unified Python backend (FastAPI)

**Status: empty placeholder.** Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../../docs/UNIFIED-PROJECT-PLAN.md). Nothing
has moved here yet; the live backend is still `server/` (TS/Express).

## Purpose

The web layer of the flattened service: routing, auth, request/response shaping,
and serving the built client. It is the **rewrite** target for today's `server/`
— Node/Express disappears when the port lands.

Package name: **`pinakes`** (the service/web package), distinct from
`pinakes_engine` in [`engine/`](../../engine/) and `pinakes_ml` in
[`ml/`](../../ml/).

## Planned shape

```
services/api/
├── src/pinakes/     # routing · auth · request/response · serves the client
├── tests/
└── pyproject.toml
```

## Joining the uv workspace

The repo root is a virtual uv workspace root since pinakes:20 US-4
([`/pyproject.toml`](../../pyproject.toml)); `engine/` is its only member today.
This directory is **not** listed yet because uv rejects a member with no
manifest. Adding `pyproject.toml` here (tasks/chief/30-api-shell-parity.json
US-2) is a two-line change:

1. add `"services/api"` to `[tool.uv.workspace] members` in the root manifest;
2. `uv lock` — one root `/uv.lock` then covers `pinakes` + `pinakes-engine`, and
   `uv run --project services/api pytest` (tasklist 30's verify command) works.

Depend on the engine as a workspace member, not from PyPI:
`dependencies = ["pinakes-engine"]` plus
`[tool.uv.sources] pinakes-engine = { workspace = true }`.

## Moves in later

| Current | Note |
|---|---|
| `server/` (TS) | rewritten in Python; the `server/services/` legacy TS scraper stack is culled, not ported |
