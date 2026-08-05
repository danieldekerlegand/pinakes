"""The analytics/insight engines, ported off `server/services/*` (pinakes:62).

Four self-contained computations over the lexicon corpus, none of which needs a
database:

* :mod:`~pinakes.analytics.index` — the read-only DuckDB mirror of
  `data/source/lexicons/*.tsv` that backs `/api/analytics/*`;
* :mod:`~pinakes.analytics.correlation` — cross-domain correlation
  (co-occurrence / temporal / geographic), with the optional graph-backed path;
* :mod:`~pinakes.analytics.anomaly` — statistically surprising similarities
  between distant, unrelated cultures;
* :mod:`~pinakes.analytics.genetic` — haplogroup ↔ language-family overlap.

The division of labour is the one `src/pinakes/engine/` established: plain
arguments in, JSON-ready values out, no FastAPI import anywhere below
:mod:`pinakes.routers`. The scoring functions take their corpus as an argument
and their clock as a parameter, so every one of them is unit-testable on
synthetic rows with no filesystem.
"""
