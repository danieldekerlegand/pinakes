# `contracts/parity/` — the Express → FastAPI parity baseline (frozen)

The contract the Python service (`services/api`) was ported against, and still
serves under (docs/UNIFIED-PROJECT-PLAN.md §5/§7; tasklist
`tasks/chief/30-api-shell-parity.json` US-1).

**This baseline is frozen.** `tasks/chief/80-cutover.json` US-1 ported the last of
the 306 routes and US-2 deleted `server/`, so there is no Express app left to
harvest a spec from or record a fixture against — and no way for these files to
drift from one, either. What was generated is now history: a recorded statement of
what the TypeScript backend served, kept because the Python service is still
graded against it.

| file | what it is |
| --- | --- |
| `openapi.json` | Every route the Express app served, with the file that registered it, whether `web/src` called it, and recorded response schemas. **Frozen; do not hand-edit.** |
| `requests.json` | The curated catalog the fixtures were recorded from. Frozen with them. |
| `fixtures/*.json` | One request/response pair per catalog entry: status + structural shape + a truncated sample. **Frozen.** |

## Who reads it now

Everything that consumes this directory is Python:

- **`services/api/src/pinakes/parity.py`** loads `openapi.json` as the service's
  route catalog. `/api/_parity/coverage` reports the baseline routes the app has
  registered against the ones it has not, and
  `services/api/tests/test_not_implemented.py` asserts that set is **empty** —
  306/306. That is the guard that replaced `parity.test.ts`'s "the spec matches
  the live routing table", and it is the stronger of the two: it fails if a route
  the baseline promised ever stops being served.
- **`services/api/tests/test_parity_replay.py`** replays every fixture against the
  FastAPI app, matching with `services/api/tests/parity_shape.py` — the port of the
  matcher half of the old `shape.ts`. It also asserts every fixture still binds to
  an operation in the spec, so a fixture cannot go quietly unread.

The TypeScript side — `harness.ts`, `shape.ts`, `parity.test.ts`,
`scripts/gen-parity-spec.ts`, `scripts/record-parity-fixtures.ts` and the
`parity:*` npm scripts — retired with the Express app it replayed against.

## Rules that kept this honest, and still bound how to read it

- **Shapes, not values.** The corpus grows and ids churn, so nothing here asserts a
  value. A serving handler may return *more* than the baseline, never less;
  `parity_shape.py`'s docstring carries the exact asymmetry.
- **`sample` is documentation.** It is truncated and never asserted on.
- **`x-pinakes-parity.unservedClientReferences`** lists `/api/...` literals in
  `web/src` that no Express route served — dead client calls at the moment of the
  freeze. The port did not reproduce them.
- The recorded contract reflects the environment the recording ran in: with no
  Neo4j/sidecar/API keys, `/api/graph/status` records its **degraded** shape. That
  is the contract the client tolerates, and it is what the Python service
  reproduces under the same conditions.

## Changing the API after the freeze

Do not edit these files to describe a new route. They describe what Express
served; that is the whole of their value. A route added to the Python service
today is specified by `GET /api/openapi.json`
(`services/api/src/pinakes/openapi_spec.py`, snapshotted at `docs/openapi.json`)
and covered by its own tests under `services/api/tests/`. The only legitimate
edit here is a deletion — retiring a route the baseline promised, which is a
decision to break a client, not a bookkeeping change.
