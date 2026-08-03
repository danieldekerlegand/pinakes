"""``python -m pinakes`` / the ``pinakes`` console script.

Serves the API and the client on one port, like `server/index.ts` does today —
and on the *same* port (``$PORT``, default 3050), so the client's same-origin
`/api/...` fetches keep working when the service is swapped in.
"""

from __future__ import annotations

import os

import uvicorn

DEFAULT_PORT = 3050
DEFAULT_HOST = "0.0.0.0"  # noqa: S104 - single published port, as with server/index.ts


def main() -> None:
    """Run the service under uvicorn."""
    uvicorn.run(
        "pinakes.app:create_app",
        factory=True,
        host=os.environ.get("HOST", DEFAULT_HOST),
        port=int(os.environ.get("PORT", DEFAULT_PORT)),
        reload=os.environ.get("PINAKES_RELOAD") == "1",
    )


if __name__ == "__main__":
    main()
