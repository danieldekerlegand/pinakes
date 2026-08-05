"""Articulatory substitution costs — the port of `server/services/phonetic-features.ts`.

A plain Levenshtein treats every phoneme swap as one edit, so `p`→`b` (a voicing
change, and one of the commonest sound changes there is) costs exactly what
`p`→`a` costs. This module replaces that flat cost with a feature-based one:
each IPA symbol is described by its manner, place and voicing (or height,
backness and roundness), and a substitution costs how far apart the two
descriptions are.

It is reached only through `phonetic_mode="ipa-weighted"`, which today only
`POST /api/linguistic-distance/matrix` can ask for. Everything below is
transcribed rather than rederived — the tables, the weights and the two
normalising divisors are the contract, and the divisors in particular are the
*observed* maxima of the tables above them (1.9 for a consonant, 1.55 for a
vowel), not a bound anyone computes.
"""

from __future__ import annotations

from typing import NamedTuple

from pinakes.distance import utf16


class Features(NamedTuple):
    """One row of the IPA feature database.

    ``kind`` is the TypeScript's `type`, renamed only to keep the builtin
    readable at the call sites; nothing else about the record differs.
    """

    kind: str
    manner: str | None = None
    place: str | None = None
    voicing: str | None = None
    height: str | None = None
    backness: str | None = None
    roundness: str | None = None


def _c(manner: str, place: str, voicing: str) -> Features:
    return Features(kind="consonant", manner=manner, place=place, voicing=voicing)


def _v(height: str, backness: str, roundness: str) -> Features:
    return Features(kind="vowel", height=height, backness=backness, roundness=roundness)


#: `phoneticFeatureMap` — simplified, but covering the common phonemes.
PHONETIC_FEATURES: dict[str, Features] = {
    # Plosives
    "p": _c("plosive", "bilabial", "voiceless"),
    "b": _c("plosive", "bilabial", "voiced"),
    "t": _c("plosive", "alveolar", "voiceless"),
    "d": _c("plosive", "alveolar", "voiced"),
    "k": _c("plosive", "velar", "voiceless"),
    "g": _c("plosive", "velar", "voiced"),
    "ɡ": _c("plosive", "velar", "voiced"),
    "ʔ": _c("plosive", "glottal", "voiceless"),
    # Fricatives
    "f": _c("fricative", "labiodental", "voiceless"),
    "v": _c("fricative", "labiodental", "voiced"),
    "θ": _c("fricative", "dental", "voiceless"),
    "ð": _c("fricative", "dental", "voiced"),
    "s": _c("fricative", "alveolar", "voiceless"),
    "z": _c("fricative", "alveolar", "voiced"),
    "ʃ": _c("fricative", "postalveolar", "voiceless"),
    "ʒ": _c("fricative", "postalveolar", "voiced"),
    "ʂ": _c("fricative", "retroflex", "voiceless"),
    "ʐ": _c("fricative", "retroflex", "voiced"),
    "ç": _c("fricative", "palatal", "voiceless"),
    "ʝ": _c("fricative", "palatal", "voiced"),
    "x": _c("fricative", "velar", "voiceless"),
    "ɣ": _c("fricative", "velar", "voiced"),
    "χ": _c("fricative", "uvular", "voiceless"),
    "ʁ": _c("fricative", "uvular", "voiced"),
    "ħ": _c("fricative", "pharyngeal", "voiceless"),
    "ʕ": _c("fricative", "pharyngeal", "voiced"),
    "h": _c("fricative", "glottal", "voiceless"),
    "ɦ": _c("fricative", "glottal", "voiced"),
    # Affricates
    "ʦ": _c("affricate", "alveolar", "voiceless"),
    "ʣ": _c("affricate", "alveolar", "voiced"),
    "ʧ": _c("affricate", "postalveolar", "voiceless"),
    "ʤ": _c("affricate", "postalveolar", "voiced"),
    "ʨ": _c("affricate", "palatal", "voiceless"),
    "ʥ": _c("affricate", "palatal", "voiced"),
    # Nasals
    "m": _c("nasal", "bilabial", "voiced"),
    "ɱ": _c("nasal", "labiodental", "voiced"),
    "n": _c("nasal", "alveolar", "voiced"),
    "ɳ": _c("nasal", "retroflex", "voiced"),
    "ɲ": _c("nasal", "palatal", "voiced"),
    "ŋ": _c("nasal", "velar", "voiced"),
    "ɴ": _c("nasal", "uvular", "voiced"),
    # Approximants
    "ʋ": _c("approximant", "labiodental", "voiced"),
    "ɹ": _c("approximant", "alveolar", "voiced"),
    "ɻ": _c("approximant", "retroflex", "voiced"),
    "j": _c("approximant", "palatal", "voiced"),
    "ɰ": _c("approximant", "velar", "voiced"),
    "w": _c("approximant", "velar", "voiced"),
    "l": _c("approximant", "alveolar", "voiced"),
    "ɭ": _c("approximant", "retroflex", "voiced"),
    "ʎ": _c("approximant", "palatal", "voiced"),
    "ʟ": _c("approximant", "velar", "voiced"),
    "r": _c("trill", "alveolar", "voiced"),
    "ʀ": _c("trill", "uvular", "voiced"),
    "ɾ": _c("tap", "alveolar", "voiced"),
    "ɽ": _c("tap", "retroflex", "voiced"),
    # Close vowels
    "i": _v("close", "front", "unrounded"),
    "y": _v("close", "front", "rounded"),
    "ɨ": _v("close", "central", "unrounded"),
    "ʉ": _v("close", "central", "rounded"),
    "ɯ": _v("close", "back", "unrounded"),
    "u": _v("close", "back", "rounded"),
    # Near-close vowels
    "ɪ": _v("near-close", "front", "unrounded"),
    "ʏ": _v("near-close", "front", "rounded"),
    "ʊ": _v("near-close", "back", "rounded"),
    # Close-mid vowels
    "e": _v("close-mid", "front", "unrounded"),
    "ø": _v("close-mid", "front", "rounded"),
    "ɘ": _v("close-mid", "central", "unrounded"),
    "ɵ": _v("close-mid", "central", "rounded"),
    "ɤ": _v("close-mid", "back", "unrounded"),
    "o": _v("close-mid", "back", "rounded"),
    # Mid vowels
    "ə": _v("mid", "central", "unrounded"),
    # Open-mid vowels
    "ɛ": _v("open-mid", "front", "unrounded"),
    "œ": _v("open-mid", "front", "rounded"),
    "ɜ": _v("open-mid", "central", "unrounded"),
    "ɞ": _v("open-mid", "central", "rounded"),
    "ʌ": _v("open-mid", "back", "unrounded"),
    "ɔ": _v("open-mid", "back", "rounded"),
    # Near-open vowels
    "æ": _v("near-open", "front", "unrounded"),
    "ɐ": _v("near-open", "central", "unrounded"),
    # Open vowels
    "a": _v("open", "front", "unrounded"),
    "ɶ": _v("open", "front", "rounded"),
    "ɑ": _v("open", "back", "unrounded"),
    "ɒ": _v("open", "back", "rounded"),
}

