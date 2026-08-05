"""Map-layer geometry helpers, below HTTP.

One module so far — :mod:`~pinakes.geo.bbox`, the viewport culling every
`/api/map/*` GeoJSON endpoint runs its features through. It is a package rather
than a loose module because the map port unit that will use it has more of this
shape to bring across (boundary resolution, drawn geometry), and they belong
together rather than scattered under `pinakes/`.

Nothing here reads the corpus or imports FastAPI: geometry in, geometry out.
"""

from __future__ import annotations
