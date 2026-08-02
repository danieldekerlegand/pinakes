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

## Moves in later

| Current | Note |
|---|---|
| `server/` (TS) | rewritten in Python; the `server/services/` legacy TS scraper stack is culled, not ported |
