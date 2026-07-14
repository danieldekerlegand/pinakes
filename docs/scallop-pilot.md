# Scallop context export + Horn-rule translation

NEUROSYMBOLIC_ROADMAP.md **Phase 5, US-001** (roadmap row 5.4) — the first step of
the neurosymbolic pilot. Loads the canonical corpus into
[Scallop](https://scallop-lang.org) as its differentiable-logic substrate: the
relations become Scallop fact tables, the provenanced Horn-rule registry is
translated to a `.scl` program, and a scallopy smoke run proves the round trip.

- **Pure core (engine-free):** `ml/src/linguascrape_ml/scallop.py`
- **CLI:** `uv run linguascrape-export-scallop`
  (`ml/src/linguascrape_ml/export_scallop.py`)
- **Inputs:** the DVC-tracked canonical edge export
  (`export/culturescrape/edges/*.tsv`) + the committed rules registry
  (`packages/culture-scrape/src/culturescrape/datalog/rules_registry.tsv`)
- **Committed artifacts:** the translated program `ml/scallop/program.scl` and the
  snapshot manifest `ml/manifests/scallop-export-manifest.json`
- **DVC-tracked artifacts (git-ignored):** the interned relation CSVs +
  symbol table under `ml/data/scallop/`

## What the export produces

```
uv run linguascrape-export-scallop
```

1. **Interned relations.** Every edge `:TYPE` becomes a lower-cased binary
   predicate (`DESCENDS_FROM` → `descends_from`); the deduplicated `(head, tail)`
   pairs are written as **interned integer** CSVs
   (`ml/data/scallop/relations/<rel>.csv`, `head_id,tail_id`) against a
   deterministic `csid → int` symbol table (`ml/data/scallop/symbols.tsv`, sorted
   vocab → index). Interning is byte-reproducible: a byte-identical corpus yields
   the same ids.
2. **Translated program.** The registry Horn rules are translated to Scallop
   `rel` clauses in `ml/scallop/program.scl` — a pure function of the committed
   registry, so it is committed to git and CI-checked against a fresh translation.
3. **Manifest.** `ml/manifests/scallop-export-manifest.json` records the interning
   / relation counts, the translated + skipped rule ids, and the smoke reference
   derivations (below). Deterministic (no wall-clock) → a corpus/registry change is
   what moves it.

Today's corpus: **8 relations / 2,267 facts / 2,057 symbols**, **51 rules
translated, 1 skipped**.

## How the translation works

A pure Horn clause — a head and positive predicate literals over *variables*, plus
comparison guards (`<`, `>=`, `!=`, …) and stratified negation — is expressible
identically in Soufflé and Scallop; only the surface syntax differs:

| Soufflé (registry `clause_souffle`)        | Scallop (`.scl`)                          |
| ------------------------------------------ | ----------------------------------------- |
| `ancestor(X, Y) :- descends_from(X, Y).`   | `rel ancestor(x, y) = descends_from(x, y)` |
| `… :- descends_from(X, Z), ancestor(Z, Y).`| `rel ancestor(x, y) = descends_from(x, z) and ancestor(z, y)` |
| `… , !from_ok_x(X, Y).`                    | `… and not from_ok_x(x, y)`               |
| `… , Ex < Sy.`                             | `… and ex < sy`                           |

Upper-case variables → lower-case, `:-` → `=`, `,` → `and`, `!p` → `not p`. The
registry stores the **Soufflé** clause text (the most complete dialect — it carries
the negation the Prolog column omits), so we translate from that column.

**The one translatability constraint is `every predicate literal must be binary`** —
exactly the constraint culture-scrape's own materializer imposes
(`datalog/rules.py` `ARITY == 2`). The single registry rule that breaks it,
`csid_uniqueness_violation` (reads the arity-3 `node/3`), is **skipped and reported**
in the manifest's `skippedRules`, never silently dropped. Non-`active` rules are
dropped by governance (status), not counted as translation failures.

Base predicates a rule reads but no corpus edge populates (`instance_of`,
`subclass_of`, `time_start`, …) are declared `type …` in the `.scl` so a body over
an unpopulated relation compiles and answers empty rather than erroring — the same
"a rule over an absent base relation answers false, not an error" stance as the
Prolog/ProbLog emitters. The temporal dimension predicates `time_start`/`time_end`
are typed `(String, i32)` so the arithmetic guards type-check.

## The scallopy smoke run — and why it is local-only here

```
uv run linguascrape-export-scallop --smoke
```

Loads the program into `scallopy`, answers **`ancestor/2`** and the cross-domain
**`influenced_transitively/2`** (the closure of `derived_from ∪ influenced_by`)
over the real corpus, and asserts the derived extensions equal the **engine-free
reference derivation** (`scallop.reference_derivations`, a naive-fixpoint transitive
closure with the same semantics as culture-scrape's materializer). Today's
reference: `ancestor` = **3,196** derived pairs from 1,683 `descends_from` facts;
`influenced_transitively` = **510** from 115 facts. A disagreement raises
`AssertionError` — this is the acceptance's "spot-checked against the
materializer/engine output for agreement".

> **GOTCHA — `scallopy` does not install on this host.** Its only published wheel
> (`scallopy==0.1.0`) targets **macOS/arm64 + CPython 3.9**; it does not resolve on
> Linux or on this workspace's Python 3.11 (`pyproject.toml` documents why it is an
> undeclared dependency). So `--smoke` is a **local-only** path on a compatible Mac,
> gated by `require_scallop_deps()` (which runs in CI, where the dep is absent, to
> assert the error message is actionable). Install it with
> `uv pip install scallopy` on a compatible interpreter. The pure export +
> translation — and the reference derivation the smoke checks against — need none of
> this and run everywhere, so the smoke's *logic* is validated in CI without the
> engine.

## Tests

- **Fixture unit tests** (CI-safe): corpus loading, interning, clause/registry
  translation (recursion, comparison, negation, string constants, the non-binary
  skip), program emission, the reference derivation, and the `require_scallop_deps`
  gate — `ml/tests/test_scallop.py`.
- **Committed-artifact gate** (CI-safe, corpus-independent): `ml/scallop/program.scl`
  and the manifest's translated/skipped rule lists must equal a fresh translation of
  the *real* registry — a hand-edited program or a registry drift fails CI.
- **Live reproducibility gate** (`skipif` the DVC export is absent → skips in CI):
  the committed manifest must equal a fresh build of the live corpus + registry.

## Regenerating

After a corpus change (re-exported edges) or a registry change (new/edited rule),
re-run `uv run linguascrape-export-scallop`, then re-pin the data
(`uv run --project ml dvc add ml/data && uv run --project ml dvc push`) and commit
`ml/data.dvc` alongside the updated `ml/scallop/program.scl` +
`ml/manifests/scallop-export-manifest.json`.
