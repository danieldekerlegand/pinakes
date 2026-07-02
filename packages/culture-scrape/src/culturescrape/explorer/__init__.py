"""Read-only web explorer for a built corpus (tasklist 7, ``ralph/gui-explorer``).

A local web app for navigating the corpus across its three representations
(canonical TSV, Neo4j, Prolog/Datalog) and surfacing scraping completeness. It is
**strictly read-only**: it reads the pipeline's outputs and never writes them.

The app is built per corpus source by :func:`create_app`; the ``culturescrape
serve`` command launches it with uvicorn. The whole package lives behind the
optional ``gui`` extra, so importing it without that extra installed fails with
an ImportError the CLI turns into an install hint.
"""

from __future__ import annotations

from culturescrape.explorer.app import create_app
from culturescrape.explorer.server import run_server

__all__ = ["create_app", "run_server"]
