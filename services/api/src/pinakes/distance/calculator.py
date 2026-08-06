"""ASJP-style lexical distance.

The port of `server/services/linguistic-distance-calculator.ts`.

LDND (Levenshtein Distance Normalized Divided) is the ASJP consortium's metric:
the average edit distance between the two languages' words for the *same*
meanings, divided by the average edit distance between words for *different*
meanings. The divisor is the point — two languages whose phoneme inventories
happen to overlap score similarly on unrelated words too, and dividing by that
baseline is what separates shared history from shared sound.

Three things about this file are worth knowing before touching it.

**LDND is not deterministic, and that is the TypeScript's.** The different-meaning
baseline is a sample of up to 100 *random* pairs (`Math.random()`), redrawn per
call — so two identical requests to `POST /api/linguistic-distance/pairwise`
disagree in the low decimals on both backends, and always did. It is reproduced
rather than repaired: seeding it here would make the two servers answer
differently about the same pair mid-cutover, and the fix (score every
different-meaning pair, or sample deterministically from the concept ids) is a
change to the metric, not to the port. :func:`configure` is the seam that makes
it testable, and the same seam is what let the whole group be diffed against
Express byte for byte — drive both sides from the same generator and the sample
is the same sample.

**The word table is loaded once per request, not per pair.** `parseLanguageWordForms`
re-read all 121,633 rows of `words.tsv` for every language it was asked about, and
`findNearestLanguages` asks about all 1,099 of them. :class:`Lexicon` is that read,
hoisted — same rows, same order, same per-language maps.

**A language with no word data scores -1, and -1 sorts first.** `findNearest`
ranks ascending on `ldnd`, so the languages a query knows *nothing* about lead
the answer. Reproduced; it is the client's job to read `comparedWords`.
"""

from __future__ import annotations

import logging
import math
import random
from collections.abc import Callable
from pathlib import Path
from typing import Any, NamedTuple

from pinakes.distance import phonetic, utf16

logger = logging.getLogger("pinakes.distance")

Record = dict[str, Any]

#: The four spine files `getAvailableLanguageIds` does *not* read as a language.
SPINE_FILES = frozenset(
    {"families.tsv", "languages.tsv", "words.tsv", "words-base.tsv"}
)

PHONETIC_MODES = ("asjp", "ipa", "ipa-weighted", "wordform")

_random: Callable[[], float] = random.random


def configure(random_source: Callable[[], float] | None = None) -> None:
    """Point the different-meaning sampler at a generator, or back at `random`.

    The counterpart of monkeypatching `Math.random` on the Express side, and the
    only module state in this package.
    """
    global _random
    _random = random.random if random_source is None else random_source


class WordForm(NamedTuple):
    """One row of a language's word list, as `parseLanguageWordForms` keeps it."""

    concept_id: str
    word_form: str
    ipa: str | None
    asjp: str | None
    dolgo: str | None


def _split_lines(path: Path) -> list[str]:
    """``fs.readFileSync(path, "utf-8").split("\\n")``.

    ``newline=""`` because the split is on the newline alone: universal-newline
    translation would turn a lone carriage return into a row boundary that does
    not exist over there.
    """
    with open(path, encoding="utf-8", newline="") as handle:
        return handle.read().split("\n")


def _index_of(header: list[str], name: str) -> int:
    """``header.indexOf(name)`` — absent is ``-1``, not an exception."""
    return header.index(name) if name in header else -1


def _trimmed(row: list[str], index: int) -> str | None:
    """``row[index]?.trim()``.

    A negative index is ``undefined`` in JavaScript where Python would count
    from the end of the row, so the guard is not optional.
    """
    if index < 0 or index >= len(row):
        return None
    return row[index].strip()


def _read_language_file(path: Path) -> dict[str, WordForm]:
    """`parseLanguageWordForms`'s first branch — a whole file is one language.

    A row with a blank concept or a blank word form is dropped, and a later row
    for the same concept replaces an earlier one while keeping the earlier one's
    position — `Map.set` and `dict.__setitem__` agree on that.
    """
    kept = [line for line in _split_lines(path) if line.strip()]
    if not kept:
        return {}
    header = kept[0].split("\t")
    concept_index = _index_of(header, "Concept_ID")
    word_index = _index_of(header, "Word_Form")
    ipa_index = _index_of(header, "IPA")
    asjp_index = _index_of(header, "ASJP")
    dolgo_index = _index_of(header, "Dolgo")

    forms: dict[str, WordForm] = {}
    for line in kept[1:]:
        row = line.split("\t")
        concept_id = _trimmed(row, concept_index)
        word_form = _trimmed(row, word_index)
        if not concept_id or not word_form:
            continue
        forms[concept_id] = WordForm(
            concept_id=concept_id,
            word_form=word_form,
            ipa=(_trimmed(row, ipa_index) or None) if ipa_index >= 0 else None,
            asjp=(_trimmed(row, asjp_index) or None) if asjp_index >= 0 else None,
            dolgo=(_trimmed(row, dolgo_index) or None) if dolgo_index >= 0 else None,
        )
    return forms


