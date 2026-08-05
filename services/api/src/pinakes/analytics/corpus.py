"""The corpus rows the analytics engines read, and nothing else.

`server/tsv-storage.ts` parses ~60 files into fully-typed records; the four
computations ported here read nine of them, for the columns they actually score
on. This module is that slice — the same discipline
:mod:`pinakes.collab.citable` follows, and for the same reason: the general
corpus reader is its own port unit (`tasks/chief/63-port-entity-search.json`)
and neither of these is a head start on it.

Two shapes of the TypeScript loaders are reproduced rather than tidied, because
both are observable through the API:

* **A missing coordinate is the origin, not nothing.** ``loadCuisines`` /
  ``loadMusicTraditions`` / ``loadReligions`` default ``coordinates`` to
  ``{lat: 0, lng: 0}`` and the correlation loaders read them through ``?? null``,
  which does not replace an object. So a row with a blank coordinate cell scores
  geographic proximity *at Null Island* rather than dropping out. It changes what
  `/api/cross-domain/correlate` returns, so the port keeps it. (``languages.tsv``
  is the exception: it yields a real ``None`` when either latitude or longitude
  fails to parse.)
* **A language row without a family is not a language.** ``loadScrapedLanguages``
  requires `id`, `name` *and* `family_id`, so an unclassified row is absent from
  every downstream count.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from pinakes.analytics import tsv

#: What a blank/unparseable coordinate cell means to the loaders that have one.
ORIGIN: dict[str, float] = {"lat": 0.0, "lng": 0.0}


@dataclass(frozen=True)
class Language:
    id: str
    name: str
    family_id: str
    region: str | None
    coordinates: dict[str, float] | None


@dataclass(frozen=True)
class LanguageFamily:
    id: str
    name: str
    region: str | None


@dataclass(frozen=True)
class Cuisine:
    id: str
    name: str
    region: str
    coordinates: dict[str, float]
    associated_language_ids: list[str]
    time_origin: int | None
    time_end: int | None


@dataclass(frozen=True)
class MusicTradition:
    id: str
    name: str
    region: str
    coordinates: dict[str, float]
    associated_language_ids: list[str]
    time_origin: int | None
    time_end: int | None
    instruments: list[str] = field(default_factory=list)
    scales: list[str] = field(default_factory=list)
    rhythmic_patterns: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Religion:
    id: str
    name: str
    origin_region: str
    coordinates: dict[str, float]
    associated_language_ids: list[str]
    time_origin: int | None
    time_end: int | None


@dataclass(frozen=True)
class Haplogroup:
    id: str
    name: str
    haplogroup_type: str
    associated_language_family_ids: list[str]
    associated_civilization_ids: list[str]
    geographic_origin: str
    time_origin: int | None


@dataclass(frozen=True)
class Civilization:
    id: str
    name: str
    associated_language_ids: list[str]
    time_start: int
    time_end: int | None


@dataclass(frozen=True)
class ArtTradition:
    id: str
    name: str
    category: str
    origin_coordinates: dict[str, float]
    associated_civilizations: str
    associated_languages: list[str]
    key_features: list[str]
    notable_examples: list[str]


@dataclass(frozen=True)
class MaterialCulture:
    id: str
    name: str
    category: str
    origin_coordinates: list[float]
    associated_languages: list[str]


def _coordinates(row: list[str], index: int) -> dict[str, float]:
    """A ``{"lat": …, "lng": …}`` cell, defaulting to the origin (see the header)."""
    parsed = tsv.json_cell(row, index, None)
    if not isinstance(parsed, dict):
        return dict(ORIGIN)
    return {
        "lat": float(parsed.get("lat", 0) or 0),
        "lng": float(parsed.get("lng", 0) or 0),
    }


def load_languages(lexicons: Path) -> list[Language]:
    """`languages.tsv`. A row without id/name/family_id is skipped entirely."""
    parsed = tsv.read_tsv(lexicons, "languages.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    family_index = tsv.required_index(header, "family_id")
    region_index = tsv.index_of(header, "region")
    lat_index = tsv.index_of(header, "latitude")
    lon_index = tsv.index_of(header, "longitude")

    languages: list[Language] = []
    for row in rows:
        identifier = tsv.cell(row, id_index)
        name = tsv.cell(row, name_index)
        family_id = tsv.cell(row, family_index)
        if not identifier or not name or not family_id:
            continue
        lat = tsv.js_number(tsv.cell(row, lat_index)) if lat_index >= 0 else math.nan
        lon = tsv.js_number(tsv.cell(row, lon_index)) if lon_index >= 0 else math.nan
        coordinates = (
            {"lat": lat, "lng": lon}
            if math.isfinite(lat) and math.isfinite(lon)
            else None
        )
        languages.append(
            Language(
                id=identifier,
                name=name,
                family_id=family_id,
                region=tsv.optional_text(row, region_index),
                coordinates=coordinates,
            )
        )
    return languages


def load_language_families(lexicons: Path) -> list[LanguageFamily]:
    """`families.tsv`. A row without id/name is skipped."""
    parsed = tsv.read_tsv(lexicons, "families.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    region_index = tsv.index_of(header, "region")

    families: list[LanguageFamily] = []
    for row in rows:
        identifier = tsv.cell(row, id_index)
        name = tsv.cell(row, name_index)
        if not identifier or not name:
            continue
        families.append(
            LanguageFamily(
                id=identifier,
                name=name,
                region=tsv.optional_text(row, region_index),
            )
        )
    return families


def load_cuisines(lexicons: Path) -> list[Cuisine]:
    """`cuisines.tsv`."""
    parsed = tsv.read_tsv(lexicons, "cuisines.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    region_index = tsv.index_of(header, "region")
    coordinates_index = tsv.index_of(header, "coordinates")
    languages_index = tsv.index_of(header, "associated_language_ids")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")

    return [
        Cuisine(
            id=tsv.cell(row, id_index),
            name=tsv.cell(row, name_index),
            region=tsv.text_cell(row, region_index),
            coordinates=_coordinates(row, coordinates_index),
            associated_language_ids=tsv.json_array(row, languages_index),
            time_origin=tsv.nullable_int(row, origin_index),
            time_end=tsv.nullable_int(row, end_index),
        )
        for row in rows
    ]


def load_music_traditions(lexicons: Path) -> list[MusicTradition]:
    """`music-traditions.tsv` — the richest trait source the anomaly scan reads."""
    parsed = tsv.read_tsv(lexicons, "music-traditions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    region_index = tsv.index_of(header, "region")
    coordinates_index = tsv.index_of(header, "coordinates")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    languages_index = tsv.index_of(header, "associated_language_ids")
    instruments_index = tsv.index_of(header, "instruments")
    scales_index = tsv.index_of(header, "scales")
    rhythms_index = tsv.index_of(header, "rhythmic_patterns")
    sources_index = tsv.index_of(header, "sources")

    return [
        MusicTradition(
            id=tsv.cell(row, id_index),
            name=tsv.cell(row, name_index),
            region=tsv.text_cell(row, region_index),
            coordinates=_coordinates(row, coordinates_index),
            associated_language_ids=tsv.json_array(row, languages_index),
            time_origin=tsv.nullable_int(row, origin_index),
            time_end=tsv.nullable_int(row, end_index),
            instruments=tsv.json_array(row, instruments_index),
            scales=tsv.json_array(row, scales_index),
            rhythmic_patterns=tsv.json_array(row, rhythms_index),
            sources=tsv.json_array(row, sources_index),
        )
        for row in rows
    ]


def load_religions(lexicons: Path) -> list[Religion]:
    """`religions.tsv`. Note the region column is `origin_region`, not `region`."""
    parsed = tsv.read_tsv(lexicons, "religions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    region_index = tsv.index_of(header, "origin_region")
    coordinates_index = tsv.index_of(header, "coordinates")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    languages_index = tsv.index_of(header, "associated_language_ids")

    return [
        Religion(
            id=tsv.cell(row, id_index),
            name=tsv.cell(row, name_index),
            origin_region=tsv.text_cell(row, region_index),
            coordinates=_coordinates(row, coordinates_index),
            associated_language_ids=tsv.json_array(row, languages_index),
            time_origin=tsv.nullable_int(row, origin_index),
            time_end=tsv.nullable_int(row, end_index),
        )
        for row in rows
    ]


def load_haplogroups(lexicons: Path) -> list[Haplogroup]:
    """`haplogroups.tsv`. An absent `haplogroup_type` defaults to Y-chromosome."""
    parsed = tsv.read_tsv(lexicons, "haplogroups.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    type_index = tsv.index_of(header, "haplogroup_type")
    families_index = tsv.index_of(header, "associated_language_family_ids")
    civilizations_index = tsv.index_of(header, "associated_civilization_ids")
    geography_index = tsv.index_of(header, "geographic_origin")
    origin_index = tsv.index_of(header, "time_origin")

    return [
        Haplogroup(
            id=tsv.cell(row, id_index),
            name=tsv.cell(row, name_index),
            haplogroup_type=tsv.text_cell(row, type_index, "Y-chromosome"),
            associated_language_family_ids=tsv.json_array(row, families_index),
            associated_civilization_ids=tsv.json_array(row, civilizations_index),
            geographic_origin=tsv.text_cell(row, geography_index),
            time_origin=tsv.nullable_int(row, origin_index),
        )
        for row in rows
    ]


def load_civilizations(lexicons: Path) -> list[Civilization]:
    """`civilizations.tsv`, with `civilization-boundaries.tsv` filling its dates.

    The boundary row is consulted only when the civilization's own
    `time_period_start` / `_end` is blank, and a boundary with no parseable
    `geometry` is not a boundary — the same precedence
    :mod:`pinakes.collab.citable` reproduces for citations. An undated
    civilization starts at year **0**.
    """
    parsed = tsv.read_tsv(lexicons, "civilizations.tsv")
    boundaries_parsed = tsv.read_tsv(lexicons, "civilization-boundaries.tsv")
    if parsed is None:
        return []

    starts: dict[str, int] = {}
    ends: dict[str, int | None] = {}
    if boundaries_parsed is not None:
        header, rows = boundaries_parsed
        civ_index = tsv.required_index(header, "civilization_id")
        geometry_index = tsv.required_index(header, "geometry")
        start_index = tsv.index_of(header, "time_period_start")
        end_index = tsv.index_of(header, "time_period_end")
        for row in rows:
            if not tsv.cell(row, geometry_index):
                continue
            if tsv.json_cell(row, geometry_index, None) is None:
                continue
            civilization_id = tsv.cell(row, civ_index)
            start = tsv.nullable_int(row, start_index)
            starts[civilization_id] = start if start is not None else 0
            ends[civilization_id] = tsv.nullable_int(row, end_index)

    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    start_index = tsv.index_of(header, "time_period_start")
    end_index = tsv.index_of(header, "time_period_end")
    languages_index = tsv.index_of(header, "associated_language_ids")

    civilizations: list[Civilization] = []
    for row in rows:
        civilization_id = tsv.cell(row, id_index)
        start = tsv.nullable_int(row, start_index)
        end = tsv.nullable_int(row, end_index)
        civilizations.append(
            Civilization(
                id=civilization_id,
                name=tsv.cell(row, name_index),
                associated_language_ids=tsv.json_array(row, languages_index),
                time_start=(
                    start if start is not None else starts.get(civilization_id, 0)
                ),
                time_end=end if end is not None else ends.get(civilization_id),
            )
        )
    return civilizations


def load_art_traditions(lexicons: Path) -> list[ArtTradition]:
    """`art-traditions.tsv`."""
    parsed = tsv.read_tsv(lexicons, "art-traditions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    coordinates_index = tsv.required_index(header, "origin_coordinates")
    civilizations_index = tsv.index_of(header, "associated_civilizations")
    languages_index = tsv.required_index(header, "associated_languages")
    features_index = tsv.required_index(header, "key_features")
    examples_index = tsv.required_index(header, "notable_examples")

    return [
        ArtTradition(
            id=tsv.cell(row, id_index),
            name=tsv.cell(row, name_index),
            category=tsv.cell(row, category_index),
            origin_coordinates=_coordinates(row, coordinates_index),
            associated_civilizations=tsv.text_cell(row, civilizations_index),
            associated_languages=tsv.json_array(row, languages_index),
            key_features=tsv.json_array(row, features_index),
            notable_examples=tsv.json_array(row, examples_index),
        )
        for row in rows
    ]


def load_material_cultures(lexicons: Path) -> list[MaterialCulture]:
    """`material-culture.tsv`.

    Its `origin_coordinates` is a ``[lat, lng]`` **tuple** where music and art
    use ``{lat, lng}`` objects; the anomaly projection is what normalizes them,
    so the difference stays visible here.
    """
    parsed = tsv.read_tsv(lexicons, "material-culture.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    coordinates_index = tsv.required_index(header, "origin_coordinates")
    languages_index = tsv.index_of(header, "associated_languages")

    cultures: list[MaterialCulture] = []
    for row in rows:
        raw = tsv.json_cell(row, coordinates_index, None)
        coordinates = (
            [float(value) for value in raw]
            if isinstance(raw, list) and all(isinstance(v, (int, float)) for v in raw)
            else [0.0, 0.0]
        )
        # A comma-separated cell here, not a JSON array — the one column in the
        # corpus that spells an id list that way.
        raw_languages = tsv.text_cell(row, languages_index)
        cultures.append(
            MaterialCulture(
                id=tsv.cell(row, id_index),
                name=tsv.cell(row, name_index),
                category=tsv.text_cell(row, category_index, "unknown"),
                origin_coordinates=coordinates,
                associated_languages=(
                    [part.strip() for part in raw_languages.split(",")]
                    if raw_languages
                    else []
                ),
            )
        )
    return cultures
