"""UTF-16 code units — what `String.prototype.length` and `str[i]` actually count.

Every edit distance in this package indexes a string the way JavaScript does, and
JavaScript indexes **code units**, not code points. For the IPA and ASJP columns
that is the same thing; for the orthographic fallback it is not, because this
corpus carries Linear B, Old Persian and cuneiform word forms and every one of
those characters is a surrogate *pair*. Python would count one where V8 counts
two, and the normalisation divisor of a `wordform`-mode comparison would differ.

The pair is split into its two lone surrogates deliberately: that is what `str[i]`
hands a JavaScript caller, so a substitution in the middle of an astral character
costs what it costs over there. `surrogatepass` is what lets Python hold one.
"""

from __future__ import annotations


def code_units(text: str) -> list[str]:
    """``[...text]`` as the *indexer* sees it — one entry per UTF-16 code unit."""
    if text.isascii():
        return list(text)
    raw = text.encode("utf-16-le", "surrogatepass")
    return [
        raw[index : index + 2].decode("utf-16-le", "surrogatepass")
        for index in range(0, len(raw), 2)
    ]


def length(text: str) -> int:
    """``text.length``."""
    if text.isascii():
        return len(text)
    return len(text.encode("utf-16-le", "surrogatepass")) // 2
