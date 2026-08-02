# Canonical Data Model

The contract every subsystem agrees on. Designed so that **Neo4j import is near-free
and reversible**, TSV stays human-readable and git-diffable, and Datalog export is a
mechanical projection.

## Design principles

1. **TSV is the source of truth.** Neo4j and Datalog are derived, regenerable views.
2. **Adopt Neo4j's CSV header conventions** (but tab-delimited) so `neo4j-admin import`
   consumes our files with minimal transformation and APOC export can reproduce them.
3. **Every row carries provenance.** No fact without a source.
4. **Stable identity.** Entities are keyed on a global ID reconciled to Wikidata QIDs /
   Getty IDs where possible; otherwise a deterministic minted ID.
5. **Two file families:** node files and relationship files.

## File families

### Node files — `nodes/<type>.tsv`
One file per entity type (e.g. `nodes/dish.tsv`, `nodes/sculpture.tsv`,
`nodes/battle.tsv`, `nodes/language.tsv`, `nodes/place.tsv`, `nodes/person.tsv`).

Required columns (Neo4j-import compatible headers):

| Column header | Meaning |
|---|---|
| `csid:ID` | pinakes-engine global id (primary key, unique across all nodes) |
| `:LABEL` | node label(s), `;`-separated (e.g. `Dish;CulturalArtifact`) |
| `name` | canonical display name |
| `lang` | BCP-47 language code of `name` |
| `wikidata_qid` | reconciled Wikidata QID (nullable) |
| `getty_id` | AAT/TGN/ULAN id (nullable) |
| `aliases` | `;`-separated alternative names |
| `description` | short gloss |
| `pinakes_id` | round-trip alias: the source-local id a pinakes-origin row arrived with, so the canonical→lexicon mapping survives a write-back |

Dimension columns (nullable; present when known):

| Column | Dimension | Notes |
|---|---|---|
| `time_start:int` | temporal | year (negative = BCE) or ISO date string in `time_start_iso` |
| `time_end:int` | temporal | |
| `period` | temporal | named period (e.g. "Inca", "Baroque") |
| `lat:float`, `lon:float` | geographic | WGS84 |
| `place_qid` | geographic | Wikidata place QID |
| `tgn_id` | geographic | Getty TGN id |
| `pleiades_id` | geographic | for ancient places |
| `language_code` | linguistic | ISO 639-3 / Glottocode |
| `script` | linguistic | ISO 15924 |
| `etymology` | linguistic | free-text or structured ref |
| `derived_from_csid` | genetic | denormalized convenience pointer (also an edge) |

**Acquisition extensions** (pinakes-engine's, *not* the canonical contract's — see
"Canonical columns are the shared contract" below). They are appended after the
canonical columns by `schema.mapper.node_schema()`, so a canonical-only consumer
reads the prefix unchanged:

| Column | Dimension | Notes |
|---|---|---|
| `parent_code` | linguistic | ancestor language's code (ISO 639-3 / Glottocode); the linguistic linker resolves it to a `DESCENDS_FROM` edge (the persisted counterpart of the ephemeral `parent_qid` ref, the form a Glottolog ingest uses) |
| `extra` | — | JSON object holding every raw field with no canonical home |

Provenance columns (required on every node):

| Column | Meaning |
|---|---|
| `source` | adapter id (e.g. `wikidata`, `petscan`, `getty_aat`, `pleiades`, `wikitext`) |
| `source_url` | canonical URL/URI of the record |
| `source_query` | the SPARQL/PetScan spec or page that produced the row |
| `retrieved_at` | ISO-8601 UTC timestamp |
| `confidence:float` | 0–1 extraction/resolution confidence |
| `license` | SPDX id of the record's distribution licence (e.g. `CC-BY-4.0`, `CC-BY-SA-3.0`); travels with every record so a share-alike source stays legally self-describing |

### Relationship files — `edges/<type>.tsv`
One file per relationship type, Neo4j-import compatible:

| Column header | Meaning |
|---|---|
| `:START_ID` | source node `csid` |
| `:END_ID` | target node `csid` |
| `:TYPE` | relationship type (see ontology below) |
| `weight:float` | optional strength/confidence |
| `time_start:int`, `time_end:int` | optional validity range for the relationship |
| `pinakes_id` | round-trip alias, as on nodes |
| `source`, `source_url`, `source_query`, `retrieved_at`, `confidence:float`, `license` | provenance (same as nodes) |

