"""The `/api/export/*` route group — per-profile open-dataset export.

Four routes over :mod:`pinakes.dataset.export`: list the profiles, fetch one,
export a dataset as JSON, and download a single file of one. Ported off the four
handlers that stayed inline in `server/routes.ts`, so every 500 here is the
`{message, error}` spelling those used.

Three things the adapter has to get right, none of which is in the service:

* **`POST /api/export` validates before it exports**, and the two share a
  vocabulary — so an unknown dataset is a **400** listing every complaint, never
  the service's throw. The throw is still reachable (a caller could skip
  validation) and lands in the same 500 as any other failure.
* **The download's filters are the query string minus `includeFiles`** — every
  other parameter is a column filter, including ones no file has, which the
  service ignores. A *repeated* parameter reaches Express as an array and is
  dropped by `typeof value === "string"`; Starlette hands back one value, which
  is the divergence this service has accepted since the fourth slice.
* **The download's content type is derived from the format and is wrong for
  TSV**: `format === "json" ? "application/json" : "text/csv"`, so a `.tsv`
  attachment is served as CSV. Kept — a client keying off the header would
  change behaviour if it were fixed, and the filename already says `.tsv`.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse, Response

from pinakes.dataset import export as pipeline
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.export")

router = APIRouter(tags=["export"])


def _payload(body: Any) -> dict[str, Any]:
    """``req.body ?? {}`` — a body that is not an object has no properties."""
    return body if isinstance(body, dict) else {}


@router.get("/api/export/datasets")
def list_export_datasets() -> Any:
    """Every dataset profile, in declaration order."""
    try:
        return pipeline.dataset_profiles()
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger, "listing export datasets", "Failed to list export datasets", error
        )


@router.get("/api/export/datasets/{id}")
def get_export_dataset(id: str) -> Any:
    """One profile by id, or 404."""
    try:
        profile = pipeline.dataset_profile(id)
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger, "fetching export dataset", "Failed to fetch export dataset", error
        )
    if profile is None:
        return _reads.missing("Dataset not found")
    return profile


@router.post("/api/export")
def export_dataset(body: Annotated[Any, Body()] = None) -> Any:
    """Export a profile in the requested format.

    Body: `{dataset, format, filters?, includeFiles?}`.

    `filters` is passed straight through to the service, which reads it as a
    column → substring bag; a non-object `filters` is truthy and would be
    iterated over there, so anything but a mapping is treated as no filter here
    rather than raising something Express never raised.
    """
    data = _payload(body)
    dataset = data.get("dataset")
    fmt = data.get("format")
    filters = data.get("filters")
    include_files = data.get("includeFiles")

    try:
        errors = pipeline.validate_export_options(
            dataset, fmt, include_files=include_files
        )
        if errors:
            return JSONResponse(
                status_code=400,
                content={"message": "Invalid export options", "errors": errors},
            )
        return pipeline.export_dataset(
            dataset,
            str(fmt),
            filters=filters if isinstance(filters, dict) else None,
            include_files=include_files,
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        logger.exception("Error exporting dataset")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to export dataset", "error": str(error)},
        )


@router.get("/api/export/download/{dataset}/{format}")
def download_export(dataset: str, format: str, request: Request) -> Any:
    """The first exported file of a profile, as an attachment.

    "First" is literal: a profile with two files downloads only the one that
    comes first in its `files` list unless `?includeFiles=` narrows it. A
    profile whose every file is missing or empty is a **404**, not an empty
    attachment.
    """
    filters = {
        key: value
        for key, value in request.query_params.items()
        if key != "includeFiles"
    }
    raw_include = request.query_params.get("includeFiles")
    include_files = raw_include.split(",") if raw_include is not None else None

    try:
        errors = pipeline.validate_export_options(
            dataset, format, include_files=include_files
        )
        if errors:
            return JSONResponse(
                status_code=400,
                content={"message": "Invalid export options", "errors": errors},
            )

        result = pipeline.export_dataset(
            dataset, format, filters=filters, include_files=include_files
        )
        if not result["files"]:
            return _reads.missing("No data to export")

        first = result["files"][0]
        media_type = "application/json" if format == "json" else "text/csv"
        return Response(
            content=str(first["content"]),
            media_type=f"{media_type}; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename={first['filename']}"
            },
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        logger.exception("Error downloading export")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to download export", "error": str(error)},
        )
