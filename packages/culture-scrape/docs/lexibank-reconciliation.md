# Lexibank wordlist coverage (source-breadth Phase 4, US-003)

Point-in-time snapshot of the **acquire → normalize → link → reconcile** step of the
Lexibank ABVD wordlist ingestion (`docs/sources-linguistic.md`; Phase 4 of the
neurosymbolic roadmap). Reproduce with:

```bash
uv run culturescrape run jobs/lexibank.yml            # ingest ABVD → stitch → link
uv run python scripts/reconcile_lexibank.py           # reconcile → out/.../reconciliation
```

The machine-readable report (`out/lexibank/reconciliation/report.{json,md}`) is
gitignored (it tracks the built corpus); this doc is the committed summary. ABVD is
ingested via the existing **tabular-dump adapter** (no new adapter code) as
language-keyed **Wordform** attribute facts — one node per (language, concept) form.
Like WALS/PHOIBLE, a wordlist enriches language nodes but is **not** a `words.tsv`
rewrite (`words.tsv` is untouched); the join to the language lexicon is a
**reconciliation**, not a graph descent edge.

## Modelling (category `lexibank-abvd.yml`, job `jobs/lexibank.yml`)

- **Keyed by glottocode.** Each form carries the language's Glottocode on
  `language_code` (the reconciler's primary blocking key) and its ISO 639-3 code on
  `lang` (the ISO fallback key **and** the entity-resolution fuzzy-merge block key). The
  node `name` is `"<Concept>: <Form>"` — within-language-distinct so the fuzzy merge does
  not collapse forms of *different* concepts.
- **COGNATE_WITH from cognate sets.** A Lexibank `Cognateset_ID` groups forms across
  doculects that descend from one proto-form. It rides in the node `extra` overflow
  (`field.cognateset: Cognateset_ID`), and the **linguistic linker** links each set's
  members into a `COGNATE_WITH` **representative star** — every member → the set's
  lexicographically-first form (`n-1` edges), not the `n(n-1)/2` clique. A single ABVD
  cognate set can span ~1,500 forms (a clique would be ~1.1M edges), so the star is the
  only tractable materialisation; cognacy is transitive within a set, so co-membership is
  recoverable through the representative. Datasets without cognacy (e.g. ASJP) omit the
  column and emit no cognate edges.
- **Per-record licence, per dataset.** Every form's `license` column carries ABVD's own
  SPDX id, resolved from the **per-dataset registry**
  (`src/culturescrape/schema/lexibank_licenses.py`) — Lexibank licences vary by dataset,
  so the licence is keyed on the dataset id, never assumed for the collection. ABVD =
  **`CC-BY-4.0`**. The corpus is queryable by licence class.
- **Reconciliation** (`culturescrape.schema.lexibank_reconcile`) rolls the forms up per
  language and classifies each distinct language against `lexicons/languages.tsv` by the
  same **glottocode-first, then ISO 639-3** cascade Glottolog/typology use (reused via
  `reconcile_glottolog`). A code shared by >1 lexicon row is **ambiguous** and is
  **never** auto-merged. Connectivity is relaxed (`min_component_fraction: 0.0`): forms
  connect only through cognate stars.

## Result (a bounded ABVD run: ≥ 500 languages)

The job runs network-free out of the box against a committed slice
(`tests/fixtures/lexibank/abvd-wordlist.csv`, 4 languages / 2 cognate sets — enough for
CI + the unit tests). The coverage below is from a **bounded local ABVD run** — the first
520 doculects of the CLDF `forms.csv` (a per-doculect form cap keeps the normalize
fuzzy-merge tractable), denormalised against `languages.csv` (Glottocode / ISO639P3code)
and `cognates.csv` (Form_ID → Cognateset_ID). The download + denormalised slice stay
gitignored; repoint `categories/lexibank-abvd.yml`'s `source.query` at the full
denormalised `forms.csv` to ingest all ~2,000 doculects / **~1,050 glottocodes**.

| metric | count |
| --- | --- |
| total forms (Wordform nodes) | 14,258 |
| **distinct languages** | **520** ✅ (AC target ≥ 500) |
| cognate sets | 1,619 |
| forms carrying a cognate set | 8,149 |
| **COGNATE_WITH edges** | **9,116** |
| forms — licence `CC-BY-4.0` | 14,258 (100%) |

### Language reconciliation (glottocode → ISO cascade)

| metric | count |
| --- | --- |
| distinct languages (incoming) | 520 |
| existing languages (lexicon) | 1,099 |
| matched (already curated) | 32 |
| new (candidates to add) | 487 |
| ambiguous (held for triage) | 1 |
| **union distinct** | **1,586** |

ABVD is Austronesian-focused, so most of its languages are **new** to the (globally
broad but small) curated lexicon — expected, and surfaced as reconciliation candidates,
never auto-merged. The single **ambiguous** language shares a code with more than one
lexicon row and is held for triage. Matched languages join by glottocode (confidence
`1.0`) or, when the lexicon lacks the glottocode, by ISO 639-3 (`0.95`) — e.g. Cebuano
and Amis by glottocode, Balinese and Buginese by ISO.

## Scope

`words.tsv` is **untouched** — this is a graph-side corpus (`out/lexibank/`, gitignored),
not a lexicon write. The committed artefacts are the category + job specs, the fixture
slice, the reconcile module + driver, and this summary; the built corpus and the
gitignored download are regenerable. The corpus QA gate passes (`min_component_fraction:
0.0`), and the neo4j + Datalog exports are written alongside the corpus.