### Canonical columns are the shared contract

The two tables above are `shared/canonical-schema.json` — the single contract
`docs/canonical-schema.md` says not to fork — transcribed into
`src/pinakes_engine/schema/headers.py` as `NodeSchema.canonical()` /
`EdgeSchema.canonical()`. The embedded agora translation engine
(`agora:60-translation-engine-rust`, reached through `pinakes_engine.translation`)
renders *that* header, so drift between the two silently breaks byte-parity with
it. `tests/test_canonical_schema_parity.py` pins header module, contract and
engine together column-for-column; add a column to the contract first, never
here first.

## Cross-dimensional ontology

Relationship `:TYPE` vocabulary (extensible; defined formally in `src/pinakes_engine/ontology/`):

**Geographic**
- `LOCATED_IN` — entity → place
- `ORIGINATES_FROM` — entity → place/culture of origin
- `SPOKEN_IN` — language → place
- `ADJACENT_TO` — place ↔ place

**Temporal**
- `CONTEMPORARY_WITH` — entity ↔ entity (overlapping time spans)
- `PRECEDES` / `FOLLOWS` — ordered events
- `PART_OF_PERIOD` — entity → period

**Linguistic**
- `DESCENDS_FROM` — language → ancestor language
- `BORROWED_FROM` — term/word → source language/term
- `COGNATE_WITH` — term ↔ term
- `NAMED_IN` — entity → language (name attestation)

**Genetic / derivation** (cultural lineage, not biological)
- `DERIVED_FROM` — artifact/dish/style → ancestor
- `INFLUENCED_BY` — entity → influence
- `VARIANT_OF` — entity → canonical form

**Structural / categorical**
- `INSTANCE_OF` — entity → type
- `SUBCLASS_OF` — type → supertype
- `MEMBER_OF_CATEGORY` — entity → scraped category
- `CREATED_BY` — artifact → person
- `MADE_OF` — artifact → material (Getty AAT)

## Identity & reconciliation

- Primary key `csid` is minted as `cs:<type>:<slug-or-hash>`; when a Wikidata QID is
  known, `csid` is derived deterministically from the QID so re-runs are idempotent.
- Entity resolution (Tasklist 2) collapses duplicates by matching on
  `wikidata_qid` → `getty_id` → normalized `(name, lang, type)` → fuzzy fallback.
- **Koine (KINP):** `csid` is the KINP *entity* identifier in the `pinakes` namespace —
  `cs:<type>:<local>` ⇄ `pinakes:ent:<type>.<local>`, with the canonical IRI derivable
  from it. Mapping rules: [`docs/canonical-schema.md` §3.1](../../docs/canonical-schema.md)
  (repo root); spec: `koine/specs/identity.md` §3.

## Round-trip contract

- **TSV → Neo4j:** `neo4j-admin import` (bulk) / `LOAD CSV` (incremental) consume node
  and edge files directly using the typed headers above.
- **Neo4j → TSV:** APOC `apoc.export.csv.*` (configured tab-delimited) must reproduce
  byte-stable files modulo row ordering; a canonical sort (by `csid` / `:START_ID,:END_ID,:TYPE`)
  makes the round-trip diffable.
- **TSV → Datalog:** each node row → `node(Csid, Type, Name, ...)` facts +
  per-dimension facts (`time_start(Csid, Year).`); each edge row →
  `rel(Type, Start, End).` or typed predicates (`located_in(A, B).`). Rules layer
  (Tasklist 5) derives transitive/inferred relations (e.g.
  `contemporary_with/2`, `same_region/2`).

## Category specification (input)

A category is declared in YAML (`categories/<name>.yml`):

```yaml
id: peruvian-dishes
label: Dish;CulturalArtifact
description: Every Peruvian dish
source:
  type: wikidata-sparql        # or: petscan | wikitext | dump | http
  query: |
    SELECT ?item ?itemLabel ?image WHERE {
      ?item wdt:P31 wd:Q746549 .          # instance of: Peruvian dish (illustrative)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
    }
dimensions: [temporal, geographic, linguistic]
links:
  - type: ORIGINATES_FROM
    to: place
```
