# schema/ — map → anchor → reconcile → dedup → edges

## `tsvio` — streaming reader (T-SR-US-002)

`open_rows(path) -> (columns, Iterator[Row])` is the streaming reader: it reads the
**header eagerly** (columns + any malformed-header `TsvError` surface on the call)
then yields one decoded `Row` per physical line, keeping the file open until the
iterator is drained. `read_rows` is now just the eager `list(open_rows(...))`
wrapper — same return shape, same fail-fast on a wrong cell count (the `list()`
drains it). Use `open_rows` for dump-scale files (the datalog projection does);
`read_rows` when you want the whole file. A physical `\n` is only ever a row
terminator (the writer escapes `\n`→`\\n` in values), and files are read in
universal-newline mode, so `_strip_eol` removing one trailing `\n` reproduces
`text.split("\n")` byte-for-byte.

The normalization pipeline (`pipeline.normalize_records`) turns raw acquisition
records into the canonical node/edge TSV family. Two paths:

- **generic** — `map_records → anchor → reconcile → merge_rows (dedup) →
  categorize_rows`. Edges are *built from the merged nodes* by `categorize_rows`,
  so they always reference surviving csids.
- **pinakes export** (`_is_pinakes_export`, `source.params.adapter ==
  "pinakes-export"`) — the records already ship canonical `:LABEL`/`csid`/
  `:TYPE`, so `_normalize_pinakes` only maps, splits nodes from edges, and
  dedups the nodes. **Its edges pre-exist**, so they do NOT automatically follow
  the dedup.

## Gotcha: dedup collapses csids — pre-existing edges must be redirected

`merge_rows` collapses duplicate nodes (same QID / Getty / `(name,lang,type)` /
fuzzy name) to **one primary csid per cluster**, dropping the losers. In the
pinakes path an edge minted against a loser's csid would then **dangle** and
fail `validate` (breaking `neo4j-admin import` downstream) — this was a live-corpus
bug: e.g. two languages named the same collapse, and every `BORROWED_FROM` pointing
at the dropped csid orphaned. `_normalize_pinakes` therefore calls
`_redirect_edges`, which rewrites each `:START_ID`/`:END_ID` through
`merge.merged_csid_remap(merged_nodes)` (`{lost_csid: primary_csid}`, read from the
`MERGE_KEY` record every survivor carries in its overflow JSON) and drops any edge
that still dangles or has become a self-loop. **If you add another path that keeps
pre-existing edges across a `merge_rows` call, redirect them the same way.**

## Gotcha: `PINAKES_EDGE_TYPE_MAP` must cover EVERY exported edge `:TYPE`

`mapper.py`'s `PINAKES_EDGE_TYPE_MAP` (identity for the five registered tokens,
folds for the pinakes-specific ones — `ABSORBED_INTO→PART_OF`,
`SYNCRETIZED_WITH→VARIANT_OF`, `SPLIT_FROM→DESCENDS_FROM`) must list **every** edge
`:TYPE` the TS export can emit, or `_normalize_pinakes` rejects the whole build
(`unknown pinakes edge :TYPE '<TOKEN>'`). The export's edge vocabulary lives on
the TS side in `shared/canonical-schema.json` `edgeTypes[].type` — when a **new
canonical edge type** is added there (US-005 found `SPLIT_FROM` had been added to the
schema but never registered here, silently breaking the full rebuild since), add the
matching token to this map: identity if it names a registered ontology `:TYPE`
(`ontology/registry.py`), else fold onto the closest registered one. `SPLIT_FROM`
folds onto `DESCENDS_FROM` — the same home pinakes's `evolved-into`/`gave-rise-to`
lineage edges already use; the direction is taken as-is from the source row
(`:START_ID`=source_id=ancestor), matching those siblings. The fixture-only
`test_convergence_build.py` won't catch a missing token if the fixture export lacks
that edge type — the **full** `jobs/pinakes-full.yml` rebuild is the only thing
that exercises the live edge vocabulary. `test_pinakes_ontology.py` pins that
every map value is registered + one fold assertion per token.

