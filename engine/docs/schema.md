# Canonical schema & normalization

This page is the reference for the normalization layer (`src/pinakes_engine/schema/`):
the canonical TSV columns, their type suffixes, the escaping that keeps the files
lossless, and the precedence by which duplicate rows resolve into one node. It
complements [`docs/data-model.md`](data-model.md) — that page states *what* the
contract is, this one documents *how the code implements it* and is verified by
runnable examples.

Every code block below with `>>>` prompts is a doctest, executed by
`tests/test_schema_doc.py`, so the examples are guaranteed to match the code.

## File families

Normalization emits two file families, both tab-delimited with a typed header row
(Neo4j-import conventions, so `neo4j-admin import` consumes them directly):

* **node files** — `nodes/<type>.tsv`, one row per entity;
* **edge files** — `edges/<type>.tsv`, one row per relationship.

The header row names and types every column. A header *cell* is one of:

* a **structural** cell — `csid:ID`, `:LABEL` (nodes) or `:START_ID`, `:END_ID`,
  `:TYPE` (edges);
* a **property** cell — `name` (string) or `name:int` / `name:float`.

## Node columns

`NodeSchema.canonical()` defines the column order below — it is
`shared/canonical-schema.json`'s `node.columns` order verbatim, the single
contract `docs/canonical-schema.md` says not to fork. `node_schema()` appends
pinakes-engine's two acquisition extensions, `parent_code` and the `extra`
overflow (see [Overflow](#overflow-extra)), *after* the canonical columns, so a
canonical-only consumer — the embedded agora translation engine — reads the
prefix unchanged. Every node row carries the identity, provenance, and any
dimension columns that are known; an unknown dimension is simply absent (an
empty cell), never invented.

| Column header | Type | Group | Meaning |
|---|---|---|---|
| `csid:ID` | id | identity | pinakes-engine global id; primary key, unique across all nodes |
| `:LABEL` | label | identity | node label(s), `;`-separated; the first is the entity *type* |
| `name` | string | identity | canonical display name |
| `lang` | string | identity | BCP-47 language code of `name` |
| `wikidata_qid` | string | identity | reconciled Wikidata QID (nullable) |
| `getty_id` | string | identity | AAT/TGN/ULAN id (nullable) |
| `aliases` | string (multi) | identity | `;`-separated alternative names |
| `description` | string | identity | short gloss |
| `pinakes_id` | string | alias | round-trip alias: the source-local id a pinakes-origin row arrived with, so the canonical→lexicon mapping survives write-back |
| `time_start` | `:int` | temporal | start year (negative = BCE) |
| `time_end` | `:int` | temporal | end year (negative = BCE) |
| `time_start_iso` | string | temporal | raw ISO/ambiguous temporal string when sub-year precision matters |
| `period` | string | temporal | named period (e.g. `Inca`, `Baroque`) |
| `lat` | `:float` | geographic | WGS84 latitude |
| `lon` | `:float` | geographic | WGS84 longitude |
| `place_qid` | string | geographic | Wikidata place QID |
| `tgn_id` | string | geographic | Getty TGN id |
| `pleiades_id` | string | geographic | Pleiades id (ancient places) |
| `language_code` | string | linguistic | ISO 639-3 / Glottocode |
| `script` | string | linguistic | ISO 15924 script code |
| `etymology` | string | linguistic | free-text or structured ref |
| `derived_from_csid` | string | genetic | denormalized pointer to an ancestor node (also an edge) |
| `source` | string | provenance | adapter id (e.g. `wikidata`, `wikitext`, `petscan`) |
| `source_url` | string | provenance | canonical URL/URI of the record |
| `source_query` | string | provenance | the query/page that produced the row |
| `retrieved_at` | string | provenance | ISO-8601 UTC timestamp |
| `confidence` | `:float` | provenance | extraction/resolution confidence in `[0, 1]` |
| `license` | string | provenance | SPDX id of the record's distribution licence (e.g. `CC-BY-4.0`, `CC-BY-SA-3.0`); travels with every record so a share-alike source stays legally self-describing |

### Acquisition extensions (not canonical)

`node_schema()` appends these two, in this order, after the canonical columns.
They are pinakes-engine's own — the contract does not declare them, so they must
never move inside `NodeSchema.canonical()`.

| Column header | Type | Group | Meaning |
|---|---|---|---|
| `parent_code` | string | linguistic | ancestor language code (ISO 639-3 / Glottocode) the linguistic linker resolves to a `DESCENDS_FROM` edge; persisted counterpart of the ephemeral `parent_qid` ref (a Glottolog ingest maps `Family_ID` here) |
| `extra` | string | overflow | JSON object of unrecognised raw fields + the merge record |

## Edge columns

`EdgeSchema.canonical()` defines the edge header. Each edge also carries the
provenance of the source node that justified it.

| Column header | Type | Meaning |
|---|---|---|
| `:START_ID` | start | source node `csid` |
| `:END_ID` | end | target node `csid` |
| `:TYPE` | type | relationship type (the ontology in `docs/data-model.md`) |
| `weight` | `:float` | optional strength/confidence |
| `time_start` | `:int` | optional start of the relationship's validity range |
| `time_end` | `:int` | optional end of the relationship's validity range |
| `pinakes_id` | string | round-trip alias, as on nodes |
| `source` | string | provenance: adapter id |
| `source_url` | string | provenance: record URL |
| `source_query` | string | provenance: the query/page that produced the row |
| `retrieved_at` | string | provenance: ISO-8601 UTC timestamp |
| `confidence` | `:float` | provenance: confidence in `[0, 1]` |
| `license` | string | provenance: SPDX id of the record's distribution licence |

## Type suffixes

Only three property types are supported, because only these survive a
`neo4j-admin import` round trip cleanly:

| Suffix | Type | Columns that require it |
|---|---|---|
| *(none)* | string | every column not listed below |
| `:int` | integer | `time_start`, `time_end` (on both nodes and edges) |
| `:float` | float | `lat`, `lon`, `weight`, `confidence` |

The suffix is **mandatory** for the typed columns: a property column whose name
the data model types but whose suffix disagrees is rejected at construction, so an
import-incompatible header can never be written.

```python
>>> from pinakes_engine.schema import (
...     IdColumn, NodeSchema, PropertyColumn, PropertyType,
...     SchemaError, StructuralColumn,
... )
>>> NodeSchema((
...     IdColumn(), StructuralColumn(":LABEL"), PropertyColumn("name"),
...     PropertyColumn("confidence", PropertyType.INT),  # wrong: must be float
... ))
Traceback (most recent call last):
    ...
pinakes_engine.schema.headers.SchemaError: property 'confidence' must be float, got int

```

The structural cells `:LABEL`, `:START_ID`, `:END_ID`, and `:TYPE` are nameless,
and `:ID` carries the primary-key name (`csid:ID`):

```python
>>> from pinakes_engine.schema import NodeSchema, render_node_header
>>> render_node_header(NodeSchema.canonical()).split("\t")[:4]
['csid:ID', ':LABEL', 'name', 'lang']

```

## Escaping rules

TSV is the source of truth, so a field that itself contains a tab, newline, or
backslash must never corrupt the file. The writer applies one deterministic
escape and the reader reverses it *exactly*:

| Literal | Escaped as |
|---|---|
| `\` (backslash) | `\\` |
| TAB | `\t` |
| CR | `\r` |
| LF | `\n` |

Decoding is a single left-to-right scan, so an escaped backslash is never
mistaken for the start of another escape (`\\t` decodes to a literal `\t`, never
to a tab).

```python
>>> from pinakes_engine.schema import encode_value, decode_value
>>> encode_value("Café\tCriollo\n")
'Café\\tCriollo\\n'
>>> decode_value("Café\\tCriollo\\n") == "Café\tCriollo\n"
True

```

**Multi-value columns** (`:LABEL`, `aliases`) join their parts with `;`; a literal
`;` inside a part is escaped as `\;`. An empty cell decodes to an empty list — the
canonical form of "no values".

```python
>>> from pinakes_engine.schema import encode_values, decode_values
>>> encode_values(["Cebiche", "Sea; Bass"])
'Cebiche;Sea\\; Bass'
>>> decode_values("Cebiche;Sea\\; Bass")
['Cebiche', 'Sea; Bass']
>>> decode_values("")
[]

```

## Identity (`csid`)

The primary key `csid` is minted as `cs:<type>:<local>` and is a deterministic
function of its input, so re-runs are idempotent and entity resolution can
recognise a row it has seen before. There are two minting paths:

* **QID-anchored** — when a Wikidata QID is known it *is* the identity, so the
  local part is the QID verbatim (a trailing entity URI is accepted and reduced
  to the bare QID);
* **name-anchored** — otherwise the local part is a readable slug of the name plus
  a hash of the normalized `(name, lang)` pair, so casing/whitespace/Unicode
  differences do not fork the id but two languages of the same spelling stay
  distinct.

```python
>>> from pinakes_engine.schema import mint_csid
>>> mint_csid("Dish", qid="http://www.wikidata.org/entity/Q2007")
'cs:dish:Q2007'
>>> mint_csid("Dish", name="Ceviche", lang="es").startswith("cs:dish:ceviche-")
True

```

## Resolution precedence

Acquisition draws the *same* entity from many sources, so two rows can describe
one real-world thing. `merge_rows` clusters duplicates and collapses each cluster
to one canonical row. Two rows are judged the same thing by a strict
**precedence** of signals, strongest first:

1. **`wikidata_qid`** — identical QID; the QID *is* the identity.
2. **`getty_id`** — identical Getty subject id.
3. **exact `(name, lang, type)`** — same normalized name, language, and node type.
4. **fuzzy `name`** — normalized-name similarity ≥ `0.85` (`DEFAULT_FUZZY_THRESHOLD`),
   within one language and type.

Matching is transitive (union-find), but a merge is **refused** when it would put
two *different* non-empty `wikidata_qid` (or two different `getty_id`) into one
node: an explicit identifier conflict means the rows are distinct things no matter
how alike their names look.

When a cluster merges, the surviving row:

* **keeps the highest-confidence value per column**;
* **unions aliases** — every row's aliases plus the names that lost to the
  canonical name;
* **concatenates provenance** (`source` / `source_url` / `source_query` /
  `retrieved_at`) de-duplicated, and takes the **maximum** `confidence`;
* records the merge under the `merge` key of its `extra` JSON — the precedence
  `reason`, the chosen `primary` csid, and a snapshot of every member row — so the
  decision is auditable and reversible.

## Worked example: Wikidata + wikitext → one node

Two raw rows describe the Peruvian dish *ceviche*: one from a Wikidata SPARQL
query, one parsed from a Spanish Wikipedia infobox. They disagree on spelling
(`Ceviche` vs `Cebiche`) and confidence, but both carry the QID `Q2007`.

```python
>>> from pinakes_engine.acquire.categories import CategorySpec, SourceSpec
>>> from pinakes_engine.acquire.records import Provenance, RawRecord
>>> from pinakes_engine.schema import map_records, merge_rows
>>> category = CategorySpec(
...     id="peruvian-dishes",
...     label="Dish;CulturalArtifact",
...     description="Every Peruvian dish",
...     source=SourceSpec(type="wikidata-sparql", query="SELECT ..."),
...     dimensions=("geographic",),
... )
>>> wikidata = RawRecord(
...     fields={
...         "item": "Q2007",
...         "itemLabel": "Ceviche",
...         "lang": "es",
...         "itemDescription": "Latin American dish of marinated raw fish",
...     },
...     provenance=Provenance(
...         source="wikidata",
...         source_url="https://www.wikidata.org/wiki/Q2007",
...         source_query="SELECT ?item WHERE { ?item wdt:P31 wd:Q746549 }",
...         retrieved_at="2026-06-16T00:00:00+00:00",
...         confidence=0.95,
...     ),
... )
>>> wikitext = RawRecord(
...     fields={
...         "wikidata": "Q2007",
...         "name": "Cebiche",
...         "lang": "es",
...         "course": "appetizer",  # no canonical column -> overflow
...     },
...     provenance=Provenance(
...         source="wikitext",
...         source_url="https://es.wikipedia.org/wiki/Ceviche",
...         source_query="es.wikipedia.org/wiki/Ceviche",
...         retrieved_at="2026-06-16T00:00:00+00:00",
...         confidence=0.6,
...     ),
... )

```

Both rows carry `Q2007`, so mapping mints the **same QID-anchored `csid`** for
each — and merging collapses them to a single node:

```python
>>> rows = map_records([wikidata, wikitext], category)
>>> [row["csid"] for row in rows]
['cs:dish:Q2007', 'cs:dish:Q2007']
>>> merged = merge_rows(rows)
>>> len(merged)
1
>>> node = merged[0]

```

The surviving node keeps the highest-confidence values, unions the losing spelling
into `aliases`, concatenates provenance, and takes the maximum confidence:

```python
>>> node["csid"]
'cs:dish:Q2007'
>>> node["name"]               # Wikidata's value (confidence 0.95) wins
'Ceviche'
>>> node["aliases"]            # the wikitext spelling becomes an alias
['Cebiche']
>>> node["description"]
'Latin American dish of marinated raw fish'
>>> node["source"]             # provenance from both sources, de-duplicated
'wikidata;wikitext'
>>> node["confidence"]         # max(0.95, 0.6)
'0.95'

```

The wikitext-only `course` field is preserved in the `extra` overflow JSON
alongside the auditable merge record, whose `reason` is the strongest precedence
that fired (`wikidata_qid`):

```python
>>> import json
>>> extra = json.loads(node["extra"])
>>> extra["course"]
'appetizer'
>>> extra["merge"]["reason"]
'wikidata_qid'
>>> extra["merge"]["primary"]
'cs:dish:Q2007'
>>> len(extra["merge"]["members"])   # both original rows are snapshotted
2

```

## Overflow (`extra`)

Nothing acquired is silently dropped. `map_record` carries recognised source
fields into their canonical columns and parks every unrecognised field in a single
JSON object under the `extra` column. `merge_rows` then writes its audit record
under that object's `merge` key (see the worked example above). The column is plain
string-typed TSV, so it round-trips through `read_rows` / `write_rows` like any
other cell.

## Round trip

`write_node_rows` / `write_edge_rows` sort rows into a canonical order (`csid` for
nodes; `(:START_ID, :END_ID, :TYPE)` for edges) and render the schema's columns in
order, so the same logical row set always produces byte-identical TSV — making
diffs meaningful and the Neo4j round trip stable. `read_rows` reverses the write
exactly, decoding each cell (and splitting multi-value columns) back to a row dict.
