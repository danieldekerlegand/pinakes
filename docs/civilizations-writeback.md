# Civilizations write-back (US-003)

Curated, reconciliation-**new** civilizations appended into the source-of-truth
`data/source/lexicons/civilizations.tsv` via `scripts/import-from-engine.ts --add-cultures`.
Existing human-curated rows are never rewritten (append-only), so no curated cell can be
clobbered. Re-running is idempotent (dedup by `wikidata_qid` → normalised name → id).

## What ran

- **Input** — `scripts/data/civilizations-additions.tsv` (committed): 81 curated candidates
  drawn from the US-002 acquired corpus (`out/civilizations/corpus/nodes/culture.tsv`,
  gitignored), restricted to the three **tightest** verified Wikidata classes and cleaned:
  QID-named (unlabelled) rows dropped, obvious non-civilizations dropped (militias, parties,
  fronts, `… people` / `… culture` / `… district`), and any name already present in the
  lexicon removed. See the Codebase-Patterns note in `scripts/ralph/progress.txt` on why the
  broad classes (`historical-country`, `realm`, `dynasty`) are excluded here.
- **Command** — `npx tsx scripts/import-from-engine.ts --add-cultures`

## Result

| metric | count |
| --- | --- |
| candidates | 81 |
| **added** | **81** |
| updated | 0 (append-only) |
| skipped (duplicate) | 0 |
| conflicts (id collision) | 0 |
| rows before → after | 89 → **170** |

`data/source/lexicons/civilizations.tsv` now holds **170** distinct civilizations (target: 150+).

### By verified class

| Wikidata class | added |
| --- | --- |
| ancient civilization (Q28171280) | 21 |
| civilization (Q8432) | 47 |
| empire (Q48349) | 13 |

## Provenance (Guiding Principle #8)

Four provenance columns were added to `civilizations.tsv` (mapped to the canonical
`wikidata_qid` / `source_url` / `retrieved_at` / `confidence` fields in
`contracts/lexicon-mapping.json`). Existing rows carry them blank; **every appended row**
carries all four plus a bibliographic `sources = ["Wikidata"]` cell:

- `wikidata_qid` — e.g. `Q47690`
- `source_url` — `http://www.wikidata.org/entity/<QID>`
- `retrieved_at` — the acquisition ISO-8601 timestamp
- `confidence` — `1.0`

**Known gap (for the US-006 pilot report):** `scripts/export-for-engine.ts`
derives the canonical `source_url` only from the bibliographic citation, so the Wikidata
entity URL lives in the lexicon (and is shown in the app, which reads the lexicon) but is
**not yet propagated** to the canonical export / Neo4j for these rows. `source` is still
force-stamped `pinakes` and the citation preserved in `source_query`.

## Reproduce / verify

```
# Re-run the append (idempotent — adds 0 the second time)
npx tsx scripts/import-from-engine.ts --add-cultures

# Refresh the committed snapshots after the corpus changes
npx tsx scripts/export-for-engine.ts        # docs/engine-export-manifest.json
npx tsx scripts/reconciliation-report.ts           # docs/reconciliation-report.json
npx tsx scripts/convergence-qa.ts                  # drift gate (PASS = 0 drift)
```

The write-back report JSON lands in the gitignored
`build/corpus/writeback/civilizations-additions-report.json`.
