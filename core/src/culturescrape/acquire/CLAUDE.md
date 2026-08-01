# acquire/ — source adapters

Each acquisition source implements `SourceAdapter` (adapters.py): set `name` (registry
id) + `source_type` (the category `source.type` it consumes) and implement
`fetch(spec) -> Iterator[RawRecord]`. A `RawRecord` (records.py) is `fields: dict[str,str]`
+ `provenance: Provenance`.

## Adding a new adapter — wire it in three places

1. The class (a new module), `name` + `source_type` set.
2. `factory.py` — add to `_BUILDERS` **and** to the `for _cls in (...)` tuple that builds
   `_BY_SOURCE_TYPE`. Network adapters also go in `_NEEDS_HTTP`; dump/local adapters do not
   (they must never build an `HttpClient`).
3. `__init__.py` — re-export the class/errors and add them to `__all__`.

`source_type` must be one of `VALID_SOURCE_TYPES` (categories.py). When several adapters
share a type (`dump` is shared by getty/pleiades/tabular/pinakes-export), the category
disambiguates via `source.params.adapter: <name>`.

## Provenance placement (gotcha)

`schema/mapper.py::_carry_provenance` stamps a node row's `source`/`source_url`/
`source_query`/`retrieved_at`/`confidence` columns **from `record.provenance`, not from
`record.fields`**. So an adapter reading data that already carries provenance columns must
**lift them out of `fields` into `Provenance`** — leaving them in `fields` duplicates them
into the mapper's overflow JSON. `Provenance.__post_init__` requires `confidence ∈ [0,1]`
and a valid ISO-8601 **UTC** `retrieved_at`, so a blank `retrieved_at` must be filled from
an injected clock (`now`, for deterministic tests) — never pass `""`.

## pinakes export adapter (`pinakes-export`, US-001)

`pinakes.py` reads pinakes's canonical export *directory* (not a single file):
`<root>/nodes/*.tsv` + `<root>/edges/*.tsv`, one `RawRecord` per row, `source=pinakes`.
Headers are the typed Neo4j-import form; it parses them with `schema/headers.py`
(`parse_node_header`/`parse_edge_header`) to validate the file and strip type suffixes
(`csid:ID`→`csid`, `confidence:float`→`confidence`; structural `:LABEL`/`:START_ID`/
`:END_ID`/`:TYPE` kept verbatim). Nodes vs edges are discriminated downstream by the
presence of `:LABEL` vs `:TYPE`. The `pinakes_id` alias column rides through in
`fields` for round-trip. Fixture export: `tests/fixtures/pinakes/export/`. Producer +
schema live on the TS side (`scripts/export-for-culturescrape.ts`,
`shared/canonical-schema.ts`); see `docs/reconcile-pinakes.md`.

## insimul `CanonicalWorldExport` adapter (`insimul`, insimul-bridge US-003)

`insimul.py` reads Insimul's `CanonicalWorldExport` — a **single JSON file**, not a
directory: a `contractVersion`/`worldId`/`seed`/`predicateSchemaHash` envelope around the
world's WorldIR (`ir`) and Prolog KB (`prologKb`). Wired in the factory's three places
(`dump` `source_type`, disambiguated by `source.params.adapter: insimul`). Fixture:
`tests/fixtures/insimul/world-export.json`; `tests/test_insimul.py` (40 tests).

