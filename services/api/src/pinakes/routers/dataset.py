"""The `/api/dataset/*` route group — citable, versioned corpus snapshots.

`server/routes/dataset-releases.ts`. Three routes: release metadata, the full
bundled download, and minting a new release.

* **Every failure here is a 400, including a genuine 500's worth of one.** The
  TypeScript wrapped each handler in a `catch` that answered 400 with the error
  message; a corpus that cannot be read therefore reads as a bad request. Kept —
  the message is the useful part and it is preserved verbatim.
* **`format` and `datasets` are coerced, never rejected.** An unrecognised
  format silently becomes `json` and a blank `datasets` means "all", so this
  group has no 422 and no validation branch at all. `?datasets=languages,grammar`
  and a JSON array body both arrive as a list.
* **Only `POST` mints a DOI.** The two GETs pass no minter, so they can be
  called freely without touching Zenodo — which is what makes
  `GET /api/dataset/release` a cheap dashboard read.
* **The version derives from the *whole* changelog, unfiltered.** `stats()` was
  called with no arguments, so a release bumps on every recorded change since
  the log began, not since the previous release. That is the behaviour; a
  `previousVersion` in the body is the only lever a caller has over it.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse, Response

from pinakes.dataset import export as pipeline
from pinakes.routers import _release

logger = logging.getLogger("pinakes.dataset")

router = APIRouter(tags=["dataset"])


@router.get("/api/dataset/release")
def get_dataset_release(request: Request) -> Any:
    """Release metadata only — version, DOI, licence, per-dataset row counts.

    No file contents, so this is the call a citation widget makes. The version
    is the **seed**: no minter and no changelog counts are passed, so a GET
    never advances or derives one.
    """
    try:
        snapshot = pipeline.build_dataset_snapshot(
            fmt=_release.parse_format(request.query_params.get("format")),
            datasets=_release.parse_datasets(request.query_params.get("datasets")),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _release.failed(logger, "building release metadata", error)
    return snapshot["metadata"]


@router.get("/api/dataset/full")
def get_dataset_full(request: Request) -> Any:
    """The whole corpus — every profile's files plus the metadata — as an attachment.

    Serialised with `JSON.stringify(snapshot, null, 2)`: a two-space indent and
    **no ASCII escaping**, because the corpus is full of non-Latin scripts and
    escaping them would make the download a different document to the one
    Express published.
    """
    try:
        snapshot = pipeline.build_dataset_snapshot(
            fmt=_release.parse_format(request.query_params.get("format")),
            datasets=_release.parse_datasets(request.query_params.get("datasets")),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _release.failed(logger, "building dataset download", error)

    filename = f"pinakes-dataset-v{snapshot['metadata']['version']}.json"
    return Response(
        content=json.dumps(snapshot, indent=2, ensure_ascii=False),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/dataset/release")
def mint_dataset_release(body: Annotated[Any, Body()] = None) -> Any:
    """Mint a new versioned release.

    Body: `{version?, previousVersion?, format?, datasets?}`.

    Version precedence: an explicit `version`, else the changelog-derived bump
    over `previousVersion` (default the seed `1.0.0`). The changelog is only
    consulted when no explicit version was given — reading it otherwise would be
    work whose answer is discarded.
    """
    data = body if isinstance(body, dict) else {}
    version = data.get("version") if isinstance(data.get("version"), str) else None
    previous = (
        data["previousVersion"]
        if isinstance(data.get("previousVersion"), str)
        else pipeline.DATASET_RELEASE_VERSION
    )

    try:
        counts = None if version else _release.change_counts()
        snapshot = pipeline.build_dataset_snapshot(
            fmt=_release.parse_format(data.get("format")),
            datasets=_release.parse_datasets(data.get("datasets")),
            version=version,
            previous_version=previous,
            change_counts=counts,
            doi_minter=pipeline.zenodo_doi_minter(),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _release.failed(logger, "minting dataset release", error)
    return JSONResponse(status_code=201, content=snapshot["metadata"])
