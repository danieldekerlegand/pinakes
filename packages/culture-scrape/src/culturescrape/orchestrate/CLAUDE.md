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

## Tiered trust / auto-admission — `tiers.py` (US-002)

A merged corpus is the auto-admission surface: QID-anchored **and** reference-backed
facts admit with their US-001 rubric confidence + a **tier label**, weaker acquired facts
quarantine, and `lexicons/*.tsv` are never written (auto-admission is a graph-corpus
policy, not a lexicon write). `classify_tier(row)` is a **pure** function of already-
canonical provenance columns (`source`, `wikidata_qid`, `source_url`) — so `tier` is NOT a
new TSV column (that would cascade into the neo4j/datalog schema + every committed
snapshot); it is *derived*, and recoverable from the same `source(Csid,Source)` Datalog
fact / Neo4j property that already exists. Tiers, most-to-least trusted: `curated`
(`source=linguascrape`, wins even with a QID/ref — human vetting is strongest),
`auto-admitted` (node with `wikidata_qid` AND `source_url`; edge with `source_url`),
`quarantine` (acquired but not both), `inferred` (`source` starts `inferred:` — linker
scaffolding). Runbook: `docs/tiered-trust.md`.

- **Opt-in via the job**, like `reconcile_shared_qids`: `Job.tiered_trust` (bool) +
  `Job.tier_gates` (per-tier `GateThresholds` overrides). Off by default, so single-source
  builds stay byte-identical. `culturescrape merge` bakes `tiered_trust: true` in (opt out
  with `--no-tiered`). When on, `build_corpus` writes `corpus/tiers.json` (composition-by-
  tier manifest — deterministic, content-only, same discipline as `manifest.json`) and
  `corpus/qa-tiers.json` (per-tier QA), and a per-tier gate violation fails the build under
  `fail_on_violation`.
- **Per-tier QA (`evaluate_tiers`) partitions rows by tier and reuses `qa.evaluate`.** The
  meaningful per-tier floors are **provenance + dedup + unreconciled** (auto-admitted must
  be fully sourced + QID-reconciled; quarantine has no floor — it is *awaiting* curation).
  **Dangling-edge / connectivity stay permissive per tier** — a curated edge legitimately
  points at a quarantined node, so `DEFAULT_TIER_GATES` sets BOTH `max_dangling_edge_rate`
  and `max_linguascrape_dangling_edge_rate` to 1.0; real dangling is caught by the whole-
  corpus gate. (The curated subset is all-LinguaScrape, so `qa.evaluate` appends the LS-
  scoped gates — remember to relax the LS dangling one too, not just the base one.)
- **`jobs._parse_tier_gates` imports `tiers.ALL_TIERS` lazily** (inside the fn) to avoid a
  `jobs`↔`tiers` top-level import order coupling: `tiers` imports the qa/manifest/metrics
  layer; `jobs` only needs the tier *names*.
- **Committed manifest** = `docs/tiered-corpus-manifest.json`, built from the
  `tests/fixtures/tiered/` corpus (spans every tier) and asserted by `tests/test_tiers.py`;
  regenerate via `manifest_for_tier_dataset(job, dir)` if the fixture moves.

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

## Incremental QID-keyed upsert — `incremental.py` (US-006)

`run_upsert(job, old_dump, new_dump, …)` refreshes a corpus without a full rebuild:
diff the two slices (`acquire/wikidata_diff`), resolve each changed QID to its
`wikidata-dump` category (index lookup, else a bounded two-pass scan — `_members_by_category`),
carve a **delta dump** of just the changed members, repoint each affected category at it
(`_repoint` swaps `path`, sets an `ids` allowlist, drops the `index` param — it fingerprints the
*old* dump), rebuild a **delta corpus**, and prove it MERGE-loads over the base to a fixed point
(`neo4j/merge_load.verify_upsert_load`). Because `csid` is QID-anchored, a re-exported entity
lands on the node it already occupies (in-place update, not a duplicate) — the corpus node/edge
counts are identical before and after.

- **`dataset_qids(corpus)`** recovers the QIDs a corpus holds via `schema/ids.csid_qid` (only
  QID-anchored csids surrender a QID; alias/name-anchored nodes are skipped) — this is how the
  plan grades which changes actually touch the corpus (`changed_in_corpus`/`removed_in_corpus`).
  **An upsert never deletes** — a removed QID is reported, not dropped.
- **The delta build relaxes floors on purpose** (`min_component_fraction=0.0`,
  `fail_on_violation=False`): a handful of entities won't self-connect, and its job is to produce
  the affected rows for an in-place MERGE, not to stand as a corpus. Drive it with a
  network-raising `adapter_factory` to prove the rebuild stays offline.
- **`sync-log.jsonl`** (`write_sync_log`/`last_sync_at`) is the entity-granularity twin of the
  `--since` refresh log — a scheduled sync reuses the `--since` window to skip too-frequent runs.
- **Test shape:** unit-test the plan/member/log logic on the committed dump fixture, then a full
  `run_upsert` on the fixture (always runs) + a `skipif`-gated real-slice smoke that edits one
  genuine entity's label. Same slice-resolution pattern as the other `*_dump_smoke` modules.

## Reconciling the built corpus against a curated lexicon

Use `schema.lexicon_reconcile.reconcile_corpus_against_lexicon(node_tsv, lexicon, …)` and
render with `render_markdown`. **GOTCHA — the `label` argument must be the corpus node
type's canonical label**, not a superclass: the offline cascade blocks on the primary
label, so reconciling `deity.tsv` with `label="Concept"` yields 0 matches while
`label="Deity"` yields the real 198/221 (the LinguaScrape deities re-match their own
rows). Pass `region_column="region"` only for node types whose lexicon has a region
column (languages do; deities don't). Built corpora are gitignored, so commit the
reconciliation **numbers** (a docs report) rather than a regenerable artifact.
