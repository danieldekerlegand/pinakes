# experimental/ — evaluation prototypes (NOT the production path)

Code here backs *evaluations* ("should we adopt source X?"), never the live
acquisition/export/CLI path. Nothing in `acquire`/`datalog`/`cli` imports it; it is
imported only by its own tests and its evaluation doc. Anything here may be deleted once
the evaluation it supports is decided.

**The evaluation-prototype pattern** (see `yago.py`, rules-layer US-005):

- **Committed, hand-authored sample** under `<name>_sample/` mimicking the real source's
  structure so CI is network-free (a `README.md` states it is *not* a redistribution and
  what a live ingest would do instead). Same discipline as the datalog replay `.tsv`s.
- **Dependency-free parsers** for the sample's formats (don't add heavy deps like
  `rdflib` for an experiment — a bounded mini-parser over the constrained sample subset
  is enough, documented as such).
- **Reuse the corpus' own maps, don't duplicate them:** map external classes onto corpus
  `:LABEL`s via `acquire.taxonomy.CORPUS_CLASS_QIDS` (inverted), external properties onto
  edge predicates via `datalog.edges.predicate_for_type`, and detect *redundant* rules by
  checking a candidate rule's head against `datalog.registry.load_registry()` heads.
- **`evaluate()` → dict summary, pinned** to a committed `docs/<name>-evaluation-report.json`
  by a test (the schema-constraints-report.json pattern), so the write-up's numbers can't
  silently drift.
- **Package-data**: add the sample glob to `pyproject.toml`'s `[tool.setuptools.package-data]`.

The deliverable is the `docs/<name>-evaluation.md` write-up (recommendation +
license/integration-cost analysis, cross-linked from the roadmap); the prototype is its
evidence.
