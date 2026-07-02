# Canonical Node/Edge Schema — the shared data contract

**Status:** Ratified (US-001) · **Last updated:** 2026-07-02
**Machine-readable source of truth:** [`shared/canonical-schema.json`](../shared/canonical-schema.json)
(typed + validated by [`shared/canonical-schema.ts`](../shared/canonical-schema.ts)).

This is the single canonical model both **culture-scrape** (Python pipeline) and
**LinguaScrape** (TypeScript app) target so that a language, an archaeological culture,
a cuisine, a deity, and a trade good mean the same thing in one correlatable graph.
It is the concrete realisation of the contract sketched in
[`culturescrape-integration.md` §5](./culturescrape-integration.md). The column
contracts deliberately mirror culture-scrape's typed Neo4j-import headers
([`packages/culture-scrape/.../schema/headers.py`](../packages/culture-scrape/src/culturescrape/schema/headers.py)
and [`docs/data-model.md`](../packages/culture-scrape/docs/data-model.md)) so LinguaScrape
exports are import-compatible with `neo4j-admin import` **without transformation**.

> **How to consume it.** Import from `@shared/canonical-schema` in TS. On the Python
> side, `shared/canonical-schema.json` is the artifact to validate exported node/edge
> TSV headers against. Both repos read the *same file*; do not fork it.

---

## 1. Node types

Each node type has a kebab-case canonical `name` and a PascalCase Neo4j `:LABEL`.

| `name` | `:LABEL` | Description |
|---|---|---|
| `language` | `Language` | A natural language or genealogical language node |
| `language-family` | `LanguageFamily` | A language family / stock / branch grouping |
| `writing-system` | `WritingSystem` | A script or writing system (ISO 15924) |
| `culture` | `Culture` | A living or historical culture / civilization |
| `archaeological-culture` | `ArchaeologicalCulture` | A material-culture horizon attested archaeologically |
| `urheimat-hypothesis` | `UrheimatHypothesis` | A proposed homeland hypothesis for a language family |
| `religion` | `Religion` | A religion or religious tradition |
| `deity` | `Deity` | A god, goddess, or divine figure |
| `myth-motif` | `MythMotif` | A recurring narrative motif in myth |
| `art-tradition` | `ArtTradition` | An artistic tradition or style lineage |
| `literary-tradition` | `LiteraryTradition` | A literary tradition or corpus |
| `cuisine` | `Cuisine` | A regional or cultural cuisine |
| `ingredient` | `Ingredient` | A food ingredient or foodstuff |
| `trade-good` | `TradeGood` | A commodity moved along trade networks |
| `battle` | `Battle` | A military engagement or conflict event |
| `place` | `Place` | A geographic place, settlement, or site |
| `migration-route` | `MigrationRoute` | A route of human or cultural migration |

The vocabulary is **extensible** — add an entry to `nodeTypes` in the JSON (and a row
here). US-002 maps every `lexicons/*.tsv` onto one of these types.

## 2. Edge types

Each edge type has a kebab-case canonical `name` and a SCREAMING_SNAKE Neo4j `:TYPE`
token. Where an edge already exists in culture-scrape's ontology
([`data-model.md`](../packages/culture-scrape/docs/data-model.md)) we reuse its exact
token so the two graphs share relationship semantics.

