"""The quiz generator — `server/services/quiz-generator.ts`.

Ported for `GET /api/quiz` and `POST /api/quiz/score-map` (pinakes:80 US-1, the
tenth slice). Seven question generators over the corpus, a sampler that draws
from them at random, and the haversine that scores a map click.

**This surface is nondeterministic on both backends**, the same standing as LDND
in :mod:`pinakes.distance.calculator`: `Math.random()` picks the generator, the
subject and the option order on every call. :func:`configure` is the seam that
replaces monkeypatching `Math.random` over there — drive both sides from one
generator and the two answer identically, which is how this port was graded.

Four rules are contract rather than implementation:

* **`generators` has no `mixed` key**, so `mixed` flattens all seven lists in
  declaration order (`geography` contributes two) and every *other* category
  draws from one. `cuisine` and `civilizations` are reachable **only** through
  `mixed` — the route's `validCategories` does not admit them, so asking for
  either by name is a 400.
* **A generator returns `None` when the corpus cannot supply its question**, and
  the sampler simply tries again: the loop is bounded by `count * 3` attempts,
  so a thin corpus yields a *short* quiz rather than an error or a hang.
* **The answer's shape depends on the question type**: an index for
  `multiple_choice`, the ordered list for `drag_sort`, a `{lat, lng}` for
  `map_click`. `JSON.stringify` drops an absent `hint`, so a language with no
  region has no `hint` key at all rather than a null one.
* **`options.indexOf(correct)` is read after the shuffle**, so a duplicated
  option — two families of the same name, say — makes the *first* one correct.
  Reproduced.
"""

from __future__ import annotations

import math
import random as _stdlib_random
from collections.abc import Callable, Sequence
from typing import Any, Final

from pinakes.analytics.jsmath import locale_int

Record = dict[str, Any]

#: `Math.random`, injectable. See :func:`configure`.
_random: Callable[[], float] = _stdlib_random.random


def configure(random_source: Callable[[], float] | None = None) -> None:
    """Point the sampler at a generator, or back at `random.random`."""
    global _random
    _random = _stdlib_random.random if random_source is None else random_source


#: The word orders the grammar question draws its distractors from.
WORD_ORDERS: Final[tuple[str, ...]] = ("SOV", "SVO", "VSO", "VOS", "OVS", "OSV", "Free")

#: The writing-system types the question pads with when the corpus cannot supply
#: four distinct ones.
WRITING_SYSTEM_TYPES: Final[tuple[str, ...]] = (
    "alphabet",
    "abjad",
    "abugida",
    "syllabary",
    "logographic",
    "featural",
)

#: `difficulty === "easy" ? 1500 : difficulty === "medium" ? 800 : 400` — note
#: that an unknown difficulty scores as *hard*, the tightest threshold.
_MAP_CLICK_THRESHOLD_KM: Final[dict[str, int]] = {"easy": 1500, "medium": 800}


# ── The three random primitives ──────────────────────────────────────────────


def shuffle(items: Sequence[Any]) -> list[Any]:
    """Fisher-Yates, walked from the end, exactly as the TypeScript walks it."""
    shuffled = list(items)
    for index in range(len(shuffled) - 1, 0, -1):
        swap = math.floor(_random() * (index + 1))
        shuffled[index], shuffled[swap] = shuffled[swap], shuffled[index]
    return shuffled


def pick_random(items: Sequence[Any], count: int) -> list[Any]:
    """``shuffleArray(arr).slice(0, count)`` — fewer than `count` is allowed."""
    return shuffle(items)[:count]


def make_id() -> str:
    """``Math.random().toString(36).slice(2, 10)`` — eight base-36 fraction digits.

    The digits are the exact base-36 expansion of the drawn double, which is
    what `Number.prototype.toString(36)` writes; V8 stops at the shortest
    round-trippable form, so a draw whose expansion terminates early yields a
    shorter id there. Both are opaque per-call identifiers — the *format* is the
    contract, not the digit-generation.
    """
    fraction = _random()
    digits: list[str] = []
    for _ in range(8):
        fraction *= 36
        digit = int(fraction)
        fraction -= digit
        digits.append("0123456789abcdefghijklmnopqrstuvwxyz"[digit])
        if fraction == 0:
            break
    return "".join(digits)


