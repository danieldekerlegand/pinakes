# datalog/ — engine-neutral logic projection

TSV is the source of truth; this package is a **derived, mechanical projection**
of it into Prolog (`.pl`) and Soufflé (`.dl`). The layers stack:
`__init__.py` (Fact/render) → `nodes.py`/`edges.py` (project rows to facts) →
`rules.py` (shared inference rules) → `prolog.py`/`souffle.py` (emit) →
`export.py` (`collect_facts` + `export_dataset`) → `examples.py` (shipped `.pl`
queries + offline linter). `culturescrape to-datalog … --rules` attaches `RULES`.
`materialize.py` (`materialize`/`summarize`) is the **engine-free evaluator** that
computes the rules' derived extension without swipl/souffle.

## The export is streaming, not slurping (T-SR-US-002)

Peak memory is bounded by ONE row + the small per-predicate type/signature table,
never the corpus. Keep it that way when editing the emit path:

- **`collect_facts(dir)` returns a re-iterable lazy stream** (`_DatasetFacts`), NOT
  a list — `for f in collect_facts(...)` re-reads `nodes/*.tsv` then `edges/*.tsv`
  each time. `node_file_facts`/`edge_file_facts` are **generators** now (they
  `yield from` per row via `schema.tsvio.open_rows`); don't `+`-concatenate them or
  call `len()` — wrap in `list(...)` / `sum(1 for _ in ...)` if you truly need eager.
- **The streaming writers iterate the fact source MORE THAN ONCE** (prolog:
  signatures then clauses; souffle: type inference then row sharding; souffle_program
  also renders the `.dl`). So they REQUIRE a re-iterable source (a list, or
  `collect_facts`), never a one-shot generator — the docstrings say so. Each pass is a
  fresh disk read (IO for RAM); `export_dataset` running both engines re-reads ~5×.
- **Byte-identity is the invariant.** `write_program` streams line-by-line to the
  file but must stay byte-for-byte equal to `render_program` — both build the SAME
  line sequence via shared `_preamble_lines`/`_rule_lines`, and `write(line+"\n")`
  per line == `"\n".join(lines)+"\n"`. `write_souffle_facts` writes rows to per-relation
  handles in fact order == the old grouped order (rows within a file keep source
  order). Tests `write_* == render_*` enforce this — never let them drift.
- **Validate the O(1) property empirically**, not by eyeballing: a `tracemalloc`
  peak over a synthetic corpus at 12k/120k/1.2M facts must stay flat (~2.3 MB) while
  `graph.pl` grows to 55 MB. The old list+join path was 606 MB at 1.2 M facts. See
  the table in `docs/datalog.md` "Streaming, not slurping".

## Queryable provenance facts (T-SR-US-004)

Every projected fact keeps its `source` as a trailing `% source:` / `// source:`
comment (arity-stable), but a comment can't be queried. So `nodes.py`/`edges.py`
**also** emit provenance as first-class facts, one per row that carries a source:

- `source(Csid, Source)` — appended by `node_facts` (keyed by csid).
- `rel_source(Type, Start, End, Source)` — appended by `edge_facts`, mirroring the
  `rel_conf/4` companion (same `predicate_for_type` type atom as `rel`/`rel_conf`).

Rules that matter when touching these:
- **A blank `source` emits neither fact** (`if source is not None:`), same "no null
  reaches the logic program" rule as the dimension/`rel_conf` companions.
- **The provenance fact itself carries `source=source`**, so it renders with the
  (redundant-but-uniform) trailing comment and the "every fact carries its source"
  invariant holds — `test_source_rides_along_as_provenance` asserts it, so don't
  switch it to `source=None`. Its `render()` is `source('cs:x', wikidata).  % source: wikidata`.
- **No emitter/materializer change needed.** `prolog.py`/`souffle.py` render any
  `Fact` and declare `(name, arity)` from the facts present; `materialize.py` stores
  `source/2` harmlessly (it's not a rule head, so it's dropped from the result) and
  skips `rel_source/4` (only binary facts are stored). `souffle_relations` types
  both as all-`symbol`.
