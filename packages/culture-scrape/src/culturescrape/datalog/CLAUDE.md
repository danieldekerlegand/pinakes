# datalog/ — engine-neutral logic projection

TSV is the source of truth; this package is a **derived, mechanical projection**
of it into Prolog (`.pl`) and Soufflé (`.dl`). The layers stack:
`__init__.py` (Fact/render) → `nodes.py`/`edges.py` (project rows to facts) →
`rules.py` (shared inference rules) → `prolog.py`/`souffle.py` (emit) →
`export.py` (`collect_facts` + `export_dataset`) → `examples.py` (shipped `.pl`
queries + offline linter). `culturescrape to-datalog … --rules` attaches `RULES`.
`materialize.py` (`materialize`/`summarize`) is the **engine-free evaluator** that
computes the rules' derived extension without swipl/souffle.

## Materializing rules without an engine (US-004)

`materialize(facts, rules=RULES)` runs a naive-fixpoint Datalog evaluator over the
projected `Fact`s and returns each rule head's derived tuple set; `summarize(...)`
adds the base-relation counts and yields a `MaterializationSummary` whose
`to_json()` is what `culturescrape datalog-materialize <dataset> --json` writes.
Use it to count/validate the four US-004 targets (`contemporary`, `same_region`,
`ancestor` = transitive `descends_from`, `genetic_linguistic_correlation`) in CI —
no engine is installed. Constraints the evaluator relies on (and that any new rule
must keep, same as the emitters): **every predicate is binary** (`ARITY == 2`) and
bodies are **pure Horn** over variables (upper-case-initial / `_`) or constants. A
non-binary literal or a fact-shaped clause raises `MaterializeError`.

- The full-corpus derivation is a committed **release record**
  (`docs/datalog-materialization-manifest.json`), not a CI-tested snapshot — the
  corpus is gitignored and its bytes are non-reproducible (like
  `docs/corpus-release-manifest.json`). Regenerate it with the CLI after a rebuild.
- `genetic_linguistic_correlation` derives **0 over the LinguaScrape-only corpus**
  (no genetics/haplogroup source → no `originates_from`/`spoken_in` edges). It is
  exercised on the bundled fixture, which carries ported `source: linguascrape`
  genetics facts. Don't "fix" the 0 — it's a data property, not a bug.
- Tests pin the evaluator's exact extensions on the small bundled dataset
  (`tests/test_datalog_materialize.py`); those counts are stable because the fixture
  node/edge counts are themselves pinned (see the shared-fixture GOTCHA below).

## Adding an inference rule

Append a `Rule(...)` constant and add it to `RULES` in `rules.py` (also its
`__all__`). A rule is a **pure Horn clause** — head + positive literals over
*variables only*. No constants, and **no inequality/negation** (`X != Y` is
Soufflé-only, `X \= Y` is Prolog-only): the clause text must be byte-identical in
both dialects, which `test_rule_clause_text_is_shared_verbatim_across_dialects`
enforces. `depends=` lists the predicates the body reads so the emitters declare
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
