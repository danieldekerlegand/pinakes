# The web explorer: browse a built corpus

`pinakes_engine serve` launches a small, **read-only** web app over a corpus you
have already built. It reads the pipeline's existing outputs — the canonical
node/edge TSV plus `catalog.json`, `metrics.json`, `qa.json` and the per-category
QA reports ([`docs/storage.md`](storage.md)), the Neo4j export
([`docs/neo4j.md`](neo4j.md)), and the Datalog programs and example queries
([`docs/datalog.md`](datalog.md)) — and never writes to any of them. It is a lens
on the corpus, not another stage of the pipeline.

Every route below is exercised offline by `tests/test_explorer_smoke.py`, which
drives the app with FastAPI's TestClient against the fixture corpus under
`tests/fixtures/explorer-corpus/`, so this walkthrough cannot drift from the app.

## Install and launch

The explorer lives behind the optional `gui` extra (FastAPI + Uvicorn + Jinja2;
Cytoscape.js loads from a CDN, so there is no JavaScript build step):

```sh
pip install -e ".[gui]"
```

Point `serve` at either a **job output root** (`out/<job>/`, which carries the
catalog and per-category QA) or a bare **corpus dataset** (a directory with
`nodes/` and `edges/`). To follow along without a network fetch, serve the
shipped fixture corpus:

```sh
pinakes_engine serve tests/fixtures/explorer-corpus
# serving tests/fixtures/explorer-corpus at http://127.0.0.1:8000
```

It binds `127.0.0.1:8000` by default; override with `--host` / `--port`. Open the
URL it prints and you land on the overview. If the `gui` extra is missing the
command says so and exits without a traceback.

## The views

Every page carries the same nav bar, so each view is one click from the next:
**Overview · Search · Tables · Completeness · Metrics · Graph · Neo4j · Datalog**.

### Overview — `/`

The landing page names the corpus source and reports its size: node count, edge
count, and how many distinct `:LABEL` sets appear. It is the jumping-off point to
every other view.

### Tables — `/nodes` and `/edges`

`/nodes` paginates the canonical node TSV (50 rows per page) with its real
headers (`csid:ID`, `:LABEL`, `name`, provenance columns, …). Filter by label
with `?label=Place`, or free-text search names and csids with `?q=lima`. Every
csid cell deep-links to that node's detail page.

`/edges` does the same for the edge TSV: filter by relationship with
`?type=LOCATED_IN`, and follow either endpoint to its node detail.

`/nodes/{csid}` is the per-entity detail page — every canonical column (including
provenance), the outgoing and incoming edges with the entity on the other end,
and deep-links that pivot the same entity into the Graph, Neo4j, and Datalog
views (see [Deep links](#deep-links) below). An unknown csid returns 404.

### Search — `/search`

One box across every node file. `?q=ceviche` matches on name, csid, or Wikidata
QID, ranking exact hits ahead of substrings; each result deep-links to the node
detail and to its graph neighborhood. With no query the form renders on its own.

### Completeness — `/completeness`

A per-category scraping dashboard built from `catalog.json` and the per-category
QA reports. Each category is graded **complete**, **incomplete**, **failed**, or
**never run**, with its node/edge counts, failed QA gates, and last run. Filter
by `?status=failed` and sort by `?sort=nodes`. Every row links to its action page.

`/completeness/{category_id}` is the operator playbook for one category: the
copy-pasteable commands to rebuild (`pinakes_engine run jobs/…`), scheduled-refresh
(`pinakes_engine run --since 7d …`), and package it, the locations of its Neo4j and
Datalog exports and manifest (flagged when not yet built), and the last
scheduled-refresh decision from `refresh-log.jsonl`. It needs a job root; a bare
corpus has no catalog, so this route returns 404.

### Metrics — `/metrics`

Graph connectivity from `metrics.json`: node and edge counts, edges per node,
connected components, and the largest-component fraction, with edges broken down
by ontology dimension (geographic, temporal, …) and by `:TYPE`. A corpus whose
largest component falls below the fragmentation threshold (0.9 by default,
overridable with `?threshold=0.3`) is flagged **Fragmented**; otherwise
**Well-connected**. When `metrics.json` is absent or unreadable the view says so
rather than erroring.

### Graph — `/graph`

An interactive neighborhood view rendered with Cytoscape.js (loaded from a CDN).
`?csid=cs:place:lima` seeds the canvas on one entity; with no csid it seeds from
the first node so it always draws. The page fetches `/api/graph/{csid}?depth=N`
(depth clamped to 0–4), a JSON payload of Cytoscape elements where nodes carry
their primary `:LABEL` and edges carry their `:TYPE` and dimension for styling.
Edges are self-contained — both endpoints are always in the node set. The view
uses a live Neo4j when one is connected and otherwise falls back to the TSV.

### Neo4j — `/neo4j`

A Cypher console listing the shipped `cypher/*.cypher` example queries with their
descriptions and parameters. When `NEO4J_*` connection settings are present the
**Run query** button executes against the live property graph; otherwise the
console renders the queries and reports that no live database is configured. A
`?csid=` deep-link from a node detail focuses that entity, showing the by-csid
locator (`MATCH (n:Entity {csid: '…'}) RETURN n`) and a link back to the detail.
See [`docs/neo4j.md`](neo4j.md) for the import/export round-trip.

### Datalog — `/datalog`

A logic console over the exported program. It lists the shipped
`datalog/examples/*.pl` queries with their titles; selecting one
(`?query=ancestry-of-dish`) shows its source and a **Run** button, and a free-text
goal box accepts ad-hoc queries. With [SWI-Prolog](https://www.swi-prolog.org/)
(`swipl`) on your path, `?run=1` projects the corpus to facts and runs the goal,
rendering the result rows; without it, goals are linted offline and the page
explains that `swipl` was not found. See [`docs/datalog.md`](datalog.md) for the
fact shape and rule library.

## Deep links

The detail page binds the three representations together: from any node you can
jump to its Graph neighborhood, its Neo4j locator, and a pre-filled Datalog goal,
each keyed off the shared `csid`. Search results, the graph "back to detail" link,
and the edge tables all use the same percent-encoded csid links, so you can pivot
one entity across TSV, Neo4j, and Datalog without copying ids by hand.

## See also

- [`docs/quickstart.md`](quickstart.md) — build the corpus the explorer reads.
- [`docs/storage.md`](storage.md) — the corpus artifacts and what's versioned.
- [`docs/neo4j.md`](neo4j.md), [`docs/datalog.md`](datalog.md) — the two export
  targets the Neo4j and Datalog consoles open onto.
