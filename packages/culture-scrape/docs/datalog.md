# Datalog / Prolog export

The canonical store is TSV (`docs/data-model.md`). Datalog is a **derived,
mechanical projection** of it: each node and edge row becomes one or more
logical facts. Before targeting a specific engine (SWI-Prolog, Soufflé, …) we
fix a single engine-neutral fact shape — `culturescrape.datalog.Fact` — that
renders validly into either syntax.

Every code block below with `>>>` prompts is a doctest, executed by
`tests/test_datalog_doc.py`, so the examples cannot drift from the
implementation.

## One command: TSV → logic program

The whole projection is wrapped in a single CLI command. Point it at a dataset
root (holding `nodes/*.tsv` and `edges/*.tsv`) and it writes a ready-to-load
program for one or both engines:

```console
$ culturescrape to-datalog <dir> --engine swipl|souffle|both --rules --out <dir>
```

- `--engine` selects the target(s): `swipl` writes `graph.pl`, `souffle` writes
  `graph.dl` plus one `<predicate>.facts` file per relation, `both` (the
  default) writes each side by side into `--out`.
- `--rules` attaches the shared inference-rule library (see below) to whichever
  program(s) are written.

It prints a copy-pasteable load/run hint for each engine — `swipl <out>/graph.pl`
for SWI-Prolog, `souffle <out>/graph.dl -F <out> -D <out>` for Soufflé. The
underlying orchestration lives in `culturescrape.datalog.export`.

## Installing the engines (SWI-Prolog + Soufflé)

The projection above needs no engine, but *running* the generated program — the
`/datalog` console, the shipped example queries, and the cross-engine
equivalence harness — needs `swipl` and/or `souffle` on `PATH`. Both are now
installed in CI (the `culture-scrape` job in `.github/workflows/convergence-qa.yml`)
and in the sidecar image (`Dockerfile`), so the previously `skipif`-gated engine
tests execute there. To run them locally:

**macOS (Homebrew):**

```console
$ brew install swi-prolog
$ brew install souffle          # tap: souffle-lang/homebrew-souffle if needed
```

**Debian / Ubuntu:**

```console
$ sudo apt-get install -y swi-prolog
# Soufflé is not in the Ubuntu/Debian archive; use the official apt repo
# (Ubuntu only — its .deb needs libffi7, present on 22.04 but not 24.04):
$ wget -qO- https://souffle-lang.github.io/ppa/souffle-key.public \
    | sudo gpg --dearmor -o /usr/share/keyrings/souffle-archive-keyring.gpg
$ echo "deb [signed-by=/usr/share/keyrings/souffle-archive-keyring.gpg] https://souffle-lang.github.io/ppa/ubuntu/ stable main" \
    | sudo tee /etc/apt/sources.list.d/souffle.list
$ sudo apt-get update && sudo apt-get install -y souffle
```

