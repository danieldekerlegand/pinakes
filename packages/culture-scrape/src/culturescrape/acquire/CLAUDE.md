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
share a type (`dump` is shared by getty/pleiades/tabular/linguascrape-export), the category
disambiguates via `source.params.adapter: <name>`.

## Provenance placement (gotcha)

`schema/mapper.py::_carry_provenance` stamps a node row's `source`/`source_url`/
`source_query`/`retrieved_at`/`confidence` columns **from `record.provenance`, not from
`record.fields`**. So an adapter reading data that already carries provenance columns must
**lift them out of `fields` into `Provenance`** — leaving them in `fields` duplicates them
into the mapper's overflow JSON. `Provenance.__post_init__` requires `confidence ∈ [0,1]`
and a valid ISO-8601 **UTC** `retrieved_at`, so a blank `retrieved_at` must be filled from
an injected clock (`now`, for deterministic tests) — never pass `""`.

## LinguaScrape export adapter (`linguascrape-export`, US-001)

`linguascrape.py` reads LinguaScrape's canonical export *directory* (not a single file):
`<root>/nodes/*.tsv` + `<root>/edges/*.tsv`, one `RawRecord` per row, `source=linguascrape`.
Headers are the typed Neo4j-import form; it parses them with `schema/headers.py`
(`parse_node_header`/`parse_edge_header`) to validate the file and strip type suffixes
(`csid:ID`→`csid`, `confidence:float`→`confidence`; structural `:LABEL`/`:START_ID`/
`:END_ID`/`:TYPE` kept verbatim). Nodes vs edges are discriminated downstream by the
presence of `:LABEL` vs `:TYPE`. The `linguascrape_id` alias column rides through in
`fields` for round-trip. Fixture export: `tests/fixtures/linguascrape/export/`. Producer +
schema live on the TS side (`scripts/export-for-culturescrape.ts`,
`shared/canonical-schema.ts`); see `docs/reconcile-linguascrape.md`.

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

## Test conventions

Locate committed fixtures via `Path(__file__).parent / "fixtures" / ...`. Inject a fixed
clock (`now=lambda: datetime(..., tzinfo=UTC)`) for deterministic `retrieved_at`. Drive an
adapter through `build_adapter(spec, http_factory=...)` with an `http_factory` that raises,
to prove a local/dump adapter never touches the network.
