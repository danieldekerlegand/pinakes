# `pinakes-contracts` — the Python bindings for `contracts/`

The Python half of the language-neutral contract
([`docs/UNIFIED-PROJECT-PLAN.md` §10](../../docs/UNIFIED-PROJECT-PLAN.md)). The
source of truth is the JSON one directory up (`contracts/*.json`); this package is
**generated** from it by `scripts/gen-contract-bindings.ts`, exactly as
`contracts/generated/*.ts` is the generated TypeScript half.

```sh
npm run gen:contracts     # regenerate both halves
npm run check:contracts   # read-only staleness check (the drift gate)
```

## What is generated and what is not

| File | |
|---|---|
| `src/pinakes_contracts/canonical_schema.py` | generated |
| `src/pinakes_contracts/confidence_rubric.py` | generated |
| `src/pinakes_contracts/capability_manifest.py` | generated |
| `src/pinakes_contracts/lexicon_mapping.py` | generated |
| `src/pinakes_contracts/predicate_mapping.py` | generated |
| `src/pinakes_contracts/__init__.py` | generated |
| `src/pinakes_contracts/_documents.py` | hand-written (the on-disk resolver) |
| `pyproject.toml`, `README.md`, `py.typed` | hand-written |

**Never edit a generated module.** Change the JSON and regenerate — the drift gate
compares the committed bindings byte-for-byte against a fresh generation.

## Embedded constants vs. the whole document

The generated modules **embed** the vocabulary they declare (node/edge types,
header rows, confidence priors) as frozen Python literals. Nothing is read from
disk at import time, so an installed wheel works with no repo layout around it —
which is what lets `pinakes_engine.schema.headers` import the canonical columns at
module scope.

The three registries (`capability-manifest`, `lexicon-mapping`,
`predicate-mapping`) are consumed whole rather than field by field, so each module
embeds only its version pin and key vocabulary and exposes `document()` for the
rest. `document()` reads `contracts/<name>.json` through
`pinakes_contracts.contract_path`, which **does** need the checkout (it resolves
relative to this package's source location, or `$PINAKES_CONTRACTS_DIR`).

## Consumers

- `pinakes_engine.confidence` — re-exports the rubric priors (it used to transcribe them).
- `pinakes_engine.schema.headers` — `NodeSchema.canonical()` / `EdgeSchema.canonical()`
  are built from `canonical_schema.NODE_COLUMNS` / `EDGE_COLUMNS`.
- `pinakes_engine.datalog.schema_constraints` — locates `canonical-schema.json`
  through `contract_path` instead of walking up to the repo root.
- `pinakes.paths` (`services/api`) — locates `contracts/parity/openapi.json`
  through `contracts_dir()`.
