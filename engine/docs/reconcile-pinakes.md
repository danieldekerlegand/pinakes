# Reconciling the pinakes export into pinakes-engine

pinakes exports its lexicons in the shared canonical shape (see
`../../../docs/canonical-schema.md`, §7). This note describes how those rows flow through
pinakes-engine's reconcile step so the *same* real-world entity — a language, culture,
deity, place — becomes **one** graph node across both datasets, and which side owns which
part of that decision.

## The cascade (pinakes-engine's system of record)

Entity resolution here is a strict precedence of identity signals, strongest first,
implemented in `pinakes_engine/schema/reconcile.py` (QID lookup) and
`pinakes_engine/schema/merge.py` (clustering + merge):

1. `wikidata_qid` — the QID *is* the identity; re-mints the `csid` QID-anchored.
2. `getty_id` — a shared Getty (TGN/AAT/ULAN) subject.
3. **language code** — `iso639_1`/`iso639_2`/`glottocode` (carried in `language_code`): a
   globally-unique code for a language.
4. exact normalized `(name, lang/region, type)`.
5. fuzzy `name` within one type/region, above `DEFAULT_FUZZY_THRESHOLD`.

A merge that would unite two **different** non-empty `wikidata_qid` (or `getty_id`) is
*refused* — an explicit identifier conflict means the rows are distinct things, however
alike their names.

Because pinakes rows ship no QID (steps 1–2 are inert on first ingest), the
`reconcile.reconcile_pinakes(incoming, existing)` entry point runs an **offline**
form of the cascade over just steps 3–5 — no network, no live graph. For each incoming
row it classifies against an index of the existing corpus:

- **matched** — exactly one existing node clears a tier (`language_code`, then exact
  `(name, type, region)`, then fuzzy name). The incoming row is merged onto that node,
  keeping its identity (`csid`/`wikidata_qid`) and **concatenating both sources'**
  provenance; the enriched, load-safe rows come back on `report.rows`.
- **ambiguous** — two or more rival nodes clear the tier. The row is **never** merged: it
  is listed on `report.ambiguous` (with its competing candidates) and *withheld* from
  `report.rows` for human triage.
- **new** — no tier fires; the row stands as its own node.

Every emitted row records its decision under the `reconcile_local` overflow key.

## What pinakes ships (and what it does not)

pinakes rows arrive with **no** `wikidata_qid` / `getty_id`, so steps 1–2 are inert on
first ingest. Reconciliation therefore rests on:

- **language codes** for `Language` nodes (`language_code`, plus the secondary code and any
  glottocode preserved as reconciliation keys), and
- the normalized **`(name, type, region)`** blocking key for every other domain.

pinakes ships a **dry-run estimate** of how its export will land, produced *without*
network or a live graph, so the ingest can be reviewed before it runs:

- `scripts/reconciliation-report.ts` → `build/corpus/reconciliation/keys.tsv` +
  `report.json`, and a committed snapshot at `docs/reconciliation-report.json`.
- Every node is bucketed **matched** (has a global anchor), **likely-new** (unique
  name-anchored key), or **ambiguous** (blocking key collides with another distinct node —
  listed with competing candidates, **never auto-merged**).

## Feeding it in

1. **Export + estimate** (pinakes side):

   ```bash
   npx tsx scripts/export-for-engine.ts      # nodes/*.tsv + edges/*.tsv
   npx tsx scripts/reconciliation-report.ts         # reconciliation/keys.tsv + report.json
   ```

2. **Review the dry-run** — open `docs/reconciliation-report.json`. Triage the
   `ambiguities` list: each group is a set of exported nodes the reconciler cannot tell
   apart on name/code alone. Resolve them by supplying step-1/2 evidence (a `wikidata_qid`
   or `getty_id`) upstream in the lexicons, *not* by loosening the match — pinakes is
   authoritative for its own rows' identity anchors.

3. **Ingest + reconcile** (pinakes-engine side) — load the canonical node/edge TSVs through
   the tabular adapter, then run reconcile/merge. Rows that clear step 1 collapse onto the
   existing QID-anchored node; ISO-coded languages resolve on their code; the rest either
   match an existing name/region blocking key or mint a new name-anchored `csid`. Every
   decision is recorded in the row's overflow JSON (`reconciliation` / `merge` keys) so it
   is auditable and reversible (see `reconcile.py` / `merge.py`).

## Ownership (which side decides what)

