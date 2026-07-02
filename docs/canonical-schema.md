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

## 6. Per-lexicon mapping table

The mapping from each of the 57 `lexicons/*.tsv` to a node/edge type and column-by-column
field mapping is ratified in **US-002** (this section is its home). Until then, see the
gap analysis in [`culturescrape-integration.md` §3](./culturescrape-integration.md).