| `name` | `:TYPE` | Description |
|---|---|---|
| `descended-from` | `DESCENDS_FROM` | Genealogical descent (language→ancestor, culture→predecessor) |
| `split-from` | `SPLIT_FROM` | Diverged from a common ancestor |
| `merged-with` | `MERGED_WITH` | Merged with another lineage |
| `influenced-by` | `INFLUENCED_BY` | Received influence from another entity |
| `conquered-by` | `CONQUERED_BY` | Militarily conquered by another polity |
| `absorbed-into` | `ABSORBED_INTO` | Absorbed into a successor culture/polity |
| `spoken-in` | `SPOKEN_IN` | A language is spoken in a place |
| `located-in` | `LOCATED_IN` | An entity is located within a place |
| `contemporary-with` | `CONTEMPORARY_WITH` | Overlapping time spans |
| `part-of-period` | `PART_OF_PERIOD` | Falls within a named period |
| `borrowed-from` | `BORROWED_FROM` | A term/word borrowed from a source language |
| `cognate-with` | `COGNATE_WITH` | Terms sharing a common ancestral form |
| `derived-from` | `DERIVED_FROM` | A cultural artifact/style/dish derived from an ancestor |
| `syncretized-with` | `SYNCRETIZED_WITH` | Religious/deity syncretism between traditions |

> **Naming note.** The PRD lists the concept as `descended-from`; the Neo4j `:TYPE`
> token is culture-scrape's pre-existing **`DESCENDS_FROM`** so both graphs use one
> token. The five tokens `SPLIT_FROM`, `MERGED_WITH`, `CONQUERED_BY`, `ABSORBED_INTO`,
> and `SYNCRETIZED_WITH` are new — contributed by LinguaScrape's lineage domains and
> should be added to culture-scrape's `ontology/` as the graphs merge.

## 3. Identity scheme

- **Primary key: `csid`** — culture-scrape's global id, unique across all nodes,
  minted as `cs:<type>:<local>`. When a Wikidata QID is known it *is* the identity
  (`cs:language:Q1860`); otherwise the local part is a readable slug plus a hash of the
  normalized `(name, lang)` pair. Minting is deterministic, so re-runs are idempotent
  (see [`ids.py`](../packages/culture-scrape/src/culturescrape/schema/ids.py)).
- **Anchors** (drive reconciliation; see US-005):
  - all node types → `wikidata_qid`
  - `language` → `language_code` (ISO 639-3 / Glottocode)
  - `place` → `pleiades_id`, `tgn_id`, `place_qid`
- **Alias column: `linguascrape_id`.** Every LinguaScrape-origin row retains its
  original lexicon id here so the canonical→lexicon mapping survives the bidirectional
  write-back (US-007). It is a plain property column on both node and edge files.

## 4. Column contract

The exact header rows are emitted by `nodeHeaderRow()` / `edgeHeaderRow()` in
`@shared/canonical-schema`. Headers use Neo4j's CSV conventions but **tab-delimited**:
a structural cell (`csid:ID`, `:LABEL`, `:START_ID`, `:END_ID`, `:TYPE`) or a property
cell `name` / `name:int` / `name:float`.

### Node columns (`nodes/<type>.tsv`)

| Header | Role | Notes |
|---|---|---|
| `csid:ID` | id | primary key |
| `:LABEL` | label | `;`-separated Neo4j labels (primary label = the node type) |
| `name` | core | canonical display name (required) |
| `lang` | core | BCP-47 language of `name` |
| `wikidata_qid` | core | reconciled Wikidata QID |
| `getty_id` | core | AAT/TGN/ULAN id |
| `aliases` | core | `;`-separated alternative names |
| `description` | core | short gloss |
| `linguascrape_id` | alias | original lexicon id (round-trip key) |
| `time_start:int` | dimension | year, negative = BCE |
| `time_end:int` | dimension | |
| `time_start_iso` | dimension | ISO date when finer than a year |
| `period` | dimension | named period |
| `lat:float`, `lon:float` | dimension | WGS84 |
| `place_qid`, `tgn_id`, `pleiades_id` | dimension | geographic anchors |
| `language_code` | dimension | ISO 639-3 / Glottocode |
| `script` | dimension | ISO 15924 |
| `etymology` | dimension | free-text or structured ref |
| `derived_from_csid` | dimension | denormalized pointer (also a `derived-from` edge) |
| `source` | **provenance** | adapter id — `linguascrape` for LinguaScrape rows |
| `source_url` | **provenance** | canonical URL/URI (blank when unknown) |
| `source_query` | provenance | query/page that produced the row |
| `retrieved_at` | **provenance** | ISO-8601 UTC timestamp |
| `confidence:float` | **provenance** | 0–1 |

