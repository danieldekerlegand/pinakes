# schema/ — map → anchor → reconcile → dedup → edges

The normalization pipeline (`pipeline.normalize_records`) turns raw acquisition
records into the canonical node/edge TSV family. Two paths:

- **generic** — `map_records → anchor → reconcile → merge_rows (dedup) →
  categorize_rows`. Edges are *built from the merged nodes* by `categorize_rows`,
  so they always reference surviving csids.
- **LinguaScrape export** (`_is_linguascrape_export`, `source.params.adapter ==
  "linguascrape-export"`) — the records already ship canonical `:LABEL`/`csid`/
  `:TYPE`, so `_normalize_linguascrape` only maps, splits nodes from edges, and
  dedups the nodes. **Its edges pre-exist**, so they do NOT automatically follow
  the dedup.

## Gotcha: dedup collapses csids — pre-existing edges must be redirected

`merge_rows` collapses duplicate nodes (same QID / Getty / `(name,lang,type)` /
fuzzy name) to **one primary csid per cluster**, dropping the losers. In the
LinguaScrape path an edge minted against a loser's csid would then **dangle** and
fail `validate` (breaking `neo4j-admin import` downstream) — this was a live-corpus
bug: e.g. two languages named the same collapse, and every `BORROWED_FROM` pointing
at the dropped csid orphaned. `_normalize_linguascrape` therefore calls
`_redirect_edges`, which rewrites each `:START_ID`/`:END_ID` through
`merge.merged_csid_remap(merged_nodes)` (`{lost_csid: primary_csid}`, read from the
`MERGE_KEY` record every survivor carries in its overflow JSON) and drops any edge
that still dangles or has become a self-loop. **If you add another path that keeps
pre-existing edges across a `merge_rows` call, redirect them the same way.**

## Determinism boundary

Node/edge **counts** and the `nodes_by_label`/`edges_by_type` fingerprint
(`orchestrate/manifest`) are deterministic. But the `linguascrape-export` adapter
stamps a blank `retrieved_at` with the ingestion wall-clock, so the *corpus bytes*
(hence a packaged tar.gz digest) are NOT reproducible across live builds — only the
committed fixture build (fixed `now()`) is byte-stable. See
`docs/convergence-build.md`.
