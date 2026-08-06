"""Filesystem anchors the service resolves at runtime.

Several things live outside the Python package and have to be found on disk: the
built React client (`dist/public`, produced by `web/vite.config.ts`), the
generated parity baseline (`contracts/parity/openapi.json`, which drives the 501
catalog), and the data trees the ported route groups read and write — the
contribution queue, the changelog, the collaborative stores (collections,
annotations, steward adoptions), and the lexicon corpus. All are located by
walking up from this file to the repo root, and all can be pointed elsewhere
with an environment variable — that is what lets the tests exercise the real
code paths against a temporary directory, and what would let a packaged
deployment place them anywhere.

The data-tree overrides are load-bearing for the test suite, not a nicety: a
test that wrote into the live `data/source/lexicons/` would be visible to every
other reader of the corpus in the same window (`server/CLAUDE.md` records how
that failure actually landed), so `conftest.py` redirects all of them by default.
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
#: Env var pointing at the contribution review queue (JSON-per-record).
CONTRIBUTIONS_DIR_ENV = "PINAKES_CONTRIBUTIONS_DIR"
#: Env var pointing at the dataset changelog (JSON-per-record).
CHANGELOG_DIR_ENV = "PINAKES_CHANGELOG_DIR"
#: Env var pointing at the curated collections (JSON-per-record).
COLLECTIONS_DIR_ENV = "PINAKES_COLLECTIONS_DIR"
#: Env var pointing at the entity annotations (JSON-per-record).
ANNOTATIONS_DIR_ENV = "PINAKES_ANNOTATIONS_DIR"
#: Env var pointing at the steward adoptions (a single `stewards.json`).
STEWARDSHIP_DIR_ENV = "PINAKES_STEWARDSHIP_DIR"
#: Env var pointing at the living-dataset state (a single `state.json`).
LIVING_DATASET_DIR_ENV = "PINAKES_LIVING_DATASET_DIR"
#: Env var pointing at the lexicon corpus (`*.tsv`).
LEXICONS_DIR_ENV = "PINAKES_LEXICONS_DIR"
#: Env var pointing at the GeoJSON boundary files the region resolver indexes.
BOUNDARIES_DIR_ENV = "PINAKES_BOUNDARIES_DIR"
#: Env var pointing at Glottolog's voronoi macroarea polygons.
GLOTTOLOG_VORONOI_DIR_ENV = "PINAKES_GLOTTOLOG_VORONOI_DIR"

#: Relative to `contracts/`, which `pinakes_contracts` locates for us.
PARITY_SPEC_CONTRACTS_RELPATH = Path("parity") / "openapi.json"

#: Relative to the repo root. Also the marker that *identifies* the repo root —
#: it is generated (`npm run parity:spec`) and committed, so it is always there.
PARITY_SPEC_RELPATH = Path("contracts") / PARITY_SPEC_CONTRACTS_RELPATH

#: Relative to the repo root. Must track `build.outDir` in `web/vite.config.ts`.
CLIENT_DIST_RELPATH = Path("dist") / "public"

#: Relative to the repo root. The same trees `server/services/*` used, so the two
#: implementations see one queue / one log / one corpus during the cutover.
CONTRIBUTIONS_RELPATH = Path("data") / "runtime" / "contributions"
CHANGELOG_RELPATH = Path("data") / "runtime" / "changelog"
COLLECTIONS_RELPATH = Path("data") / "runtime" / "collections"
ANNOTATIONS_RELPATH = Path("data") / "runtime" / "annotations"
STEWARDSHIP_RELPATH = Path("data") / "runtime" / "stewardship"
LIVING_DATASET_RELPATH = Path("data") / "runtime" / "living-dataset"
LEXICONS_RELPATH = Path("data") / "source" / "lexicons"

#: The two directories `getDefaultBoundaryResolver` loads, both resolved against
#: `process.cwd()` over there — which is the repo root, because the server has to
#: be started from it. **Neither exists in a plain checkout**: `data/boundaries/`
#: is unpopulated and `sources/glottolog/` is an unchecked-out submodule, so the
#: resolver is legitimately empty (`geo/boundaries.py` says what that means).
BOUNDARIES_RELPATH = Path("data") / "boundaries"
GLOTTOLOG_VORONOI_RELPATH = (
    Path("sources") / "glottolog" / "config" / "macroareas" / "voronoi"
)


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


def _data_dir(env: str, relpath: Path) -> Path:
    """A repo data tree, overridable by environment variable.

    Read on every call rather than cached: the override is how a test points one
    request at a temporary directory, and a cached answer would leak the first
    test's directory into the rest of the session.
    """
    override = os.environ.get(env)
    if override:
        return Path(override).resolve()
    return repo_root() / relpath


def contributions_dir() -> Path:
    """The contribution review queue — one JSON file per contribution."""
    return _data_dir(CONTRIBUTIONS_DIR_ENV, CONTRIBUTIONS_RELPATH)


def changelog_dir() -> Path:
    """The dataset changelog — one JSON file per recorded change."""
    return _data_dir(CHANGELOG_DIR_ENV, CHANGELOG_RELPATH)


def collections_dir() -> Path:
    """Curated entity collections — one JSON file per collection."""
    return _data_dir(COLLECTIONS_DIR_ENV, COLLECTIONS_RELPATH)


def annotations_dir() -> Path:
    """User notes on entities — one JSON file per annotation."""
    return _data_dir(ANNOTATIONS_DIR_ENV, ANNOTATIONS_RELPATH)


def stewardship_dir() -> Path:
    """Steward adoptions — a single `stewards.json`, not one file per record."""
    return _data_dir(STEWARDSHIP_DIR_ENV, STEWARDSHIP_RELPATH)


def living_dataset_dir() -> Path:
    """Living-dataset state — a single `state.json`, like the steward roster."""
    return _data_dir(LIVING_DATASET_DIR_ENV, LIVING_DATASET_RELPATH)


def lexicons_dir() -> Path:
    """The lexicon corpus an approved AI draft is promoted into."""
    return _data_dir(LEXICONS_DIR_ENV, LEXICONS_RELPATH)


def boundaries_dir() -> Path:
    """GeoJSON region boundaries. Read-only, and absent in a plain checkout."""
    return _data_dir(BOUNDARIES_DIR_ENV, BOUNDARIES_RELPATH)


def glottolog_voronoi_dir() -> Path:
    """Glottolog's macroarea polygons — the resolver's second source."""
    return _data_dir(GLOTTOLOG_VORONOI_DIR_ENV, GLOTTOLOG_VORONOI_RELPATH)
