# Blueprints — the domain catalog

A **blueprint** (`blueprints/<domain>.yml`) is the compact source from which a
whole domain's categories and runnable job are generated. Rather than
hand-writing a `categories/<id>.yml` per Wikidata class, a blueprint declares the
defaults a domain shares once (label, dimensions, links) and then lists one short
**stub** per category. `culturescrape generate` expands every stub into a full,
validated `categories/<id>.yml` and an optional `jobs/<domain>.yml` that runs the
lot end to end.

This page is the catalog of what ships, and the recipe for adding more. The
schema reference for the blueprint file itself lives in
`culturescrape.orchestrate.generate`; the category schema each stub expands to is
in [`docs/data-model.md`](data-model.md).

## The shipped library

Eleven verified domain blueprints ship today, expanding to **111 categories**
across the corpus. Every class was verified live against the Wikidata Query
Service (the `# ~N` entity count after each stub is that observed value);
classes that resolve to zero entities are not shipped.

| Blueprint | Categories | Dimensions | Signature relationships |
|---|---:|---|---|
| [`architecture`](../blueprints/architecture.yml) | 14 | temporal, geographic | `LOCATED_IN` |
| [`conflicts`](../blueprints/conflicts.yml) | 14 | temporal, geographic | `LOCATED_IN` |
| [`food-drink`](../blueprints/food-drink.yml) | 14 | temporal, geographic, linguistic | `ORIGINATES_FROM` |
| [`language`](../blueprints/language.yml) | 5 | geographic, linguistic | — (taxonomy only) |
| [`living-traditions`](../blueprints/living-traditions.yml) | 9 | temporal, geographic, linguistic, genetic | `PART_OF_PERIOD`, `CONTEMPORARY_WITH`, `ORIGINATES_FROM`, `VARIANT_OF`, `DERIVED_FROM` |
| [`material-culture`](../blueprints/material-culture.yml) | 7 | temporal, geographic, linguistic, genetic | `MADE_OF`, `ORIGINATES_FROM` |
| [`music`](../blueprints/music.yml) | 6 | temporal, geographic | — (taxonomy only) |
| [`myth-religion`](../blueprints/myth-religion.yml) | 12 | geographic, linguistic | `ORIGINATES_FROM` |
| [`science-tech`](../blueprints/science-tech.yml) | 6 | temporal, geographic, linguistic, genetic | `DERIVED_FROM`, `INFLUENCED_BY`, `VARIANT_OF` |
| [`sports-games`](../blueprints/sports-games.yml) | 10 | temporal, geographic, linguistic, genetic | `VARIANT_OF`, `DERIVED_FROM`, `ORIGINATES_FROM` |
| [`visual-art`](../blueprints/visual-art.yml) | 14 | temporal, geographic | `CREATED_BY`, `ORIGINATES_FROM` |

[`blueprints/example.yml`](../blueprints/example.yml) is a small worked example
(4 categories) kept as documentation; it is not part of the seed corpus.

Every link `:TYPE` above is registered in
[`src/culturescrape/ontology/registry.py`](../src/culturescrape/ontology/registry.py)
— the single source of truth the linkers, exporters, and validators all read. An
edge whose `:TYPE` is not registered is rejected, so a blueprint cannot mint an
orphan relationship.

The new genetic-lineage domains (`science-tech`, `sports-games`,
`material-culture`, `living-traditions`) are exercised by domain-specific queries
on both query sides: see [`cypher/`](../cypher/) (e.g. `invention-lineage.cypher`,
`game-family-variants.cypher`, `material-composition.cypher`,
`contemporary-with.cypher`) and the mirroring
[`datalog/examples/`](../datalog/examples/) programs.

## Authoring a new blueprint

The whole flow is offline and end-to-end — no human hand-off, no placeholders.

1. **Pick a domain and find its Wikidata classes.** Each category is one class.
   Use `instance of` (`wikidata_class`, queried as `wdt:P31`) for a flat class
   such as *board game* (`Q131436`), or `subclass_of` (queried as `wdt:P279+`)
   for a taxonomy such as *martial arts* (`Q11417`). A stub may instead carry raw
   `query` (SPARQL) or `petscan` (a Wikipedia category tree). Set exactly one
   source selector per stub.

2. **Verify the classes resolve to entities.** Record each stub's live count as
   the trailing `# ~N` comment the shipped blueprints carry. `generate
   --verify` (CLI-wired to the Query Service) refreshes these counts and refuses
   any class that resolves to zero entities, naming the offending stub. Skip
   classes that come back empty.

3. **Choose dimensions and links.** Dimensions must be drawn from the four valid
   axes — **temporal, geographic, linguistic, genetic**. Every link `:TYPE` must
   already be registered in `registry.py`; if the domain needs a genuinely new
   relationship, register it there first (with its `Dimension`, domain/range
   labels, and symmetric/transitive flags) before any stub mints it.

4. **Write the blueprint.** Put the domain's shared `label`, `dimensions`, and
   `links` under `defaults:`, then one stub per category under `categories:`.
   Per-stub keys override the defaults. See
   [`blueprints/example.yml`](../blueprints/example.yml) for the minimal shape.

5. **Generate the categories and job:**

   ```sh
   culturescrape generate blueprints/<domain>.yml \
       --out categories --job jobs/<domain>.yml
   ```

   This writes a validated `categories/<id>.yml` per stub and a runnable
   `jobs/<domain>.yml`. Regenerating an unchanged blueprint is idempotent (no
   spurious diffs). Run the domain with `culturescrape run jobs/<domain>.yml`.

6. **Wire it in.** Add the domain to the table above and, if it belongs in the
   default end-to-end run, to [`jobs/seed-corpus.yml`](../jobs/seed-corpus.yml).
   Add at least one Cypher and one Datalog example exercising its signature
   relationship.

## The guard

[`tests/test_blueprint_catalog_smoke.py`](../tests/test_blueprint_catalog_smoke.py)
is the offline smoke test that keeps the growing library from silently rotting.
Without any network it asserts that **every** blueprint generates, **every**
generated category passes `load_category`, **every** minted link `:TYPE` is
registered, **every** dimension is valid, and **every** shipped job parses.
Per-domain suites (`tests/test_blueprint_*.py`) cover each domain's required
slices; `tests/test_shipped_jobs.py` covers the jobs in detail. Dropping a new
`blueprints/<domain>.yml` in is automatically covered — there is no per-domain
test to remember to add for the catalog-wide guarantees.
