# Quickstart: zero to a queryable graph

This guide takes you from a clean checkout to a culture graph you can query in
both [Neo4j](neo4j.md) and [SWI-Prolog / Soufflé](datalog.md). The journey is the
pipeline from [`PLAN.md`](../PLAN.md): **define a category → acquire → normalize →
link → import / export → query.**

You'll demo acquisition on a real category, then use the small ready-made corpus
the repo ships (`datalog/examples/dataset`) to walk the back half of the pipeline
immediately — no live network fetch and no database required until you want one.

Every `pinakes_engine …` command below is exercised offline by the smoke test in
`tests/test_quickstart.py`, so the steps cannot drift from the tool.

## 1. Install

pinakes-engine is a Python package (≥ 3.11) and a member of the repo's uv
workspace. Clone the repo and let uv build the environment — one `uv sync` gets
the runtime deps, the `dev` dependency group (pytest/ruff/mypy) and the `gui` +
`neo4j` extras that group pulls in:

```sh
git clone https://github.com/your-org/pinakes.git
cd pinakes/engine
uv sync
```

On plain pip that is `python -m venv .venv && source .venv/bin/activate` followed
by `pip install -e ".[gui,neo4j]" --group dev` (pip ≥ 25.1). Prefix the commands
below with `uv run` (or activate the workspace `.venv` at the repo root).

Confirm the CLI is on your path — it's the single entrypoint for every stage:

```sh
pinakes_engine --help
```

