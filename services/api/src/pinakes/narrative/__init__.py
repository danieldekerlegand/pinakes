"""The "explain the connection" narrative — `POST /api/graph/explain`.

Two modules, split along the one boundary that matters:

* :mod:`.connection` — pure. Evidence extraction, the aggregate confidence, the
  grounding prompt, and the orchestration over injectable dependencies. No
  network, no model, no graph driver.
* :mod:`.llm` — the model proxy. The only thing in this package that reaches
  outside the process.

Honesty is structural, not a disclaimer: with **no path and no inferred fact**
the model is never called at all, and the result says so with
``aiGenerated: false``. A narrative can therefore never assert a link the graph
does not carry — the prose has nothing to be generated *from*.
"""
