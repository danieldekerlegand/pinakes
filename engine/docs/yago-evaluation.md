# Evaluating YAGO 4.5 as a packaged facts + rules source

*Rules-layer US-005 / the neurosymbolic roadmap Phase 4, work item 4.4.*

**Question.** Phase 4 acquires "the rules known to humankind" instead of hand-writing
them. [YAGO 4.5](https://yago-knowledge.org/) is a large, clean, Wikidata-derived
knowledge base that ships **both** facts **and** SHACL constraints — potentially a
shortcut to both breadth (source 4 in the roadmap) and axioms (rule item 4.4). This
document evaluates whether to adopt it, backed by a runnable prototype
(`pinakes_engine.experimental.yago`) that ingests a committed sample, maps its taxonomy
onto the canonical schema, translates a subset of its SHACL shapes into registry-style
rules, and measures overlap against the current corpus.

**Bottom line: partially adopt.** Harvest YAGO's **SHACL shapes** as a convenient,
packaged axiom source to feed the rules registry (US-004); **skip the bulk facts** —
YAGO is Wikidata-derived, so its facts largely duplicate our existing Wikidata
acquisition path, and its schema.org property vocabulary aligns poorly with the corpus'
socio-cultural edge types. The ShareAlike license and 124 GB footprint make a bulk
facts import a poor trade; the shapes are small and high-value.

---

## 1. What YAGO 4.5 is

> Fabian M. Suchanek, Mehwish Alam, Thomas Bonald, Lihu Chen, Pierre-Henri Paris, Jules
> Soria. **"YAGO 4.5: A Large and Clean Knowledge Base with a Rich Taxonomy."** SIGIR
> 2024, pp. 131–141. [doi:10.1145/3626772.3657876](https://dl.acm.org/doi/10.1145/3626772.3657876)
> · [arXiv:2308.11884](https://arxiv.org/abs/2308.11884)

| Property | Value |
|---|---|
| Entities | ~50 million |
| Facts | ~132 million |
| Classes (taxonomy) | ~133,000 (was ~10k in YAGO 4) |
| Properties | 108 |
| Classes per entity | 7.8 (was 3.6 in YAGO 4) |
| Total size | ~124 GB (English mirror ~43 GB) |
| Distribution | Turtle/TSV: `yago-schema` (taxonomy + SHACL), `yago-facts`, `yago-taxonomy`, `yago-beyond-wikipedia`, `yago-meta` (RDF-star temporal), … |
| Identifiers | `yago:` = `http://yago-knowledge.org/resource/`; schema.org classes/properties reused; **Wikidata QIDs preserved** (`ys:fromClass wd:Q…`, `ys:fromProperty wdt:P…`, entity `owl:sameAs` to `wd:Q…`) |

**The "rich taxonomy" (4 → 4.5).** YAGO 4 deliberately dropped most of Wikidata's messy
taxonomy, keeping ~10k hand-picked upper classes. YAGO 4.5 **reintroduces a large,
logically-consistent slice of the Wikidata taxonomy** under a ~41-class schema.org upper
ontology (9 top classes: `CreativeWork, Event, Organization, Person, Place, Product,
Intangible, Taxon`, plus YAGO additions like `BeliefSystem`, `FictionalEntity`). All
hierarchy is `rdfs:subClassOf`; class/instance separation and SHACL constraints are
preserved.

## 2. License analysis (the important caveat)

The roadmap called YAGO "CC-BY". **That is imprecise.** Per the YAGO 4.5 paper, the
**data** is **Creative Commons Attribution-ShareAlike** (inherited from schema.org;
mirrors label it CC BY-SA 3.0); only the **generator code** (`github.com/yago-naga/yago-4.5`)
is CC BY 4.0.

| | License | Obligation |
|---|---|---|
| YAGO 4.5 **data** | CC BY-SA (≈3.0) | Attribution **+ ShareAlike** — a redistributed derivative of the data must itself be BY-SA |
| YAGO generator **code** | CC BY 4.0 | Attribution only |

**Why this matters for us.** ShareAlike is copyleft. Our corpus is published under its
own license/citation columns (schema v1.1); bulk-importing YAGO *facts* into
`lexicons/`/the corpus would arguably make the redistributed corpus a BY-SA derivative —
a licensing entanglement we should avoid. In contrast, **translating a handful of SHACL
shapes into our own rule clauses is a transformation into an independent artifact**
(our Datalog), attributed to YAGO but not a redistribution of YAGO data — much cleaner.
This asymmetry (shapes cheap and clean, facts encumbered) drives the recommendation.

## 3. The prototype and the sample

Because CI is network-free and YAGO is 124 GB, the prototype runs over a small,
hand-authored sample under
[`src/pinakes_engine/experimental/yago_sample/`](../src/pinakes_engine/experimental/yago_sample/)
that mimics YAGO 4.5's structure (it is **not** a redistribution of YAGO data — see the
sample's `README.md`). A real ingestion would `rdflib`-parse the dumps; the prototype
ships dependency-free mini-parsers for N-Triples and the Turtle/SHACL subset YAGO uses.

```
uv run python -c "import json; from pinakes_engine.experimental.yago import evaluate; print(json.dumps(evaluate(), indent=2))"
```

The measured summary is committed at
[`docs/yago-evaluation-report.json`](./yago-evaluation-report.json) and pinned by
`tests/test_experimental_yago.py`.

## 4. Mapping the taxonomy onto the canonical schema

YAGO preserves each class's origin via `ys:fromClass wd:Q…`. The prototype resolves that
QID to a corpus `:LABEL` through the corpus' **own** class-QID table
(`acquire.taxonomy.CORPUS_CLASS_QIDS`, inverted — so the mapping never drifts), then
classifies every `rdfs:subClassOf` edge:

| Edge status | Meaning | Sample |
|---|---|---|
| **redundant** | both ends map, edge already in our P279 artifact (`datalog/taxonomy/subclass_of.tsv`) | 2 |
| **novel** | both ends map, edge new to us | 1 (`ArtTradition subClassOf Culture`) |
| **partial** | one end maps, the other is a schema.org upper class we don't model | 4 |
| **unmapped** | neither end maps (schema.org internals) | 2 |

Of 10 sample classes carrying a Wikidata link, **8 mapped** to a corpus `:LABEL` and 2
did not (`schema:Person`, `schema:Organization` — outside the socio-cultural scope).

**Reading of the full KB.** Because YAGO's lower taxonomy *is* Wikidata's, and our P279
taxonomy (US-001) already pulls `subClassOf` for exactly the corpus' seed classes
straight from Wikidata, YAGO's taxonomy is **the same source, one hop removed**. It adds
value only where YAGO's schema.org-rooted merging produces an edge our direct P279 pull
missed — a thin, occasional win (the single "novel" edge in the sample), not a reason to
ingest 133k classes.

## 5. Translating SHACL shapes into registry rules

YAGO expresses its schema as SHACL constraints on schema.org classes — the same shape of
axiom our US-002 (Wikidata P2302) and US-003 (canonical schema) layers already compile
to violation rules. The prototype translates the subset it can:

| SHACL construct | → rule | Engine |
|---|---|---|
| `sh:targetClass` (subject domain) | `{pred}_from_type_violation(X,Y) :- {pred}(X,Y), !instance_of(X,"L").` | Soufflé (negation) |
| `sh:node`/`sh:class` (range) | `{pred}_to_type_violation(X,Y) :- {pred}(X,Y), !instance_of(Y,"C").` | Soufflé |
| `sh:maxCount 1` (functional) | `{pred}_functional_violation(X) :- {pred}(X,Y1), {pred}(X,Y2), Y1 != Y2.` | Soufflé |
| `sh:or` range / `sh:datatype`-only / out-of-vocab property / unmapped subject | **skipped + reported** | — |

Over the sample's 4 property shapes, **1 translated** (the `schema:containedInPlace` →
`LOCATED_IN` shape) into **3 rules**, and **3 were skipped** with reasons
(`sh:or` disjunctive range unsupported; `schema:inLanguage` outside the corpus edge
vocabulary; `schema:Person` subject class not in the corpus). Of the 3 rules:

- `located_in_to_type_violation` (value must be a `Place`) — **redundant**: it restates
  the canonical schema's own `to = Place` constraint, already generated by US-003.
- `located_in_from_type_violation` (subject must be a `Place`) — **novel**: the schema
  leaves `LOCATED_IN`'s `from` unconstrained; YAGO's shape supplies one.
- `located_in_functional_violation` (a subject located in two distinct places) —
  **novel**: a cardinality/functional integrity kind our schema layer doesn't express.

So even in a favourable case, **1 of 3 shape-derived rules duplicated something we
already had**. The value YAGO shapes add is (a) cardinality/functional constraints
(`sh:maxCount`), a kind neither P2302-symmetric/inverse nor our schema from/to rules
cover, and (b) occasional subject/value-type constraints the schema left open. These
flow straight into the registry format (US-004): the prototype's `YagoRule.registry_row()`
emits `source = yago-4.5`, `source_url`, `retrieved_at`, `confidence`, and a Soufflé
clause, with a `novelty` flag for the redundancy audit.

## 6. Overlap / added-value summary

From [`yago-evaluation-report.json`](./yago-evaluation-report.json):

| Dimension | Total | Already have | Adds |
|---|---|---|---|
| Taxonomy classes (mappable) | 10 | 8 map (via Wikidata) | 2 out-of-scope |
| `subClassOf` edges | 9 | 2 redundant + 4 partial + 2 unmapped | **1 novel** |
| Facts (sample) | 12 triples | 3 carry `owl:sameAs → wd:Q…` (de-dup-able vs our Wikidata path); only 2 use a mappable property | low |
| SHACL property shapes | 4 | 1 rule redundant | **2 novel rules** (from-type, functional) |

The pattern is consistent across taxonomy, facts and shapes: **YAGO is Wikidata one hop
removed.** Where we already ingest Wikidata (P31/P279 taxonomy US-001, P2302 constraints
US-002), YAGO restates it; its genuine additions are (i) `sh:maxCount` functional
constraints and (ii) the odd schema.org-merged taxonomy edge — narrow, not broad.

## 7. Integration-cost analysis

**If we adopted facts (skip):**

- **One RDF-dump adapter** (roadmap source 4) — new code: streaming N-Triples/Turtle
  parser (or `rdflib`, a heavy new dependency), IRI→corpus-node reconciliation via the
  preserved `owl:sameAs → wd:Q…` links (reuses our Wikidata QID reconciliation).
- **Disk/bandwidth**: 124 GB (or ~43 GB English) — the same provisioning note as the
  `wikidata-dump-slice` PRD.
- **Dedup**: because YAGO facts already carry Wikidata QIDs, nearly every YAGO fact
  collides with a fact our Wikidata path already produces → high dedup cost, low net new
  breadth. The `beyond-wikipedia` slice (entities without an English Wikipedia page) is
  the only part with a real chance of *new* entities, and it is the noisiest.
- **License**: BY-SA copyleft entanglement on the redistributed corpus (§2).

**If we adopted shapes (adopt):**

- **Small, self-contained**: `yago-schema` is one Turtle file; SHACL is regular RDF. The
  prototype already parses the shape idiom dependency-free.
- **Reuses existing machinery**: shapes → violation rules is exactly the US-002/US-003
  pattern; rules flow through the US-004 registry and QA gate unchanged.
- **License-clean**: translated clauses are our own artifact, attributed, not a
  redistribution of BY-SA data.
- **Net-new value**: `sh:maxCount` functional constraints are a rule kind we don't have.

## 8. Recommendation

**Partially adopt.**

1. **Adopt (later, small):** add a `yago-shapes` acquirer that fetches `yago-schema`'s
   SHACL, translates the supported constraint types (subject/value-type, `sh:maxCount`)
   into registry rules with `source = yago-4.5`, and lets the US-004 QA gate dedup them
   against curated/P2302/schema rules (the prototype's `novelty` flag is that check). Pick
   up `sh:maxCount` functional-violation rules as a genuinely new integrity kind. Attribute
   YAGO; no data redistribution.
2. **Skip (for now):** the bulk facts import. It is redundant with our Wikidata path
   (YAGO is Wikidata-derived, QIDs preserved), carries a 124 GB footprint, and drags in
   ShareAlike copyleft. Revisit only if the `beyond-wikipedia` slice proves to hold
   entities absent from both Wikidata and our other sources — a separate, later measurement.
3. **Defer** the generic RDF-dump adapter (roadmap source 4) to whenever a *non*-Wikidata
   RDF source (e.g. DBpedia proper) justifies it; YAGO alone does not.

This keeps the "acquire the rules, don't hand-write them" thesis intact while spending
integration effort where the marginal value is — the axioms, not the facts.

---

## Cross-references

- Roadmap: the neurosymbolic roadmap Phase 4, item **4.4** (this evaluation) and source 4.
- Rules registry & QA gate: [`rules-registry.md`](./rules-registry.md) (US-004).
- The shape → violation-rule pattern this reuses: [`schema-constraints.md`](./schema-constraints.md)
  (US-003) and the P2302 section of [`datalog.md`](./datalog.md) (US-002).
- Prototype: `src/pinakes_engine/experimental/yago.py`; sample: `.../yago_sample/`;
  measured report: [`yago-evaluation-report.json`](./yago-evaluation-report.json).
