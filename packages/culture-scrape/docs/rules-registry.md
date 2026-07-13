# The provenanced rules registry (rules-layer US-004)

Facts in this project carry provenance (`source`, `source_url`, `retrieved_at`,
`confidence`) and flow through a QA gate before they reach the graph. Rules — the Horn
clauses that make the logic program worth more than the TSV it came from — did not: they
were Python string literals in `datalog/rules.py`, plus two independent draft registries
for the generated (Wikidata / schema) rules. This document describes the unified
**rules registry** that gives rules the same discipline facts have.

## What it is

`datalog/registry.py` **wraps** the three rule sources into one provenanced table,
committed at `datalog/rules_registry.tsv`:

| layer               | source           | where the clauses live                                   | version                       |
| ------------------- | ---------------- | -------------------------------------------------------- | ----------------------------- |
| `curated`           | `curated`        | `datalog/rules.py` (`RULES`) — hand-written closures     | `RULE_LIBRARY_VERSION` (1.0.0)|
| `wikidata-property` | `wikidata`       | `datalog/constraints.py` (P2302 translations, US-002)    | acquisition snapshot (`retrieved_at`) |
| `canonical-schema`  | `canonical-schema` | `datalog/schema_constraints.py` (from/to violations, US-003) | schema version            |

Each row carries: `rule_id`, `layer`, `head`, `clause_prolog`, `clause_souffle`,
`depends`, `source`, `source_url`, `retrieved_at`, `confidence`, `version`, `status`.
A rule emitted to a single engine leaves the other dialect's clause blank (the schema
violation rules are Soufflé-only); a dialect-neutral rule fills both identically.

The registry is a **generated, committed artifact** (the same pattern as the taxonomy /
constraint replay artifacts and the materialization manifest): `build_registry()`
aggregates the three sources deterministically, and a test pins the committed TSV to it.
Regenerate after changing any rule or its provenance:

```
culturescrape rules-registry --regenerate
```

The curated rules keep their clauses in `rules.py` — its `Rule` objects carry the rich
`intent`/`example` docstrings that drive the emitted programs' comment blocks — and the
registry **wraps** them with governance metadata (`CURATED_RULE_META`, keyed by rule
head). The registry is the governance source of truth; `rules.py` remains the clause
source for the curated layer.

## The QA gate

`validate_registry(entries)` checks the registry is **well-formed** and returns a list
of problems (empty ⇒ clean). It verifies:

- **unique, non-empty rule ids** and a valid lifecycle `status`;
- **parseable clauses** — balanced parentheses, a head plus a body of `pred(args)`
  literals or comparison guards (`Ex < Sy`, `N != M`); a rule with no clause in either
  dialect is rejected;
- **known predicates** — every body predicate is a rule head defined in the registry, a
  base projection predicate (`node`/`instance_of`/`subclass_of` or another projected
  relation), or one of the entry's own declared `depends`; the head predicate matches
  the `head` column;
- **no arity conflicts** — no predicate is used at two different arities anywhere in the
  registry.

It runs in CI (`tests/test_datalog_registry.py::test_committed_registry_is_well_formed`)
and from the CLI:

```
culturescrape rules-registry            # validate the committed registry + summary
culturescrape rules-registry --json out.json
```

`rules-registry` (no `--regenerate`) also confirms the committed TSV is **in sync** with
a fresh build, so a rule edited without regeneration fails the gate too.

## The lifecycle

A rule's `status` moves through:

```
proposed  →  active  →  retired
                │
                └─ redundant   (a generated rule whose clause duplicates a curated one)
```

- **`proposed`** — drafted, recorded for provenance, **not** attached to programs.
- **`active`** — attached and emitted to the logic program.
- **`retired`** — withdrawn; kept in the registry for provenance, never emitted.
- **`redundant`** — a generated (property/schema) rule whose clause duplicates a curated
  one; recorded so the duplication is visible, but not emitted (the constraint layer
  marks these when a translated clause already ships in `RULES`).

### How the exporter consumes the status

The datalog exporter attaches the curated closures through
`registry.active_curated_rules()`, which drops any curated rule whose
`CURATED_RULE_META` status is not `active`. Retiring a curated rule is therefore a
one-line edit — set its status in `CURATED_RULE_META` — plus a registry regeneration; the
rule's `rules.py` definition is never deleted, so the provenance and clauses survive.
With the default (empty) overrides every curated rule is `active`, so the emitted program
is byte-for-byte unchanged. The property- and schema-constraint layers already gate their
own emission on `status == "active"` (`TranslationResult` and `souffle_rules`), so the
same lifecycle governs all three sources.

## Regeneration checklist

After changing a rule or its provenance, regenerate the committed registry so its pin
test stays green:

1. `culturescrape rules-registry --regenerate` (rewrites `datalog/rules_registry.tsv`).
2. If the change was to a generated layer, regenerate that layer's own draft artifact too
   (`constraints/rules_registry.tsv` / `schema/rules_registry.tsv` — see `docs/datalog.md`).
3. Run `uv run pytest tests/test_datalog_registry.py` (validation + pin + gate).
