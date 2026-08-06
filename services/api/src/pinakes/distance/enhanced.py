"""Phonological and grammatical distance.

The port of `server/services/linguistic-distance-enhanced.ts`.

Where :mod:`pinakes.distance.calculator` compares *words*, this compares
*systems*: two languages' phoneme inventories and two languages' typological
profiles, each reduced to a 0–1 distance and blended with the lexical one into a
`combined` score.

**A dimension with no data is `null`, and `combined` averages over the rest.**
The weights (0.4 vocabulary / 0.3 phonological / 0.3 grammatical) are
renormalised over whichever dimensions are actually present, so a language with
no grammar row is not scored as maximally different — the same rule
`authoring/suggestions.combined_confidence` follows, and the one most likely to
be "simplified" into a zero.

**The two maps are built per request, not memoised.** The TypeScript cached them
on module state for the life of the process; here they are loaded once per call
and handed down, which matches this service's rule that nothing in `lexicons/`
is cached (`paths.lexicons_dir()` re-reads its override every time, and that
override is the only thing between a test and the live corpus). Ranking a
dimension across the corpus is one load either way.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, NamedTuple

from pinakes.analytics import jsmath
from pinakes.distance import utf16
from pinakes.lexicons import storage

Record = dict[str, Any]

COMPARISON_MODES = ("vocabulary", "phonological", "grammatical", "combined")


class Profiles(NamedTuple):
    """The two `languageId → record` maps the enhanced distances read.

    A language with two rows in either file keeps the **last** one, at the
    **first** one's position — `Map.set` in a loop, and the insertion order is
    what :func:`find_nearest_by_dimension` walks.
    """

    phonological: dict[str, Record]
    grammatical: dict[str, Record]


def load_profiles(lexicons: Path) -> Profiles:
    """`getPhonologicalMap()` + `getGrammarMap()`, without the process cache."""
    phonological: dict[str, Record] = {}
    for inventory in storage.load_phonological_inventories(lexicons):
        phonological[str(inventory["languageId"])] = inventory
    grammatical: dict[str, Record] = {}
    for features in storage.load_grammar_features(lexicons):
        grammatical[str(features["languageId"])] = features
    return Profiles(phonological=phonological, grammatical=grammatical)


NOT_ITERABLE = " is not iterable (cannot read property Symbol(Symbol.iterator))"


class NotIterableError(TypeError):
    """What `new Set(value)` throws when `value` is not iterable.

    Carried across because it is **reachable on the live corpus**, not as
    defensiveness: 105 of the 1,091 `grammar-features.tsv` rows hold an
    *object* in `tense_aspect_mood` (`{"tenses": [...], "aspects": [...]}`)
    where the other 986 hold an array. `new Set({...})` throws, so
    :func:`compute_grammatical_distance` fails for any pair touching one of
    those rows and the route answers a **500** — which means
    `enhanced/nearest?mode=grammatical` (and `combined`) is a 500 for every
    target that has a grammar row at all, since the walk reaches one of the 105
    eventually.

    Reproduced rather than repaired, twice over: repairing it here would make
    the two backends answer differently about the same pair mid-cutover, and
    the actual fix is to the corpus — those 105 cells should be arrays.
    """


def _iterable_error(value: Any) -> NotIterableError:
    if isinstance(value, bool):
        return NotIterableError(f"boolean {'true' if value else 'false'}{NOT_ITERABLE}")
    if isinstance(value, (int, float)):
        return NotIterableError(
            f"number {jsmath.js_number(float(value))}{NOT_ITERABLE}"
        )
    return NotIterableError(f"object{NOT_ITERABLE}")


def _member_key(item: Any) -> Any:
    """A `Set` membership key under SameValueZero.

    `true` and `1` are distinct there and equal in Python, hence the type tag;
    an object is compared by **identity**, so two structurally equal ones from
    two JSON parses never intersect — which is what JavaScript does too.
    """
    if isinstance(item, bool):
        return ("boolean", item)
    if isinstance(item, (int, float)):
        return ("number", float(item))
    if isinstance(item, str):
        return ("string", item)
    if item is None:
        return ("null",)
    return ("object", id(item))


def _js_set(value: Any) -> set[Any]:
    """``new Set(value)`` — including what it does with something that is not a list."""
    if value is None:
        return set()
    if isinstance(value, list):
        return {_member_key(item) for item in value}
    if isinstance(value, str):
        return {_member_key(character) for character in value}
    raise _iterable_error(value)


def _js_length(value: Any) -> int | None:
    """``value.length`` — ``None`` for a value that has no such property."""
    if isinstance(value, list):
        return len(value)
    if isinstance(value, str):
        return utf16.length(value)
    return None


def jaccard_similarity(first: Any, second: Any) -> float:
    """``jaccardSimilarity`` — 0 no overlap, 1 identical sets.

    Two empty lists are **identical**, not incomparable: a language with no
    recorded case system and another with no recorded case system agree. A value
    that is not a list at all skips that shortcut (``undefined === 0`` is false)
    and reaches `new Set` — see :class:`NotIterableError`.
    """
    if _js_length(first) == 0 and _js_length(second) == 0:
        return 1.0
    set1 = _js_set(first)
    set2 = _js_set(second)
    intersection = len(set1 & set2)
    union = len(set1) + len(set2) - intersection
    return 1.0 if union == 0 else intersection / union


def string_similarity(first: str, second: str) -> float:
    """``computeStringSimilarity`` — 1 minus the normalised edit distance.

    A second Levenshtein, spelled differently from
    :func:`~pinakes.distance.calculator.levenshtein` on the TypeScript side and
    reaching the same answer; kept here rather than shared because it is the
    syllable-structure comparison's own and the two files never imported each
    other.
    """
    if first == second:
        return 1.0
    units1 = utf16.code_units(first)
    units2 = utf16.code_units(second)
    max_length = max(len(units1), len(units2))
    if max_length == 0:
        return 1.0

    previous = list(range(len(units2) + 1))
    for row, unit1 in enumerate(units1, start=1):
        current = [row] + [0] * len(units2)
        for column in range(1, len(units2) + 1):
            cost = 0 if unit1 == units2[column - 1] else 1
            current[column] = min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + cost,
            )
        previous = current
    return 1 - previous[len(units2)] / max_length


def compute_phonological_distance(
    profiles: Profiles, lang1_id: str, lang2_id: str
) -> Record | None:
    """``computePhonologicalDistance``; ``None`` when either has no inventory.

    Tone is scored on two axes at once: `toneMatch` is whether the two languages
    *agree about being tonal*, and only when both are does the score fall back to
    a Jaccard over the tone lists. Two non-tonal languages therefore score a full
    1.0 on tone — an agreement, not an absence.
    """
    inventory1 = profiles.phonological.get(lang1_id)
    inventory2 = profiles.phonological.get(lang2_id)
    if inventory1 is None or inventory2 is None:
        return None

    consonant_overlap = jaccard_similarity(
        inventory1["consonants"], inventory2["consonants"]
    )
    vowel_overlap = jaccard_similarity(inventory1["vowels"], inventory2["vowels"])

    both_have_tones = (
        inventory1["tones"] is not None and inventory2["tones"] is not None
    )
    neither_has_tones = inventory1["tones"] is None and inventory2["tones"] is None
    tone_match = both_have_tones or neither_has_tones
    if not tone_match:
        tone_similarity = 0.0
    elif both_have_tones:
        tone_similarity = jaccard_similarity(inventory1["tones"], inventory2["tones"])
    else:
        tone_similarity = 1.0

    syllable1 = str(inventory1["syllableStructure"])
    syllable2 = str(inventory2["syllableStructure"])
    if syllable1 == syllable2:
        syllable_similarity = 1.0
    elif len(syllable1) > 0 and len(syllable2) > 0:
        syllable_similarity = string_similarity(syllable1, syllable2)
    else:
        syllable_similarity = 0.0

    stress_match = (
        str(inventory1["stressSystem"]).lower()
        == str(inventory2["stressSystem"]).lower()
    )

    distance = 1 - (
        consonant_overlap * 0.30
        + vowel_overlap * 0.25
        + tone_similarity * 0.15
        + syllable_similarity * 0.15
        + (1 if stress_match else 0) * 0.15
    )

    return {
        "distance": max(0, min(1, distance)),
        "breakdown": {
            "consonantOverlap": consonant_overlap,
            "vowelOverlap": vowel_overlap,
            "toneMatch": tone_match,
            "syllableStructureSimilarity": syllable_similarity,
            "stressSystemMatch": stress_match,
        },
    }


def compute_grammatical_distance(
    profiles: Profiles, lang1_id: str, lang2_id: str
) -> Record | None:
    """``computeGrammaticalDistance``; ``None`` when either has no grammar row."""
    features1 = profiles.grammatical.get(lang1_id)
    features2 = profiles.grammatical.get(lang2_id)
    if features1 is None or features2 is None:
        return None

    word_order_match = features1["wordOrder"] == features2["wordOrder"]
    morphological_match = (
        features1["morphologicalType"] == features2["morphologicalType"]
    )
    case_overlap = jaccard_similarity(features1["caseSystem"], features2["caseSystem"])
    gender_overlap = jaccard_similarity(
        features1["genderSystem"], features2["genderSystem"]
    )
    tam_overlap = jaccard_similarity(
        features1["tenseAspectMood"], features2["tenseAspectMood"]
    )
    negation_match = features1["negationStrategy"] == features2["negationStrategy"]
    ergativity_match = features1["ergativity"] == features2["ergativity"]
    evidentiality_match = features1["evidentiality"] == features2["evidentiality"]

    similarity = (
        (1 if word_order_match else 0) * 0.20
        + (1 if morphological_match else 0) * 0.15
        + case_overlap * 0.15
        + gender_overlap * 0.10
        + tam_overlap * 0.15
        + (1 if negation_match else 0) * 0.10
        + (1 if ergativity_match else 0) * 0.075
        + (1 if evidentiality_match else 0) * 0.075
    )

    return {
        "distance": max(0, min(1, 1 - similarity)),
        "breakdown": {
            "wordOrderMatch": word_order_match,
            "morphologicalTypeMatch": morphological_match,
            "caseSystemOverlap": case_overlap,
            "genderSystemOverlap": gender_overlap,
            "tamOverlap": tam_overlap,
            "negationMatch": negation_match,
            "ergativityMatch": ergativity_match,
            "evidentialityMatch": evidentiality_match,
        },
    }


def compute_enhanced_distance(
    profiles: Profiles,
    lang1_id: str,
    lang2_id: str,
    vocabulary_distance: float | None = None,
) -> Record:
    """``computeEnhancedDistance`` — the three dimensions and their blend.

    A **negative** vocabulary distance (the calculator's "no shared vocabulary"
    sentinel) is carried in `distances.vocabulary` but excluded from the blend:
    the caller has already dropped it in the usual case, and the guard is what
    makes a hand-built -1 not drag `combined` below zero.
    """
    phonological = compute_phonological_distance(profiles, lang1_id, lang2_id)
    grammatical = compute_grammatical_distance(profiles, lang1_id, lang2_id)

    distances: Record = {
        "vocabulary": vocabulary_distance,
        "phonological": None if phonological is None else phonological["distance"],
        "grammatical": None if grammatical is None else grammatical["distance"],
        "combined": None,
    }

    weighted: list[tuple[float, float]] = []
    if distances["vocabulary"] is not None and distances["vocabulary"] >= 0:
        weighted.append((distances["vocabulary"], 0.4))
    if distances["phonological"] is not None:
        weighted.append((distances["phonological"], 0.3))
    if distances["grammatical"] is not None:
        weighted.append((distances["grammatical"], 0.3))

    if weighted:
        total_weight = 0.0
        for _, weight in weighted:
            total_weight += weight
        blended = 0.0
        for value, weight in weighted:
            blended += value * weight
        distances["combined"] = blended / total_weight

    breakdown: Record = {}
    if phonological is not None:
        breakdown["phonological"] = phonological["breakdown"]
    if grammatical is not None:
        breakdown["grammatical"] = grammatical["breakdown"]

    return {
        "language1Id": lang1_id,
        "language2Id": lang2_id,
        "distances": distances,
        "breakdown": breakdown,
    }


def find_nearest_by_dimension(
    profiles: Profiles, target_language_id: str, mode: str, k: int = 10
) -> list[Record]:
    """``findNearestByDimension`` — the k nearest on one dimension.

    Mode ``vocabulary`` returns **nothing** here: the TypeScript's loop has no
    branch for it, so every candidate scores `null` and is dropped. That is not
    a hole — the route answers vocabulary out of
    :func:`~pinakes.distance.calculator.find_nearest_languages` and never reaches
    this function with it — but it is why the guard is spelled as a mode check
    rather than as a default.
    """
    if mode == "phonological":
        candidate_ids = [
            language_id
            for language_id in profiles.phonological
            if language_id != target_language_id
        ]
    elif mode == "grammatical":
        candidate_ids = [
            language_id
            for language_id in profiles.grammatical
            if language_id != target_language_id
        ]
    else:
        merged = dict.fromkeys([*profiles.phonological, *profiles.grammatical])
        merged.pop(target_language_id, None)
        candidate_ids = list(merged)

    results: list[Record] = []
    for language_id in candidate_ids:
        distance: float | None = None
        if mode == "phonological":
            scored = compute_phonological_distance(
                profiles, target_language_id, language_id
            )
            distance = None if scored is None else scored["distance"]
        elif mode == "grammatical":
            scored = compute_grammatical_distance(
                profiles, target_language_id, language_id
            )
            distance = None if scored is None else scored["distance"]
        elif mode == "combined":
            enhanced = compute_enhanced_distance(
                profiles, target_language_id, language_id
            )
            distance = enhanced["distances"]["combined"]

        if distance is not None:
            results.append({"languageId": language_id, "distance": distance})

    results.sort(key=lambda result: result["distance"])
    return results[:k]
