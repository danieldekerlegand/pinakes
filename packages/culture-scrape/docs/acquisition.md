# Acquisition adapters

The unit of acquisition is a **category**: a YAML document in `categories/<name>.yml`
naming a set of entities to scrape, the source that produces them, the dimensions
to enrich, and the cross-dimensional links to mint (see
[`docs/data-model.md`](data-model.md) → *Category specification (input)*).

Every category declares a `source.type`. The factory
(`culturescrape.acquire.build_adapter`) maps that type to the concrete adapter
that fetches its rows. This page documents each adapter, the `source.type` it
serves, and the spec fields it requires.

## Common spec fields

Every category — regardless of source — requires these top-level keys (validated
by `load_category`):

| Field | Meaning |
|---|---|
| `id` | stable category id (e.g. `peruvian-dishes`) |
| `label` | node label(s) for acquired entities, `;`-separated (e.g. `Dish;CulturalArtifact`) |
| `description` | human-readable gloss |
| `source` | mapping with a `type` (below) plus `query`/`params` |
| `dimensions` | list drawn from `temporal`, `geographic`, `linguistic`, `genetic` |
| `links` | *(optional)* list of `{type, to}` edges to mint per entity |

`source.query` is a free-text string (a SPARQL query, a page title, or a dump
path, depending on the adapter). `source.params` is a flat mapping whose values
are coerced to strings; each adapter reads its own keys from it.

## Adapters

### `wikidata-sparql` — Wikidata Query Service

Runs `source.query` against `https://query.wikidata.org/sparql` and maps each
result binding to a row. Best when the category is cleanly modelled as a Wikidata
class — the SPARQL text *is* the declarative definition of the set.

| Required | Field |
|---|---|
| ✅ | `source.query` — the SPARQL query; conventionally binds an `?item` variable holding the entity URI (mined for its QID) |

Example: [`categories/peruvian-dishes.yml`](../categories/peruvian-dishes.yml),
[`categories/italian-sculptures.yml`](../categories/italian-sculptures.yml).

### `wikidata-dump` — Wikidata class membership over the local dump

