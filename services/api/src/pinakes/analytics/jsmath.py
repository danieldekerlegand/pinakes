"""The three JavaScript number behaviours these scores are rendered through.

Every published score in this package is a rounded double and several are
formatted into prose, so "the same number" means "the same bytes on the wire".
Python's defaults differ from JavaScript's in exactly the places that matter:

* ``Math.round`` rounds a tie **up** (toward +∞); Python's ``round`` rounds a tie
  to even, so ``round(0.5)`` is ``0`` where ``Math.round(0.5)`` is ``1``.
* ``Number.prototype.toFixed`` rounds a tie **away from zero** on the value's
  exact binary expansion; ``format(x, ".2f")`` rounds to even, so ``0.125``
  formats as ``"0.12"`` in Python and ``"0.13"`` in JavaScript.
* ``toLocaleString("en-US")`` groups thousands with commas.

None of these is a rounding subtlety worth "fixing": a correlation summary line
and an anomaly's prose are part of the recorded contract.

:func:`locale_key` is the fourth, and the only one that is not a number:
``localeCompare`` orders by base letter first and case last, where a Python
comparison orders by code point.
"""

from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal


def js_round(value: float) -> int:
    """``Math.round(value)`` — half rounds toward +∞, not to even."""
    return math.floor(value + 0.5)


def round_to(value: float, places: int) -> float:
    """``Math.round(value * 10**places) / 10**places``, the scores' rounding idiom."""
    factor: int = 10**places
    return js_round(value * factor) / factor


def to_fixed(value: float, digits: int) -> str:
    """``value.toFixed(digits)``.

    ``Decimal(float)`` is the value's *exact* binary expansion — the same number
    the ECMAScript algorithm picks its digits from — so quantizing it half-up
    reproduces `toFixed` including the cases where the shortest decimal
    representation would round the other way.
    """
    quantum = Decimal(1).scaleb(-digits)
    return f"{Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP)}"


def locale_int(value: int) -> str:
    """``value.toLocaleString("en-US")`` for an integer: comma-grouped thousands."""
    return f"{value:,}"


def js_number(value: float) -> float | int:
    """A computed double as ``JSON.stringify`` would write it.

    Every JavaScript number is a double, but an *integral* one serialises with
    no fractional part: a Jaccard ratio of exactly 1 is ``1`` on the wire, not
    ``1.0``. Python's float renders the other way, so a score that happens to
    land on a whole number is the one place a ported computation changes the
    bytes of a response. Apply this where a *derived* value reaches the wire —
    not to a value read straight out of a request or a TSV, which already has
    whatever type the source gave it.
    """
    return int(value) if isinstance(value, float) and value.is_integer() else value


def locale_key(value: str) -> tuple[str, list[int], str]:
    """A sort key approximating `String.prototype.localeCompare` for `en`.

    ICU's default collation compares base letters first and case **last**, with
    lowercase ahead of uppercase — the opposite of a code-point comparison,
    which sorts every capitalised name ahead of every lowercase one. This
    reproduces the primary and tertiary levels; accents (the secondary level)
    fall back to the code-point tail, which no display name in this corpus
    distinguishes.

    Used wherever a TypeScript comparator tie-broke on a **display name**. A
    tiebreak on a minted id does not need it — see
    :func:`~pinakes.contributions.changelog.sort_newest_first`, where the two
    orders provably agree.
    """
    return value.casefold(), [0 if char.islower() else 1 for char in value], value
