"""The endangered-language vitality model and the field-research workflow.

`server/services/language-preservation.ts`, whole. Two responsibilities that
would normally live in two packages — a corpus aggregation and a contribution
builder — and they are one module here for the reason they are one file over
there: :func:`validate_field_update` grades a researcher's proposed status
against the **same** alias table the dashboard buckets the corpus with. Split
them and the vocabulary is stated twice, which is the drift
`contributions/changelog.py` documents avoiding for the same reason.

Three things are worth knowing before touching it:

* **The corpus `status` column is free text**, and messy — `living`,
  `Critically Endangered`, `definiteley endangered` [sic], blanks. Everything
  funnels through :func:`normalize_status`, which never raises on an
  unrecognised spelling: it answers the `unknown` level, so a messy corpus is
  classified *honestly* rather than mis-bucketed as living. (On live data that
  bucket is nearly empty anyway — `storage.load_languages` defaults a **short**
  row's status to `living`.)
* **`String(v)` is not `str(v)`, and this file needs the JavaScript one in five
  places.** `String([])` is `""`, so a `region` of `[]` proposes no change at
  all; `String(None)` is `"null"`, so an explicitly-null speaker count really
  does render as `total speakers → null` in the changelog summary. :func:`js_string`
  is that conversion — :func:`~pinakes.authoring._js.number_text` is only its
  numeric leg.
* **`.trim()` is V8's whitespace set, not Python's.** The two disagree at both
  ends (`\\x1c`-`\\x1f` and `\\x85` are Python's alone, U+FEFF is V8's), and the
  same disagreement decides the email warning's negated character class. Same
  rule `lexicons/etymology.py` spells out for its tokenizer.
"""

from __future__ import annotations

import math
import re
from typing import Any, Final, NamedTuple

from pinakes.analytics.jsmath import js_number, locale_key
from pinakes.authoring._js import is_finite_number, number_text
from pinakes.contributions.store import js_truthy

Record = dict[str, Any]

#: V8's `\s`, as a character-class body — the set `String.prototype.trim`
#: strips. Python's `\s` is not this set: it adds `\x1c`-`\x1f` and `\x85`, and
#: it omits U+FEFF. Copied from :mod:`pinakes.lexicons.etymology`, which needs
#: the same class for a *negated* match; a shared constant would have to live in
#: one of the two modules, and neither imports the other today.
_JS_SPACE: Final = (
    " \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a"
    "\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
)

_TRIM = re.compile("\\A[" + _JS_SPACE + "]+|[" + _JS_SPACE + "]+\\Z")
_COLLAPSE = re.compile("[" + _JS_SPACE + "]+")

#: `/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/`, with V8's `\\s`. Matched with
#: :meth:`re.Pattern.fullmatch` rather than the anchors, because Python's `$`
#: also matches *before* a trailing newline and JavaScript's does not — an
#: address ending in `\\n` warns over there and would not here.
_EMAIL = re.compile(
    "[^" + _JS_SPACE + "@]+@[^" + _JS_SPACE + "@]+\\.[^" + _JS_SPACE + "@]+"
)


# ── JavaScript coercions ─────────────────────────────────────────────────────


def js_trim(value: str) -> str:
    """``value.trim()`` — V8's whitespace set, at both ends."""
    return _TRIM.sub("", value)


def js_string(value: Any) -> str:
    """``String(value)`` for a value that arrived as parsed JSON.

    The three readings Python does not share: an array is its elements joined by
    commas (so `[]` is the **empty string** and proposes no change), a plain
    object is the literal `[object Object]`, and `null` is `"null"` rather than
    `None`. A float that happens to be integral prints without its fraction —
    :func:`~pinakes.authoring._js.number_text`, hoisted here rather than
    restated.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return "NaN"
        return number_text(value)
    if isinstance(value, list):
        # `Array.prototype.join` renders a nullish element as the empty string.
        return ",".join("" if item is None else js_string(item) for item in value)
    return "[object Object]"


class TrimOfNonStringError(TypeError):
    """What V8 throws for `x.trim()` when `x` is not a string.

    The message is the contract: the two field-update handlers publish
    `error.message` in their 500 body, so it names the *expression* the
    TypeScript wrote rather than the value that reached it. Same posture as
    :class:`pinakes.distance.enhanced.NotIterableError`.
    """


def _trim(value: Any, expression: str) -> str:
    """``<expression>.trim()``, raising V8's TypeError for a non-string."""
    if not isinstance(value, str):
        raise TrimOfNonStringError(f"{expression}.trim is not a function")
    return js_trim(value)


