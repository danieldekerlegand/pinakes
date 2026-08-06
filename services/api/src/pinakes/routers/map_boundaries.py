"""The four `/api/map/*` routes that are not corpus layers.

The cutover's tenth slice (pinakes:80 US-1, continued), and the last of the `map`
port unit: the three region-boundary endpoints over
:mod:`pinakes.geo.boundaries`, plus the Gemini-vision feature extractor over
:mod:`pinakes.media.map_image`. A second file rather than more of
`routers/map_layers.py` because nothing here reads the lexicon corpus — these
four share a port unit with the layers, not a data source.

* **The resolver is empty in a plain checkout**, so `resolve` is a 404, the
  feature resolver hands its input back unchanged and `search` answers
  `{boundaries: [], total: 0}`. `geo/boundaries.py` says why, and it is the
  Express answer too.
* **`?name=` is required and read `as string`.** A repeated parameter reaches
  Express as an array, fails the `typeof` test and 400s where Starlette hands
  back the first value — the divergence this service has accepted since the
  fourth slice (`routers/map_layers._string_param`).
* **`analyze-image` validates three fields and the *shape* of `bounds`, nothing
  else.** Whatever passes goes to the model, which is why the missing-key 500 is
  what this checkout actually answers.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.geo import boundaries
from pinakes.media import map_image
from pinakes.paths import boundaries_dir, glottolog_voronoi_dir
from pinakes.routers import _reads
from pinakes.routers._owner import json_body

logger = logging.getLogger("pinakes.map_boundaries")

router = APIRouter(tags=["map"])

Body = Annotated[Any, Depends(json_body)]


def _resolver() -> boundaries.BoundaryResolver:
    return boundaries.get_default_boundary_resolver(
        data_dir=boundaries_dir(), glottolog_dir=glottolog_voronoi_dir()
    )


@router.get("/api/map/boundaries/resolve")
def resolve(request: Request) -> Any:
    """One region name to one precise geometry, optionally simplified."""
    name = request.query_params.get("name")
    if not name:
        return JSONResponse(
            status_code=400, content={"message": "name query parameter is required"}
        )
    raw_tolerance = request.query_params.get("simplify")
    tolerance = tsv.js_parse_float(raw_tolerance) if raw_tolerance else None
    try:
        boundary = _resolver().resolve(name, tolerance)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger, "resolving boundary", "Failed to resolve boundary", error
        )
    if boundary is None:
        return JSONResponse(
            status_code=404, content={"message": f'No boundary found for "{name}"'}
        )
    return {
        "id": boundary["id"],
        "name": boundary["name"],
        "source": boundary["source"],
        "geometry": boundary["geometry"],
    }


@router.post("/api/map/boundaries/resolve-features")
def resolve_features(body: Body) -> Any:
    """Swap precise geometries into a feature collection, where one is known."""
    payload = body if isinstance(body, dict) else {}
    features = payload.get("features")
    if not isinstance(features, list):
        return JSONResponse(
            status_code=400,
            content={"message": "features array is required in request body"},
        )
    region_name_key = payload.get("regionNameKey")
    if region_name_key is None:
        region_name_key = "name"
    try:
        resolved = _resolver().resolve_features(features, str(region_name_key))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "resolving feature boundaries",
            "Failed to resolve feature boundaries",
            error,
        )
    return {"type": "FeatureCollection", "features": resolved}


@router.get("/api/map/boundaries/search")
def search(request: Request) -> Any:
    """With `?q=`, the matching boundaries; without it, the whole name list.

    The two answers have **different shapes** — `{results}` against
    `{boundaries, total}` — which is the client's own branch, not a slip.
    """
    query = request.query_params.get("q")
    raw_limit = request.query_params.get("limit")
    try:
        resolver = _resolver()
        if query:
            limit = tsv.js_parse_int(raw_limit) if raw_limit else 10
            found = resolver.search(query, limit)
            return {
                "results": [
                    {
                        "id": boundary["id"],
                        "name": boundary["name"],
                        "source": boundary["source"],
                    }
                    for boundary in found
                ]
            }
        return {
            "boundaries": resolver.list_boundary_names(),
            "total": resolver.size,
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger, "searching boundaries", "Failed to search boundaries", error
        )


@router.post("/api/map/analyze-image")
def analyze_image(body: Body) -> Any:
    """Extract settlements, boundaries, routes and labels from a map image."""
    payload = body if isinstance(body, dict) else {}
    image = payload.get("imageBase64")
    mime_type = payload.get("mimeType")
    bounds = payload.get("bounds")
    if not image or not mime_type or not bounds:
        return JSONResponse(
            status_code=400,
            content={
                "message": "Missing required fields: imageBase64, mimeType, bounds"
            },
        )
    if not isinstance(bounds, list) or len(bounds) != 2:
        return JSONResponse(
            status_code=400,
            content={"message": "bounds must be [[south, west], [north, east]]"},
        )
    try:
        return map_image.analyze_map_image(
            {
                "imageBase64": image,
                "mimeType": mime_type,
                "bounds": bounds,
                "featureTypes": payload.get("featureTypes"),
            }
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Error analyzing map image")
        message = str(error) or "Failed to analyze map image"
        return JSONResponse(status_code=500, content={"message": message})
