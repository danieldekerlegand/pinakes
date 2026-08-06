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
``localeCompare`` orders by base letter first, then accent, then case, where a
Python comparison orders by code point at every position.
"""

from __future__ import annotations

import math
import unicodedata
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


def _collation_rank(char: str) -> int:
    """ICU's primary ordering *between* character classes.

    Whitespace sorts before punctuation and symbols, those before digits, and
    digits before letters — which is why ``G||ana`` precedes ``G|ui`` and
    ``Bactria–Margiana`` precedes ``Bactrian``. A code-point comparison gets
    both backwards, because ``|`` (U+007C) and ``–`` (U+2013) sit on either side
    of the Latin letters rather than before them.
    """
    category = unicodedata.category(char)
    if category[0] == "Z":
        return 0
    if category[0] in ("P", "S"):
        return 1
    if category[0] == "N":
        return 2
    return 3


#: What :func:`locale_key` returns. Named so a comparator that *carries* one in
#: its own key tuple does not have to restate the four levels — the annotation
#: would then be a second place to update, and mypy would be the only thing that
#: noticed.
LocaleKey = tuple[list[tuple[int, str]], list[str], list[int], str]


def locale_key(value: str) -> LocaleKey:
    """A sort key reproducing `String.prototype.localeCompare` for `en`.

    ICU compares in levels and Python's default comparison has none of them:
    **base letters** first (so ``é`` ties with ``e`` and ``|`` sorts before any
    letter), then **accents**, then **case** — lowercase ahead of uppercase —
    and only then the raw string. A code-point comparison sorts every accented
    name into a block after ``z`` and every capitalised name ahead of every
    lowercase one, neither of which is where the client renders them.

    The four levels here are those four, in order: the accent-stripped base with
    each character ranked by class, the combining marks that were stripped, the
    per-character case, and the original as a total-order tiebreak.

    Sorting all 2,614 display names in the live corpus with this key reproduces
    node's ``localeCompare`` order **exactly**; the earlier approximation (which
    folded case but not accents or punctuation) disagreed in 2,267 positions.
    That is what the language-family tree renders, so it was observable.

    Used wherever a TypeScript comparator tie-broke on a **display name**. A
    tiebreak on a minted id does not need it — see
    :func:`~pinakes.contributions.changelog.sort_newest_first`, where the two
    orders provably agree.
    """
    decomposed = unicodedata.normalize("NFD", value)
    base = [char for char in decomposed if unicodedata.category(char) != "Mn"]
    return (
        [(_collation_rank(char), char.casefold()) for char in base],
        [char for char in decomposed if unicodedata.category(char) == "Mn"],
        [0 if char.islower() else 1 for char in base],
        value,
    )