def _optional_trim(value: Any, expression: str) -> str | None:
    """``<expression>?.trim()`` — ``None`` for a nullish value, else :func:`_trim`."""
    if value is None:
        return None
    return _trim(value, expression)


# ── Vitality model ───────────────────────────────────────────────────────────

#: The coarse buckets: the story's living/endangered/extinct plus an honest
#: `unknown` for a blank or unrecognised cell.
PRESERVATION_CATEGORIES: Final[tuple[str, ...]] = (
    "living",
    "endangered",
    "extinct",
    "unknown",
)


class VitalityLevel(NamedTuple):
    """A canonical level a raw status string normalizes onto."""

    key: str
    label: str
    category: str
    #: At-risk ordering: 0 = safe … higher = closer to loss. `unknown` is -1.
    rank: int


#: The ladder, safe → lost. `revitalizing` sits low because an actively-revived
#: language is precarious but recovering, not merely endangered.
VITALITY_LEVELS: Final[tuple[VitalityLevel, ...]] = (
    VitalityLevel("living", "Living", "living", 0),
    VitalityLevel("revitalizing", "Revitalizing", "endangered", 1),
    VitalityLevel("vulnerable", "Vulnerable", "endangered", 2),
    VitalityLevel("endangered", "Endangered", "endangered", 3),
    VitalityLevel(
        "definitely-endangered", "Definitely endangered", "endangered", 4
    ),
    VitalityLevel("severely-endangered", "Severely endangered", "endangered", 5),
    VitalityLevel(
        "critically-endangered", "Critically endangered", "endangered", 6
    ),
    VitalityLevel("moribund", "Moribund", "endangered", 7),
    VitalityLevel("dormant", "Dormant", "extinct", 8),
    VitalityLevel("extinct", "Extinct", "extinct", 9),
    VitalityLevel("unknown", "Unknown", "unknown", -1),
)

_LEVEL_BY_KEY: Final[dict[str, VitalityLevel]] = {
    level.key: level for level in VITALITY_LEVELS
}
_UNKNOWN_LEVEL: Final = _LEVEL_BY_KEY["unknown"]

#: Raw spellings → canonical key. Keys are the lowercased, space-collapsed cell;
#: the misspellings are ones `languages.tsv` actually carries.
_STATUS_ALIASES: Final[dict[str, str]] = {
    "living": "living",
    "alive": "living",
    "safe": "living",
    "spoken": "living",
    "national": "living",
    "official": "living",
    "revitalizing": "revitalizing",
    "reviving": "revitalizing",
    "revived": "revitalizing",
    "reawakening": "revitalizing",
    "reemerging": "revitalizing",
    "vulnerable": "vulnerable",
    "threatened": "vulnerable",
    "at risk": "vulnerable",
    "endangered": "endangered",
    "definitely endangered": "definitely-endangered",
    "definiteley endangered": "definitely-endangered",
    "definately endangered": "definitely-endangered",
    "severely endangered": "severely-endangered",
    "critically endangered": "critically-endangered",
    "nearly extinct": "critically-endangered",
    "moribund": "moribund",
    "dormant": "dormant",
    "sleeping": "dormant",
    "extinct": "extinct",
    "dead": "extinct",
}

#: Substring fallbacks, in the order the TypeScript tests them — first hit wins,
#: so `critically` outranks the bare `endanger` that also matches it.
_SUBSTRING_FALLBACKS: Final[tuple[tuple[str, str], ...]] = (
    ("critically", "critically-endangered"),
    ("severely", "severely-endangered"),
    ("definite", "definitely-endangered"),
    ("vulnerable", "vulnerable"),
    ("endanger", "endangered"),
    ("extinct", "extinct"),
    ("dormant", "dormant"),
    ("living", "living"),
)


def _status_key(raw: str) -> str:
    """``raw.trim().toLowerCase().replace(/\\s+/g, " ")``."""
    return _COLLAPSE.sub(" ", js_trim(raw).lower())


