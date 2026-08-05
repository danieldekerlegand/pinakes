"""A pasted Wikipedia/Wikidata URL → one reviewable entity draft.

The port of `server/services/url-extractor.ts` (pinakes:64 US-1). A single URL
is a single entity, so it is resolved through Wikidata's **single-entity REST
endpoint** (``Special:EntityData/<QID>.json``) rather than the SPARQL query
service — bulk set acquisition is :mod:`pinakes.engine.acquisition`'s job and
stays there. The statement → field vocabulary is deliberately the same one
:mod:`pinakes_engine.acquire.wikidata_hydration` uses, so a draft made here
carries the fields a bulk-acquired row would.

The draft is a plain ``dict`` in the *client's* spelling (``camelCase``,
``{value, confidence}`` per field), for the same reason
:data:`pinakes.contributions.store.Contribution` is: it is a response body and a
queue record, and it already has an authority in
`contracts/parity/openapi.json`. Keys that are absent stay absent — the
TypeScript builds these objects with optional properties that ``JSON.stringify``
drops, and a queued draft has to round-trip through the TypeScript reader
unchanged during the cutover.
"""

from __future__ import annotations

import re
from typing import Any, Literal, Protocol
from urllib.parse import quote, unquote, urlsplit

from pinakes.analytics.jsmath import js_round
from pinakes.ingest import http

#: Where the draft came from.
SourceKind = Literal["wikidata", "wikipedia"]

#: An entity draft, or one Wikidata entity payload, as JSON.
Draft = dict[str, Any]

_QID = re.compile(r"^Q\d+$")
_QID_IN_PATH = re.compile(r"(Q\d+)")
_WIKIDATA_TIME = re.compile(r"^([+-])(\d+)-")

#: Properties whose object QID becomes a suggested relationship, with a label.
#: Insertion order is part of the contract — relationships come back in it.
RELATIONSHIP_PROPERTIES: dict[str, str] = {
    "P279": "subclass-of",  # parent class
    "P31": "instance-of",
    "P144": "based-on",  # → derived_from (genetic linker)
    "P737": "influenced-by",
    "P17": "country",
    "P276": "location",
    "P495": "country-of-origin",
    "P361": "part-of",
    "P527": "has-part",
    "P155": "follows",
    "P156": "followed-by",
}

#: Properties carrying a start year (inception, date of birth).
START_YEAR_PROPERTIES = ("P571", "P569")

#: Properties carrying an end year (dissolved/abolished, date of death).
END_YEAR_PROPERTIES = ("P576", "P570")

#: `entityType`s a caller may file a draft under. Every one is safe to queue
#: from a URL alone: their required fields are covered by `name`.
ALLOWED_ENTITY_TYPES = (
    "civilization",
    "archaeological-site",
    "language",
    "religion",
    "cuisine",
    "music-tradition",
)

#: The type a draft is filed under when the caller names none.
DEFAULT_ENTITY_TYPE = "civilization"


class UrlExtractionError(Exception):
    """An unusable URL, or a source that could not be resolved (→ 400)."""


class ParsedSource:
    """A classified paste: a Wikidata QID, or a Wikipedia language + title."""

    __slots__ = ("kind", "lang", "qid", "title")

    def __init__(
        self,
        kind: SourceKind,
        *,
        qid: str | None = None,
        lang: str | None = None,
        title: str | None = None,
    ) -> None:
        self.kind = kind
        self.qid = qid
        self.lang = lang
        self.title = title


def parse_source_url(raw: str) -> ParsedSource:
    """Classify a pasted URL as Wikidata (→ QID) or Wikipedia (→ lang + title).

    ``new URL(...)`` throws on anything without a scheme and a host, and
    :func:`urllib.parse.urlsplit` throws on nothing at all — so the two checks
    below are what stand in for that constructor. The refusal messages are the
    TypeScript's verbatim: they are shown to whoever pasted the URL.
    """
    trimmed = (raw or "").strip()
    if not trimmed:
        raise UrlExtractionError("A url is required")

    try:
        url = urlsplit(trimmed)
        host = (url.hostname or "").lower()
    except ValueError as error:  # a malformed IPv6 literal, chiefly
        raise UrlExtractionError(f"Not a valid URL: {trimmed}") from error
    if not url.scheme or not host:
        raise UrlExtractionError(f"Not a valid URL: {trimmed}")

    # Wikidata: /wiki/Q42, /entity/Q42, /wiki/Special:EntityData/Q42
    if host in ("www.wikidata.org", "wikidata.org"):
        match = _QID_IN_PATH.search(url.path)
        if match is None:
            raise UrlExtractionError(f"No Wikidata QID found in {trimmed}")
        return ParsedSource("wikidata", qid=match.group(1))

    # Wikipedia: <lang>.wikipedia.org/wiki/<Title>
    if host.endswith(".wikipedia.org"):
        lang = host.split(".")[0] or "en"
        prefix = "/wiki/"
        if not url.path.startswith(prefix):
            raise UrlExtractionError(f"Not a Wikipedia article URL: {trimmed}")
        raw_title = url.path[len(prefix) :]
        if not raw_title:
            raise UrlExtractionError(f"No article title in {trimmed}")
        # `unquote` never raises on a bad escape — it leaves the bytes alone,
        # which is the same answer the TypeScript's try/catch fallback gave.
        return ParsedSource(
            "wikipedia", lang=lang, title=unquote(raw_title).replace("_", " ")
        )

    raise UrlExtractionError(
        f"Unsupported source. Paste a Wikipedia or Wikidata URL (got host {host})."
    )