# ── Helpers the generators share ─────────────────────────────────────────────


def _truthy(value: Any) -> bool:
    if value is None or value is False or value == "":
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0 and value == value
    return True


def _speakable(language: Record) -> bool:
    """``!l.isDialect && !l.isHistoricalVariant`` — five of the seven share it."""
    return not _truthy(language.get("isDialect")) and not _truthy(
        language.get("isHistoricalVariant")
    )


def _has_valid_coords(coords: Any) -> bool:
    """`hasValidCoords` — and `{0, 0}` is the missing-data sentinel, not a place."""
    if not isinstance(coords, dict):
        return False
    lat = coords.get("lat")
    lng = coords.get("lng")
    if isinstance(lat, bool) or isinstance(lng, bool):
        return False
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False
    if lat != lat or lng != lng:
        return False
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        return False
    return not (lat == 0 and lng == 0)


def _origin_of(cuisine: Record) -> Any:
    """``cuisine.region || cuisine.name`` — the dish explanation's place name."""
    region = cuisine.get("region")
    return region if _truthy(region) else cuisine.get("name")


def _question(**fields: Any) -> Record:
    """A question with its `undefined` keys dropped, as `JSON.stringify` writes it."""
    return {key: value for key, value in fields.items() if value is not None}


# ── The seven generators ─────────────────────────────────────────────────────


def language_family_question(corpus: Corpus, difficulty: str) -> Record | None:
    """Which family does <language> belong to? — needs four candidate languages."""
    family_by_id = {row.get("id"): row for row in corpus.families}
    candidates = [
        row
        for row in corpus.languages
        if row.get("familyId") in family_by_id and _speakable(row)
    ]
    if len(candidates) < 4:
        return None

    target = pick_random(candidates, 1)[0]
    correct = family_by_id.get(target.get("familyId"))
    if correct is None:
        return None

    wrong = pick_random(
        [row for row in corpus.families if row.get("id") != target.get("familyId")], 3
    )
    options = shuffle([row.get("name") for row in [correct, *wrong]])
    return _question(
        id=make_id(),
        type="multiple_choice",
        category="families",
        difficulty=difficulty,
        question=f"Which language family does {target.get('name')} belong to?",
        options=options,
        answer=options.index(correct.get("name")),
        hint=(
            f"It is spoken in {target.get('region')}."
            if _truthy(target.get("region"))
            else None
        ),
        explanation=(
            f"{target.get('name')} belongs to the {correct.get('name')} family."
        ),
    )


def speaker_count_question(corpus: Corpus, difficulty: str) -> Record | None:
    """Sort four languages by speaker count — the only `languages` question."""
    with_speakers = [
        row
        for row in corpus.languages
        if _truthy(row.get("totalSpeakers"))
        and float(row.get("totalSpeakers") or 0) > 0
        and _speakable(row)
    ]
    if len(with_speakers) < 4:
        return None

    selected = pick_random(with_speakers, 4)
    selected.sort(key=lambda row: -(row.get("totalSpeakers") or 0))
    correct_order = [row.get("name") for row in selected]
    return _question(
        id=make_id(),
        type="drag_sort",
        category="languages",
        difficulty=difficulty,
        question="Sort these languages by number of total speakers (most to fewest):",
        options=shuffle(correct_order),
        answer=correct_order,
        explanation=", ".join(
            f"{row.get('name')}: "
            f"{locale_int(int(row.get('totalSpeakers') or 0))} speakers"
            for row in selected
        ),
    )


