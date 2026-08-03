# `contracts/` — the cross-language source of truth

Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). The shared
schema and registries moved here from `shared/` in `20-repo-restructure` US-2 —
a mechanical move; the TS alias is now `@contracts/*`.

## Purpose

The canonical schema and registries that both sides of the stack must agree on —
`canonical-schema.json`, the predicate mapping, and friends. They are
**language-neutral** (JSON) with **generated Python and TS bindings**, so the
Python engine and the TS client cannot silently diverge (§10). Neither language is
authoritative; the JSON is.

Bindings are generated, never hand-maintained and never path-joined ad hoc — that
is what makes the rest of the reorg safe (§8).

Working notes on the individual contracts (canonical schema, confidence rubric,
trust tiers, capability manifest, predicate mapping, KGP) live in
[`CLAUDE.md`](./CLAUDE.md).

## Layout

| Path | |
|---|---|
| `*.json` | the neutral **source of truth** — edit here |
| `generated/*.ts` | generated TypeScript bindings (literal vocabularies the JSON import widens away) |
| `python/` | the `pinakes-contracts` uv workspace package — generated Python bindings ([README](./python/README.md)) |
| `*.ts` | the hand-written typed accessors + runtime validators, which consume the generated bindings |
| `parity/` | the Express → FastAPI parity baseline (its own generators; see [`parity/README.md`](./parity/README.md)) |

```sh
npm run gen:contracts     # regenerate both language halves (scripts/gen-contract-bindings.ts)
npm run check:contracts   # read-only staleness check
```
