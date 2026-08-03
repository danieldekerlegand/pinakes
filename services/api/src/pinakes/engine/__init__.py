"""The engine, called in-process.

Three seams used to sit between the TypeScript backend and the Python engine
(docs/UNIFIED-PROJECT-PLAN.md §5):

* **search · metrics · completeness** — an HTTP round trip to the FastAPI
  sidecar (`server/services/engine-client.ts`) → :mod:`pinakes.engine.corpus`.
* **datalog · cypher · retrieve** — the same HTTP hop, into the sidecar's
  consoles → :mod:`pinakes.engine.datalog` and :mod:`pinakes.engine.graph`.
* **node · neighborhood · overview** — a **second** Neo4j driver, written in
  TypeScript (`server/services/graph-store.ts`) → :mod:`pinakes.engine.graph`,
  over the engine's own driver.
* **bulk acquisition** — ``python -m pinakes_engine.cli fetch`` spawned as a
  child process (`server/services/engine-acquisition.ts`) →
  :mod:`pinakes.engine.acquisition`.

`pinakes-engine` is a workspace dependency of this service
(``services/api/pyproject.toml``), so each of these is now a function call inside
the serving process: no socket, no fork, no second driver, and no schema
re-validation at a boundary that no longer exists.

**What this package is *not*.** It is not a route layer and it holds no request
handling — every function here takes plain arguments and returns plain JSON-ready
data, so a router is a thin adapter over it and the same call is usable from a
job or a test. The one HTTP-shaped thing it does encode is the failure split
(:mod:`pinakes.engine.errors`): unreachable is 503, unusable is 502, and that
distinction predates the port.

Everything degrades rather than crashing: a missing corpus, an unconfigured
Neo4j, an absent ``neo4j`` driver extra, an absent embedding model and an absent
SWI-Prolog are all ordinary states of a developer checkout, and each answers with
its documented degraded shape.

**Call it through its modules** — ``corpus.search(...)``, ``graph.node(...)``,
``datalog.run(...)``, ``acquisition.fetch(...)``. There is deliberately no flat
re-export of those functions here: half of them would shadow the module they came
from (``engine.corpus`` the function vs :mod:`pinakes.engine.corpus` the module),
and which one an importer got would depend on import order.
"""

from __future__ import annotations

from pinakes.engine import acquisition, corpus, datalog, graph
from pinakes.engine.errors import EngineError, EngineFailure, EngineUnavailable

__all__ = [
    "EngineError",
    "EngineFailure",
    "EngineUnavailable",
    "acquisition",
    "corpus",
    "datalog",
    "graph",
]