def map_click_question(corpus: Corpus, difficulty: str) -> Record | None:
    """Click where <language> is spoken.

    Note the asymmetry with the dish question below: this one accepts **any**
    truthy `coordinates`, including the `{0, 0}` sentinel, so a language with no
    recorded location really can be asked about. Kept as found.
    """
    with_coords = [
        row
        for row in corpus.languages
        if _truthy(row.get("coordinates")) and _speakable(row)
    ]
    if not with_coords:
        return None

    target = pick_random(with_coords, 1)[0]
    coords = target.get("coordinates") or {}
    countries = target.get("countries")
    where = (
        ", ".join(str(item) for item in countries)
        if isinstance(countries, list) and countries
        else (target.get("region") if _truthy(target.get("region")) else "its region")
    )
    return _question(
        id=make_id(),
        type="map_click",
        category="geography",
        difficulty=difficulty,
        question=(
            f"Click on the map where {target.get('name')} is primarily spoken."
        ),
        answer=_question(lat=coords.get("lat"), lng=coords.get("lng")),
        hint=(
            f"It is spoken in the {target.get('region')} region."
            if _truthy(target.get("region"))
            else None
        ),
        explanation=f"{target.get('name')} is spoken in {where}.",
    )


def dish_origin_question(corpus: Corpus, difficulty: str) -> Record | None:
    """Click where a dish originated — anchored on its cuisine's coordinates."""
    cuisine_by_id = {
        row.get("id"): row
        for row in corpus.cuisines
        if _has_valid_coords(row.get("coordinates"))
    }
    candidates = [
        row
        for row in corpus.cuisine_items
        if _truthy(row.get("name")) and row.get("cuisineId") in cuisine_by_id
    ]
    if not candidates:
        return None

    dish = pick_random(candidates, 1)[0]
    cuisine = cuisine_by_id[dish.get("cuisineId")]
    coords = cuisine.get("coordinates") or {}
    return _question(
        id=make_id(),
        type="map_click",
        category="cuisine",
        difficulty=difficulty,
        question=(
            f'Click on the map where the dish "{dish.get("name")}" '
            f"({cuisine.get('name')} cuisine) originated."
        ),
        answer=_question(lat=coords.get("lat"), lng=coords.get("lng")),
        hint=(
            f"It comes from the {cuisine.get('region')} culinary tradition."
            if _truthy(cuisine.get("region"))
            else None
        ),
        explanation=(
            f"{dish.get('name')} originated in {_origin_of(cuisine)} "
            f"({cuisine.get('name')} cuisine)."
        ),
    )


#: The expansions the word-order explanation spells out. An order outside the
#: three named ones is printed as itself — `Free` explains as `Free (Free)`.
_WORD_ORDER_NAMES: Final[dict[str, str]] = {
    "SVO": "Subject-Verb-Object",
    "SOV": "Subject-Object-Verb",
    "VSO": "Verb-Subject-Object",
}


def word_order_question(corpus: Corpus, difficulty: str) -> Record | None:
    """What is <language>'s basic word order?

    Two thresholds, and the first one is about the *whole* table: fewer than four
    grammar rows in the corpus and there is no question at all, even if all four
    of them carry a word order.
    """
    if len(corpus.grammar_features) < 4:
        return None
    language_by_id = {row.get("id"): row for row in corpus.languages}
    with_word_order = [
        row
        for row in corpus.grammar_features
        if _truthy(row.get("wordOrder")) and row.get("languageId") in language_by_id
    ]
    if len(with_word_order) < 4:
        return None

    target = pick_random(with_word_order, 1)[0]
    language = language_by_id.get(target.get("languageId"))
    if language is None:
        return None

    order = target.get("wordOrder")
    wrong = pick_random([item for item in WORD_ORDERS if item != order], 3)
    options = shuffle([order, *wrong])
    return _question(
        id=make_id(),
        type="multiple_choice",
        category="grammar",
        difficulty=difficulty,
        question=f"What is the basic word order of {language.get('name')}?",
        options=options,
        answer=options.index(order),
        explanation=(
            f"{language.get('name')} uses {order} "
            f"({_WORD_ORDER_NAMES.get(order, order)}) word order."
        ),
    )


