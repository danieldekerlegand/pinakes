"""Search: the federated corpus+graph query, and place resolution.

Four modules, along the seam `server/services/` already had:

* :mod:`~pinakes.search.global_search` — `GET /api/search`, the eighteen-domain
  local scorer merged with the shared graph's own hits.
* :mod:`~pinakes.search.graph_resolver` — entity ref → `csid`, which is what
  makes "the same entity in both stores" a single result.
* :mod:`~pinakes.search.natural` — the temporal-spatial query parser behind
  `/api/search/{natural,spatial,suggestions}`.
* :mod:`~pinakes.search.places` — `/api/map/places/*`: local corpus first, then
  GeoNames, then Nominatim.

All four are plain functions over a lexicons directory: arguments in, JSON-ready
dicts out, no FastAPI import. The routers (`pinakes.routers.{search,places}`) are
adapters over them.
"""

from __future__ import annotations