- **`source`/`rel_source` are in `examples.KNOWN_PREDICATES`**, so a query naming
  them lints clean (`entities-by-source.pl` joins `source/2` to `node/3`).
- These are additive: the fixture fact-set tests (`test_datalog_{nodes,edges}.py`)
  pin exact sets, so adding/removing a projected fact means updating those sets and
  the `edge_facts` render doctest in `docs/datalog.md`.

## Materializing rules without an engine (US-004)

`materialize(facts, rules=RULES)` runs a naive-fixpoint Datalog evaluator over the
projected `Fact`s and returns each rule head's derived tuple set; `summarize(...)`
adds the base-relation counts and yields a `MaterializationSummary` whose
`to_json()` is what `culturescrape datalog-materialize <dataset> --json` writes.
Use it to count/validate the inference targets (`contemporary`/`precedes`/`follows`
over time bounds, `same_region`, `ancestor` = transitive `descends_from`,
`genetic_linguistic_correlation`) in CI — no engine is installed. Constraints the
evaluator relies on (and that any new rule must keep, same as the emitters): every
**predicate** literal is binary (`ARITY == 2`) and bodies are Horn over variables
(upper-case-initial / `_`) or constants, **plus comparison guards** (`Ex < Sy`) —
the evaluator keeps fact args in their native type so numeric comparisons are
numeric, and applies the guards as a filter once their operands are bound. A
non-binary *predicate* literal or a fact-shaped clause raises `MaterializeError`;
a comparison over a still-unbound variable is an unsafe rule and also raises.

- The full-corpus derivation is a committed **release record**
  (`docs/datalog-materialization-manifest.json`), not a CI-tested snapshot — the
  corpus is gitignored and its bytes are non-reproducible (like
  `docs/corpus-release-manifest.json`). Regenerate it with the CLI after a rebuild.
- **The temporal rules are `--exclude`d from the full-corpus manifest (US-005).**
  `contemporary`/`precedes`/`follows` derive from `time_start`/`time_end` (US-001).
  The naive-fixpoint materialiser recomputes their ~O(n²) span-overlap join **every
  round**, so at full-corpus scale (~1k dated entities → ~10⁶ pairs) it does not
  finish in minutes — the very explosion US-001 removed from stored edges. Regenerate
  with `datalog-materialize --exclude contemporary precedes follows`; the excluded
  heads are recorded under `engine_only` in the manifest JSON and a real swipl/souffle
  derives them lazily. The structural rules (`same_region`/`ancestor`/`within_region`/
  `influenced_transitively`/`component_of`) materialise in ~1 s and stay in the manifest.
  `--exclude` rejects an unknown head; without it the CLI materialises every rule (the
  small-fixture path — tests + doctests — is unchanged).
- `genetic_linguistic_correlation` derives **0 over the LinguaScrape-only corpus**
  (no genetics/haplogroup source → no `originates_from`/`spoken_in` edges). It is
  exercised on the bundled fixture, which carries ported `source: linguascrape`
  genetics facts. Don't "fix" the 0 — it's a data property, not a bug.
- Tests pin the evaluator's exact extensions on the small bundled dataset
  (`tests/test_datalog_materialize.py`); those counts are stable because the fixture
  node/edge counts are themselves pinned (see the shared-fixture GOTCHA below).

## ProbLog probabilistic emitter (US-004)

`problog.py` is the third engine target (`to-datalog --engine problog` →
`graph.problog.pl`). ProbLog is Prolog-with-annotated-facts, so it **reuses**
`render_fact(..., Dialect.PROLOG)` for atom quoting/escaping — the only new syntax
is the `W::` probability prefix. Design rules if you touch it:

- **Confidence → probability on the EDGE relation.** `annotate_edge_group` lifts
  the `rel_conf/4` confidence onto `rel/3` and the typed `t/2` (`W::rel(...)`);
  companions (`rel_conf/4`, `rel_source/4`) and all node/dimension facts stay
  **certain** (unannotated). Confidence `1.0` or absent → unannotated (there's no
  point writing `1.0::`). Out-of-`[0,1]` → `ProblogError` (validate, don't emit
  invalid syntax — same philosophy as `render_predicate`).