### Edge columns (`edges/<type>.tsv`)

| Header | Role | Notes |
|---|---|---|
| `:START_ID` | start_id | source node `csid` |
| `:END_ID` | end_id | target node `csid` |
| `:TYPE` | type | one of the `:TYPE` tokens in §2 |
| `weight:float` | dimension | optional strength |
| `time_start:int`, `time_end:int` | dimension | when the relation held |
| `linguascrape_id` | alias | original lexicon row id (round-trip key) |
| `source`, `source_url`, `retrieved_at`, `confidence:float` | **provenance** | same as nodes |

### Mandatory provenance (US-006)

`source`, `source_url`, `retrieved_at`, and `confidence` are **required on every node
and every edge** — the column must always be present, though `source_url` may be blank
when no URL is derivable (never fabricated; flagged instead). `nodeProvenanceColumns()`
/ `edgeProvenanceColumns()` expose the list programmatically.

## 5. Validation

- **Compile time:** `shared/canonical-schema.ts` asserts the JSON against the
  `CanonicalSchema` type, so structural drift breaks `npm run check`.
- **Runtime:** `assertValidCanonicalSchema()` checks every column's `type`/`role`, the
  structural columns per family, and that each provenance name resolves to a real
  column. Covered by `shared/canonical-schema.test.ts`.
- **Python side:** validate exported headers against `shared/canonical-schema.json`
  before ingestion (US-004/US-008).

## 6. Per-lexicon mapping table (US-002)

The mapping from each of the 57 `lexicons/*.tsv` to a canonical node/edge type is ratified
here and, machine-readably, in [`shared/lexicon-mapping.json`](../shared/lexicon-mapping.json)
(typed accessors in `shared/lexicon-mapping.ts`; totality + real-column checks in
`shared/lexicon-mapping.test.ts`). The JSON is the source of truth; this table is the
human-readable summary — the JSON carries the full column-by-column disposition.

### 6.1 File `kind`s

Each file declares one `kind`:

- **node** — rows become canonical nodes of the declared node type.
- **edge** — rows become canonical edges (`:START_ID`/`:END_ID`/`:TYPE` present); `node` is `null`.
- **attribute** — describes/attaches to a host node via a foreign key (e.g. `language_id`);
  not a standalone canonical node in v1. Columns are retained as properties for a later pass.
- **excluded** — operational / presentation / asset table, not part of the shared graph;
  all columns dropped.

### 6.2 Column dispositions

Every source column carries exactly one disposition:

- **target** → a canonical field (a node field for node files, an edge field for edge files).
- **edge** → an embedded relationship extracted as a canonical edge in US-003.
- **property** → no dedicated canonical field; retained as an extra Neo4j property / future field.
- **drop** → not carried into the canonical model (each has a documented `reason`).

Convention across node files: `id → linguascrape_id` (alias), `name/hypothesis_name → name`,
`native_name/alternate_names → aliases`, `description/summary_description → description`,
`sources → source`, `confidence → confidence`, `*_start/origin_date/time_origin → time_start`,
`*_end/end_date → time_end`, `*_label/style_period/time_period → period`,
`latitude/longitude → lat/lon`. Combined `coordinates` strings are kept as `property` and split
into `lat`/`lon` by the export (US-004). Loose `associated_*` id lists are kept as `property`
(candidate edges for a later pass); only directional foreign keys become edges.

### 6.3 File → node/edge type

