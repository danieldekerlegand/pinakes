# Translation seam — canonical-graph ↔ format translators in `culture-scrape`

**Status: READ-ONLY discovery artifact.** This document maps every
canonical-graph↔format translator in `core` (and its `ml/`
sidecar workspace) into three buckets *before* any code moves, so the downstream
engine-extraction work has a precise, agreed seam. **No source is moved or edited
by this task** — the only file added is this doc. It builds on `10-pinakes-koine-align`
(ADR-0002 FOLD: `csid`↔`KINP`, pinakes as the canonical producer/resolver authority)
and the ecosystem ADR-0001 decision that `agora` is the runtime commons. Its output is
consumed verbatim by **agora:60** (the Rust engine that receives Bucket 1) and
**pinakes:50** (which reclaims Bucket 2).

## The three buckets

| Bucket | Name | Destination | What it is |
| --- | --- | --- | --- |
| **1** | **GENERIC** | → `agora` Rust engine | Translation over the *shared vocab*: lossless row IO, the Neo4j canonical-TSV⇄Bolt converter, and the Datalog (Prolog + Soufflé + ProbLog) projection/emitters. Domain-agnostic given the schema as config. |
| **2** | **PINAKES-SPECIFIC** | → back into `pinakes` proper | Wikidata acquisition, the reconciliation/correspondence layer, the explorer viz, the canonical schema itself, and the Datalog *inference content* (rules, P2302 constraints, taxonomy). |
| **3** | **ML-DERIVATION** | stays in the `ml/` uv workspace | The PyKEEN-triples export, the Scallop `.scl` re-translation, and the DeepProbLog feasibility pilot. Consume the corpus as files; never import `culturescrape`. |

The **six target formats** (plus the ML Scallop re-translation) and their single bucket:

| # | Format | Producer (file) | Bucket |
| --- | --- | --- | --- |
| 1 | **TSV** (canonical node/edge rows) | `schema/tsvio.py` | GENERIC |
| 2 | **Neo4j import CSV** (`nodes/*.tsv` + `edges/*.tsv`, `\t`-delimited, `;`-arrays) | `neo4j/*` | GENERIC |
| 3 | **SWI-Prolog** `graph.pl` (`PROLOG_PROGRAM_NAME`) | `datalog/prolog.py` | GENERIC |
| 4 | **Soufflé** `graph.dl` + `<predicate>.facts` (`SOUFFLE_PROGRAM_NAME`) | `datalog/souffle.py` | GENERIC |
| 5 | **ProbLog** `graph.problog.pl` (`PROBLOG_PROGRAM_NAME`) | `datalog/problog.py` | GENERIC |
| 6 | **PyKEEN triples** (`train/valid/test` triple files) | `ml/src/pinakes_ml/export_triples.py` | ML-DERIVATION |
| + | **Scallop** `.scl` program (re-translation of the committed registry) | `ml/src/pinakes_ml/export_scallop.py` | ML-DERIVATION |

Every format above is assigned to exactly one bucket; none is left unclassified.

## Emitter inventory

Each row names the translator by `file:function` (all symbols resolve in the current
tree — spot-checkable with `grep`), its bucket, and a one-line code-grounded rationale.
Paths are relative to `core/src/culturescrape/` unless prefixed with
`ml/` (repo-root `ml/src/pinakes_ml/`).

### TSV — lossless row IO (`schema/tsvio.py`)