Selects entities **by class membership over a local Wikidata JSON dump**
([reader below](#wikidata-bulk-dump-reader)) instead of a live query: it streams
the dump and keeps every entity that is an `instance of` (P31) the named class —
optionally also instances of that class's `subclass of` (P279) descendants, the
`wdt:P31/wdt:P279*` idiom. Each kept entity becomes the **same `RawRecord`
shape** the `wikidata-sparql` adapter produces (`item` URI, `qid`, `itemLabel`),
so a category can switch between the two `source.type`s for the same class with
**no change to downstream normalization, linking, or export**. Use it when the
class is large, the Query Service would rate-limit or time out, or a run must be
fully offline and reproducible against a pinned dump.

| Required | Field |
|---|---|
| ✅ | `source.params.path` (or `source.query`) — path to the local dump (`latest-all.json.gz`/`.bz2`/`.json`) |
| ✅ | `source.params.class` — the class QID(s) whose instances to select; `;`-separated for several |
| ➖ | `source.params.transitive` — truthy (`true`/`1`/`yes`/`on`) to also include instances of the class's `P279` subclasses; default direct `P31` only |
| ➖ | `source.params.language` — label language for `itemLabel` (default `en`); an entity lacking a label in that language yields a row with no name, exactly as an unbound SPARQL `OPTIONAL` would |
| ➖ | `source.params.hydrate` — opt into [rich hydration](#rich-hydration) by naming a profile (`default` or `language`); unset means label-only (SPARQL parity) |
| ➖ | `source.params.hydrate_languages` — `;`-separated extra languages whose labels/aliases are gathered into `aliases` (only used when `hydrate` is set) |
| ➖ | `source.params.index` — path to a [prebuilt membership index](#prebuilt-class-membership-index); unset, the sidecar `<dump>.index.json` is used when present and a full scan otherwise |

```yaml
source:
  type: wikidata-dump
  params:
    path: data/wikidata/latest-all.json.gz
    class: Q746549            # instance of: Peruvian dish
    transitive: "true"        # also its P279 subclasses
    language: en
    hydrate: default          # extract statements into dimension columns
    hydrate_languages: es;qu  # also collect Spanish/Quechua names as aliases
```

#### Rich hydration

A lightweight SPARQL `SELECT` returns only what it asks for, but the bulk dump
ships *every* statement an entity has — so a dump-sourced node can carry far more
than a label and image at no extra request cost. Setting `source.params.hydrate`
to a profile name turns that depth into canonical columns: each kept entity's
statements, qualifiers, and multilingual labels are extracted into the schema's
dimension columns, so the temporal / geographic / linguistic / genetic linkers
have more to work from and infer more edges.

The property-to-column mapping is **declarative** — an ordered list of
`PropertyMapping` rows in
[`acquire/wikidata_hydration.py`](../src/culturescrape/acquire/wikidata_hydration.py).
Adding an attribute is a config change (one more row), never a code change. Two
profiles ship today:

- **`default`** (shared, cross-domain): inception `P571` → `time_start`/`time_end`;
  coordinate location `P625` → `lat`/`lon`; country of origin `P495` / location
  `P276` / country `P17` → `place_qid`; based on `P144` → the genetic linker's
  `derived_from_qid`; influenced by `P737` → `influenced_by_qid`; language of work
  `P407` → `language_code`; material `P186` and named-after `P1582` etymology.
- **`language`**: a language's parent family `P279` → `parent_qid` (linguistic
  descent); Wikimedia/ISO codes `P424`/`P218` → `language_code`; spoken-in country
  `P17` → `place_qid`; writing system `P282` → `script`.

Selection fields (`item`, `qid`, `itemLabel`) are authoritative — a profile only
*adds* attributes, it never overwrites them — so a hydrated category stays a
drop-in superset of its label-only form.

#### Prebuilt class-membership index

Resolving a class straight from the dump scans every entity — and the transitive
`P31/P279*` form scans it *twice* (once to build the subclass graph, once to
select members). On a multi-gigabyte dump that cost is paid on every run. Build
it **once** into an on-disk index instead:

```sh
culturescrape index-wikidata data/wikidata/latest-all.json.gz
# -> data/wikidata/latest-all.json.gz.index.json
```

The indexer streams the dump a single time and records, as a small JSON sidecar,
both directions of class membership: `instances` (class → the QIDs that declare
it via `P31`) and `subclasses` (class → its `P279` subclasses, from which the
transitive closure of any root is walked in memory). The adapter then uses the
index automatically — it loads `source.params.index` when set, else the
conventional `<dump>.index.json` sidecar when present, and otherwise falls back
to a full scan. **Results are identical** either way, because both paths read the
same `P31`/`P279` statements; the index only removes the rescan.

The sidecar stamps the **fingerprint** of the dump it was built from (file name,
byte size, and any `YYYYMMDD` date in the name). Point it at a different dump and
it is rejected with a clear message rather than silently answering for the wrong
data — so refresh the index whenever you refresh the dump. Pass `--out` to write
it somewhere other than the default sidecar location.

### `petscan` — PetScan category-tree front-end

Runs the spec's PetScan parameters against `https://petscan.wmcloud.org/`. Best
when the category lives as a **Wikipedia category tree** rather than a clean
Wikidata class: PetScan traverses the tree to `depth`, combines branches by
`combination`, and resolves pages to their Wikidata QIDs.

| Required | Field |
|---|---|
| ✅ | `source.params.categories` **or** `source.params.sparql` — at least one must be set |
| ➖ | `source.params.depth` — category-tree traversal depth |
| ➖ | `source.params.combination` — how to combine branches (`subset`/`union`/…) |
| ➖ | `source.params.language`, `source.params.project` — wiki to query (default `en`/`wikipedia`) |

Example: [`categories/us-civil-war-battles.yml`](../categories/us-civil-war-battles.yml).

### `wikitext` — raw MediaWiki wikitext

Fetches a page's raw wikitext via the MediaWiki API and parses it with
`mwparserfromhell`. Reaches the long tail of data that lives only in prose pages
— the rows of a *"List of …"* wikitable and the fields of an infobox.

| Required | Field |
|---|---|
| ✅ | `source.query` **or** `source.params.page` — the page title to parse |
| ➖ | `source.params.template` — infobox/template name to extract occurrences of |
| ➖ | `source.params.table_class` — wikitable CSS class to read rows from |
| ➖ | `source.params.language`, `source.params.project` — wiki to query (default `en`/`wikipedia`) |

### `http` — generic HTML scrape (last resort)

Fetches an HTML page and extracts rows via CSS/XPath selectors. The pluggable
fallback for sources with no structured export.

| Required | Field |
|---|---|
| ✅ | `source.query` **or** `source.params.url` — the page URL |
| ✅ | `source.params.row_selector` — selector matching each row element |
| ➖ | `source.params.selector_type` — `css` (default) or `xpath` |

### `dump` — local bulk dumps (Getty, Pleiades, any tabular file)

Reads a bulk dump **from local disk** — no live endpoint is hammered. The `dump`
type is served by three adapters, so the spec must name one via
`source.params.adapter`:

| Adapter | `source.params.adapter` | Reads |
|---|---|---|
| Getty AAT/TGN/ULAN | `getty` | monthly N-Triples vocabulary dump (ODC-By) |
| Pleiades | `pleiades` | ancient-world gazetteer JSON/CSV export (CC-BY) |
| Generic tabular | `tabular-dump` | **any** local TSV/CSV/JSON file, by column mapping |

Common to all three:

| Required | Field |
|---|---|
| ✅ | `source.params.adapter` — `getty`, `pleiades`, or `tabular-dump` |
| ✅ | `source.query` **or** `source.params.path` — path to the local dump file |
| ➖ | `source.params.format` — `json`/`csv`/`tsv`/`jsonl`; inferred from the extension otherwise |
| ➖ | `source.params.license` — overrides the default licence string |

#### `tabular-dump` — ingest an existing dataset

The reusable adapter for folding a third-party dataset into the corpus. It reads
any delimited or JSON file and **renames its columns onto the canonical field
names** the normalizer recognizes (`name`, `wikidata_qid`, `lat`/`lon`,
`time_start_iso`, `place_qid`, `description`, … — see [`docs/data-model.md`](data-model.md)).
Unmapped columns are kept under their own name and preserved in the normalizer's
overflow column, so nothing is dropped. Ingesting a dataset is then a category
spec, not new code.

| Field | Meaning |
|---|---|
| `field.<canonical>: <source-column>` | rename a source column onto a canonical field (e.g. `field.name: city_name`, `field.wikidata_qid: qid`) — zero or more |
| `delimiter` | override the column delimiter for `tsv`/`csv` |
| `id_column` | source column holding a stable row id |
| `url_template` | builds each record's `source_url` by substituting `{id}` from `id_column` |
| `source` | provenance source name (default `dump`) |
| `confidence` | provenance confidence stamped on every record (default `1.0`) |

```yaml
source:
  type: dump
  params:
    adapter: tabular-dump
    path: data/andean-cities.tsv
    source: andean-gazetteer
    license: CC-BY 4.0
    id_column: gid
    url_template: https://example.org/city/{id}
    field.name: city_name
    field.wikidata_qid: qid
    field.lat: latitude
    field.lon: longitude
    field.time_start_iso: founded
```

## Wikidata bulk-dump reader

Wikidata is the project's primary raw-data backbone. Beyond the live
[`wikidata-sparql`](#wikidata-sparql--wikidata-query-service) adapter, the
project can ingest Wikidata's **full JSON dump** offline, rate-limit-free, and at
scale. The foundation is a streaming reader,
`culturescrape.acquire.wikidata_dump.iter_entities`.

The dump (`latest-all.json.gz` / `.bz2`) is one large JSON array printed **one
entity per line** — a `[` opener, a `]` closer, and a trailing comma after every
entity line but the last. `iter_entities(path)` walks that framing line by line
and yields each entity as a parsed `dict` carrying its native `id`, `labels`,
`claims` (statements), and `sitelinks`, so memory use is bounded by a single
record rather than the whole multi-gigabyte array.

| Behaviour | Detail |
|---|---|
| Compression | `.gz` → gzip, `.bz2` → bzip2, anything else → plain text, by extension |
| Source | a **local** path only — the reader never downloads the dump; acquisition stays explicit about where bytes come from |
| Robustness | array framing (`[`/`]`) and per-line trailing commas are stripped; a malformed line is skipped with a counted warning (see `DumpReadStats`), never a crash |
| Offline tests | a tiny committed slice under `tests/fixtures/wikidata/` (plain + gzip + bzip2) drives the tests with no network |

```python
from pathlib import Path
from culturescrape.acquire import DumpReadStats, iter_entities

stats = DumpReadStats()
for entity in iter_entities(Path("data/wikidata/latest-all.json.gz"), stats=stats):
    qid = entity["id"]
    label = entity["labels"].get("en", {}).get("value")
    ...
print(f"{stats.entities} entities, {stats.skipped} malformed lines skipped")
```

This reader is the basis for the
[`wikidata-dump`](#wikidata-dump--wikidata-class-membership-over-the-local-dump)
source adapter, which selects entities by class membership and maps them onto the
same `RawRecord` shape as `wikidata-sparql`.

### Obtaining and refreshing the dump

The reader and every adapter built on it read a dump **already on local disk** —
the project never downloads it for you, so acquisition stays explicit about where
the bytes came from. Fetch one yourself from the official Wikimedia mirror:

```sh
mkdir -p data/wikidata
# The complete entity dump (tens of GB compressed). 'latest-all' always points at
# the newest run; a dated file name (wikidata-YYYYMMDD-all.json.gz) pins a run.
curl -L -o data/wikidata/latest-all.json.gz \
  https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz
```

The full dumps live at `https://dumps.wikimedia.org/wikidatawiki/entities/`
(`latest-all.json.gz` / `latest-all.json.bz2`, plus dated snapshots under
`<YYYYMMDD>/`). Prefer a **dated** file name: the `YYYYMMDD` in it is the dump's
version, and the project reads that date straight out of the file name to stamp
provenance and fingerprint the index (below).

**Refreshing** is a three-step ritual whenever a newer run is wanted:

1. Download the new dump (ideally a fresh dated file, so the version is unambiguous).
2. Rebuild the [class-membership index](#prebuilt-class-membership-index) against
   it — an index built from a different dump is rejected, by design, rather than
   silently answering for the wrong data.
3. Re-run the affected categories (or the [enrichment step](#enriching-an-existing-corpus-from-the-dump)).
   New rows record the new dump's version in their provenance, so a corpus always
   says which dump it was compiled from.

### Run provenance: which dump a row came from

Every row a `wikidata-dump` category produces carries, in its `source_query`
provenance column, both the class selection **and the dump's identity** — its file
name and the `YYYYMMDD` version parsed from that name (`unknown` when the name
carries no date):

```
P31/P279* Q746549 [wikidata-dump wikidata-20240601-all.json.gz @ 20240601]
```

So a compiled corpus is self-describing: each dump-sourced node states which dump
(and which dump *date*) it was extracted from, making the run reproducible against
that exact snapshot. The [enrichment step](#enriching-an-existing-corpus-from-the-dump)
records the same dump version in each touched node's `extra` cell.

## Enriching an existing corpus from the dump

A corpus already scraped from the live Query Service carries only what its
`SELECT` returned, even though every node knows its `wikidata_qid`. The
`culturescrape enrich` command gives that corpus the dump's depth **without
rescraping**: it looks each node's QID up in the local dump, hydrates the
configured attributes (the same [profiles](#rich-hydration) the dump adapter
uses), fills the node's *missing* canonical columns, and runs the existing
ontology linkers over the richer nodes.

```sh
culturescrape enrich out/seed-corpus data/wikidata/latest-all.json.gz \
  --out out/seed-corpus-enriched --languages en,es,qu
```

| Argument | Meaning |
|---|---|
| `directory` | the canonical node/edge TSV corpus to enrich |
| `dump` | the local Wikidata JSON dump (never fetched) |
| `--out` | where the enriched, linked `nodes/`, `edges/`, and `metrics.json` are written |
| `--profile` | hydration profile naming the attributes to fill (default `default`) |
| `--languages` | language codes to collect names in and attest `NAMED_IN` for (default `en`) |
| `--dimensions` | dimensions to link on, in order (default `temporal,geographic,linguistic,genetic`) |

The filled attributes flow straight into the existing linkers: `inception` →
**temporal**, `coordinate location` / `country of origin` → **geographic**,
`based on` / `influenced by` → **genetic**, and the entity's multilingual labels →
**`NAMED_IN`** edges (an entity's name attested in a language), minted by the
[`NamedInLinker`](../src/culturescrape/ontology/named_in.py). Only registered edge
`:TYPE`s and valid dimensions are produced, and the run prints the added links by
dimension; the dump is streamed once, keeping only the QIDs the corpus carries.

Enrichment is **provenance-aware and idempotent**. A value is written only into a
column that is currently *empty*, so an existing (higher- or equal-confidence)
value is never clobbered; each touched node records, in its `extra` cell, that
those columns came from the dump and *which dump version* (the date in the dump's
file name). Re-running over an already-enriched corpus produces byte-identical
output. The logic lives in
[`acquire/wikidata_enrich.py`](../src/culturescrape/acquire/wikidata_enrich.py).

## Example categories

The [`categories/`](../categories/) directory ships runnable examples to model
your own categories on:

| Category | `source.type` | Demonstrates |
|---|---|---|
| `peruvian-dishes` | `wikidata-sparql` | a category defined by a SPARQL `instance of` query |
| `italian-sculptures` | `wikidata-sparql` | SPARQL with `OPTIONAL` enrichment and `CREATED_BY`/`ORIGINATES_FROM` links |
| `us-civil-war-battles` | `petscan` | a Wikipedia category tree walked via PetScan params |

Each validates against `load_category`; `tests/test_example_categories.py` loads
them all and asserts they parse without error.
