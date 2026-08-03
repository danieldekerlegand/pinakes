"""Auto-registering router package.

**Drop a module in here and it is mounted.** No central list to edit, no
`include_router` call to add, nothing shared to touch — which is the point:
the port tasklists that follow (one route group each, per
`docs/UNIFIED-PROJECT-PLAN.md` §7) run in parallel worktrees and would otherwise
all be rewriting the same app-wiring file and colliding on every merge.

The contract a module must satisfy:

* it lives directly under ``pinakes.routers``;
* its name does not start with ``_`` (that prefix marks shared helpers, which
  are imported normally and never scanned);
* it exposes a module-level ``router`` that is a :class:`fastapi.APIRouter`;
* the paths on that router are the **baseline paths verbatim** — same
  ``/api/...`` templates as ``contracts/parity/openapi.json``, because that
  literal match is what moves a route from the 501 catalog to ported.

A module that is present but cannot be imported, or that has no ``router``, is
an error, not a skip. Silently ignoring it would let a port tasklist "land" a
route group that never actually mounted — and the 501 catalog would happily
cover for it.
"""

from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass

from fastapi import APIRouter


class RouterModuleError(RuntimeError):
    """A module under this package does not satisfy the drop-in contract."""


@dataclass(frozen=True, slots=True)
class DiscoveredRouter:
    """One mounted router module."""

    module: str
    """Fully-qualified module name, e.g. ``pinakes.routers.health``."""

    router: APIRouter


def discover_routers(package: str = __name__) -> tuple[DiscoveredRouter, ...]:
    """Import every router module under *package*, in deterministic name order.

    Sorted by module name so the routing table — and therefore Starlette's
    first-match-wins resolution between any two overlapping paths — does not
    depend on filesystem iteration order.
    """
    scanned = importlib.import_module(package)
    found: list[DiscoveredRouter] = []
    names = sorted(
        info.name
        for info in pkgutil.iter_modules(scanned.__path__)
        if not info.name.startswith("_")
    )
    for name in names:
        qualified = f"{package}.{name}"
        try:
            module = importlib.import_module(qualified)
        except Exception as exc:  # noqa: BLE001 - re-raised with the module named
            raise RouterModuleError(
                f"{qualified} is in the routers package but failed to import"
            ) from exc
        router = getattr(module, "router", None)
        if router is None:
            raise RouterModuleError(
                f"{qualified} exposes no module-level `router`; a router module "
                f"must define `router = APIRouter()` (prefix the file with `_` "
                f"if it is a helper, not a route group)"
            )
        if not isinstance(router, APIRouter):
            raise RouterModuleError(
                f"{qualified}.router is {type(router).__name__}, not an APIRouter"
            )
        found.append(DiscoveredRouter(module=qualified, router=router))
    return tuple(found)