## `_carry_provenance` is where provenance columns land on a node (incl. `license`)

`mapper.py`'s `_carry_provenance` copies each `Provenance` field onto the canonical
node row; a column the adapter fills but this function forgets is **silently dropped**,
even though the schema declares it. This bit the per-record `license` (source-breadth
US-001): the tabular-dump adapter stamped `Provenance.license` and `headers.py`
`NodeSchema.canonical()` gained a `license` column, but the node output was blank until
`_carry_provenance` learned to set `row["license"] = prov.license` (only when truthy, so
license-less sources still emit a blank cell, not the string `None`).
`EdgeSchema.canonical()` now *declares* `license` (the shared contract does — see
below), but `_carry_edge_provenance` still copies only
source/source_url/retrieved_at/confidence, so the cell is written blank: per-record
licence remains a **node-level** guarantee (the ingested records), and linker-derived
edges still inherit their source node's provenance minus licence. Filling it is a
behaviour change, not a schema one.

## The canonical header IS `shared/canonical-schema.json` — extensions go after it

`NodeSchema.canonical()` / `EdgeSchema.canonical()` are the repo-wide contract
(`docs/canonical-schema.md`: "do not fork it") transcribed into `headers.py`, and the
embedded agora translation engine renders *that* header — so drift between the two
silently breaks byte-parity with it. `tests/test_canonical_schema_parity.py` pins
header module ↔ contract ↔ engine column-for-column; it is the guard that made the
delegation in `neo4j/export.py` safe.

**A column culture-scrape needs but the contract does not declare is an extension and
hangs off the END of the canonical tuple**, never inside it — `mapper.node_schema()` is
`NodeSchema.canonical()` + `parent_code` + `extra`. `parent_code` used to sit *inside*
`canonical()`, and that fork is exactly what blocked delegation: the engine emits the
contract's 28 node / 13 edge columns, culture-scrape emitted 28 *different* node / 8
edge ones, so every byte-pinned TSV/neo4j test would have failed. Readers here are all
header-keyed, so moving it out cost nothing — the linguistic linker still reads a real
persisted column at `build_corpus` time. Need a new column? Add it to
`shared/canonical-schema.json` first, or make it an extension.

## Glottolog: two-key language reconciliation (`glottolog_reconcile.py`, US-001)

The sibling of `lexicon_reconcile.py` for **languages**, but it does NOT reuse
`reconcile_pinakes`'s single-key cascade: that blocks on one `language_code` field,
and glottocode vs ISO 639-3 are **different code spaces** that can't meet on a single key
(a Glottolog node keyed by glottocode would never match a lexicon row keyed by ISO). So
`reconcile_glottolog` runs its own **glottocode-first, then ISO 639-3** two-key cascade:
glottocode is `language_code` on the corpus node; ISO rides in the node overflow (`extra`
JSON, key `ISO639P3code`) because the glottolog category maps only Glottocode→language_code
and leaves ISO639P3code unmapped. One candidate ⇒ matched, >1 ⇒ ambiguous (never
auto-merged), 0 ⇒ new. It reuses `lexicon_reconcile`'s `ReconciliationSummary`/`OutcomeSample`
report shape (tier encoded in the sample `confidence`: 1.0 glottocode, 0.95 ISO). Driver:
`scripts/reconcile_glottolog.py` (gitignored `out/.../report.{json,md}`); committed summary
`docs/glottolog-reconciliation.md`.

## WALS/PHOIBLE: attribute-fact nodes + language coverage (`typology_reconcile.py`, US-002)

