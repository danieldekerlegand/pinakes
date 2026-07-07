# explorer/ — the read-only FastAPI corpus explorer

`create_app(source, *, live=None, datalog=None)` (in `app.py`) builds one read-only
app bound to a corpus loaded by `data.load_corpus` (a job root `out/<job>/` or a bare
`corpus/`-less dataset dir with `nodes/`+`edges/`). Views read one `Corpus`; nothing writes.

## JSON content negotiation (the TS sidecar client)

`/search`, `/metrics`, `/completeness` serve **both** the HTML explorer and the first-party
TS client (`server/services/culturescrape-client.ts`) from the **same URL**. The helper
`_wants_json(request)` (`"application/json" in Accept`) branches to a `JSONResponse`; a
browser's `text/html` still gets the template. The two representations are built from the
same corpus data — **keep them at parity**. Payload shapes are frozen by the zod schemas in
`culturescrape-client.ts`; a change to a JSON body must update that schema and its vitest.

- **`/metrics` reuses `ontology.metrics.to_json`** via `_metrics_json` so the JSON never
  drifts from the canonical metrics shape. A corpus with no readable metrics answers a
  zeroed document (`_EMPTY_METRICS`), never a 5xx — the shape stays valid for the client.
- **Tuples → lists.** `QaSummary`/`CategoryStatus` hold tuples (`violations`, `reasons`,
  `failed_keys`); `_qa_json`/`_category_json` flatten them to lists for the JSON body.
- **`/api/graph/{csid}`** is the other JSON route — a dedicated path (not negotiated),
  Cytoscape `elements`, live-Neo4j-first with a TSV fallback (`_graph_payload`).

## Tests

`tests/test_explorer_app.py` drives the app with FastAPI's `TestClient` (no live server);
the whole file `pytest.importorskip("fastapi")`s so it skips when the `gui` extra is absent.
Fixtures: `FIXTURE_ROOT` (a full job root with catalog/metrics/qa) and `SAMPLE` (a bare
dataset). Assert JSON parity by requesting the same query with and without `Accept:
application/json` and checking the HTML links the same csids.