class Lexicon:
    """The word forms behind one request.

    `parseLanguageWordForms` prefers a per-language `<id>.tsv` and falls back to
    `words.tsv`; that order is what lets a hand-curated list override the bulk
    NorthEuraLex import, and it is preserved here. What is not preserved is the
    *number of reads*: the bulk file is grouped by language on first use and the
    per-language files are memoised, so ranking 1,099 languages reads each file
    once instead of once per pair.
    """

    def __init__(self, lexicons: Path) -> None:
        self._lexicons = lexicons
        self._words_path = lexicons / "words.tsv"
        self._by_language: dict[str, dict[str, WordForm]] | None = None
        self._individual: dict[str, dict[str, WordForm]] = {}
        self._available: list[str] | None = None

    # -- word forms ---------------------------------------------------------

    def forms(self, language_id: str) -> dict[str, WordForm]:
        """``parseLanguageWordForms(languageId)``."""
        individual = self._lexicons / f"{language_id}.tsv"
        if individual.exists():
            cached = self._individual.get(language_id)
            if cached is None:
                cached = _read_language_file(individual)
                self._individual[language_id] = cached
            return cached
        return self._grouped().get(language_id, {})

    def _grouped(self) -> dict[str, dict[str, WordForm]]:
        if self._by_language is None:
            self._by_language = self._read_words()
        return self._by_language

    def _read_words(self) -> dict[str, dict[str, WordForm]]:
        if not self._words_path.exists():
            logger.warning("No word forms found: %s is absent", self._words_path)
            return {}
        lines = [line for line in _split_lines(self._words_path) if line.strip()]
        if not lines:
            return {}
        header = lines[0].split("\t")
        language_index = _index_of(header, "Language_ID")
        concept_index = _index_of(header, "Concept_ID")
        word_index = _index_of(header, "Word_Form")
        ipa_index = _index_of(header, "IPA")
        asjp_index = _index_of(header, "ASJP")
        dolgo_index = _index_of(header, "Dolgo")

        grouped: dict[str, dict[str, WordForm]] = {}
        for line in lines[1:]:
            row = line.split("\t")
            language = _trimmed(row, language_index)
            if not language:
                continue
            concept_id = _trimmed(row, concept_index)
            word_form = _trimmed(row, word_index)
            if not concept_id or not word_form:
                continue
            grouped.setdefault(language, {})[concept_id] = WordForm(
                concept_id=concept_id,
                word_form=word_form,
                ipa=(_trimmed(row, ipa_index) or None) if ipa_index >= 0 else None,
                asjp=(_trimmed(row, asjp_index) or None) if asjp_index >= 0 else None,
                dolgo=(_trimmed(row, dolgo_index) or None)
                if dolgo_index >= 0
                else None,
            )
        return grouped

    # -- availability -------------------------------------------------------

    def available_language_ids(self) -> list[str]:
        """``getAvailableLanguageIds()`` — every id that *might* have word data.

        Two sources, and the second is looser than it looks: **every** `.tsv` in
        the corpus that is not one of the four spine files is read as a language
        id, so `deities` and `settlements` are "available languages" here. That
        is harmless only because the one caller intersects the list with the real
        language table — do not reuse it as a language id vocabulary.

        The scan of `words.tsv` also does *not* drop blank lines before taking a
        header, where :meth:`forms` does. On a file that opens with a blank line
        the two would disagree about which row is the header; the shipped corpus
        does not, and both readings are ports.
        """
        if self._available is not None:
            return self._available

        available: set[str] = set()
        if self._words_path.exists():
            lines = _split_lines(self._words_path)
            language_index = _index_of(lines[0].split("\t"), "Language_ID")
            for line in lines[1:]:
                language = _trimmed(line.split("\t"), language_index)
                if language:
                    available.add(language)

        if self._lexicons.is_dir():
            for entry in self._lexicons.iterdir():
                name = entry.name
                if name.endswith(".tsv") and name not in SPINE_FILES:
                    available.add(name.replace(".tsv", "", 1))

        self._available = sorted(available)
        logger.debug(
            "[Distance Calculator] Found %d languages with word data",
            len(self._available),
        )
        return self._available


# -- edit distance ----------------------------------------------------------


