# Tiered trust & auto-admission runbook (US-002)

Phase 3 of the neurosymbolic roadmap (item 3.5)
decouples the machine-trusted **grounding corpus** from the human-curated **app
lexicons**. The pilot's ~1.7% curation yield makes the human gate the binding
constraint on corpus growth, so a fact that is *already* globally identified and
externally referenced auto-admits to the graph corpus with a rubric confidence and a
trust-tier label, while everything weaker quarantines for later curation.

**The one invariant:** auto-admission is a *graph-corpus* policy only. It NEVER writes
`lexicons/*.tsv` — human curation remains the sole path into the app-facing lexicon
layer. A corpus build *classifies* rows into tiers; it does not move them out of any
source.

## Tiers

Every node and edge row is classified by [`orchestrate/tiers.py`](../src/pinakes_engine/orchestrate/tiers.py)
`classify_tier(row)` — a pure function of already-canonical provenance columns
(`source`, `wikidata_qid`, `source_url`), most-to-least trusted:

| Tier | Rule | Confidence source |
| --- | --- | --- |
| `curated` | `source` names `pinakes` (came through the human-curated lexicon gate; wins even when a QID/reference is also present) | US-001 rubric, stamped upstream |
| `auto-admitted` | **QID-anchored AND reference-backed** — a node with a `wikidata_qid` *and* a `source_url`; an edge (no QID column) with a `source_url` citation | US-001 `referenced-wikidata` (0.9) etc. |
| `quarantine` | an acquired fact that is *not* both QID-anchored and reference-backed (a QID with no citation, a name-only row, an HTML scrape) — in the corpus, tagged, awaiting curation | US-001 `unreferenced-wikidata` etc. |
| `inferred` | `source` starts with `inferred:<linker>` — a linker-minted hub or inferred edge (derived scaffolding, not an acquired fact) | linker confidence |

`tier` is **not** a new canonical TSV column (that would cascade into the neo4j/datalog
schema and every committed snapshot). It is derived from columns that are already
first-class and queryable, so a query recovers the tier by the same predicate — see
[Querying tiers](#querying-tiers).

## Building a merged, tiered corpus

The corpus-merge job unions the pinakes canonical export with auto-admitted domain
corpora from the Wikidata dump slice (the machinery is
[`orchestrate/merge.py`](../src/pinakes_engine/orchestrate/merge.py) +
[`orchestrate/corpus.py`](../src/pinakes_engine/orchestrate/corpus.py) `build_corpus`,
US-004). `pinakes_engine merge` bakes `tiered_trust: true` into the job by default:

```bash
# 1. Assemble the merged job (dump domains + the pinakes export).
pinakes_engine merge <blueprint…> \
    --dump  /abs/path/to/slice.json.gz \
    --index /abs/path/to/slice.json.gz.index.sqlite3 \
    --pinakes /abs/path/to/build/corpus \
    --job jobs/merged-tiered.yml --name merged-tiered
    # add --no-tiered to write a plain (untiered) merged job

# 2. Build it — stitch, link, reconcile same-QID nodes, classify tiers, gate, export.
pinakes_engine run jobs/merged-tiered.yml
```

`build_corpus` then writes, beside the corpus TSV (`out/<name>/corpus/`):

- `tiers.json` — the **composition-by-tier manifest** (node/edge counts per tier + a
  `:LABEL` / `:TYPE` breakdown). Deterministic, content-only (the same corpus always
  serialises to the same bytes), like `manifest.json`.
- `qa-tiers.json` — the **per-tier QA report** (each tier graded against its own gates).

The whole corpus still loads Neo4j (`corpus-neo4j/`) and exports to Datalog
(`corpus-datalog/`) exactly as before — tiering adds no column, so those steps are
unchanged.

### Per-tier QA gates

Each tier is graded against its own [`GateThresholds`](../src/pinakes_engine/orchestrate/qa.py).
The defaults ([`tiers.DEFAULT_TIER_GATES`](../src/pinakes_engine/orchestrate/tiers.py))
encode the trust floors that actually differentiate the tiers:

- **auto-admitted** must be fully sourced (`min_provenance_completeness = 1.0`),
  QID-reconciled (`max_unreconciled_rate = 0.0`), and deduped (`max_duplicate_rate = 0.0`);
- **curated** need not carry an external `source_url` (pinakes records none —
  curation is the gate, enforced upstream) but must not duplicate;
- **quarantine** carries no provenance floor (it is *awaiting* curation, not failing it);
- **inferred** scaffolding is exempt.

Dangling-edge / connectivity stay permissive **per tier** — an edge in one tier
legitimately points at a node in another — because the whole-corpus QA gate enforces
those globally. Override any tier in the job spec:

```yaml
tiered_trust: true
tier_gates:
  auto-admitted:
    min_provenance_completeness: 1.0
  quarantine:
    min_rows: 0
```

A per-tier violation fails the build only when the corpus QA policy is
`fail_on_violation` (the default for `pinakes_engine run`).

## Querying tiers

Because a tier is a function of `source` + `wikidata_qid` + `source_url` — all first-class
in both stores — no new schema is needed:

- **Datalog** — [`datalog/nodes.py`](../src/pinakes_engine/datalog/nodes.py) already emits
  `source(Csid, Source)` (and `edges.py` `rel_source/4`), so `source(C, pinakes)`
  selects the curated tier, `source(C, S), place_qid(C, _)` an auto-admitted-style join,
  and an `inferred:` prefix the inferred tier. See `datalog/examples/entities-by-source.pl`.
- **Neo4j** — `source`, `confidence`, `wikidata_qid`, and `source_url` are ordinary node /
  edge properties, so the same predicate is a `WHERE` clause
  (`WHERE n.source = 'pinakes'`, or `n.wikidata_qid IS NOT NULL AND n.source_url <> ''`
  for the auto-admitted tier).

## Refreshing a tiered corpus

Tiering carries no extra refresh state — a refresh is the ordinary corpus refresh, and the
tier of each row is recomputed from its provenance on every build:

- **Full rebuild** — re-run `pinakes_engine run jobs/merged-tiered.yml` (regenerates
  `tiers.json` / `qa-tiers.json`). Do this after the pinakes export or the dump slice
  changes materially.
- **Incremental (QID-keyed) upsert** — [`orchestrate/incremental.py`](../src/pinakes_engine/orchestrate/incremental.py)
  `run_upsert` / `pinakes_engine sync-wikidata` refreshes only the changed Wikidata
  entities (US-006). A re-exported entity lands on the node it already occupies (csid is
  QID-anchored), and its tier follows its refreshed provenance.
- **Scheduled** — the `--since` window (`docs/scheduling.md`) drives either from a cron job.

The committed composition manifest for the CI-deterministic fixture corpus lives at
[`docs/tiered-corpus-manifest.json`](tiered-corpus-manifest.json) (asserted against the
`tests/fixtures/tiered/` corpus by `tests/test_tiers.py`); regenerate it with
`manifest_for_tier_dataset(...)` if the fixture changes.
