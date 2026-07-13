# orchestrate/ — blueprints → categories → job → corpus

The assembly layer: `generate.py` expands a blueprint into category specs (+ a job);
`runner.py` acquires+normalizes each category; `corpus.py` `build_corpus` stitches +
links + validates + exports the whole job into one corpus. A `Job` (`jobs.py`) is the
parsed `jobs/*.yml`; add a new job key by extending `_OPTIONAL_KEYS` + the `Job`
dataclass + a parser in `load_job` (mirror `min_component_fraction`).

## Building a merged, multi-source corpus — `merge.py` (US-004)

`build_corpus(job)` stitches **every category in the job** into one graph (same-`csid`
rows merge), and `csid` is QID-anchored, so a shared Wikidata entity reconciles across
sources for free. That is the whole trick behind a *merged* corpus: put dump categories
**and** a `linguascrape-export` category in one job. `merge.write_merged_job`
(CLI `culturescrape merge <bp…> --dump … --linguascrape <export> --job …`) assembles
exactly that — it reuses `generate` (dump mode) per blueprint and appends a
`linguascrape-export` category reading the export root (stored **absolute** so it
resolves regardless of run CWD). It sets `reconcile_shared_qids: true` on the job (see
below). Then `culturescrape run <job>` builds it fully offline.

- **Scale gotcha (US-003 still applies):** each dump category full-scans the whole
  slice, so acquire wall-clock ≈ N_categories × slice size. On the reference merge the
  LinguaScrape ingest (12k rows) + 17 dump scans dominated (345 s wall, 192 MB peak);
  memory stays streaming-bounded, throughput is the thing US-007 must call out.
- Use **absolute** `--dump`/`--index`/`--linguascrape` paths — the dump adapter and the
  linguascrape-export adapter resolve their path relative to the run CWD, not the job.

## Identity preservation — collapse same-QID nodes across types (US-004)

`csid` is `cs:<node-type>:<QID>`, so the **same** Wikidata entity typed differently by
two sources gets two csids and the per-`csid` stitch cannot merge them — the corpus then
carries duplicate identities and the `duplicate rate` QA gate (max 0) trips. Seen on the
reference merge: a deity typed `Concept` by the dump vs `Deity` by LinguaScrape; a script
typed `Language` vs `WritingSystem`; a linker-minted `place` hub for a QID LinguaScrape
curates as a `Culture`. `ontology/reconcile_qid.reconcile_shared_qids` fixes it: group
nodes by normalized QID, merge each group via the tested `schema.merge.merge_rows` (which
unions labels/aliases/provenance) and redirect edges through `merged_csid_remap` (drop
dangling / self-loop, like `pipeline._redirect_edges`). It runs in `build_corpus` **after
the linkers** (so it also collapses linker-minted hub collisions), gated on the job's
`reconcile_shared_qids` flag.

- **QID-only on purpose.** Do NOT feed the whole stitched graph to `merge_rows` — it also
  clusters on fuzzy `(name,lang,label)` and would over-merge distinct entities sharing a
  name. Group by QID first; only same-QID groups are merged. Nodes with no QID pass
  through untouched.
- **Opt-in, not global.** The flag is `False` by default and only the merged job sets it,
  so existing single-source builds (linguascrape-full, seed-corpus, food-drink) stay
  byte-identical — a global QID-collapse could silently move their committed manifest
  counts. Keep it opt-in.

## Reconciling the built corpus against a curated lexicon

Use `schema.lexicon_reconcile.reconcile_corpus_against_lexicon(node_tsv, lexicon, …)` and
render with `render_markdown`. **GOTCHA — the `label` argument must be the corpus node
type's canonical label**, not a superclass: the offline cascade blocks on the primary
label, so reconciling `deity.tsv` with `label="Concept"` yields 0 matches while
`label="Deity"` yields the real 198/221 (the LinguaScrape deities re-match their own
rows). Pass `region_column="region"` only for node types whose lexicon has a region
column (languages do; deities don't). Built corpora are gitignored, so commit the
reconciliation **numbers** (a docs report) rather than a regenerable artifact.