Two stages reach outside Python: a live Neo4j needs the `neo4j` extra (installed
above) and connection settings (see [`docs/neo4j.md`](neo4j.md)); running a
Datalog query needs [SWI-Prolog](https://www.swi-prolog.org/) (`swipl`) or
[Soufflé](https://souffle-lang.github.io/) on your path. Everything up to the
export — acquire, normalize, link, validate — is pure Python.

## 2. Define a category

A **category** is the unit of acquisition: a well-defined set of entities
("every Peruvian dish") described by a small YAML spec. The repo ships several
under [`categories/`](../categories/); here is `categories/peruvian-dishes.yml`:

```yaml
id: peruvian-dishes
label: Dish;CulturalArtifact
description: Every Peruvian dish
source:
  type: wikidata-sparql
  query: |
    SELECT ?item ?itemLabel ?image WHERE {
      ?item wdt:P31 wd:Q746549 .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
    }
dimensions: [temporal, geographic, linguistic]
links:
  - type: ORIGINATES_FROM
    to: place
```

- `id` names the category and the files it produces.
- `label` is the `;`-separated Neo4j label set every node gets.
- `source.type` picks the adapter (`wikidata-sparql`, `petscan`, `dump`,
  `html`, …); the rest of `source` configures it.
- `dimensions` lists the axes the ontology will link this category on.

The full field reference is in [`docs/data-model.md`](data-model.md) under
"Category specification (input)". To write your own, copy one of the shipped
specs and change `id`, `source`, and `label`.

**Generating many at once.** Hand-writing one spec per class doesn't scale. A
*blueprint* ([`blueprints/example.yml`](../blueprints/example.yml)) declares the
defaults a whole domain shares once, then lists a one-line stub per category —
usually just an id, a gloss, and a Wikidata class id. Expand it into validated
specs (and a runnable job) with:

```sh
pinakes_engine generate blueprints/example.yml --out categories --job jobs/example.yml
```

Each stub names one source: `wikidata_class` (instance-of a class), `subclass_of`
(a transitive taxonomy), `query` (raw SPARQL), or `petscan` (a Wikipedia category
tree). This is the lever for growing the corpus to thousands of categories.

Generation is offline by default. Pass `--verify` to query the Wikidata Query
Service for each class stub's live entity count (P31 / P279+), record it as the
`# ~N` trailing comment the shipped blueprints carry, and refuse any class that
resolves to zero entities or does not exist — so a new domain never ships an
empty or broken category.

## 3. Run the pipeline

### The one command

`pinakes_engine run` drives a whole job — acquire → normalize → link → validate →
QA → export — and stitches every category into one connected corpus. The shipped
seed job spans five domains:

```sh
pinakes_engine run jobs/seed-corpus.yml
```

It fetches from the network, so it needs connectivity. When it finishes,
`out/seed-corpus/` holds the stitched `corpus/` (canonical TSV + `metrics.json` +
`qa.json`), a `corpus-neo4j/` import script, and a `corpus-datalog/` program. If
that's all you need, skip to [§6](#6-run-an-example-query); the sections below
unpack the same stages one command at a time.

### Stage by stage

**Acquire** one category's raw records (this is the step that hits the network):

```sh
pinakes_engine fetch categories/peruvian-dishes.yml --out out/raw
```

**Normalize** those raw records into the canonical TSV schema — typed node and
edge files with provenance:

```sh
pinakes_engine normalize out/raw/peruvian-dishes.jsonl \
    --category categories/peruvian-dishes.yml --out out/normalize
```

**Validate** that the result honors the schema contract (headers, id formats, no
dangling edges):

```sh
pinakes_engine validate out/normalize
```

From here on we switch to the ready-made sample corpus at
`datalog/examples/dataset` — a tiny, fully-linked culture graph (Peruvian dishes,
the places they come from, and the events around them) that ships in the repo so
you can see linking, import, export, and querying without a live fetch.

**Link** infers the cross-dimensional edges (temporal / geographic / linguistic /
genetic) that turn disjoint categories into a navigable network, and reports
connectivity:

```sh
pinakes_engine link datalog/examples/dataset --out out/linked
```

## 4. Import to Neo4j

Turn the corpus into a property graph. In the default `admin` mode the converter
writes a `neo4j-admin import` script (and transformed copies) with no live
database — ideal for a first bulk load:

```sh
pinakes_engine to-neo4j datalog/examples/dataset --out out/neo4j
```

Run the generated `out/neo4j/neo4j-admin-import.sh` against a stopped Neo4j to
seed it, or use `--mode loadcsv` to upsert into a running database (requires the
APOC plugin and `NEO4J_*` connection settings). The shipped Cypher queries under
[`cypher/`](../cypher/) — region, contemporaries, language-family, shortest-path —
run as-is against the imported graph. Full operator guide, the round-trip back to
TSV (`from-neo4j`), and the `csid` constraints are in
[`docs/neo4j.md`](neo4j.md).

## 5. Export to Datalog

Project the same corpus into a logic program for symbolic querying. `--rules`
attaches the shared inference-rule library (transitive closures, symmetric
relations); `--engine both` writes a SWI-Prolog `graph.pl` and a Soufflé
`graph.dl` side by side:

```sh
pinakes_engine to-datalog datalog/examples/dataset --engine both --rules --out out/datalog
```

The command prints a copy-pasteable load/run hint for each engine. The fact
shape, the rule library, and how atoms are quoted per dialect are documented in
[`docs/datalog.md`](datalog.md).

## 6. Run an example query

Four worked queries ship under [`datalog/examples/`](../datalog/examples/), each a
self-describing `.pl` file with a `main/0` entry point. Load one alongside the
`graph.pl` you just generated and run it in SWI-Prolog:

```sh
swipl -q -g main -t halt out/datalog/graph.pl datalog/examples/ancestry-of-dish.pl
```

This computes the full ancestry of a dish — the transitive closure of derivation
and influence — and prints:

```
cs:dish:tiradito
cs:dish:kinilaw
cs:dish:ceviche
```

Try `entities-within-region.pl`, `contemporaries-of-event.pl`, or
`shortest-influence-chain.pl` the same way, or open an interactive session with
`swipl out/datalog/graph.pl` and pose your own goals (e.g.
`?- within_region('cs:place:lima', X).`). The query catalog and the rules they
build on are in [`docs/datalog.md`](datalog.md).

## Where to go next

- [`PLAN.md`](../PLAN.md) — the master plan and the data-flow architecture.
- [`docs/data-model.md`](data-model.md) — the canonical TSV schema every stage agrees on.
- [`ralph/README.md`](../ralph/README.md) — the six tasklists that build the system.
- [`docs/acquisition.md`](acquisition.md), [`schema.md`](schema.md),
  [`ontology.md`](ontology.md), [`neo4j.md`](neo4j.md), [`datalog.md`](datalog.md),
  [`scheduling.md`](scheduling.md) — per-subsystem deep dives.