- **ProbLog has NO directives.** `:- dynamic`/`:- discontiguous`/`:- table` all
  raise `ParseError` in the pure-Python problog parser — the program is header +
  facts + rules only. Verified empirically before relying on it.
- **GOTCHA — ProbLog raises `UnknownClause` when a query grounds through a
  zero-clause predicate**, and there's no `:- dynamic` to pre-declare one. So with
  `--rules`, `_base_predicate_stubs` emits `pred(_, _) :- fail.` for every base
  predicate the rules read that isn't itself a rule head (a never-firing clause =
  "defined but empty"). This is the ProbLog analogue of prolog.py's `:- dynamic`.
  Without it, a query over e.g. `originates_from`/`spoken_in` on a sparse graph
  errors instead of answering `0`.
- **Rules are ProbLog-compatible verbatim** — the shared Horn clauses AND the
  comparison guards (`<`, `>`, `>=`) parse/evaluate identically, so `render_rule`
  in the Prolog dialect is reused. Recursive closures over a *probabilistic cyclic*
  base relation can be expensive to ground; that's a query-time concern, not the
  emitter's — it just emits the rules.
- **No double-pass / signatures.** Unlike prolog.py (which iterates twice for
  directive signatures), problog needs no directives → single pass; `write_ ==
  render_` byte-identity still holds via a shared line list.
- **`problog` is a TEST dep** (in the `dev` extra + a `[[tool.mypy.overrides]]`
  ignore-missing-imports, mirroring neo4j). The emitter imports NOTHING from
  problog — it only writes text. Tests `pytest.importorskip("problog")` and
  compute a marginal over a fixture (the CI "problog computes a marginal" gate).
- **`collect_problog_facts` reuses `export.collect_facts`** for discovery/validation
  (imported lazily inside the fn to avoid an import cycle: export imports problog).
  `Engine.PROBLOG` is opt-in — `engines_for_choice("both")` stays swipl+souffle.

## Class taxonomy: subclass_of/2 + the EDB∪IDB instance_of closure (rules-layer US-001)

