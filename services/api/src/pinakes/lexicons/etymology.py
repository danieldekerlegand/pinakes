"""Etymological origins of a pasted text — `services/text-etymology-analyzer.ts`.

Ported for `POST /api/text-analysis/{origins,compare}` (pinakes:80 US-1, the
tenth slice). The text is tokenised, each distinct word is walked back through
`etymology-relations.tsv` to its oldest recorded ancestor, and the words are
tallied by the language they came from.

Four things here are the TypeScript's and are easy to lose:

* **Both character classes are spelled out, because JavaScript's differ from
  Python's.** ``\\s`` in V8 has no ``\\x1c``–``\\x1f`` and no ``\\x85`` but does
  have ``\\ufeff``; a character one engine calls whitespace and the other does
  not lands *inside* a word rather than between two. :data:`_JS_SPACE` is that
  class, used by both the strip and the split.
* **The trace prefers `derived_from` over `etymology` over `borrowed_from`** —
  the declaration order of :data:`ANCESTOR_RELATIONS`, used as a sort key — and
  follows **only the first** ancestor. A word with two attested etymologies has
  one origin here, not two.
* **A cycle resolves to the language it was re-entered at**, not to `None`: the
  visited guard returns ``{origin: language, chain: [this]}``, which is a
  *found* origin. And `visited` is per **word of the text**, not per trace, so
  the cache is what makes a repeated word free.
* **Percentages are shares of `totalWords`, not of `analyzedWords`**, so the
  origin shares of a text with unknown words do not sum to 100.
"""

from __future__ import annotations

import re
from typing import Any

from pinakes.analytics.jsmath import js_number, js_round

Record = dict[str, Any]

#: V8's `\s`, as a character-class body. Python's `\s` is not this set: it adds
#: `\x1c`-`\x1f` and `\x85`, and it omits U+FEFF.
_JS_SPACE = (
    " \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a"
    "\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
)

#: The scripts `tokenize` keeps: ASCII alphanumerics, Latin-1 Supplement through
#: Latin Extended-B, Cyrillic, Arabic, Devanagari, CJK, Hangul — plus whitespace,
#: the apostrophe and the hyphen. Everything else becomes a space. The hyphen is
#: last in the class body so that it reads as a literal rather than a range.
_KEEP = re.compile(
    "[^a-zA-Z0-9\\u00c0-\\u024f\\u0400-\\u04ff\\u0600-\\u06ff"
    "\\u0900-\\u097f\\u3000-\\u9fff\\uac00-\\ud7af" + _JS_SPACE + "'-]"
)
_SPLIT = re.compile("[" + _JS_SPACE + "]+")
_TRIM_MARKS = re.compile("^['-]+|['-]+$")

#: Relations that mean "the source is derived FROM the target", in the order the
#: trace prefers them.
ANCESTOR_RELATIONS: tuple[str, ...] = ("derived_from", "etymology", "borrowed_from")


def tokenize(text: str, _language: str | None = None) -> list[str]:
    """Lowercase, strip punctuation, split on whitespace, drop the empties.

    The `language` argument is accepted and ignored, as it is over there — the
    tokenizer is script-agnostic and the parameter is a placeholder for a
    per-language one that was never written.
    """
    normalised = _KEEP.sub(" ", text.lower())
    stripped = (_TRIM_MARKS.sub("", word) for word in _SPLIT.split(normalised))
    return [word for word in stripped if word]


class _Trace:
    __slots__ = ("origin", "chain")

    def __init__(self, origin: str | None, chain: list[Record]) -> None:
        self.origin = origin
        self.chain = chain