CLDF **enrichment** sources (WALS typology, PHOIBLE phonology — and the same shape will
fit Lexibank wordlists, US-003) are ingested category-only as **attribute-fact nodes**:
one node per (language, feature) value / (language, segment), keyed by the language's
Glottocode on `language_code`. They are NOT a genealogy, so the join to the language
lexicon is a **reconciliation**, not a graph edge — `typology_reconcile.py` rolls the
facts up **per language** and reuses `glottolog_reconcile.reconcile_glottolog`'s
glottocode→ISO cascade, reporting coverage (facts / languages by node type and by licence
class). Driver `scripts/reconcile_typology.py`; committed summary
`docs/wals-phoible-reconciliation.md`.

- **GOTCHA — `merge_rows` fuzzy-name dedup will collapse distinct attribute facts.** The
  per-category normalize (`pipeline.normalize_records`) runs `merge_rows`, whose fuzzy
  pass blocks on **`(:LABEL, lang)`** and merges any two rows whose normalized `name`
  are ≥ 0.85 similar. Systematic fact names share long substrings ("English phoneme /m/"
  vs "…/p/" → 0.95 → merged; the *same* feature across languages → merged), so a naïve
  node-per-fact ingest silently loses most facts. Two levers, both category-only, fix it:
  (1) **map the ISO 639-3 code to `lang`** (`field.lang: ISO639P3code`) so facts of
  different languages fall in different fuzzy blocks and are never compared — this also
  serves as the reconciler's ISO fallback key (read from the `lang` column, not the
  overflow); (2) **keep the node `name` short / within-language-distinct** — map `name`
  to the bare segment (PHOIBLE) or a per-language-distinct feature label (WALS), so two
  facts of ONE language stay dissimilar. Verify empirically: `culturescrape run` then
  count `out/<job>/corpus/nodes/*.tsv` rows against the fixture row count.
- **Connectivity is relaxed per job.** Attribute facts are disjoint per-language stars
  (each links only to its synthetic type/category hub), so the corpus legitimately
  fragments; set `min_component_fraction: 0.0` in the job (`orchestrate/jobs.py` override)
  — the language join is the reconciliation, not descent connectivity.
- **Per-record `license` is the AC deliverable** (WALS `CC-BY-4.0`, PHOIBLE share-alike
  `CC-BY-SA-3.0`): set it in `source.params.license` and it lands on every node's
  `license` column (via `_carry_provenance`), so the corpus is queryable by licence
  class. `typology_reconcile`'s `facts_by_license` is the coverage proof.

## Lexibank wordlists + COGNATE_WITH cognate stars (`lexibank_reconcile.py`, US-003)