# ── The injectable network boundary ──────────────────────────────────────────


class UrlExtractorDeps(Protocol):
    """Wikidata/Wikipedia, behind an interface. Tests pass a fixture-backed fake."""

    def fetch_wikidata_entity(self, qid: str) -> Draft:
        """One Wikidata entity by QID (REST, never SPARQL)."""
        ...

    def fetch_wikipedia_page(self, lang: str, title: str) -> Draft:
        """An article's Wikidata item + summary: ``{title, lang, qid?, …}``."""
        ...


class LiveDeps:
    """The real Wikidata/Wikipedia REST endpoints, through the engine's client."""

    def fetch_wikidata_entity(self, qid: str) -> Draft:
        response = http.client(http.WIKIMEDIA).get(
            f"https://www.wikidata.org/wiki/Special:EntityData/{quote_qid(qid)}.json"
        )
        if response.status_code >= 400:
            raise UrlExtractionError(
                f"Wikidata returned {response.status_code} for {qid}"
            )
        payload = http.read_json(response, context="Wikidata")
        entities = payload.get("entities") if isinstance(payload, dict) else None
        entity = entities.get(qid) if isinstance(entities, dict) else None
        if not isinstance(entity, dict):
            raise UrlExtractionError(f"Wikidata entity {qid} not found")
        return entity

    def fetch_wikipedia_page(self, lang: str, title: str) -> Draft:
        # The REST summary endpoint carries wikibase_item + extract + coordinates.
        slug = quote_title(title)
        response = http.client(http.WIKIMEDIA).get(
            f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{slug}"
        )
        if response.status_code >= 400:
            raise UrlExtractionError(
                f"Wikipedia returned {response.status_code} for {title}"
            )
        payload = http.read_json(response, context="Wikipedia")
        if not isinstance(payload, dict):
            raise UrlExtractionError(f"Wikipedia returned no page for {title}")
        page: Draft = {"title": payload.get("title") or title, "lang": lang}
        if isinstance(payload.get("wikibase_item"), str):
            page["qid"] = payload["wikibase_item"]
        if isinstance(payload.get("extract"), str):
            page["extract"] = payload["extract"]
        coordinates = payload.get("coordinates")
        if isinstance(coordinates, dict) and "lat" in coordinates:
            # Wikipedia says `lon`; every coordinate in this codebase says `lng`.
            page["coordinates"] = {
                "lat": coordinates["lat"],
                "lng": coordinates.get("lon"),
            }
        return page


def live_deps() -> UrlExtractorDeps:
    """The live boundary. A function, so a configured client is picked up per call."""
    return LiveDeps()


def quote_qid(qid: str) -> str:
    """``encodeURIComponent(qid)`` — a QID has nothing to escape, but say so."""
    return quote(qid, safe="")


def quote_title(title: str) -> str:
    """A Wikipedia title as the REST endpoint wants it: underscores, escaped."""
    return quote(title.replace(" ", "_"), safe="")


# ── Statement → draft (pure) ─────────────────────────────────────────────────


def parse_wikidata_year(time: str | None) -> int | None:
    """A Wikidata ``time`` (``+1979-01-01T00:00:00Z``) → a signed year.

    ``-0044-…`` is 44 BCE, so the sign is carried through; anything that does not
    start with a signed year is ``None``.
    """
    if not time:
        return None
    match = _WIKIDATA_TIME.match(time)
    if match is None:
        return None
    sign = -1 if match.group(1) == "-" else 1
    return sign * int(match.group(2), 10)


def _claims(entity: Draft, prop: str) -> list[Any]:
    claims = entity.get("claims")
    found = claims.get(prop) if isinstance(claims, dict) else None
    return found if isinstance(found, list) else []


def _snak_value(claim: Any) -> dict[str, Any] | None:
    """``claim.mainsnak.datavalue.value``, or ``None`` all the way down."""
    if not isinstance(claim, dict):
        return None
    mainsnak = claim.get("mainsnak")
    datavalue = mainsnak.get("datavalue") if isinstance(mainsnak, dict) else None
    value = datavalue.get("value") if isinstance(datavalue, dict) else None
    return value if isinstance(value, dict) else None


