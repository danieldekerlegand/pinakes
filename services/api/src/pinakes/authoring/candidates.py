"""The candidate pool relationship suggestions are ranked over.

The port of `defaultLoadEntities` in `server/routes/relationship-suggestions.ts`
— which is `CrossDomainAnalysis.getAllEntities()` (six domains, projected onto
one `UnifiedEntity` shape) plus the language corpus appended.

**Not `analytics.correlation.load_domain`, deliberately.** That projection
serves the correlation scorer and differs in three ways that would change what
gets suggested: it names the music domain `music` rather than `music-tradition`,
it drops `archaeological-site` entirely, and it gives a civilization no region
or coordinates where the GeoJSON projection carries a `timePeriod`. Two
projections of the same TSVs is the cost of two consumers whose contracts differ;
collapsing them would silently re-rank one of them.

A language is listed as **associated with itself** (``languageIds == [id]``).
That is what links it to the cuisines, religions and music traditions that name
it in `associated_language_ids` — without it the linguistic signal could never
fire between a language and anything else.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from pinakes.analytics import corpus
from pinakes.authoring.relationship_edge import ExistingEdge
from pinakes.authoring.suggestions import SuggestionEntity
from pinakes.lexicons import canonical_edges, storage

#: The leading signed integer `String.prototype.match(/-?\\d+/)` finds anywhere
#: in a loose date string.
_YEARISH = re.compile(r"-?\d+")

#: A BCE marker in any of the spellings the corpus's free-text dates use.
_BCE = re.compile(r"\bb\.?c\.?(e)?\b", re.IGNORECASE)


def parse_yearish(value: Any) -> float | None:
    """A signed year out of a loose date string (`"500 BC"`, `"-500"`, `"1200"`).

    A number passes through (when finite); anything else is scanned for the
    first integer, negated when the string also carries a BCE marker and the
    integer is positive.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if not isinstance(value, str):
        return None
    match = _YEARISH.search(value)
    if match is None:
        return None
    year = float(match.group(0))
    if _BCE.search(value) and year > 0:
        year = -year
    return year


def _feature_entity(
    feature: dict[str, Any], entity_type: str, id_key: str
) -> SuggestionEntity:
    """A GeoJSON civilization/site feature, read through ``.properties``.

    ``toUnified`` reached for `entity.id ?? entity.properties.<idKey>`; the
    loader sets both to the same value, so either read is the same id.
    """
    properties: dict[str, Any] = feature.get("properties") or {}
    time_period: dict[str, Any] = properties.get("timePeriod") or {}
    return SuggestionEntity(
        id=str(feature.get("id") or properties.get(id_key) or ""),
        name=str(properties.get("name") or feature.get("name") or ""),
        entity_type=entity_type,
        language_ids=list(properties.get("associatedLanguageIds") or []),
        # A civilization/site feature carries no point coordinate on the
        # unified shape — `toUnified` never set one for either type.
        coordinates=None,
        time_start=time_period.get("start"),
        time_end=time_period.get("end"),
        region=None,
    )


def load_candidates(lexicons: Path) -> list[SuggestionEntity]:
    """Every entity a suggestion may be ranked against, in `getAllEntities` order."""
    entities: list[SuggestionEntity] = []

    for cuisine in corpus.load_cuisines(lexicons):
        entities.append(
            SuggestionEntity(
                id=cuisine.id,
                name=cuisine.name,
                entity_type="cuisine",
                language_ids=list(cuisine.associated_language_ids),
                coordinates=cuisine.coordinates,
                time_start=cuisine.time_origin,
                time_end=cuisine.time_end,
                region=cuisine.region,
            )
        )

    for music in corpus.load_music_traditions(lexicons):
        entities.append(
            SuggestionEntity(
                id=music.id,
                name=music.name,
                entity_type="music-tradition",
                language_ids=list(music.associated_language_ids),
                coordinates=music.coordinates,
                time_start=music.time_origin,
                time_end=music.time_end,
                region=music.region,
            )
        )

    for religion in corpus.load_religions(lexicons):
        entities.append(
            SuggestionEntity(
                id=religion.id,
                name=religion.name,
                entity_type="religion",
                language_ids=list(religion.associated_language_ids),
                coordinates=religion.coordinates,
                # `toUnified` reads a religion's region from `originRegion`.
                time_start=religion.time_origin,
                time_end=religion.time_end,
                region=religion.origin_region,
            )
        )

    for haplogroup in corpus.load_haplogroups(lexicons):
        entities.append(
            SuggestionEntity(
                id=haplogroup.id,
                name=haplogroup.name,
                entity_type="haplogroup",
                # A haplogroup's "languages" are language *families* — a
                # different id space, so this signal only fires against another
                # family-keyed haplogroup.
                language_ids=list(haplogroup.associated_language_family_ids),
                coordinates=None,
                time_start=haplogroup.time_origin,
                time_end=None,
                region=haplogroup.geographic_origin,
            )
        )

    entities.extend(
        _feature_entity(feature, "civilization", "civilizationId")
        for feature in storage.load_civilizations(lexicons)
    )
    entities.extend(
        _feature_entity(feature, "archaeological-site", "siteId")
        for feature in storage.load_archaeological_sites(lexicons)
    )

    for language in storage.load_languages(lexicons):
        entities.append(
            SuggestionEntity(
                id=str(language["id"]),
                name=str(language["name"]),
                entity_type="language",
                language_ids=[str(language["id"])],
                coordinates=language.get("coordinates"),
                time_start=parse_yearish(language.get("timeOrigin")),
                time_end=parse_yearish(language.get("timeEnd")),
                region=language.get("region"),
            )
        )

    return entities


def load_existing_edges(lexicons: Path) -> list[ExistingEdge]:
    """The corpus's canonical edges as suggestion exclusions.

    Defensive by contract: a missing or partial lexicons directory must not 500
    the suggestions endpoint — the worst case is no exclusions, so nothing is
    filtered.
    """
    try:
        extraction = canonical_edges.extract_all_canonical_edges(lexicons)
    except Exception:  # noqa: BLE001 - `console.warn` + [] on the Express side
        return []
    return [
        ExistingEdge(
            source_id=edge.start_id,
            target_id=edge.end_id,
            relationship_type=edge.edge_name,
        )
        for edge in extraction.edges
    ]


__all__ = ["load_candidates", "load_existing_edges", "parse_yearish"]
