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

## Test conventions

Locate committed fixtures via `Path(__file__).parent / "fixtures" / ...`. Inject a fixed
clock (`now=lambda: datetime(..., tzinfo=UTC)`) for deterministic `retrieved_at`. Drive an
adapter through `build_adapter(spec, http_factory=...)` with an `http_factory` that raises,
to prove a local/dump adapter never touches the network.
