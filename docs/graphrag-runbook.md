# GraphRAG runbook — node embeddings, vector index & hybrid retrieval (Phase 5.1)

> **DVC was removed** (flatten Phase 0). Every `dvc pull` / `dvc add` /
> `dvc push` below is stale: those trees are plain git-ignored build outputs
> now — regenerate them instead, and skip any "re-pin" step. Recorded DVC
> md5s are historical provenance labels, not fetchable references.
> Rationale + how to re-enable versioning: `docs/artifact-versioning.md`.

Semantic search over the shared culture-scrape graph: every node's
name + aliases + description is embedded locally with a sentence-transformers
model, the vectors land in a **Neo4j 5 native vector index**, and a hybrid
retriever turns a free-text query into a self-contained subgraph (vector top-k →
neighborhood expansion) ready to ground an LLM answer.

This is **Phase 5.1** of the neurosymbolic roadmap. It underpins the KGQA
evaluation (US-004) and the grounded training-data synthesis (US-002/US-003 — the
multi-hop KGQA dataset composition + held-out eval split are documented in
[`kgqa-dataset.md`](kgqa-dataset.md)).

Three moving parts:

| Layer | Where | Purpose |
| --- | --- | --- |
| Embedder + index build | `culturescrape.neo4j.vector_index` (CLI `graphrag-index`) | the **repeatable** build step |
| Hybrid retriever + `/api/retrieve` | `culturescrape.explorer.retrieval` + `explorer/app.py` | query-time retrieval over the sidecar |
| `/api/graph/retrieve` proxy | `server/routes/graph.ts` → `culturescrape-client.ts` | the browser-facing, gated proxy |

## 0. Prerequisites

1. **The graph stack is up** (Neo4j 5 + APOC via the `graph` docker profile) and
   the corpus is loaded. See `core/docs/convergence-build.md`
   §"Load the corpus into Neo4j" — in short, from the repo root:

   ```bash
   # bring up Neo4j pointed at the built export
   CULTURESCRAPE_CORPUS=/corpus docker compose up -d neo4j
   # load the canonical TSV corpus into it (incremental, MERGE-based)
   cd core
   uv run culturescrape to-neo4j ../../export/culturescrape --mode loadcsv
   ```

2. **The `graphrag` extra is installed** (sentence-transformers + torch — heavy,
   kept out of the slim sidecar image). Install it where the index build runs:

   ```bash
   cd core
   uv sync --extra graphrag          # or: pip install 'culturescrape[graphrag]'
   ```

   The module and all its pure helpers import fine **without** the extra; only the
   actual embed step needs it. When it is absent every retrieval path degrades to
   the 503 "unavailable" contract instead of raising.

3. **Neo4j connection settings** are resolvable in the environment the CLI/sidecar
   read (`NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` — see `.env.example`).

## 1. Build the index (the repeatable step)

One idempotent command embeds every node and (re-)creates the native vector index
over the embeddings:

```bash
cd core
uv run culturescrape graphrag-index
# → embedded 6123 of 6140 node(s) (dim 384) and built vector index
#   'entity_embedding' (cosine)
```

Flags (all optional, sensible defaults):

| Flag | Default | Notes |
| --- | --- | --- |
| `--model` | `all-MiniLM-L6-v2` | any sentence-transformers model; 384-dim, CPU-friendly |
| `--index-name` | `entity_embedding` | the native vector index name |
| `--similarity` | `cosine` | `cosine` or `euclidean` |
| `--batch-size` | `256` | nodes embedded + written per round-trip |

Idempotency: nodes are embedded first (so the index is created against the model's
**true** dimension, read off the model after the first batch loads), each batch is
written with `db.create.setNodeVectorProperty`, and the `CREATE VECTOR INDEX … IF
NOT EXISTS` DDL is safe to re-run. Re-running refreshes embeddings and leaves one
index. Nodes with entirely blank name/aliases/description are skipped (nothing
meaningful to embed).

Re-run it after any corpus reload that adds/changes nodes.

## 2. Retrieval endpoints

Once the index exists, hybrid retrieval is served two ways:

**Sidecar (Python, port 8800):** `GET /api/retrieve?q=<text>&k=<int>&depth=<int>`
— embeds the query with the same local model, pulls the top-`k` nearest nodes from
the vector index, and expands each to `depth` hops, returning the seeds (with
similarity scores) plus the self-contained subgraph. `k` is clamped to 1..25,
`depth` to 0..4.

