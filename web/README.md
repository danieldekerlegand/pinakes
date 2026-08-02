# `web/` — the React/Vite client

**Status: empty placeholder.** Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). Nothing has
moved here yet; the live client is still [`client/`](../client/).

## Purpose

The browser client — the one part of the stack that **stays TypeScript** through
the flatten. It talks to [`services/api/`](../services/api/) over HTTP and shares
types with it via generated bindings from [`contracts/`](../contracts/).

## Planned shape

```
web/
├── src/
└── (vite · tailwind · postcss · tsconfig · vitest · playwright)
```

The root TS build configs move **in here** with the client. Per §4 the repo root
keeps README, LICENSE, the uv workspace manifest, and `.gitignore` — nothing else
structural.

## Moves in later

| Current | Note |
|---|---|
| `client/` | mechanical move, no rewrite |
| `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `components.json` | follow the client off the root |
