"""The `/api/import/*` route group — pasted CSV/TSV straight into the corpus.

Two handlers that stayed inline in `server/routes.ts`, so both 500s are the
`{message}`-only spelling. The module is `bulk_import` rather than `import` for
the obvious reason; the *paths* are the baseline's verbatim.

* **The body is validated by hand, in this order**: `target` must be a non-empty
  string, then `content`, then `mode` must be `append` or `replace`. Each is its
  own 400 naming the field. A declared model would answer 422 and would reject
  all three at once, which is a different contract and a worse message.
* **`skipDuplicates !== false`** — so anything except a literal `false` (absent,
  `null`, `0`, `"no"`) means *do* skip duplicates. Deduping by default is the
  safe direction for a route that appends to a live table.
* **The 400/200 decision is a string prefix**, not a status the service returns:
  `Unmapped columns (ignored): …` is a warning and everything else is a
  refusal. See :func:`pinakes.dataset.bulk_import.has_blocking_errors`.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.dataset import bulk_import as importer
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.import")

router = APIRouter(tags=["import"])

#: The two modes `POST /api/import/bulk` admits, in message order.
VALID_MODES = ("append", "replace")


@router.get("/api/import/targets")
def list_import_targets() -> Any:
    """Every importable TSV with its header row, sorted by filename.

    A corpus directory that is not there is a **500**, not an empty list — see
    :func:`pinakes.dataset.bulk_import.import_targets`.
    """
    try:
        return importer.import_targets()
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "listing import targets", "Failed to list import targets"
        )


@router.post("/api/import/bulk")
def bulk_import_rows(body: Annotated[Any, Body()] = None) -> Any:
    """Import rows into a lexicon TSV. Body: `{target, content, mode, skipDuplicates?}`.

    **This writes the live corpus.** A backup is taken before either mode
    touches the file, and the response names it — that is the only undo.
    """
    data = body if isinstance(body, dict) else {}
    target = data.get("target")
    content = data.get("content")
    mode = data.get("mode")

    if not target or not isinstance(target, str):
        return JSONResponse(
            status_code=400, content={"message": "Missing required field: target"}
        )
    if not content or not isinstance(content, str):
        return JSONResponse(
            status_code=400, content={"message": "Missing required field: content"}
        )
    if not mode or mode not in VALID_MODES:
        return JSONResponse(
            status_code=400,
            content={"message": "Mode must be 'append' or 'replace'"},
        )

    try:
        result = importer.bulk_import(
            target=target,
            content=content,
            mode=mode,
            skip_duplicates=data.get("skipDuplicates") is not False,
        )
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(logger, "in bulk import", "Bulk import failed")

    blocking = importer.has_blocking_errors(list(result["errors"]))
    return JSONResponse(status_code=400 if blocking else 200, content=result)
