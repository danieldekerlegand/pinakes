"""The parity baseline, read as data.

`contracts/parity/openapi.json` is the machine-generated inventory of every route
the TypeScript Express server serves (see `contracts/parity/README.md`). This
module turns it into :class:`ParityRoute` records and diffs it against whatever
the FastAPI app actually registered.

That diff is the *only* source of port status. There is deliberately no
hand-maintained "ported: true" field anywhere: a route counts as ported the
moment a router module registers it, and counts as outstanding until then, so
the coverage number can never disagree with the code.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pinakes.paths import parity_spec_path

#: OpenAPI keys under a path item that are HTTP operations rather than metadata.
_HTTP_METHODS = frozenset(
    {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
)


@dataclass(frozen=True, slots=True)
class ParityRoute:
    """One operation the Express backend serves."""

    method: str
    """Upper-case HTTP method."""

    path: str
    """OpenAPI-templated path, e.g. ``/api/languages/{id}``. FastAPI uses the
    same ``{param}`` syntax, so this doubles as the registration path."""

    operation_id: str
    port_unit: str
    """``tags[0]`` — the route group a port tasklist claims as a unit."""

    source: str
    """The Express file that registers it, e.g. ``server/routes/languages.ts``."""

    client_used: bool
    """Whether ``web/src`` references this route."""

    fixtures: tuple[str, ...]
    """Recorded parity fixtures that grade a port of this route."""

    @property
    def key(self) -> tuple[str, str]:
        """Identity used to diff the spec against the app's routing table."""
        return (self.method, self.path)

    def describe(self) -> str:
        return f"{self.method} {self.path}"


@dataclass(frozen=True, slots=True)
class ParityCoverage:
    """The spec split by what the running app registers."""

    ported: tuple[ParityRoute, ...]
    unported: tuple[ParityRoute, ...]

    @property
    def total(self) -> int:
        return len(self.ported) + len(self.unported)

    def as_dict(self) -> dict[str, Any]:
        """JSON payload for the coverage endpoint."""
        return {
            "baseline": "server/ (Express)",
            "spec": str(PARITY_SPEC_DOC),
            "total": self.total,
            "ported": len(self.ported),
            "unported": len(self.unported),
            "portedFraction": (len(self.ported) / self.total) if self.total else 1.0,
            "byPortUnit": self._by_port_unit(),
            "notImplemented": [
                {
                    "method": route.method,
                    "path": route.path,
                    "portUnit": route.port_unit,
                    "source": route.source,
                    "clientUsed": route.client_used,
                    "parityFixtures": list(route.fixtures),
                }
                for route in self.unported
            ],
        }

    def _by_port_unit(self) -> list[dict[str, Any]]:
        units: dict[str, dict[str, int]] = {}
        for status, group in (("ported", self.ported), ("unported", self.unported)):
            for route in group:
                counts = units.setdefault(route.port_unit, {"ported": 0, "unported": 0})
                counts[status] += 1
        return [
            {"portUnit": unit, **counts}
            for unit, counts in sorted(units.items())
        ]


#: Repo-relative location of the baseline, for the coverage payload. (The
#: absolute path is machine-specific and would make the response unstable.)
PARITY_SPEC_DOC = Path("contracts") / "parity" / "openapi.json"


def load_parity_routes(spec_path: Path | None = None) -> tuple[ParityRoute, ...]:
    """Read the parity spec into records, sorted by path then method.

    Sorted so that registration order — and therefore the ordering of the 501
    catalog in the routing table and in the coverage payload — is deterministic.
    """
    path = spec_path if spec_path is not None else parity_spec_path()
    spec = json.loads(path.read_text(encoding="utf-8"))
    routes: list[ParityRoute] = []
    for route_path, item in spec.get("paths", {}).items():
        for method, operation in item.items():
            if method.lower() not in _HTTP_METHODS:
                continue
            extension = operation.get("x-pinakes-parity", {})
            tags = operation.get("tags") or []
            routes.append(
                ParityRoute(
                    method=method.upper(),
                    path=route_path,
                    operation_id=operation.get("operationId", ""),
                    port_unit=tags[0] if tags else "untagged",
                    source=extension.get("source", "unknown"),
                    client_used=bool(extension.get("clientUsed", False)),
                    fixtures=tuple(extension.get("fixtures", [])),
                )
            )
    return tuple(sorted(routes, key=lambda route: (route.path, route.method)))


def split_coverage(
    routes: Iterable[ParityRoute], registered: Iterable[tuple[str, str]]
) -> ParityCoverage:
    """Split baseline routes into (ported, unported) against the app's table.

    ``registered`` is the app's own ``(METHOD, path)`` pairs. A baseline route is
    ported when an identical pair exists — same method, same path *template*. A
    router that registers ``/api/languages/{language_id}`` for the baseline's
    ``/api/languages/{id}`` therefore reads as unported, which is the intended
    strictness: the client's URLs are the contract, and so is the shape of them.
    """
    live = set(registered)
    ported: list[ParityRoute] = []
    unported: list[ParityRoute] = []
    for route in routes:
        (ported if route.key in live else unported).append(route)
    return ParityCoverage(ported=tuple(ported), unported=tuple(unported))
