# Per-domain data-population runbook

The reusable flow for expanding one cultural/historical domain (archaeological sites,
cuisines, literary traditions, …) from its curated seed to its roadmap target, behind a
hard attribution + QA gate. Proven end-to-end on **civilizations** in the
[data-population pilot](./data-population-pilot-report.md); this generalises that pilot so
each domain isn't re-invented.

**Golden rule (pilot §4): raw acquisition volume ≠ publishable rows.** The machine steps
(acquire ~75 s/domain, graph load ~19 s) are cheap; **curation is the bottleneck**. Do it
**one domain at a time** behind the gate, never a single mega-run.

---

## The flow: generate → verify → acquire → reconcile → write-back → load

### 1. Generate — a domain acquisition blueprint/job

Author (or extend) the pinakes-engine acquisition job for the domain under
`engine/` (blueprint → generated SPARQL job, e.g. `jobs/<domain>.yml`).
Target the **tightest** Wikidata classes for the domain, not the broad umbrella classes.

### 2. Verify — the classes return what you expect

Dry-run the queries and eyeball the class breakdown **before** a full pull. Broad classes
(`historical-country`, `realm`, `dynasty`, `city-state`, `kingdom`, …) drag in modern
states, parties, militias, and ~14% unlabelled (QID-named) rows (pilot §6). Record the
verified class list in the job.

### 3. Acquire — run real acquisition (network) into the canonical corpus

Run the job to acquire from Wikidata (SPARQL + offline dump) and normalize/reconcile into
the canonical corpus (pinakes-engine). This is the one networked step. Every acquired node
carries `source`/`source_url`/`retrieved_at`/`confidence` provenance from the start
(Guiding Principle #8).

### 4. Reconcile — dedup against the existing curated rows

Reconcile the acquired set against the curated lexicon (pinakes-engine's
`lexicon_reconcile`, cross-source fuzzy threshold ~0.93). Buckets: **matched** (existing ↔
acquired, verify correct), **new**, **ambiguous** (blocking-key collision — **never
auto-merged**, listed for review). The TS-side dry-run estimate is
`npx tsx scripts/reconciliation-report.ts` (§8 of the canonical-schema doc).

### 5. Curate — the human gate (the real work)

Turn the "new" rows into a **trustworthy** subset:

- Drop QID-named (unlabelled) rows.
- Drop noise the broad classes pulled in (`… people`, `… culture`, `… district`, parties,
  militias, modern orgs, …).
- Drop names already present under a different id.

Write the survivors to a committed additions TSV (pilot pattern:
`scripts/data/<domain>-additions.tsv`), each row carrying full provenance
(`wikidata_qid`, `source_url = http://www.wikidata.org/entity/<QID>`, `retrieved_at`,
`confidence`, `sources`). Pilot yield after curation was **~1.7%** of the raw acquired set —
expect single-digit-percent yields, and log what you dropped.

### 6. Write-back — append into `data/source/lexicons/*.tsv` (never clobber curation)

Append the curated additions into the domain's lexicon via
`scripts/import-from-engine.ts` (the pilot used `--add-cultures`). It is
**append-only + idempotent**: dedups by `wikidata_qid` → normalised name → id, so a second
run adds 0 and leaves the file byte-identical. A curated cell that differs is a **conflict**
— *reported, never silently overwritten*. Enrichment write-back (filling blanks on existing
rows) uses `buildWriteBack`; it skips ambiguous ids (see `scripts/CLAUDE.md` §write-back).

**After any `data/source/lexicons/*.tsv` row/column change, regenerate the committed snapshots** or their
live-corpus parity tests fail:

```bash
npx tsx scripts/export-for-engine.ts     # → docs/engine-export-manifest.json
npx tsx scripts/reconciliation-report.ts        # → docs/reconciliation-report.json
```

### 7. Gate — the hard attribution + QA check (must be green to commit)

```bash
npm run convergence-qa      # TS: attribution + dedup ratchet + schema drift
```

The gate (`scripts/convergence-qa.ts`, [canonical-schema §10](./canonical-schema.md#10-convergence-qa-gate--drift-detection-us-008))
**fails** if:

1. **Attribution** — any acquisition-imported row (a row with a `wikidata_qid`) lacks
   `source` / `source_url` / `retrieved_at` / `confidence`. Reads the lexicons directly.
2. **Regression** — `duplicateCsids`, `ambiguousPinakesIds`,
   `edgesWithUnresolvedEndpoint`, or reconciliation `ambiguous` climbs above its committed
   ceiling in `docs/convergence-qa-baseline.json`.
3. **Drift** — schema / mapping no longer validate, or a mapped column / lexicon file
   drifted.

If a data addition *legitimately* moves a ratcheted metric (e.g. a new domain reuses ids
across files), re-baseline deliberately — it is a reviewed act, and it should be called out
in the commit / PR:

```bash
npm run convergence-qa:baseline   # rewrites docs/convergence-qa-baseline.json
```

Also run the Python side for the acquisition/reconcile code you touched (from
`engine/`): `uv run ruff check .` · `uv run mypy src` · `uv run pytest`.
CI enforces both sides via `.github/workflows/convergence-qa.yml`.

### 8. Load — into Neo4j + Datalog, verify counts

Load the expanded corpus into Neo4j (`pinakes_engine to-neo4j --mode loadcsv`) and verify
counts (`pinakes_engine neo4j-counts`); the load is idempotent (MERGE on `csid`). `loadcsv`
needs real infra, not a bare `docker compose -f infra/docker-compose.yml up` — see pilot §6.2 and `infra/docker-compose.yml`.
Confirm the live app renders the new rows (`npm run dev:full`, `npm run smoke:graph` with the
sidecar + Neo4j on the **same** corpus — pilot §6.3).

---

## Checklist per domain

- [ ] Tight-class job authored + verified (steps 1–2)
- [ ] Acquired + reconciled; matched rows spot-checked; 0 auto-merged ambiguous (steps 3–4)
- [ ] Curated additions committed, every row fully provenanced; drops logged (step 5)
- [ ] Written back append-only; 0 conflicts; snapshots regenerated (step 6)
- [ ] `npm run convergence-qa` green; Python checks green; re-baseline noted if used (step 7)
- [ ] Loaded into Neo4j, counts verified, app renders the rows (step 8)

## References

- [Data-population pilot report](./data-population-pilot-report.md) — the end-to-end proof + gotchas.
- [Canonical schema §7–§10](./canonical-schema.md) — export, reconciliation, write-back, QA gate.
- [pinakes-engine integration design](./engine-integration.md).
- Roadmap [§15 Data population at scale](./roadmap/prd-pinakes-deep-history-roadmap.md).