| `file:function` | Bucket | Rationale (code-grounded) |
| --- | --- | --- |
| `schema/tsvio.py:encode_value` / `encode_values` | GENERIC | Apply the lossless escape (`\`→`\\`, TAB→`\t`, CR→`\r`, LF→`\n`; multi-value join on `;` with `\;`) — pure string transform, no domain vocab. |
| `schema/tsvio.py:decode_value` / `decode_values` | GENERIC | Exact inverse of the encoders via a single left-to-right scan (`_DECODE`); reader/writer round-trip is the invariant. |
| `schema/tsvio.py:write_rows` / `read_rows` / `open_rows` | GENERIC | Header-driven row IO over `Row = dict[str, str \| list[str]]` (`tsvio.py:68`) — schema-*shaped* but domain-agnostic; `open_rows` is the streaming reader the Datalog projection uses. |
| `schema/tsvio.py:write_node_rows` | GENERIC | Writes canonical node rows sorted by `csid` — a deterministic sort key, not a domain rule. |
| `schema/tsvio.py:write_edge_rows` | GENERIC | Writes canonical edge rows sorted by `(:START_ID, :END_ID, :TYPE)` — deterministic sort, domain-neutral. |

`MULTI_VALUE_KEYS = frozenset({":LABEL", "aliases"})` (`tsvio.py:45`) names the two
list-valued columns; it is a *shape* fact about the canonical schema, not domain content —
it rides across the seam as config (see Bucket 2, canonical-schema ownership).

### Neo4j — canonical TSV ⇄ Neo4j (`neo4j/*`)

| `file:function` | Bucket | Rationale (code-grounded) |
| --- | --- | --- |
| `neo4j/export.py:export_to_tsv` + `NODE_QUERY` / `EDGE_QUERY` | GENERIC | Streams a Bolt graph (`MATCH (n) …`, `MATCH ()-[r]->() …`) into canonical `nodes/*.tsv` + `edges/*.tsv`. Binds `NodeSchema.canonical()`/`EdgeSchema.canonical()` — an *entanglement* (schema injected as config; see register). |
| `neo4j/admin_import.py:discover_dataset` / `_transformed_header` | GENERIC | Discovers the node/edge TSV family and rewrites headers for `neo4j-admin import`; operates on schema-typed columns, no domain vocab. |
| `neo4j/load_csv.py:node_cypher` / `edge_cypher` | GENERIC | Emits `LOAD CSV` Cypher from a `NodeSchema`/`EdgeSchema` — a schema-parameterised code generator. |
| `neo4j/constraints.py:constraint_statements` / `label_constraint_statements` / `dataset_node_labels` | GENERIC | Emits `csid_unique` + per-label constraint/index Cypher; labels are read *from the dataset* (`dataset_node_labels`), not hard-coded. |
| `neo4j/merge_load.py:verify_idempotent_load` | GENERIC | Asserts a re-run of the merge-load leaves node/edge counts unchanged — an idempotency check over the generic load, no domain content. |

### Datalog — Prolog + Soufflé + ProbLog projection/emitters (`datalog/*`)

| `file:function` | Bucket | Rationale (code-grounded) |
| --- | --- | --- |
| `datalog/export.py:collect_facts` | GENERIC | Returns a re-iterable lazy fact stream (`_DatasetFacts`) that re-reads `nodes/*.tsv` then `edges/*.tsv`; pure projection driver (streaming, O(1) memory — `datalog/CLAUDE.md`). |
| `datalog/export.py:export_dataset` | GENERIC (emitter) | Orchestrates the per-engine write (`graph.pl`/`graph.dl`/`graph.problog.pl`). Mixes in pinakes rule content via `include_rules`/`include_constraints`/`include_schema_constraints` and the `tier` filter — the emitter core is generic; those toggles are *entanglements* (see register). |
| `datalog/nodes.py:node_facts` / `node_file_facts` | GENERIC | Projects a canonical node `Row` to binary `Fact`s (`node/3` companions, `instance_of`, `source/2`); reads column *types*, not domain semantics. |
| `datalog/edges.py:edge_facts` / `edge_file_facts` / `predicate_for_type` | GENERIC | Projects a canonical edge `Row` to `rel/3` + typed `t/2` + `rel_conf/4`/`rel_source/4`; `predicate_for_type` maps a `:TYPE` token to a predicate atom mechanically. |
| `datalog/prolog.py:write_program` (== `render_program`) | GENERIC | Emits SWI-Prolog `graph.pl` (`PROLOG_PROGRAM_NAME = "graph.pl"`); `write_ == render_` byte-identity is a porting obligation. |
| `datalog/souffle.py:write_souffle_program` / `write_souffle_facts` | GENERIC | Emits Soufflé `graph.dl` (`SOUFFLE_PROGRAM_NAME = "graph.dl"`) + one `<predicate>.facts` per relation, rows in fact order. |
| `datalog/problog.py:write_problog_program` / `collect_problog_facts` + `PROBLOG_PROGRAM_NAME` | GENERIC | Emits ProbLog `graph.problog.pl`; lifts `rel_conf/4` confidence onto `rel/3` as a `W::` prefix. Imports *nothing* from `problog` — it only writes text. |
| `datalog/rules.py:RULES` | **PINAKES-SPECIFIC** | `RULES: tuple[Rule, ...]` (`rules.py:346`) is curated *inference content* (`ancestor`, `same_region`, temporal closures …), **not a translator** — it rides across the seam as data (the committed `rules_registry.tsv`), not as ported Rust logic. |
| `datalog/constraints.py`, `datalog/schema_constraints.py`, `datalog/registry.py` (`active_curated_rules`), `datalog/taxonomy.py` | **PINAKES-SPECIFIC** | P2302 property constraints, canonical-schema violation rules, the provenanced rules registry, and the P279 `subclass_of` taxonomy — pinakes rule/vocab content the generic emitter *consumes*, not translation logic (detailed in Bucket 2). |

### ML derivations (`ml/src/pinakes_ml/*`)

| `file:function` | Bucket | Rationale (code-grounded) |
| --- | --- | --- |
| `ml/src/pinakes_ml/export_triples.py` + `triples.py` | ML-DERIVATION | Reads `export/culturescrape/edges/*.tsv` header-driven into PyKEEN triples; excludes derived temporals (`EXCLUDED_RELATIONS = {CONTEMPORARY_WITH, PRECEDES, FOLLOWS}`, `triples.py:46`) and does leakage-safe unordered-pair splits. Consumes files, never `culturescrape`. |
| `ml/src/pinakes_ml/export_scallop.py` + `scallop.py` | ML-DERIVATION | Re-translates the committed `datalog/rules_registry.tsv` (only `status=="active"`) into a Scallop `.scl` program; `csid_uniqueness_violation` (arity-3 `node/3`) is skipped + reported. An ML-side re-translation of the *same* registry the generic Datalog emitter uses. |
| `ml/src/pinakes_ml/deepproblog_pilot.py` | ML-DERIVATION | Renders a ProbLog/DeepProbLog feasibility program (`render_problog_program`/`render_deepproblog_program`) to measure the per-query knowledge-compilation ceiling. Lives in the torch/pykeen/problog workspace. |

**Why the ML bucket is not a translator seam:** the `ml/` workspace is a separate uv
workspace (Python 3.11) whose whole point is to keep `torch`/`pykeen`/`problog` *out*
of the culture-scrape sidecar, and it **cannot import `culturescrape`** (`ml/CLAUDE.md`).
So these three consume the corpus as on-disk files (`export/culturescrape/{nodes,edges}/*.tsv`)
and the committed `rules_registry.tsv` — they never call the engine API and are not
consumers of the future `agora` Rust lib. Detailed in the ML-derivations section.

---

## Bucket 1 (GENERIC) — the `agora` Rust engine API the shared translators must expose

This is the surface `agora:60` receives. The generic translators are pure functions
of a *canonical graph* plus the *schema/vocab as config* — nothing here is
Pinakes-specific once the schema is injected rather than hard-coded (the hard-coding
that remains is catalogued as an entanglement in US-5). This section records (a) the
data contract the translators operate over, (b) the Rust API surface that must
re-expose them, (c) the dependencies that cross the seam and their Rust equivalents,
and (d) the byte-identity / determinism invariants the port must preserve verbatim.

### 1a. The pure data contract

**The lossless escape table** (`schema/tsvio.py:48-65`, `_ENCODE` / `_ENCODE_MULTI` /
`_DECODE`). Every canonical cell is escaped so a value carrying a delimiter never
corrupts the file; decoding is a single left-to-right scan (`_unescape`, `tsvio.py:87`)
so `\\t` decodes to a literal `\t`, never a tab:

| Literal | Encoded | Notes |
| --- | --- | --- |
| `\` (backslash) | `\\` | the single escape char (`ESCAPE`, `tsvio.py:42`) |
| TAB | `\t` | the column delimiter (`DELIMITER` from `headers.py`) |
| CR | `\r` | files read in universal-newline mode |
| LF | `\n` | a physical `\n` is only ever a row terminator |
| `;` (inside a multi-value part) | `\;` | `MULTI_DELIMITER = ";"` (`tsvio.py:39`); joins parts of a list cell |

Multi-value columns join their parts with `;`; a literal `;` inside a part is escaped
as `\;` (`encode_values`, `tsvio.py:80`). An empty cell decodes to the empty list
(`decode_values`, `tsvio.py:114`) — an empty list and `[""]` both serialize to `""`.

**The row shape.** `Row = dict[str, str | list[str]]` (`tsvio.py:68`): scalar columns
map to `str`, the two multi-value columns to `list[str]`. Which columns are
multi-valued is a *shape* fact about the schema, not domain content:
`MULTI_VALUE_KEYS = frozenset({":LABEL", "aliases"})` (`tsvio.py:45`) — it rides across
the seam as config (US-3, canonical-schema ownership).

**The deterministic sort keys** the writers impose (so writing the same logical row
set in any input order yields byte-identical output):

- `write_node_rows` (`tsvio.py:213`) sorts by **`csid`** (the schema's single
  `IdColumn`) in canonical column order.
- `write_edge_rows` (`tsvio.py:231`) sorts by the tuple **`(:START_ID, :END_ID,
  :TYPE)`** (`tsvio.py:241`).

Sort columns are always structural scalars; a list value there signals a caller error
(`_sort_key`, `tsvio.py:196`).

### 1b. The `agora` Rust lib API surface (canonical-graph ↔ format)

The Rust lib must model a **domain-neutral in-memory canonical graph** and expose
per-format `encode`/`decode` entrypoints. Because every format is a projection of the
same graph over the same schema, the schema is a *parameter*, never baked into Rust:

- **Canonical graph model.** A `Node` carries `csid` (the id), a `:LABEL` set
  (multi-value), and typed scalar properties keyed by column name. An `Edge` carries
  `:START_ID` / `:END_ID` / `:TYPE` and typed scalar properties. Property *types*
  (`:int`, `:float`, `:LABEL`/`aliases` as lists) come from the injected schema, not
  hard-coded columns.
- **Schema/vocab as config.** The node `:LABEL` set, edge `:TYPE` set, and the typed
  property columns (with their `MULTI_VALUE_KEYS`) are passed in as a config object.
  The Python side reads them from `NodeSchema.canonical()` / `EdgeSchema.canonical()`
  and `shared/canonical-schema.json`; those stay Pinakes-authored (US-3).
- **TSV codec.** `encode`/`decode` mirroring `write_rows` / `read_rows` /
  `open_rows` (`tsvio.py`), preserving the escape table and the two sort orders
  above exactly. `open_rows` is the *streaming* reader (header eager, rows lazy) the
  Datalog projection depends on — the Rust decode path must be a streaming iterator,
  not a slurp (US determinism invariant below).
- **Neo4j codec.** An encode entrypoint mirroring
  `export_to_tsv(out_dir, *, config, env, driver)` (`neo4j/export.py:152`): stream a
  Bolt graph (`NODE_QUERY` = `MATCH (n) RETURN labels(n), properties(n)`; `EDGE_QUERY`
  = `MATCH (a)-[r]->(b) RETURN a.csid, b.csid, type(r), properties(r)`,
  `neo4j/export.py:48-55`) into sharded `nodes/<label>.tsv` + `edges/<type>.tsv`.
  Nodes are keyed on their primary (alphabetically-first) type label with the
  `ENTITY_LABEL` anchor dropped; both node and edge shards written in canonical sort
  order. The reverse (`admin_import.py` / `load_csv.py`) generates loader
  scripts/Cypher from the same schema.
- **Datalog codec.** An encode entrypoint mirroring
  `export_dataset(directory, out, engines, *, include_rules, include_constraints,
  include_schema_constraints, tier)` (`datalog/export.py:266`). It projects each
  canonical `Row` to **binary** facts (`node/3` companions, `instance_of`, `rel/3` +
  typed `t/2` + `rel_conf/4` + `rel_source/4`) via `collect_facts` (`export.py:220`)
  and writes one or more engine programs: SWI-Prolog `graph.pl`, Soufflé `graph.dl` +
  `<predicate>.facts`, ProbLog `graph.problog.pl`. Two hard constraints the emitters
  assume and the port must keep:
  - **`ARITY == 2`.** Every *predicate* literal is binary (`datalog/CLAUDE.md`,
    "Materializing rules"); the lone arity-3 reader is `node/3` (csid, type, name).
    The materializer and every emitter reject a non-binary predicate literal.
  - **ProbLog confidence → `W::` annotation.** `annotate_edge_group`
    (`datalog/problog.py:150`) lifts the `rel_conf/4` confidence onto `rel/3` and the
    typed `t/2` as a `W::` probability prefix; companions
    (`rel_conf/4`, `rel_source/4`) and all node/dimension facts stay certain
    (unannotated). A confidence of `1.0` or absent is written unannotated; an
    out-of-`[0,1]` value raises rather than emit invalid syntax.
  - The **rules/constraints/schema-constraints/tier** toggles pass Pinakes *content*
    into the generic emitter — they are entanglements the port must externalize
    (rules as data, tier as a caller predicate); catalogued in US-5.

### 1c. Dependencies that cross the seam, and their Rust equivalents

| Python dependency | Where | Rust equivalent |
| --- | --- | --- |
| `neo4j` driver (optional `neo4j` extra) | **lazy-imported** in `neo4j/__init__.connect` (`from neo4j import GraphDatabase`, `__init__.py:121`); nothing needs it to *generate* scripts | a Bolt client (e.g. `neo4rs`), likewise optional/feature-gated — the codec that only writes TSV/Cypher needs no live server |
| `problog` | a **TEST-only** dep (`dev` extra + a mypy ignore-missing-imports override, `datalog/CLAUDE.md`) | **none** — the emitter imports *nothing* from `problog`; it only writes ProbLog text. Tests `pytest.importorskip("problog")` to compute a marginal, but the encoder is pure text |
| `torch` / `pykeen` | — | **explicitly none on this side.** Those live only in the `ml/` workspace (Bucket 3, US-4); no generic translator imports them |

The `neo4j` driver is the *only* runtime dependency that crosses the generic seam,
and it is already isolated behind one lazy import (`connect`) that raises
`Neo4jDriverNotInstalled` with install instructions when absent — so the Rust port
inherits a clean, single, optional Bolt boundary.

### 1d. Byte-identity / determinism invariants (porting obligations)

These are not optional optimizations — downstream corpus digests, git-diffability, and
the idempotent Neo4j round-trip all depend on them. The Rust port must preserve each
verbatim:

- **`write_program == render_program`** (`datalog/prolog.py:199` vs `:170`): the
  streaming line-by-line writer must be byte-for-byte equal to the whole-string
  renderer — both build the same line sequence, and `write(line+"\n")` per line equals
  `"\n".join(lines)+"\n"`. Tests enforce `write_* == render_*`; the same holds for the
  ProbLog emitter (single-pass, shared line list). (`datalog/CLAUDE.md`, "The export is
  streaming, not slurping".)
- **`write_souffle_facts` row order** (`datalog/souffle.py:233`): rows are written to
  per-relation handles in **fact order**, which equals the old grouped order (rows
  within a file keep source order).
- **Deterministic `collect_facts` file order** (`datalog/export.py:254`): `nodes/*.tsv`
  then `edges/*.tsv`, each **sorted by filename**, node files first so entity-defining
  facts precede the edges that reference them. The stream is re-iterable and streamed
  (peak memory ≈ one row + the per-predicate signature table, never the corpus) — the
  emitters pass over it more than once, so the Rust source must be re-iterable, not a
  one-shot generator.
- **Canonical TSV sort** (`schema/tsvio.py` `write_node_rows` / `write_edge_rows`):
  the `csid` and `(:START_ID, :END_ID, :TYPE)` orders from §1a make each file a
  byte-stable function of its logical row set, which is what makes the Neo4j
  round-trip stable and TSV diffs meaningful.

---

## Bucket 2 (PINAKES-SPECIFIC) — what moves back into `pinakes` proper

This is the surface `pinakes:50` reclaims. Everything here is *domain content* about
the cultural corpus: how the graph is acquired from Wikidata, how source rows are
reconciled to a single `csid`, how the corpus is browsed, the canonical schema/vocab
itself, and the Datalog *inference* library. None of it is a canonical-graph↔format
translator; it is the Pinakes side of the seam that authors the graph and the schema
the generic (Bucket 1) translators then project. **The `culture-scrape` package stays
vendored inside `pinakes`** — the engine-generic emitters (Bucket 1) *leave* for
`agora`, the domain modules below *do not move at all*; they simply revert to being
plain Pinakes code once the emitters are gone.

### 2a. The PINAKES-SPECIFIC modules

Paths relative to `core/src/culturescrape/` unless noted. Every
`file:function` resolves in the current tree.

**Wikidata acquisition (`acquire/*`).** The whole acquisition surface is
Pinakes-specific — it knows Wikidata QIDs, properties, and the cultural blueprint:

| `file:function` | Rationale (code-grounded) | Pinakes home |
| --- | --- | --- |
| `acquire/wikidata_slice.py:blueprint_classes` / `SliceManifest` / `ClassMembership` | Dump-slice: reads the blueprint classes and slices the WD dump to corpus membership. | stays `culturescrape.acquire` (vendored in pinakes) |
| `acquire/taxonomy.py` (P279) | Extracts the Wikidata **P279** `subclass_of` class taxonomy — feeds `datalog/taxonomy.py`'s `subclass_of.tsv` replay artifact. | stays `culturescrape.acquire` |
| `acquire/constraints.py` (P2302) | Extracts Wikidata **P2302** property-constraint statements — feeds `datalog/constraints.py`'s replay artifact. | stays `culturescrape.acquire` |
| `acquire/wikidata_dump*.py`, `wikidata_hydration.py`, `wikidata_enrich.py`, `wikidata.py`, `petscan.py`, `getty.py`, `pleiades.py`, `kaikki.py`, … | Source adapters (WDQS/dump/PetScan/Getty/Pleiades/kaikki) — QID- and source-schema-aware acquisition, not translation. | stays `culturescrape.acquire` |

**Reconciliation / correspondences (`schema/*`).** The layer that resolves many source
rows to one canonical `csid` — the "resolver authority" of ADR-0002. Domain-specific
matching, not row IO:

| `file:function` | Rationale (code-grounded) | Pinakes home |
| --- | --- | --- |
| `schema/reconcile.py:WikidataReconciler` / `reconcile_row` / `reconcile_rows` | Reconciles a row to a Wikidata entity (WDQS candidate scoring) — the `csid`↔`KINP` resolver. | stays `culturescrape.schema` |
| `schema/mapper.py:map_record` / `map_records` / `map_pinakes_record` | Maps a source `RawRecord` + `CategorySpec` to a canonical `Row` — domain field mapping. | stays `culturescrape.schema` |
| `schema/merge.py:merge_rows` / `merged_csid_remap` | Clusters + merges duplicate entities (exact-key + fuzzy-name), remapping `csid`. | stays `culturescrape.schema` |
| `schema/normalize.py:normalize_text` / `normalize_fields` / `TimeSpan` | Text/era/time-span normalization (century parsing, era signs) — corpus semantics. | stays `culturescrape.schema` |
| `schema/pipeline.py:normalize_records` / `read_raw_records` | Drives raw-record → normalized-row for pinakes/bridge exports. | stays `culturescrape.schema` |
| `schema/{lexicon,glottolog,typology,lexibank,kaikki}_reconcile.py` | The per-source `*_reconcile` family — dataset-specific correspondence to the canonical graph (lexicon, Glottolog, typology, Lexibank, kaikki). | stays `culturescrape.schema` |

**Explorer viz (`explorer/*`).** A FastAPI app for browsing the corpus — purely a
Pinakes-facing product surface:

| `file:function` | Rationale (code-grounded) | Pinakes home |
| --- | --- | --- |
| `explorer/app.py:create_app` (`FastAPI(title="culture-scrape explorer")`) | The explorer application factory — corpus browse/retrieval UI. | stays `culturescrape.explorer` |
| `explorer/server.py:run_server`, `explorer/{data,links,retrieval,live,datalog,actions}.py` | The viz server + data/retrieval/datalog-example plumbing behind the UI. | stays `culturescrape.explorer` |

### 2b. Canonical-schema ownership — Pinakes authors it, `agora` receives it as config

**The shared vocab is Pinakes-owned and must be injected INTO the `agora` engine as a
config parameter, never hard-coded in Rust.** The vocab is three things: the node
`:LABEL` set, the edge `:TYPE` set, and the typed property columns (with their
`MULTI_VALUE_KEYS`). Today the generic translators read it from two Pinakes-authored
sources:

- **`schema/headers.py`** — `NodeSchema.canonical()` (`headers.py:191`) and
  `EdgeSchema.canonical()` (`headers.py:251`) are the Python-side canonical vocab.
  `neo4j/export.py` binds them directly (`node_schema = NodeSchema.canonical()`,
  `edge_schema = EdgeSchema.canonical()`, `neo4j/export.py:175-176`) — a Bucket-1
  translator reaching for Pinakes vocab. In the port this becomes the injected schema
  config (Bucket 1 §1b), authored by Pinakes.
- **`shared/canonical-schema.json`** (repo root) — the machine-readable edge-type
  declaration `datalog/schema_constraints.py` reads at
  `Path(__file__).resolve().parents[4] / "shared" / "canonical-schema.json"`
  (`schema_constraints.py:67`). **The schema lives on the TS side**:
  `shared/canonical-schema.ts` (+ `.test.ts`) is the source of truth, the `.json` its
  generated artifact — so the canonical vocab already lives *in the pinakes monorepo*,
  outside `culture-scrape`. `pinakes:50` keeps authoring it; `agora` consumes the
  `.json` as config.

The resolution is symmetric with §1b: **the vocab is a parameter the Pinakes side
supplies to the domain-neutral engine**, so a schema change never means a Rust change.

### 2c. The Datalog *inference* content is PINAKES-SPECIFIC (distinct from the generic emitter)

Bucket 1 keeps the Datalog **projection/emitter** (`export.py`, `nodes.py`, `edges.py`,
`prolog.py`, `souffle.py`, `problog.py`). But the Datalog *inference content* those
emitters optionally splice in is Pinakes rule/vocab data and stays behind:

| `file:function` | What it is | Why PINAKES-SPECIFIC |
| --- | --- | --- |
| `datalog/rules.py:RULES` (`rules.py:346`) | `RULES: tuple[Rule, ...]` — curated inference rules (`ancestor`, `same_region`, temporal closures). | Inference *content*, not a translator. |
| `datalog/constraints.py` (P2302) | Compiles the committed P2302 replay artifact into integrity rules. | Wikidata-derived domain axioms. |
| `datalog/schema_constraints.py` | Compiles `shared/canonical-schema.json` edge-type declarations into violation rules. | Reads the Pinakes-owned schema (§2b). |
| `datalog/registry.py:active_curated_rules` (`registry.py:570`) | Reads the committed `rules_registry.tsv` (`REGISTRY_TSV`, `registry.py:64`) — the provenanced rule library. | The registry is Pinakes-authored rule data. |
| `datalog/taxonomy.py` (P279) | Projects the `subclass_of.tsv` replay artifact into `subclass_of/2` facts. | Wikidata P279 taxonomy content. |

**The rule library rides across the seam as DATA, not ported Rust logic.** The generic
Datalog emitter (Bucket 1) *consumes* the committed `rules_registry.tsv` (and the P2302 /
P279 / schema-constraint artifacts) as input text it appends to the program; it does not
need to understand or re-derive them. So `agora` never ports `RULES` or the constraint
compilers — Pinakes keeps authoring the rules and commits the registry TSV, and both the
generic emitter (Bucket 1) and the ML Scallop re-translation (Bucket 3, US-4) read that
single committed artifact. This is why the `include_rules` / `include_constraints` /
`include_schema_constraints` toggles on `export_dataset` are catalogued as entanglements
(US-5): the emitter core is generic, but those toggles let Pinakes content flow through
it, and the port must accept that content as caller-supplied data rather than importing it.

### 2d. The move list for `pinakes:50`

Nothing in Bucket 2 physically moves — `culture-scrape` **stays vendored in `pinakes`**.
`pinakes:50` reclaims these modules simply by *keeping* them when the Bucket-1 emitters
leave for `agora`: `acquire/*` (Wikidata acquisition, incl. dump-slice + P279 + P2302),
`schema/{reconcile,mapper,merge,normalize,pipeline}.py` + the `*_reconcile` family
(reconciliation/correspondences), `explorer/*` (viz), `schema/headers.py`
(`NodeSchema`/`EdgeSchema` canonical vocab) + `shared/canonical-schema.json` (the
Pinakes-owned schema it keeps authoring), and the Datalog inference content
(`rules.py`, `constraints.py`, `schema_constraints.py`, `registry.py`, `taxonomy.py`).
`pinakes:50` can act on this list without re-reading the source.

---

## Bucket 3 (ML-DERIVATION) — what stays in `ml/`, and its input contracts

The three ML derivations are **not** part of the seam: they are *consumers* of the
canonical corpus, one layer downstream of every translator. They stay in the `ml/`
workspace regardless of where the generic emitters move, so `agora:60` and `pinakes:50`
inherit nothing from them. This section records (a) why they stay, (b) each derivation's
input contract, (c) the one ML↔generic coupling and how the seam handles it, and (d) the
boundary invariant that must survive the split.

### 3a. Why the ML derivations STAY in `ml/`

The `ml/` workspace is a **separate uv workspace (Python 3.11)** rooted at the *repo
root* (`ml/src/pinakes_ml/`), not inside `core`. Its whole reason to
exist is to keep `torch` / `pykeen` / `problog` **out** of the culture-scrape sidecar so
that package's Docker image stays slim (`ml/CLAUDE.md`: "Separate uv workspace (Python
3.11), NOT the culture-scrape sidecar — keep torch/pykeen OUT of the sidecar"). Because
it is a distinct workspace with its own lock, **it cannot import `culturescrape`** — a
grep for `import culturescrape` / `from culturescrape` across all of `ml/` returns
nothing. Consequently the three derivations consume the corpus **as on-disk files**
(`export/culturescrape/{nodes,edges}/*.tsv`, resolved from `_REPO_ROOT` at
`export_triples.py:42` / `export_scallop.py:52`) and never call any translator API. When
Bucket 1 becomes the `agora` Rust lib, these derivations still read files — they do not
become clients of the engine.

### 3b. Each ML derivation and its input contract

| Derivation | Pure core + CLI | Input contract |
| --- | --- | --- |
| **PyKEEN triples** | `triples.py` + `export_triples.py` | Reads `export/culturescrape/edges/*.tsv` **header-driven** into `Triple`s (`load_triples`, `triples.py:110`); **excludes derived temporals** — `EXCLUDED_RELATIONS = frozenset({"CONTEMPORARY_WITH", "PRECEDES", "FOLLOWS"})` (`triples.py:46`, applied `triples.py:104`); and does **leakage-safe unordered-pair splits** — `split_triples` (`triples.py:128`) groups every triple by its *unordered* entity pair (`_pair_key`, `triples.py:123`) so inverse (`A→B` / `B→A`) and cross-relation duplicates on the same pair never straddle train/valid/test. |
| **Scallop `.scl`** | `scallop.py` + `export_scallop.py` | Translates the committed `datalog/rules_registry.tsv` (`DEFAULT_REGISTRY`, `export_scallop.py:53-61`) into a Scallop program. Only **`status == "active"`** rules are emitted — `translate_registry` drops non-active rules silently (`scallop.py:359`, `_ACTIVE_STATUS = "active"` `scallop.py:60`); **every predicate literal must be binary** (`_translate_literal` raises `UntranslatableClause` on a non-binary predicate, `scallop.py:271-289`); the one rule that breaks it, **`csid_uniqueness_violation`** (it reads the arity-3 `node/3`), is **skipped and reported** as a `SkippedRule` (`scallop.py:120`, `364`) rather than silently dropped. |
| **DeepProbLog pilot** | `deepproblog_pilot.py` | Measures the **per-query knowledge-compilation ceiling**: it renders the runnable ProbLog program the model would compile (`render_problog_program`, `:151`; `render_deepproblog_program`, `:181`), counts distinct proofs per query (`proof_multiplicity`, `:239` over `count_paths`, `:213`), grounds it (`ground_size`, `:296`) and exact-compiles it under a wall-clock budget (`evaluate_program`, `:309`) so a compiler crash/timeout is recorded as a *ceiling hit*, not an error — the `scale_probe` (`:389`) reports "multiplicity + compile feasibility per size: the scale ceiling, measured". |

All three follow the `ml/` **reproducible-artifact pattern** (`ml/CLAUDE.md`): a pure
core over an input dir + a thin CLI + a committed `ml/manifests/*.json` snapshot — none
of which touches a translator symbol.

### 3c. The one ML↔generic coupling: the shared `rules_registry.tsv`

The single point where Bucket 3 touches Bucket 1's world is the **rules registry**.
`ml/scallop.py` re-reads the *same* committed Pinakes datalog artifact,
`core/src/culturescrape/datalog/rules_registry.tsv`
(`export_scallop.py:53-61`), that the generic Datalog emitter consumes via
`datalog/registry.py:active_curated_rules` (Bucket 2 §2c). So the Scallop `.scl`
translator is an **ML-side *re-translation* of the same registry** — Scallop's binary-only
rule shape is deliberately the same one the culture-scrape emitters assume
(`scallop.py:33-36`), and its active-only stance mirrors `active_curated_rules`
(`scallop.py:57-58`). The seam spec therefore requires that **both the generic Datalog
emitter and the ML Scallop re-translation stay fed by the one committed
`rules_registry.tsv`, never forked**: Pinakes authors and commits it once (Bucket 2), the
`agora` emitter reads it as data, and `ml/` reads that same file — three consumers, one
source of truth. This is not an engine-API dependency; it is a shared *data artifact*.

### 3d. The boundary invariant that must survive the split

**`ml/` imports no `culturescrape` symbol** (verified: no `import culturescrape` anywhere
in `ml/`). This is the invariant that keeps Bucket 3 out of the seam entirely: because the
derivations depend only on the **on-disk canonical corpus**
(`export/culturescrape/{nodes,edges}/*.tsv`) and the **committed registry TSV**, *nothing
in Bucket 3 becomes a consumer of the `agora` Rust API*. When Bucket 1 leaves for `agora`
and Bucket 2 stays in `pinakes`, the ML workspace is unaffected — it keeps reading the same
files. The port must preserve this: the corpus file layout and the registry TSV are the
ML contract, and neither may be replaced by an in-process engine call without breaking the
`torch`/`pykeen`/`problog`-isolation the separate workspace exists to enforce.

---

## Entanglement register — where the "generic" seam is messy

The Bucket-1 translators are *almost* domain-neutral, but four couplings let Pinakes
content or Pinakes-side files reach inside the generic emitters. Each is real seam
friction the `agora` port must resolve to keep the Rust engine domain-neutral. Each row
gives the file evidence, why it crosses the seam, and the concrete change the port must
make. (a)/(b) live in the Datalog emitter; (c)/(d) are the schema-injection couplings
already forward-referenced from Bucket 1 §1b and Bucket 2 §2b.

### (a) The tier filter reaches into Pinakes trust-tier source vocab

`datalog/export.py:export_dataset` (`:266`) scopes which rows reach the program with
`keep_row = tier_row_filter(tier)` (`export.py:322`). `tier_row_filter` (`export.py:85`)
**lazily imports** the Pinakes trust-tier predicates from a sibling package:

```python
from culturescrape.orchestrate.tiers import (   # export.py:104
    is_personal_source, is_synthetic_source,
)
```

`is_personal_source` / `is_synthetic_source` (`orchestrate/tiers.py:365` ff.) test a row's
`source` cell against the Pinakes source vocab `PERSONAL_SOURCES` (empty by default —
pinakes bundles no personal-tier producer) / `SYNTHETIC_SOURCES = {"insimul"}`. The tier
names themselves — `PERSONAL_TIER` / `SYNTHETIC_TIER` / `CONTAINED_TIERS` — are Pinakes
trust-tier concepts leaking into the generic
exporter. The lazy import is deliberate — a comment (`export.py:101-103`) notes it dodges a
circular import (`orchestrate.corpus` imports `datalog.export`) — which is itself evidence
the tier logic belongs on the Pinakes side, not the emitter's.

**Resolution (keeps `agora` domain-neutral):** the tier scope becomes a
**caller-supplied `keep_row` predicate** passed *into* the Datalog encode entrypoint — the
Rust engine takes an opaque `Fn(&Row) -> bool` and never imports `orchestrate` or any
source-name vocab. Pinakes builds the predicate from its own trust-tier vocab and hands it
in; `agora` just applies it. The `FILE_WEB_RULES` splice is folded into the same
"rules-as-data" channel as (b).

### (b) The Datalog emitter mixes the generic projection with Pinakes rule content

`export_dataset` takes three toggles — `include_rules`, `include_constraints`,
`include_schema_constraints` (`export.py:271-273`) — that splice Pinakes inference content
into the emitted program: the curated `RULES` / `rules_registry.tsv` library, the P2302
constraint rules, and the `canonical-schema.json` violation rules (Bucket 2 §2c). The
emitter *core* is generic (project rows → binary facts → engine syntax); these toggles let
Pinakes **content** flow through it (`attach_rules = include_rules or include_constraints
or include_schema_constraints`, `export.py:329`).

**Resolution:** the rules/constraints/schema-constraint rulesets pass as
**caller-supplied data** — the Rust encode entrypoint accepts an already-materialized list
of rule/constraint clauses (text or a neutral clause struct) to append, and never reads
`rules_registry.tsv`, `RULES`, or the P2302 artifact itself. Pinakes materializes them
(via `active_curated_rules` etc., Bucket 2 §2c) and passes them in. This is the same
"rule library rides across the seam as DATA, not ported logic" principle from §2c, stated
here as a concrete API change: **no ruleset is a hard-coded Rust constant**.

### (c) `schema_constraints.py` reaches the canonical schema on the TS side

`datalog/schema_constraints.py` reads the canonical edge-type declaration from the repo
root at `Path(__file__).resolve().parents[4] / "shared" / "canonical-schema.json"`
(`schema_constraints.py:67`) — a Bucket-1-adjacent module reaching *out of* `culture-scrape`
and up to the monorepo `shared/` tree, where `canonical-schema.ts` is the source of truth
and the `.json` its generated artifact (Bucket 2 §2b). A `parents[4]` filesystem walk is
exactly the kind of host-layout assumption a domain-neutral engine must not carry.

**Resolution:** the canonical schema/vocab is **injected as config** (Bucket 1 §1b) — the
Rust engine receives the edge-type declaration as a parameter, never walks the filesystem
for `shared/canonical-schema.json`. Pinakes (`pinakes:50`) keeps authoring the schema and
supplies it; `agora` consumes it. (This coupling is also why `schema_constraints.py` itself
stays PINAKES-SPECIFIC, §2c — only the *compiled* violation clauses cross as data per (b).)

### (d) `neo4j/export.py` binds the Pinakes canonical vocab directly

`neo4j/export.py:export_to_tsv` binds the vocab from Pinakes-authored Python:
`node_schema = NodeSchema.canonical()` / `edge_schema = EdgeSchema.canonical()`
(`export.py:175-176`, from `schema/headers.py:191` / `:251`). A Bucket-1 translator reaches
straight for the Pinakes canonical vocab instead of receiving it.

**Resolution:** identical to (c) — the node `:LABEL` set, edge `:TYPE` set, and typed
property columns are the **injected schema config** of Bucket 1 §1b. The Neo4j codec takes
the schema as a parameter; a vocab change is a config change, never a Rust change.

### Register summary

| # | Coupling | Evidence | Resolution |
| --- | --- | --- | --- |
| (a) | Tier filter → Pinakes trust-tier source vocab | `export.py:104` lazy `import … orchestrate.tiers.{is_personal_source,is_synthetic_source}`; `tier_row_filter` `:85` | Caller-supplied `keep_row` predicate; no `orchestrate` import |
| (b) | Emitter mixes generic projection + Pinakes rules | `include_rules`/`include_constraints`/`include_schema_constraints` `export.py:271-273`; `attach_rules` `:329` | Rulesets pass as caller-supplied data, not Rust constants |
| (c) | Schema constraints read `shared/canonical-schema.json` | `schema_constraints.py:67` `parents[4] / "shared" / "canonical-schema.json"` | Schema injected as config; no filesystem walk |
| (d) | Neo4j codec binds `NodeSchema/EdgeSchema.canonical()` | `neo4j/export.py:175-176` | Schema injected as config parameter |

Every entanglement resolves the same way: **content and vocab that today reach into the
generic emitters become parameters the Pinakes side supplies to a domain-neutral engine.**
Once (a)–(d) are externalized, Bucket 1 is genuinely generic.

---

## Migration — the MOVE list for `agora:60` and the RETAIN list for `pinakes:50`

This section hands each downstream tasklist an actionable list it can execute without
re-reading the source.

### MOVE to `agora` (Bucket 1) — for `agora:60`

**Translators to port** (function-by-function; all cited above):

- **TSV codec** — `schema/tsvio.py`: `encode_value`/`encode_values`,
  `decode_value`/`decode_values`, `write_rows`/`read_rows`/`open_rows`,
  `write_node_rows`, `write_edge_rows` (escape table + two sort keys, §1a).
- **Neo4j codec** — `neo4j/export.py:export_to_tsv` (+ `NODE_QUERY`/`EDGE_QUERY`),
  `neo4j/admin_import.py`, `load_csv.py`, `constraints.py`, `merge_load.py:verify_idempotent_load`.
- **Datalog codec** — `datalog/export.py:export_dataset` + `collect_facts`,
  `nodes.py`, `edges.py`, `prolog.py:write_program`, `souffle.py:write_souffle_program`/`write_souffle_facts`,
  `problog.py:write_problog_program`/`collect_problog_facts` (+ `annotate_edge_group`).

**API the `agora` lib must expose** (§1b): a domain-neutral in-memory canonical graph
(nodes: `csid` + `:LABEL` set + typed props; edges: `:START_ID`/`:END_ID`/`:TYPE` + typed
props) with per-format `encode`/`decode` entrypoints mirroring
`export_to_tsv(out_dir, *, config, env, driver)` and
`export_dataset(directory, out, engines, *, include_rules, include_constraints, include_schema_constraints, tier)`
— but with **schema injected as config**, **rulesets/constraints passed as data**, and the
**tier scope as a caller-supplied `keep_row` predicate** (entanglements (a)–(d)). Preserve
the ProbLog `W::` annotation and the `ARITY == 2` constraint (§1b).

**Deps that cross the seam** (§1c): the optional `neo4j` driver → a feature-gated Bolt
client (`neo4rs`); `problog` → **none** (text-only emitter); `torch`/`pykeen` → **none on
this side**.

**Porting obligations** (§1d, non-negotiable): `write_program == render_program`;
`write_souffle_facts` fact-order; filename-sorted, re-iterable `collect_facts` (nodes before
edges); canonical TSV sort (`csid`; `(:START_ID,:END_ID,:TYPE)`).

### RETAIN in `pinakes` (Bucket 2) — for `pinakes:50`

`culture-scrape` **stays vendored in `pinakes`**; when the Bucket-1 emitters leave, these
modules simply revert to plain Pinakes code (nothing physically moves, §2d):

- **Acquisition** — `acquire/*` (Wikidata dump-slice `wikidata_slice.py`, P279
  `taxonomy.py`, P2302 `constraints.py`, and the WD/PetScan/Getty/Pleiades/kaikki adapters).
- **Reconciliation / correspondences** — `schema/reconcile.py`, `mapper.py`, `merge.py`,
  `normalize.py`, `pipeline.py`, and the `{lexicon,glottolog,typology,lexibank,kaikki}_reconcile.py`
  family.
- **Explorer viz** — `explorer/*` (`app.py:create_app`, `server.py:run_server`, + plumbing).
- **Canonical schema/vocab it keeps authoring** — `schema/headers.py`
  (`NodeSchema.canonical()`/`EdgeSchema.canonical()`) + `shared/canonical-schema.{ts,json}`
  (the TS-side source of truth, §2b); supplied to `agora` as config.
- **Datalog inference content** — `datalog/rules.py:RULES`, `constraints.py` (P2302),
  `schema_constraints.py`, `registry.py:active_curated_rules` (+ committed `rules_registry.tsv`),
  `taxonomy.py` (P279). Pinakes authors these and passes the materialized rulesets to
  `agora` as data (entanglement (b)); it does **not** port them to Rust.

### STAYS in `ml/` (Bucket 3) — unaffected by the split

`ml/src/pinakes_ml/{export_triples.py+triples.py, export_scallop.py+scallop.py,
deepproblog_pilot.py}` stay in the separate `ml/` uv workspace. They import **no**
`culturescrape` symbol and consume only the on-disk corpus
(`export/culturescrape/{nodes,edges}/*.tsv`) + the committed `rules_registry.tsv`, so none
becomes a client of the `agora` API (§3d). The one coupling — `ml/scallop.py` re-reading the
same registry TSV the generic emitter uses — is satisfied by the single-committed-registry
invariant (§3c): Pinakes commits it once, `agora` reads it as data, `ml/` reads the same
file; never forked.

---

## READ-ONLY discovery declaration

**This document is a READ-ONLY discovery artifact. No source code was moved or edited by
this task.** The *only* file added is `core/docs/translation-seam.md`
(this file) — consistent with `touches = [pinakes-culture-scrape]`; `git status` shows
exactly one added doc and no source change. Every byte-identity / determinism invariant
(`write_ == render_`, deterministic TSV sort, `ARITY == 2`, re-iterable streaming
`collect_facts`) is documented above as a **porting obligation** for `agora:60`, not
enforced by any change here. The seam is now specified; the moves are `agora:60`'s and
`pinakes:50`'s to execute.