def levenshtein(text1: str, text2: str) -> int:
    """``levenshteinDistance`` — flat unit costs over UTF-16 code units."""
    units1 = utf16.code_units(text1)
    units2 = utf16.code_units(text2)
    len2 = len(units2)

    previous = list(range(len2 + 1))
    for row, unit1 in enumerate(units1, start=1):
        current = [row] + [0] * len2
        for column in range(1, len2 + 1):
            cost = 0 if unit1 == units2[column - 1] else 1
            current[column] = min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + cost,
            )
        previous = current
    return previous[len2]


def normalized_levenshtein(text1: str, text2: str) -> float:
    """``normalizedLevenshtein`` — LDN, divided by the longer string's length."""
    if utf16.length(text1) == 0 and utf16.length(text2) == 0:
        return 0.0
    return levenshtein(text1, text2) / max(utf16.length(text1), utf16.length(text2))


def _representation(
    form1: WordForm, form2: WordForm, phonetic_mode: str
) -> tuple[str, str, bool]:
    """Which of the four columns a comparison actually reads, and how.

    The fallback chain is per *pair*, not per language: a concept whose IPA is
    missing on one side is compared as orthography even in `ipa` mode, so one
    LDND can mix representations. `ipa-weighted` is the only mode that changes
    the *cost function* rather than the column.
    """
    if phonetic_mode in ("ipa", "ipa-weighted") and form1.ipa and form2.ipa:
        return (
            "".join(form1.ipa.lower().split()),
            "".join(form2.ipa.lower().split()),
            phonetic_mode == "ipa-weighted",
        )
    if phonetic_mode == "asjp" and form1.asjp and form2.asjp:
        return form1.asjp.lower(), form2.asjp.lower(), False
    return form1.word_form.lower(), form2.word_form.lower(), False


def _ldn(form1: WordForm, form2: WordForm, phonetic_mode: str) -> float:
    text1, text2, weighted = _representation(form1, form2, phonetic_mode)
    if weighted:
        return phonetic.normalized_phonetic_levenshtein(text1, text2)
    return normalized_levenshtein(text1, text2)


def _mean(values: list[float]) -> float:
    """``values.reduce((a, b) => a + b, 0) / values.length``.

    Not :func:`sum`, which has used Neumaier compensated summation since 3.12 —
    more accurate, and therefore a different number from the one V8 produced.
    """
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def calculate_ldnd(
    lang1_forms: dict[str, WordForm],
    lang2_forms: dict[str, WordForm],
    phonetic_mode: str = "asjp",
) -> Record:
    """``calculateLDND`` — the metric, over two already-loaded word lists.

    No shared vocabulary is reported as ``-1`` on both distances rather than as
    an error or a null: the metric is undefined, and the caller can tell from
    ``comparedWords: 0``.
    """
    shared = [concept for concept in lang1_forms if concept in lang2_forms]
    if not shared:
        return {
            "ldnd": -1,
            "avgLevenshtein": -1,
            "comparedWords": 0,
            "coverage": 0,
            "sharedCognates": 0,
        }

    same_meaning = [
        _ldn(lang1_forms[concept], lang2_forms[concept], phonetic_mode)
        for concept in shared
    ]
    avg_same_meaning = _mean(same_meaning)

    sample_size = min(100, len(shared) * 2)
    concepts1 = list(lang1_forms)
    concepts2 = list(lang2_forms)

    different_meaning: list[float] = []
    for _ in range(sample_size):
        # Both draws happen before the same-concept test, so a skipped pair
        # still consumes two numbers from the generator. That is what makes a
        # shared generator reproduce the same sample on both backends.
        index1 = math.floor(_random() * len(concepts1))
        index2 = math.floor(_random() * len(concepts2))
        concept1 = concepts1[index1]
        concept2 = concepts2[index2]
        if concept1 == concept2:
            continue
        different_meaning.append(
            _ldn(lang1_forms[concept1], lang2_forms[concept2], phonetic_mode)
        )

    avg_different_meaning = _mean(different_meaning) if different_meaning else 1.0
    ldnd = (
        avg_same_meaning / avg_different_meaning
        if avg_different_meaning > 0
        else avg_same_meaning
    )

    return {
        "ldnd": ldnd,
        "avgLevenshtein": avg_same_meaning,
        "comparedWords": len(shared),
        "coverage": len(shared) / max(len(lang1_forms), len(lang2_forms)),
        "sharedCognates": len([value for value in same_meaning if value < 0.5]),
    }


def calculate_pairwise_distance(
    lexicon: Lexicon,
    lang1: Record,
    lang2: Record,
    phonetic_mode: str = "ipa",
) -> Record:
    """``calculatePairwiseDistance`` — LDND plus a coverage-derived confidence."""
    lexical = calculate_ldnd(
        lexicon.forms(str(lang1["id"])),
        lexicon.forms(str(lang2["id"])),
        phonetic_mode,
    )
    return {
        "language1": lang1,
        "language2": lang2,
        "lexical": lexical,
        "confidence": min(1.0, lexical["coverage"] * 1.5),
    }


