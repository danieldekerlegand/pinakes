"""The three `/api/visualizations/*` diagram feeds.

The cutover's tenth slice (pinakes:80 US-1, continued). Everything below HTTP is
:mod:`pinakes.analytics.visualizations`; these handlers read two query
parameters, load between two and four tables, and hand the result over.

Both 500 spellings that exist in `routes.ts` are avoided here — all three of
these handlers answer `{message}` alone, which is the third spelling
:mod:`pinakes.routers.data_quality` also carries.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request

from pinakes.analytics import visualizations
from pinakes.lexicons import storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.visualizations")

router = APIRouter(tags=["visualizations"])

_int = _reads.query_int


def _failed(context: str, message: str) -> Any:
    return _reads.failed_plain(logger, context, message)


@router.get("/api/visualizations/sankey")
def sankey(request: Request) -> Any:
    """Language contacts as a flow diagram, optionally windowed by year."""
    year_start = _int(request, "yearStart")
    year_end = _int(request, "yearEnd")
    try:
        lexicons = lexicons_dir()
        return visualizations.build_language_sankey(
            storage.load_language_contacts(lexicons),
            storage.load_languages(lexicons),
            year_start=year_start,
            year_end=year_end,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "building sankey data", "Failed to build sankey visualization data"
        )


@router.get("/api/visualizations/cuisine-sankey")
def cuisine_sankey() -> Any:
    """Cuisines linked by shared food types, then by shared region."""
    try:
        lexicons = lexicons_dir()
        return visualizations.build_cuisine_sankey(
            storage.load_cuisines(lexicons),
            storage.load_cuisine_items(lexicons),
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "building cuisine sankey data",
            "Failed to build cuisine sankey visualization data",
        )


@router.get("/api/visualizations/chord")
def chord(request: Request) -> Any:
    """Mutual influence between language families, as a symmetric matrix."""
    year_start = _int(request, "yearStart")
    year_end = _int(request, "yearEnd")
    try:
        lexicons = lexicons_dir()
        return visualizations.build_family_chord(
            storage.load_language_contacts(lexicons),
            storage.load_languages(lexicons),
            storage.load_language_families(lexicons),
            year_start=year_start,
            year_end=year_end,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "building chord data", "Failed to build chord visualization data"
        )