| File | kind | node type / edge role |
| --- | --- | --- |
| `languages.tsv` | node | language |
| `families.tsv` | node | language-family |
| `writing-systems.tsv` | node | writing-system |
| `civilizations.tsv` | node | culture |
| `culture-profiles.tsv` | node | culture |
| `archaeological-cultures.tsv` | node | archaeological-culture |
| `archaeological-sites.tsv` | node | place |
| `settlements.tsv` | node | place |
| `rivers-and-waters.tsv` | node | place |
| `urheimat-hypotheses.tsv` | node | urheimat-hypothesis |
| `religions.tsv` | node | religion |
| `deities.tsv` | node | deity |
| `myth-motifs.tsv` | node | myth-motif |
| `art-traditions.tsv` | node | art-tradition |
| `architectural-styles.tsv` | node | art-tradition |
| `dance-traditions.tsv` | node | art-tradition |
| `music-traditions.tsv` | node | art-tradition |
| `literary-traditions.tsv` | node | literary-tradition |
| `cuisines.tsv` | node | cuisine |
| `cuisine-items.tsv` | node | ingredient |
| `ingredient-origins.tsv` | node | ingredient |
| `trade-goods.tsv` | node | trade-good |
| `battles.tsv` | node | battle |
| `migration-routes.tsv` | node | migration-route |
| `cultural-lineages.tsv` | edge | `relationship_type` → edge `:TYPE` (descended-from, influenced-by, absorbed-into, …) |
| `art-style-evolutions.tsv` | edge | `transition_type` → derived-from / influenced-by |
| `etymology-relations.tsv` | edge | `relation_type` → borrowed-from / cognate-with / derived-from (between language nodes) |
| `language-contacts.tsv` | edge | `contact_type` → influenced-by / borrowed-from |
| `building-types.tsv` | attribute | typology → art-tradition / place |
| `city-layouts.tsv` | attribute | → place (`settlement_id`) |
| `civilization-boundaries.tsv` | attribute | → culture (`civilization_id`) |
| `cooking-techniques.tsv` | attribute | → cuisine (`cuisine_id`) |
| `culture-events.tsv` | attribute | → culture (`culture_profile_id`) |
| `daily-life.tsv` | attribute | → culture (`culture_profile_id`) |
| `empires-timeline.tsv` | attribute | → culture (`empire_id`) |
| `foodway-events.tsv` | attribute | diffusion event (candidate migration/derived-from edges) |
| `grammar-features.tsv` | attribute | → language (`language_id`) |
| `haplogroups.tsv` | attribute | genetic (no v1 node type) |
| `innovations.tsv` | attribute | innovation (no v1 node type) |
| `kinship-systems.tsv` | attribute | → language / culture (`language_ids`) |
| `language-range-polygons.tsv` | attribute | → language (`language_id`) |
| `language-ranges.tsv` | attribute | → language (`language_id`) |
| `literary-works.tsv` | attribute | → literary-tradition (`tradition_id`) |
| `material-culture.tsv` | attribute | artifact class (overlaps trade-good) |
| `musical-instruments.tsv` | attribute | → art-tradition (`associated_tradition_ids`) |
| `phonological-inventories.tsv` | attribute | → language (`language_id`) |
| `sample-texts.tsv` | attribute | → language (`language_id`) |
| `social-organization.tsv` | attribute | → culture / language (`culture_or_language`) |
| `social-structures.tsv` | attribute | → culture (`culture_profile_id`) |
| `sound-changes.tsv` | attribute | → language pair (candidate descended-from annotation) |
| `trade-routes.tsv` | attribute | route (no v1 node type; distinct from migration-route) |
| `verb-paradigms.tsv` | attribute | → language (`language_id`) |
| `words.tsv` | attribute | → language (word forms; feed etymology edges) |
| `words-base.tsv` | attribute | Concepticon base concept list (reference vocab) |
| `genai-prompts.tsv` | excluded | GenAI prompt operational table |
| `media-assets.tsv` | excluded | media asset registry (presentation-only) |
| `narratives.tsv` | excluded | guided-tour narrative content |