- **The adapter MINTS the csids, it does not read them.** Insimul entity ids are
  MongoDB ObjectIds unique *within a world only* — never
  across worlds (the registry's `projects.insimul.idSpace` rule). So it mints
  `cs:<type>:insimul:<worldId>:<entityId>` (alias-anchored, `_alias_local` keeps it
  verbatim; a csid local part may contain colons). It is still a **csid-preserving**
  normalize path (`pipeline._normalize_insimul` → `mapper.map_insimul_records`) because
  by the time a record reaches the mapper its identity is settled — re-minting could only
  fork it. That's what makes re-ingest byte-identical (**0 changes**).
- **`retrieved_at` is the export's own `exportedAt`, never a clock.** A world export is an
  artifact, so stamping "now" would break idempotence — a missing or non-UTC `exportedAt`
  is a hard error, not a fallback. This is the opposite of the pinakes adapter's
  injected-clock pattern, deliberately.
- **All rows land in the `synthetic` trust tier.** `classify_tier` maps a `source=insimul`
  token → `TIER_SYNTHETIC` right after the personal check and *before* the trust rungs
  (a world row carries a real `source_url` and would otherwise auto-admit). Licence is
  `LicenseRef-Insimul-Proprietary`, unregistered in `schema/license_class.py` → class
  `unknown` = never redistributed. See `orchestrate/CLAUDE.md` "Synthetic trust tier".
- **Two deliberate non-mappings.** (1) A settlement's `position` is world-space metres
  around procedural terrain, NOT WGS-84 — it never touches `lat`/`lon` (it would put a
  generated town at latitude 412); it rides into overflow. (2) A **truth is not an event
  node** — the canonical vocabulary has no general event type and v1.3 coined none, so a
  truth anchors on `myth-motif` (the type registry entry 6 already pairs Insimul truths
  with) and `caused-by` stays endpoint-unconstrained in the schema.
- **Both stored directions collapse to one edge.** Insimul stores relationships from both
  ends (`childIds` *and* `parentIds`; a building's `occupantIds` *and* a character's
  `homeResidenceId`), and `SPOUSE_OF` is symmetric so its endpoints are sorted.
  `world_edges` dedupes each `:TYPE` group on `(start, end)` and sorts it.
- **`causesTruthIds`/`causedByTruthIds` do not exist in Insimul yet.** They are declared by
  the Insimul bridge spec Appendix A row 10 and read forward-compatibly; an export without them
  yields no `CAUSED_BY` edges (a test pins that).
- **World rules are registry entries, not records.** `world_rule_entries(export)` returns
  `datalog.registry.RegistryEntry`s at `layer = insimul-world`, `rule_id =
  insimul:<worldId>:<ruleId>`, with `clause_souffle = ""` — *that empty cell IS the
  full-prolog flag* (cuts / negation / `rule_likelihood/2` do not cross to Datalog). They
  are deliberately NOT in `build_registry()`, whose committed artifact must stay a
  deterministic function of code-resident sources. **GOTCHA — the `datalog.registry`
  import is deferred inside the function**: `datalog` reaches `schema` → `acquire`, so a
  module-scope import closes a real cycle (it broke a `import datalog.registry` -first
  entry point before being deferred). `RegistryEntry` is `TYPE_CHECKING`-only at module
  scope.

## Real-data dump slices (`wikidata_slice.py`, not an adapter)

`wikidata_slice.py` is a standalone **builder**, not a `SourceAdapter`: it composes
a real, bounded Wikidata slice in the **exact `latest-all` dump framing**
`wikidata_dump.iter_entities` reads (bare `[`, one entity/line, trailing comma on
all but the last, bare `]`) so the dump stack can run on genuine bytes without the
~90 GB download. `build_slice()` resolves member QIDs per blueprint class via WDQS
(`P31/P279*`), fetches full entity JSON via `wbgetentities` in batches of 50, dedupes
across classes (first class wins), and writes a `<out>.manifest.json` sidecar with
`source: wikidata-api-composed` provenance. All I/O goes through the shared
`HttpClient` (cached/retried/User-Agent-identified). CLI: `culturescrape build-slice`.
Gotchas: name the output `…YYYYMMDD…` so `dump_version()` records the date; output
lands under `out/` (gitignored — commit the manifest, never the slice); the
`skipif`-gated smoke test (`test_wikidata_slice_smoke.py`) only runs when a real
slice is present. Full recipe (plus the streamed `wikibase-dump-filter` and full-dump
variants): `docs/wikidata-dump-runbook.md`.

## Class-membership index (`wikidata_dump_index.py`, on-disk SQLite KV — US-002)

The dump adapter resolves class membership (`P31` / transitive `P279*`) from a precomputed
**SQLite** KV store beside the dump (`<dump>.index.sqlite3`, stdlib `sqlite3` — no dependency),
built once by `culturescrape index-wikidata <dump>` / `build_index()`. This replaced the retired
in-memory JSON sidecar (`INDEX_VERSION` bumped 1→2); a JSON file handed to `load_index` is now
rejected as "not a … index" (opening it as SQLite fails → `DumpIndexError`).

- **Two tables, one streaming pass:** `instances(class, member)` (P31) and `subclasses(parent,
  child)` (P279). Rows are buffered and `executemany`-flushed every `_FLUSH_ROWS` (50k), and the
  lookup indexes (`idx_instances_class`, `idx_instances_member`, `idx_subclasses_parent`) are
  created **after** the bulk insert — so build memory is bounded by the buffer, not the dump
  (measured 4.4 MB peak / 2.48 s / 0.58 MB index for the 5,691-entity reference slice).
- **Memory-bounded lookups:** `member_qids(roots, transitive)` walks the `P279*` closure via
  indexed `subclasses_of` queries (no second full dump scan) then unions members per class;
  `classes_of(qid)` reads the `idx_instances_member` index directly (no whole-index inversion).
  Query the store via the public methods — `members_of`/`subclasses_of`/`member_qids`/
  `classes_of` + `class_count`/`subclass_parent_count` — not raw dict attributes (there are none).
- **`DumpIndex` owns a live connection:** `close()` it (or use it as a context manager). The dump
  **fingerprint** (name/size/`YYYYMMDD`) lives in the `meta` table; `load_index` recomputes it and
  refuses an index built from a different dump. `default_index_path` → `<dump>.index.sqlite3`.
- Same real-data discipline as the slice: the `.sqlite3` file is gitignored (`out/*`) — commit only
  the measurements (runbook §"Building the class-membership index"). The `skipif`-gated
  `test_wikidata_dump_index_smoke.py` builds it over a real slice into a tmp dir when one is present.

## P279 class taxonomy extractor (`taxonomy.py`, rules-layer US-001)

`taxonomy.py` is NOT a `SourceAdapter` — it is a standalone extractor (like
`wikidata_slice.py`) that reads Wikidata's `P279` *subclass of* hierarchy for the
corpus's node **classes** (`CORPUS_CLASS_QIDS`, a `:LABEL → class QID` map) and
emits the direct `subclass_of` relations among them. It feeds the datalog
class-membership closure (`src/culturescrape/datalog/taxonomy.py` reads the
committed artifact; see that package's CLAUDE.md).

- **Two paths, one abstraction.** Both `sparql_ancestor_lookup(http)` (WDQS
  `wdt:P279*`, through the shared polite `HttpClient`) and `dump_ancestor_lookup(
  index, universe)` (the on-disk `DumpIndex.class_closure`, inverted over the small
  seed universe — no dump rescan) return an `AncestorLookup` (`qid → P279*
  ancestors`). `subclass_edges(lookup, ...)` turns either into the same
  `SubclassEdge` set, so the SPARQL and dump paths agree (a test asserts it).
- **Direct-edge reduction.** `subclass_edges` keeps only the direct label→label
  hops (drops `A→C` when `A→B→C` exists among the seeds) — the datalog rule
  re-derives the transitive links one hop at a time, so storing the closure would
  be redundant.
- **Committed replay artifact, network-free CI.** `write_subclass_tsv` writes
  `datalog/taxonomy/subclass_of.tsv` (full provenance per row); CI reads it, never
  Wikidata. Regenerate from the extractor with a fixture ancestor-lookup encoding
  the real P279 facts (`test_extractor_reproduces_the_committed_artifact` pins the
  two together). A label whose Wikidata class is ambiguous is **omitted** from
  `CORPUS_CLASS_QIDS`, never guessed — the taxonomy is only as sound as that map.
- Imports `SubclassEdge` from `culturescrape.datalog.taxonomy` (acquire→datalog is
  fine; datalog never imports acquire, so no cycle).

## P2302 property-constraint extractor (`constraints.py`, rules-layer US-002)

`constraints.py` is the sibling of `taxonomy.py` for **relation** rules: it reads
Wikidata's `P2302` *property constraint* statements for the corpus's edge vocabulary
(`EDGE_PROPERTY_PIDS`, a `:TYPE → property PID` map — conservative like
`CORPUS_CLASS_QIDS`) and writes the provenanced replay artifact
`datalog/constraints/property_constraints.tsv` the datalog translator reads back.

- **All Wikidata↔corpus resolution happens HERE, baked into the artifact** — so
  `datalog/constraints.py` needs no `acquire` import (no cycle). The extractor resolves
  the property PID → edge `:TYPE`, an inverse constraint's target PID → its `:TYPE`
  (`""` when out of vocabulary), and a type constraint's class QID → node `:LABEL`
  (reusing `taxonomy.CORPUS_CLASS_QIDS`; `""` when the class isn't a corpus backing
  class). The translator then translates-or-skips from those resolved columns alone.
- **SPARQL-only** (there is no dump path — constraints are statements on the property
  *entity*, which the P31/P279 dump index doesn't hold). `sparql_constraint_lookup(http)`
  runs one `p:P2302` query per property through the shared polite `HttpClient` and
  **merges the optional qualifier rows** a single statement spans (`P2306` inverse
  property, `P2308`/`P2309` class + relation) keyed by statement id.
- **Statement ids are the provenance** (`PID$GUID` shape). Offline they can't be
  derived, so the committed artifact uses stable `PID$slug` placeholders (documented);
  a live re-extraction fills the real GUIDs. Same fixture-reproduces-committed test as
  taxonomy (`test_extractor_reproduces_the_committed_artifact`).
- **Extend `EDGE_PROPERTY_PIDS`** only with a `:TYPE` whose single backing Wikidata
  property is unambiguous — every mapped `:TYPE` must be a registered `RelationType`
  (a test asserts it). Re-extract + re-commit BOTH `property_constraints.tsv` and the
  translated `rules_registry.tsv` after any change.

## Content-fingerprint dump diff (`wikidata_diff.py`, US-006)

`diff_dumps(old, new)` classifies every QID as added / changed / removed / unchanged by
comparing **content fingerprints** — `entity_fingerprint` hashes a canonical (sorted-key)
JSON projection of `_CONTENT_KEYS` (`labels`/`descriptions`/`aliases`/`claims`/`sitelinks`)
only, so a re-export that merely bumped revision metadata (`lastrevid`/`modified`/`pageid`)
hashes identically and does **not** read as a change. `fingerprint_dump` streams a dump into
a `{qid: hash}` map (memory bounded by the map, not the dump); `write_delta_dump(new, qids,
out)` carves just those QIDs into the same `latest-all` framing the reader accepts. This is the
"which entities changed" primitive the incremental upsert (`orchestrate/incremental.py`) drives.
Gotcha: a diff re-scans **both** whole slices — fine at slice scale, but a full-dump diff wants
a stored fingerprint manifest, not a re-scan (US-007 scale note).

## Hydration profiles (`wikidata_hydration.py`) — single vs rich extraction (US-005)

A `PropertyMapping` reads a Wikidata property into a canonical source field. It keeps
the **single best-rank** value by default (preferred > normal, deprecated dropped, first
statement/qualifier snak wins) — this is the parity behaviour and must stay the default.
Opt-in richer extraction:

- `multi=True` collects **every** distinct value across all ranked statements (deduped,
  best-rank first) into the `;` multi-value encoding; with `qualifier=`/`reference=` it
  reads *every* qualifier/reference snak per statement, not just the first.
- `reference="P854"` lifts a statement's citations (reference-URL snaks) into the field —
  references land in an **overflow field** (e.g. `references`), i.e. the mapper's `extra`
  JSON, not `provenance.source_url` (the adapter sets that to the entity URI).
- **GOTCHA — a multi-value field must target a downstream-safe column.** Only `aliases` is
  split back into a list by `schema/mapper.py`; every other field is a scalar, and the
  dimension refs (`place_qid`/`parent_qid`/`script`/…) feed linkers that resolve **one**
  QID. So a `Q1;Q2` in `place_qid` breaks linking. Pattern: keep the single-value mapping
  for the linker AND add a parallel `multi` mapping to a **new overflow field**
  (`parent_qid` + `parent_qids`, `place_qid` + `spoken_in_qids`) — linkers keep their one
  value, the corpus keeps the whole set in `extra`. `LANGUAGE_PROFILE` is the worked example.
- `DEFAULT_PROFILE` opts into nothing (single-value), so plain dump builds stay byte-identical.

## CLDF / tabular datasets are a category-only ingest (`tabular.py`, US-001)

`TabularDumpAdapter` (`adapter: tabular-dump`) ingests any local CSV/TSV/JSON by renaming
columns onto canonical fields — folding a CLDF source (Glottolog, WALS, PHOIBLE, Lexibank)
is a **category-spec** exercise, never new adapter code. The worked example is
`categories/glottolog.yml` + `jobs/glottolog.yml` (committed fixture slice at
`tests/fixtures/glottolog/languages.csv`, so the job runs network-free / in CI; repoint
`source.query` at the real gitignored download for the full catalogue). Key params:
`field.<canonical>: <source-column>` (rename), `id_column` + `url_template` (per-record
`source_url`), `source` / `license` / `confidence` (stamped on every record's provenance).

- **License must be in `source.params.license`** (an SPDX id, e.g. `CC-BY-4.0`) — the adapter
  puts it on `Provenance.license`, but it only reaches the node TSV because the mapper's
  `_carry_provenance` copies it (see `schema/CLAUDE.md`). Unmapped columns ride through into
  the node overflow (`extra`), so nothing is dropped — that's how the Glottolog reconciler
  later reads `ISO639P3code` for its ISO fallback.
- **Genealogy for free:** map the ancestor code column to `parent_code` (Glottolog's
  `Family_ID`) and this languoid's code to `language_code` (its `Glottocode`); the linguistic
  linker (`ontology/linguistic.py`) resolves each `parent_code` against a matching
  `language_code` into a `DESCENDS_FROM` edge, so the family tree stitches into one connected
  descent graph with no extra code.

## kaikki.org Wiktionary JSONL is a NEW adapter, not tabular-dump (`kaikki.py`, US-004)

A kaikki entry is a **nested** object (`etymology_templates` is a list of
`{name, args}` objects), so the column-rename `tabular-dump` adapter cannot extract it —
it would stringify the whole list. `KaikkiAdapter` (`adapter: kaikki`, `source_type:
dump`) reads the JSONL and yields one **Wordform** node per entry (`field.name` = the
head `word`, `field.lang` = `lang_code` = the fuzzy-block + reconcile ISO key). Wire a
new dump adapter in all three places (this file's checklist) — it is NOT in `_NEEDS_HTTP`
(local dump). Per-record `license=CC-BY-SA-3.0` (Wiktionary is CC-BY-SA, dual GFDL — a
share-alike source), `confidence=0.8`.

- **The etymology relation → edge mapping lives in `schema/kaikki_etymology.py`** (pure,
  tested), NOT the adapter: `bor…→BORROWED_FROM`, `inh`/`der`→`DERIVED_FROM`,
  `cog`→`COGNATE_WITH`; every other token (display helpers, calques, and the `ncog`
  **non**-cognate assertion) is unmappable → skipped + reported, never mis-typed. The
  adapter serialises the *mappable* relations into an **unmapped** `etymology_relations`
  cell so they ride into the node `extra` overflow and survive the normalize→disk→link
  round-trip (same disk-round-trip rule as the Lexibank `cognateset` — see `schema/CLAUDE.md`).
- **The linguistic linker emits the edges** (`ontology/linguistic.py` `_link_etymology`):
  it reads the overflow cell and, per relation, mints/reuses a minimal `Term` node keyed
  by `(lang, term)` (via `mint_csid("term", name=…, lang=…)`, so one etymon shared by
  many forms is one node) and emits the relation's canonical `:TYPE`. A no-op for any node
  without the cell.
- **Category ingests Wordform, linker mints Term** — the two labels keep the reconcile
  clean: `schema/kaikki_reconcile.py` reads only `wordform.tsv` (the ingested entries) for
  language coverage, while the etymon stubs land in `term.tsv` (`source=inferred:linguistic`)
  and don't pollute the count. Edge volume + skipped-token report come from re-parsing the
  source JSONL with `extract_relations` (pure, no corpus build needed). Worked example:
  `categories/kaikki.yml`, `jobs/kaikki.yml`, `scripts/reconcile_kaikki.py`,
  `docs/kaikki-reconciliation.md`.

## Test conventions

Locate committed fixtures via `Path(__file__).parent / "fixtures" / ...`. Inject a fixed
clock (`now=lambda: datetime(..., tzinfo=UTC)`) for deterministic `retrieved_at`. Drive an
adapter through `build_adapter(spec, http_factory=...)` with an `http_factory` that raises,
to prove a local/dump adapter never touches the network.
