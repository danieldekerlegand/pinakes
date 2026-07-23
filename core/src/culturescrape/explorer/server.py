"""Launch the explorer app with uvicorn.

Kept apart from :mod:`culturescrape.explorer.app` so the CLI can import the whole
package behind one ``try/except ImportError`` and surface a single install hint
when the ``gui`` extra (which provides uvicorn) is absent.
"""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI

#: Defaults for the local development server.
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def run_server(
    app: FastAPI, *, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT
) -> None:
    """Serve *app* on *host*:*port* until interrupted."""
    uvicorn.run(app, host=host, port=port)
