"""In-app authoring: the surfaces a contributor draws, dates, or draws a line between.

Four Express services land here as one package, because they are one shape
repeated: a *pure* validator over a loosely-typed request body, a serializer
producing the `data/source/lexicons/*.tsv` row a reviewer would promote, and a
mapper onto a ``Partial<Contribution>``. Nothing here writes the corpus — every
authored record goes into the contribution review queue
(:mod:`pinakes.contributions.store`), which is the premise the whole surface
rests on.

* :mod:`.timeline_event` — an event or period on the temporal axis.
* :mod:`.drawn_geometry` — a polygon or line drawn on the map.
* :mod:`.relationship_edge` — a typed edge between two entities, deduped against
  the corpus (:mod:`pinakes.lexicons.canonical_edges`) and the queue.
* :mod:`.suggestions` — the ranked *proposals* an authoring form offers; ranks
  only, never submits.
* :mod:`.candidates` — the corpus projection the suggestion ranker ranks over.

The shared JavaScript-semantics helpers live in :mod:`._js`. They are not
decoration: these validators are graded by two recorded parity fixtures whose
contract is the **400 body**, and a body that differs by one error string is a
different contract.
"""
