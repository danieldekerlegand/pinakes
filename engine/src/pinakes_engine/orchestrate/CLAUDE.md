# orchestrate/ — blueprints → categories → job → corpus

The assembly layer: `generate.py` expands a blueprint into category specs (+ a job);
`runner.py` acquires+normalizes each category; `corpus.py` `build_corpus` stitches +
links + validates + exports the whole job into one corpus. A `Job` (`jobs.py`) is the
parsed `jobs/*.yml`; add a new job key by extending `_OPTIONAL_KEYS` + the `Job`
dataclass + a parser in `load_job` (mirror `min_component_fraction`).

## License-partitioned packaging — `package.py` (source-breadth US-005)

`package_corpus` now emits a `licenses` block in the release manifest so a shared corpus
**self-describes by licence** (share-alike sources — PHOIBLE, kaikki/Wiktionary — are in the
graph). It scans the per-record SPDX `license` column of every `corpus/nodes/*.tsv` (edges have
no `license`) into `records_by_license` `{SPDX: count}`, rolls that up by redistribution class
(`schema/license_class.py`: public-domain / attribution / share-alike / non-commercial /
unstamped / unknown, ordered permissive → restrictive), and embeds the `{SPDX: class}` registry +
per-class redistribute/model-training statement. Deterministic (sorted, integer counts).

- **Blank licence keys as `""` internally, `(unstamped)` only for display.** `classify_license`
  maps `""` → `unstamped`, but a literal `"(unstamped)"` string would classify as `unknown` (not
  in the SPDX map) — so count raw values (blank `""`), classify/partition from the raw map, and
  render the `(unstamped)` label only when building the manifest's `records_by_license`.