### 6.4 Embedded relationships → edges (US-003 targets)

| File.column | Canonical edge |
| --- | --- |
| `families.parent_id` | descended-from |
| `languages.family_id` | descended-from |
| `languages.parent_language_id` | descended-from |
| `writing-systems.parent_system_id` | descended-from |
| `archaeological-cultures.predecessor_culture_ids` | descended-from |
| `archaeological-cultures.successor_culture_ids` | absorbed-into |
| `deities.syncretism_links` | syncretized-with |
| `cultural-lineages` (whole file) | `relationship_type` → edge `:TYPE` |
| `art-style-evolutions` (whole file) | `transition_type` → edge `:TYPE` |
| `etymology-relations` (whole file) | `relation_type` → edge `:TYPE` |
| `language-contacts` (whole file) | `contact_type` → edge `:TYPE` |

### 6.5 Columns with no canonical home

Handled two ways (see `shared/lexicon-mapping.json` for the per-column list):

- **Kept as property** — the majority: domain-specific descriptive columns
  (e.g. `pottery_style`, `word_order`, `deity_pantheon`), loose `associated_*` id lists,
  combined `coordinates` strings, and secondary reconciliation keys (`iso639_2`). These ride
  along as extra Neo4j properties and are candidates for future canonical fields.
- **Dropped (with reason)** — presentation/pipeline-only columns: `culture-events.lane` and
  `culture-profiles.image_gallery_tags` (UI), `words.Next_Step` (pipeline marker), and every
  column of the three `excluded` files.

> Note: `words-base.tsv` has a duplicated `annotation_en` header column; the mapping records it
> once and the validator compares unique column names.

## 7. Canonical export (US-004)

`scripts/export-for-culturescrape.ts` emits LinguaScrape's lexicons in this canonical
shape so culture-scrape's tabular adapter can ingest them without transformation. Run it
with `npx tsx scripts/export-for-culturescrape.ts` (build/write API: `buildExport()` is
pure over a lexicons dir; `writeExport()` / `runExport()` touch the filesystem).

**Output location** — `export/culturescrape/` (gitignored; see `.gitignore`):

```
export/culturescrape/
  nodes/<node-type>.tsv   # one file per canonical node type, header = nodeHeaderRow()
  edges/<edge-type>.tsv   # one file per canonical edge type, header = edgeHeaderRow()
  manifest.json           # node/edge type counts + diagnostics
```

A committed snapshot of the manifest lives at
[`docs/culturescrape-export-manifest.json`](./culturescrape-export-manifest.json).

- **Headers** are the exact typed Neo4j-import rows from §4, so the output validates
  against `shared/canonical-schema.json` (asserted by `scripts/export-for-culturescrape.test.ts`).
- **Identity** — `csid` is minted deterministically as `cs:<node-type>:<linguascrape-id>`;
  every row keeps its original id in `linguascrape_id` (the US-007 round-trip key). Edge
  `:START_ID`/`:END_ID` are rewritten from LinguaScrape ids to the csids of exported nodes.
- **Provenance** — every row is stamped `source = "linguascrape"`; `source_url` /
  `retrieved_at` are blank here and filled by US-006 (URLs are never fabricated). Edge
  `confidence` and time ranges carry through from the US-003 extractor; a node with no
  `confidence` column defaults to `0.5`.
- **Idempotent** — rows are sorted (nodes by `csid`, edges by `:START_ID/:END_ID/:TYPE`)
  and no wall-clock is written, so re-runs are byte-identical.
- **Diagnostics** (never silent) — the manifest reports `skippedNodeRowsMissingId`,
  `duplicateCsids`, `ambiguousLinguascrapeIds`, and `edgesWithUnresolvedEndpoint` (edges
  whose endpoint has no exported node are counted + sampled, not emitted, so the output
  stays `neo4j-admin import`-clean; reconciling those endpoints is US-005's job).
