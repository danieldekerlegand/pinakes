# Genetic sources — vetted candidates

> **"Genetic" here means cultural lineage, not biology.** The dimension tracks
> how a cultural artifact, dish, style, or work *derives from*, is *influenced
> by*, or is a *variant of* an earlier one — descent of forms, not descent of
> people. There is no population-genetics or DNA data in this project; the name
> follows the linguistics sense of *genetic relationship* (shared ancestry by
> derivation). See the **Genetic / derivation** group in `docs/data-model.md`.

The prior-art pass (`docs/prior-art.md`) closed with genetic sources marked
**unconfirmed**: "**genetic** sources (population genetics, lineage/derivation
data) have **no confirmed open structured source** yet … for
'genetic'/derivation, Wikidata `derived from`/`influenced by` properties and
domain-specific lineage datasets." This document closes that gap for the
cultural-lineage reading. It evaluates each candidate lead for **coverage**,
**format**, and **license**, records the **Wikidata properties** that express
the ontology's genetic edges (`DERIVED_FROM` / `INFLUENCED_BY` / `VARIANT_OF`,
see `docs/data-model.md`), and picks one source that is **ingestible today**
with the existing acquisition stack.

## Candidate comparison

| Source | Coverage | Format | License | Ingestible now? |
|---|---|---|---|---|
| **Wikidata** derivation properties | Works, dishes, styles, software, etc. carrying `based on` / `influenced by` / `inspired by` / `derivative work` statements | SPARQL → native TSV/CSV/JSON | CC0 1.0 | **Yes** — existing `wikidata-sparql` adapter |
| **DBpedia** (`dbo:influencedBy`, infobox derivation) | Mirrors Wikipedia infoboxes; broad but noisier than curated Wikidata statements | RDF dumps / SPARQL endpoint | CC-BY-SA 3.0 | No — endpoint/dump adapter not yet built; needs license-aware ingest |
| **Domain lineage datasets** (cocktail/recipe trees, art-movement genealogies, software-fork graphs) | Deep within one domain; authoritative derivation chains | Heterogeneous (CSV, JSON, scraped HTML) | Per-dataset; often unclear | No — one bespoke adapter per dataset; vet license individually |
| **Wikidata lexeme derivation** (`P5191`) | Word-level etymological derivation/borrowing | SPARQL (lexeme layer) | CC0 1.0 | Yes, but this is the **linguistic** dimension (`BORROWED_FROM`), not genetic — see `docs/sources-linguistic.md` |

### Wikidata derivation properties — **the pick**

Wikidata expresses cultural derivation directly as item-level statements, so the
genetic edges fall out of a SPARQL query with **no new adapter code**: the
existing `wikidata-sparql` adapter already returns native TSV. Coverage is
uneven by domain (well-populated for cocktails, films, software, music genres;
sparse for folk dishes), but it is **CC0**, curated, and reachable today. This
is the source the shipped category spec uses
(`categories/derived-cocktails.yml`).

### DBpedia

The same derivation signal extracted from Wikipedia infoboxes
(`dbo:influencedBy` and friends). Broader raw reach but noisier and CC-BY-SA
(attribution + share-alike must travel with each record, as the Getty and
Pleiades adapters already do). A reasonable later target once a SPARQL/dump
adapter exists; deferred in favour of curated Wikidata statements.

### Domain lineage datasets

Where a community maintains an explicit genealogy — cocktail "family trees", art
historians' movement-influence graphs, software fork networks — coverage and
authority beat Wikidata *within that domain*. But each is a bespoke format with
its own (often unclear) license, so each needs its own vetted adapter. Pursue
per domain as the catalogue grows; vet the license before relying on any one.

## Wikidata properties for the genetic ontology edges

The ontology's genetic `:TYPE`s (`src/pinakes_engine/ontology/registry.py`) map
onto Wikidata as follows. As with the linguistic edges, Wikidata has **no single
dedicated "variant of" property**; the practical expression is the `subclass of`
hierarchy plus `different from` to separate siblings.

| Ontology `:TYPE` | Wikidata property | Notes |
|---|---|---|
| `DERIVED_FROM` (entity → ancestor) | **`P144`** `based on` | The subject is based on / derived from the object. Inverse is **`P4969`** `derivative work` (object → derivative); querying `P144` gives the forward `DERIVED_FROM` direction. |
| `INFLUENCED_BY` (entity → influence) | **`P737`** `influenced by` | General influence (person, idea, work). **`P941`** `inspired by` is the work-specific narrower form. |
| `VARIANT_OF` (entity ↔ canonical) | No dedicated property — **`P279`** `subclass of` (variant → canonical form), with **`P1889`** `different from` to separate sibling variants | Mirrors the `COGNATE_WITH` situation: the relation is inferred from the canonical hierarchy, not a single property. |

Supporting properties: `P941` `inspired by` (narrow `INFLUENCED_BY`), `P4969`
`derivative work` (inverse of `P144`), `P31` `instance of` / `P279` `subclass
of` (anchor the entity to its type before reading derivation).

## Category-spec snippet — pulling derivation edges from Wikidata

The shipped `categories/derived-cocktails.yml` is the runnable demonstration
(cocktails and the earlier cocktails they derive from, via `P144`):

```yaml
id: derived-cocktails
label: Cocktail;CulturalArtifact
description: Cocktails and the earlier cocktails they are derived from
source:
  type: wikidata-sparql
  query: |
    SELECT ?item ?itemLabel ?basis ?basisLabel WHERE {
      ?item wdt:P31 wd:Q134768 .                 # instance of: cocktail
      ?item wdt:P144 ?basis .                     # based on (cultural derivation)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
dimensions: [genetic]
links:
  - type: DERIVED_FROM
    to: entity
```

`tests/test_genetic_category.py` pins that this spec loads, requests the
`genetic` dimension, keeps the verified `P144` / `Q134768` query, and mints only
`:TYPE`s the registry defines.

## Decision

1. **Ship now:** a Wikidata SPARQL category spec
   (`categories/derived-cocktails.yml`) — ingestible immediately via the
   existing adapter, demonstrates the genetic dimension and `DERIVED_FROM`.
2. **Next:** a **DBpedia** `dbo:influencedBy` adapter (`source.type: dump` or a
   SPARQL endpoint) for broader influence coverage, license-aware.
3. **Later:** bespoke **domain lineage** adapters (cocktail/recipe trees,
   art-movement genealogies, software-fork graphs) per domain, license vetted.

## Sources

- Wikidata `based on` (P144) — <https://www.wikidata.org/wiki/Property:P144>
- Wikidata `influenced by` (P737) — <https://www.wikidata.org/wiki/Property:P737>
- Wikidata `inspired by` (P941) — <https://www.wikidata.org/wiki/Property:P941>
- Wikidata `derivative work` (P4969) — <https://www.wikidata.org/wiki/Property:P4969>
- Wikidata `different from` (P1889) — <https://www.wikidata.org/wiki/Property:P1889>
- Wikidata `cocktail` (Q134768) — <https://www.wikidata.org/wiki/Q134768>
- DBpedia ontology — <https://www.dbpedia.org/resources/ontology/>