def normalize_status(raw: Any) -> VitalityLevel:
    """The canonical level for a raw `status` cell. Never answers a wrong bucket.

    A missing or unrecognised cell is the `unknown` level. A **non-string** raw
    value raises :class:`TrimOfNonStringError`, because `raw.trim()` throws over
    there too — and it does so in `validateFieldUpdate`, which the Express route
    calls *outside* its try/catch. That is the one place this port cannot
    reproduce the status code: Express hands the rejection to its default error
    handler and answers an HTML 500, where this service answers FastAPI's.
    """
    if raw is None:
        return _UNKNOWN_LEVEL
    if not isinstance(raw, str):
        raise TrimOfNonStringError("raw.trim is not a function")
    key = _status_key(raw)
    if not key:
        return _UNKNOWN_LEVEL
    mapped = _STATUS_ALIASES.get(key)
    if mapped is not None and mapped in _LEVEL_BY_KEY:
        return _LEVEL_BY_KEY[mapped]
    # A cell that is already a canonical key (re-normalized data).
    canonical = key.replace(" ", "-")
    if canonical in _LEVEL_BY_KEY:
        return _LEVEL_BY_KEY[canonical]
    for needle, level_key in _SUBSTRING_FALLBACKS:
        if needle in key:
            return _LEVEL_BY_KEY[level_key]
    return _UNKNOWN_LEVEL


# ── Aggregation ──────────────────────────────────────────────────────────────

AGGREGATION_NOTE: Final = (
    "Preservation status is normalized from a free-text corpus field onto a "
    "UNESCO-style vitality scale; blank/unrecognized entries are counted as "
    "'unknown', not living."
)

#: `computePreservationMetrics`'s default watchlist bound.
DEFAULT_WATCHLIST_LIMIT: Final = 25


def _speaker_count(language: Record) -> float | int | None:
    """Best available count: total → native → ``None``. A bool is not a number."""
    for key in ("totalSpeakers", "nativeSpeakers"):
        value = language.get(key)
        if not isinstance(value, bool) and isinstance(value, (int, float)):
            if value >= 0:
                return value
    return None


def _empty_category_counts() -> dict[str, int]:
    return {"living": 0, "endangered": 0, "extinct": 0, "unknown": 0}


def _endangerment_rate(counts: dict[str, int]) -> float | int:
    """endangered / (living + endangered) — the share of *still-spoken* at risk.

    A set with nothing still spoken answers the integer ``0``, which is what
    JavaScript's `return 0` puts on the wire; the division goes through
    :func:`~pinakes.analytics.jsmath.js_number` so an exact 1 does too.
    """
    still_spoken = counts["living"] + counts["endangered"]
    if still_spoken == 0:
        return 0
    return js_number(counts["endangered"] / still_spoken)


def _region_text(language: Record) -> str:
    """``(lang.region ?? "").trim()`` — nullish, so only an absent cell is blank."""
    region = language.get("region")
    return "" if region is None else _trim(region, "(lang.region ?? \"\")")


