# Neo4j round-trip

This page is the operator's guide for moving a canonical TSV dataset
(`docs/data-model.md`) into Neo4j and back out again losslessly. It covers when to
bulk-seed with `neo4j-admin import` versus update incrementally with `LOAD CSV`,
the `csid` constraint setup that anchors identity, exporting the graph back to TSV,
the round-trip guarantee, and the shipped example queries — with exact commands for
a local Neo4j instance.

It documents *how to drive* the converter (`src/culturescrape/neo4j/`); for *what*
the file contract is, see [`docs/data-model.md`](data-model.md).

Every code block below with `>>>` prompts is a doctest, executed by
`tests/test_neo4j_doc.py`, so the examples are guaranteed to match the code.

## Prerequisites

The converter is the only part of culture-scrape that talks to a graph database,
so its driver is kept out of the core install behind an extra:

```sh
pip install 'culturescrape[neo4j]'
```

Connection settings are read from the environment (or passed explicitly):

```sh
export NEO4J_URI='bolt://localhost:7687'   # default if unset
export NEO4J_USER='neo4j'                   # default if unset
export NEO4J_PASSWORD='your-password'       # required; no default
```

A dataset is a directory holding `nodes/*.tsv` and `edges/*.tsv` with the
canonical typed headers. Both the bulk and incremental paths can *generate* their
scripts with no live database; only `--mode loadcsv` and `from-neo4j` open a
connection.

### APOC

The incremental `LOAD CSV` path **requires the [APOC](https://neo4j.com/docs/apoc/)
plugin**, because:

* relationship types are data-driven (the `:TYPE` column), which core Cypher cannot
  `MERGE`, so we use `apoc.merge.relationship`;
* the `;`-separated `:LABEL` cell is reattached with `apoc.create.addLabels`.

Install APOC by dropping its jar into the server's `plugins/` directory (it ships
with Neo4j Desktop and the official Docker image), then restart. The bulk
`neo4j-admin import` path and the driver-side export below do **not** need APOC.

#### `apoc.export.file_enabled` (only for server-side export)

