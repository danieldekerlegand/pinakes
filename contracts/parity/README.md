# `contracts/parity/` — the Express → FastAPI parity baseline

The contract the Python service (`services/api`) must satisfy as route groups are
ported off `server/` (docs/UNIFIED-PROJECT-PLAN.md §5/§7; tasklist
`tasks/chief/30-api-shell-parity.json` US-1).

| file | what it is |
| --- | --- |
| `openapi.json` | **Generated.** Every route the Express app serves, with the file that registers it, whether `web/src` calls it, and recorded response schemas. Do not hand-edit. |
| `requests.json` | **Curated.** The representative requests worth recording (the only hand-written file here). |
| `fixtures/*.json` | **Recorded.** One request/response pair per catalog entry: status + structural shape + a truncated sample. |
| `shape.ts` | Structural shape describe/merge/match — pure, no fs. |
| `harness.ts` | Replays a fixture against any handler behind an injectable `ParityFetch`. |

## Regenerating

```bash
npm run parity:record      # replay contracts/parity/requests.json → fixtures/
npm run parity:spec        # harvest the routing table → openapi.json
npm run parity:spec:check  # read-only: exit 1 if openapi.json is stale
```

Record **before** generating — the spec folds recorded shapes into each operation's
response schema. Both are deterministic (no wall-clock, no ids in the spec), so
re-running against an unchanged API is an empty diff.
`contracts/parity/parity.test.ts` fails if `openapi.json` drifts from the live app.

## How it is used

1. **Now** — `parity.test.ts` replays every fixture against the Express app, so the
   baseline can't rot while the port is in flight.
2. **Per port tasklist** — pick a `tags`/`x-pinakes-parity.source` group out of
   `openapi.json`, implement it in `services/api/src/pinakes/routers/`, and grade it
   with the *same* fixtures. Passing them is what "ported" means.
3. **Coverage** — every route in the spec that the Python service does not register
   answers `501`, so what is left to port is always machine-readable.

## Rules that keep this honest

- **Shapes, not values.** The corpus grows and ids churn; asserting on values would
  make the gate a liability. A ported handler may return *more* than the baseline,
  never less (`shape.ts` documents the exact asymmetry).
- **Catalog entries must be side-effect free** — a read, or a write rejected at
  validation before any store is touched (that's what the `expectStatus: 400`
  entries are). Never record something that mutates the corpus or the contribution
  queue.
- **`sample` is documentation.** It is truncated and never asserted on.
- **`x-pinakes-parity.unservedClientReferences`** lists `/api/...` literals in
  `web/src` that no route serves — dead client calls. The port must not reproduce
  them; the list growing means someone added a call to a route that isn't there.
- The recorded contract reflects the environment the recording ran in: with no
  Neo4j/sidecar/API keys, `/api/graph/status` records its **degraded** shape. That
  is the contract the client tolerates, and it is what the port must reproduce under
  the same conditions.