#: `featureWeights` — how much each kind of feature change costs.
VOICING = 0.2
PLACE_1_STEP = 0.3
PLACE_2_STEPS = 0.5
PLACE_3_STEPS = 0.7
HEIGHT_1_STEP = 0.25
HEIGHT_2_STEPS = 0.5
HEIGHT_3_STEPS = 0.75
BACKNESS_1_STEP = 0.3
BACKNESS_2_STEPS = 0.6
ROUNDNESS = 0.2
CONSONANT_VOWEL = 1.0

PLACE_ORDER: dict[str, int] = {
    "bilabial": 0,
    "labiodental": 1,
    "dental": 2,
    "alveolar": 3,
    "postalveolar": 4,
    "retroflex": 5,
    "palatal": 6,
    "velar": 7,
    "uvular": 8,
    "pharyngeal": 9,
    "glottal": 10,
}

MANNER_SIMILARITY: dict[str, dict[str, float]] = {
    "plosive": {
        "plosive": 0,
        "affricate": 0.4,
        "fricative": 0.6,
        "nasal": 0.5,
        "approximant": 1.0,
        "trill": 0.9,
        "tap": 0.9,
    },
    "affricate": {
        "plosive": 0.4,
        "affricate": 0,
        "fricative": 0.3,
        "nasal": 0.8,
        "approximant": 0.9,
        "trill": 1.0,
        "tap": 1.0,
    },
    "fricative": {
        "plosive": 0.6,
        "affricate": 0.3,
        "fricative": 0,
        "nasal": 0.8,
        "approximant": 0.7,
        "trill": 0.9,
        "tap": 0.9,
    },
    "nasal": {
        "plosive": 0.5,
        "affricate": 0.8,
        "fricative": 0.8,
        "nasal": 0,
        "approximant": 0.4,
        "trill": 0.6,
        "tap": 0.6,
    },
    "approximant": {
        "plosive": 1.0,
        "affricate": 0.9,
        "fricative": 0.7,
        "nasal": 0.4,
        "approximant": 0,
        "trill": 0.3,
        "tap": 0.3,
    },
    "trill": {
        "plosive": 0.9,
        "affricate": 1.0,
        "fricative": 0.9,
        "nasal": 0.6,
        "approximant": 0.3,
        "trill": 0,
        "tap": 0.2,
    },
    "tap": {
        "plosive": 0.9,
        "affricate": 1.0,
        "fricative": 0.9,
        "nasal": 0.6,
        "approximant": 0.3,
        "trill": 0.2,
        "tap": 0,
    },
}