def _first_snak_value(entity: Draft, prop: str) -> dict[str, Any] | None:
    claims = _claims(entity, prop)
    return _snak_value(claims[0]) if claims else None


def pick_label(labels: Any, preferred: str = "en") -> str | None:
    """The preferred-language label, else whichever language comes first."""
    if not isinstance(labels, dict):
        return None
    chosen = labels.get(preferred)
    if isinstance(chosen, dict) and chosen.get("value"):
        value: Any = chosen["value"]
        return value if isinstance(value, str) else None
    for entry in labels.values():
        if isinstance(entry, dict) and isinstance(entry.get("value"), str):
            first: str = entry["value"]
            return first
    return None


def draft_from_wikidata_entity(
    entity: Draft,
    *,
    kind: SourceKind,
    source_url: str,
    fallback_name: str | None = None,
    description_override: str | None = None,
    label_hints: dict[str, str] | None = None,
) -> Draft:
    """Map one fetched entity's statements into a draft. Pure — no network."""
    label = pick_label(entity.get("labels"))
    name = label or fallback_name or entity.get("id")
    # A verbatim label is high-confidence; a Wikipedia-title fallback less so.
    name_confidence = 0.98 if label else (0.8 if fallback_name else 0.5)

    draft: Draft = {
        "kind": kind,
        "wikidataQid": entity.get("id"),
        "sourceUrl": source_url,
        "name": {"value": name, "confidence": name_confidence},
        "relationships": [],
        "aiGenerated": True,
        "autoDerived": True,
    }

    description = description_override or pick_label(entity.get("descriptions"))
    if description:
        draft["description"] = {
            "value": description,
            "confidence": 0.85 if description_override else 0.8,
        }

    # Coordinates — P625 globecoordinate.
    coordinate = _first_snak_value(entity, "P625")
    if coordinate is not None and _is_number(
        coordinate.get("latitude")
    ) and _is_number(coordinate.get("longitude")):
        draft["coordinates"] = {
            "value": {
                "lat": coordinate["latitude"],
                "lng": coordinate["longitude"],
            },
            "confidence": 0.9,
        }

    # Dates — the first available start/end property wins.
    for prop in START_YEAR_PROPERTIES:
        year = parse_wikidata_year(_time_of(entity, prop))
        if year is not None:
            draft["timePeriodStart"] = {"value": year, "confidence": 0.85}
            break
    for prop in END_YEAR_PROPERTIES:
        year = parse_wikidata_year(_time_of(entity, prop))
        if year is not None:
            draft["timePeriodEnd"] = {"value": year, "confidence": 0.85}
            break

    # Relationships — every mapped property, in declaration order, deduped on
    # (property, target).
    seen: set[str] = set()
    relationships: list[Draft] = draft["relationships"]
    for prop, label_for in RELATIONSHIP_PROPERTIES.items():
        for claim in _claims(entity, prop):
            value = _snak_value(claim)
            target = value.get("id") if value is not None else None
            if not isinstance(target, str) or _QID.match(target) is None:
                continue
            key = f"{prop}:{target}"
            if key in seen:
                continue
            seen.add(key)
            relationships.append(
                {
                    "type": label_for,
                    "property": prop,
                    "targetQid": target,
                    "targetLabel": (label_hints or {}).get(target, target),
                    "confidence": 0.75,
                }
            )

    return draft


def _time_of(entity: Draft, prop: str) -> str | None:
    value = _first_snak_value(entity, prop)
    time = value.get("time") if value is not None else None
    return time if isinstance(time, str) else None