- The committed `docs/corpus-release-manifest.json` is a historical point-in-time record (no test
  asserts it) — it predates the `licenses` block and is NOT regenerated here (a full rebuild is
  expensive + its bytes aren't reproducible). New packages carry the block automatically.

## The corpus handoff — `publish.py` (91 US-1)

`publish_corpus` is the thin, opinionated wrapper over `package_corpus` that publishes the
**repo-root `build/corpus`** (the TS `scripts/export-for-engine.ts` output) as the artifact
consumers pull now that DVC is gone — `corpus-<version>.tar.gz` + a `.tar.gz.sha256` sidecar in
`sha256sum` format, so verification is `sha256sum -c` and nothing else. Runbook:
[`docs/artifact-versioning.md`](../../../../docs/artifact-versioning.md).

- **The default version is content-addressed** — 12 hex digits of `corpus_digest()` (new public
  helper; the same value the manifest's `digest` carries, computed without packaging). Same
  corpus ⇒ same version, same archive bytes, same sha256. This is only meaningful because the
  *TS* export is byte-identical across re-runs; the engine's own `out/<job>/corpus` is not
  (`retrieved_at` = ingestion wall-clock), so keep packaging that with plain `package`.
- **A missing corpus is `CorpusMissingError`, not `PackageError`** — nothing is wrong, it just
  hasn't been exported. The CLI no-ops with a regenerate-first message and exit 0; pass
  `--require-corpus` (CI) to make absence a failure instead.
- **`_write_archive` moves the release manifest to `release-manifest.json`** when the source
  already ships a top-level `manifest.json` — which a bare corpus dataset like `build/corpus`
  does. Two tar members under one arcname is silent data loss on extract. Job roots keep their
  corpus manifest at `corpus/manifest.json`, so the published layout is unchanged.

## Building a merged, multi-source corpus — `merge.py` (US-004)

`build_corpus(job)` stitches **every category in the job** into one graph (same-`csid`
rows merge), and `csid` is QID-anchored, so a shared Wikidata entity reconciles across
sources for free. That is the whole trick behind a *merged* corpus: put dump categories
**and** a `pinakes-export` category in one job. `merge.write_merged_job`
(CLI `pinakes_engine merge <bp…> --dump … --pinakes <export> --job …`) assembles
exactly that — it reuses `generate` (dump mode) per blueprint and appends a
`pinakes-export` category reading the export root (stored **absolute** so it
resolves regardless of run CWD). It sets `reconcile_shared_qids: true` on the job (see
below). Then `pinakes_engine run <job>` builds it fully offline.

- **Scale gotcha (US-003 still applies):** each dump category full-scans the whole
  slice, so acquire wall-clock ≈ N_categories × slice size. On the reference merge the
  pinakes ingest (12k rows) + 17 dump scans dominated (345 s wall, 192 MB peak);
  memory stays streaming-bounded, throughput is the thing US-007 must call out.
- Use **absolute** `--dump`/`--index`/`--pinakes` paths — the dump adapter and the
  pinakes-export adapter resolve their path relative to the run CWD, not the job.

## Tiered trust / auto-admission — `tiers.py` (US-002)

A merged corpus is the auto-admission surface: QID-anchored **and** reference-backed
facts admit with their US-001 rubric confidence + a **tier label**, weaker acquired facts
quarantine, and `data/source/lexicons/*.tsv` are never written (auto-admission is a graph-corpus
policy, not a lexicon write). `classify_tier(row)` is a **pure** function of already-
canonical provenance columns (`source`, `wikidata_qid`, `source_url`) — so `tier` is NOT a
new TSV column (that would cascade into the neo4j/datalog schema + every committed
snapshot); it is *derived*, and recoverable from the same `source(Csid,Source)` Datalog
fact / Neo4j property that already exists. Tiers, most-to-least trusted: `curated`
(`source=pinakes`, wins even with a QID/ref — human vetting is strongest),
`auto-admitted` (node with `wikidata_qid` AND `source_url`; edge with `source_url`),
`quarantine` (acquired but not both), `inferred` (`source` starts `inferred:` — linker
scaffolding). Runbook: `docs/tiered-trust.md`.

- **Opt-in via the job**, like `reconcile_shared_qids`: `Job.tiered_trust` (bool) +
  `Job.tier_gates` (per-tier `GateThresholds` overrides). Off by default, so single-source
  builds stay byte-identical. `pinakes_engine merge` bakes `tiered_trust: true` in (opt out
  with `--no-tiered`). When on, `build_corpus` writes `corpus/tiers.json` (composition-by-
  tier manifest — deterministic, content-only, same discipline as `manifest.json`) and
  `corpus/qa-tiers.json` (per-tier QA), and a per-tier gate violation fails the build under
  `fail_on_violation`.
- **Per-tier QA (`evaluate_tiers`) partitions rows by tier and reuses `qa.evaluate`.** The
  meaningful per-tier floors are **provenance + dedup + unreconciled** (auto-admitted must
  be fully sourced + QID-reconciled; quarantine has no floor — it is *awaiting* curation).
  **Dangling-edge / connectivity stay permissive per tier** — a curated edge legitimately
  points at a quarantined node, so `DEFAULT_TIER_GATES` sets BOTH `max_dangling_edge_rate`
  and `max_pinakes_dangling_edge_rate` to 1.0; real dangling is caught by the whole-
  corpus gate. (The curated subset is all-pinakes, so `qa.evaluate` appends the LS-
  scoped gates — remember to relax the LS dangling one too, not just the base one.)
- **`jobs._parse_tier_gates` imports `tiers.ALL_TIERS` lazily** (inside the fn) to avoid a
  `jobs`↔`tiers` top-level import order coupling: `tiers` imports the qa/manifest/metrics
  layer; `jobs` only needs the tier *names*.
- **Committed manifest** = `docs/tiered-corpus-manifest.json`, built from the
  `tests/fixtures/tiered/` corpus (spans every tier) and asserted by `tests/test_tiers.py`;
  regenerate via `manifest_for_tier_dataset(job, dir)` if the fixture moves.

## Personal trust tier + containment gate — `tiers.py`

`TIER_PERSONAL` is a **fifth** tier, but on a different axis from the trust four
(curated/auto-admitted/quarantine/inferred): it is a **privacy** partition for facts
ingested from the user's own private files. `classify_tier` returns it **first** — a
`source` token in `PERSONAL_SOURCES` is personal regardless of any QID/citation the row
also carries (a grounded reference fact). It is appended to `ALL_TIERS` (last), so
`partition_by_tier`/manifest/QA machinery pick it up for free; a corpus with no
personal-tier ingest is unaffected (the tier is simply empty and omitted).

- **`PERSONAL_SOURCES` is EMPTY by default — the framework, not a bundled producer.**
  Pinakes ships no personal-tier acquisition adapter, so nothing classifies personal out
  of the box. That is deliberate, and the tier is *not* dead code: a deployment that
  ingests its own private material adds that adapter's source id to `PERSONAL_SOURCES`
  and every downstream mechanism applies unchanged. Never hard-code a source token
  elsewhere — `is_personal_source` / `classify_tier` / the package gate / the Datalog
  `tier_row_filter` all read this one set. (`SYNTHETIC_SOURCES = {"insimul"}` is the
  same list for the synthetic tier, and *does* have a bundled member.)
- **The hard containment gate is `assert_no_personal_records(rows, *, context)`** (raises
  `PersonalTierContainmentError`) — the privacy invariant: personal facts are local-only
  and must NEVER enter a non-personal export / packaged artifact / open-data release.
  `orchestrate/package.py` calls `_assert_no_personal_tier` before it packages (scans the
  `source` column of every `nodes/`+`edges/` TSV via `is_personal_source`). **Any NEW
  export/release path must mirror this call** (the Datalog `--tier personal` opt-in,
  Neo4j load, GraphRAG); default direction is local-only.
- Committed tiered-corpus manifest / fixtures are unchanged (they carry no personal rows).
  Unit coverage for the classifier + the gate lives in `tests/test_tiers.py`, which
  registers a **synthetic** personal source id by monkeypatching `PERSONAL_SOURCES` —
  that is how you exercise the tier now that no member is bundled.

## Synthetic trust tier + containment gate — `tiers.py` (insimul-bridge US-003)

`TIER_SYNTHETIC` is the **sixth** tier and the exact structural twin of `TIER_PERSONAL`:
also off the trust ladder, also a partition, also classified *before* the trust rungs.
It holds facts read out of a **generated Insimul world** (`SYNTHETIC_SOURCES = {"insimul"}`).
Copy the personal-tier reasoning verbatim when extending either — they are one pattern:

- **The classification must come before the trust rungs, and here's why it matters more
  than for personal.** A world row carries a *real, non-empty* `source_url`
  (`insimul:world:<id>`), so an edge would auto-admit and a QID-less node would quarantine
  — either way it would sit on the trust ladder as though it described the real world.
  `classify_tier` checks `tokens & SYNTHETIC_SOURCES` second (after personal), so it can't.
- **`assert_no_synthetic_records(rows, *, context)`** (raises `SyntheticTierContainmentError`)
  is the hard gate — the Insimul bridge spec §7 "License leakage": generated-world facts are
  proprietary and must NEVER enter an open-data release / packaged artifact / real-world
  tier. `package.py`'s `_assert_no_personal_tier` now runs **both** predicates over one
  scan of each `nodes/`+`edges/` TSV. Any NEW export/release path must call both gates.
- **The synthetic gate floors are dedup + provenance, unlike personal's no-floor.** A
  generated world is a *closed* KB: fully provenanced by construction (world id + seed +
  contract version) and QID-less by construction (nothing real to reconcile to). So
  `max_unreconciled_rate` is 1.0 but `max_duplicate_rate` is **0.0** — a duplicate means
  the world-scoped csid mint forked, the one way a Bridge-2 re-ingest could stop being
  idempotent.
- **`SYNTHETIC_SOURCES` is the single source list** (same rule as `PERSONAL_SOURCES`).
  Unit coverage: `tests/test_insimul.py`.

## Identity preservation — collapse same-QID nodes across types (US-004)

`csid` is `cs:<node-type>:<QID>`, so the **same** Wikidata entity typed differently by
two sources gets two csids and the per-`csid` stitch cannot merge them — the corpus then
carries duplicate identities and the `duplicate rate` QA gate (max 0) trips. Seen on the
reference merge: a deity typed `Concept` by the dump vs `Deity` by pinakes; a script
typed `Language` vs `WritingSystem`; a linker-minted `place` hub for a QID pinakes
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
  so existing single-source builds (pinakes-full, seed-corpus, food-drink) stay
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
`label="Deity"` yields the real 198/221 (the pinakes deities re-match their own
rows). Pass `region_column="region"` only for node types whose lexicon has a region
column (languages do; deities don't). Built corpora are gitignored, so commit the
reconciliation **numbers** (a docs report) rather than a regenerable artifact.