HEIGHT_ORDER: dict[str, int] = {
    "close": 0,
    "near-close": 1,
    "close-mid": 2,
    "mid": 3,
    "open-mid": 4,
    "near-open": 5,
    "open": 6,
}

BACKNESS_ORDER: dict[str, int] = {"front": 0, "central": 1, "back": 2}


def phonetic_distance(phoneme1: str, phoneme2: str) -> float:
    """``calculatePhoneticDistance`` — 0 identical, 1 maximally different.

    An **unknown** phoneme costs a full 1.0, which is what makes this safe to
    point at any string: a diacritic, a space or a Latin letter that is not in
    the table falls back to the flat edit cost rather than scoring as similar to
    everything.
    """
    if phoneme1 == phoneme2:
        return 0.0

    features1 = PHONETIC_FEATURES.get(phoneme1)
    features2 = PHONETIC_FEATURES.get(phoneme2)
    if features1 is None or features2 is None:
        return 1.0

    if features1.kind != features2.kind:
        return CONSONANT_VOWEL

    if features1.kind == "consonant":
        distance = 0.0
        if features1.voicing != features2.voicing:
            distance += VOICING
        if features1.place and features2.place:
            place_diff = abs(
                PLACE_ORDER[features1.place] - PLACE_ORDER[features2.place]
            )
            if place_diff == 1:
                distance += PLACE_1_STEP
            elif place_diff == 2:
                distance += PLACE_2_STEPS
            elif place_diff >= 3:
                distance += PLACE_3_STEPS
        if features1.manner and features2.manner:
            distance += MANNER_SIMILARITY.get(features1.manner, {}).get(
                features2.manner, 1.0
            )
        return min(1.0, distance / 1.9)

    if features1.kind == "vowel":
        distance = 0.0
        if features1.height and features2.height:
            height_diff = abs(
                HEIGHT_ORDER[features1.height] - HEIGHT_ORDER[features2.height]
            )
            if height_diff == 1:
                distance += HEIGHT_1_STEP
            elif height_diff == 2:
                distance += HEIGHT_2_STEPS
            elif height_diff >= 3:
                distance += HEIGHT_3_STEPS
        if features1.backness and features2.backness:
            backness_diff = abs(
                BACKNESS_ORDER[features1.backness] - BACKNESS_ORDER[features2.backness]
            )
            if backness_diff == 1:
                distance += BACKNESS_1_STEP
            elif backness_diff >= 2:
                distance += BACKNESS_2_STEPS
        if features1.roundness != features2.roundness:
            distance += ROUNDNESS
        return min(1.0, distance / 1.55)

    return 1.0


def phonetic_levenshtein(text1: str, text2: str) -> float:
    """``phoneticLevenshteinDistance`` — Levenshtein with weighted substitutions.

    Insertion and deletion still cost a flat 1, so a substitution is *never* more
    expensive than deleting and re-inserting; the weighting only ever makes a
    replacement cheaper.
    """
    units1 = utf16.code_units(text1)
    units2 = utf16.code_units(text2)
    len1 = len(units1)
    len2 = len(units2)

    previous: list[float] = [float(column) for column in range(len2 + 1)]
    for row in range(1, len1 + 1):
        current: list[float] = [float(row)] + [0.0] * len2
        for column in range(1, len2 + 1):
            substitution = phonetic_distance(units1[row - 1], units2[column - 1])
            current[column] = min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + substitution,
            )
        previous = current
    return previous[len2]


def normalized_phonetic_levenshtein(text1: str, text2: str) -> float:
    """``normalizedPhoneticLevenshtein`` — divided by the longer string's length."""
    if utf16.length(text1) == 0 and utf16.length(text2) == 0:
        return 0.0
    distance = phonetic_levenshtein(text1, text2)
    max_length = max(utf16.length(text1), utf16.length(text2))
    return distance / max_length