**pinakes proxy (browser-facing):** `GET /api/graph/retrieve?q=&k=&depth=`
(`server/routes/graph.ts`). The browser only talks to the pinakes origin; this
proxies to the sidecar via the typed `culturescrape-client.ts` (`retrieve`),
validating the payload with zod at the boundary.

Both degrade gracefully (the established `/api/graph/*` contract):

- **Empty query** → `200 { query:"", seeds:[], nodes:[], edges:[] }`, no sidecar call.
- **GraphRAG unavailable** (embedding extra absent, Neo4j unreachable, sidecar down,
  or the sidecar disabled via `CULTURESCRAPE_ENABLED=false`) → **`503
  { available:false }`**. This is the feature gate: retrieval simply reports itself
  unavailable rather than crashing the request.
- **Malformed upstream body** → `502 { available:true }`.

Example success payload (abridged):

```jsonc
{
  "query": "bread of the mediterranean",
  "available": true,
  "backend": "neo4j",
  "index": "entity_embedding",
  "k": 5, "depth": 1,
  "seeds": [ { "csid": "cs:dish:paella", "name": "Paella", "label": "Dish", "score": 0.91 } ],
  "nodes": [ { "csid": "cs:dish:paella", "name": "Paella", "label": "Dish" }, … ],
  "edges": [ { "source": "cs:dish:paella", "target": "cs:place:valencia",
               "type": "ORIGINATES_IN", "dimension": "geographic" } ]
}
```

## 3. Retrieval quality spot-check

With the stack up and the index built, run these representative queries and confirm
each returns a coherent, on-topic subgraph. The corpus is cross-domain (languages,
cultures, dishes, sites, deities, …), so a good retriever surfaces semantically
related nodes even when the query shares no exact token with any node name.

```bash
# k example queries against the running sidecar (or swap /api/retrieve on :8800
# for /api/graph/retrieve on the pinakes origin):
curl -s 'http://localhost:8800/api/retrieve?q=indo-european+homeland&k=5&depth=1' | jq '{seeds:[.seeds[].name], nodes:(.nodes|length)}'
curl -s 'http://localhost:8800/api/retrieve?q=bronze+age+aegean+palace+culture&k=5&depth=1' | jq '{seeds:[.seeds[].name]}'
curl -s 'http://localhost:8800/api/retrieve?q=fermented+staple+foods&k=5&depth=1' | jq '{seeds:[.seeds[].name]}'
curl -s 'http://localhost:8800/api/retrieve?q=sky+father+deity&k=5&depth=1' | jq '{seeds:[.seeds[].name]}'
curl -s 'http://localhost:8800/api/retrieve?q=tonal+languages+of+east+asia&k=5&depth=1' | jq '{seeds:[.seeds[].name]}'
```

What to look for (illustrative — exact hits track the current corpus):

| Query | Expected seed shape | Subgraph |
| --- | --- | --- |
| `indo-european homeland` | Proto-Indo-European / Yamnaya / steppe cultures | family/lineage edges to daughter languages |
| `bronze age aegean palace culture` | Minoan / Mycenaean civilizations | `located-in` Crete/Greece, contemporary-with edges |
| `fermented staple foods` | dishes/ingredients (bread, cheese, fish sauces) | `originates-in` place edges |
| `sky father deity` | Zeus / Dyaus / Jupiter | `syncretized-with` cross-pantheon edges |
| `tonal languages of east asia` | Sino-Tibetan / Tai languages | `cognate-with` / family edges |

A query whose top seed is off-topic, or an empty subgraph for a query that clearly
matches corpus entities, signals either a stale index (re-run step 1) or a corpus
that hasn't been loaded into Neo4j.

> **Note:** the spot-check requires the live graph stack (Neo4j + the embedding
> extra). The endpoint **contract** — success shape, empty-query short-circuit, and
> every unavailable/ malformed state — is covered offline by
> `core/tests/test_retrieval.py` /
> `tests/test_vector_index.py` (Python) and `server/routes/graph.test.ts` /
> `server/services/culturescrape-client.test.ts` (TS), which run in CI with no live
> Neo4j and no model download.

## 4. Where the pieces live

- Embedder + index DDL/build: `core/src/culturescrape/neo4j/vector_index.py`
- Live vector query (`db.index.vector.queryNodes` + expansion): `…/explorer/live.py` (`Neo4jLive.vector_retrieve`)
- Hybrid retriever + endpoint gating: `…/explorer/retrieval.py`, `…/explorer/app.py` (`/api/retrieve`)
- CLI subcommand: `…/cli.py` (`graphrag-index`)
- TS proxy + typed client: `server/routes/graph.ts` (`/api/graph/retrieve`), `server/services/culturescrape-client.ts` (`retrieve`)