def _trace_to_origin(
    word: str,
    language: str,
    relations: list[Record],
    visited: set[str],
) -> _Trace:
    key = f"{word}|{language}"
    if key in visited:
        return _Trace(language, [{"word": word, "language": language}])
    visited.add(key)

    normalised = word.lower()
    ancestors = [
        relation
        for relation in relations
        if relation.get("relationType") in ANCESTOR_RELATIONS
        and str(relation.get("sourceWord", "")).lower() == normalised
        and str(relation.get("sourceLanguage", "")).lower() == language.lower()
    ]

    if not ancestors:
        exists_as_target = any(
            relation.get("relationType") in ANCESTOR_RELATIONS
            and str(relation.get("targetWord", "")).lower() == normalised
            and str(relation.get("targetLanguage", "")).lower() == language.lower()
            for relation in relations
        )
        exists_as_source = any(
            str(relation.get("sourceWord", "")).lower() == normalised
            for relation in relations
        )
        if exists_as_target or exists_as_source:
            return _Trace(language, [{"word": word, "language": language}])
        return _Trace(None, [])

    ancestor = sorted(
        ancestors, key=lambda row: ANCESTOR_RELATIONS.index(row["relationType"])
    )[0]
    result = _trace_to_origin(
        str(ancestor.get("targetWord")),
        str(ancestor.get("targetLanguage")),
        relations,
        visited,
    )
    chain = [{"word": word, "language": language}, *result.chain]
    origin = result.origin
    if origin is None:
        origin = str(ancestor.get("targetLanguage"))
    return _Trace(origin, chain)


def analyze_text_origins(
    text: str,
    language: str,
    relations: list[Record],
    languages: list[Record],
) -> Record:
    """The `/api/text-analysis/origins` body.

    `wordDetails` carries **one entry per token**, repeats included, while an
    origin's `words` list is deduped — so `count` and `len(words)` disagree for
    any text that repeats a word, deliberately.
    """
    words = tokenize(text, language)
    total_words = len(words)

    names = {
        str(row.get("id", "")).lower(): row.get("name")
        for row in languages
        if row.get("id") is not None
    }

    origin_counts: dict[str, list[str]] = {}
    unknown_words = 0
    seen: dict[str, _Trace] = {}
    word_details: list[Record] = []

    for word in words:
        trace = seen.get(word)
        if trace is None:
            trace = _trace_to_origin(word, language, relations, set())
            seen[word] = trace

        chain = [
            {
                "word": entry["word"],
                "language": entry["language"],
                "languageName": names.get(str(entry["language"]).lower())
                or entry["language"],
            }
            for entry in trace.chain
        ]
        word_details.append({"word": word, "origin": trace.origin, "chain": chain})

        if trace.origin is None:
            unknown_words += 1
        else:
            origin_counts.setdefault(trace.origin.lower(), []).append(word)

    origins: list[Record] = []
    for code, word_list in origin_counts.items():
        origins.append(
            {
                "language": code,
                "languageName": names.get(code) or code,
                "count": len(word_list),
                "percentage": (
                    js_number(js_round((len(word_list) / total_words) * 1000) / 10)
                    if total_words > 0
                    else 0
                ),
                "words": list(dict.fromkeys(word_list)),
            }
        )
    origins.sort(key=lambda row: -int(row["count"]))

    return {
        "totalWords": total_words,
        "analyzedWords": total_words - unknown_words,
        "unknownWords": unknown_words,
        "origins": origins,
        "wordDetails": word_details,
    }


def compare_origins(analysis_a: Record, analysis_b: Record) -> Record:
    """The `comparison` block of `/api/text-analysis/compare`.

    The three lists partition the union of both texts' origin languages in the
    **iteration order of that union** — A's origins first, then B's that A does
    not have — and `differences` carries every one of them, including the pairs
    where one side is zero. It is then sorted by |diff| descending, which is a
    *stable* sort on both engines, so ties keep the union's order.
    """
    percent_a = {row["language"]: row["percentage"] for row in analysis_a["origins"]}
    percent_b = {row["language"]: row["percentage"] for row in analysis_b["origins"]}

    union: dict[str, None] = {}
    for code in percent_a:
        union.setdefault(code, None)
    for code in percent_b:
        union.setdefault(code, None)

    shared: list[str] = []
    unique_to_a: list[str] = []
    unique_to_b: list[str] = []
    differences: list[Record] = []

    for code in union:
        in_a = code in percent_a
        in_b = code in percent_b
        value_a = percent_a.get(code, 0)
        value_b = percent_b.get(code, 0)
        if in_a and in_b:
            shared.append(code)
        elif in_a:
            unique_to_a.append(code)
        else:
            unique_to_b.append(code)
        differences.append(
            {
                "language": code,
                "percentA": value_a,
                "percentB": value_b,
                "diff": js_number(js_round((value_a - value_b) * 10) / 10),
            }
        )

    differences.sort(key=lambda row: -abs(float(row["diff"])))

    return {
        "sharedOrigins": shared,
        "uniqueToA": unique_to_a,
        "uniqueToB": unique_to_b,
        "differences": differences,
    }