def writing_system_question(corpus: Corpus, difficulty: str) -> Record | None:
    """What type of writing system is <name>? — over the *active* systems only."""
    if len(corpus.writing_systems) < 4:
        return None
    active = [row for row in corpus.writing_systems if _truthy(row.get("isActive"))]
    if len(active) < 4:
        return None

    target = pick_random(active, 1)[0]
    wrong = pick_random(
        [row.get("type") for row in active if row.get("id") != target.get("id")], 3
    )
    unique = list(dict.fromkeys([target.get("type"), *wrong]))
    if len(unique) < 4:
        for extra in WRITING_SYSTEM_TYPES:
            if len(unique) >= 4:
                break
            if extra not in unique:
                unique.append(extra)

    options = shuffle(unique[:4])
    return _question(
        id=make_id(),
        type="multiple_choice",
        category="writing_systems",
        difficulty=difficulty,
        question=f"What type of writing system is {target.get('name')}?",
        options=options,
        answer=options.index(target.get("type")),
        hint=(
            f"Sample characters: {target.get('sampleCharacters')}"
            if _truthy(target.get("sampleCharacters"))
            else None
        ),
        explanation=(
            f"{target.get('name')} is a {target.get('type')} writing system"
            + (
                f", originating from {target.get('originRegion')}"
                if _truthy(target.get("originRegion"))
                else ""
            )
            + "."
        ),
    )


def region_question(corpus: Corpus, difficulty: str) -> Record | None:
    """In which region is <language> spoken? — distractors are real regions."""
    with_region = [
        row
        for row in corpus.languages
        if _truthy(row.get("region")) and _speakable(row)
    ]
    if len(with_region) < 4:
        return None

    target = pick_random(with_region, 1)[0]
    regions = list(dict.fromkeys(row.get("region") for row in with_region))
    wrong = pick_random(
        [region for region in regions if region != target.get("region")], 3
    )
    options = shuffle([target.get("region"), *wrong])
    countries = target.get("countries")
    suffix = (
        f" ({', '.join(str(item) for item in countries)})"
        if isinstance(countries, list) and countries
        else ""
    )
    return _question(
        id=make_id(),
        type="multiple_choice",
        category="geography",
        difficulty=difficulty,
        question=f"In which region is {target.get('name')} primarily spoken?",
        options=options,
        answer=options.index(target.get("region")),
        explanation=(
            f"{target.get('name')} is spoken in {target.get('region')}{suffix}."
        ),
    )


def chronology_item_count(difficulty: str) -> int:
    """3 / 4 / 5 items to order — and an unknown difficulty is `hard`."""
    return 3 if difficulty == "easy" else 4 if difficulty == "medium" else 5


def order_civilizations_chronologically(items: list[Record]) -> list[str]:
    """Earliest founding first. Pure and deterministic — the drag-sort answer."""
    return [
        str(item["name"]) for item in sorted(items, key=lambda item: item["year"])
    ]


def select_chronology_items(
    ordered: list[Record], count: int, difficulty: str
) -> list[Record] | None:
    """Draw `count` civilizations from a difficulty-scaled window.

    `ordered` must already be ascending by year. `hard` takes a **contiguous**
    run — the closest foundings the corpus has, and therefore the hardest to
    tell apart; `medium` draws from a window of `count * 3`; `easy` draws from
    the whole span.
    """
    total = len(ordered)
    if total < count:
        return None
    window_size = (
        count
        if difficulty == "hard"
        else min(total, count * 3)
        if difficulty == "medium"
        else total
    )
    start = math.floor(_random() * (total - window_size + 1))
    window = ordered[start : start + window_size]
    chosen = window if window_size == count else pick_random(window, count)
    return sorted(chosen, key=lambda item: item["year"])


def _format_founding_year(year: int) -> str:
    return f"{abs(year)} BCE" if year < 0 else f"{year} CE"


