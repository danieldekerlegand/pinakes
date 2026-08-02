# Removed / Disabled Features

## The `packages/culture-scrape` vendored shell (retired 2026-07-23)

`packages/culture-scrape/` no longer exists. The Python data/correlation engine it
vendored is now **first-party pinakes code at [`engine/`](../engine/)** — same
`pinakes_engine` package namespace, same `pinakes_engine` console script, same `cs:` id
space, only the checkout path moved. Nothing was deleted in the move; see
[`engine/CLAUDE.md`](../engine/CLAUDE.md) for the repo-root path arithmetic that changed
with it (the package sits one level below the repo root now, not two).

Retired along with the shell:

- The **vendored-fork framing.** `engine/` was never a two-way subtree link and is not one
  now; [`engine-fork-policy.md`](./engine-fork-policy.md) records why the
  standalone `~/Development/culture-scrape` repo stays archived.
- Build/config references to the old path — docker-compose's `pinakes_engine` service
  builds `./engine`, and `npm run sidecar:up` / `sidecar:down` drive that service by name.

### Translation handed off to agora:60

Canonical **format rendering** moved out of pinakes and into the agora translation engine
(`agora:60-translation-engine-rust`), embedded in-process as the `translation_py` PyO3
extension and reached only through the adapter `pinakes_engine.translation` — never by
importing `translation_py` directly. Delegating today:

| Surface | Engine entry point |
|---|---|
| `datalog/export.py` → `graph.pl` / `graph.dl` (+ `.facts`) / `graph.problog.pl`, rules-free | `to_datalog` — the whole document, verbatim |
| `datalog/export.py`, **rule-bearing** (`--rules`, `--constraints`, the personal tier, the explorer's Datalog console) | `to_datalog` — every fact clause; pinakes composes only the program *structure* around them |
| `neo4j/export.py` (`from-neo4j`) | `to_neo4j_export` |

Byte parity against the pre-migration Python emitters is pinned by committed goldens in
`engine/tests/fixtures/parity/` (`engine/tests/test_translation_parity.py`), which cover all
six canonical conversions and survived the relocation unchanged.

**Still hand-written Python, and why.** agora:60 ships exactly eight *whole-graph document*
renderers (`to_tsv to_csv to_cypher to_prolog to_souffle to_problog to_datalog
to_neo4j_export`) — no parsing, no fact-level surface, no schema parameterization. So these
could not be retired and are **not** dead code:

- `schema/tsvio.py` `read_rows` / `read_edge_rows` — the engine consumes canonical graph
  JSON and never produces it from TSV, so there is nothing to parse with. `write_rows` is
  schema-parameterized (it renders reconciler-specific and extension columns); the engine
  is schema-fixed.
- `datalog/__init__.py` `render_atom` / `render_fact` and the `Dialect` quoting rules — the
  engine has no fact-level surface.
- The **program structure** of the rule-bearing `datalog/export.py` path — the
  `:- table` / `:- discontiguous` / `:- dynamic` preamble and the Soufflé
  `.decl`/`.input`/`.output` block are computed over facts ∪ rules, the rule clauses are
  pinakes' own inference layer, and the committed P279 taxonomy is not part of the
  canonical graph. The engine emits base facts only, so pinakes re-composes them —
  `translation.program_fact_clauses` splits the engine's document back into clauses and
  `write_program` / `write_souffle_facts` / `write_problog_program` take them through
  their `rendered_facts` / `rendered_shards` seam. Every fact clause on this path is still
  the engine's; a rule-aware upstream API would remove the re-composition, not add
  delegation. Byte parity against the same writers rendering their own facts is pinned by
  `test_rule_bearing_export_matches_the_reference_emitters`.
- `neo4j/load_csv.py` + `admin_import.py` (`to-neo4j`) — these render per-file statements
  from each corpus file's *parsed* header, including the `parent_code` / `extra`
  extensions. The engine's `to_cypher` is a whole-graph load script with relative
  `:param file` paths. The rendered statement *bodies* are byte-identical (pinned by the
  goldens), but the artifacts are not interchangeable.

Closing these needs upstream work in agora, not in pinakes: a TSV→graph **parser**, a
**schema-parameterized** writer, a **fact-level** render surface, and a **rule-aware** one.
agora:60 is complete and retired, so that is a *new* agora story rather than a pending
decision — do not re-derive it by hand. `engine/tests/test_engine_surface.py` pins the eight
renderers and one row per missing capability; it fails the day any of them lands and names
what became completable. `engine/tests/test_engine_packaging.py` does the same for the
macOS-only wheel that blocks the sidecar image.

## TSV read-only mode

This project is currently running in a **TSV-backed, read-only mode**. The PostgreSQL/Drizzle-backed features were removed or disabled to simplify initial usage and allow the app to run without `DATABASE_URL`.

The dormant plumbing that survived that removal is now gone too (`10-foundation-cleanup`
US-2): `drizzle.config.ts`, `server/db.ts`, the `pgTable` schema in `shared/schema.ts`, the
two drizzle-only seeders (`server/services/{etymology-explorer,vocabulary-expander}.ts`,
neither of which was imported by any route), the stub `db:push` / `db:generate` / `db:migrate`
scripts, and the `drizzle-orm` / `drizzle-zod` / `drizzle-kit` / `pg` / `@neondatabase/serverless`
/ `connect-pg-simple` / `express-session` dependencies. Persistence is TSV + Neo4j + files;
there is no `DATABASE_URL` any more. The record shapes the geospatial converters still need
moved to `shared/types.ts` as plain TypeScript types.

## Supported API Endpoints

- `GET /api/languages`
- `GET /api/languages/:id`
- `GET /api/language-families`
- `GET /api/language-families/tree`
- `GET /api/base-words`
- `GET /api/stats`

## Removed / Disabled Server Features

- WebSocket scraping progress updates (`/ws`)
- Scraping jobs endpoints (`/api/scraping-jobs`)
- Database normalization endpoints
- Language family scraping endpoints
- Word translation write endpoints
- Word comparison endpoint
- Etymology / migration endpoints
- Language evolution timeline endpoints
- User contribution endpoints
- AI translation context generation endpoints
- Search filters endpoints

## Removed / Disabled Client Features

These UI panels/components were disabled for TSV mode (and excluded from TypeScript compilation for now):

- Advanced search filters UI
- AI translation context UI
- Database normalizer UI
- Language evolution timeline UI
- Language map UI
- User contribution UI

## How to Re-enable Later

Reintroducing the removed features will require:

- Restoring a real storage layer for writes (DB or a TSV/JSON write model)
- Re-adding endpoints in `server/routes.ts`
- Re-adding a concrete storage implementation that supports mutations
- Re-enabling the corresponding client components and wiring