This package exports back to TSV over the **driver cursor** (see
[Export](#export-graph--tsv) below), which needs no server configuration. If you
instead prefer Neo4j's server-side APOC export (`apoc.export.csv.*`), that
procedure writes to the *server's* filesystem and is disabled by default. Enable it
in `conf/neo4j.conf`:

```conf
apoc.export.file_enabled=true
```

Restart the server for the change to take effect. The driver-side `from-neo4j`
command needs none of this and is the recommended path.

## Bulk seed vs. incremental update

| | `neo4j-admin import` (bulk) | `LOAD CSV` (incremental) |
|---|---|---|
| When | Seed a **fresh, empty** database | Update an **existing** graph |
| Speed | Fastest; offline batch loader | Slower; transactional |
| Live DB | Not required to *run*; DB must be **stopped** | Required; DB **running** |
| APOC | Not needed | **Required** |
| Idempotent | No — `--overwrite-destination` replaces the DB | Yes — `MERGE` on `csid` updates in place |
| CLI | `to-neo4j --mode admin` (default) | `to-neo4j --mode loadcsv` |

Rule of thumb: **first load → admin import; every load after → `LOAD CSV`.**

### Bulk seed with `neo4j-admin import`

`to-neo4j` (default `--mode admin`) discovers the dataset, verifies every header
is a valid `neo4j-admin` header, and writes a runnable import script. No live
database is touched while generating it:

```sh
culturescrape to-neo4j ./dataset --out ./dataset
# wrote neo4j-admin import script to dataset/neo4j-admin-import.sh (...)
```

The generated command pins the two delimiters that match our TSV escape — a tab
field separator and `;` for multi-value cells — and overwrites the destination
database:

```pycon
>>> from pathlib import Path
>>> from culturescrape.neo4j.admin_import import build_command
>>> cmd = build_command(
...     "neo4j", (Path("nodes/dish.tsv"),), (Path("edges/derived_from.tsv"),)
... )
>>> cmd[:5]
('neo4j-admin', 'database', 'import', 'full', 'neo4j')
>>> cmd[5:8]
('--delimiter=\\t', '--array-delimiter=;', '--overwrite-destination')

```

`neo4j-admin import` loads into a **stopped** database, so run the emitted script
while the server is down, then start it:

```sh
neo4j stop
bash ./dataset/neo4j-admin-import.sh
neo4j start
```

### Incremental update with `LOAD CSV`

For an existing graph, `--mode loadcsv` runs idempotent `LOAD CSV` against the
connected database: nodes are `MERGE`d on `csid` (re-running updates rather than
duplicates) and relationships are merged on `(:START_ID, :END_ID, :TYPE)`. This
requires APOC and a running server:

```sh
culturescrape to-neo4j ./dataset --mode loadcsv
# ran N LOAD CSV statement(s) against Neo4j
```

To inspect the Cypher before running it, generate the script instead:

```pycon
>>> from culturescrape.neo4j.load_csv import generate_load_script  # doctest: +SKIP
>>> plan = generate_load_script("./dataset")                       # doctest: +SKIP
>>> print(plan.script_path)                                        # doctest: +SKIP
dataset/neo4j-load-csv.cypher

```

```sh
cypher-shell -f ./dataset/neo4j-load-csv.cypher
```

## Constraint setup

Every node carries a shared `Entity` label in addition to its per-type labels, so
a single uniqueness constraint enforces the global `csid` primary key and a single
index backs the `MERGE (n:Entity {csid})` the incremental loader runs. Apply the
constraint **before** seeding so loads are index lookups, not full scans.

Three idempotent statements are emitted — the `csid` uniqueness constraint plus
supporting `wikidata_qid` and `name` lookup indexes. `IF NOT EXISTS` makes
re-running a no-op:

```pycon
>>> from culturescrape.neo4j.constraints import constraint_statements
>>> for statement in constraint_statements():
...     print(statement.splitlines()[0])
CREATE CONSTRAINT csid_unique IF NOT EXISTS
CREATE INDEX entity_wikidata_qid IF NOT EXISTS
CREATE INDEX entity_name IF NOT EXISTS

```

Write them to a script and apply it with `cypher-shell`:

```pycon
>>> from culturescrape.neo4j.constraints import generate_constraints_script
>>> generate_constraints_script("./dataset")                       # doctest: +SKIP
PosixPath('dataset/neo4j-constraints.cypher')

```

```sh
cypher-shell -u neo4j -p "$NEO4J_PASSWORD" -f ./dataset/neo4j-constraints.cypher
```

## Export: graph → TSV

`from-neo4j` streams every node and relationship over the Bolt connection and
writes them back to canonical TSV with the same lossless writers the pipeline uses
— no APOC and no server-side file configuration required:

```sh
culturescrape from-neo4j --out ./roundtrip
# exported N node(s) and M edge(s) to roundtrip
```

Nodes are grouped into `nodes/<label>.tsv` keyed on their primary type label (the
`Entity` anchor dropped), relationships into `edges/<type>.tsv` keyed on `:TYPE`.
Every file carries the full canonical header, so typed columns keep their
`:int`/`:float` suffixes and rows are written in canonical sort order.

## Round-trip guarantee

The TSV ↔ Neo4j round-trip is **byte-lossless**: seed a graph from a canonical
dataset, export it back with `from-neo4j`, and the emitted TSV is byte-for-byte
identical to the input. This holds because both directions share one schema
(`schema/headers.py`) and one set of escaping writers (`schema/tsvio.py`): typed
property suffixes, multi-value `;` arrays, and canonical row sort order survive the
trip unchanged. The guarantee is proven against a live graph in
`tests/test_neo4j_roundtrip.py`.

```sh
# round-trip and diff: identical output means a faithful round-trip
culturescrape to-neo4j ./dataset --mode loadcsv
culturescrape from-neo4j --out ./roundtrip
diff -r ./dataset/nodes ./roundtrip/nodes && diff -r ./dataset/edges ./roundtrip/edges
```

## Example queries

The `cypher/` directory ships parameterized example queries that run as-is against
a graph imported by this package. Each is documented and references only the
labels and relationship types the schema defines:

| File | Answers |
|---|---|
| `contemporary-with.cypher` | Everything temporally contemporary with an entity |
| `language-family-tree.cypher` | The descent tree rooted at a language family |
| `originates-from-region.cypher` | Everything that originates from a region |
| `shortest-cultural-path.cypher` | The shortest cultural-lineage path between two entities |
| `invention-lineage.cypher` | The `DERIVED_FROM` lineage descending from an ancestor invention |
| `game-family-variants.cypher` | The `VARIANT_OF` family of a given game |
| `material-composition.cypher` | The `MADE_OF` materials an artifact is composed of |
| `festivals-in-period.cypher` | The festivals and traditions `PART_OF_PERIOD` a named period |

The last four were added with the corpus-expansion domains (science/technology,
sports/games, material culture, living traditions), one per domain, each
exercising that domain's signature relationship.

Run one with `cypher-shell`, binding its documented parameters:

```sh
cat cypher/originates-from-region.cypher | \
  cypher-shell -u neo4j -p "$NEO4J_PASSWORD" \
    --param "region_csid => 'cs:place:andes'"
```

A linter checks every shipped query references only schema-defined vocabulary, so
a query that drifts from the ontology fails the suite rather than erroring at
runtime. All of them pass:

```pycon
>>> from culturescrape.neo4j.queries import iter_queries, lint_query
>>> sorted(path.name for path in iter_queries())
['contemporary-with.cypher', 'festivals-in-period.cypher', 'game-family-variants.cypher', 'invention-lineage.cypher', 'language-family-tree.cypher', 'material-composition.cypher', 'originates-from-region.cypher', 'shortest-cultural-path.cypher']
>>> all(lint_query(path.read_text(encoding="utf-8")) == [] for path in iter_queries())
True

```
