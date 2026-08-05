"""Drop-in router registration.

The promise these tests hold to is the one that lets the port tasklists run in
parallel: adding a file under `pinakes/routers/` mounts it, and adding it is the
*only* edit. If any of these ever needs a central list updated to pass, the
promise is broken.
"""

from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes import routers
from pinakes.app import create_app, registered_routes
from pinakes.routers import RouterModuleError, discover_routers

#: The drop-in serves a **still-unported** baseline path, because the second
#: test asserts the stub disappears when it lands. Was `/api/scraping-jobs`
#: until pinakes:80 US-1's fifth slice ported it; expect to move it again.
#: The module name must be one no real router will ever take — a collision
#: would have the committed file win the import and the drop-in do nothing.
DROP_IN_ROUTE = "/api/visualizations/chord"
DROP_IN_MODULE = "drop_in_probe"

DROP_IN = f"""
from fastapi import APIRouter

router = APIRouter()


@router.get("{DROP_IN_ROUTE}")
def list_jobs() -> dict[str, list[str]]:
    return {{"jobs": []}}
"""


def write_module(directory: Path, name: str, source: str) -> None:
    """Drop a module into the routers search path, mid-test.

    ``invalidate_caches`` is not optional: the import machinery caches each
    directory's listing, and a file created after that directory was first
    scanned is otherwise invisible.
    """
    (directory / f"{name}.py").write_text(source, encoding="utf-8")
    importlib.invalidate_caches()


@pytest.fixture
def drop_in_dir(tmp_path: Path) -> Iterator[Path]:
    """Extend the routers package's search path with a scratch directory.

    Same mechanism the real package uses (``__path__`` is what
    ``pkgutil.iter_modules`` walks), so a module dropped here is discovered by
    exactly the code path a committed one would be — without leaving a file in
    the tree for the rest of the suite to trip over.
    """
    added = str(tmp_path)
    routers.__path__.append(added)
    try:
        yield tmp_path
    finally:
        routers.__path__.remove(added)
        for name in [n for n in sys.modules if n.startswith("pinakes.routers.")]:
            module = sys.modules[name]
            origin = getattr(module, "__file__", None)
            if origin and origin.startswith(added):
                del sys.modules[name]


def test_shell_routers_are_discovered() -> None:
    found = {entry.module for entry in discover_routers()}
    assert {"pinakes.routers.health", "pinakes.routers.parity"} <= found


def test_discovery_is_deterministically_ordered() -> None:
    modules = [entry.module for entry in discover_routers()]
    assert modules == sorted(modules)


def test_dropping_in_a_module_mounts_it(drop_in_dir: Path) -> None:
    write_module(drop_in_dir, DROP_IN_MODULE, DROP_IN)

    app = create_app(client_directory=drop_in_dir / "missing")
    assert f"pinakes.routers.{DROP_IN_MODULE}" in app.state.router_modules
    assert ("GET", DROP_IN_ROUTE) in registered_routes(app)

    with TestClient(app) as client:
        response = client.get(DROP_IN_ROUTE)
    assert response.status_code == 200
    assert response.json() == {"jobs": []}


def test_a_dropped_in_route_leaves_the_501_catalog(drop_in_dir: Path) -> None:
    """Porting a route is what removes its stub — nothing else to update."""
    before = create_app(client_directory=drop_in_dir / "missing")
    assert any(
        route.describe() == f"GET {DROP_IN_ROUTE}"
        for route in before.state.parity_coverage.unported
    )

    write_module(drop_in_dir, DROP_IN_MODULE, DROP_IN)
    after = create_app(client_directory=drop_in_dir / "missing")

    assert any(
        route.describe() == f"GET {DROP_IN_ROUTE}"
        for route in after.state.parity_coverage.ported
    )
    assert len(after.state.parity_coverage.unported) == (
        len(before.state.parity_coverage.unported) - 1
    )


def test_underscored_modules_are_helpers_not_routers(drop_in_dir: Path) -> None:
    write_module(drop_in_dir, "_shared", "value = 1\n")
    assert all(
        not entry.module.endswith("_shared") for entry in discover_routers()
    )


def test_a_module_without_a_router_is_an_error(drop_in_dir: Path) -> None:
    write_module(drop_in_dir, "forgot", "# no router here\n")
    with pytest.raises(RouterModuleError, match="exposes no module-level"):
        discover_routers()


def test_a_non_router_router_is_an_error(drop_in_dir: Path) -> None:
    write_module(drop_in_dir, "wrong_type", "router = object()\n")
    with pytest.raises(RouterModuleError, match="not an APIRouter"):
        discover_routers()


def test_an_unimportable_module_is_an_error(drop_in_dir: Path) -> None:
    """Never silently skipped: a stub would then quietly cover for the gap."""
    write_module(drop_in_dir, "broken", "import no_such_module_here\n")
    with pytest.raises(RouterModuleError, match="failed to import"):
        discover_routers()
