"""Filesystem anchors the service resolves at runtime.

Two things live outside the Python package and have to be found on disk: the
built React client (`dist/public`, produced by `web/vite.config.ts`) and the
generated parity baseline (`contracts/parity/openapi.json`, which drives the 501
catalog). Both are located by walking up from this file to the repo root, and
both can be pointed elsewhere with an environment variable — that is what lets
the tests exercise the real code paths against a temporary directory, and what
would let a packaged deployment place them anywhere.
"""

from __future__ import annotations

import os
from pathlib import Path

from pinakes_contracts import contracts_dir

#: Env var overriding repo-root discovery outright.
REPO_ROOT_ENV = "PINAKES_REPO_ROOT"
#: Env var pointing at the built client directory (the one holding `index.html`).
CLIENT_DIST_ENV = "PINAKES_CLIENT_DIST"
#: Env var pointing at the generated parity spec.
PARITY_SPEC_ENV = "PINAKES_PARITY_SPEC"

#: Relative to `contracts/`, which `pinakes_contracts` locates for us.
PARITY_SPEC_CONTRACTS_RELPATH = Path("parity") / "openapi.json"

#: Relative to the repo root. Also the marker that *identifies* the repo root —
#: it is generated (`npm run parity:spec`) and committed, so it is always there.
PARITY_SPEC_RELPATH = Path("contracts") / PARITY_SPEC_CONTRACTS_RELPATH

#: Relative to the repo root. Must track `build.outDir` in `web/vite.config.ts`.
CLIENT_DIST_RELPATH = Path("dist") / "public"


class RepoRootNotFound(RuntimeError):
    """Raised when neither the env var nor the upward walk locates the repo."""


def repo_root() -> Path:
    """The repo checkout this service is running out of.

    Honours ``$PINAKES_REPO_ROOT``; otherwise walks up from this module looking
    for the committed parity spec. The walk works because the package is
    installed editable into the uv workspace venv, so ``__file__`` really is
    ``services/api/src/pinakes/paths.py`` inside the checkout.
    """
    override = os.environ.get(REPO_ROOT_ENV)
    if override:
        return Path(override).resolve()

    here = Path(__file__).resolve()
    for candidate in here.parents:
        if (candidate / PARITY_SPEC_RELPATH).is_file():
            return candidate
    raise RepoRootNotFound(
        f"could not locate the pinakes repo root above {here} "
        f"(looked for {PARITY_SPEC_RELPATH}); set ${REPO_ROOT_ENV}"
    )


def parity_spec_path() -> Path:
    """Path to the generated Express parity baseline.

    Resolved through ``pinakes_contracts.contracts_dir()`` — the one place in the
    stack that knows where ``contracts/`` is — rather than by joining a second
    ad-hoc walk onto the repo root. The two agree in a checkout; the difference is
    that an installed layout can move ``contracts/`` with ``$PINAKES_CONTRACTS_DIR``
    without also having to relocate the client build.
    """
    override = os.environ.get(PARITY_SPEC_ENV)
    if override:
        return Path(override).resolve()
    return contracts_dir() / PARITY_SPEC_CONTRACTS_RELPATH


def client_dist() -> Path:
    """Directory holding the built client. May not exist — nobody has to build."""
    override = os.environ.get(CLIENT_DIST_ENV)
    if override:
        return Path(override).resolve()
    return repo_root() / CLIENT_DIST_RELPATH