On distros without a working apt `souffle` (Debian, Ubuntu 24.04), build it from
source — see [souffle-lang.github.io/build](https://souffle-lang.github.io/build)
(the sidecar `Dockerfile` does exactly this in its `souffle-build` stage). Verify
with `swipl --version` and `souffle --version`. With neither engine present the
runnable tests skip with a logged reason and the console lints offline instead.

```python
>>> from culturescrape.datalog import Fact, Dialect, render_atom

```

## The `Fact` shape

A `Fact` is a predicate functor, a tuple of arguments, and an optional
provenance `source`:

```python
>>> fact = Fact("instance_of", ("cs:dish:Q42", "dish"), source="wikidata")
>>> fact.predicate
'instance_of'
>>> fact.args
('cs:dish:Q42', 'dish')

```

Arguments are strings (symbolic constants), ints, or floats. The `source` is
recorded so that — per the data model's "no fact without a source" rule — the
provenance survives into the logic program, emitted as a trailing comment that
keeps the predicate's arity stable.

## Predicate schema

The projection emits a small, stable vocabulary. Identifiers are `csid` values
from the canonical model; types and relationship types come from the ontology
in `src/culturescrape/ontology/`.

### Entities

| Predicate | Meaning |
|---|---|
| `node/3+` | `node(Csid, Type, Name, ...)` — one fact per entity row; trailing args carry extra denormalised columns |
| `instance_of/2` | `instance_of(Csid, Type)` — structural typing |
| `subclass_of/2` | `subclass_of(Type, SuperType)` — type hierarchy |

### Relationships

Edges project either through the generic `rel/3` predicate or through one typed
binary predicate per `:TYPE` — the two are interchangeable views:

| Predicate | Meaning |
|---|---|
| `rel/3` | `rel(Type, Start, End)` — generic edge with the type as data |
| `located_in/2`, `originates_from/2`, `created_by/2`, … | typed projection of a single `:TYPE` |
| `rel_conf/4` | `rel_conf(Type, Start, End, Weight)` — optional edge strength/confidence |

### Dimension facts

Each dimension contributes binary predicates relating a `csid` to a value or
another `csid`:

| Predicate | Dimension | Meaning |
|---|---|---|
| `time_start/2`, `time_end/2` | temporal | year (negative = BCE) |
| `part_of_period/2` | temporal | named period |
| `located_in/2`, `adjacent_to/2` | geographic | place links |
| `descends_from/2`, `borrowed_from/2`, `cognate_with/2` | linguistic | language/term lineage |
| `derived_from/2`, `influenced_by/2`, `variant_of/2` | genetic | cultural lineage |

The rules layer (Tasklist 5) sits on top of these base facts to derive inferred
relations such as `contemporary_with/2` and `same_region/2`.

## Projecting node rows

`culturescrape.datalog.node_file_facts` reads a node TSV file (`nodes/<type>.tsv`)
and `node_facts` projects a single decoded row. Each row yields:

- `node(Csid, Type, Name)` — `Type` is the **primary** `:LABEL`;
- `instance_of(Csid, Label)` — one per `:LABEL` value, so a multi-label node
  (`Dish;CulturalArtifact`) keeps every type, not only the primary one;
- one **dimension fact per populated dimension column**. Columns map as:

  | Column(s) | Fact |
  |---|---|
  | `time_start:int`, `time_end:int` | `time_start/2`, `time_end/2` (numeric year) |
  | `period` | `part_of_period/2` |
  | `lat:float` + `lon:float` | `located_at(Csid, Lat, Lon)` — emitted only when **both** are present |
  | `place_qid`, `tgn_id`, `pleiades_id` | `place_qid/2`, `tgn_id/2`, `pleiades_id/2` |
  | `language_code`, `script`, `etymology` | `language_code/2`, `script/2`, `etymology/2` |
  | `derived_from_csid` | `derived_from/2` |

An **empty cell emits no fact**, so the logic program contains no nulls. Each
emitted fact carries the row's `source` column as provenance.

### The csid ↔ atom mapping

A `csid` (`cs:dish:Q42`) is carried **verbatim** as the first argument of every
fact; `render_atom` then quotes it deterministically per dialect. The mapping is
**reversible**: the original string survives byte-for-byte inside the quotes, so
recovering the csid is just stripping the quotes (and undoing the dialect's
escapes). The same csid always renders to the same atom, so the projection is
idempotent.

```python
>>> from culturescrape.datalog import Fact
>>> Fact("node", ("cs:dish:Q42", "Dish", "Ceviche")).render()
"node('cs:dish:Q42', 'Dish', 'Ceviche')."
>>> Fact("located_at", ("cs:dish:Q42", -12.04, -77.04)).render()
"located_at('cs:dish:Q42', -12.04, -77.04)."
>>> Fact("time_start", ("cs:battle:Q47", -480)).render()
"time_start('cs:battle:Q47', -480)."

```

## Projecting edge rows

`culturescrape.datalog.edge_file_facts` reads an edge TSV file
(`edges/<type>.tsv`) and `edge_facts` projects a single decoded row. An edge of
`:TYPE` `T` from `A` to `B` becomes the graph structure expressed in logic:

- `rel(t, A, B)` — the **generic** view, so every edge is reachable by one
  uniform query (`rel(Type, A, B)`);
- `t(A, B)` — the **typed** view, one binary predicate per `:TYPE`;
- `rel_conf(t, A, B, Weight)` — an optional companion exposing the edge
  `weight` (its strength/confidence), emitted **only** when that column is
  populated, so the base relations stay arity-stable.

Both views carry the **same atom** for the type, so a query pivots between them
freely: `rel(located_in, A, B)` mirrors `located_in(A, B)`. Each fact carries
the row's `source` column as provenance.

### The `:TYPE` → predicate scheme

`predicate_for_type` derives a typed predicate from a `:TYPE` by **lowercasing**,
constrained to be **collision-free**: a `:TYPE` must be `SCREAMING_SNAKE_CASE`
(`[A-Z][A-Z0-9_]*`), the relationship-vocabulary convention in
`docs/data-model.md`. Over that domain `str.lower()` is a *bijection* onto valid
predicate functors (`[a-z][a-z0-9_]*`) — letters map one-to-one and
digits/underscores are fixed — so distinct types never collapse to one
predicate, and the mapping is reversible. A `:TYPE` outside the domain is
rejected rather than silently colliding.

```python
>>> from culturescrape.datalog import edge_facts, predicate_for_type
>>> predicate_for_type("LOCATED_IN")
'located_in'
>>> predicate_for_type("DERIVED_FROM")
'derived_from'

```

A weighted edge yields all three facts; the type atom is shared across the
generic and typed views, and `rel_conf` carries the numeric weight:

```python
>>> row = {":START_ID": "cs:dish:Q42", ":END_ID": "cs:place:Q123",
...        ":TYPE": "LOCATED_IN", "weight": "0.9", "source": "wikidata"}
>>> for fact in edge_facts(row):
...     print(fact.render())
rel(located_in, 'cs:dish:Q42', 'cs:place:Q123').  % source: wikidata
located_in('cs:dish:Q42', 'cs:place:Q123').  % source: wikidata
rel_conf(located_in, 'cs:dish:Q42', 'cs:place:Q123', 0.9).  % source: wikidata

```

## Rendering atoms

`render_atom` quotes and escapes a single term so it is valid in the chosen
dialect. A lowercase-initial token is a bare Prolog atom; anything that would
otherwise misparse is quoted and escaped.

```python
>>> render_atom("dish")
'dish'
>>> render_atom("cs:dish:Q42")          # colons force quoting
"'cs:dish:Q42'"
>>> render_atom("Ceviche")              # capital would read as a variable
"'Ceviche'"
>>> render_atom(-1438)                   # numbers are bare literals
'-1438'

```

Quotes, spaces, backslashes, control characters, and Unicode are all handled.
Unicode is passed through verbatim (both engines read UTF-8); only the quote
character, backslash, and C0 controls are escaped:

```python
>>> render_atom("Tom's dish")           # embedded single quote
"'Tom\\'s dish'"
>>> render_atom("a b\tc")               # space kept, tab escaped
"'a b\\tc'"
>>> render_atom("Crème brûlée")         # Unicode passes through
"'Crème brûlée'"

```

### Dialects

Prolog uses single-quoted atoms; Soufflé Datalog writes every symbolic constant
as a double-quoted string:

```python
>>> render_atom("cs:dish:Q42", Dialect.DATALOG)
'"cs:dish:Q42"'
>>> render_atom('say "hi"', Dialect.DATALOG)   # double quote escaped
'"say \\"hi\\""'

```

## Rendering facts

`Fact.render` assembles a complete, `.`-terminated clause. The default dialect
is Prolog:

```python
>>> Fact("located_in", ("cs:dish:Q42", "cs:place:Q123")).render()
"located_in('cs:dish:Q42', 'cs:place:Q123')."

```

A `source` becomes a trailing line comment (`%` in Prolog, `//` in Datalog):

```python
>>> Fact("time_start", ("cs:battle:Q7", -480), source="wikidata").render()
"time_start('cs:battle:Q7', -480).  % source: wikidata"
>>> print(Fact("node", ("cs:dish:Q42", "dish", "Ceviche")).render(Dialect.DATALOG))
node("cs:dish:Q42", "dish", "Ceviche").

```

## Soufflé Datalog export

Soufflé is strongly typed and splits a program across two artefacts, so
`culturescrape.datalog.write_souffle_program` writes a directory rather than a
single file: a `graph.dl` holding declarations and I/O directives, plus one
headerless `<predicate>.facts` file per relation holding the rows in Soufflé's
native tab-separated format.

### Type declarations

Every attribute is inferred to a Soufflé primitive — `symbol` (string),
`number` (signed int) or `float` — from the values that occur at that position.
A position mixing ints and floats widens to `float`; mixing in any string
widens to `symbol`:

```python
>>> from culturescrape.datalog import Fact, souffle_relations
>>> rels = souffle_relations([
...     Fact("time_start", ("cs:battle:Q47", -480)),
...     Fact("located_at", ("cs:place:Q1", 12.5, -3.0)),
... ])
>>> for rel in rels:
...     print(rel.declaration())
.decl located_at(x0: symbol, x1: float, x2: float)
.decl time_start(x0: symbol, x1: number)

```

### Declarations and directives

The `.dl` declares each predicate and marks it both `.input` (rows are loaded
from `<predicate>.facts` at start-up) and `.output` (running the program
materialises it):

```python
>>> from culturescrape.datalog import render_souffle_program
>>> program = render_souffle_program([Fact("instance_of", ("cs:dish:Q42", "Dish"))])
>>> for line in program.splitlines():
...     if line.startswith("."):
...         print(line)
.decl instance_of(x0: symbol, x1: symbol)
.input instance_of
.output instance_of

```

### The `.facts` files

The rows live in the sibling `.facts` files. Unlike the quoted constants in `.pl`
source, Soufflé's native format carries values **raw** (no surrounding quotes),
tab-separated. They are written through the strict TSV encoder
(`culturescrape.schema.tsvio`), so a field containing a tab, newline, or
backslash is escaped rather than corrupting the format — the files are lossless.

### Running

With the `.dl` and `.facts` in one directory, run:

```
souffle graph.dl -F <dir-holding-the-.facts> -D <output-dir>
```

## Inference rules

The raw facts are only the graph; the **rules layer** is what makes the logic
program worth more than the TSV it came from. `culturescrape.datalog.RULES` is a
shared library of engine-neutral rule *templates* that attach to any generated
program — pass it as `rules=` to either emitter and the same derived relations
become available whichever engine a researcher loads.

A pure Horn rule (a head and a body of positive literals over **variables**) is
written identically in ISO-Prolog and in Soufflé — the dialects diverge only on
how *constants* are quoted, and a rule has none. So each rule's clause text is
**shared verbatim** across both outputs; the engines differ only in the
scaffolding around the clauses (Prolog's `:- dynamic`/`:- discontiguous`/`:-
table` directives, Soufflé's `.decl`/`.output`), which the emitters add
automatically.

Every rule relation is **binary over csids**.

| Derived predicate | Closure of | Intended meaning |
|---|---|---|
| `ancestor/2` | transitive `descends_from/2` | `ancestor(X, Y)` — language `Y` is a (possibly indirect) ancestor of language `X` |
| `within_region/2` | transitive `located_in/2` | `within_region(X, Y)` — `X` lies inside region `Y` through any chain of containments |
| `contemporary/2` | symmetric `contemporary_with/2` | `contemporary(X, Y)` — `X` and `Y` overlap in time, queryable from either endpoint |
| `influenced_transitively/2` | transitive `derived_from/2` ∪ `influenced_by/2` | `influenced_transitively(X, Y)` — `Y` is a direct or indirect cultural forebear of `X` |
| `component_of/2` | transitive `part_of/2` | `component_of(X, Y)` — `X` is a component of whole `Y` through any chain of part-of containments |
| `same_region/2` | co-location via `within_region/2` | `same_region(X, Y)` — `X` and `Y` share an enclosing region (reflexive, symmetric); the geographic half of the cross-domain correlation |
| `genetic_linguistic_correlation/2` | `originates_from/2` ⋈ `spoken_in/2` on region | `genetic_linguistic_correlation(H, L)` — a haplogroup `H` and a language `L` correlate because `H` originates in the region `L` is spoken in |

The last two port LinguaScrape's cross-domain and genetic–linguistic correlation
logic into the shared graph (T-LS-US-005). `genetic_linguistic_correlation/2`
derives only the *qualitative* pairing; the numeric overlap score (region-polygon
intersection, notable divergences) stays a CPU-domain computation in the
TypeScript engine, per `docs/culturescrape-integration.md`.

`contemporary/2` is a **new** predicate rather than a self-mirroring clause on
`contemporary_with/2`: in Prolog a clause `contemporary_with(X, Y) :-
contemporary_with(Y, X).` would loop, so a distinct head keeps the symmetric
closure terminating while still agreeing with Soufflé's fixpoint.

A distinct head is not enough for the **transitive-closure** rules, though: their
base relations can themselves be cyclic. `descends_from` carries a data-error
cycle (`clovis` ↔ `folsom`, see `docs/engine-validation.md`) and `influenced_by`
is *legitimately* cyclic — mutual influence (`eng` ↔ `fra`, `arb` ↔ `heb`, …) is
real — so naive SLD evaluation of `ancestor`/`influenced_transitively` loops
forever in SWI-Prolog. The Prolog emitter therefore declares every **recursive**
rule head (`ancestor`, `within_region`, `influenced_transitively`, `component_of`)
`:- table` instead of `:- dynamic`: SLG resolution computes the least fixpoint and
terminates, producing exactly Soufflé's tuple set (verified on the full corpus —
`docs/engine-validation.md`). This is a Prolog-only concern; Soufflé's set
semantics handle cycles natively, so the shared clause text is untouched.

### Attaching the rules

Passing `rules=RULES` appends a documented rules section — each rule's intended
meaning and worked example query as comments, then its clauses:

```python
>>> from culturescrape.datalog import RULES, render_program, render_souffle_program
>>> pl = render_program([], rules=RULES)
>>> "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y)." in pl
True
>>> dl = render_souffle_program([], rules=RULES)
>>> "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y)." in dl   # same text
True

```

In Prolog the rule's derived **and** base predicates are declared, so a query
over a base relation the current graph never populated answers `false` instead
of raising an existence error. A base relation is `:- dynamic`; a **recursive**
derived head (a transitive closure) is instead `:- table`d — SWI-Prolog's naive
SLD resolution does not terminate on a closure rule when the base relation
carries a cycle (`descends_from` has a data-error cycle; `influenced_by` is
legitimately cyclic — mutual influence), and tabling (SLG resolution) computes
the least fixpoint and terminates, matching Soufflé. A tabled predicate must not
also be `:- dynamic` (SWI forbids tabling a dynamic procedure):

```python
>>> ":- dynamic descends_from/2." in pl   # base relation
True
>>> ":- table ancestor/2." in pl          # recursive derived head
True
>>> ":- dynamic ancestor/2." in pl        # ...never both
False

```

In Soufflé each derived relation is declared and marked `.output` (so running
the program materialises the closure), and any base predicate the fact base did
not already declare is declared too:

```python
>>> ".output ancestor" in dl and ".decl contemporary_with(x0: symbol, x1: symbol)" in dl
True

```

### Worked example queries

Given the chain `descends_from('cs:lang:spa', 'cs:lang:lat')` and
`descends_from('cs:lang:lat', 'cs:lang:itc')`:

```prolog
?- ancestor('cs:lang:spa', X).        % every ancestor of Spanish
X = 'cs:lang:lat' ;
X = 'cs:lang:itc'.
```

Given `located_in('cs:dish:Q42', 'cs:place:Q123')` and
`located_in('cs:place:Q123', 'cs:place:Q200')`:

```prolog
?- within_region('cs:dish:Q42', X).   % every region containing the dish
X = 'cs:place:Q123' ;
X = 'cs:place:Q200'.
```

Given the single edge `contemporary_with('cs:battle:Q47', 'cs:dish:Q42')`, the
mirror holds though no edge was stored in that direction:

```prolog
?- contemporary('cs:dish:Q42', X).
X = 'cs:battle:Q47'.
```

Given `derived_from('cs:dish:Q99', 'cs:dish:Q42')` and
`influenced_by('cs:dish:Q42', 'cs:dish:Q07')`:

```prolog
?- influenced_transitively('cs:dish:Q99', X).   % the whole influence chain
X = 'cs:dish:Q42' ;
X = 'cs:dish:Q07'.
```

The identical closures run in Soufflé by reading the materialised
`ancestor.csv`, `within_region.csv`, … output relations.

## Example queries

Worked queries ship under `datalog/examples/`, each a self-describing `.pl`
file, together with a small self-contained dataset (`datalog/examples/dataset/`,
a `nodes/` + `edges/` pair) they run against. They are registered in
`culturescrape.datalog.examples`, and `tests/test_datalog_examples.py` runs each
one on that dataset in SWI-Prolog (skipping when `swipl` is absent):

```python
>>> from culturescrape.datalog.examples import EXAMPLES
>>> [example.slug for example in EXAMPLES]
['ancestry-of-dish', 'entities-within-region', 'contemporaries-of-event', 'shortest-influence-chain', 'festivals-in-period', 'game-family-variants', 'invention-lineage', 'material-composition', 'genetic-linguistic-correlation', 'language-descent']

```

Build a loadable program from the dataset once, then point `swipl` at it and a
query file (each defines a `main/0` that prints its answer rows):

```console
$ culturescrape to-datalog datalog/examples/dataset --engine swipl --rules --out /tmp/eg
$ swipl -q -g main -t halt /tmp/eg/graph.pl datalog/examples/ancestry-of-dish.pl
```

| Query file | Question | Predicate | Expected output shape |
|---|---|---|---|
| `ancestry-of-dish.pl` | full ancestry of a dish | `influenced_transitively/2` | the dish's forebears, one csid per line — `cs:dish:tiradito`, `cs:dish:ceviche`, `cs:dish:kinilaw` |
| `entities-within-region.pl` | all entities within a region, transitively | `within_region/2` | every member of the region, one csid per line — `cs:place:lima`, `cs:dish:ceviche`, `cs:dish:tiradito` |
| `contemporaries-of-event.pl` | contemporaries of an event | `contemporary/2` | everything overlapping the event, one csid per line — `cs:event:columbian-exchange`, `cs:dish:ceviche` |
| `shortest-influence-chain.pl` | shortest influence chain between two artifacts | iterative deepening over `derived_from/2` ∪ `influenced_by/2` | the chain as a single tab-separated row — `cs:dish:nikkei-ceviche  cs:dish:tiradito  cs:dish:ceviche` |
| `festivals-in-period.pl` | festivals and traditions in a named period | `part_of_period/2` (`PART_OF_PERIOD`) | the period's practices, one csid per line — `cs:festival:holi`, `cs:festival:hanami` |
| `game-family-variants.pl` | the variant family of a game | symmetric closure of `variant_of/2` (`VARIANT_OF`) | the game's family, one csid per line — `cs:game:shogi`, `cs:game:xiangqi` |
| `invention-lineage.pl` | the derivation lineage below an invention | transitive `derived_from/2` (`DERIVED_FROM`) with depth | each descendant and its depth, tab-separated — `cs:invention:mobile-phone  1`, `cs:invention:smartphone  2` |
| `material-composition.pl` | the materials an artifact is made of | `made_of/2` (`MADE_OF`) | the artifact's materials, one csid per line — `cs:material:silk`, `cs:material:cotton` |
| `genetic-linguistic-correlation.pl` | the languages a haplogroup correlates with | `genetic_linguistic_correlation/2` | each correlated language, one csid per line — `cs:language:proto-celtic`, `cs:language:gaulish` |
| `language-descent.pl` | the full ancestry of a language | transitive `ancestor/2` (`DESCENDS_FROM`) | each ancestor, one csid per line — `cs:language:proto-celtic`, `cs:language:pie` |

The last two run over **LinguaScrape-origin** facts merged into the dataset
(`source: linguascrape`), exercising the ported correlation rules and the base
transitive closure across the merged graph.

The four before them mirror the per-domain `cypher/*.cypher` queries, one per new
corpus-expansion signature relationship, each reaching only the typed predicate
the exporter emits for that registered `:TYPE`. The first three base queries are
closures from the rule library, so in Soufflé the same
answers materialise as output relations: run
`souffle /tmp/eg/graph.dl -F /tmp/eg -D /tmp/eg` (after exporting with
`--engine both --rules`) and read the focus rows out of
`influenced_transitively.csv`, `within_region.csv`, and `contemporary.csv` — e.g.
the rows of `within_region.csv` whose second column is `cs:place:peru` are the
region's members. The shortest-chain query reconstructs a *path* by iterative
deepening, which is a Prolog idiom; in Soufflé reachability is available as the
`influenced_transitively` closure, but the minimal route is left to the
interactive engine.

## Materializing inference at scale (US-004)

Loading a generated `graph.pl`/`graph.dl` into an engine materializes the derived
relations — but the full corpus program is ~1 GB, and the engine-free path stays
useful even now that CI carries the engines (see "Installing the engines" above),
because it is fast and needs no engine at all. `culturescrape.datalog.materialize`
computes each rule's extension **engine-free**: a small naive-fixpoint evaluator
over the projected facts, so the four US-004 inference targets can be produced,
counted, and validated without an engine. `culturescrape datalog-materialize <dataset>` prints
the base-relation counts the rules read and the derived-relation counts, and
`--json <path>` writes them as a manifest:

```python
>>> from culturescrape.datalog.export import collect_facts
>>> from culturescrape.datalog.examples import dataset_dir
>>> from culturescrape.datalog.materialize import summarize
>>> summary = summarize(collect_facts(dataset_dir()))
>>> summary.derived_relations["ancestor"]                       # transitive descends_from
3
>>> summary.derived_relations["same_region"]                    # co-location join
16
>>> summary.derived_relations["contemporary"]                   # symmetric contemporary_with
6
>>> summary.derived_relations["genetic_linguistic_correlation"] # origin ⋈ spoken region
2

```

Over the **full LinguaScrape corpus** (`out/linguascrape-full/corpus`) the four
targets materialize to (recorded in `docs/datalog-materialization-manifest.json`):

| Target relation | Derived tuples | Base relation read |
|---|---|---|
| `contemporary/2` (symmetric `contemporary_with/2`) | 1,010,490 | `contemporary_with` (505,245) |
| `same_region/2` (co-location via `within_region/2`) | 2,219 | `located_in` (475) |
| `ancestor/2` (transitive `descends_from/2`) | 2,770 | `descends_from` (1,468) |
| `genetic_linguistic_correlation/2` | 0 | `originates_from`/`spoken_in` (0) |

`genetic_linguistic_correlation/2` derives **0** over the LinguaScrape-only corpus
because LinguaScrape ships no genetics domain (no haplogroup source, so no
`originates_from`/`spoken_in` edges). The rule is exercised — and its expected
shape recorded — on the bundled fixture, which carries the ported LinguaScrape
genetics facts (`source: linguascrape`); it materializes on any merged corpus that
adds a genetics source. The other three run non-trivially over the live graph.
Storing the ~1 M symmetric `contemporary` closure as edges would dominate the
corpus, so it stays **derived** in the logic layer rather than materialized into
TSV — the point of keeping the closure a rule.
