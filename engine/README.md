# pinakes-engine

A TSV-first, multi-domain aggregation engine for cultural, socio-historical, and
linguistic data. It scrapes sweeping categories ("every Peruvian dish", "every
battle of the American Civil War"), normalizes them into one canonical tabular
schema, links them across temporal / geographic / linguistic / genetic
dimensions, and round-trips losslessly to **Neo4j** while exporting to
**SWI-Prolog / Soufflé Datalog**.

## Quickstart

New here? **[`docs/quickstart.md`](docs/quickstart.md)** takes you from a clean
checkout to a graph you can query in both Neo4j and Prolog — install, define a
category, run the pipeline, import to Neo4j, export to Datalog, and run an example
query.

The whole pipeline runs from a single CLI:

```sh
pip install -e ".[dev,neo4j]"
pinakes_engine run jobs/seed-corpus.yml      # acquire → normalize → link → export
```

## How it works

A **category** (a YAML spec under [`categories/`](categories/)) is the unit of
acquisition. Each becomes canonical node/edge TSV; categories are stitched into
one graph through shared entities and cross-dimensional edges, then exported.

**Wikidata is the project's primary raw-data backbone.** The goal isn't to beat
Wikidata but to compile, link, and export comprehensive datasets from it. A
category can source its entities live from the SPARQL Query Service or from
Wikidata's **bulk JSON dump** ingested offline, rate-limit-free, and at scale —
the same canonical schema either way, so switching `source.type` changes nothing
downstream. See [`docs/acquisition.md`](docs/acquisition.md) for obtaining a dump,
building the membership index, rich hydration, and dump-backed enrichment.

The [`blueprints/`](blueprints/) directory holds a library of verified domain
blueprints — visual art, architecture, civilizations, conflicts, myth & religion,
food & drink, language, music, sports & games, science & technology, material
culture, and living traditions — twelve domains expanding into 119 categories of live-verified
Wikidata classes. Generate and run a whole domain with
`pinakes_engine generate blueprints/<domain>.yml --out categories --job jobs/<domain>.yml`;
see [`docs/blueprints.md`](docs/blueprints.md) for the catalog and authoring guide.

```
category spec → acquire → normalize → link → ┬→ Neo4j (property graph)
                                             ├→ Datalog (.pl / .dl facts + rules)
                                             └→ canonical TSV (portable, git-diffable)
```

See [`PLAN.md`](PLAN.md) for the master plan and the full data-flow architecture,
and [`docs/data-model.md`](docs/data-model.md) for the canonical TSV schema that
every subsystem agrees on.

## Documentation

- [`docs/quickstart.md`](docs/quickstart.md) — zero to a queryable graph.
- [`PLAN.md`](PLAN.md) — vision, locked decisions, and architecture.
- [`docs/data-model.md`](docs/data-model.md) — the canonical TSV schema and ontology spec.
- [`docs/blueprints.md`](docs/blueprints.md) — the domain blueprint catalog and how to author a new one.
- [`docs/prior-art.md`](docs/prior-art.md) — research synthesis and what we reuse vs. build.
- [`docs/storage.md`](docs/storage.md) — what's versioned vs. generated, and how corpora are published.
- [`docs/gui.md`](docs/gui.md) — the read-only web explorer (`pinakes_engine serve`).
- Subsystem guides: [`acquisition.md`](docs/acquisition.md),
  [`schema.md`](docs/schema.md), [`ontology.md`](docs/ontology.md),
  [`neo4j.md`](docs/neo4j.md), [`datalog.md`](docs/datalog.md),
  [`scheduling.md`](docs/scheduling.md).

## The build: six tasklists

The system is built as six [Ralphy](https://github.com/michaelshimeles/ralphy)
tasklists, run in dependency order — see [`ralph/README.md`](ralph/README.md) for
how to execute them.

| # | Tasklist | Directory | Depends on |
|---|---|---|---|
| 1 | Core acquisition engine | [`ralph/01-acquisition/`](ralph/01-acquisition/) | — |
| 2 | Canonical TSV schema + entity resolution | [`ralph/02-schema-entity-resolution/`](ralph/02-schema-entity-resolution/) | 1 |
| 3 | Ontology & cross-dimensional linking | [`ralph/03-ontology-linking/`](ralph/03-ontology-linking/) | 2 |
| 4 | Neo4j bidirectional converter | [`ralph/04-neo4j-converter/`](ralph/04-neo4j-converter/) | 2 |
| 5 | Prolog/Datalog exporter | [`ralph/05-datalog-exporter/`](ralph/05-datalog-exporter/) | 2, 3 |
| 6 | Orchestration, seed corpus & QA | [`ralph/06-orchestration-seedcorpus/`](ralph/06-orchestration-seedcorpus/) | 1–5 |

## Development

```sh
pip install -e ".[dev,neo4j]"
pytest          # tests
ruff check .    # lint
mypy            # types
```