def compute_preservation_metrics(
    languages: list[Record], *, watchlist_limit: float | None = None
) -> Record:
    """Roll a language set up into the endangered-language dashboard payload."""
    limit = DEFAULT_WATCHLIST_LIMIT if watchlist_limit is None else watchlist_limit
    total = len(languages)

    by_category = _empty_category_counts()
    vitality_counts: dict[str, int] = {}
    region_counts: dict[str, dict[str, int]] = {}
    speakers_at_risk: float | int = 0
    endangered: list[Record] = []

    for language in languages:
        level = normalize_status(language.get("status"))
        by_category[level.category] += 1
        vitality_counts[level.key] = vitality_counts.get(level.key, 0) + 1

        region = _region_text(language) or "Unknown region"
        counts = region_counts.get(region)
        if counts is None:
            counts = _empty_category_counts()
            region_counts[region] = counts
        counts[level.category] += 1

        if level.category == "endangered":
            speakers = _speaker_count(language)
            if speakers is not None:
                # Accumulated in a loop, never `sum()`: since 3.12 the builtin
                # uses compensated summation, which is more accurate than
                # `Array.reduce` and therefore the wrong answer here.
                speakers_at_risk += speakers
            endangered.append(
                {
                    "id": language.get("id"),
                    "name": language.get("name"),
                    "region": _region_text(language) or None,
                    "vitalityKey": level.key,
                    "vitalityLabel": level.label,
                    "category": level.category,
                    "totalSpeakers": speakers,
                }
            )

    # The breakdown walks the risk ladder, keeping only levels that appear.
    vitality = [
        {
            "key": level.key,
            "label": level.label,
            "category": level.category,
            "count": vitality_counts[level.key],
            "share": js_number(vitality_counts[level.key] / total) if total > 0 else 0,
        }
        for level in VITALITY_LEVELS
        if vitality_counts.get(level.key, 0) > 0
    ]

    regions: list[Record] = [
        {
            "region": region,
            "total": counts["living"]
            + counts["endangered"]
            + counts["extinct"]
            + counts["unknown"],
            "living": counts["living"],
            "endangered": counts["endangered"],
            "extinct": counts["extinct"],
            "unknown": counts["unknown"],
            "endangermentRate": _endangerment_rate(counts),
        }
        for region, counts in region_counts.items()
    ]
    # `b.rate - a.rate || b.total - a.total || a.region.localeCompare(b.region)`.
    regions.sort(
        key=lambda row: (
            -row["endangermentRate"],
            -row["total"],
            locale_key(str(row["region"])),
        )
    )

    # Most-endangered still-spoken languages: highest risk, then fewest
    # speakers, then by name. An unknown count sorts *last* among equal ranks
    # (`?? Number.POSITIVE_INFINITY`), not first.
    watchlist = sorted(
        endangered,
        key=lambda row: (
            -_LEVEL_BY_KEY[str(row["vitalityKey"])].rank,
            math.inf if row["totalSpeakers"] is None else row["totalSpeakers"],
            locale_key(str(row["name"])),
        ),
    )[: int(limit)]

    return {
        "total": total,
        "classified": total - by_category["unknown"],
        "byCategory": by_category,
        "vitality": vitality,
        "endangermentRate": _endangerment_rate(by_category),
        "speakersAtRisk": js_number(speakers_at_risk),
        "regions": regions,
        "watchlist": watchlist,
        "note": AGGREGATION_NOTE,
    }


# ── Field-research update workflow ───────────────────────────────────────────

#: The updatable fields, in the order `changedFields` reports them.
UPDATABLE_FIELDS: Final[tuple[str, ...]] = (
    "status",
    "nativeSpeakers",
    "totalSpeakers",
    "region",
)


class FieldUpdateValidation(NamedTuple):
    valid: bool
    errors: list[str]
    warnings: list[str]


def _body(payload: Any) -> Record:
    """``(req.body ?? {})`` — a non-object body has no properties to read."""
    return payload if isinstance(payload, dict) else {}


def changed_fields(payload: Any) -> list[str]:
    """The fields an update actually proposes to change.

    ``value !== undefined && value !== null && String(value).trim() !== ""`` —
    so a count of `0` **is** a change (`String(0)` is `"0"`), and a `region` of
    `[]` is not (`String([])` is the empty string).
    """
    body = _body(payload)
    return [
        field
        for field in UPDATABLE_FIELDS
        if body.get(field) is not None and js_trim(js_string(body[field])) != ""
    ]


def validate_field_update(payload: Any) -> FieldUpdateValidation:
    """Attribution, a source, and one real change are all required."""
    body = _body(payload)
    errors: list[str] = []
    warnings: list[str] = []

    language_id = body.get("languageId")
    if (
        not js_truthy(language_id)
        or not isinstance(language_id, str)
        or not js_trim(language_id)
    ):
        errors.append("languageId is required")
    researcher = body.get("researcherName")
    if (
        not js_truthy(researcher)
        or not isinstance(researcher, str)
        or not js_trim(researcher)
    ):
        errors.append(
            "researcherName is required (field updates must be attributed)"
        )

    sources = body.get("sources")
    if not isinstance(sources, list) or len(sources) == 0:
        errors.append(
            "at least one source is required (field updates must be sourced)"
        )
    elif not any(
        isinstance(source, dict)
        and isinstance(source.get("title"), str)
        and js_trim(source["title"])
        for source in sources
    ):
        errors.append("at least one source must have a title")

    if not changed_fields(body):
        errors.append(
            "provide at least one changed field (status, nativeSpeakers, "
            "totalSpeakers, or region)"
        )

    status = body.get("status")
    if status is not None and js_trim(js_string(status)):
        if normalize_status(status).category == "unknown":
            warnings.append(
                f"status '{js_string(status)}' is not a recognized vitality "
                "level and will be recorded as-is"
            )

    for numeric in ("nativeSpeakers", "totalSpeakers"):
        value = body.get(numeric)
        if value is not None and (not is_finite_number(value) or value < 0):
            errors.append(f"{numeric} must be a non-negative number")

    # `!== undefined`, so an explicit `null` confidence is an **error** where an
    # absent one is not — the distinction `dict.get` cannot make.
    if "confidence" in body:
        confidence = body["confidence"]
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or confidence < 1
            or confidence > 100
        ):
            errors.append("confidence must be a number between 1 and 100")

    email = body.get("researcherEmail")
    if js_truthy(email) and not _EMAIL.fullmatch(js_string(email)):
        warnings.append("researcherEmail format appears invalid")

    return FieldUpdateValidation(
        valid=len(errors) == 0, errors=errors, warnings=warnings
    )


