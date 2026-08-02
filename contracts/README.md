# `contracts/` — the cross-language source of truth

**Status: empty placeholder.** Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). Nothing has
moved here yet; the shared schema and registries still live in
[`shared/`](../shared/).

## Purpose

The canonical schema and registries that both sides of the stack must agree on —
`canonical-schema.json`, the predicate mapping, and friends. Today they are
TS-shaped and TS-only; here they become **language-neutral** (JSON/schema) with
**generated Python and TS bindings** plus a drift gate, so the Python engine and
the TS client cannot silently diverge (§10).

Bindings are generated, never hand-maintained and never path-joined ad hoc — that
is what makes the rest of the reorg safe (§8).

## Moves in later

| Current | Note |
|---|---|
| `shared/` | + generated Python bindings and a drift check |
