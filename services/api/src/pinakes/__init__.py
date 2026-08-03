"""`pinakes` — the unified Python web service (docs/UNIFIED-PROJECT-PLAN.md §4).

Routing, request/response shaping, and serving the built React client. The
aggregation engine it calls into is a separate package, ``pinakes_engine``
(`engine/`), imported in-process rather than reached over HTTP.

Build the app with :func:`pinakes.app.create_app`; run it with
``python -m pinakes`` or ``uvicorn pinakes.app:create_app --factory``.
"""

from __future__ import annotations

from pinakes.app import create_app

__all__ = ["create_app"]
