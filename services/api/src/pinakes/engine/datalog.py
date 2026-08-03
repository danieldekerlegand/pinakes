"""The Datalog research console, in-process.

`POST /api/graph/datalog` used to reach the sidecar's ``/datalog`` view over HTTP
and parse ``{ran, rows, problems, error, reason}`` out of the response. That view
only ever rendered HTML — it has no ``Accept: application/json`` branch, unlike
``/search``/``/metrics``/``/completeness`` — so the JSON contract the TypeScript
client declared was one the sidecar could not actually satisfy. Calling
:class:`~pinakes_engine.explorer.datalog.Datalog` directly answers it exactly:
:class:`~pinakes_engine.explorer.datalog.DatalogOutcome` *is* that shape, field
for field.

Absent SWI-Prolog the console still answers, and that is deliberate: the query is
linted offline and ``ran`` is ``false`` with ``reason`` saying why. The route
passes the outcome straight through rather than treating it as a failure — a
lint finding is an answer about the query, not an error about the service.
"""

from __future__ import annotations

from typing import Any

from pinakes_engine.explorer.datalog import Datalog, DatalogExample

from pinakes.engine.corpus import corpus
from pinakes.engine.errors import EngineUnavailable

_handle: tuple[str, Datalog] | None = None
_override: Datalog | None = None


class UnknownExample(LookupError):
    """The requested example slug names no shipped query (the route answers 400)."""


def handle() -> Datalog:
    """The console's handle on the symbolic layer for the current corpus.

    Cached per corpus directory: the handle projects the corpus to a ``graph.pl``
    on first use and holds it in a temp directory for the process's lifetime, so
    rebuilding one per request would re-export the whole graph every time.
    """
    global _handle
    if _override is not None:
        return _override
    corpus_dir = str(corpus().corpus_dir)
    if _handle is None or _handle[0] != corpus_dir:
        _handle = (corpus_dir, Datalog(corpus_dir))
    return _handle[1]


def configure(console: Datalog) -> None:
    """Install an explicit console handle, overriding the per-corpus one.

    Injectable for the same reason the engine makes ``swipl`` injectable: a test
    (or a deployment pinning an interpreter) can drive the whole path
    deterministically instead of depending on what happens to be on ``PATH``.
    """
    global _override
    _override = console


def reset() -> None:
    """Drop the cached and overridden handles (test teardown)."""
    global _handle, _override
    _handle = None
    _override = None


def examples() -> tuple[DatalogExample, ...]:
    """The shipped example queries, for the console's preset list."""
    return handle().examples()


def run(*, goal: str = "", example: str = "") -> dict[str, Any]:
    """Run an ad-hoc ``main/0`` *goal*, or a shipped *example* by slug.

    An ad-hoc goal wins when both are given, matching the sidecar console. The
    caller is expected to have rejected the neither-given case already (the route
    answers 400); it raises :class:`ValueError` here so a future caller cannot
    quietly run nothing.
    """
    console = handle()
    selected = console.example(example) if example else None
    if example and selected is None:
        raise UnknownExample(f"unknown datalog example: {example}")
    source = goal or (selected.source if selected is not None else "")
    if not source:
        raise ValueError("a datalog goal or example is required")
    try:
        outcome = console.run(source)
    except OSError as exc:  # the projected program could not be written/read
        raise EngineUnavailable(f"the datalog layer is unavailable: {exc}") from exc
    return {
        "ran": outcome.ran,
        "rows": [list(row) for row in outcome.rows],
        "problems": list(outcome.problems),
        "error": outcome.error,
        "reason": outcome.reason,
    }


__all__ = ["UnknownExample", "configure", "examples", "handle", "reset", "run"]