def _is_number(value: Any) -> bool:
    """``typeof value === "number"`` — and a JS boolean is not a number."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# ── Orchestration ────────────────────────────────────────────────────────────


def wikidata_entity_url(qid: str) -> str:
    return f"https://www.wikidata.org/wiki/{qid}"


def wikipedia_article_url(lang: str, title: str) -> str:
    return f"https://{lang}.wikipedia.org/wiki/{quote_title(title)}"


def extract_draft_from_url(raw_url: str, deps: UrlExtractorDeps) -> Draft:
    """Resolve a pasted URL into a draft.

    A Wikipedia URL is resolved to its Wikidata item first and extracted from
    *that* — the article is the entry point, the item is the data. A page with
    no item still yields a draft, synthesized from the summary alone, rather
    than a refusal.
    """
    parsed = parse_source_url(raw_url)

    if parsed.kind == "wikidata":
        qid = parsed.qid or ""
        entity = deps.fetch_wikidata_entity(qid)
        return draft_from_wikidata_entity(
            entity, kind="wikidata", source_url=wikidata_entity_url(qid)
        )

    lang = parsed.lang or "en"
    title = parsed.title or ""
    page = deps.fetch_wikipedia_page(lang, title)
    source_url = wikipedia_article_url(lang, title)

    qid = page.get("qid") or ""
    if qid:
        entity = deps.fetch_wikidata_entity(qid)
        return draft_from_wikidata_entity(
            entity,
            kind="wikipedia",
            source_url=source_url,
            fallback_name=page.get("title"),
            description_override=page.get("extract"),
        )

    draft: Draft = {
        "kind": "wikipedia",
        "sourceUrl": source_url,
        "name": {"value": page.get("title"), "confidence": 0.8},
        "relationships": [],
        "aiGenerated": True,
        "autoDerived": True,
    }
    if page.get("extract"):
        draft["description"] = {"value": page["extract"], "confidence": 0.7}
    if page.get("coordinates"):
        draft["coordinates"] = {"value": page["coordinates"], "confidence": 0.85}
    return draft


# ── Draft → contribution ─────────────────────────────────────────────────────


def overall_confidence(draft: Draft) -> int:
    """The mean of the present field confidences, on the queue's 1..100 scale.

    Capped at 99, never 100: an auto-derived draft is always something a
    reviewer still has to look at.

    The mean is accumulated in a loop rather than with :func:`sum`, which since
    3.12 uses compensated summation — *more* accurate than ``Array.reduce`` and
    therefore a different number than the TypeScript's in the last digit, which
    :func:`~pinakes.analytics.jsmath.js_round` can turn into a different score
    (`services/api/CLAUDE.md`).
    """
    scores = [draft["name"]["confidence"]]
    for field in ("description", "coordinates", "timePeriodStart", "timePeriodEnd"):
        if field in draft:
            scores.append(draft[field]["confidence"])
    for relationship in draft["relationships"]:
        scores.append(relationship["confidence"])
    total = 0.0
    for score in scores:
        total += score
    return max(1, min(99, js_round(total / len(scores) * 100)))


def draft_to_contribution(
    draft: Draft,
    *,
    entity_type: str | None = None,
    contributor_name: str | None = None,
    contributor_email: str | None = None,
) -> Draft:
    """A draft as a queue submission: pending, flagged, never a live write."""
    per_field: dict[str, float] = {"name": draft["name"]["confidence"]}
    for field in ("description", "coordinates", "timePeriodStart", "timePeriodEnd"):
        if field in draft:
            per_field[field] = draft[field]["confidence"]

    entity_data: Draft = {
        "name": draft["name"]["value"],
        "source": "auto-derived",
        "aiGenerated": True,
        "autoDerived": True,
        "provenanceKind": draft["kind"],
        "sourceUrl": draft["sourceUrl"],
        "relationships": draft["relationships"],
        "perFieldConfidence": per_field,
    }
    # Absent, not null: the TypeScript wrote `wikidataQid: draft.wikidataQid`
    # and `JSON.stringify` dropped the key when the page had no item.
    if draft.get("wikidataQid"):
        entity_data["wikidataQid"] = draft["wikidataQid"]
    for field in ("description", "coordinates", "timePeriodStart", "timePeriodEnd"):
        if field in draft:
            entity_data[field] = draft[field]["value"]

    title = (
        f"Wikidata {draft.get('wikidataQid') or ''}".strip()
        if draft["kind"] == "wikidata"
        else f"Wikipedia: {draft['name']['value']}"
    )
    return {
        # `opts.entityType ?? "civilization"` — *nullish*, not truthy: a caller
        # that sent `entityType: ""` gets it back and the queue rejects it,
        # which is a clearer answer than silently filing it as a civilization.
        "entityType": (
            entity_type if entity_type is not None else DEFAULT_ENTITY_TYPE
        ),
        "action": "add",
        "entityData": entity_data,
        "sources": [{"title": title, "url": draft["sourceUrl"]}],
        "confidence": overall_confidence(draft),
        "contributorName": contributor_name,
        "contributorEmail": contributor_email,
        "notes": "Auto-derived draft from a pasted URL — review before promoting.",
    }


__all__ = [
    "ALLOWED_ENTITY_TYPES",
    "DEFAULT_ENTITY_TYPE",
    "END_YEAR_PROPERTIES",
    "RELATIONSHIP_PROPERTIES",
    "START_YEAR_PROPERTIES",
    "Draft",
    "LiveDeps",
    "ParsedSource",
    "SourceKind",
    "UrlExtractionError",
    "UrlExtractorDeps",
    "draft_from_wikidata_entity",
    "draft_to_contribution",
    "extract_draft_from_url",
    "live_deps",
    "overall_confidence",
    "parse_source_url",
    "parse_wikidata_year",
    "pick_label",
    "wikidata_entity_url",
    "wikipedia_article_url",
]
