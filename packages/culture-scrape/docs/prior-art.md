# Prior-Art Analysis

Synthesis of a fan-out, adversarially-verified research pass (106 agents, 24 sources
fetched, 25 claims verified to 2/3-vote confidence). Findings below are high
confidence unless noted.

## Verdict

The landscape is **mature at every layer**. Reuse infrastructure; build the
connective tissue (canonical TSV schema, cross-dimensional linking, lossless
round-trip, Datalog export, orchestration). No existing project offers a
TSV-first, multi-domain aggregator that targets **both** Neo4j and Prolog/Datalog.

## Reusable building blocks

### Data acquisition
- **Wikidata SPARQL Query Service** — `query.wikidata.org/sparql`. Returns native
  **TSV/CSV/JSON/XML/GeoJSON/GPX/KML**. "Every Peruvian dish" is a SPARQL query, not
  a scrape. Bulk extraction should hit the endpoint with `format=` via curl (the GUI
  Download tab has row/timeout limits).
  - Sources: wikidata.org/wiki/Wikidata:SPARQL_query_service ; .../Result_Views
- **PetScan** — traverses category trees with configurable depth, filters by
  template/links, supports intersection/union/difference, **combines wiki categories
  with WDQS SPARQL in one query**, exports native **TSV/CSV** (+ Wikitable, JSON,
  PagePile). Actively maintained (Magnus Manske Rust rewrite, `petscan.wmcloud.org`).
  - Sources: meta.wikimedia.org/wiki/PetScan ; github.com/magnusmanske/petscan_rs
- **mwparserfromhell** — parses MediaWiki wikicode into a navigable object model;
  `filter_templates()`, `filter_wikilinks()`, parameter access by name/position. For
  residual infobox/list wikitext that SPARQL/PetScan can't reach. (PyPI, v0.7.2.)

### Authoritative vocabularies (normalization anchors)
- **Getty AAT/TGN/ULAN** — JSON/RDF/N3-Turtle/N-Triples per record; **full N-Triples
  dumps refreshed monthly**; **ODC-By 1.0** (reuse with attribution). ⚠️ **REFUTED
  (0-3):** there is **no** confirmed public Getty SPARQL endpoint at `vocab.getty.edu`,
  and CONA/IA are not confirmed as LOD. Rely on the monthly dumps + per-record JSON/RDF
  for AAT/TGN/ULAN only. (Legacy XML/relational formats discontinued; final datasets
  drawn 2026-01-30.)
- **Pleiades** — 41,480 ancient-place resources (release 4.1, May 2025) in
  JSON/CSV/RDF-Turtle; **already cross-links each place to Nomisma, Wikidata, EDH,
  Itiner-E, MANTO** (43,556 inbound links from 21 datasets as of June 2026). This is a
  live instance of exactly the cross-domain linked network we target — both a reusable
  dataset and a validated architecture model.

### Storage / round-trip
- **Neo4j import stack** — `neo4j-admin import` for the **initial bulk load** (empty
  DB only; millions/billions of entities); **`LOAD CSV`** for incremental/non-admin
  imports (good to ~10M rows); documented **relational→graph migration** workflow.
  Pattern: bulk-seed with admin import, keep current with `LOAD CSV`. Reverse trip via
  **APOC export-to-CSV** (`apoc.export.csv.*`). (Source: neo4j.com/docs/import/ and
  APOC docs.)

### Visualization / portals (prove the pipeline; confirm our niche)
- **Histropedia / Histropedia Live** — "Timeline of Everything" built from
  Wikipedia/Wikidata; runs **live WDQS SPARQL** queries. 300k+ timelines, 1.5M+ events.
  Timeline-shaped product, not a general aggregator.
- **Sampo-UI** — MIT full-stack JS framework for **semantic portals** over linked data
  (React/Redux + Node/Express, SPARQL-first). No documented TSV/CSV or Neo4j support
  (2-1 vote: strong but not exhaustive). Its only export pushes generated SPARQL into
  YASGUI.
- **Heurist** — surfaced as a related humanities data-management platform (secondary
  source; not deeply verified).

## Symbolic-logic export leads (UNDER-VERIFIED — original work expected)

Research area 5 produced **zero surviving verified claims**, so treat the Datalog/Prolog
path as original engineering. Leads worth evaluating (from fetched-but-unverified sources):
- **Nemo** (knowsys) — modern in-memory Datalog engine designed for RDF/KG reasoning.
- **VLog** (TU Dresden) — rule engine over RDF/relational data.
- **RDFox** (Oxford Semantic Technologies) — commercial Datalog/RDF reasoner.
- **RDFlog** — academic RDF→Datalog mapping (Bry et al., Oxford).
- **Soufflé** — high-performance Datalog (compiles to C++); our chosen bulk target.
- **SWI-Prolog** — mature interactive Prolog; our chosen research/query target (`pyswip`).

## Gaps a TSV-first multi-domain aggregator fills

1. Existing tools are **RDF/SPARQL-first**; none are **TSV-first** (TSV = portable,
   diffable, git-friendly, spreadsheet-openable).
2. Existing rich datasets are **single-domain silos** (Pleiades = ancient places,
   Getty = art); none aggregate **arbitrary cultural categories** across domains.
3. Existing tools **import or export**; none guarantee a **lossless round-trip** against
   a fixed TSV schema.
4. **Nobody targets both Neo4j and Prolog/Datalog** from one canonical model.

## Caveats / open questions (carry into the build)

- DBpedia (+ extraction framework), YAGO, ConceptNet, BabelNet, Freebase legacy,
  CIDOC-CRM, Europeana, Nomisma (only seen as a Pleiades link target), and World
  Historical Gazetteer were **named but not independently verified** — confirm their
  dumps/endpoints/licenses before relying on them.
- The Neo4j **export-back-to-TSV** direction and specific tools (APOC export, py2neo,
  neomodel) need hands-on verification for faithful schema re-serialization.
- **Linguistic** sources (language-family trees, etymological networks) and **genetic**
  sources (population genetics, lineage/derivation data) have **no confirmed open
  structured source** yet — Tasklist 3 includes a dedicated discovery story. Candidate
  leads to investigate: Glottolog, WALS, Wiktionary/`etymology` data, PHOIBLE,
  Wikidata language-family properties; for "genetic"/derivation, Wikidata
  `derived from`/`influenced by` properties and domain-specific lineage datasets.
- Time-sensitivity: Getty legacy formats discontinued 2026-01-30; Pleiades figures are
  release 4.1 (May 2025); Histropedia coverage data is circa 2015-2016 (pipeline still
  live).
