# `web/` — the React/Vite client

Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). The client
moved here from `client/` in `20-repo-restructure` US-2, together with the
root-level TS build configs.

## Purpose

The browser client — the one part of the stack that **stays TypeScript** through
the flatten. It talks to [`services/api/`](../services/api/) over HTTP and shares
types with it via generated bindings from [`contracts/`](../contracts/).

## Shape

```
web/
├── index.html                  # the vite entry (vite `root` IS this directory)
├── public/
├── src/
└── vite · tailwind · postcss · tsconfig · vitest · playwright · components.json
```

Per §4 the repo root keeps README, LICENSE, the uv workspace manifest, and
`.gitignore` — nothing else structural.

## The configs are addressed explicitly, not discovered

Everything still *runs* from the repo root (the server, the scripts, npm), so the
configs no longer sit where their tools look by default. Each entry point names
its config:

| Command | Config |
|---|---|
| `npm run check` | `tsc -p web/tsconfig.json` |
| `npm test` | `vitest run --config web/vitest.config.ts` |
| `npm run test:e2e` | `playwright test --config web/playwright.config.ts` |
| `npm run build` | `vite build --config web/vite.config.ts` |

Three consequences worth knowing before editing a config here:

- **`vitest.config.ts` sets `root` to the repo root.** The suite still spans
  `web/`, `server/`, `scripts/`, `contracts/` and `test/`, so a `web/`-scoped root
  would silently drop ~60% of it. A bare `vitest` (no `--config`) finds no config
  at the root and runs with defaults — no `@`/`@contracts` aliases — so always go
  through `npm test`.
- **`postcss.config.js` names the tailwind config path explicitly.** Tailwind's
  postcss plugin resolves its config from `process.cwd()` (the repo root), and
  `tailwind.config.ts` anchors its own `content` globs on `__dirname` for the same
  reason.
- **`playwright.config.ts` is `../`-relative** — the specs (`e2e/`), the dev
  server's `cwd`, and the artifact directories all stay at the repo root.

There is also a **one-line `tsconfig.json` shim at the repo root**. It is not a
second project config: `tsx` resolves path aliases from the nearest `tsconfig.json`
at or above its cwd, so without it `npm run dev` and every `tsx scripts/*.ts`
fail to resolve `@contracts/*` at runtime. Keep its `paths` in sync with
`web/tsconfig.json`'s. It disappears when `server/` is ported to Python.
