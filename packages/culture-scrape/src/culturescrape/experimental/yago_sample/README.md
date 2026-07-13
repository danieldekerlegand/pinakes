# YAGO 4.5 evaluation sample (hand-authored, network-free)

These three files are a **small, hand-authored sample that mimics the structure of a
real YAGO 4.5 download** — they are *not* a redistribution of YAGO data. They exist so
the experimental ingestion prototype (`culturescrape.experimental.yago`) and its tests
run offline in CI, the same "committed replay artifact" discipline the acquisition
layers use. A real ingestion would download the CC-BY-4.0 dumps from
<https://yago-knowledge.org/downloads/yago-4-5> and parse them with `rdflib`.

The sample reproduces the parts of YAGO 4.5 the evaluation exercises:

- **`yago-taxonomy.nt`** — N-Triples: `rdfs:subClassOf` edges over the class hierarchy,
  each class linked back to its Wikidata class with `ys:fromClass`
  (`<http://www.wikidata.org/entity/Q…>`) — the same provenance predicate YAGO 4.5's
  schema uses. YAGO's lower taxonomy is Wikidata-derived and preserves those QIDs,
  which is what lets us map it onto the canonical schema.
- **`yago-facts.nt`** — N-Triples: entity `rdf:type` assertions (typed against the
  taxonomy classes) plus a few property facts, using schema.org / YAGO property IRIs.
- **`yago-shapes.ttl`** — a Turtle SHACL file: schema.org classes as `sh:NodeShape`s
  with `sh:targetClass` and `sh:property` blocks (`sh:path`, `sh:class`, `sh:datatype`,
  `sh:maxCount`, `sh:minCount`, `sh:or`, `ys:fromProperty`), the shape idiom YAGO ships
  for logical consistency.

**License caveat baked into the write-up:** YAGO 4.5 *data* is **CC BY-SA** (ShareAlike,
inherited from schema.org — the roadmap's "CC-BY" is imprecise); only the *generator
code* is CC BY 4.0. ShareAlike is a redistribution obligation the evaluation weighs.

See `packages/culture-scrape/docs/yago-evaluation.md` for the write-up these feed.