def calculate_distance_matrix(
    lexicon: Lexicon,
    languages: list[Record],
    metric: str = "ldnd",
    phonetic_mode: str = "ipa",
) -> Record:
    """``calculateDistanceMatrix`` — a symmetric matrix, diagonal left at 0.

    The diagonal is never computed, so a language compared with itself reads as
    distance 0 even when it has no word data at all (where the same pair through
    `pairwise` would read -1). Both are the TypeScript's.
    """
    size = len(languages)
    matrix: list[list[float]] = [[0.0] * size for _ in range(size)]
    forms = [lexicon.forms(str(language["id"])) for language in languages]

    for row in range(size):
        for column in range(row + 1, size):
            metrics = calculate_ldnd(forms[row], forms[column], phonetic_mode)
            distance = (
                metrics["ldnd"] if metric == "ldnd" else metrics["avgLevenshtein"]
            )
            matrix[row][column] = distance
            matrix[column][row] = distance

    return {"languages": languages, "matrix": matrix, "metric": metric}


def find_nearest_languages(
    lexicon: Lexicon,
    target: Record,
    all_languages: list[Record],
    k: int = 10,
) -> list[Record]:
    """``findNearestLanguages`` — every other language, ranked ascending on LDND.

    Always the default `ipa` mode: the TypeScript takes no phonetic-mode
    argument here, so neither route that reaches it can ask for another.
    """
    results = [
        calculate_pairwise_distance(lexicon, target, language)
        for language in all_languages
        if language["id"] != target["id"]
    ]
    results.sort(key=lambda result: result["lexical"]["ldnd"])
    return results[:k]


def calculate_genealogy_distance(
    lang1: Record, lang2: Record, all_languages: list[Record]
) -> int:
    """``calculateGenealogyDistance`` — steps to the nearest common ancestor.

    ``-1`` means *no common ancestor in this data*, which for two languages in
    different families is by definition. The walk follows `parentLanguageId`
    until it runs out or names a language the table does not have, and would not
    terminate on a corpus whose parent links contain a cycle — the same hazard
    the TypeScript has, and `test_linguistic_distance.py` pins the live corpus
    as acyclic so a corpus change is what announces it.
    """
    if lang1["id"] == lang2["id"]:
        return 0
    if lang1["familyId"] != lang2["familyId"]:
        return -1

    by_id = {language["id"]: language for language in all_languages}

    def ancestry_path(language: Record) -> list[str]:
        path = [language["id"]]
        current = language
        while current.get("parentLanguageId"):
            parent_id = current["parentLanguageId"]
            path.append(parent_id)
            parent = by_id.get(parent_id)
            if parent is None:
                break
            current = parent
        path.append(language["familyId"])
        return path

    path1 = ancestry_path(lang1)
    path2 = ancestry_path(lang2)

    for index1, step in enumerate(path1):
        if step in path2:
            return index1 + path2.index(step)
    return -1


def calculate_geographic_distance(lang1: Record, lang2: Record) -> float | None:
    """``calculateGeographicDistance`` — haversine kilometres, or ``None``.

    Spelled operation for operation as the TypeScript spelled it (``(x * pi) /
    180`` rather than `math.radians`, ``sin(x) * sin(x)`` rather than a power),
    which is what keeps every digit but the last. The last one is **`atan2`**:
    on the live corpus `sin`, `cos` and `sqrt` agree with V8 bit for bit and
    `Math.atan2(0.52851998211349771, 0.84892086115653209)` differs by one unit
    in the last place, so `fin`→`cmn` is 7095.461781519912 km here and
    7095.461781519911 there. Same family as the `/api/search/spatial`
    divergence this service already carries, one function along.
    """
    coordinates1 = lang1.get("coordinates")
    coordinates2 = lang2.get("coordinates")
    if not coordinates1 or not coordinates2:
        return None

    lat1 = coordinates1["lat"]
    lng1 = coordinates1["lng"]
    lat2 = coordinates2["lat"]
    lng2 = coordinates2["lng"]

    radius = 6371
    d_lat = (lat2 - lat1) * math.pi / 180
    d_lng = (lng2 - lng1) * math.pi / 180

    a = math.sin(d_lat / 2) * math.sin(d_lat / 2) + math.cos(
        lat1 * math.pi / 180
    ) * math.cos(lat2 * math.pi / 180) * math.sin(d_lng / 2) * math.sin(d_lng / 2)

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c