| Step | Owner | Notes |
|------|-------|-------|
| Emit reconciliation keys (codes, name/region) | **pinakes** | `scripts/reconciliation-report.ts`; keys ride the export. |
| Estimate matched / new / ambiguous | **pinakes** | Dry-run, no network; for review only. |
| QID/Getty lookup + accept/reject | **pinakes-engine** | `reconcile.py`; the system of record for identity. |
| Cluster + merge duplicates | **pinakes-engine** | `merge.py`; refuses identifier-conflicting merges. |
| Resolve a flagged ambiguity | **human**, upstream in pinakes lexicons | Add a `wikidata_qid`/`getty_id` anchor; never silently auto-merge. |

The dry-run never mutates the graph; it only tells you what the real reconcile step above is
likely to do, so surprises surface in review rather than in Neo4j.

## Edges into the ontology (US-004)

pinakes edge rows are ingested as first-class canonical edges so they participate in
cross-dimensional linking alongside native inferred edges:

- **`:TYPE` is canonicalised at map time.** `map_pinakes_edge` translates the export's
  edge token through `PINAKES_EDGE_TYPE_MAP` (`schema/mapper.py`) to a **registered**
  ontology `:TYPE`. Five tokens map to themselves (`DESCENDS_FROM`, `INFLUENCED_BY`,
  `BORROWED_FROM`, `COGNATE_WITH`, `DERIVED_FROM`); the three pinakes-specific tokens fold
  onto the closest canonical type — `ABSORBED_INTO → PART_OF` (transitive containment),
  `SYNCRETIZED_WITH → VARIANT_OF` (symmetric equivalence), and `SPLIT_FROM → DESCENDS_FROM`
  (genealogical divergence, the same home the `evolved-into`/`gave-rise-to` lineage edges
  fold onto). A token outside the map is
  **rejected** (`MapperError`), never passed through un-canonicalised. Every map *value* is
  asserted registered by `tests/test_pinakes_ontology.py`.
- **Provenance rides the edge.** The mapped edge carries its `time_start`/`time_end` range,
  `confidence`, `weight`, `source='pinakes'`, and the `pinakes_id` round-trip alias.
- **Feed through the linker unchanged.** A mapped edge is a valid `Edge` row, so it is passed
  straight into `ontology.run.run_linkers(nodes, edges, ...)` as input; the linkers see it
  (e.g. the structural linker dedups against it) and inferred edges compose over it. Input
  edges are never re-tagged, so a pinakes edge keeps `source='pinakes'` while
  inferred ones get `source='inferred:<linker>'`.
- **Report by type.** `ontology.metrics.pinakes_edges_by_type(edges)` (and the
  `edges_by_type_for_source(edges, source)` it wraps) counts the pinakes-origin edges by
  canonical `:TYPE`, filtering on the `source` provenance so inferred/native edges are
  excluded.

## Convergence QA gate (US-007)

Once pinakes rows are merged into the corpus, `orchestrate/qa.py` guards against a
pinakes ingestion silently degrading it. The five base gates (row count, duplicate
rate, provenance completeness, dangling-edge rate, unreconciled rate) grade the whole
dataset; four **pinakes-scoped** gates are appended whenever the corpus actually
contains pinakes-origin rows (a native-only corpus keeps the five base gates
unchanged):

- **`pinakes_provenance_completeness`** (min) — fraction of pinakes-origin rows
  still carrying the `pinakes` source stamp. A row identified as pinakes-origin
  whose `source` no longer names it has lost its provenance in the merge.
- **`pinakes_duplicate_rate`** (max) — post-dedup duplicate fraction among
  pinakes nodes (same strong identity key: `wikidata_qid` > `getty_id` > normalized
  name tuple).
- **`pinakes_dangling_edge_rate`** (max) — fraction of pinakes edges whose
  endpoint names no known csid. Checked against **every** node, since a pinakes edge
  may legitimately point at a native node.
- **`pinakes_unreconciled_rate`** (max) — fraction of pinakes nodes merged to no
  external-authority id. Permissive (`1.0`) by default; tighten it for a reconciling run.

A row is **pinakes-origin** if it retains a `pinakes_id` alias *or* a
`pinakes` token in its (possibly merge-concatenated `wikidata;pinakes`) `source`
provenance — the identity survives a reconcile merge.

Each gate has a configurable threshold on `GateThresholds` (also settable via
`GateThresholds.from_dict` and the `pinakes_engine qa --*` flags). `pinakes_engine qa
--fail-on-violation` (or a `QaPolicy(fail_on_violation=True)` in a job) makes the gate exit
non-zero on any violation. Every QA run emits both a machine-readable JSON report
(`<id>.qa.json`) and a human-readable Markdown artifact (`<id>.qa.md`, `--markdown-out`).

## Reproducible build (US-008)

