# Schema-constraint violations (rules-layer US-003)

The canonical schema ([`contracts/canonical-schema.json`](../../contracts/canonical-schema.json))
declares, per edge type, which node `:LABEL`s its endpoints may carry (`from` / `to`),
whether the type is `symmetric`, and — schema-wide — that a `csid` identifies exactly one
node. [`pinakes_engine.datalog.schema_constraints`](../src/pinakes_engine/datalog/schema_constraints.py)
compiles those declarations into Soufflé **violation rules** and an engine-free evaluator;
see [`datalog.md` § Schema constraints](datalog.md) for the mechanism.

This doc is the **triage** half of the acceptance criterion: what the current corpus
violates, and what to do about it.

## Current violations (full pinakes corpus)

Regenerated with
`pinakes_engine schema-constraints build/corpus --json docs/schema-constraints-report.json`;
the machine-readable enumeration (counts + sampled offenders with their `:LABEL`s) is
[`schema-constraints-report.json`](schema-constraints-report.json). The corpus and its
canonical export are gitignored (non-reproducible bytes), so — like
[`datalog-materialization-manifest.json`](datalog-materialization-manifest.json) — the report
is a committed **release record**, not a live-asserted snapshot: regenerate it after a corpus
rebuild.

| Violation relation | Count | Triage |
| --- | ---: | --- |
| `descends_from_from_type_violation` | 45 | Every offender is a `WritingSystem → WritingSystem` `descended-from` edge (a script descended from a parent script, from `writing-systems.tsv` `parent_system_id`). The schema's `descended-from` `from`/`to` lists `language`, `language-family`, `culture`, `archaeological-culture` — **not `writing-system`**. |
| `descends_from_to_type_violation` | 45 | Same 45 edges, failing on the `to` endpoint. |
| everything else | 0 | Clean. |

### Resolution (follow-up, not this story)

The 45 `WritingSystem`-descent edges are a genuine **schema-vs-data** mismatch, resolvable
two ways — both a schema change with snapshot regeneration, out of scope for the rules layer
that only *surfaces* the mismatch:

1. **Widen the schema** — add `writing-system` to `descended-from`'s `from`/`to` in
   `contracts/canonical-schema.json` (script genealogy is a legitimate descent). Then the
   violations drop to 0 and the baseline is re-ratcheted downward.
2. **Retype the edges** — mint a dedicated `script-derived-from` edge type for writing-system
   genealogy and re-point the `writing-systems.tsv` edges to it.

Until then the count is the **ratchet baseline**: it must never increase.

## The ratchet

`pinakes_engine schema-constraints <dataset> --baseline docs/schema-constraints-report.json`
exits non-zero if any violation relation's count exceeds its baseline (a newly-appearing
relation is treated as baseline 0). Run it after any change that touches the schema, the edge
vocabulary, or the corpus — a widened schema constraint or a new mistyped edge both surface
here. The generator + evaluator that back the ratchet are guarded in CI by
`tests/test_datalog_schema_constraints.py` (engine-free assertions plus a `souffle`-gated run
that the real engine agrees), so a regression in the *compilation* fails CI even though the
gitignored corpus does not.

## Rule lifecycle

The compiled rules carry provenance (`source = canonical-schema`, `source_url`,
`schema_version`, `confidence = 1.0`) into the draft registry
[`datalog/schema/rules_registry.tsv`](../src/pinakes_engine/datalog/schema/rules_registry.tsv).
Rules-layer US-004 unifies this draft with the property-constraint registry and the
hand-written `rules.py` library under one governed `proposed → active → retired` lifecycle;
today every schema rule is `active` (the schema is the source of truth, so its constraints are
always in force). Regenerate both `datalog/schema/edge_constraints.tsv` and
`datalog/schema/rules_registry.tsv` together after a schema change (a test ties the first to
`contracts/canonical-schema.json` and the second to the generator).
