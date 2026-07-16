# Civilizations Neo4j load & smoke query (US-004)

> **Historical intermediate snapshot.** This document records the *first* civilizations
> Neo4j load (US-004) and its then-current export counts (**5,432 nodes / 5,526 edges**,
> 7 edge types). Those numbers are frozen at that point in time and have since moved: the
> live export is now **6,835 nodes / 5,836 edges across 8 edge types** (see
> [`docs/culturescrape-export-manifest.json`](./culturescrape-export-manifest.json), the
> authoritative live snapshot). The **procedure** below (MERGE-on-`csid`, idempotent
> LOAD CSV, the docker-compose Neo4j additions) is still current and reusable; only the
> inline counts are a period record, not a live figure. See also the csid-migration note
> just below. For the canonical Phase-0 status and the fork policy, see
> [`../NEUROSYMBOLIC_ROADMAP.md`](../NEUROSYMBOLIC_ROADMAP.md) and
> [`docs/culturescrape-fork-policy.md`](./culturescrape-fork-policy.md).

The expanded civilizations (`lexicons/civilizations.tsv`, 170 rows after US-003) loaded
into the live Neo4j graph via the incremental, idempotent `culturescrape to-neo4j
--mode loadcsv` path, so the running app queries real breadth. The load is `MERGE`-on-`csid`
(never `CREATE`) behind an `Entity.csid` uniqueness constraint plus per-label constraints/
indexes, so re-running it does not duplicate nodes or relationships.

> **csid migration (US-005).** This snapshot predates QID-anchored ids. The export now
> mints `cs:<type>:<QID>` for any row with a non-blank `wikidata_qid` (only rows without a
> QID keep `cs:<type>:<pinakes-id>`; see `shared/canonical-schema.json` `idScheme`).
> Because the load `MERGE`s on `csid`, the first load after this change **re-keys** every
> QID-bearing node onto its new csid rather than updating the old pinakes-id-anchored
> node. To migrate an already-populated graph, wipe and reload from the fresh export (the
> load is idempotent, so a clean reload is the supported path) rather than merging on top of
> the old ids — otherwise the pre-migration nodes are orphaned under their stale csids.

## What ran

The corpus is the canonical export of the source-of-truth lexicons (which now carry the 170
civilizations as 340 `:Culture` nodes — the extra rows are the other culture lexicons that
also map to `:Culture`):

```bash
# 1. Refresh the canonical export (gitignored export/culturescrape/{nodes,edges}/*.tsv)
npx tsx scripts/export-for-culturescrape.ts
#    → Exported 5432 nodes (17 types) + 5526 edges (7 types)

# 2. Bring up Neo4j with APOC + absolute file:// CSV import (see docker-compose.yml)
docker compose up -d neo4j          # `graph` profile; healthy in ~12s (APOC auto-fetched)

# 3. Incremental, idempotent LOAD CSV against the running DB
cd packages/culture-scrape
export NEO4J_URI='bolt://localhost:7687' NEO4J_USER='neo4j' NEO4J_PASSWORD='pinakes'
uv run culturescrape to-neo4j ../../export/culturescrape --mode loadcsv
#    → applied 37 constraint/index statement(s) and ran 24 LOAD CSV statement(s)  (~19s)
```

### docker-compose Neo4j additions this enabled (`docker-compose.yml`, `neo4j` service)

The stock `neo4j:5` service could **not** run the `loadcsv` path. This story wired it:

- `NEO4J_PLUGINS: '["apoc"]'` — the loader uses `apoc.create.addLabels` (node `:LABEL`
  cells) and `apoc.merge.relationship` (data-driven `:TYPE` can't be `MERGE`'d in core Cypher).
- `NEO4J_dbms_security_procedures_unrestricted` / `_allowlist: "apoc.*"` — permit those procs.
- `NEO4J_dbms_security_allow__csv__import__from__file__urls: "true"` + a read-only bind mount
  `${PWD}:${PWD}:ro` + `NEO4J_server_directories_import: "/"` — so the absolute `file://<host
  path>` URLs the loader emits (`Path.resolve().as_uri()`) resolve to the real files inside
  the container. Setting the import root to `/` lifts the default `import/`-dir jail without
  disabling the file-URL guard.

## Smoke query — node counts by label

The documented smoke query is `culturescrape neo4j-counts` (= `cypher/node-counts-by-label.cypher`
`MATCH (n) UNWIND labels(n) AS label RETURN label, count(*)`). `:Culture` is the civilizations
label; there is no dedicated `:Culture` cypher file because `Culture` is not a relation
domain/range in the schema registry (the query-lint's `DEFINED_LABELS`), so the generic
label-count query is the smoke check.

```
node counts by label (total 5432):
  Entity: 5432
  ...
  Culture: 340        ← civilizations, target 150+  ✓
  ...
edge counts by type (total 1931):
  DESCENDS_FROM: 1551 / SYNCRETIZED_WITH: 182 / INFLUENCED_BY: 97 / BORROWED_FROM: 50 / ...
```

Provenance landed with the expanded rows — the 81 civilizations added in US-003 carry their
Wikidata QID and `confidence`:

```cypher
MATCH (c:Culture) WHERE c.wikidata_qid <> '' RETURN count(c);   // → 81
MATCH (c:Culture) WHERE c.wikidata_qid <> '' RETURN c.name, c.wikidata_qid, c.confidence LIMIT 3;
// "Ancestral Puebloans" Q478805 1.0 / "Ancient Crete" Q4752820 1.0 / "Ancient India" Q3149991 1.0
```

## Idempotency

Re-running `to-neo4j --mode loadcsv` a second time (same constraints via `IF NOT EXISTS`,
same `MERGE`-on-`csid` load) left the graph unchanged:

| metric | after 1st load | after 2nd load |
| --- | --- | --- |
| total nodes (`Entity`) | 5432 | 5432 |
| `:Culture` nodes | 340 | 340 |
| total edges | 1931 | 1931 |

## Reproduce

`docker compose up -d neo4j` → `npx tsx scripts/export-for-culturescrape.ts` → the
`to-neo4j --mode loadcsv` + `neo4j-counts` commands above. Corpus (`export/culturescrape`)
and the graph volume are regenerable and gitignored; only `docker-compose.yml` and this
doc are committed. See the roadmap §15 and `packages/culture-scrape/docs/convergence-build.md`.
</content>