def civilization_chronology_question(
    corpus: Corpus, difficulty: str
) -> Record | None:
    """Order civilizations by founding date.

    A founding year of **0** is the loader's missing-data sentinel and is
    filtered out, and the first row wins for a repeated name — so a civilization
    recorded twice is asked about once, with its earliest-listed date.
    """
    by_name: dict[str, Record] = {}
    for feature in corpus.civilizations:
        properties = feature.get("properties") or {}
        name = properties.get("name")
        period = properties.get("timePeriod") or {}
        year = period.get("start")
        if not name or isinstance(year, bool) or not isinstance(year, (int, float)):
            continue
        if year != year or year == 0:
            continue
        by_name.setdefault(str(name), {"name": name, "year": year})

    items = sorted(by_name.values(), key=lambda item: item["year"])
    count = chronology_item_count(difficulty)
    selected = select_chronology_items(items, count, difficulty)
    if selected is None:
        return None

    correct_order = order_civilizations_chronologically(selected)
    return _question(
        id=make_id(),
        type="drag_sort",
        category="civilizations",
        difficulty=difficulty,
        question=(
            "Arrange these civilizations in chronological order "
            "(earliest founding first):"
        ),
        options=shuffle(correct_order),
        answer=correct_order,
        explanation=", ".join(
            f"{item['name']}: founded {_format_founding_year(int(item['year']))}"
            for item in selected
        ),
    )


class Corpus:
    """The five tables the generators read, loaded once per request.

    Over there each generator called `storage.get*()` for itself and the storage
    singleton memoised the tables, so a ten-question quiz read each file once.
    Nothing is cached in this service (`lexicons/` says why), so the read is
    hoisted to the request instead — same rule, and the same reason, as
    `distance.calculator.Lexicon`.
    """

    __slots__ = (
        "languages",
        "families",
        "cuisines",
        "cuisine_items",
        "grammar_features",
        "writing_systems",
        "civilizations",
    )

    def __init__(
        self,
        *,
        languages: list[Record],
        families: list[Record],
        cuisines: list[Record],
        cuisine_items: list[Record],
        grammar_features: list[Record],
        writing_systems: list[Record],
        civilizations: list[Record],
    ) -> None:
        self.languages = languages
        self.families = families
        self.cuisines = cuisines
        self.cuisine_items = cuisine_items
        self.grammar_features = grammar_features
        self.writing_systems = writing_systems
        self.civilizations = civilizations


Generator = Callable[[Corpus, str], "Record | None"]

#: `generators`, in declaration order — which is the order `mixed` flattens.
GENERATORS: Final[dict[str, tuple[Generator, ...]]] = {
    "languages": (speaker_count_question,),
    "families": (language_family_question,),
    "grammar": (word_order_question,),
    "writing_systems": (writing_system_question,),
    "geography": (map_click_question, region_question),
    "cuisine": (dish_origin_question,),
    "civilizations": (civilization_chronology_question,),
}


def generate_quiz(
    corpus: Corpus, count: int, category: str, difficulty: str
) -> Record:
    """Draw up to `count` questions, giving up after `count * 3` attempts."""
    active: list[Generator] = (
        [generator for group in GENERATORS.values() for generator in group]
        if category == "mixed"
        else list(GENERATORS.get(category, ()))
    )
    if not active:
        return {"questions": [], "category": category, "difficulty": difficulty}

    questions: list[Record] = []
    attempts = 0
    max_attempts = count * 3
    while len(questions) < count and attempts < max_attempts:
        attempts += 1
        generator = active[math.floor(_random() * len(active))]
        question = generator(corpus, difficulty)
        if question is not None:
            questions.append(question)

    return {"questions": questions, "category": category, "difficulty": difficulty}


def score_map_click(answer: Record, guess: Record, difficulty: str) -> Record:
    """Great-circle distance, and whether it is inside the difficulty's radius.

    Spelled operation for operation as the TypeScript spells it — `(x * pi) / 180`
    rather than `math.radians`, `sin(x) ** 2` where it writes `** 2` and
    `sin(x) * sin(x)` nowhere — so the only divergence available is the last-ULP
    one in `atan2` that :mod:`pinakes.distance.calculator` documents.
    """
    radius_km = 6371
    d_lat = (float(guess["lat"]) - float(answer["lat"])) * math.pi / 180
    d_lng = (float(guess["lng"]) - float(answer["lng"])) * math.pi / 180
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(float(answer["lat"]) * math.pi / 180)
        * math.cos(float(guess["lat"]) * math.pi / 180)
        * math.sin(d_lng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    distance_km = radius_km * c
    threshold = _MAP_CLICK_THRESHOLD_KM.get(difficulty, 400)
    return {"correct": distance_km <= threshold, "distanceKm": distance_km}