def field_update_summary(payload: Any) -> str:
    """The one-line human summary the changelog entry carries."""
    body = _body(payload)
    parts: list[str] = []

    if "status" in changed_fields(body):
        origin = _optional_trim(body.get("currentStatus"), "input.currentStatus")
        proposed = js_string(body.get("status"))
        parts.append(
            f"status {origin} → {proposed}" if origin else f"status → {proposed}"
        )
    # `!== undefined` again: a declared `null` renders as `→ null` rather than
    # being skipped, because that is what the template literal interpolates.
    if "totalSpeakers" in body:
        parts.append(f"total speakers → {js_string(body['totalSpeakers'])}")
    if "nativeSpeakers" in body:
        parts.append(f"native speakers → {js_string(body['nativeSpeakers'])}")
    if "region" in body and js_trim(js_string(body["region"])):
        parts.append(f"region → {js_string(body['region'])}")

    base = "; ".join(parts) if parts else "field-research update"
    return f"{base} (field research by {js_string(body.get('researcherName'))})"


def build_field_update_contribution(payload: Any) -> Record:
    """A validated field update as a `language` **edit** contribution.

    It rides the review pipeline rather than writing a TSV, and carries its
    provenance in `entityData` (`source: field-research`, `fieldResearch: true`).
    When exactly one field changed the per-field `fieldName`/`currentValue`/
    `suggestedValue` triple the review UI reads is filled in too.

    **The speaker counts and the confidence pass through
    :func:`~pinakes.analytics.jsmath.js_number` even though they came straight
    out of the request**, which is the one exception to that function's own
    rule. `JSON.parse` has a single number type, so a body carrying `1234.0`
    reaches the TypeScript as the double `1234` and is written back as `1234`;
    Python's `json` keeps the `float`, which would persist `1234.0` into a queue
    both servers read. The narrowing restores what the wire actually said.
    """
    body = _body(payload)
    language_name = body.get("languageName")
    name = _trim(
        body.get("languageId") if language_name is None else language_name,
        "(input.languageName ?? input.languageId)",
    )

    entity_data: Record = {
        "name": name,
        "source": "field-research",
        "fieldResearch": True,
    }
    status = body.get("status")
    if status is not None and js_trim(js_string(status)):
        entity_data["status"] = js_trim(js_string(status))
    if "nativeSpeakers" in body:
        entity_data["nativeSpeakers"] = js_number(body["nativeSpeakers"])
    if "totalSpeakers" in body:
        entity_data["totalSpeakers"] = js_number(body["totalSpeakers"])
    if "region" in body and js_trim(js_string(body["region"])):
        entity_data["region"] = js_trim(js_string(body["region"]))

    confidence = body.get("confidence")
    contribution: Record = {
        "entityType": "language",
        "action": "edit",
        "entityId": _trim(body.get("languageId"), "input.languageId"),
        "contributorName": _trim(body.get("researcherName"), "input.researcherName"),
        "contributorEmail": _optional_trim(
            body.get("researcherEmail"), "input.researcherEmail"
        )
        or None,
        "entityData": entity_data,
        "sources": body.get("sources"),
        "confidence": 60 if confidence is None else js_number(confidence),
        "notes": _optional_trim(body.get("notes"), "input.notes") or None,
    }

    changes = changed_fields(body)
    if len(changes) == 1:
        field = changes[0]
        contribution["fieldName"] = field
        if field == "status":
            contribution["currentValue"] = (
                _optional_trim(body.get("currentStatus"), "input.currentStatus")
                or None
            )
            contribution["suggestedValue"] = js_trim(js_string(body.get("status")))
        else:
            # NOT trimmed, alone among the four — `String(input[field])`.
            contribution["suggestedValue"] = js_string(body.get(field))

    return contribution
