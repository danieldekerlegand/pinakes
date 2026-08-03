# `contracts/` — the cross-language source of truth

Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). The shared
schema and registries moved here from `shared/` in `20-repo-restructure` US-2 —
a mechanical move; the TS alias is now `@contracts/*`.

## Purpose

The canonical schema and registries that both sides of the stack must agree on —
`canonical-schema.json`, the predicate mapping, and friends. Today they are
TS-shaped and TS-only; here they become **language-neutral** (JSON/schema) with
**generated Python and TS bindings** plus a drift gate, so the Python engine and
the TS client cannot silently diverge (§10).

Bindings are generated, never hand-maintained and never path-joined ad hoc — that
is what makes the rest of the reorg safe (§8).

Working notes on the individual contracts (canonical schema, confidence rubric,
trust tiers, capability manifest, predicate mapping, KGP) live in
[`CLAUDE.md`](./CLAUDE.md).

## Still to come

| Item | Note |
|---|---|
| generated Python bindings + a drift check | the Python side still reaches in by path (`_REPO_ROOT / "contracts" / "canonical-schema.json"` in `engine/` and `ml/`) — that is what the bindings replace |
