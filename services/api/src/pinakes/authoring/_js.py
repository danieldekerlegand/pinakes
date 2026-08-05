"""The JavaScript reading of a request body, spelled out.

Every validator in this package was a TypeScript function over a
``Partial<Input>`` that arrived as parsed JSON, so its verdict depends on three
distinctions Python does not make for free — and all three are observable in the
400 body two parity fixtures record:

* **absent is not null.** ``input.confidence !== undefined`` is *true* for an
  explicit ``null``, so ``{"confidence": null}`` fails validation where
  ``{}`` only warns. :data:`MISSING` and :func:`field` keep the two apart;
  ``dict.get(key)`` would collapse them.
* **a boolean is not a number.** ``typeof true === "boolean"``, so
  ``{"timePeriodStart": true}`` is rejected — where Python's ``isinstance(True,
  int)`` would accept it as year 1.
* **``String(n)`` is not ``str(n)``.** JavaScript prints an integral float
  without its fractional part, so a bounds message names year ``2500``, never
  ``2500.0``. :func:`number_text` is that formatting.
"""

from __future__ import annotations

import math
from typing import Any, Final


class _Missing:
    """The type of :data:`MISSING`. Falsy, and prints as ``undefined``."""

    __slots__ = ()

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "undefined"


#: Stands in for JavaScript's ``undefined`` — a key the body does not carry.
MISSING: Final = _Missing()


def field(body: Any, key: str) -> Any:
    """``body[key]`` as JavaScript reads it: :data:`MISSING` when absent.

    A body that is not an object has no properties at all, which is what
    ``(req.body ?? {})`` on a non-object came to.
    """
    if not isinstance(body, dict):
        return MISSING
    return body.get(key, MISSING)


def is_finite_number(value: Any) -> bool:
    """``typeof v === "number" && Number.isFinite(v)``. A bool is not a number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def is_present(value: Any) -> bool:
    """``v !== undefined && v !== null`` — the "has a value at all" test."""
    return value is not MISSING and value is not None


def non_empty_string(value: Any) -> bool:
    """``typeof v === "string" && v.trim() !== ""``."""
    return isinstance(value, str) and value.strip() != ""


def number_text(value: Any) -> str:
    """``String(n)`` for a number JavaScript would print in an error message."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def json_text(value: Any) -> str:
    """``JSON.stringify(value)`` — compact separators, non-ASCII left alone.

    The result is a TSV cell a reviewer promotes verbatim, so the bytes matter:
    Python's default ``", "`` separator and ``\\uXXXX`` escaping would both
    write a cell the TypeScript loader round-trips differently.
    """
    import json

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def source_titles(sources: Any) -> list[Any]:
    """``(sources ?? []).map(s => s.title)`` over a loosely-typed sources array."""
    if not isinstance(sources, list):
        return []
    return [item.get("title") if isinstance(item, dict) else None for item in sources]


def has_sources(sources: Any) -> bool:
    """``sources && sources.length > 0``."""
    return isinstance(sources, list) and len(sources) > 0


def truthy(value: Any) -> bool:
    """``!!value``, with :data:`MISSING` reading as ``undefined`` (falsy).

    :func:`~pinakes.contributions.store.js_truthy` is the rule for a value that
    is *present*; it answers ``True`` for any object it does not recognise,
    which is right for a dict or list and wrong for the absence sentinel.
    """
    from pinakes.contributions.store import js_truthy

    return False if value is MISSING else js_truthy(value)
