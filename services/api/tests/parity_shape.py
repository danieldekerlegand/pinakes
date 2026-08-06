"""The Python half of the parity replay harness.

`contracts/parity/harness.ts` replays a recorded fixture against *any* handler
behind an injectable fetch; this is the fetch for the FastAPI service, plus the
one piece of `contracts/parity/shape.ts` a replay needs — :func:`match_shape`.

Only the *matcher* is ported. Describing and merging shapes belonged to the
recorder, which ran against Express and was the sole author of a baseline; that
recorder retired with the Express app (80-cutover US-2) and the baseline is now
frozen. **Do not add a describe/merge half here.** A Python recorder would let
this service record its own answer as the contract it is graded against, which is
no contract at all — and that reasoning did not change when the recorder left.

The asymmetry is the TypeScript's, kept rule for rule — this is a port gate, not
an equality check, so a ported handler may return *more* than the baseline and
never less:

* extra properties pass, a property the baseline always carried is required, one
  it carried only sometimes (``optional``) may be absent;
* an empty array passes against a baseline array with items — that is a data
  difference, not a shape difference;
* a recorded ``null`` matches anything (it says nothing about the type), but a
  ``null`` *branch of a union* means nullable and matches only null.
"""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

#: A recorded shape is the JSON `TypeShape` tree from `contracts/parity/shape.ts`.
TypeShape = Mapping[str, Any]

_PRIMITIVES = frozenset({"string", "number", "boolean"})


@dataclass(frozen=True, slots=True)
class Mismatch:
    """One structural difference. ``path`` is JSON-pointer-ish, e.g. ``$.rows``."""

    path: str
    expected: str
    actual: str

    def describe(self) -> str:
        return f"    {self.path}: expected {self.expected}, got {self.actual}"


@dataclass(frozen=True, slots=True)
class ParityFixture:
    """One recorded request/response pair from `contracts/parity/fixtures/`."""

    id: str
    description: str
    request: Mapping[str, Any]
    response: Mapping[str, Any]

    @property
    def method(self) -> str:
        method: str = self.request["method"]
        return method

    @property
    def path(self) -> str:
        """The concrete URL to replay, query string included."""
        path: str = self.request["path"]
        return path

    @property
    def route(self) -> str:
        """The route *template* — how a fixture binds to a baseline operation."""
        route: str = self.request["route"]
        return route

    @property
    def status(self) -> int:
        status: int = self.response["status"]
        return status

    @property
    def shape(self) -> TypeShape:
        shape: TypeShape = self.response["shape"]
        return shape


def load_fixtures(directory: Path) -> tuple[ParityFixture, ...]:
    """Read every ``*.json`` fixture from *directory*, sorted by id."""
    if not directory.is_dir():
        return ()
    fixtures = []
    for path in sorted(directory.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        fixtures.append(
            ParityFixture(
                id=raw["id"],
                description=raw["description"],
                request=raw["request"],
                response=raw["response"],
            )
        )
    return tuple(fixtures)


def replay(fixture: ParityFixture, client: TestClient) -> list[Mismatch]:
    """Send a fixture's request at the app and grade the answer.

    A status difference is always reported alone: a 500 body has nothing to say
    about the 200 baseline, so comparing it would only bury the real finding.
    """
    response = client.request(
        fixture.method,
        fixture.path,
        json=fixture.request.get("body"),
        headers=dict(fixture.request.get("headers") or {}),
    )
    if response.status_code != fixture.status:
        return [Mismatch("$status", str(fixture.status), str(response.status_code))]
    return list(match_shape(fixture.shape, response.json()))


def report(fixture: ParityFixture, mismatches: Sequence[Mismatch]) -> str:
    """One-line-per-mismatch failure message, in the TypeScript's format."""
    lines = [f"{fixture.id}: FAILED", *(item.describe() for item in mismatches)]
    return "\n".join(lines)


def match_shape(
    expected: TypeShape, actual: Any, path: str = "$"
) -> Iterator[Mismatch]:
    """Yield every way *actual* fails to satisfy the recorded *expected* shape."""
    kind = expected.get("kind")

    if kind in {"unknown", "null"}:
        return

    if kind == "union":
        branches: list[TypeShape] = list(expected.get("of", []))
        if actual is None:
            if not any(branch.get("kind") == "null" for branch in branches):
                yield Mismatch(path, format_shape(expected), "null")
            return
        # A `null` branch means "nullable", not "anything" — matching it against a
        # non-null value would let every nullable union match everything.
        for branch in branches:
            if branch.get("kind") == "null":
                continue
            if not any(match_shape(branch, actual, path)):
                return
        yield Mismatch(path, format_shape(expected), _describe(actual))
        return

    if actual is None:
        yield Mismatch(path, format_shape(expected), "null")
        return

    if kind == "array":
        if not isinstance(actual, list):
            yield Mismatch(path, format_shape(expected), _describe(actual))
            return
        items = expected.get("items")
        if items is None:
            return
        for index, entry in enumerate(actual):
            yield from match_shape(items, entry, f"{path}[{index}]")
        return

    if kind == "object":
        if not isinstance(actual, dict):
            yield Mismatch(path, format_shape(expected), _describe(actual))
            return
        optional = set(expected.get("optional") or ())
        for key, property_shape in expected.get("properties", {}).items():
            if key not in actual:
                if key not in optional:
                    yield Mismatch(
                        f"{path}.{key}", format_shape(property_shape), "missing"
                    )
                continue
            yield from match_shape(property_shape, actual[key], f"{path}.{key}")
        return

    observed = _describe(actual)
    if kind in _PRIMITIVES and observed != kind:
        yield Mismatch(path, str(kind), observed)


def format_shape(shape: TypeShape) -> str:
    """Human-readable one-liner for a shape, used in mismatch reports."""
    kind = shape.get("kind")
    if kind == "array":
        items = shape.get("items")
        return f"array<{format_shape(items) if items else 'unknown'}>"
    if kind == "object":
        keys = sorted(shape.get("properties", {}))
        preview = ", ".join(keys[:6])
        return f"object{{{preview}{', …' if len(keys) > 6 else ''}}}"
    if kind == "union":
        return " | ".join(format_shape(branch) for branch in shape.get("of", []))
    return str(kind)


def _describe(value: Any) -> str:
    """Name a candidate value's JSON type, in the TypeScript's vocabulary."""
    if value is None:
        return "null"
    if isinstance(value, list):
        return "array"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return "object"


__all__ = [
    "Mismatch",
    "ParityFixture",
    "format_shape",
    "load_fixtures",
    "match_shape",
    "replay",
    "report",
]