`instance_of/2` is the one rule whose head is **also a base relation** — nodes
project `instance_of(Csid, Label)` facts (a `:LABEL`) AND the rule
`instance_of(X, C) :- instance_of(X, D), subclass_of(D, C)` extends it up the P279
taxonomy. Consequences every emitter/materialiser already handles (don't re-break):

- **Prolog:** a recursive head with facts is `:- table` **+** `:- discontiguous`
  (facts interleave by row) but **never** `:- dynamic` (SWI forbids dynamic+table).
  `prolog._preamble_lines` takes `fact_signatures` to keep the two sets straight —
  a tabled sig that is also a fact sig lands in the discontiguous block. A rule-less
  or fact-less program is byte-for-byte unchanged (the overlap only fires when
  instance_of facts AND `RULES` are both present).
- **Soufflé:** the fact block already emits `.decl`/`.input`/`.output instance_of`;
  `_render_rules` skips re-declaring a predicate already `declared` by facts, so the
  relation is loaded (`.input`) AND derived (rule) — the standard Soufflé EDB∪IDB
  union. Verified by the `souffle`-gated closure test in `test_datalog_taxonomy.py`.
- **Materialiser:** `materialize` seeds the store with base facts then adds derived
  tuples to the SAME head set, so `derived_relations["instance_of"]` is base ∪
  closure (base `:LABEL` typing PLUS ancestor memberships) — expected, noted in the
  manifest. `_base_relations` = deps − heads, so `instance_of` (a head) is not
  double-counted as a base relation; `subclass_of` is.

The `subclass_of` facts come from a **committed replay artifact**
(`datalog/taxonomy/subclass_of.tsv`, provenanced), NOT the corpus:
`datalog/taxonomy.py` reads it, `acquire/taxonomy.py` extracts it from Wikidata
P279 (WDQS `wdt:P279*` **or** the dump index's `class_closure`) among the corpus's
`:LABEL` classes (`CORPUS_CLASS_QIDS`). Only **direct** label→label edges are
stored — the recursion climbs each chain one hop at a time through the *derived*
`instance_of`, so a 3-level chain needs only its two direct hops. Regenerate the
artifact from the extractor (a fixture ancestor-lookup encodes the real P279 facts;
`test_extractor_reproduces_the_committed_artifact` ties the two together).

- **Opt-in, coupled to `--rules`.** `collect_facts(dir, include_taxonomy=True)`
  appends the subclass_of facts; `export_dataset(include_rules=True)` and
  `datalog-materialize` set it. Default is off, so every count pinned against the
  plain fact stream (`test_datalog_export`, the fixture node/edge counts) is
  unchanged — the taxonomy facts only appear WITH the closure rule that consumes them.
- **New backing class?** Add the `:LABEL → class QID` entry to `CORPUS_CLASS_QIDS`
  (omit a label whose Wikidata class is ambiguous — the taxonomy is only as sound as
  this map), re-extract, and re-commit the TSV. `subclass_of` is already in
  `examples.KNOWN_PREDICATES`, so a query naming it lints clean.

## Property-constraint rules: symmetric / inverse / integrity (rules-layer US-002)

`constraints.py` translates Wikidata `P2302` property constraints into rules, read
from the committed replay artifact `datalog/constraints/property_constraints.tsv`
(written by `acquire/constraints.py`; all Wikidata↔corpus resolution is baked into
its columns, so `datalog` never imports `acquire`). `translate()` →
`TranslationResult(rules, skipped)`; `constraint_file_rules()` loads+translates the
committed artifact. Emitted behind `to-datalog --constraints` / `export_dataset(
include_constraints=True)`.

- **A `ConstraintRule` is NOT a `Rule`** — it carries provenance (`constraint_statement_id`,
  `retrieved_at`, source/confidence, `status`) and **per-engine** clause tuples, and
  yields a plain `Rule` via `.prolog_rule()` / `.souffle_rule()` (either may be `None`).
  This is how a rule reaches ONE engine with dialect-specific text (negation) while
  reusing all the existing emitter machinery — the emitters render any `Rule` verbatim,
  so a `Rule` whose clause is `... :- t(X,Y), !instance_of(Y,"C").` emits fine for
  Soufflé, and the byte-identical-across-dialects invariant (a test over `RULES` only)
  is untouched because these rules are not in `RULES`.
- **Three translations, engine split:** *symmetric* (`Q21510862`) → `t(X,Y):-t(Y,X).`
  to BOTH engines (self-recursive → auto-tabled in Prolog, safe); *inverse* (`Q21510855`)
  → `t(X,Y):-u(Y,X).` **Soufflé-only** (an inverse pair mutually recurses `t:-u`,`u:-t`;
  Soufflé fixpoints it, but untabled SWI SLD would loop — the single-rule `is_recursive`
  tabling heuristic can't see cross-rule recursion); *subject/value-type*
  (`Q21503250`/`Q21510865`) → a violation head `t_{subject,value}_type_violation(X,Y):-
  t(X,Y), !instance_of({X,Y},"C").` **Soufflé-only** (stratified negation over the
  `instance_of` closure). So `export_dataset` passes DIFFERENT rule sets per engine
  (`translation.prolog_rules()` = symmetric only; `.souffle_rules()` = all active).
- **`--constraints` implies the rule library** (`attach_rules = include_rules or
  include_constraints`) because the integrity rules negate over the *transitive*
  `instance_of` — the P279 closure + taxonomy facts must be present. ProbLog gets the
  base `RULES` but no constraint rules (it has no negation / no `:- table`).
- **Skipped-and-reported, never guessed:** an untranslatable constraint type, an inverse
  whose target property isn't in `EDGE_PROPERTY_PIDS` (blank `inverse_edge_type`), or a
  type constraint whose class isn't a corpus `:LABEL` (blank `class_label`) → a
  `SkippedConstraint`. A generated clause that duplicates a curated `RULES` clause is
  marked `status="redundant"` and excluded from emission (dedup via `curated=` set).
- **Draft rules registry (US-004 draft):** `render_rules_registry()` → committed
  `datalog/constraints/rules_registry.tsv` (rule id + per-dialect clauses + provenance +
  status). Regenerate it AND `property_constraints.tsv` together (a test pins the
  registry to `constraint_file_rules()`); the two `.tsv`s are in
  `pyproject` package-data (`datalog/constraints/*.tsv`).
- **Materialiser covers the positive kinds only** — symmetric/inverse are positive Horn
  (fixpoint-safe), so `materialize(facts, [cr.souffle_rule()])` derives them engine-free
  in tests; the violation rules use negation and are validated by the souffle-gated smoke
  (`test_souffle_detects_a_value_type_violation`) — engines aren't installed locally, so
  reason about stratification and lean on that CI-gated test.

## Schema-constraint violation rules (rules-layer US-003)

`schema_constraints.py` compiles the **canonical schema's own** constraints
(`shared/canonical-schema.json` edge `from`/`to`, `symmetric`, csid-uniqueness) into
Soufflé **violation rules** — the schema analogue of `constraints.py`. Same self-contained
pattern: `extract_edge_constraints()` reads the schema (repo-root `parents[5]/shared/...`,
absent in a standalone checkout) and resolves each node-type *name* → `:LABEL`, baking them
into the committed replay artifact `datalog/schema/edge_constraints.tsv`; the reader/generator
translate from resolved labels alone. Attached behind `to-datalog --schema-constraints` /
`export_dataset(include_schema_constraints=True)`.

- **All four kinds are Soufflé-only** (negation / inequality). A `from`/`to` type check is a
  **support + violation pair** so heads stay binary: `from_ok_t(X, Y) :- t(X, Y),
  instance_of(X, "L").` (one clause per allowed label) then `t_from_type_violation(X, Y) :-
  t(X, Y), !from_ok_t(X, Y).` — the support carries **both** endpoints so the negation is over
  the `(X, Y)` pair, never an unsafe unary `!from_ok(X)`. Symmetry: `t_symmetry_violation(X, Y)
  :- t(X, Y), !t(Y, X).`; csid-uniqueness: `csid_uniqueness_violation(C, N) :- node(C, T1, N),
  node(C, T2, M), N != M.` (the ONE schema rule whose body reads the arity-3 `node/3` — fine:
  the emitter declares `node` from facts, so don't route it where `node` is undeclared).
  Stratification: `instance_of` closure (recursive) < `from_ok_t` (positive) < violation
  (negation) — no cycle-through-negation.
- **The materialiser can't run these** (it has no negation), so the engine-free authoritative
  check is a **purpose-built** `evaluate_schema_violations(facts, constraints)` (closes
  `instance_of` over `subclass_of` itself, then enumerates offenders) — NOT
  `materialize()`. The souffle-gated `test_souffle_detects_the_type_violation_the_evaluator_does`
  asserts the real engine agrees with it.
- **The full-corpus report is a committed release record** (`docs/schema-constraints-report.json`,
  regenerate with `culturescrape schema-constraints export/culturescrape --json ...`), NOT a
  live-asserted snapshot (the corpus is gitignored) — like the materialization manifest. `--baseline`
  ratchets a corpus against it (violations never increase). A test pins the report's known finding
  (45 `WritingSystem`-descent `descended-from` edges the schema doesn't yet allow; triaged in
  `docs/schema-constraints.md`) so a careless regeneration is caught. Regenerate BOTH
  `schema/edge_constraints.tsv` (tied to the live schema) and `schema/rules_registry.tsv` (tied to
  the generator) after a schema change; both are `pyproject` package-data (`datalog/schema/*.tsv`).

## Provenanced rules registry (rules-layer US-004)

`registry.py` **wraps** the three rule sources — curated `RULES`, the P2302
property-constraint rules (`constraints.py`), the schema violation rules
(`schema_constraints.py`) — into ONE provenanced, validated table committed at
`datalog/rules_registry.tsv` (package-data). It's the governance layer facts already
have (`source`/`source_url`/`retrieved_at`/`confidence`/`version`/`status` per rule).

- **Generated + committed, pinned by a test.** `build_registry()` aggregates the three
  sources deterministically (curated in-code + the two committed replay artifacts);
  `test_committed_registry_matches_a_fresh_build` pins the TSV. Regenerate after ANY
  rule/provenance change: `culturescrape rules-registry --regenerate` (a `_cmd_*`
  refuses to write if validation fails). Columns: `rule_id, layer, head, clause_prolog,
  clause_souffle, depends, source, source_url, retrieved_at, confidence, version, status`.
- **`rules.py` stays the curated CLAUSE source** (its `Rule.intent`/`.example` drive the
  emitted comment blocks — don't reconstruct curated Rules from the registry or you lose
  them). The registry wraps them with metadata; `CURATED_RULE_META` (keyed by head) is
  the in-code status/version source, default = all `active`.
- **The QA gate is `validate_registry(entries) -> [RegistryProblem]`** (run in CI +
  `culturescrape rules-registry`): parseable clauses (balanced; head + `pred(args)`/
  comparison-guard body), known predicates (per-entry: rule heads ∪ `_ALWAYS_KNOWN` ∪
  `examples.KNOWN_PREDICATES` ∪ the entry's own `depends` — so a Soufflé `!from_ok_t`
  negation is "known" because `from_ok_t` is another registry head, and a schema edge
  predicate is known because the entry `depends` on it), no arity conflicts (a pred at
  two arities anywhere). Clause cells may hold MULTIPLE `.`-terminated clauses — split on
  `.` is safe (registry clauses carry no other dots: variables + quoted `:LABEL`s only).
  Import `KNOWN_PREDICATES` LAZILY inside the fn (avoid an import-time cycle via examples).
- **The exporter CONSUMES the registry** through `active_curated_rules()` — `export.py`
  attaches it instead of `RULES` directly, dropping any curated rule whose status ≠
  `active`. Default = all active ⇒ byte-identical output (no existing test moved). Flip a
  head's status in `CURATED_RULE_META` to retire it without deleting its clauses. The
  property/schema layers already gate their own emission on `status=="active"`.
- **Status lifecycle** `proposed → active → retired` (+ `redundant` = a generated clause
  that duplicates a curated one; the constraints layer marks these). `VALID_STATUSES`
  pins the set; docs/rules-registry.md describes it. The per-layer draft registries
  (`constraints/rules_registry.tsv`, `schema/rules_registry.tsv`) still exist as each
  layer's own artifact — the unified registry is the governance aggregate over them.

## Adding an inference rule

Append a `Rule(...)` constant and add it to `RULES` in `rules.py` (also its
`__all__`). A rule is a Horn clause — head + positive predicate literals over
*variables only* (no constants). **Comparison body literals are allowed** (the
temporal rules `contemporary`/`precedes`/`follows` guard on `Ex < Sy` / `Ex >= Sy`
over `time_start`/`time_end`), but ONLY the dialect-shared operators `<`, `>`,
`>=` — these are byte-identical arithmetic goals in SWI-Prolog and native numeric
constraints in Soufflé. Do NOT use the asymmetric spellings: `=<` (Prolog) vs `<=`
(Soufflé), or `\==`/`\=` (Prolog) vs `!=` (Soufflé) — they'd break the
byte-identical clause text that `test_rule_clause_text_is_shared_verbatim_across_dialects`
enforces. Need distinctness (avoid a reflexive self-pair)? Make the rule reflexive
+ documented (like `same_region`/`contemporary`) and filter `X = Y` in the *query*,
not the rule. A comparison needs its operands bound by an earlier predicate literal
(a Soufflé/Prolog safety rule): list the `time_start`/`time_end` goals *before* the
comparison. `depends=` must still name the base predicates the comparisons read
(e.g. `time_start`, `time_end`) so the emitters declare them. `depends=` lists the predicates the body reads so the emitters declare
them even when the graph has no such facts (a rule body over an unpopulated base
relation must answer `false`, not error). A rule head may read *another rule's*
head (e.g. `same_region` reads `within_region`); listing that derived predicate in
`depends` is fine — it only ensures declaration. Every rule relation is binary
(`ARITY = 2`); the emitters assume this.

**Recursive rules are TABLED in Prolog, not dynamic.** A rule whose head appears
in its own body (a transitive closure — `ancestor`, `within_region`,
`influenced_transitively`, `component_of`) does **not terminate** under naive SWI
SLD resolution when the base relation has a cycle. Real-corpus cycles exist:
`descends_from` has a data-error cycle (clovis↔folsom) and `influenced_by` is
*legitimately* cyclic (mutual influence, eng↔fra …). `rules.is_recursive` detects
these and `prolog.py` emits `:- table head/2.` for them (a tabled predicate must
NOT also be `:- dynamic` — SWI forbids it), so swipl computes the least fixpoint
and matches Soufflé (verified in `docs/engine-validation.md`). Soufflé needs
nothing — its set semantics handle cycles. So a NEW recursive rule is tabled
automatically; a non-recursive head (symmetric/join, e.g. `contemporary`,
`same_region`) stays dynamic. Don't add a visited-list/`\=` to a Prolog closure
to stop the loop — that breaks the byte-identical-clause-text invariant; tabling
is the dialect-local fix.

Adding a rule means updating, in lockstep:
- `tests/test_datalog_rules.py` — the exact `RULES` name list, the
  `{constants} == set(RULES)` set, and (to exercise the closure) `RULE_FACTS` +
  `_CLOSURE_GOALS`.
- `docs/datalog.md` — the "Inference rules" table (a doctest imports `RULES`, but
  the table itself is prose).

## Adding a shipped example query

Ship `datalog/examples/<slug>.pl` (a `main/0` printing tab-separated rows) **and**
register an `Example(...)` in `examples.py` (add to `EXAMPLES` + `__all__`). Sync:
- `tests/test_datalog_examples.py` — `EXPECTED_SLUGS`, and `REQUIRED_BASE_FACTS`
  with the base facts your query relies on (this is the offline check that the
  dataset actually supports the query when no engine is installed).
- `docs/datalog.md` — the `>>> [example.slug for example in EXAMPLES]` doctest
  (an exact literal list) and the "Example queries" table.
- Lint passes automatically iff the query names a `KNOWN_PREDICATES` predicate:
  every rule head, every rule dependency, and `predicate_for_type(<registered
  :TYPE>)`. A query reaching only a registered typed predicate lints clean.

## GOTCHA — `datalog/examples/dataset` is a shared fixture

It is `nodes/*.tsv` + `edges/*.tsv` and `collect_facts` reads **every** file in
each (sorted). You can drop in an extra file (e.g. `nodes/linguascrape.tsv`,
`source: linguascrape`) — node header needs `csid:ID`/`:LABEL`/`name`, edge header
needs `:START_ID`/`:END_ID`/`:TYPE`; other columns are optional. **But its exact
node/edge counts are pinned elsewhere:** `tests/test_explorer_data.py` asserts
`len(corpus.nodes.rows)`, `len(corpus.edges.rows)`, `metrics.node_count`, and
`nodes_for_label("Place")` against this dataset. Adding rows there means updating
those counts too. Keep new subgraphs disjoint from existing example anchors
(csids/regions) or you'll change other examples' expected outputs.

## Logic engines in CI (US-001)

As of US-001 both engines ARE installed where the suite runs: the `culture-scrape`
CI job (`.github/workflows/convergence-qa.yml`, pinned to `ubuntu-22.04` so the
souffle-lang apt repo's libffi7 .deb installs) and the sidecar `Dockerfile` (swipl
via apt; souffle built from source in a `souffle-build` stage — Debian has no
souffle package). So the `@pytest.mark.skipif(SWIPL/SOUFFLE is None, …)` smoke tests
now **execute** in CI rather than skipping. The gates stay — they detect the engine
via `shutil.which` so the suite still passes on a machine without them (local dev,
the engine-free `datalog-materialize` path).

Still validate rule *logic* engine-free (evaluate the rule body directly over the
projected facts vs the `Example.expected` set — see `tests/test_datalog_linguascrape.py`)
so the logic is checked even without an engine, and keep the engine-gated test that
agrees with that derivation for when an engine is present. Install locally: see
`docs/datalog.md`, "Installing the engines".
