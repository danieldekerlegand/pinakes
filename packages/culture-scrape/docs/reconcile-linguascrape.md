# Reconciling the LinguaScrape export into culture-scrape

LinguaScrape exports its lexicons in the shared canonical shape (see
`../../../docs/canonical-schema.md`, §7). This note describes how those rows flow through
culture-scrape's reconcile step so the *same* real-world entity — a language, culture,
deity, place — becomes **one** graph node across both datasets, and which side owns which
part of that decision.

## The cascade (culture-scrape's system of record)

Entity resolution here is a strict precedence of identity signals, strongest first,
implemented in `culturescrape/schema/reconcile.py` (QID lookup) and
`culturescrape/schema/merge.py` (clustering + merge):

1. `wikidata_qid` — the QID *is* the identity; re-mints the `csid` QID-anchored.
2. `getty_id` — a shared Getty (TGN/AAT/ULAN) subject.
3. **language code** — `iso639_1`/`iso639_2`/`glottocode` (carried in `language_code`): a
   globally-unique code for a language.
4. exact normalized `(name, lang/region, type)`.
5. fuzzy `name` within one type/region, above `DEFAULT_FUZZY_THRESHOLD`.

A merge that would unite two **different** non-empty `wikidata_qid` (or `getty_id`) is
*refused* — an explicit identifier conflict means the rows are distinct things, however
alike their names.

Because LinguaScrape rows ship no QID (steps 1–2 are inert on first ingest), the
`reconcile.reconcile_linguascrape(incoming, existing)` entry point runs an **offline**
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

## What LinguaScrape ships (and what it does not)

LinguaScrape rows arrive with **no** `wikidata_qid` / `getty_id`, so steps 1–2 are inert on
first ingest. Reconciliation therefore rests on:

- **language codes** for `Language` nodes (`language_code`, plus the secondary code and any
  glottocode preserved as reconciliation keys), and
- the normalized **`(name, type, region)`** blocking key for every other domain.

LinguaScrape ships a **dry-run estimate** of how its export will land, produced *without*
network or a live graph, so the ingest can be reviewed before it runs:

- `scripts/reconciliation-report.ts` → `export/culturescrape/reconciliation/keys.tsv` +
  `report.json`, and a committed snapshot at `docs/reconciliation-report.json`.
- Every node is bucketed **matched** (has a global anchor), **likely-new** (unique
  name-anchored key), or **ambiguous** (blocking key collides with another distinct node —
  listed with competing candidates, **never auto-merged**).

## Feeding it in

1. **Export + estimate** (LinguaScrape side):

   ```bash
   npx tsx scripts/export-for-culturescrape.ts      # nodes/*.tsv + edges/*.tsv
   npx tsx scripts/reconciliation-report.ts         # reconciliation/keys.tsv + report.json
   ```

2. **Review the dry-run** — open `docs/reconciliation-report.json`. Triage the
   `ambiguities` list: each group is a set of exported nodes the reconciler cannot tell
   apart on name/code alone. Resolve them by supplying step-1/2 evidence (a `wikidata_qid`
   or `getty_id`) upstream in the lexicons, *not* by loosening the match — LinguaScrape is
   authoritative for its own rows' identity anchors.

3. **Ingest + reconcile** (culture-scrape side) — load the canonical node/edge TSVs through
   the tabular adapter, then run reconcile/merge. Rows that clear step 1 collapse onto the
   existing QID-anchored node; ISO-coded languages resolve on their code; the rest either
   match an existing name/region blocking key or mint a new name-anchored `csid`. Every
   decision is recorded in the row's overflow JSON (`reconciliation` / `merge` keys) so it
   is auditable and reversible (see `reconcile.py` / `merge.py`).

## Ownership (which side decides what)

| Step | Owner | Notes |
|------|-------|-------|
| Emit reconciliation keys (codes, name/region) | **LinguaScrape** | `scripts/reconciliation-report.ts`; keys ride the export. |
| Estimate matched / new / ambiguous | **LinguaScrape** | Dry-run, no network; for review only. |
| QID/Getty lookup + accept/reject | **culture-scrape** | `reconcile.py`; the system of record for identity. |
| Cluster + merge duplicates | **culture-scrape** | `merge.py`; refuses identifier-conflicting merges. |
| Resolve a flagged ambiguity | **human**, upstream in LinguaScrape lexicons | Add a `wikidata_qid`/`getty_id` anchor; never silently auto-merge. |

The dry-run never mutates the graph; it only tells you what the real reconcile step above is
likely to do, so surprises surface in review rather than in Neo4j.

## Edges into the ontology (US-004)

LinguaScrape edge rows are ingested as first-class canonical edges so they participate in
cross-dimensional linking alongside native inferred edges:

- **`:TYPE` is canonicalised at map time.** `map_linguascrape_edge` translates the export's
  edge token through `LINGUASCRAPE_EDGE_TYPE_MAP` (`schema/mapper.py`) to a **registered**
  ontology `:TYPE`. Five tokens map to themselves (`DESCENDS_FROM`, `INFLUENCED_BY`,
  `BORROWED_FROM`, `COGNATE_WITH`, `DERIVED_FROM`); the two LinguaScrape-specific tokens fold
  onto the closest canonical type — `ABSORBED_INTO → PART_OF` (transitive containment) and
  `SYNCRETIZED_WITH → VARIANT_OF` (symmetric equivalence). A token outside the map is
  **rejected** (`MapperError`), never passed through un-canonicalised. Every map *value* is
  asserted registered by `tests/test_linguascrape_ontology.py`.
- **Provenance rides the edge.** The mapped edge carries its `time_start`/`time_end` range,
  `confidence`, `weight`, `source='linguascrape'`, and the `linguascrape_id` round-trip alias.
- **Feed through the linker unchanged.** A mapped edge is a valid `Edge` row, so it is passed
  straight into `ontology.run.run_linkers(nodes, edges, ...)` as input; the linkers see it
  (e.g. the structural linker dedups against it) and inferred edges compose over it. Input
  edges are never re-tagged, so a LinguaScrape edge keeps `source='linguascrape'` while
  inferred ones get `source='inferred:<linker>'`.
- **Report by type.** `ontology.metrics.linguascrape_edges_by_type(edges)` (and the
  `edges_by_type_for_source(edges, source)` it wraps) counts the LinguaScrape-origin edges by
  canonical `:TYPE`, filtering on the `source` provenance so inferred/native edges are
  excluded.
