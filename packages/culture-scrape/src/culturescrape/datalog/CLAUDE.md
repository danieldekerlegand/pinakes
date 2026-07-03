# datalog/ — engine-neutral logic projection

TSV is the source of truth; this package is a **derived, mechanical projection**
of it into Prolog (`.pl`) and Soufflé (`.dl`). The layers stack:
`__init__.py` (Fact/render) → `nodes.py`/`edges.py` (project rows to facts) →
`rules.py` (shared inference rules) → `prolog.py`/`souffle.py` (emit) →
`export.py` (`collect_facts` + `export_dataset`) → `examples.py` (shipped `.pl`
queries + offline linter). `culturescrape to-datalog … --rules` attaches `RULES`.

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

## No logic engine in CI

Neither `swipl` nor `souffle` is installed, so every runnable smoke test is
`@pytest.mark.skipif`-gated. Validate rule *logic* engine-free by evaluating the
rule body directly over the projected facts and comparing to the `Example.expected`
set (see `tests/test_datalog_linguascrape.py`), and keep a swipl-gated test that
agrees with that derivation for when an engine is present.
