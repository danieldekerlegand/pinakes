# neo4j/ — canonical TSV ⇄ Neo4j converter

The **only** part of culture-scrape that talks to a graph DB. The `neo4j` driver is
an optional extra, imported lazily in `__init__.connect`; nothing here needs a live
server to *generate* scripts. The converter is **dataset-agnostic** — it operates on
canonical `nodes/*.tsv` + `edges/*.tsv` (headers per `docs/data-model.md`), so a
merged corpus mixing sources (native Wikidata + `source='linguascrape'`) flows through
one path with no source special-casing. Convergence = both sources' rows share a
per-label node file / per-`:TYPE` edge file; the loader neither knows nor cares.

## Turnkey load + smoke (US-002)

- `load_csv.load_corpus(dir, driver=…, constraints=True)` is the one call `to-neo4j
  --mode loadcsv` uses: it opens **one** driver, applies constraints (global +
  per-label) then runs `apply_load_csv` on it, and returns a `LoadReport`. Pass a
  driver to reuse it; the constraint + load helpers never close a driver they were
  handed (`owned` guard), so `load_corpus` owns the lifecycle.
- **Per-label constraints are additive, not a replacement.** The global `Entity`
  `csid` uniqueness constraint stays the primary guarantee;
  `constraints.all_constraint_statements(dir)` = the 3 global statements +
  `label_constraint_statements(dataset_node_labels(dir))` (a per-label `csid`
  constraint + `name` index for each label). `dataset_node_labels` reads the real
  labels from the `:LABEL` **cells** — node **filenames are lowercased** in the
  live corpus (`language.tsv` → label `Language`), so never derive a label from a
  file stem.
- `counts.count_summary(driver=…)` runs the two smoke queries (`NODE_COUNT_QUERY`
  `UNWIND labels(n)`, `EDGE_COUNT_QUERY` `type(r)`) in one session → `CountSummary`.
  `node_total` reads the `Entity` tally (labels overlap — never sum
  `nodes_by_label`); `edge_total` sums (`:TYPE`s don't overlap). CLI: `neo4j-counts`.
- **Adding a `cypher/*.cypher` file touches two doctests:** `docs/neo4j.md` lists
  every shipped query by name (`iter_queries()`), and `test_neo4j_queries.py` lints
  them all — a new file must reference only `DEFINED_LABELS`/`DEFINED_TYPES` (the
  count queries use none), carry a `//` comment, and balance brackets.

## The four legs

- `constraints.py` — one `csid` uniqueness constraint anchored on the shared
  `ENTITY_LABEL` ("Entity") every node also carries, so a single constraint enforces
  **global** `csid` uniqueness and backs the incremental `MERGE (n:Entity {csid})`.
  Emits idempotent `IF NOT EXISTS` Cypher; no live DB to generate.
- `admin_import.py` — bulk-seed a *fresh* DB (`neo4j-admin database import full`).
- `load_csv.py` — keep an *existing* DB current (incremental `LOAD CSV`, `MERGE` never
  `CREATE`; edges via `apoc.merge.relationship` since `:TYPE` is data-driven).
- `export.py` — pull a live graph back to byte-stable canonical TSV (driver-side cursor,
  no server-side APOC export).

Node labels come from the row's `:LABEL` cell (`apoc.create.addLabels(... split(...))`),
edge types from the row's `:TYPE` — so "loaded under the same labels/edge types as
native nodes" is a property of the *data*, verified by loading, not of loader branching.

## Testing conventions (no live server in CI)

- **Fake drivers everywhere.** Tests pass a fake `driver=` into `apply_*`/`export_*`.
  mypy flags these as `arg-type` (fake ≠ `neo4j.Driver`) — this is the accepted
  **baseline** (~14 errors across `test_neo4j*`/`test_explorer_neo4j`). Confirm your
  change adds none: `uv run mypy` and check every error is in a `test_neo4j*` file.
  In a *new* test, type the fake as `driver: Any = fake` at the call site so you don't
  grow the baseline.
- **Two fake shapes:** a *recording* session (captures `(cypher, params)` to assert the
  generated statements) and an *embedded graph* (applies MERGE-on-`csid` /
  `(start,end,type)` semantics so labels/edge types can be queried back — see
  `test_neo4j_roundtrip.py::_FakeGraph` and `test_neo4j_linguascrape.py::_EmbeddedGraph`).
  The embedded stand-in can be driven by the **real** `apply_load_csv`: its session reads
  the file bound to `$file` (`FILE_PARAM`) and applies the statement's intent, so the
  production loader runs unmodified against an in-process "database".
- **GOTCHA — keep the loader's `session.run(cypher, **params)` splat form.** The real
  Bolt `Session.run(query, parameters=None, **kwparameters)` accepts a positional
  `parameters` dict, but the recording fakes are declared `run(self, cypher, **params)`
  and only accept kwargs. Passing the params dict *positionally* (`run(cypher, params)`)
  breaks `test_cli_neo4j.py`. To satisfy mypy's dict-invariance complaint, type the local
  as `dict[str, Any]` and still splat it (`**params`) — value type `Any`, not a signature
  change. A fake session `run` should mirror the real signature
  (`run(self, cypher, parameters=None, **kw)`) and merge both.

## URL round-trip

`load_csv` binds each file as `path.resolve().as_uri()` (`file://…`). To recover the
path in a fake, `Path(url2pathname(urlparse(url).path))` — not `url[7:]` slicing.
