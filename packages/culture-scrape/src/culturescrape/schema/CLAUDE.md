# schema/ — map → anchor → reconcile → dedup → edges

## `tsvio` — streaming reader (T-SR-US-002)

`open_rows(path) -> (columns, Iterator[Row])` is the streaming reader: it reads the
**header eagerly** (columns + any malformed-header `TsvError` surface on the call)
then yields one decoded `Row` per physical line, keeping the file open until the
iterator is drained. `read_rows` is now just the eager `list(open_rows(...))`
wrapper — same return shape, same fail-fast on a wrong cell count (the `list()`
drains it). Use `open_rows` for dump-scale files (the datalog projection does);
`read_rows` when you want the whole file. A physical `\n` is only ever a row
terminator (the writer escapes `\n`→`\\n` in values), and files are read in
universal-newline mode, so `_strip_eol` removing one trailing `\n` reproduces
`text.split("\n")` byte-for-byte.

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

## Gotcha: `LINGUASCRAPE_EDGE_TYPE_MAP` must cover EVERY exported edge `:TYPE`

`mapper.py`'s `LINGUASCRAPE_EDGE_TYPE_MAP` (identity for the five registered tokens,
folds for the LinguaScrape-specific ones — `ABSORBED_INTO→PART_OF`,
`SYNCRETIZED_WITH→VARIANT_OF`, `SPLIT_FROM→DESCENDS_FROM`) must list **every** edge
`:TYPE` the TS export can emit, or `_normalize_linguascrape` rejects the whole build
(`unknown LinguaScrape edge :TYPE '<TOKEN>'`). The export's edge vocabulary lives on
the TS side in `shared/canonical-schema.json` `edgeTypes[].type` — when a **new
canonical edge type** is added there (US-005 found `SPLIT_FROM` had been added to the
schema but never registered here, silently breaking the full rebuild since), add the
matching token to this map: identity if it names a registered ontology `:TYPE`
(`ontology/registry.py`), else fold onto the closest registered one. `SPLIT_FROM`
folds onto `DESCENDS_FROM` — the same home LinguaScrape's `evolved-into`/`gave-rise-to`
lineage edges already use; the direction is taken as-is from the source row
(`:START_ID`=source_id=ancestor), matching those siblings. The fixture-only
`test_convergence_build.py` won't catch a missing token if the fixture export lacks
that edge type — the **full** `jobs/linguascrape-full.yml` rebuild is the only thing
that exercises the live edge vocabulary. `test_linguascrape_ontology.py` pins that
every map value is registered + one fold assertion per token.

## Reconciling an acquired corpus against a lexicon (`lexicon_reconcile.py`)

`lexicon_reconcile.py` is the thin data layer that folds a domain acquired from
Wikidata into the corpus without duplicating what LinguaScrape already curates — it
wraps `reconcile.reconcile_linguascrape`'s offline cascade (it adds **no** matching
logic). Used by `scripts/reconcile_civilizations.py` (the civilizations pilot, US-002).

- **`read_corpus_nodes`** loads a built `<corpus>/nodes/<type>.tsv` as reconciler
  `Row`s: strips Neo4j header suffixes (`csid:ID`→`csid`), wraps `:LABEL` in a list,
  drops empty cells. **GOTCHA — it drops the overflow (`extra`) column.** A stitched
  corpus stores the merge-provenance JSON there, and that cell is *not* re-parseable in
  isolation (`_decode_overflow` → `JSONDecodeError`), so carrying it onto a reconciler
  row makes `_region`/the cascade blow up. The cascade never needs it — drop it.
- **`read_lexicon_nodes`** loads a raw `lexicons/*.tsv` as the *existing* side: mints a
  QID-free `csid` from the row `id` (alias-anchored) or name, tags the canonical
  `:LABEL`, and — only if a `region_column` is given — supplies the region blocking key
  via the row's overflow JSON (the canonical schema has no `region` column).
- **Stricter fuzzy floor.** Pass `fuzzy_threshold` well above the library default
  (0.85 → the module default 0.93) for cross-source name matching: a *wrong* merge
  silently corrupts a curated node (German Empire→Roman Empire fuzzes 0.88), whereas a
  missed match only surfaces a duplicate for triage. Prefer `new` over a bad merge.

## Determinism boundary

Node/edge **counts** and the `nodes_by_label`/`edges_by_type` fingerprint
(`orchestrate/manifest`) are deterministic. But the `linguascrape-export` adapter
stamps a blank `retrieved_at` with the ingestion wall-clock, so the *corpus bytes*
(hence a packaged tar.gz digest) are NOT reproducible across live builds — only the
committed fixture build (fixed `now()`) is byte-stable. See
`docs/convergence-build.md`.
