"""Serving the built React client at the root.

`web/` builds to `dist/public` (`build.outDir` in `web/vite.config.ts`); this is
the FastAPI half of what `serveStatic` does in `server/vite.ts` today. Mounted
last so it can never shadow an API route, and mounted with a single-page-app
fallback: a request for a client-side route like `/atlas/languages` is not a
file, and must still get `index.html` so the router in the browser can take it.

One deliberate divergence from Express: the fallback does **not** apply to
backend paths. Express's ``app.use("*")`` hands `index.html` back for an unknown
`/api/...` URL, so a typo'd fetch resolves as HTML with status 200 and fails
somewhere much later. Here it 404s as JSON.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

#: Path prefixes owned by the backend — never answered with the SPA shell. These
#: are the non-client roots the parity baseline serves (`/api/*`, `/mcp`, and
#: `/.well-known/*`); a request under them that reached the static mount is
#: simply not a route.
BACKEND_PREFIXES = ("api", "mcp", ".well-known")


def _is_backend_path(path: str) -> bool:
    return path.split("/", 1)[0] in BACKEND_PREFIXES


class SpaStaticFiles(StaticFiles):
    """`StaticFiles` that falls back to `index.html` for client-side routes."""

    async def get_response(self, path: str, scope: Scope) -> Any:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or _is_backend_path(path):
                raise
            return await super().get_response("index.html", scope)


def mount_client(app: FastAPI, dist: Path) -> bool:
    """Mount the built client at ``/``. Returns whether a build was found.

    With no build present the mount is replaced by a catch-all that explains how
    to make one, rather than an import-time crash the way `server/vite.ts` does
    it — the API half of the service is useful (and testable) on its own, and a
    developer who has not run `npm run build` should still get a working
    `/api/health` and a readable answer at `/`.
    """
    if (dist / "index.html").is_file():
        app.mount("/", SpaStaticFiles(directory=dist, html=True), name="client")
        return True

    message = (
        f"The client has not been built: no index.html under {dist}. "
        f"Run `npm run build` (or set $PINAKES_CLIENT_DIST). The API is unaffected."
    )

    @app.get("/{client_path:path}", include_in_schema=False)
    async def client_not_built(client_path: str) -> JSONResponse:
        if _is_backend_path(client_path):
            return JSONResponse(status_code=404, content={"error": "not_found"})
        return JSONResponse(
            status_code=503,
            content={"error": "client_not_built", "message": message},
        )

    return False
