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
- **`/api/retrieve?q=&k=&depth=`** (GraphRAG, Phase 5.1) — hybrid retrieval: embed the
  query, pull top-`k` from the Neo4j native vector index, expand each seed to `depth`
  hops. `create_app` builds a default `HybridRetriever(live, SentenceTransformerEmbedder())`
  (lazy — nothing loads until a query runs) but takes an injectable `retriever=` so tests
  drive a fake. **Degradation is by status code, not a swallowed body:** an empty query →
  200 empty; retriever **unavailable** (embedding extra absent OR Neo4j not configured,
  gated by `HybridRetriever.available()`) → **503** `{available:false}`; a driver failure
  mid-retrieve → 503. The TS proxy relies on this: `culturescrape-client.requestJson` maps
  any `>=500` (so the 503) to `CultureScrapeUnavailableError`, which `graph.ts handleError`
  turns back into 503 `{available:false}` — the body is intentionally not forwarded.
  Index build lives in `neo4j/vector_index.py` (CLI `graphrag-index`); full runbook at
  repo `docs/graphrag-runbook.md`.

## The Datalog console's facts are the agora engine's (pinakes:50 US-4)

`datalog.Datalog._program_path` projects the corpus with `export_dataset(...,
include_rules=True)`. That is a **rule-bearing** export, and for five iterations of
pinakes:50 it was recorded as the reason the console could not delegate — the exporter
gated delegation on `not attach_rules`, because agora:60 ships only whole-graph document
renderers and knows nothing about rules. That inference was wrong: `datalog/export.py`
`_export_rule_bearing` now splits the engine's rendered document back into fact clauses
(`translation.program_fact_clauses`) and composes the program around them, so **every
fact clause in the console's `graph.pl` is the engine's** and only the structure — the
`:- table`/`:- discontiguous`/`:- dynamic` preamble, the rule section, the P279 taxonomy
overlay — is culture-scrape's.

Don't re-derive this from `export.py`: `test_datalog_console_projects_its_facts_through_
the_agora_engine` pins it with a spy on `translation.dataset_datalog` **and** a verbatim
block match of the engine's clauses in the emitted file. The spy alone would pass if the
result were discarded; the byte check alone would pass if a hand-written emitter were
re-instated. Both, or neither is worth much.

## Tests

`tests/test_explorer_app.py` drives the app with FastAPI's `TestClient` (no live server);
the whole file `pytest.importorskip("fastapi")`s so it skips when the `gui` extra is absent.
Fixtures: `FIXTURE_ROOT` (a full job root with catalog/metrics/qa) and `SAMPLE` (a bare
dataset). Assert JSON parity by requesting the same query with and without `Accept:
application/json` and checking the HTML links the same csids.
