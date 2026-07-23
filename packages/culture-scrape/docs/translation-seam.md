# Translation seam — canonical-graph ↔ format translators in `culture-scrape`

**Status: READ-ONLY discovery artifact.** This document maps every
canonical-graph↔format translator in `packages/culture-scrape` (and its `ml/`
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
Paths are relative to `packages/culture-scrape/src/culturescrape/` unless prefixed with
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

<!-- US-3 (PINAKES-SPECIFIC bucket), US-4 (ML-DERIVATION bucket), and
     US-5 (Entanglement register + Migration) append their sections below. -->