The whole flow above is packaged as a one-command, offline, deterministic recipe:
`pinakes_engine run jobs/pinakes.yml` (re)builds the pinakes-inclusive corpus from
the committed fixture export and generates its Neo4j + Datalog exports. A committed
[`docs/convergence-manifest.json`](convergence-manifest.json) records the node/edge type
counts and is asserted against a fresh build in CI. See
[`convergence-build.md`](convergence-build.md) for the full recipe, the relaxed corpus
floors it declares, and how to re-sync the manifest.

## QID backfill on unreconciled lexicon rows (US-003)

The pilot exported ~6,700 nodes but only **966 (14.4%)** reconciled to a global anchor,
because almost every non-language row shipped without a `wikidata_qid` (cascade steps 1–2
inert). US-003 raises the matched share to **2,461 (36.7%)** via two levers:

1. **The dry-run report now honors the QID anchor.**
   `scripts/reconciliation-report.ts` classified buckets on the language/name key only, so
   the ~1,868 exported nodes that *already* carried a QID (from prior acquire work) were
   miscounted as `likely-new`/`ambiguous`. The report now buckets any QID-bearing node as
   `matched` (cascade step 1 — the QID *is* the entity; two nodes sharing a QID are the same
   entity, collapsed by `reconcile_shared_qids`, not a blocking ambiguity). `keyCoverage`
   gains `withWikidataQid`.

2. **Batch reconciliation of the still-blank rows.**
   `scripts/reconcile-lexicon-qids.ts` is the networked **acquire → reconcile** step. It
   reads every addressable blank-QID row (blank `wikidata_qid`, non-blank `name`, `id`
   unique in its file) across the lexicons that carry a QID column, and proposes a QID by an
   **exact English `rdfs:label` match** on Wikidata — constrained to the node type's Wikidata
   class where a reliable one exists (`archaeological-culture`→Q465299, `place`(sites)→Q839954,
   `cuisine`→Q1968435, `deity`→Q178885, `writing-system`→Q8192, …), else matched on **global
   label uniqueness** (minus Wikimedia disambiguation/category/list pages). Acceptance is
   precision-first:
   - **accepted** — exactly one entity matches → auto-applied;
   - **ambiguous** — ≥2 entities match → listed with competing QIDs, **never auto-accepted**;
   - **none** — no exact-label entity.

   Of **601** addressable rows: **176 accepted, 37 ambiguous, 388 no-match**. The committed,
   deterministic candidates artifact `scripts/data/lexicon-qid-candidates.tsv` is the
   human-reviewable record **and** the network-free replay source (CI never hits Wikidata).
   `--apply` fills the blank `wikidata_qid` cell plus full provenance (`source_url`,
   `retrieved_at`, `confidence` from the `exact-reconciled` rubric class on the file's own
   scale, `sources`) through the established enrichment write-back
   (`import-from-engine.buildEnrichment`) — blanks only, a differing curated cell is a
   reported conflict never clobbered. `data/source/lexicons/*.tsv` stays the human-owned source of truth.

### Refresh procedure

```
npx tsx scripts/reconcile-lexicon-qids.ts            # query Wikidata → rewrite the candidates artifact
npx tsx scripts/reconcile-lexicon-qids.ts --apply    # fill blank wikidata_qid + provenance from accepted rows
npx tsx scripts/export-for-engine.ts          # regenerate docs/engine-export-manifest.json
npx tsx scripts/reconciliation-report.ts             # regenerate docs/reconciliation-report.json
npm run convergence-qa                               # attribution + dedup gates (must PASS)
```

### Why 36.7%, not ≥50% (the measured ceiling)

- **Most remaining `likely-new` nodes have no QID column to fill.** The ~3,950 unreconciled
  nodes are dominated by node types whose lexicon files carry no `wikidata_qid` column at all
  (`art-traditions`, `battles`, `culture-profiles`, `religions`, `settlements`,
  `rivers-and-waters`, `families`, `trade-goods`, `cuisine-items`, `music-traditions`,
  `urheimat-hypotheses`). Backfilling those first needs a per-file schema addition (a mapped
  QID + provenance columns), which is a separate scale-up pass, not part of this backfill.
- **388 of the 601 addressable rows have no exact-label Wikidata entity** — many are curated
  compound labels (e.g. site names suffixed for disambiguation) that don't equal a Wikidata
  primary label. Relaxing to alt-label / fuzzy matching would raise recall at the cost of
  auto-admitting wrong anchors into the identity layer — deliberately not done.
- **37 rows are genuinely ambiguous** (a label shared by ≥2 entities, e.g. *Babylon*,
  *Petra*, *Delphi* — the modern place vs the archaeological site) and are withheld for human
  triage per the never-auto-merge rule.

The net effect is a **2.5× lift in the matched share** with zero attribution or dedup
regressions, and a clean, reviewable path (the candidates artifact) for a human to accept
the ambiguous/near-miss rows in a follow-up.
