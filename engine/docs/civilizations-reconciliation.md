# Civilizations reconciliation report (data-population pilot, US-002)

Point-in-time snapshot of the **acquire → normalize → reconcile** step of the
civilizations pilot (`docs/prd-pinakes-deep-history-roadmap.md` §15). Reproduce
with:

```bash
uv run pinakes_engine run jobs/civilizations.yml          # acquire (network) → stitch
uv run python scripts/reconcile_civilizations.py         # reconcile → out/.../reconciliation
```

The machine-readable report (`out/civilizations/reconciliation/report.{json,md}`) is
gitignored (it tracks the live corpus); this doc is the committed summary. Matching
logic: `pinakes_engine.schema.lexicon_reconcile` over the offline cascade
(`reconcile_pinakes`) — language code → exact `(name, type, region)` → fuzzy
name. Ambiguous rows are **never** auto-merged.

## Result (2026-07-08, live WDQS)

| metric | count |
| --- | --- |
| acquired, deduplicated by `wikidata_qid` (corpus `:Culture` nodes) | **4 734** |
| existing (curated `lexicons/civilizations.tsv`) | 89 |
| matched (already curated → enrich) | 57 |
| new (candidates) | 4 677 |
| ambiguous (held for triage) | 0 |
| **union distinct** | **4 766** |

- **Corpus reaches 150+ distinct civilizations:** yes — 4 734 distinct QIDs, far past
  the 150+ pilot target. The full stitched corpus passes the convergence QA gate
  (`pinakes_engine run`: provenance 0.999 ≥ 0.5, duplicate-rate 0, dangling-edge 0,
  100 % single connected component).
- **Provenance:** every acquired `:Culture` node carries `source=wikidata`,
  `source_url=http://www.wikidata.org/entity/<QID>`, `source_query`, `retrieved_at`
  (ISO-8601 UTC), `confidence=1.0` (Guiding Principle #8). The ~0.1 % provenance gap is
  the structural category/type hub nodes, which are sourceless by design.
- **Dedup:** the same polity acquired under several classes (e.g. a state that is both a
  `kingdom` and a `historical country`) collapses to one `cs:culture:<QID>` node on
  stitch, so the 5 105 raw rows dedup to 4 734.
- **Fuzzy threshold:** matching uses a **stricter** cross-source floor (0.93) than the
  library default (0.85). At 0.85, look-alikes wrongly merged onto curated nodes —
  *German Empire* → Roman Empire (0.88), *Austrian Empire* → Assyrian Empire, *Gaza
  Empire* → Ghana Empire. A wrong merge silently corrupts a curated row, so borderline
  names are kept `new` (reviewable) instead. 96 → 57 matched, and all 57 are correct.

## Data-quality gotchas (feed US-003 curation + US-006 go/no-go)

The 8 verified Wikidata classes are **much broader than "civilization"**. Two problems
make a raw dump of all 4 677 new rows into the curated lexicon unacceptable — US-003
must curate, not bulk-append:

1. **Unlabeled items (~14 %).** 683 of 4 734 rows have `name == "Q…"` (the QID) — items
   with no English `rdfs:label`, so `SERVICE wikibase:label` fell back to the QID. These
   must be dropped (or hydrated from another language) before write-back.
2. **Non-civilizations in the broad classes.** `historical-country` (Q3024240, ~3 839),
   `realm` (Q1250464) and `dynasty` (Q207320) sweep in modern political organizations,
   militias, and movements — e.g. *9 September Front*, *Abdul Qader al-Husseini
   Brigades*, *Action squads*, *Afrikaner Weerstandsbeweging*,
   *2nd Training Operation Company, Volunteer Defense Corps*. Genuine deep-history
   polities are plentiful in the same set (*Achaemenid Empire*, *Aceh Sultanate*, *Adal
   Sultanate*, *Abhira Kingdom*, *Afsharid Iran*), so the pilot easily clears 150+ real
   civilizations — but selection (by class, time period, and a name filter) is required.

**Recommendation for US-003:** write back the 57 matched enrichments, then add a curated
slice of the `new` set — prefer the tighter classes (`ancient civilization`,
`civilization`, `empire`, `city-state`, `kingdom`), drop QID-named rows, and cap the
growth toward the ~150–200 pilot target rather than appending all 4 677.
