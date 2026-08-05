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