A Lexibank CLDF **wordlist** (ABVD) is the same attribute-fact ingest as WALS/PHOIBLE —
one **Wordform** node per (language, concept) form, keyed by glottocode on
`language_code` / ISO on `lang`, `name` = `"<Concept>: <Form>"` (within-language-distinct
so the fuzzy merge doesn't collapse different concepts). `lexibank_reconcile.py` **reuses**
`typology_reconcile.build_coverage` for the per-language glottocode→ISO reconciliation and
adds a `CognateCoverage` (cognate sets / cognated forms / `COGNATE_WITH` edge count).
Category `lexibank-abvd.yml` + job `jobs/lexibank.yml`; committed summary
`docs/lexibank-reconciliation.md`; `words.tsv` is untouched (graph-side corpus). Three
things that bit here:

- **COGNATE_WITH is a representative STAR, never a clique.** A Lexibank `Cognateset_ID`
  groups forms across *thousands* of doculects — the linguistic linker's etymon-based
  cognate pass is a clique (`n(n-1)/2`), which for a 1,500-form ABVD set is ~1.1M edges
  (the whole of ABVD would be ~46M). The new cognate-**set** pass in
  `ontology/linguistic.py` (`_emit_cognate_sets`, keyed on the `cognateset` field, default
  on but a no-op when no node carries it) emits a star to each set's
  lexicographically-first csid (`n-1` edges). Cognacy is transitive within a set, so
  co-membership survives through the representative.
- **A cognate-set id must ride in the `extra` OVERFLOW, not a `_DIMENSION_REFS` field.**
  `build_corpus` runs linkers *after* re-reading the normalized TSV from disk
  (`corpus._read_normalized`), so a non-persisted `_DIMENSION_REFS` cell (like
  `parent_qid`/`etymon_qid`) is **gone** at link time — only a real schema column
  (`parent_code`) or the `extra` overflow survives the round-trip. So map
  `field.cognateset: Cognateset_ID` as an **unmapped** cell (it lands in overflow) and have
  the linker read it back out of `extra` (`LinguisticLinker._cognate_set`). The
  per-category `link` stage (in-memory) would see a dimension ref, but `build_corpus` does
  not — always verify a linker input reaches link time through disk, not just in memory.
- **`merge_rows` fuzzy is O(k²) per `(:LABEL, lang)` block, and doculects SHARE an ISO** →
  a `lang` block can hold thousands of forms (ABVD's biggest ~2,900), making a full ingest
  minutes-slow (64M `SequenceMatcher` calls) or worse. For the committed coverage snapshot,
  run a **bounded** slice (first N doculects, a per-doculect form cap) that still clears the
  AC's ≥ 500 distinct languages — the category/job ingest the full download when repointed.

## Per-dataset SPDX licence registry (`lexibank_licenses.py`, US-003)

Lexibank is a *collection* of independently-licensed datasets, so its licence is
**per-dataset, not per-collection** (AC2). `lexibank_licenses.py` maps a dataset id →
SPDX (`license_for`), each value read from that dataset's CLDF `dc:license`, plus a
CC-URL→SPDX normaliser (`spdx_from_license_url`, longest-stem-first so `by-nc-sa` beats
`by`). The category's `source.params.license` is the registry value for its dataset (a test
pins `lexibank-abvd`'s licence == `license_for("abvd")`). Most Lexibank datasets are
`CC-BY-4.0`, but the registry + normaliser admit share-alike / NC / CC0 so a differing
dataset stamps correctly — never default a licence into the graph.

## kaikki.org etymology-template → canonical edge mapping (`kaikki_etymology.py`, US-004)

`kaikki_etymology.py` is the pure, tested bridge from Wiktionary's etymology-template
vocabulary (the `{{bor|…}}`/`{{inh|…}}`/`{{cog|…}}` templates kaikki.org preserves in each
entry's `etymology_templates`) to the registered ontology edge `:TYPE`s. Only unambiguous
**directed** relation tokens map: `bor`/`lbor`/`slbor`/`obor`/`ubor` → `BORROWED_FROM`,
`inh`/`der` (+ `+` variants) → `DERIVED_FROM`, `cog` → `COGNATE_WITH`. Everything else is
unmappable and **skipped + reported** (`ExtractResult.skipped_tokens`) — never coerced:
display helpers (`m`/`l`/`mention`), ambiguous calques (`cal`/`clq`), and critically
`ncog`/`noncog` (the **non**-cognate assertion — mapping it would invert the claim).

- **Two arg layouts.** Borrowing/derivation templates put the destination lang in arg `1`,
  the source lang/term in args `2`/`3`; cognate templates put the cognate lang/term in
  args `1`/`2`. `extract_relations` reads whichever layout the token uses, so the
  `EtymologyRelation` always names the *target* (source-side) `(lang, term)`. A recognised
  token with a blank target term can't form an edge → also skipped (never overstates edge
  volume).
- **`relations_cell` / `parse_relations_cell`** serialise the mappable relations to the
  `etymology_relations` node cell (unmapped → `extra` overflow) and back; `parse` re-guards
  the `:TYPE` against the canonical set so a corrupt cell can never inject a non-registered
  edge type. The linker (`ontology/linguistic.py` `_link_etymology`) reads it back out of
  overflow and mints/reuses one `Term` node per `(lang, term)`. See `acquire/CLAUDE.md`.

## kaikki language coverage + edge/skipped-token report (`kaikki_reconcile.py`, US-004)

Reuses `typology_reconcile.build_coverage` for the per-language ISO reconciliation of the
ingested **Wordform** nodes (kaikki carries no glottocode, so the glottocode→ISO cascade
falls straight to the `lang` ISO key; kaikki's `lang_code` is the *Wiktionary* code, often
639-1, so most languages read as `new` — never auto-merged). `analyze_entries` tallies edge
volume by `:TYPE` + the skipped unmappable tokens **from the source JSONL** (pure, no corpus
build), so the two AC deliverables (edge volume recorded, unmappable tokens reported) are one
function. Driver `scripts/reconcile_kaikki.py`; committed summary `docs/kaikki-reconciliation.md`.

## SPDX licence → redistribution class registry (`license_class.py`, US-005)

The pure, tested bridge from a per-record SPDX `license` to the small set of **redistribution
classes** the packaged corpus partitions on (`orchestrate/package.py` `licenses` block):
`public-domain` (CC0), `attribution` (CC-BY), `share-alike` (CC-BY-SA), `non-commercial`
(CC-BY-NC*), `unstamped` (blank), `unknown` (unregistered). `classify_license` upper-cases +
strips, maps via `_SPDX_TO_CLASS`, and — crucially — an **unrecognised id falls to `unknown`,
never a permissive class** (verify-before-redistribute). `REDISTRIBUTION` carries the per-class
"what may be redistributed / what a trained model inherits" statement (US-005 AC3), reviewed
against each CC deed; the share-alike ML caveat is deliberately hedged (whether trained weights
are an "adaptation" of a CC-BY-SA DB is unsettled). Distinct from `lexibank_licenses.py`, which
maps a *dataset id* → SPDX; this maps an *SPDX id* → class. No I/O — unit-test without a build.

## Reconciling an acquired corpus against a lexicon (`lexicon_reconcile.py`)

`lexicon_reconcile.py` is the thin data layer that folds a domain acquired from
Wikidata into the corpus without duplicating what pinakes already curates — it
wraps `reconcile.reconcile_pinakes`'s offline cascade (it adds **no** matching
logic). Used by `scripts/reconcile_civilizations.py` (the civilizations pilot, US-002).

- **`read_corpus_nodes`** loads a built `<corpus>/nodes/<type>.tsv` as reconciler
  `Row`s: strips Neo4j header suffixes (`csid:ID`→`csid`), wraps `:LABEL` in a list,
  drops empty cells. **GOTCHA — it drops the overflow (`extra`) column.** A stitched
  corpus stores the merge-provenance JSON there, and that cell is *not* re-parseable in
  isolation (`_decode_overflow` → `JSONDecodeError`), so carrying it onto a reconciler
  row makes `_region`/the cascade blow up. The cascade never needs it — drop it.
- **`read_lexicon_nodes`** loads a raw `lexicons/*.tsv` as the *existing* side: mints a
  QID-free `csid` from the row `id` (alias-anchored) or name, tags the canonical
  `:LABEL`, and — only if a `region_column` is given — supplies the region blocking key
  via the row's overflow JSON (the canonical schema has no `region` column).
- **Stricter fuzzy floor.** Pass `fuzzy_threshold` well above the library default
  (0.85 → the module default 0.93) for cross-source name matching: a *wrong* merge
  silently corrupts a curated node (German Empire→Roman Empire fuzzes 0.88), whereas a
  missed match only surfaces a duplicate for triage. Prefer `new` over a bad merge.

## Determinism boundary

Node/edge **counts** and the `nodes_by_label`/`edges_by_type` fingerprint
(`orchestrate/manifest`) are deterministic. But the `pinakes-export` adapter
stamps a blank `retrieved_at` with the ingestion wall-clock, so the *corpus bytes*
(hence a packaged tar.gz digest) are NOT reproducible across live builds — only the
committed fixture build (fixed `now()`) is byte-stable. See
`docs/convergence-build.md`.
