"""One unified shape over six domains, and the pairwise relationship on it.

The port of `server/services/cross-domain-analysis.ts` — the six-domain
projection behind `GET /api/cross-domain/{search,connections,by-language,
by-time,summary,entities}`.

**This is the third projection of these TSVs and it must stay the third.**
:mod:`pinakes.analytics.correlation` has one for the correlation scorer and
:mod:`pinakes.authoring.candidates` has one for relationship suggestions; both
say in their own docstring that they are not this. The differences are small and
each one changes an answer:

* ``authoring.candidates`` drops ``nativeName``/``description`` (it ranks, it
  does not render) and appends the whole language corpus, which this projection
  never carries.
* ``analytics.correlation`` names the music domain ``music``, omits
  ``archaeological-site``, and reads a civilization without its GeoJSON
  ``timePeriod``.

Two rules in the projection below are load-bearing:

* **Which keys a branch omits is contract.** ``JSON.stringify`` drops an
  ``undefined`` value, so a haplogroup has *no* ``nativeName`` and *no*
  ``coordinates`` key at all, and a civilization has no ``region``,
  ``coordinates`` or ``description``. A client that tests ``"region" in entity``
  reads a different answer from one that tests truthiness, and both exist.
* **Only three of the six domains are filtered.** ``?year=`` and ``?region=``
  reach cuisines, music traditions and religions; haplogroups, civilizations and
  archaeological sites come back whole regardless. Kept as found — it is what
  makes ``/api/cross-domain/by-time/{year}`` answer with more than the dated
  domains.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from pinakes.analytics.jsmath import js_number
from pinakes.contributions.store import js_slice
from pinakes.lexicons import domains, storage

Record = dict[str, Any]

#: `EntityType`, in the order `getAllEntities` appends them. The last three are
#: the unfiltered domains.
ENTITY_TYPES: tuple[str, ...] = (
    "cuisine",
    "music-tradition",
    "religion",
    "haplogroup",
    "civilization",
    "archaeological-site",
)

#: The relationship strength below which `computeRelationship` answers `null`.
MIN_STRENGTH = 0.1

#: The temporal-overlap share below which the pair contributes no attribute.
MIN_OVERLAP_RATIO = 0.1


def _nullish(value: Any, fallback: Any) -> Any:
    """``value ?? fallback`` — a blank string is a value, not a fallback."""
    return fallback if value is None else value


def _feature_unified(feature: Record, entity_type: str, id_key: str) -> Record:
    """A civilization or site, read through its GeoJSON ``properties``.

    Both branches set ``description: undefined`` explicitly and set neither
    ``region`` nor ``coordinates``, so three keys are absent from the body. Only
    the civilization carries a ``nativeName``, and only when its row has one.
    """
    properties: Record = feature.get("properties") or {}
    time_period: Record = properties.get("timePeriod") or {}
    unified: Record = {
        "id": _nullish(feature.get("id"), properties.get(id_key)),
        "name": _nullish(properties.get("name"), feature.get("name")),
    }
    if entity_type == "civilization" and properties.get("nativeName") is not None:
        unified["nativeName"] = properties["nativeName"]
    unified["entityType"] = entity_type
    unified["timeOrigin"] = _nullish(time_period.get("start"), None)
    unified["timeEnd"] = _nullish(time_period.get("end"), None)
    unified["associatedLanguageIds"] = list(
        _nullish(properties.get("associatedLanguageIds"), [])
    )
    return unified


def _flat_unified(
    record: Record, entity_type: str, *, region_key: str, language_key: str
) -> Record:
    """A cuisine, music tradition or religion — every key present."""
    return {
        "id": record.get("id"),
        "name": record.get("name"),
        "nativeName": record.get("nativeName"),
        "entityType": entity_type,
        "region": record.get(region_key),
        "coordinates": record.get("coordinates"),
        "timeOrigin": record.get("timeOrigin"),
        "timeEnd": record.get("timeEnd"),
        "associatedLanguageIds": list(_nullish(record.get(language_key), [])),
        "description": record.get("description"),
    }


def _haplogroup_unified(record: Record) -> Record:
    """A haplogroup — no ``nativeName`` and no ``coordinates`` key.

    Its "languages" are language *family* ids, a different id space from every
    other domain here, so the shared-language signal only ever fires between two
    haplogroups.
    """
    return {
        "id": record.get("id"),
        "name": record.get("name"),
        "entityType": "haplogroup",
        "region": record.get("geographicOrigin"),
        "timeOrigin": record.get("timeOrigin"),
        "timeEnd": None,
        "associatedLanguageIds": list(
            _nullish(record.get("associatedLanguageFamilyIds"), [])
        ),
        "description": record.get("description"),
    }


def get_all_entities(
    lexicons: Path,
    *,
    year: float | None = None,
    region: str | None = None,
    types: list[str] | None = None,
) -> list[Record]:
    """``getAllEntities`` — the six domains projected onto one shape.

    ``types`` is ``None`` when the request named none (an absent *or blank*
    `?types=`, since `req.query.types ? … : undefined` is a truthiness test), and
    every domain is then included.
    """

    def wanted(entity_type: str) -> bool:
        return types is None or entity_type in types

    entities: list[Record] = []

    if wanted("cuisine"):
        entities.extend(
            _flat_unified(
                row,
                "cuisine",
                region_key="region",
                language_key="associatedLanguageIds",
            )
            for row in domains.filter_cuisines(
                storage.load_cuisines(lexicons), year=year, region=region
            )
        )

    if wanted("music-tradition"):
        entities.extend(
            _flat_unified(
                row,
                "music-tradition",
                region_key="region",
                language_key="associatedLanguageIds",
            )
            for row in domains.filter_music_traditions(
                storage.load_music_traditions(lexicons), year=year, region=region
            )
        )

    if wanted("religion"):
        entities.extend(
            _flat_unified(
                row,
                "religion",
                region_key="originRegion",
                language_key="associatedLanguageIds",
            )
            for row in domains.filter_religions(
                storage.load_religions(lexicons), year=year, region=region
            )
        )

    if wanted("haplogroup"):
        entities.extend(
            _haplogroup_unified(row) for row in storage.load_haplogroups(lexicons)
        )

    if wanted("civilization"):
        entities.extend(
            _feature_unified(feature, "civilization", "civilizationId")
            for feature in storage.load_civilizations(lexicons)
        )

    if wanted("archaeological-site"):
        entities.extend(
            _feature_unified(feature, "archaeological-site", "siteId")
            for feature in storage.load_archaeological_sites(lexicons)
        )

    return entities


def current_year() -> int:
    """``new Date().getFullYear()`` — the open end of an undated span."""
    return datetime.now().year


def compute_relationship(
    source: Record, target: Record, *, now_year: int
) -> Record | None:
    """The pairwise relationship, or ``None`` when it is too weak to report.

    Three signals accumulate into one strength: shared languages (capped at
    0.6), a *substring-either-way* region match (a flat 0.2) and a temporal
    overlap scaled by the longer of the two spans (up to 0.2). Below
    :data:`MIN_STRENGTH` the pair is not a relationship at all.
    """
    shared_attributes: list[str] = []
    strength = 0.0

    source_languages: list[str] = source.get("associatedLanguageIds") or []
    target_languages: list[str] = target.get("associatedLanguageIds") or []
    # `.filter(...)` over the *source* list, so a language named twice there is
    # counted twice — including in the joined attribute text.
    shared = [
        language for language in source_languages if language in target_languages
    ]
    if shared:
        shared_attributes.append(f"shared languages: {', '.join(shared)}")
        strength += min(len(shared) * 0.2, 0.6)

    source_region = source.get("region")
    target_region = target.get("region")
    if source_region and target_region:
        lowered_source = str(source_region).lower()
        lowered_target = str(target_region).lower()
        if (
            lowered_source == lowered_target
            or lowered_target in lowered_source
            or lowered_source in lowered_target
        ):
            shared_attributes.append(f"shared region: {source_region}")
            strength += 0.2

    source_origin = source.get("timeOrigin")
    target_origin = target.get("timeOrigin")
    if source_origin is not None and target_origin is not None:
        source_end = _nullish(source.get("timeEnd"), now_year)
        target_end = _nullish(target.get("timeEnd"), now_year)
        overlap_start = max(source_origin, target_origin)
        overlap_end = min(source_end, target_end)
        if overlap_start <= overlap_end:
            overlap_years = overlap_end - overlap_start
            max_span = max(
                source_end - source_origin, target_end - target_origin, 1
            )
            overlap_ratio = min(overlap_years / max_span, 1)
            if overlap_ratio > MIN_OVERLAP_RATIO:
                shared_attributes.append(
                    f"temporal overlap: {overlap_years} years"
                )
                strength += overlap_ratio * 0.2

    if strength < MIN_STRENGTH:
        return None

    relationship_type = "cultural-proximity"
    if any(a.startswith("shared languages") for a in shared_attributes):
        relationship_type = "shared-language"
    elif any(a.startswith("shared region") for a in shared_attributes):
        relationship_type = "shared-region"
    elif any(a.startswith("temporal") for a in shared_attributes):
        relationship_type = "temporal-overlap"

    return {
        "source": source,
        "target": target,
        "relationshipType": relationship_type,
        "strength": js_number(min(strength, 1)),
        "sharedAttributes": shared_attributes,
    }


def find_connections(
    entities: list[Record],
    entity_id: str,
    entity_type: str,
    max_results: float,
    *,
    now_year: int,
) -> list[Record]:
    """``findConnections`` — every scoring partner, strongest first.

    An unknown ``(id, type)`` pair is an **empty list**, not a 404: the route has
    no way to tell "no such entity" from "nothing connects to it", and neither
    did Express.
    """
    source = next(
        (
            entity
            for entity in entities
            if entity.get("id") == entity_id
            and entity.get("entityType") == entity_type
        ),
        None,
    )
    if source is None:
        return []

    relationships: list[Record] = []
    for target in entities:
        if (
            target.get("id") == source.get("id")
            and target.get("entityType") == source.get("entityType")
        ):
            continue
        relationship = compute_relationship(source, target, now_year=now_year)
        if relationship is not None:
            relationships.append(relationship)

    # `sort((a, b) => b.strength - a.strength)` is V8's stable sort, and
    # `reverse=True` does not reverse ties here either — equal strengths keep
    # the order `getAllEntities` produced them in.
    relationships.sort(key=lambda item: float(item["strength"]), reverse=True)
    return _js_head(relationships, max_results)


def _js_head(items: list[Record], limit: float) -> list[Record]:
    """``items.slice(0, limit)`` — a `NaN` limit is an *empty* slice."""
    return list(js_slice(list(items), 0, limit))


def search_entities(
    entities: list[Record], query: str, limit: float
) -> list[Record]:
    """``search`` — a weighted substring scan, highest score first.

    The weights are name 3, native name 2, and one apiece for description,
    region, an associated language id and the entity's own id. Note the language
    and id tests compare against the **lower-cased query** without lower-casing
    the value, which is the TypeScript's asymmetry and not a slip.
    """
    lowered = query.lower()
    scored: list[tuple[int, Record]] = []
    for entity in entities:
        score = 0
        if lowered in str(entity.get("name") or "").lower():
            score += 3
        native = entity.get("nativeName")
        if native is not None and lowered in str(native).lower():
            score += 2
        description = entity.get("description")
        if description is not None and lowered in str(description).lower():
            score += 1
        region = entity.get("region")
        if region is not None and lowered in str(region).lower():
            score += 1
        if any(
            lowered in language
            for language in (entity.get("associatedLanguageIds") or [])
        ):
            score += 1
        if lowered in str(entity.get("id") or ""):
            score += 1
        if score > 0:
            scored.append((score, entity))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return _js_head([entity for _, entity in scored], limit)


def find_by_language(entities: list[Record], language_id: str) -> list[Record]:
    """``findByLanguage`` — every entity naming this language id."""
    return [
        entity
        for entity in entities
        if language_id in (entity.get("associatedLanguageIds") or [])
    ]


def summarize(entities: list[Record]) -> Record:
    """``getSummary`` — counts, distinct languages and the origin-year range.

    ``temporalRange`` is over ``timeOrigin`` **only** — an entity's end year
    never widens it — and an entity set with no dated member reports
    ``{min: 0, max: 0}`` rather than infinities.
    """
    by_type: dict[str, int] = {}
    min_time: float | None = None
    max_time: float | None = None
    languages: set[str] = set()

    for entity in entities:
        entity_type = str(entity.get("entityType"))
        by_type[entity_type] = by_type.get(entity_type, 0) + 1
        origin = entity.get("timeOrigin")
        if origin is not None:
            min_time = origin if min_time is None else min(min_time, origin)
            max_time = origin if max_time is None else max(max_time, origin)
        languages.update(entity.get("associatedLanguageIds") or [])

    return {
        "totalEntities": len(entities),
        "byType": by_type,
        "languageCoverage": len(languages),
        "temporalRange": {
            "min": 0 if min_time is None else min_time,
            "max": 0 if max_time is None else max_time,
        },
    }


__all__ = [
    "ENTITY_TYPES",
    "compute_relationship",
    "current_year",
    "find_by_language",
    "find_connections",
    "get_all_entities",
    "search_entities",
    "summarize",
]
