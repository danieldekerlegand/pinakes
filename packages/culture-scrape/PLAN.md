# culture-scrape — Master Plan

> A TSV-first, multi-domain aggregation engine for cultural, socio-historical, and
> linguistic data. Scrapes sweeping categories ("every Peruvian dish", "every battle
> of the American Civil War"), normalizes them into a canonical tabular schema,
> links them across temporal / geographic / linguistic / genetic dimensions, and
> round-trips losslessly to **Neo4j** and exports to **SWI-Prolog / Soufflé Datalog**.

---

## 1. Vision

Build a dense, navigable network of cultural knowledge that can be queried as a
property graph (Neo4j) for exploration/visualization/travel, as flat TSV for
portability and version control, and as symbolic facts (Prolog/Datalog) for
logical inference and research.

The unit of acquisition is a **category** — a well-defined set of entities
("Peruvian dishes", "Italian sculptures", "German architectural monuments"). Each
category becomes one or more TSV files. Categories are stitched together through
shared entities and cross-dimensional edges into a single graph.

## 2. Locked decisions (from project kickoff)

| Decision | Choice | Rationale |
|---|---|---|
| Acquisition scope | **Structured-first, Wikidata-backed** | **Wikidata is the primary raw-data backbone** — ingested both live (SPARQL Query Service) and from the **bulk JSON dump** offline, rate-limit-free, and at scale (see `docs/acquisition.md`). PetScan + official Getty/Pleiades dumps cover the rest; generic HTML scraping only as a pluggable last-resort adapter. The project does not aim to *beat* Wikidata — it compiles, links, and exports comprehensive datasets *from* it. |
| Implementation stack | **Python** | Best ecosystem: `mwparserfromhell`, `pywikibot`, `SPARQLWrapper`, `neo4j`, `rdflib`, `pandas`, `pyswip`. |
| Symbolic-logic target | **SWI-Prolog + Soufflé** | SWI-Prolog for interactive research querying; Soufflé for high-performance bulk Datalog. |
| Build decomposition | **Six Ralphy tasklists** | One `prd.json` per subsystem, run in dependency order. |

## 3. Reuse vs. build (from prior-art research — see `docs/prior-art.md`)

**Reuse (don't reinvent):**
- **Wikidata** — the project's primary raw-data backbone, ingested two ways: the **SPARQL Query Service** (`query.wikidata.org/sparql`, native TSV/CSV/JSON/GeoJSON) for live queries, and the **bulk JSON dump** (`latest-all.json.gz`) for offline, rate-limit-free, full-scale class extraction with rich per-entity hydration. Dump-sourced and SPARQL-sourced records share one canonical schema, so a category can switch `source.type` with no downstream change.
- **PetScan** — category-tree traversal + WDQS combination, native TSV export; the scraping front-end.
- **mwparserfromhell** — residual infobox/wikitable parsing.
- **Getty AAT/TGN/ULAN** (ODC-By, monthly N-Triples dumps — *no* live SPARQL) — vocabulary anchors for entity normalization.
- **Pleiades** (JSON/CSV/RDF, already cross-linked to Nomisma/Wikidata/EDH/MANTO) — ancient-world dataset + the proven model for our cross-domain network.
- **Neo4j import stack** — `neo4j-admin import` (bulk seed), `LOAD CSV` (incremental), **APOC export-to-CSV** (reverse trip).

**Build (the genuine gap):**
- The **TSV-first canonical schema** and **entity-resolution layer** that turns heterogeneous sources into one coherent tabular model.
- The **cross-dimensional ontology + link inference** (temporal/geographic/linguistic/genetic) — nobody offers this across domains; Pleiades does it only for the ancient world.
- The **lossless TSV ↔ Neo4j round-trip** (existing tools import *or* export; none guarantee a faithful round-trip against a fixed TSV schema).
- The **Prolog/Datalog exporter** — least-charted path; original engineering (leads: Nemo, VLog, RDFox, RDFlog theory).
- The **orchestration layer** that runs categories at scale with provenance, caching, dedup, and QA.

**Known research gaps we design around:**
1. The Datalog/Prolog export path returned **zero verified claims** — treat as original work.
2. The **linguistic** and especially **genetic** dimensions have **no confirmed open structured sources** yet — a dedicated source-discovery effort is folded into Tasklist 3.

## 4. Architecture (data flow)

```
                          ┌─────────────────────────────────────────────┐
                          │  ACQUISITION (Tasklist 1)                     │
  category spec ────────▶ │  Wikidata SPARQL · PetScan · dumps ·          │
  (YAML)                  │  mwparserfromhell · generic HTML (fallback)   │
                          └───────────────┬───────────────────────────────┘
                                          │ raw rows + provenance
                                          ▼
                          ┌─────────────────────────────────────────────┐
                          │  NORMALIZATION (Tasklist 2)                   │
                          │  canonical TSV schema · entity resolution ·   │
                          │  dedup · Getty/Wikidata id reconciliation     │
                          └───────────────┬───────────────────────────────┘
                                          │ canonical node + edge TSVs
                          ┌───────────────┼───────────────────────────────┐
                          ▼               ▼                                ▼
        ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
        │ ONTOLOGY + LINKING   │ │ NEO4J CONVERTER       │ │ DATALOG EXPORTER      │
        │ (Tasklist 3)         │ │ (Tasklist 4)          │ │ (Tasklist 5)          │
        │ temporal/geo/ling/   │ │ TSV ⇄ graph, lossless │ │ TSV → .pl / .dl facts │
        │ genetic edges        │ │ round-trip            │ │ + rules + queries     │
        └──────────────────────┘ └──────────────────────┘ └──────────────────────┘
                          ▲
                          │ all coordinated by
                          ┌─────────────────────────────────────────────┐
                          │  ORCHESTRATION + SEED CORPUS (Tasklist 6)     │
                          │  job runner · scheduling · QA · seed runs ·   │
                          │  catalog · CLI                                │
                          └─────────────────────────────────────────────┘
```

The **canonical TSV schema** (`docs/data-model.md`) is the contract every subsystem
agrees on. Neo4j header conventions (`:ID`, `:LABEL`, `:START_ID`, `:END_ID`,
`:TYPE`, typed property columns) are adopted directly so Neo4j import is near-free
and reversible.

## 5. The six Ralphy tasklists

Run in priority order; each is a self-contained `prd.json` under `ralph/`.

| # | Tasklist | Directory | Depends on |
|---|---|---|---|
| 1 | Core acquisition engine | `ralph/01-acquisition/` | — |
| 2 | Canonical TSV schema + entity resolution | `ralph/02-schema-entity-resolution/` | 1 |
| 3 | Ontology & cross-dimensional linking | `ralph/03-ontology-linking/` | 2 |
| 4 | Neo4j bidirectional converter | `ralph/04-neo4j-converter/` | 2 |
| 5 | Prolog/Datalog exporter | `ralph/05-datalog-exporter/` | 2, 3 |
| 6 | Orchestration, seed corpus & QA | `ralph/06-orchestration-seedcorpus/` | 1–5 |

See `ralph/README.md` for how to execute them with Ralphy.

## 6. Repository layout (target)

```
culture-scrape/
├── PLAN.md                       # this file
├── docs/
│   ├── prior-art.md              # research synthesis + citations
│   └── data-model.md             # canonical TSV schema + ontology spec
├── ralph/
│   ├── README.md                 # how to run the 6 tasklists
│   ├── 01-acquisition/prd.json
│   ├── 02-schema-entity-resolution/prd.json
│   ├── 03-ontology-linking/prd.json
│   ├── 04-neo4j-converter/prd.json
│   ├── 05-datalog-exporter/prd.json
│   └── 06-orchestration-seedcorpus/prd.json
└── src/culturescrape/            # created by the Ralphy runs
    ├── acquire/                  # source adapters (Tasklist 1)
    ├── schema/                   # canonical model + entity resolution (Tasklist 2)
    ├── ontology/                 # dimensions + link inference (Tasklist 3)
    ├── neo4j/                    # converter (Tasklist 4)
    ├── datalog/                  # Prolog/Datalog exporter (Tasklist 5)
    └── orchestrate/              # job runner + CLI (Tasklist 6)
```
