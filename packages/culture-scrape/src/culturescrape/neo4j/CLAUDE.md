# neo4j/ — canonical TSV ⇄ Neo4j converter

The **only** part of culture-scrape that talks to a graph DB. The `neo4j` driver is
an optional extra, imported lazily in `__init__.connect`; nothing here needs a live
server to *generate* scripts. The converter is **dataset-agnostic** — it operates on
canonical `nodes/*.tsv` + `edges/*.tsv` (headers per `docs/data-model.md`), so a
merged corpus mixing sources (native Wikidata + `source='pinakes'`) flows through
one path with no source special-casing. Convergence = both sources' rows share a
per-label node file / per-`:TYPE` edge file; the loader neither knows nor cares.

## Offline idempotency proof — `merge_load.verify_idempotent_load` (US-004)

`neo4j-counts --dataset <corpus>` (and `merge_load.verify_idempotent_load`) prove a
corpus loads into Neo4j **idempotently without a live server**: an in-memory
`_MergeGraph` replays the real load's MERGE keys (nodes on `csid`, edges on
`(:START_ID,:END_ID,:TYPE)`), loads the dataset **twice**, and asserts the grouped
counts don't move on the second load. The counts it returns match the live
`counts.count_summary` shape — a node is tallied under **every** label it carries
(its type `:LABEL` + the shared `Entity` anchor), so the `Entity` tally is the true
node total (labels overlap, so summing `nodes_by_label` double-counts). Use it to
record a merged corpus's node/edge counts by label/`:TYPE` when no server is up; a
non-idempotent result (exit 1) means duplicate csids or duplicate edge keys the
stitch failed to collapse.

## Running `loadcsv` against the dockerized Neo4j (repo `docker-compose.yml`)

The stock `neo4j:5` service in the repo's `docker-compose.yml` cannot run
`--mode loadcsv` out of the box — the `neo4j` service now sets four things that the
loader needs (all committed there, so `docker compose up -d neo4j` is enough):

- **APOC** (`NEO4J_PLUGINS: '["apoc"]'` + `procedures_unrestricted/_allowlist: "apoc.*"`)
  — nodes use `apoc.create.addLabels`, edges use `apoc.merge.relationship`. Verify with
  `docker exec … cypher-shell -u neo4j -p … "RETURN apoc.version()"`.
- **Absolute `file://` CSV import.** The loader binds each file as
  `Path.resolve().as_uri()` → `file://<host-abs-path>`, so the DB must read that exact
  path. Three settings together: `allow__csv__import__from__file__urls: "true"`, a
  read-only `${PWD}:${PWD}:ro` bind mount (container path == host path), **and**
  `NEO4J_server_directories_import: "/"`. That last one is the gotcha — the default
  `import`-dir jail makes Neo4j resolve `file:///abs` *under* `<neo4j>/import`; setting
  the root to `/` lifts the jail while keeping the file-URL guard. (Setting the env var
  to `""` does **not** work — the neo4j docker entrypoint skips empty values.)

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
  no server-side APOC export). **Rendering is delegated** (pinakes:50 US-1): the cursor
  rows go to the embedded agora translation engine's `to_neo4j_export`, which shards and
  writes the documents; reading the graph is ours, formatting is the engine's. Two
  single-family calls, not one whole-graph call, so node rows are released before edge
  rows are read. Byte-parity against the TSV writers is pinned in
  `tests/test_translation_lib.py`. Two canonicalisations the engine applies that the
  writers do not — row order and the `:LABEL` cell order — are harmless here because
  `_node_row` already sorts labels and the writers already sort rows; both are pinned as
  recorded properties, not assumed.
  `admin_import.py` / `load_csv.py` **cannot** delegate: the engine's `to_csv` emits
  comma-CSV and its `to_cypher` a self-contained `:param file =>` script, whereas those
  two emit a `neo4j-admin` command over the *original* TSV and driver-bound statements
  parsed from each file's real header (so a corpus file carrying `parent_code`/`extra`
  still loads). Different artifacts, not the same one rendered twice.

Node labels come from the row's `:LABEL` cell (`apoc.create.addLabels(... split(...))`),
edge types from the row's `:TYPE` — so "loaded under the same labels/edge types as
native nodes" is a property of the *data*, verified by loading, not of loader branching.

## Personal tier + GraphRAG asset coverage (analyzer-bridge US-004)

- **The personal (Analyzer) tier loads with ZERO loader change.** Because labels/edge types
  are data-driven, an `:Asset` node file + `DEPICTS`/`MENTIONS`/`DERIVED_FROM` edges flow
  through `load_corpus`/`apply_load_csv` unmodified: assets land under `:Asset` (+ the
  `Entity` anchor), get an automatic per-label `csid_unique_Asset` constraint
  (`dataset_node_labels` reads the `:LABEL` cells), and re-ingest is idempotent
  (`verify_idempotent_load`). Proof: `tests/test_neo4j_personal_tier.py` (mirrors the
  `test_neo4j_pinakes.py` `_EmbeddedGraph` pattern). No source/tier gate exists at load
  time — containment is the *app proxy's* job (`server/services/personal-tier.ts`,
  `PERSONAL_TIER_ENABLED`), not the loader's.
- **`vector_index.node_embedding_text` gained a `transcript` param** so `asset` nodes embed
  their ASR/OCR snippet alongside name + caption(`description`); `read_node_texts` now
  `RETURN`s `n.transcript`. Entity nodes carry none ⇒ their embedding text is byte-identical
  (existing `test_vector_index.py` unchanged). A missing key is read via `_optional(record,
  key)` (`.get`) so a recording fake needn't carry the new column. Assets are already
  `:Entity`, so retrieval returns them with no other change. Docs +
  spot-checks: `docs/personal-tier-file-web.md`.

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
  `test_neo4j_roundtrip.py::_FakeGraph` and `test_neo4j_pinakes.py::_EmbeddedGraph`).
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
