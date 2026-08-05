"""The corpus loaders — `server/tsv-storage.ts`'s ``load*`` methods, ported.

Each loader takes the lexicons directory and returns the records that domain's
list endpoint returns: plain JSON-ready dicts with the TypeScript's camelCase
keys, because those keys are what the client parses. The dialect helpers are
:mod:`pinakes.analytics.tsv` (``parseTsv`` / ``getIdx`` / the "this cell may be
absent" reads); what is here is the per-domain column vocabulary.

Four shapes are reproduced rather than tidied:

* **Nothing is cached.** The TypeScript memoised each table on the storage
  singleton; here every loader re-reads, because
  :func:`pinakes.paths.lexicons_dir` re-reads its environment override on every
  call and a cached table would be a table of whatever directory the first
  caller happened to ask for. That override is the test seam (`conftest.py`'s
  autouse ``isolated_data_trees``), so keeping the read honest matters more than
  the milliseconds — the largest file here is ~1,100 rows.
* **A missing *file* is an empty domain; a missing required *column* is an
  error.** ``readFileIfExists`` returning null and ``getIdx`` throwing are two
  different statements, and the loaders were built on both. The two language
  loaders are the exception: they wrap themselves in a try/catch and degrade a
  broken `families.tsv`/`languages.tsv` to ``[]``, so those are caught here too.
* **``undefined`` properties are omitted, not emitted as null.**
  ``JSON.stringify`` drops a key whose value is ``undefined``, and a
  present-but-null key is a different record to a client that tests
  ``in``/``?.``. Only the civilization feature has any (:func:`_defined`).
* **An unparseable year is absent.** The TypeScript would carry a ``NaN``
  through, which ``res.json`` then serialises as ``null`` — so "absent" and "not
  a number" already answer the same way over HTTP, and the port collapses them.
  Same deliberate deviation :mod:`pinakes.collab.citable` documents.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from pinakes.analytics import tsv

#: What a blank or unparseable coordinate cell means to the loaders that carry
#: one — the origin, not nothing. `pinakes.analytics.corpus` documents why this
#: is observable rather than harmless: such rows really do score geographic
#: proximity to each other at Null Island.
ORIGIN: dict[str, float] = {"lat": 0.0, "lng": 0.0}

#: The placeholder ring `loadCivilizations` gives a civilization with no
#: boundary row, so every feature in the layer has a geometry to render.
PLACEHOLDER_RING: list[list[list[float]]] = [
    [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]
]

Record = dict[str, Any]
Feature = dict[str, Any]


# ── Cell readers the TypeScript spells inline ────────────────────────────────


def _coalesce(row: list[str], index: int, fallback: str) -> str:
    """``row[idx] ?? fallback`` — nullish, so a *blank* cell is still blank.

    Distinct from :func:`pinakes.analytics.tsv.text_cell`, which is ``||`` and
    falls back on a blank too. Only a short row (JavaScript's ``undefined``)
    takes the fallback here, which is what `taxonomic_level` and `status` want:
    a row that declares itself blank is blank, a row that stops early is
    unstated.
    """
    return row[index] if 0 <= index < len(row) else fallback


def _number(row: list[str], index: int) -> float | int | None:
    """``Number(cell) || null``, integral results narrowed back to ``int``.

    The narrowing is cosmetic but real: JavaScript prints ``1000`` where a
    Python float prints ``1000.0``, and these values are read out of a JSON
    response by clients that show them to people.
    """
    value = tsv.number_or_none(row, index)
    if value is None:
        return None
    return int(value) if value.is_integer() else value


def _int(row: list[str], index: int) -> int | None:
    """``cell && cell !== "null" ? parseInt(cell, 10) : null``."""
    return tsv.nullable_int(row, index)


def _int_or(row: list[str], index: int, fallback: int | None) -> int | None:
    """The same read, with something other than ``null`` when it is absent."""
    parsed = tsv.nullable_int(row, index)
    return fallback if parsed is None else parsed


def _int_default(row: list[str], index: int, fallback: int) -> int:
    """``idx >= 0 ? parseInt(cell || "<fallback>", 10) : <fallback>``.

    The site loader's importance/confidence read: a blank *cell* falls back
    through the string, and an absent *column* falls back directly.
    """
    if index < 0 or not tsv.cell(row, index):
        return fallback
    parsed = tsv.js_parse_int(tsv.cell(row, index))
    return fallback if math.isnan(parsed) else int(parsed)


def _finite_number(row: list[str], index: int) -> float | int | None:
    """``Number.isFinite(Number(cell)) ? Number(cell) : undefined``.

    Unlike :func:`_number` this keeps a **zero**: a confidence of 0 is a claim,
    not a missing value, and the civilization loader is the one place that tests
    finiteness rather than truthiness.
    """
    if index < 0 or not tsv.cell(row, index):
        return None
    value = tsv.js_number(tsv.cell(row, index))
    if not math.isfinite(value):
        return None
    return int(value) if value.is_integer() else value


def _coordinates(row: list[str], index: int) -> Any:
    """A ``{"lat","lng"}`` cell, defaulting to :data:`ORIGIN`."""
    return tsv.json_cell(row, index, dict(ORIGIN))


def _defined(**fields: Any) -> Record:
    """Drop the keys whose value is ``None``, as ``JSON.stringify`` drops
    ``undefined``. Only for properties the TypeScript leaves *undefined* — a
    property it sets to ``null`` must stay."""
    return {key: value for key, value in fields.items() if value is not None}


def _time_period(start: int | None, end: int | None, label: str) -> Record:
    return {"start": start, "end": end, "label": label}


# ── Languages and families ───────────────────────────────────────────────────


def load_language_families(lexicons: Path) -> list[Record]:
    """`families.tsv` → the family records, **before** the count recalculation.

    ``loadScrapedFamilies``. A row missing either `id` or `name` is skipped
    outright — the TypeScript's ``if (!id || !name) continue``, which is how a
    trailing blank-ish row stays out of the tree.
    """
    parsed = tsv.read_tsv(lexicons, "families.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    try:
        id_index = tsv.required_index(header, "id")
        name_index = tsv.required_index(header, "name")
        level_index = tsv.required_index(header, "taxonomic_level")
    except tsv.MissingColumnError:
        # `loadScrapedFamilies` wraps itself in a try/catch and warns; a corpus
        # with a broken families file is an empty family list, not a 500.
        return []
    parent_index = tsv.index_of(header, "parent_id")
    description_index = tsv.index_of(header, "description")
    region_index = tsv.index_of(header, "region")
    speakers_index = tsv.index_of(header, "total_speakers")
    count_index = tsv.index_of(header, "language_count")

    families: list[Record] = []
    for row in rows:
        identifier = tsv.cell(row, id_index)
        name = tsv.cell(row, name_index)
        if not identifier or not name:
            continue
        families.append(
            {
                "id": identifier,
                "name": name,
                "parentId": tsv.optional_text(row, parent_index),
                "description": tsv.optional_text(row, description_index),
                "taxonomicLevel": _coalesce(row, level_index, "family"),
                "region": tsv.optional_text(row, region_index),
                "totalSpeakers": _number(row, speakers_index),
                "languageCount": _number(row, count_index),
                "source": "scraped",
            }
        )
    return families


def load_languages(lexicons: Path) -> list[Record]:
    """`languages.tsv` → the language records.

    ``loadScrapedLanguages``. **A language without a family is not a language**:
    `id`, `name` *and* `family_id` must all be non-blank, so an unclassified row
    is absent from every downstream read — including `/api/summaries/languages`
    and the canonical-URL resolver.
    """
    parsed = tsv.read_tsv(lexicons, "languages.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    try:
        id_index = tsv.required_index(header, "id")
        name_index = tsv.required_index(header, "name")
        family_index = tsv.required_index(header, "family_id")
        status_index = tsv.required_index(header, "status")
    except tsv.MissingColumnError:
        return []

    native_index = tsv.index_of(header, "native_name")
    iso1_index = tsv.index_of(header, "iso639_1")
    iso2_index = tsv.index_of(header, "iso639_2")
    parent_index = tsv.index_of(header, "parent_language_id")
    region_index = tsv.index_of(header, "region")
    countries_index = tsv.index_of(header, "countries")
    native_speakers_index = tsv.index_of(header, "native_speakers")
    total_speakers_index = tsv.index_of(header, "total_speakers")
    endangerment_index = tsv.index_of(header, "endangerment_status")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    classification_index = tsv.index_of(header, "classification")
    writing_index = tsv.index_of(header, "writing_system")
    historical_index = tsv.index_of(header, "is_historical_variant")
    dialect_index = tsv.index_of(header, "is_dialect")
    order_index = tsv.index_of(header, "chronological_order")
    context_index = tsv.index_of(header, "historical_context")
    latitude_index = tsv.index_of(header, "latitude")
    longitude_index = tsv.index_of(header, "longitude")

    languages: list[Record] = []
    for row in rows:
        identifier = tsv.cell(row, id_index)
        name = tsv.cell(row, name_index)
        family = tsv.cell(row, family_index)
        if not identifier or not name or not family:
            continue

        latitude = (
            tsv.js_number(tsv.cell(row, latitude_index))
            if latitude_index >= 0
            else math.nan
        )
        longitude = (
            tsv.js_number(tsv.cell(row, longitude_index))
            if longitude_index >= 0
            else math.nan
        )
        countries = tsv.cell(row, countries_index)
        order = tsv.js_number(tsv.cell(row, order_index)) if order_index >= 0 else 0.0

        languages.append(
            {
                "id": identifier,
                "name": name,
                "nativeName": tsv.optional_text(row, native_index),
                "iso639_1": tsv.optional_text(row, iso1_index),
                "iso639_2": tsv.optional_text(row, iso2_index),
                "familyId": family,
                "parentLanguageId": tsv.optional_text(row, parent_index),
                "region": tsv.optional_text(row, region_index),
                "countries": countries.split(";") if countries else [],
                "nativeSpeakers": _number(row, native_speakers_index),
                "totalSpeakers": _number(row, total_speakers_index),
                # `?? "living"`, so a row that *declares* a blank status keeps
                # it; only a short row is assumed living. `server/CLAUDE.md`
                # records why that matters — the endangerment dashboard's
                # `unknown` bucket is nearly empty on live data because of it.
                "status": _coalesce(row, status_index, "living"),
                "endangermentStatus": tsv.optional_text(row, endangerment_index),
                "timeOrigin": tsv.optional_text(row, origin_index),
                "timeEnd": tsv.optional_text(row, end_index),
                "classification": tsv.optional_text(row, classification_index),
                "writingSystem": tsv.optional_text(row, writing_index),
                "isHistoricalVariant": tsv.cell(row, historical_index) == "true",
                "isDialect": tsv.cell(row, dialect_index) == "true",
                "chronologicalOrder": (
                    0
                    if math.isnan(order) or order == 0
                    else (int(order) if order.is_integer() else order)
                ),
                "historicalContext": tsv.optional_text(row, context_index),
                "coordinates": (
                    {"lat": latitude, "lng": longitude}
                    if math.isfinite(latitude) and math.isfinite(longitude)
                    else None
                ),
                "source": "scraped",
            }
        )
    return languages


def language_families_with_counts(lexicons: Path) -> list[Record]:
    """The family list `GET /api/language-families` answers with.

    ``loadLanguagesAndFamilies`` overwrites every family's `language_count` cell
    with a **recursive** count of the languages under it — direct children plus
    every descendant family's — so the corpus column is advisory and the served
    number is derived. Reproduced because the tree UI shows it.
    """
    families = load_language_families(lexicons)
    languages = load_languages(lexicons)

    direct: dict[str, int] = {}
    for language in languages:
        family_id = str(language["familyId"])
        direct[family_id] = direct.get(family_id, 0) + 1

    children: dict[str | None, list[str]] = {}
    for family in families:
        children.setdefault(family["parentId"], []).append(str(family["id"]))

    def total(family_id: str, seen: frozenset[str]) -> int:
        # The TypeScript recurses with no cycle guard and would hang on a
        # self-parenting row; refusing to revisit one is the same answer for
        # every acyclic corpus and a finite one for a broken corpus.
        if family_id in seen:
            return 0
        below = seen | {family_id}
        return direct.get(family_id, 0) + sum(
            total(child, below) for child in children.get(family_id, ())
        )

    for family in families:
        family["languageCount"] = total(str(family["id"]), frozenset())
    return families


# ── The GeoJSON layers ───────────────────────────────────────────────────────


def load_civilizations(lexicons: Path) -> list[Feature]:
    """`civilizations.tsv` + `civilization-boundaries.tsv` → GeoJSON features.

    ``loadCivilizations``. The boundary file supplies the geometry and a *time
    period of last resort*: a civilization whose own `time_period_start` is
    blank inherits its boundary's, and one with no boundary at all gets a
    placeholder square at the origin so the layer still renders it.
    """
    civilizations = tsv.read_tsv(lexicons, "civilizations.tsv")
    boundaries = tsv.read_tsv(lexicons, "civilization-boundaries.tsv")
    if civilizations is None and boundaries is None:
        return []

    shapes: dict[str, Record] = {}
    if boundaries is not None:
        header, rows = boundaries
        civ_index = tsv.required_index(header, "civilization_id")
        geometry_index = tsv.required_index(header, "geometry")
        start_index = tsv.index_of(header, "time_period_start")
        end_index = tsv.index_of(header, "time_period_end")
        label_index = tsv.index_of(header, "time_period_label")
        for row in rows:
            if not tsv.cell(row, geometry_index):
                continue
            geometry = tsv.json_cell(row, geometry_index, None)
            if geometry is None:
                continue
            shapes[tsv.cell(row, civ_index)] = {
                "geometry": geometry,
                "start": _int_or(row, start_index, 0),
                "end": _int(row, end_index),
                "label": tsv.text_cell(row, label_index),
            }

    if civilizations is None:
        return []
    header, rows = civilizations
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    start_index = tsv.index_of(header, "time_period_start")
    end_index = tsv.index_of(header, "time_period_end")
    label_index = tsv.index_of(header, "time_period_label")
    language_index = tsv.index_of(header, "associated_language_ids")
    writing_index = tsv.index_of(header, "writing_systems")
    political_index = tsv.index_of(header, "political_structure")
    capital_index = tsv.index_of(header, "capital")
    population_index = tsv.index_of(header, "population")
    sources_index = tsv.index_of(header, "sources")
    description_index = tsv.index_of(header, "description")
    qid_index = tsv.index_of(header, "wikidata_qid")
    source_url_index = tsv.index_of(header, "source_url")
    retrieved_index = tsv.index_of(header, "retrieved_at")
    confidence_index = tsv.index_of(header, "confidence")

    features: list[Feature] = []
    for row in rows:
        identifier = tsv.cell(row, id_index)
        boundary = shapes.get(identifier)
        # `labelIdx >= 0 ? row[labelIdx] || "" : (boundary?.label ?? "")` — the
        # boundary's label is a fallback for a missing *column*, not for a blank
        # cell. A civilization that declares no label has none.
        label = (
            tsv.text_cell(row, label_index)
            if label_index >= 0
            else (str(boundary["label"]) if boundary else "")
        )
        features.append(
            {
                "type": "Feature",
                "id": identifier,
                "geometry": (
                    boundary["geometry"]
                    if boundary
                    else {"type": "Polygon", "coordinates": PLACEHOLDER_RING}
                ),
                "properties": {
                    "civilizationId": identifier,
                    "name": tsv.cell(row, name_index),
                    "timePeriod": _time_period(
                        _int_or(
                            row,
                            start_index,
                            int(boundary["start"] or 0) if boundary else 0,
                        ),
                        _int_or(
                            row, end_index, boundary["end"] if boundary else None
                        ),
                        label,
                    ),
                    "associatedLanguageIds": tsv.json_array(row, language_index),
                    "writingSystems": tsv.json_array(row, writing_index),
                    "sources": tsv.json_array(row, sources_index),
                    **_defined(
                        nativeName=tsv.optional_text(row, native_index),
                        politicalStructure=tsv.optional_text(row, political_index),
                        capital=tsv.optional_text(row, capital_index),
                        population=_int(row, population_index),
                        description=tsv.optional_text(row, description_index),
                        wikidataQid=tsv.optional_text(row, qid_index),
                        sourceUrl=tsv.optional_text(row, source_url_index),
                        retrievedAt=tsv.optional_text(row, retrieved_index),
                        confidence=_finite_number(row, confidence_index),
                    ),
                },
            }
        )
    return features


def load_archaeological_sites(lexicons: Path) -> list[Feature]:
    """`archaeological-sites.tsv` → GeoJSON point features.

    ``loadArchaeologicalSites``. **A site with no parseable `coordinates` does
    not exist** — the loader filters it out before anything can find it, so its
    canonical URL and its citation are both 404s. Odd, but part of the contract
    (`pinakes.collab.citable` reproduces the same rule).
    """
    parsed = tsv.read_tsv(lexicons, "archaeological-sites.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    coordinates_index = tsv.required_index(header, "coordinates")
    type_index = tsv.required_index(header, "site_type")
    start_index = tsv.index_of(header, "time_period_start")
    end_index = tsv.index_of(header, "time_period_end")
    label_index = tsv.index_of(header, "time_period_label")
    language_index = tsv.index_of(header, "associated_language_ids")
    culture_index = tsv.index_of(header, "associated_culture_ids")
    excavation_index = tsv.index_of(header, "excavation_status")
    findings_index = tsv.index_of(header, "findings")
    importance_index = tsv.index_of(header, "importance")
    confidence_index = tsv.index_of(header, "confidence")
    sources_index = tsv.index_of(header, "sources")
    description_index = tsv.index_of(header, "description")

    features: list[Feature] = []
    for row in rows:
        if not tsv.cell(row, coordinates_index).strip():
            continue
        coordinates = tsv.json_cell(row, coordinates_index, None)
        if not isinstance(coordinates, dict):
            continue
        features.append(
            {
                "type": "Feature",
                "id": tsv.cell(row, id_index),
                "geometry": {
                    "type": "Point",
                    "coordinates": [coordinates.get("lng"), coordinates.get("lat")],
                },
                "properties": {
                    "siteId": tsv.cell(row, id_index),
                    "name": tsv.cell(row, name_index),
                    "siteType": tsv.text_cell(row, type_index, "unknown"),
                    "timePeriod": _time_period(
                        _int_or(row, start_index, 0),
                        _int(row, end_index),
                        tsv.text_cell(row, label_index),
                    ),
                    "associatedLanguageIds": tsv.json_array(row, language_index),
                    "associatedCultureIds": tsv.json_array(row, culture_index),
                    "excavationStatus": tsv.text_cell(
                        row, excavation_index, "unknown"
                    ),
                    "findings": tsv.json_array(row, findings_index),
                    "importance": _int_default(row, importance_index, 50),
                    "confidence": _int_default(row, confidence_index, 50),
                    "sources": tsv.json_array(row, sources_index),
                    "description": tsv.text_cell(row, description_index),
                },
            }
        )
    return features


# ── The flat domains ─────────────────────────────────────────────────────────


def load_deities(lexicons: Path) -> list[Record]:
    """`deities.tsv` → the deity records (``loadDeities``).

    Two columns are read under either of two spellings, both live in the corpus:
    `mythology` else `pantheon`, and `equivalent_deity_ids` else
    `syncretism_links`.
    """
    parsed = tsv.read_tsv(lexicons, "deities.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    mythology_index = tsv.index_of(header, "mythology")
    if mythology_index < 0:
        mythology_index = tsv.index_of(header, "pantheon")
    domain_index = tsv.index_of(header, "domain")
    coordinates_index = tsv.index_of(header, "coordinates")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    language_index = tsv.index_of(header, "associated_language_ids")
    equivalent_index = tsv.index_of(header, "equivalent_deity_ids")
    if equivalent_index < 0:
        equivalent_index = tsv.index_of(header, "syncretism_links")
    attributes_index = tsv.index_of(header, "attributes")
    symbols_index = tsv.index_of(header, "symbols")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "nativeName": tsv.text_cell(row, native_index),
            "mythology": tsv.text_cell(row, mythology_index),
            "domain": tsv.json_array(row, domain_index),
            "coordinates": _coordinates(row, coordinates_index),
            "timeOrigin": _int(row, origin_index),
            "timeEnd": _int(row, end_index),
            "associatedLanguageIds": tsv.json_array(row, language_index),
            "equivalentDeityIds": tsv.json_array(row, equivalent_index),
            "attributes": tsv.json_array(row, attributes_index),
            "symbols": tsv.json_array(row, symbols_index),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_myth_motifs(lexicons: Path) -> list[Record]:
    """`myth-motifs.tsv` → the motif records (``loadMythMotifs``).

    Landed alongside the mythology routes because `GET /api/deities/{id}/motifs`
    reaches it: a motif names its deities, not the other way round, so the deity
    route cannot answer without this file.
    """
    parsed = tsv.read_tsv(lexicons, "myth-motifs.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    type_index = tsv.index_of(header, "motif_type")
    thompson_index = tsv.index_of(header, "thompson_index")
    mythology_index = tsv.index_of(header, "mythology_ids")
    deity_index = tsv.index_of(header, "associated_deity_ids")
    region_index = tsv.index_of(header, "region")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    related_index = tsv.index_of(header, "related_motif_ids")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "motifType": tsv.text_cell(row, type_index),
            "thompsonIndex": tsv.text_cell(row, thompson_index),
            "mythologyIds": tsv.json_array(row, mythology_index),
            "associatedDeityIds": tsv.json_array(row, deity_index),
            "region": tsv.text_cell(row, region_index),
            "timeOrigin": _int(row, origin_index),
            "timeEnd": _int(row, end_index),
            "relatedMotifIds": tsv.json_array(row, related_index),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_religions(lexicons: Path) -> list[Record]:
    """`religions.tsv` → the religion records (``loadReligions``)."""
    parsed = tsv.read_tsv(lexicons, "religions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    type_index = tsv.index_of(header, "religion_type")
    region_index = tsv.index_of(header, "origin_region")
    coordinates_index = tsv.index_of(header, "coordinates")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    texts_index = tsv.index_of(header, "sacred_texts")
    language_index = tsv.index_of(header, "associated_language_ids")
    pantheon_index = tsv.index_of(header, "deity_pantheon")
    ritual_index = tsv.index_of(header, "ritual_practices")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "nativeName": tsv.text_cell(row, native_index),
            "religionType": tsv.text_cell(row, type_index),
            "originRegion": tsv.text_cell(row, region_index),
            "coordinates": _coordinates(row, coordinates_index),
            "timeOrigin": _int(row, origin_index),
            "timeEnd": _int(row, end_index),
            "sacredTexts": tsv.json_array(row, texts_index),
            "associatedLanguageIds": tsv.json_array(row, language_index),
            "deityPantheon": tsv.json_array(row, pantheon_index),
            "ritualPractices": tsv.json_array(row, ritual_index),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_cuisines(lexicons: Path) -> list[Record]:
    """`cuisines.tsv` → the cuisine records (``loadCuisines``)."""
    parsed = tsv.read_tsv(lexicons, "cuisines.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    region_index = tsv.index_of(header, "region")
    coordinates_index = tsv.index_of(header, "coordinates")
    language_index = tsv.index_of(header, "associated_language_ids")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    description_index = tsv.index_of(header, "description")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "nativeName": tsv.text_cell(row, native_index),
            "region": tsv.text_cell(row, region_index),
            "coordinates": _coordinates(row, coordinates_index),
            "associatedLanguageIds": tsv.json_array(row, language_index),
            "timeOrigin": _int(row, origin_index),
            "timeEnd": _int(row, end_index),
            "description": tsv.text_cell(row, description_index),
        }
        for row in rows
    ]


def load_battles(lexicons: Path) -> list[Record]:
    """`battles.tsv` → the battle records (``loadBattles``).

    `name` is read with ``indexOf`` here, not ``getIdx`` — battles are the one
    domain whose loader treats a missing name column as blank rather than as a
    broken file. Kept as found.
    """
    parsed = tsv.read_tsv(lexicons, "battles.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.index_of(header, "name")
    date_index = tsv.index_of(header, "date")
    coordinates_index = tsv.index_of(header, "coordinates")
    belligerents_index = tsv.index_of(header, "belligerents")
    outcome_index = tsv.index_of(header, "outcome")
    casualties_index = tsv.index_of(header, "casualties_estimate")
    significance_index = tsv.index_of(header, "significance")
    changes_index = tsv.index_of(header, "associated_language_changes")
    war_index = tsv.index_of(header, "war_name")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.text_cell(row, name_index),
            "date": tsv.text_cell(row, date_index),
            # A `[lat, lng]` pair here, not the `{lat, lng}` object the other
            # domains carry. `server/CLAUDE.md` records the same asymmetry for
            # material culture; both are corpus shape, not a slip.
            "coordinates": tsv.json_cell(row, coordinates_index, [0, 0]),
            # `json_cell`, not `json_array`: the cell is an array of **objects**
            # (`{name, civilization_id}`), and `json_array` stringifies its items
            # — which turned every belligerent into `"{'name': …}"` on the wire
            # and made `?civilization_id=` match nothing. The TypeScript's
            # `JSON.parse` kept the objects; found porting `GET /api/battles`.
            "belligerents": tsv.json_cell(row, belligerents_index, []),
            "outcome": tsv.text_cell(row, outcome_index),
            "casualtiesEstimate": tsv.text_cell(row, casualties_index),
            "significance": tsv.text_cell(row, significance_index),
            "associatedLanguageChanges": tsv.text_cell(row, changes_index),
            "warName": tsv.text_cell(row, war_index),
        }
        for row in rows
    ]


def load_trade_goods(lexicons: Path) -> list[Record]:
    """`trade-goods.tsv` → the trade-good records (``loadTradeGoods``).

    Every column is required here — the loader reads all nine with ``getIdx`` —
    so a trade-goods file that has lost any of them is an error, not an empty
    domain. That is stricter than its neighbours and is kept as found.
    """
    parsed = tsv.read_tsv(lexicons, "trade-goods.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    region_index = tsv.required_index(header, "origin_region")
    coordinates_index = tsv.required_index(header, "origin_coordinates")
    routes_index = tsv.required_index(header, "trade_routes")
    period_index = tsv.required_index(header, "time_period")
    significance_index = tsv.required_index(header, "economic_significance")
    language_index = tsv.required_index(header, "associated_languages")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.cell(row, category_index),
            "originRegion": tsv.cell(row, region_index),
            "originCoordinates": _coordinates(row, coordinates_index),
            "tradeRoutes": tsv.json_array(row, routes_index),
            "timePeriod": tsv.cell(row, period_index),
            "economicSignificance": tsv.cell(row, significance_index),
            "associatedLanguages": tsv.json_array(row, language_index),
        }
        for row in rows
    ]


def load_writing_systems(lexicons: Path) -> list[Record]:
    """`writing-systems.tsv` → the writing-system records (``loadWritingSystems``)."""
    parsed = tsv.read_tsv(lexicons, "writing-systems.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    type_index = tsv.index_of(header, "type")
    direction_index = tsv.index_of(header, "direction")
    parent_index = tsv.index_of(header, "parent_system_id")
    language_index = tsv.index_of(header, "language_ids")
    origin_date_index = tsv.index_of(header, "origin_date")
    origin_region_index = tsv.index_of(header, "origin_region")
    characters_index = tsv.index_of(header, "character_count")
    sample_index = tsv.index_of(header, "sample_characters")
    unicode_index = tsv.index_of(header, "unicode_block")
    active_index = tsv.index_of(header, "is_active")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "type": tsv.text_cell(row, type_index),
            "direction": tsv.text_cell(row, direction_index),
            "parentSystemId": tsv.text_cell(row, parent_index),
            "languageIds": tsv.json_array(row, language_index),
            "originDate": tsv.text_cell(row, origin_date_index),
            "originRegion": tsv.text_cell(row, origin_region_index),
            "characterCount": tsv.int_or_zero(row, characters_index),
            "sampleCharacters": tsv.text_cell(row, sample_index),
            "unicodeBlock": tsv.text_cell(row, unicode_index),
            "isActive": tsv.cell(row, active_index) == "true",
        }
        for row in rows
    ]


def load_culture_profiles(lexicons: Path) -> list[Record]:
    """`culture-profiles.tsv` → the profile records (``loadCultureProfiles``)."""
    parsed = tsv.read_tsv(lexicons, "culture-profiles.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    alternate_index = tsv.index_of(header, "alternate_names")
    civilization_index = tsv.index_of(header, "civilization_id")
    archaeological_index = tsv.index_of(header, "archaeological_culture_id")
    start_index = tsv.index_of(header, "time_period_start")
    end_index = tsv.index_of(header, "time_period_end")
    region_index = tsv.index_of(header, "region")
    description_index = tsv.index_of(header, "summary_description")
    social_index = tsv.index_of(header, "social_organization")
    subsistence_index = tsv.index_of(header, "subsistence_type")
    urbanism_index = tsv.index_of(header, "urbanism_level")
    population_index = tsv.index_of(header, "population_estimate")
    technology_index = tsv.index_of(header, "technology_level")
    language_index = tsv.index_of(header, "associated_language_ids")
    religion_index = tsv.index_of(header, "associated_religion_ids")
    writing_index = tsv.index_of(header, "associated_writing_system_ids")
    art_index = tsv.index_of(header, "associated_art_tradition_ids")
    music_index = tsv.index_of(header, "associated_music_tradition_ids")
    cuisine_index = tsv.index_of(header, "associated_cuisine_id")
    architecture_index = tsv.index_of(header, "associated_architectural_style_ids")
    literary_index = tsv.index_of(header, "associated_literary_tradition_ids")
    settlements_index = tsv.index_of(header, "notable_settlements")
    tags_index = tsv.index_of(header, "image_gallery_tags")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "alternateNames": tsv.json_array(row, alternate_index),
            "civilizationId": tsv.cell(row, civilization_index).strip(),
            "archaeologicalCultureId": tsv.cell(row, archaeological_index).strip(),
            "timePeriodStart": _int(row, start_index),
            "timePeriodEnd": _int(row, end_index),
            "region": tsv.text_cell(row, region_index),
            "summaryDescription": tsv.text_cell(row, description_index),
            "socialOrganization": tsv.text_cell(row, social_index),
            "subsistenceType": tsv.text_cell(row, subsistence_index),
            "urbanismLevel": tsv.text_cell(row, urbanism_index),
            "populationEstimate": _int(row, population_index) or None,
            "technologyLevel": tsv.text_cell(row, technology_index),
            "associatedLanguageIds": tsv.json_array(row, language_index),
            "associatedReligionIds": tsv.json_array(row, religion_index),
            "associatedWritingSystemIds": tsv.json_array(row, writing_index),
            "associatedArtTraditionIds": tsv.json_array(row, art_index),
            "associatedMusicTraditionIds": tsv.json_array(row, music_index),
            "associatedCuisineId": tsv.text_cell(row, cuisine_index),
            "associatedArchitecturalStyleIds": tsv.json_array(row, architecture_index),
            "associatedLiteraryTraditionIds": tsv.json_array(row, literary_index),
            "notableSettlements": tsv.json_array(row, settlements_index),
            "imageGalleryTags": tsv.json_array(row, tags_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_innovations(lexicons: Path) -> list[Record]:
    """`innovations.tsv` → the innovation records (``loadInnovations``)."""
    parsed = tsv.read_tsv(lexicons, "innovations.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    culture_index = tsv.required_index(header, "culture_profile_ids")
    year_index = tsv.required_index(header, "year_invented")
    region_index = tsv.required_index(header, "region_of_origin")
    description_index = tsv.required_index(header, "description")
    diffusion_index = tsv.required_index(header, "diffusion_path")
    related_index = tsv.required_index(header, "related_innovations")
    language_index = tsv.required_index(header, "associated_languages")
    sources_index = tsv.required_index(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.cell(row, category_index),
            "cultureProfileIds": tsv.json_array(row, culture_index),
            "yearInvented": _int(row, year_index),
            "regionOfOrigin": tsv.cell(row, region_index),
            "description": tsv.cell(row, description_index),
            "diffusionPath": tsv.json_array(row, diffusion_index),
            "relatedInnovations": tsv.json_array(row, related_index),
            "associatedLanguages": tsv.json_array(row, language_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_urheimat_hypotheses(lexicons: Path) -> list[Record]:
    """`urheimat-hypotheses.tsv` → the hypothesis records (``loadUrheimatHypotheses``).

    The one domain whose display name is not `name`: it is `hypothesis_name`,
    which is why the canonical-URL resolver reads that column first.
    """
    parsed = tsv.read_tsv(lexicons, "urheimat-hypotheses.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    family_index = tsv.required_index(header, "language_family_id")
    name_index = tsv.required_index(header, "hypothesis_name")
    region_index = tsv.required_index(header, "proposed_region")
    coordinates_index = tsv.required_index(header, "proposed_coordinates")
    boundary_index = tsv.required_index(header, "proposed_boundary")
    start_index = tsv.required_index(header, "time_range_start")
    end_index = tsv.required_index(header, "time_range_end")
    evidence_index = tsv.required_index(header, "supporting_evidence")
    competing_index = tsv.required_index(header, "competing_hypotheses")
    consensus_index = tsv.required_index(header, "scholarly_consensus_level")
    proponents_index = tsv.required_index(header, "key_proponents")
    sources_index = tsv.required_index(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "languageFamilyId": tsv.cell(row, family_index),
            "hypothesisName": tsv.cell(row, name_index),
            "proposedRegion": tsv.cell(row, region_index),
            "proposedCoordinates": _coordinates(row, coordinates_index),
            "proposedBoundary": tsv.json_cell(row, boundary_index, {}),
            "timeRangeStart": _int(row, start_index),
            "timeRangeEnd": _int(row, end_index),
            "supportingEvidence": tsv.json_cell(
                row,
                evidence_index,
                {"linguistic": [], "archaeological": [], "genetic": []},
            ),
            "competingHypotheses": tsv.json_array(row, competing_index),
            "scholarlyConsensusLevel": tsv.int_or_zero(row, consensus_index),
            "keyProponents": tsv.json_array(row, proponents_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


# ── The domains global search and place resolution reach (pinakes:63 US-2) ───
#
# Nine more list loaders plus `settlements.tsv`. Nothing new in kind — the same
# `getIdx`/`indexOf` split and the same JSON-array cells — but two shapes recur
# here that the first thirteen did not have, and both are corpus, not slips:
# `origin_coordinates` is a **`[lat, lng]` pair** on foodway events (an object on
# art traditions and trade goods), and `waypoints` is a whole GeoJSON geometry
# whose fallback is `{}` rather than `[]`.


def load_base_words(lexicons: Path) -> list[Record]:
    """`words-base.tsv` → the concept list (``loadBaseWords``).

    The one loader that filters *and* sorts: a row without an id, without a
    gloss, or whose `number` is not finite is dropped, and what survives is
    ordered by that number. `number` is read with the comma swapped for a dot
    because the source list writes European decimals.

    ``readFileOrThrow``, not ``readFileIfExists`` — a missing `words-base.tsv`
    raises over there. Reproduced: this is the concept spine, and an empty word
    list would read as a corpus with no vocabulary rather than as a broken one.
    """
    path = Path(lexicons) / "words-base.tsv"
    if not path.is_file():
        raise FileNotFoundError(f"Required data file not found: {path}")
    header, rows = tsv.parse_tsv(path.read_text(encoding="utf-8"))
    number_index = tsv.required_index(header, "number")
    id_index = tsv.required_index(header, "id_nelex")
    gloss_index = tsv.required_index(header, "gloss_en")

    words: list[Record] = []
    for row in rows:
        number = tsv.js_number(tsv.cell(row, number_index).replace(",", ".", 1))
        identifier = tsv.cell(row, id_index).strip()
        gloss = tsv.cell(row, gloss_index).strip()
        if not identifier or not gloss or not math.isfinite(number):
            continue
        words.append(
            {
                "id": identifier,
                "word": gloss,
                "position": int(number) if number.is_integer() else number,
                "category": None,
                "frequency": None,
                "difficulty": None,
                "pos": None,
                "notes": None,
                "definition": None,
            }
        )
    words.sort(key=lambda word: word["position"])
    return words


def load_music_traditions(lexicons: Path) -> list[Record]:
    """`music-traditions.tsv` → the tradition records (``loadMusicTraditions``)."""
    parsed = tsv.read_tsv(lexicons, "music-traditions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    region_index = tsv.index_of(header, "region")
    coordinates_index = tsv.index_of(header, "coordinates")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    language_index = tsv.index_of(header, "associated_language_ids")
    instruments_index = tsv.index_of(header, "instruments")
    scales_index = tsv.index_of(header, "scales")
    rhythm_index = tsv.index_of(header, "rhythmic_patterns")
    related_index = tsv.index_of(header, "related_traditions")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "nativeName": tsv.text_cell(row, native_index),
            "region": tsv.text_cell(row, region_index),
            "coordinates": _coordinates(row, coordinates_index),
            "timeOrigin": _int(row, origin_index),
            "timeEnd": _int(row, end_index),
            "associatedLanguageIds": tsv.json_array(row, language_index),
            "instruments": tsv.json_array(row, instruments_index),
            "scales": tsv.json_array(row, scales_index),
            "rhythmicPatterns": tsv.json_array(row, rhythm_index),
            "relatedTraditions": tsv.json_array(row, related_index),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_musical_instruments(lexicons: Path) -> list[Record]:
    """`musical-instruments.tsv` → the instrument records.

    ``loadMusicalInstruments``.
    """
    parsed = tsv.read_tsv(lexicons, "musical-instruments.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    family_index = tsv.index_of(header, "instrument_family")
    region_index = tsv.index_of(header, "origin_region")
    coordinates_index = tsv.index_of(header, "coordinates")
    origin_index = tsv.index_of(header, "time_origin")
    materials_index = tsv.index_of(header, "construction_materials")
    technique_index = tsv.index_of(header, "playing_technique")
    tradition_index = tsv.index_of(header, "associated_tradition_ids")
    language_index = tsv.index_of(header, "associated_language_ids")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "nativeName": tsv.text_cell(row, native_index),
            "instrumentFamily": tsv.text_cell(row, family_index),
            "originRegion": tsv.text_cell(row, region_index),
            "coordinates": _coordinates(row, coordinates_index),
            "timeOrigin": _int(row, origin_index),
            "constructionMaterials": tsv.json_array(row, materials_index),
            "playingTechnique": tsv.text_cell(row, technique_index),
            "associatedTraditionIds": tsv.json_array(row, tradition_index),
            "associatedLanguageIds": tsv.json_array(row, language_index),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_array(row, sources_index),
        }
        for row in rows
    ]


def load_cuisine_items(lexicons: Path) -> list[Record]:
    """`cuisine-items.tsv` → the dish records (``loadCuisineItems``)."""
    parsed = tsv.read_tsv(lexicons, "cuisine-items.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    cuisine_index = tsv.required_index(header, "cuisine_id")
    name_index = tsv.required_index(header, "name")
    type_index = tsv.index_of(header, "food_type")
    origin_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")

    return [
        {
            "id": tsv.cell(row, id_index),
            "cuisineId": tsv.cell(row, cuisine_index),
            "name": tsv.cell(row, name_index),
            "foodType": tsv.text_cell(row, type_index),
            "timeOrigin": _int(row, origin_index),
            "timeEnd": _int(row, end_index),
        }
        for row in rows
    ]


def load_migration_routes(lexicons: Path) -> list[Record]:
    """`migration-routes.tsv` → the route records (``loadMigrationRoutes``).

    `waypoints` is a GeoJSON LineString, so its unparseable/absent fallback is an
    empty **object** — every other JSON column here falls back to a list.
    """
    parsed = tsv.read_tsv(lexicons, "migration-routes.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.index_of(header, "name")
    type_index = tsv.index_of(header, "route_type")
    waypoints_index = tsv.index_of(header, "waypoints")
    start_index = tsv.index_of(header, "start_date")
    end_index = tsv.index_of(header, "end_date")
    peoples_index = tsv.index_of(header, "peoples")
    language_index = tsv.index_of(header, "associated_languages")
    description_index = tsv.index_of(header, "description")
    consequences_index = tsv.index_of(header, "consequences")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.text_cell(row, name_index),
            "routeType": tsv.text_cell(row, type_index),
            "waypoints": tsv.json_cell(row, waypoints_index, {}),
            "startDate": tsv.text_cell(row, start_index),
            "endDate": tsv.text_cell(row, end_index),
            "peoples": tsv.json_array(row, peoples_index),
            "associatedLanguages": tsv.json_array(row, language_index),
            "description": tsv.text_cell(row, description_index),
            "consequences": tsv.text_cell(row, consequences_index),
        }
        for row in rows
    ]


def load_art_traditions(lexicons: Path) -> list[Record]:
    """`art-traditions.tsv` → the tradition records (``loadArtTraditions``).

    ``associated_civilizations`` is read as a **string**, not a JSON array — the
    one column in this file the loader does not parse. Kept as found.
    """
    parsed = tsv.read_tsv(lexicons, "art-traditions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    period_index = tsv.required_index(header, "style_period")
    origin_index = tsv.required_index(header, "origin_date")
    end_index = tsv.required_index(header, "end_date")
    coordinates_index = tsv.required_index(header, "origin_coordinates")
    description_index = tsv.required_index(header, "description")
    civilization_index = tsv.index_of(header, "associated_civilizations")
    language_index = tsv.required_index(header, "associated_languages")
    features_index = tsv.required_index(header, "key_features")
    examples_index = tsv.required_index(header, "notable_examples")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.cell(row, category_index),
            "stylePeriod": tsv.cell(row, period_index),
            "originDate": tsv.int_or_zero(row, origin_index),
            "endDate": tsv.int_or_zero(row, end_index),
            "originCoordinates": _coordinates(row, coordinates_index),
            "description": tsv.cell(row, description_index),
            "associatedCivilizations": tsv.text_cell(row, civilization_index),
            "associatedLanguages": tsv.json_array(row, language_index),
            "keyFeatures": tsv.json_array(row, features_index),
            "notableExamples": tsv.json_array(row, examples_index),
        }
        for row in rows
    ]


def load_architectural_styles(lexicons: Path) -> list[Record]:
    """`architectural-styles.tsv` → the style records (``loadArchitecturalStyles``)."""
    parsed = tsv.read_tsv(lexicons, "architectural-styles.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    period_index = tsv.required_index(header, "style_period")
    origin_index = tsv.required_index(header, "origin_date")
    end_index = tsv.required_index(header, "end_date")
    coordinates_index = tsv.required_index(header, "origin_coordinates")
    region_index = tsv.required_index(header, "region")
    description_index = tsv.required_index(header, "description")
    civilization_index = tsv.index_of(header, "associated_civilizations")
    language_index = tsv.required_index(header, "associated_languages")
    features_index = tsv.required_index(header, "key_features")
    examples_index = tsv.required_index(header, "notable_examples")
    building_index = tsv.required_index(header, "building_types")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "stylePeriod": tsv.cell(row, period_index),
            "originDate": tsv.int_or_zero(row, origin_index),
            "endDate": tsv.int_or_zero(row, end_index),
            "originCoordinates": _coordinates(row, coordinates_index),
            "region": tsv.text_cell(row, region_index),
            "description": tsv.cell(row, description_index),
            "associatedCivilizations": tsv.text_cell(row, civilization_index),
            "associatedLanguages": tsv.json_array(row, language_index),
            "keyFeatures": tsv.json_array(row, features_index),
            "notableExamples": tsv.json_array(row, examples_index),
            "buildingTypes": tsv.json_array(row, building_index),
        }
        for row in rows
    ]


def load_kinship_systems(lexicons: Path) -> list[Record]:
    """`kinship-systems.tsv` → the kinship records (``loadKinshipSystems``).

    The only domain here with **no name column** — a system is identified by its
    `system_type` and its id, which is why global search displays it as
    ``"<system type> (<id>)"``.
    """
    parsed = tsv.read_tsv(lexicons, "kinship-systems.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    type_index = tsv.required_index(header, "system_type")
    language_index = tsv.required_index(header, "language_ids")
    terminology_index = tsv.required_index(header, "terminology")
    descent_index = tsv.required_index(header, "descent_rule")
    residence_index = tsv.index_of(header, "residence_rule")
    civilization_index = tsv.index_of(header, "associated_civilizations")

    return [
        {
            "id": tsv.cell(row, id_index),
            "systemType": tsv.cell(row, type_index),
            "languageIds": tsv.json_array(row, language_index),
            "terminology": tsv.json_cell(row, terminology_index, {}),
            "descentRule": tsv.cell(row, descent_index),
            "residenceRule": tsv.text_cell(row, residence_index),
            "associatedCivilizations": tsv.text_cell(row, civilization_index),
        }
        for row in rows
    ]


def load_foodway_events(lexicons: Path) -> list[Record]:
    """`foodway-events.tsv` → the diffusion records (``loadFoodwayEvents``).

    Both coordinate columns are ``[lat, lng]`` **pairs** whose fallback is
    ``[0, 0]`` — the same asymmetry `battles.tsv` has, and the opposite of the
    ``{lat, lng}`` object art traditions and trade goods carry.
    """
    parsed = tsv.read_tsv(lexicons, "foodway-events.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    food_index = tsv.required_index(header, "food_item")
    origin_region_index = tsv.required_index(header, "origin_region")
    origin_coordinates_index = tsv.required_index(header, "origin_coordinates")
    destination_region_index = tsv.required_index(header, "destination_region")
    destination_coordinates_index = tsv.required_index(
        header, "destination_coordinates"
    )
    date_index = tsv.required_index(header, "date")
    mechanism_index = tsv.index_of(header, "mechanism")
    route_index = tsv.index_of(header, "associated_route_id")
    description_index = tsv.index_of(header, "description")
    impact_index = tsv.index_of(header, "cultural_impact")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "foodItem": tsv.cell(row, food_index),
            "originRegion": tsv.cell(row, origin_region_index),
            "originCoordinates": tsv.json_cell(
                row, origin_coordinates_index, [0, 0]
            ),
            "destinationRegion": tsv.cell(row, destination_region_index),
            "destinationCoordinates": tsv.json_cell(
                row, destination_coordinates_index, [0, 0]
            ),
            "date": tsv.int_or_zero(row, date_index),
            "mechanism": tsv.text_cell(row, mechanism_index),
            "associatedRouteId": tsv.text_cell(row, route_index),
            "description": tsv.text_cell(row, description_index),
            "culturalImpact": tsv.text_cell(row, impact_index),
        }
        for row in rows
    ]


def load_settlements(lexicons: Path) -> list[Record]:
    """`settlements.tsv` → the settlement records (``loadSettlements``).

    Coordinates are two flat columns read through ``parseFloat(cell) || 0``, so
    a blank or unparseable latitude is the equator rather than a missing point —
    the same "blank cell is the origin" rule the object-coordinate loaders have,
    arrived at from the other direction.
    """
    parsed = tsv.read_tsv(lexicons, "settlements.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    alternate_index = tsv.index_of(header, "alternate_names")
    latitude_index = tsv.index_of(header, "latitude")
    longitude_index = tsv.index_of(header, "longitude")
    type_index = tsv.index_of(header, "type")
    culture_index = tsv.index_of(header, "culture_id")
    civilization_index = tsv.index_of(header, "civilization_id")
    founded_index = tsv.index_of(header, "founded_year")
    abandoned_index = tsv.index_of(header, "abandoned_year")
    population_index = tsv.index_of(header, "peak_population")
    features_index = tsv.index_of(header, "notable_features")
    language_index = tsv.index_of(header, "associated_languages")
    modern_index = tsv.index_of(header, "modern_name")
    region_index = tsv.index_of(header, "region")

    def _degrees(row: list[str], index: int) -> float | int:
        if index < 0:
            return 0
        value = tsv.js_parse_float(tsv.cell(row, index))
        if math.isnan(value) or value == 0:
            return 0
        return int(value) if value.is_integer() else value

    def _population(row: list[str], index: int) -> int | None:
        # `parseInt(cell, 10) || null` — a population of literally 0 is unknown.
        parsed_population = tsv.nullable_int(row, index)
        return parsed_population or None

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "alternateNames": tsv.json_array(row, alternate_index),
            "latitude": _degrees(row, latitude_index),
            "longitude": _degrees(row, longitude_index),
            "type": tsv.text_cell(row, type_index),
            "cultureId": tsv.text_cell(row, culture_index),
            "civilizationId": tsv.text_cell(row, civilization_index),
            "foundedYear": _int(row, founded_index),
            "abandonedYear": _int(row, abandoned_index),
            "peakPopulation": _population(row, population_index),
            "notableFeatures": tsv.json_array(row, features_index),
            "associatedLanguages": tsv.json_array(row, language_index),
            "modernName": tsv.text_cell(row, modern_index),
            "region": tsv.text_cell(row, region_index),
        }
        for row in rows
    ]


# ── The geospatial layers ────────────────────────────────────────────────────


#: The route types ``loadHistoricalRoutes`` recognises; anything else becomes
#: ``"unknown"``. The record's own spelling is not kept anywhere alongside it, so
#: a route typed `caravan` reaches the client indistinguishable from one whose
#: `route_type` cell is blank.
HISTORICAL_ROUTE_TYPES: frozenset[str] = frozenset(
    {
        "trade",
        "migration",
        "conquest",
        "colonization",
        "diaspora",
        "pilgrimage",
        "communication",
    }
)


def _int_if_present(row: list[str], index: int) -> int | None:
    """``idx >= 0 && cell ? parseInt(cell, 10) : undefined``.

    The empires-timeline feature loader's read, and the one place a numeric
    column is **not** guarded against the literal ``"null"`` — so that cell
    reaches ``parseInt`` and yields ``NaN`` rather than the sentinel every other
    loader recognises. Collapsed to absent here, per this module's `NaN` rule.
    """
    raw = tsv.cell(row, index)
    if index < 0 or not raw:
        return None
    parsed = tsv.js_parse_int(raw)
    return None if math.isnan(parsed) else int(parsed)


def _int_present_or_zero(row: list[str], index: int) -> int | None:
    """``idx >= 0 && cell ? parseInt(cell, 10) : 0`` — the same read, zero-based.

    Absent is **0** and unparseable is absent, which is the distinction
    :func:`_int_if_present` cannot carry on its own.
    """
    if index < 0 or not tsv.cell(row, index):
        return 0
    return _int_if_present(row, index)


def _language_range_features(lexicons: Path, filename: str) -> list[Feature]:
    """The body ``loadLanguageRanges`` and ``loadLanguageRangePolygons`` share.

    The two TypeScript methods are the same fifty lines twice over the same
    column vocabulary, differing only in the file they read — the expanded
    polygon dataset is a second table in the first one's schema, not a second
    schema. One function here, called with two filenames.

    **A row with no geometry does not exist**, and neither does one whose
    geometry will not parse: both are dropped before anything can find them, the
    same rule `load_archaeological_sites` applies to its coordinates.
    """
    parsed = tsv.read_tsv(lexicons, filename)
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    language_index = tsv.required_index(header, "language_id")
    family_index = tsv.required_index(header, "family_id")
    geometry_index = tsv.required_index(header, "geometry")
    type_index = tsv.required_index(header, "range_type")
    start_index = tsv.index_of(header, "time_period_start")
    end_index = tsv.index_of(header, "time_period_end")
    label_index = tsv.index_of(header, "time_period_label")
    confidence_index = tsv.index_of(header, "confidence")
    sources_index = tsv.index_of(header, "sources")

    features: list[Feature] = []
    for row in rows:
        if not tsv.cell(row, geometry_index).strip():
            continue
        geometry = tsv.json_cell(row, geometry_index, None)
        if geometry is None:
            continue
        language_id = tsv.cell(row, language_index)
        family_id = tsv.cell(row, family_index)
        features.append(
            {
                "type": "Feature",
                "id": tsv.cell(row, id_index),
                "geometry": geometry,
                "properties": {
                    # Both names are the *id* again. The TypeScript's comment
                    # says "will be enriched later" and nothing ever does, so
                    # the client renders the id — reproduced, not corrected.
                    "languageId": language_id,
                    "languageName": language_id,
                    "familyId": family_id,
                    "familyName": family_id,
                    "rangeType": tsv.text_cell(row, type_index, "historical"),
                    "timePeriod": _time_period(
                        _int_or(row, start_index, 0),
                        _int(row, end_index),
                        tsv.text_cell(row, label_index),
                    ),
                    "confidence": _int_default(row, confidence_index, 50),
                    "sources": tsv.json_cell(row, sources_index, []),
                },
            }
        )
    return features


def load_language_ranges(lexicons: Path) -> list[Feature]:
    """`language-ranges.tsv` → GeoJSON territory features (``loadLanguageRanges``)."""
    return _language_range_features(lexicons, "language-ranges.tsv")


def load_language_range_polygons(lexicons: Path) -> list[Feature]:
    """`language-range-polygons.tsv` → the expanded polygon dataset.

    ``loadLanguageRangePolygons``. Same shape as :func:`load_language_ranges`,
    and the only loader whose records carry a `rangeType` the route filters on.
    """
    return _language_range_features(lexicons, "language-range-polygons.tsv")


def load_empires_timeline(lexicons: Path) -> list[Feature]:
    """`empires-timeline.tsv` → GeoJSON empire-phase features.

    ``loadEmpiresTimeline`` — and **on the corpus in this repo it raises**, which
    is the port's job to reproduce rather than paper over. The file's columns are
    the *event* vocabulary (`year`, `event_type`, `empire_name`); this loader
    asks for `name` with ``getIdx``, which throws, so `GET /api/map/empires-timeline`
    is a 500 on both backends. :func:`load_empire_timeline` is the loader that
    reads the same file successfully, for the flat `/api/empires-timeline` group.

    Two shapes are kept as found: a row with no usable geometry gets the
    :data:`PLACEHOLDER_RING` square at the origin so the layer still renders it,
    and `phase` is read *without* a ``|| "peak"`` fallback — a blank cell really
    is a blank phase, and only an absent **column** defaults.
    """
    parsed = tsv.read_tsv(lexicons, "empires-timeline.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    empire_index = tsv.required_index(header, "empire_id")
    name_index = tsv.required_index(header, "name")
    phase_index = tsv.index_of(header, "phase")
    start_index = tsv.index_of(header, "time_start")
    end_index = tsv.index_of(header, "time_end")
    label_index = tsv.index_of(header, "time_label")
    geometry_index = tsv.index_of(header, "geometry")
    capital_index = tsv.index_of(header, "capital")
    area_index = tsv.index_of(header, "territory_km2")
    population_index = tsv.index_of(header, "population")
    event_index = tsv.index_of(header, "key_event")
    successor_index = tsv.index_of(header, "successor_id")
    predecessor_index = tsv.index_of(header, "predecessor_id")
    language_index = tsv.index_of(header, "associated_language_ids")
    sources_index = tsv.index_of(header, "sources")
    notes_index = tsv.index_of(header, "notes")

    features: list[Feature] = []
    for row in rows:
        geometry = tsv.json_cell(row, geometry_index, None)
        if not geometry:
            geometry = {"type": "Polygon", "coordinates": PLACEHOLDER_RING}
        features.append(
            {
                "type": "Feature",
                "id": tsv.cell(row, id_index),
                "geometry": geometry,
                "properties": _defined(
                    empireId=tsv.cell(row, empire_index),
                    name=tsv.cell(row, name_index),
                    phase=(
                        tsv.cell(row, phase_index) if phase_index >= 0 else "peak"
                    ),
                    timePeriod=_time_period(
                        _int_present_or_zero(row, start_index),
                        _int(row, end_index),
                        tsv.text_cell(row, label_index),
                    ),
                    capital=tsv.optional_text(row, capital_index),
                    territoryKm2=_int_if_present(row, area_index),
                    population=_int_if_present(row, population_index),
                    keyEvent=tsv.text_cell(row, event_index),
                    successorId=tsv.optional_text(row, successor_index),
                    predecessorId=tsv.optional_text(row, predecessor_index),
                    associatedLanguageIds=tsv.json_cell(row, language_index, []),
                    sources=tsv.json_cell(row, sources_index, []),
                    notes=tsv.optional_text(row, notes_index),
                ),
            }
        )
    return features


def load_historical_routes(lexicons: Path) -> list[Feature]:
    """migration routes + trade goods → GeoJSON route features.

    ``loadHistoricalRoutes``. The only loader in this module that **joins** two
    files: a trade good names the routes it travelled, so the reverse index
    (route id → good names) has to be built from the goods side.

    **A route whose `waypoints` is not a LineString does not exist here** — the
    geometry *is* the feature, and there is nothing to draw without one. It is
    still returned by `GET /api/migration-routes`, which reads the flat records.
    """
    goods_by_route: dict[str, list[str]] = {}
    for good in load_trade_goods(lexicons):
        for route_id in good["tradeRoutes"]:
            goods_by_route.setdefault(route_id, []).append(good["name"])

    features: list[Feature] = []
    for route in load_migration_routes(lexicons):
        waypoints = route["waypoints"]
        if not isinstance(waypoints, dict) or waypoints.get("type") != "LineString":
            continue
        start_year = tsv.js_parse_int(route["startDate"])
        end_year = tsv.js_parse_int(route["endDate"])
        route_type = route["routeType"]
        traded = goods_by_route.get(route["id"])
        features.append(
            {
                "type": "Feature",
                "id": route["id"],
                "geometry": waypoints,
                "properties": _defined(
                    routeId=route["id"],
                    name=route["name"],
                    routeType=(
                        route_type
                        if route_type in HISTORICAL_ROUTE_TYPES
                        else "unknown"
                    ),
                    timePeriod=_time_period(
                        0 if math.isnan(start_year) else int(start_year),
                        None if math.isnan(end_year) else int(end_year),
                        f"{route['startDate']} to {route['endDate']}",
                    ),
                    associatedLanguageIds=route["associatedLanguages"],
                    linguisticImpact=route["consequences"] or None,
                    tradedGoods=traded or None,
                    # The *raw* route type, not the validated one above: a route
                    # typed `caravan` is `unknown` and unidirectional, but one
                    # typed `trade` stays bidirectional whichever way it is read.
                    direction=(
                        "bidirectional" if route_type == "trade" else "unidirectional"
                    ),
                    sources=[],
                ),
            }
        )
    return features


def load_material_cultures(lexicons: Path) -> list[Record]:
    """`material-culture.tsv` → the material-culture records (``loadMaterialCultures``).

    `origin_coordinates` is a **`[lat, lng]` pair**, not the `{lat, lng}` object
    the archaeological loaders carry — and the distribution projection indexes it
    positionally, so the two spellings are not interchangeable. `spread_data` is
    a list of `{date, coordinates, associated_civilization}` objects, the one
    column here read as objects rather than strings.
    """
    parsed = tsv.read_tsv(lexicons, "material-culture.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    origin_date_index = tsv.required_index(header, "origin_date")
    origin_coordinates_index = tsv.required_index(header, "origin_coordinates")
    spread_index = tsv.required_index(header, "spread_data")
    description_index = tsv.index_of(header, "description")
    language_index = tsv.index_of(header, "associated_languages")
    significance_index = tsv.index_of(header, "significance")

    def _spread(row: list[str]) -> list[Record]:
        # `JSON.parse(cell).map(...)` inside one try/catch: a cell that is not a
        # list makes `.map` throw, so the whole column degrades to empty rather
        # than to a partial reading.
        events = tsv.json_cell(row, spread_index, None)
        if not isinstance(events, list):
            return []
        mapped: list[Record] = []
        for event in events:
            if not isinstance(event, dict):
                return []
            mapped.append(
                _defined(
                    date=event.get("date"),
                    coordinates=event.get("coordinates"),
                    associatedCivilization=event.get("associated_civilization") or "",
                )
            )
        return mapped

    def _languages(row: list[str]) -> list[str]:
        raw = tsv.text_cell(row, language_index)
        return [part.strip() for part in raw.split(",")] if raw else []

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.text_cell(row, category_index, "unknown"),
            "originDate": tsv.int_or_zero(row, origin_date_index),
            "originCoordinates": tsv.json_cell(
                row, origin_coordinates_index, [0, 0]
            ),
            "spreadData": _spread(row),
            "description": tsv.text_cell(row, description_index),
            "associatedLanguages": _languages(row),
            "significance": tsv.text_cell(row, significance_index),
        }
        for row in rows
    ]


def load_archaeological_cultures(lexicons: Path) -> list[Record]:
    """`archaeological-cultures.tsv` → the culture records.

    ``loadArchaeologicalCultures``.

    Three columns this loader names are **not in the file**: `associated_language_ids`,
    `associated_civilization_ids` and `material_goods`, plus `predecessor_culture_id`
    where the corpus writes `predecessor_culture_ids`. All four are optional
    reads, so they answer `[]`/`""` rather than raising — which is why
    `?language=` on `/api/archaeological-cultures` selects nothing at all.
    Reproduced: fixing it here would make the two backends disagree mid-cutover.
    """
    parsed = tsv.read_tsv(lexicons, "archaeological-cultures.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    region_index = tsv.index_of(header, "region")
    coordinates_index = tsv.index_of(header, "coordinates")
    start_index = tsv.index_of(header, "time_period_start")
    end_index = tsv.index_of(header, "time_period_end")
    label_index = tsv.index_of(header, "time_period_label")
    language_index = tsv.index_of(header, "associated_language_ids")
    civilization_index = tsv.index_of(header, "associated_civilization_ids")
    predecessor_index = tsv.index_of(header, "predecessor_culture_id")
    successor_index = tsv.index_of(header, "successor_culture_ids")
    goods_index = tsv.index_of(header, "material_goods")
    description_index = tsv.index_of(header, "description")
    confidence_index = tsv.index_of(header, "confidence")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "region": tsv.text_cell(row, region_index),
            "coordinates": _coordinates(row, coordinates_index),
            "timePeriodStart": _int(row, start_index),
            "timePeriodEnd": _int(row, end_index),
            "timePeriodLabel": tsv.text_cell(row, label_index),
            "associatedLanguageIds": tsv.json_cell(row, language_index, []),
            "associatedCivilizationIds": tsv.json_cell(row, civilization_index, []),
            "predecessorCultureId": tsv.text_cell(row, predecessor_index),
            "successorCultureIds": tsv.json_cell(row, successor_index, []),
            "materialGoods": tsv.json_cell(row, goods_index, []),
            "description": tsv.text_cell(row, description_index),
            "confidence": tsv.int_or_zero(row, confidence_index),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


def load_trade_routes(lexicons: Path) -> list[Record]:
    """`trade-routes.tsv` → the trade-route records (``loadTradeRoutes``).

    Not to be confused with :func:`load_historical_routes`, which is what
    `GET /api/trade-routes` (the *list*) answers from — `routes.ts` registers
    that path twice and the first registration wins. This loader is reached only
    by `GET /api/trade-routes/{id}`, so the two halves of one client-visible
    resource read different files. Reproduced; see `routers/map_layers.py`.
    """
    parsed = tsv.read_tsv(lexicons, "trade-routes.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.index_of(header, "name")
    type_index = tsv.index_of(header, "route_type")
    waypoints_index = tsv.index_of(header, "waypoints")
    start_index = tsv.index_of(header, "start_date")
    end_index = tsv.index_of(header, "end_date")
    goods_index = tsv.index_of(header, "traded_goods")
    cities_index = tsv.index_of(header, "key_cities")
    powers_index = tsv.index_of(header, "controlling_powers")
    language_index = tsv.index_of(header, "associated_languages")
    description_index = tsv.index_of(header, "description")
    impact_index = tsv.index_of(header, "economic_impact")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.text_cell(row, name_index),
            "routeType": tsv.text_cell(row, type_index),
            "waypoints": tsv.json_cell(row, waypoints_index, {}),
            "startDate": tsv.text_cell(row, start_index),
            "endDate": tsv.text_cell(row, end_index),
            "tradedGoods": tsv.json_cell(row, goods_index, []),
            "keyCities": tsv.json_cell(row, cities_index, []),
            "controllingPowers": tsv.json_cell(row, powers_index, []),
            "associatedLanguages": tsv.json_cell(row, language_index, []),
            "description": tsv.text_cell(row, description_index),
            "economicImpact": tsv.text_cell(row, impact_index),
        }
        for row in rows
    ]


def load_empire_timeline(lexicons: Path) -> list[Record]:
    """`empires-timeline.tsv` → the empire *event* records (``loadEmpireTimeline``).

    The second of two loaders over one file, and the one whose column vocabulary
    the corpus actually has (:func:`load_empires_timeline` raises on it). `year`
    is required and unguarded, so a row with an unparseable year carries a
    ``null`` year and drops out of every bounded query — kept, because a year
    this reader cannot read is not a year the filter should guess at.
    """
    parsed = tsv.read_tsv(lexicons, "empires-timeline.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    empire_index = tsv.required_index(header, "empire_id")
    empire_name_index = tsv.index_of(header, "empire_name")
    year_index = tsv.required_index(header, "year")
    event_index = tsv.index_of(header, "event_type")
    territory_index = tsv.index_of(header, "territory_change")
    capital_index = tsv.index_of(header, "capital")
    population_index = tsv.index_of(header, "population_estimate")
    ruler_index = tsv.index_of(header, "ruler")
    government_index = tsv.index_of(header, "government_type")
    vassal_index = tsv.index_of(header, "vassal_states")
    rival_index = tsv.index_of(header, "rival_empires")
    language_index = tsv.index_of(header, "associated_language_ids")
    description_index = tsv.index_of(header, "description")

    def _year(row: list[str]) -> int | None:
        parsed_year = tsv.js_parse_int(tsv.cell(row, year_index))
        return None if math.isnan(parsed_year) else int(parsed_year)

    return [
        {
            "id": tsv.cell(row, id_index),
            "empireId": tsv.cell(row, empire_index),
            "empireName": tsv.text_cell(row, empire_name_index),
            "year": _year(row),
            "eventType": tsv.text_cell(row, event_index),
            "territoryChange": tsv.text_cell(row, territory_index),
            "capital": tsv.text_cell(row, capital_index),
            # `parseInt(cell) || null` guarded by a truthiness test on the cell:
            # a population estimate of literally 0 reads as unknown.
            "populationEstimate": _int_if_present(row, population_index),
            "ruler": tsv.text_cell(row, ruler_index),
            "governmentType": tsv.text_cell(row, government_index),
            "vassalStates": tsv.json_cell(row, vassal_index, []),
            "rivalEmpires": tsv.json_cell(row, rival_index, []),
            "associatedLanguageIds": tsv.json_cell(row, language_index, []),
            "description": tsv.text_cell(row, description_index),
        }
        for row in rows
    ]


# ── The ethnographic, linguistic and literary tables (pinakes:80 US-1, slice 4) ─
#
# Twenty-three more ``load*`` methods, all of them the same shape as the ones
# above. Two cell readers below are new because these files are the only ones
# that use them: a pipe-separated list and the "either a JSON array or a
# comma-separated string" column `rivers-and-waters.tsv` carries.


def _text_unless_null(row: list[str], index: int) -> str | None:
    """``idx >= 0 && cell && cell !== "null" ? cell : null``.

    :func:`pinakes.analytics.tsv.optional_text` without the sentinel check — a
    `parent_id` column written by a serializer that stringified ``null`` is the
    reason this exists, and only the haplogroup loader spells it.
    """
    raw = tsv.cell(row, index)
    return None if not raw or raw == "null" else raw


def _pipe_list(row: list[str], index: int) -> list[str]:
    """``(cell || "").split("|").map(trim).filter(Boolean)``.

    The city-layout and social-structure files store lists this way rather than
    as JSON, so a blank cell is an empty list and a trailing separator is not an
    empty entry.
    """
    raw = tsv.cell(row, index)
    if index < 0 or not raw:
        return []
    return [part.strip() for part in raw.split("|") if part.strip()]


def _loose_list(row: list[str], index: int) -> list[str]:
    """`rivers-and-waters.tsv`'s "JSON array *or* comma-separated" columns.

    The only reader in the corpus that sniffs its own cell: a value starting
    ``[`` is parsed as JSON (unparseable ⇒ empty), anything else is split on
    commas. A hand-authored `associated_languages` cell really is written both
    ways in that file.
    """
    raw = tsv.cell(row, index)
    if index < 0 or not raw:
        return []
    trimmed = raw.strip()
    if trimmed.startswith("["):
        parsed = tsv.json_cell(row, index, None)
        return parsed if isinstance(parsed, list) else []
    return [part.strip() for part in trimmed.split(",") if part.strip()]


def load_haplogroups(lexicons: Path) -> list[Record]:
    """`haplogroups.tsv` → the Y-chromosome haplogroup records.

    ``loadHaplogroups``. `haplogroup_type` defaults to ``"Y-chromosome"``
    because that is all the corpus carries; the column exists so a maternal
    line can be added without a reader change.
    """
    parsed = tsv.read_tsv(lexicons, "haplogroups.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    parent_index = tsv.index_of(header, "parent_id")
    type_index = tsv.index_of(header, "haplogroup_type")
    description_index = tsv.index_of(header, "description")
    family_index = tsv.index_of(header, "associated_language_family_ids")
    civilization_index = tsv.index_of(header, "associated_civilization_ids")
    origin_index = tsv.index_of(header, "geographic_origin")
    time_index = tsv.index_of(header, "time_origin")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "parentId": _text_unless_null(row, parent_index),
            "haplogroupType": tsv.text_cell(row, type_index, "Y-chromosome"),
            "description": tsv.text_cell(row, description_index),
            "associatedLanguageFamilyIds": tsv.json_cell(row, family_index, []),
            "associatedCivilizationIds": tsv.json_cell(row, civilization_index, []),
            "geographicOrigin": tsv.text_cell(row, origin_index),
            "timeOrigin": _int(row, time_index),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


def load_dance_traditions(lexicons: Path) -> list[Record]:
    """`dance-traditions.tsv` → the dance records (``loadDanceTraditions``)."""
    parsed = tsv.read_tsv(lexicons, "dance-traditions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    native_index = tsv.index_of(header, "native_name")
    region_index = tsv.index_of(header, "region")
    coordinates_index = tsv.index_of(header, "coordinates")
    start_index = tsv.index_of(header, "time_origin")
    end_index = tsv.index_of(header, "time_end")
    language_index = tsv.index_of(header, "associated_language_ids")
    type_index = tsv.index_of(header, "dance_type")
    music_index = tsv.index_of(header, "associated_music_tradition_ids")
    costume_index = tsv.index_of(header, "costumes")
    movement_index = tsv.index_of(header, "key_movements")
    significance_index = tsv.index_of(header, "cultural_significance")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "nativeName": tsv.text_cell(row, native_index),
            "region": tsv.text_cell(row, region_index),
            "coordinates": _coordinates(row, coordinates_index),
            "timeOrigin": _int(row, start_index),
            "timeEnd": _int(row, end_index),
            "associatedLanguageIds": tsv.json_cell(row, language_index, []),
            "danceType": tsv.text_cell(row, type_index),
            "associatedMusicTraditionIds": tsv.json_cell(row, music_index, []),
            "costumes": tsv.json_cell(row, costume_index, []),
            "keyMovements": tsv.json_cell(row, movement_index, []),
            "culturalSignificance": tsv.text_cell(row, significance_index),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


def load_ingredient_origins(lexicons: Path) -> list[Record]:
    """`ingredient-origins.tsv` → the ingredient records (``loadIngredientOrigins``)."""
    parsed = tsv.read_tsv(lexicons, "ingredient-origins.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    region_index = tsv.index_of(header, "origin_region")
    coordinates_index = tsv.index_of(header, "origin_coordinates")
    domestication_index = tsv.index_of(header, "domestication_date")
    spread_index = tsv.index_of(header, "spread_routes")
    cuisines_index = tsv.index_of(header, "cuisines_adopted")
    language_index = tsv.index_of(header, "associated_languages")
    distribution_index = tsv.index_of(header, "modern_distribution")
    description_index = tsv.index_of(header, "description")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.text_cell(row, category_index),
            "originRegion": tsv.text_cell(row, region_index),
            "originCoordinates": _coordinates(row, coordinates_index),
            "domesticationDate": _int(row, domestication_index),
            "spreadRoutes": tsv.json_cell(row, spread_index, []),
            "cuisinesAdopted": tsv.json_cell(row, cuisines_index, []),
            "associatedLanguages": tsv.json_cell(row, language_index, []),
            "modernDistribution": tsv.text_cell(row, distribution_index),
            "description": tsv.text_cell(row, description_index),
        }
        for row in rows
    ]


def load_cooking_techniques(lexicons: Path) -> list[Record]:
    """`cooking-techniques.tsv` → the technique records (``loadCookingTechniques``)."""
    parsed = tsv.read_tsv(lexicons, "cooking-techniques.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    region_index = tsv.index_of(header, "origin_region")
    coordinates_index = tsv.index_of(header, "origin_coordinates")
    time_index = tsv.index_of(header, "time_origin")
    culture_index = tsv.index_of(header, "origin_culture")
    spread_index = tsv.index_of(header, "spread_pattern")
    cuisines_index = tsv.index_of(header, "cuisines_using")
    related_index = tsv.index_of(header, "related_techniques")
    language_index = tsv.index_of(header, "associated_languages")
    description_index = tsv.index_of(header, "description")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.text_cell(row, category_index),
            "originRegion": tsv.text_cell(row, region_index),
            "originCoordinates": _coordinates(row, coordinates_index),
            "timeOrigin": _int(row, time_index),
            "originCulture": tsv.text_cell(row, culture_index),
            "spreadPattern": tsv.json_cell(row, spread_index, []),
            "cuisinesUsing": tsv.json_cell(row, cuisines_index, []),
            "relatedTechniques": tsv.json_cell(row, related_index, []),
            "associatedLanguages": tsv.json_cell(row, language_index, []),
            "description": tsv.text_cell(row, description_index),
        }
        for row in rows
    ]


def load_sample_texts(lexicons: Path) -> list[Record]:
    """`sample-texts.tsv` → the attested-text records (``loadSampleTexts``).

    `transliteration` is the one cell in this file that is **trimmed**; the
    others are not, so a text with leading whitespace keeps it.
    """
    parsed = tsv.read_tsv(lexicons, "sample-texts.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    language_index = tsv.required_index(header, "language_id")
    title_index = tsv.index_of(header, "title")
    text_index = tsv.index_of(header, "text")
    transliteration_index = tsv.index_of(header, "transliteration")
    translation_index = tsv.index_of(header, "translation_en")
    source_index = tsv.index_of(header, "source")
    date_index = tsv.index_of(header, "date_composed")
    genre_index = tsv.index_of(header, "genre")
    script_index = tsv.index_of(header, "script")

    return [
        {
            "id": tsv.cell(row, id_index),
            "languageId": tsv.cell(row, language_index),
            "title": tsv.text_cell(row, title_index),
            "text": tsv.text_cell(row, text_index),
            "transliteration": tsv.text_cell(row, transliteration_index).strip(),
            "translationEn": tsv.text_cell(row, translation_index),
            "source": tsv.text_cell(row, source_index),
            "dateComposed": tsv.text_cell(row, date_index),
            "genre": tsv.text_cell(row, genre_index),
            "script": tsv.text_cell(row, script_index),
        }
        for row in rows
    ]


def load_phonological_inventories(lexicons: Path) -> list[Record]:
    """`phonological-inventories.tsv` → the inventories.

    ``loadPhonologicalInventories``. `tones` is the only column in the corpus
    with **three** readings: absent/`"null"` ⇒ ``null``, unparseable ⇒ ``null``,
    parseable ⇒ whatever it parsed to. A tonal inventory of ``[]`` and a
    non-tonal language are different claims and the client renders them
    differently.
    """
    parsed = tsv.read_tsv(lexicons, "phonological-inventories.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    language_index = tsv.required_index(header, "language_id")
    consonant_index = tsv.index_of(header, "consonants")
    vowel_index = tsv.index_of(header, "vowels")
    tone_index = tsv.index_of(header, "tones")
    pattern_index = tsv.index_of(header, "phonotactic_patterns")
    syllable_index = tsv.index_of(header, "syllable_structure")
    stress_index = tsv.index_of(header, "stress_system")

    def _tones(row: list[str]) -> Any:
        raw = tsv.cell(row, tone_index)
        if tone_index < 0 or not raw or raw == "null":
            return None
        return tsv.json_cell(row, tone_index, None)

    return [
        {
            "id": tsv.cell(row, id_index),
            "languageId": tsv.cell(row, language_index),
            "consonants": tsv.json_cell(row, consonant_index, []),
            "vowels": tsv.json_cell(row, vowel_index, []),
            "tones": _tones(row),
            "phonotacticPatterns": tsv.json_cell(row, pattern_index, {}),
            "syllableStructure": tsv.text_cell(row, syllable_index),
            "stressSystem": tsv.text_cell(row, stress_index),
        }
        for row in rows
    ]


def load_etymology_relations(lexicons: Path) -> list[Record]:
    """`etymology-relations.tsv` → the word-to-word relations.

    ``loadEtymologyRelations``. Every column is required, and every cell is read
    raw — this is the flattest loader in the corpus.
    """
    parsed = tsv.read_tsv(lexicons, "etymology-relations.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    source_word_index = tsv.required_index(header, "source_word")
    source_language_index = tsv.required_index(header, "source_language")
    target_word_index = tsv.required_index(header, "target_word")
    target_language_index = tsv.required_index(header, "target_language")
    relation_index = tsv.required_index(header, "relation_type")

    return [
        {
            "id": tsv.cell(row, id_index),
            "sourceWord": tsv.cell(row, source_word_index),
            "sourceLanguage": tsv.cell(row, source_language_index),
            "targetWord": tsv.cell(row, target_word_index),
            "targetLanguage": tsv.cell(row, target_language_index),
            "relationType": tsv.cell(row, relation_index),
        }
        for row in rows
    ]


def load_grammar_features(lexicons: Path) -> list[Record]:
    """`grammar-features.tsv` → one typological profile per language.

    ``loadGrammarFeatures``.
    """
    parsed = tsv.read_tsv(lexicons, "grammar-features.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    language_index = tsv.required_index(header, "language_id")
    word_order_index = tsv.index_of(header, "word_order")
    morphological_index = tsv.index_of(header, "morphological_type")
    case_index = tsv.index_of(header, "case_system")
    gender_index = tsv.index_of(header, "gender_system")
    number_index = tsv.index_of(header, "number_system")
    tam_index = tsv.index_of(header, "tense_aspect_mood")
    agreement_index = tsv.index_of(header, "agreement_system")
    negation_index = tsv.index_of(header, "negation_strategy")
    question_index = tsv.index_of(header, "question_formation")
    relative_index = tsv.index_of(header, "relative_clause_strategy")
    noun_class_index = tsv.index_of(header, "noun_class_count")
    valency_index = tsv.index_of(header, "verb_valency_changes")
    evidentiality_index = tsv.index_of(header, "evidentiality")
    ergativity_index = tsv.index_of(header, "ergativity")

    return [
        {
            "id": tsv.cell(row, id_index),
            "languageId": tsv.cell(row, language_index),
            "wordOrder": tsv.text_cell(row, word_order_index),
            "morphologicalType": tsv.text_cell(row, morphological_index),
            "caseSystem": tsv.json_cell(row, case_index, []),
            "genderSystem": tsv.json_cell(row, gender_index, []),
            "numberSystem": tsv.json_cell(row, number_index, []),
            "tenseAspectMood": tsv.json_cell(row, tam_index, []),
            "agreementSystem": tsv.text_cell(row, agreement_index),
            "negationStrategy": tsv.text_cell(row, negation_index),
            "questionFormation": tsv.text_cell(row, question_index),
            "relativeClauseStrategy": tsv.text_cell(row, relative_index),
            "nounClassCount": tsv.int_or_zero(row, noun_class_index),
            "verbValencyChanges": tsv.json_cell(row, valency_index, []),
            "evidentiality": tsv.text_cell(row, evidentiality_index),
            "ergativity": tsv.text_cell(row, ergativity_index),
        }
        for row in rows
    ]


def load_verb_paradigms(lexicons: Path) -> list[Record]:
    """`verb-paradigms.tsv` → the conjugation tables (``loadVerbParadigms``).

    `irregular` is ``cell === "true"``, so any other spelling — ``"TRUE"``,
    ``"1"``, a blank — is **false**.
    """
    parsed = tsv.read_tsv(lexicons, "verb-paradigms.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    language_index = tsv.required_index(header, "language_id")
    concept_index = tsv.index_of(header, "verb_concept")
    infinitive_index = tsv.index_of(header, "infinitive_form")
    conjugation_index = tsv.index_of(header, "conjugation_table")
    irregular_index = tsv.index_of(header, "irregular")
    complexity_index = tsv.index_of(header, "complexity_score")
    notes_index = tsv.index_of(header, "notes")

    return [
        {
            "id": tsv.cell(row, id_index),
            "languageId": tsv.cell(row, language_index),
            "verbConcept": tsv.text_cell(row, concept_index),
            "infinitiveForm": tsv.text_cell(row, infinitive_index),
            "conjugationTable": tsv.json_cell(row, conjugation_index, {}),
            "irregular": tsv.cell(row, irregular_index) == "true",
            "complexityScore": tsv.int_or_zero(row, complexity_index),
            "notes": tsv.text_cell(row, notes_index),
        }
        for row in rows
    ]


def load_language_contacts(lexicons: Path) -> list[Record]:
    """`language-contacts.tsv` → the contact events (``loadLanguageContacts``).

    `features_transferred` falls back to the **three empty buckets** rather than
    to ``{}``: the client indexes `phonological`/`lexical`/`grammatical`
    unconditionally.
    """
    parsed = tsv.read_tsv(lexicons, "language-contacts.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    source_index = tsv.index_of(header, "source_language_id")
    target_index = tsv.index_of(header, "target_language_id")
    type_index = tsv.index_of(header, "contact_type")
    period_index = tsv.index_of(header, "time_period")
    region_index = tsv.index_of(header, "region")
    features_index = tsv.index_of(header, "features_transferred")
    example_index = tsv.index_of(header, "example_features")
    intensity_index = tsv.index_of(header, "intensity")

    def _features(row: list[str]) -> Any:
        return tsv.json_cell(
            row,
            features_index,
            {"phonological": [], "lexical": [], "grammatical": []},
        )

    return [
        {
            "id": tsv.cell(row, id_index),
            "sourceLanguageId": tsv.text_cell(row, source_index),
            "targetLanguageId": tsv.text_cell(row, target_index),
            "contactType": tsv.text_cell(row, type_index),
            "timePeriod": tsv.text_cell(row, period_index),
            "region": tsv.text_cell(row, region_index),
            "featuresTransferred": _features(row),
            "exampleFeatures": tsv.text_cell(row, example_index),
            "intensity": tsv.text_cell(row, intensity_index),
        }
        for row in rows
    ]


def load_sound_changes(lexicons: Path) -> list[Record]:
    """`sound-changes.tsv` → the historical sound laws (``loadSoundChanges``)."""
    parsed = tsv.read_tsv(lexicons, "sound-changes.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.index_of(header, "name")
    family_index = tsv.index_of(header, "family_id")
    source_index = tsv.index_of(header, "source_language_id")
    target_index = tsv.index_of(header, "target_language_id")
    rule_index = tsv.index_of(header, "change_rule")
    environment_index = tsv.index_of(header, "environment")
    date_index = tsv.index_of(header, "date_range")
    examples_index = tsv.index_of(header, "examples")
    related_index = tsv.index_of(header, "related_changes")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.text_cell(row, name_index),
            "familyId": tsv.text_cell(row, family_index),
            "sourceLanguageId": tsv.text_cell(row, source_index),
            "targetLanguageId": tsv.text_cell(row, target_index),
            "changeRule": tsv.text_cell(row, rule_index),
            "environment": tsv.text_cell(row, environment_index),
            "dateRange": tsv.text_cell(row, date_index),
            "examples": tsv.json_cell(row, examples_index, []),
            "relatedChanges": tsv.json_cell(row, related_index, []),
        }
        for row in rows
    ]


def load_style_evolutions(lexicons: Path) -> list[Record]:
    """`art-style-evolutions.tsv` → the tradition-to-tradition transitions.

    ``loadStyleEvolutions``. Every column is required.
    """
    parsed = tsv.read_tsv(lexicons, "art-style-evolutions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    from_index = tsv.required_index(header, "from_tradition_id")
    to_index = tsv.required_index(header, "to_tradition_id")
    type_index = tsv.required_index(header, "transition_type")
    date_index = tsv.required_index(header, "transition_date")
    description_index = tsv.required_index(header, "description")
    changes_index = tsv.required_index(header, "key_changes")
    catalysts_index = tsv.required_index(header, "catalysts")

    return [
        {
            "id": tsv.cell(row, id_index),
            "fromTraditionId": tsv.cell(row, from_index),
            "toTraditionId": tsv.cell(row, to_index),
            "transitionType": tsv.cell(row, type_index),
            "transitionDate": tsv.int_or_zero(row, date_index),
            "description": tsv.cell(row, description_index),
            "keyChanges": tsv.json_cell(row, changes_index, []),
            "catalysts": tsv.json_cell(row, catalysts_index, []),
        }
        for row in rows
    ]


def load_building_types(lexicons: Path) -> list[Record]:
    """`building-types.tsv` → the building typology (``loadBuildingTypes``)."""
    parsed = tsv.read_tsv(lexicons, "building-types.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    category_index = tsv.required_index(header, "category")
    parent_index = tsv.required_index(header, "parent_type_id")
    description_index = tsv.required_index(header, "description")
    period_index = tsv.required_index(header, "historical_period")
    regions_index = tsv.required_index(header, "regions")
    styles_index = tsv.required_index(header, "associated_styles")
    features_index = tsv.required_index(header, "structural_features")
    function_index = tsv.required_index(header, "cultural_function")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "category": tsv.text_cell(row, category_index),
            "parentTypeId": tsv.text_cell(row, parent_index),
            "description": tsv.text_cell(row, description_index),
            "historicalPeriod": tsv.text_cell(row, period_index),
            "regions": tsv.json_cell(row, regions_index, []),
            "associatedStyles": tsv.json_cell(row, styles_index, []),
            "structuralFeatures": tsv.json_cell(row, features_index, []),
            "culturalFunction": tsv.text_cell(row, function_index),
        }
        for row in rows
    ]


def load_city_layouts(lexicons: Path) -> list[Record]:
    """`city-layouts.tsv` → the urban-form records (``loadCityLayouts``).

    ``estimated_area_hectares`` carries the literal ``"undetermined"`` for a
    site nobody has surveyed, and that is tested for by name — it is not the
    same as a blank cell to the reader, though both answer ``null``.
    """
    parsed = tsv.read_tsv(lexicons, "city-layouts.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    settlement_index = tsv.index_of(header, "settlement_id")
    culture_index = tsv.index_of(header, "culture_profile_id")
    layout_index = tsv.index_of(header, "layout_type")
    features_index = tsv.index_of(header, "key_features")
    street_index = tsv.index_of(header, "street_pattern")
    water_index = tsv.index_of(header, "water_management")
    fortification_index = tsv.index_of(header, "fortification_type")
    area_index = tsv.index_of(header, "estimated_area_hectares")
    description_index = tsv.index_of(header, "description")
    reconstruction_index = tsv.index_of(header, "reconstruction_notes")
    sources_index = tsv.index_of(header, "sources")

    def _area(row: list[str]) -> float | int | None:
        raw = tsv.cell(row, area_index)
        if area_index < 0 or not raw or raw == "undetermined":
            return None
        value = tsv.js_parse_float(raw)
        if math.isnan(value):
            return None
        return int(value) if value.is_integer() else value

    return [
        {
            "id": tsv.cell(row, id_index),
            "settlementId": tsv.text_cell(row, settlement_index),
            "cultureProfileId": tsv.text_cell(row, culture_index),
            "layoutType": tsv.text_cell(row, layout_index),
            "keyFeatures": _pipe_list(row, features_index),
            "streetPattern": tsv.text_cell(row, street_index),
            "waterManagement": _pipe_list(row, water_index),
            "fortificationType": tsv.text_cell(row, fortification_index),
            "estimatedAreaHectares": _area(row),
            "description": tsv.text_cell(row, description_index),
            "reconstructionNotes": tsv.text_cell(row, reconstruction_index),
            "sources": tsv.text_cell(row, sources_index),
        }
        for row in rows
    ]


def load_social_organization(lexicons: Path) -> list[Record]:
    """`social-organization.tsv` → the ethnographic organisation records.

    ``loadSocialOrganization``. The twelve columns up to `property_inheritance`
    are required and read **raw**; the six after it are optional and blank-
    defaulted. `time_origin`/`time_end` are free text here, not years.
    """
    parsed = tsv.read_tsv(lexicons, "social-organization.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    culture_index = tsv.required_index(header, "culture_or_language")
    region_index = tsv.required_index(header, "region")
    political_index = tsv.required_index(header, "political_structure")
    stratification_index = tsv.required_index(header, "stratification_type")
    subsistence_index = tsv.required_index(header, "subsistence_pattern")
    marriage_index = tsv.required_index(header, "marriage_system")
    descent_index = tsv.required_index(header, "descent_system")
    residence_index = tsv.required_index(header, "residence_pattern")
    kinship_index = tsv.required_index(header, "kinship_terminology")
    property_index = tsv.required_index(header, "property_inheritance")
    gender_index = tsv.index_of(header, "gender_roles")
    age_index = tsv.index_of(header, "age_grades")
    clan_index = tsv.index_of(header, "clan_or_moiety_system")
    time_origin_index = tsv.index_of(header, "time_origin")
    time_end_index = tsv.index_of(header, "time_end")
    notes_index = tsv.index_of(header, "notes")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "cultureOrLanguage": tsv.cell(row, culture_index),
            "region": tsv.cell(row, region_index),
            "politicalStructure": tsv.cell(row, political_index),
            "stratificationType": tsv.cell(row, stratification_index),
            "subsistencePattern": tsv.cell(row, subsistence_index),
            "marriageSystem": tsv.cell(row, marriage_index),
            "descentSystem": tsv.cell(row, descent_index),
            "residencePattern": tsv.cell(row, residence_index),
            "kinshipTerminology": tsv.cell(row, kinship_index),
            "propertyInheritance": tsv.cell(row, property_index),
            "genderRoles": tsv.text_cell(row, gender_index),
            "ageGrades": tsv.text_cell(row, age_index),
            "clanOrMoietySystem": tsv.text_cell(row, clan_index),
            "timeOrigin": tsv.text_cell(row, time_origin_index),
            "timeEnd": tsv.text_cell(row, time_end_index),
            "notes": tsv.text_cell(row, notes_index),
        }
        for row in rows
    ]


def load_social_structures(lexicons: Path) -> list[Record]:
    """`social-structures.tsv` → the per-culture structures.

    ``loadSocialStructures``. `key_roles` is pipe-separated, not JSON.
    """
    parsed = tsv.read_tsv(lexicons, "social-structures.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    culture_index = tsv.required_index(header, "culture_profile_id")
    type_index = tsv.required_index(header, "structure_type")
    name_index = tsv.required_index(header, "name")
    description_index = tsv.required_index(header, "description")
    roles_index = tsv.required_index(header, "key_roles")
    inheritance_index = tsv.required_index(header, "inheritance_pattern")
    decision_index = tsv.required_index(header, "decision_making")
    kinship_index = tsv.required_index(header, "related_kinship_system_id")
    start_index = tsv.required_index(header, "time_period_start")
    end_index = tsv.required_index(header, "time_period_end")
    sources_index = tsv.required_index(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "cultureProfileId": tsv.cell(row, culture_index),
            "structureType": tsv.cell(row, type_index),
            "name": tsv.cell(row, name_index),
            "description": tsv.cell(row, description_index),
            "keyRoles": [
                part for part in tsv.cell(row, roles_index).split("|") if part
            ],
            "inheritancePattern": tsv.cell(row, inheritance_index),
            "decisionMaking": tsv.cell(row, decision_index),
            "relatedKinshipSystemId": tsv.text_cell(row, kinship_index),
            "timePeriodStart": tsv.text_cell(row, start_index),
            "timePeriodEnd": tsv.text_cell(row, end_index),
            "sources": tsv.text_cell(row, sources_index),
        }
        for row in rows
    ]


def load_narratives(lexicons: Path) -> list[Record]:
    """`narratives.tsv` → the guided map tours (``loadNarratives``).

    The `steps` cell is a JSON array of snake_case objects renamed to camelCase
    here. Anything that is not an array of objects degrades the **whole**
    column to ``[]`` rather than to a partial reading — ``rawSteps.map`` throws
    on a non-array, and that throw is caught.
    """
    parsed = tsv.read_tsv(lexicons, "narratives.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    title_index = tsv.required_index(header, "title")
    description_index = tsv.required_index(header, "description")
    steps_index = tsv.required_index(header, "steps")

    def _steps(row: list[str]) -> list[Record]:
        raw = tsv.json_cell(row, steps_index, None)
        if not isinstance(raw, list):
            return []
        steps: list[Record] = []
        for step in raw:
            entry = step if isinstance(step, dict) else {}
            steps.append(
                {
                    "text": entry.get("text") or "",
                    "mapCenter": entry.get("map_center") or [0, 0],
                    "mapZoom": entry.get("map_zoom") or 3,
                    "timePoint": entry.get("time_point") or 0,
                    "highlightedEntities": entry.get("highlighted_entities") or [],
                    "layerConfig": entry.get("layer_config") or {"layers": []},
                }
            )
        return steps

    return [
        {
            "id": tsv.cell(row, id_index),
            "title": tsv.cell(row, title_index),
            "description": tsv.cell(row, description_index),
            "steps": _steps(row),
        }
        for row in rows
    ]


def load_cultural_lineages(lexicons: Path) -> list[Record]:
    """`cultural-lineages.tsv` → the directed descent edges.

    ``loadCulturalLineages``. `time_start`/`time_end`/`confidence` are
    ``parseInt(cell) || 0``, so an unreadable or genuinely-zero value is **0** —
    which is why a lineage dated to year 0 is indistinguishable from an undated
    one here.
    """
    parsed = tsv.read_tsv(lexicons, "cultural-lineages.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    source_id_index = tsv.index_of(header, "source_id")
    source_name_index = tsv.index_of(header, "source_name")
    target_id_index = tsv.index_of(header, "target_id")
    target_name_index = tsv.index_of(header, "target_name")
    relationship_index = tsv.index_of(header, "relationship_type")
    start_index = tsv.index_of(header, "time_start")
    end_index = tsv.index_of(header, "time_end")
    confidence_index = tsv.index_of(header, "confidence")
    evidence_index = tsv.index_of(header, "evidence_types")
    description_index = tsv.index_of(header, "description")
    sources_index = tsv.index_of(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "sourceId": tsv.text_cell(row, source_id_index),
            "sourceName": tsv.text_cell(row, source_name_index),
            "targetId": tsv.text_cell(row, target_id_index),
            "targetName": tsv.text_cell(row, target_name_index),
            "relationshipType": tsv.text_cell(row, relationship_index),
            "timeStart": tsv.int_or_zero(row, start_index),
            "timeEnd": tsv.int_or_zero(row, end_index),
            "confidence": tsv.int_or_zero(row, confidence_index),
            "evidenceTypes": tsv.json_cell(row, evidence_index, []),
            "description": tsv.text_cell(row, description_index),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


def load_literary_traditions(lexicons: Path) -> list[Record]:
    """`literary-traditions.tsv` → the tradition records.

    ``loadLiteraryTraditions``. Every column is required.
    """
    parsed = tsv.read_tsv(lexicons, "literary-traditions.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    region_index = tsv.required_index(header, "region")
    origin_index = tsv.required_index(header, "origin_date")
    end_index = tsv.required_index(header, "end_date")
    coordinates_index = tsv.required_index(header, "origin_coordinates")
    language_index = tsv.required_index(header, "associated_language_ids")
    genre_index = tsv.required_index(header, "genre_focus")
    themes_index = tsv.required_index(header, "key_themes")
    description_index = tsv.required_index(header, "description")
    authors_index = tsv.required_index(header, "notable_authors")
    influences_index = tsv.required_index(header, "influences")
    sources_index = tsv.required_index(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "region": tsv.cell(row, region_index),
            "originDate": tsv.int_or_zero(row, origin_index),
            "endDate": _int(row, end_index),
            "originCoordinates": _coordinates(row, coordinates_index),
            "associatedLanguageIds": tsv.json_cell(row, language_index, []),
            "genreFocus": tsv.json_cell(row, genre_index, []),
            "keyThemes": tsv.json_cell(row, themes_index, []),
            "description": tsv.cell(row, description_index),
            "notableAuthors": tsv.json_cell(row, authors_index, []),
            "influences": tsv.json_cell(row, influences_index, []),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


def load_literary_works(lexicons: Path) -> list[Record]:
    """`literary-works.tsv` → the individual works (``loadLiteraryWorks``)."""
    parsed = tsv.read_tsv(lexicons, "literary-works.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    title_index = tsv.required_index(header, "title")
    author_index = tsv.required_index(header, "author")
    tradition_index = tsv.required_index(header, "tradition_id")
    language_index = tsv.required_index(header, "language_id")
    composed_index = tsv.required_index(header, "date_composed")
    published_index = tsv.required_index(header, "date_published")
    genre_index = tsv.required_index(header, "genre")
    form_index = tsv.required_index(header, "form")
    description_index = tsv.required_index(header, "description")
    significance_index = tsv.required_index(header, "significance")
    script_index = tsv.required_index(header, "original_script")
    coordinates_index = tsv.required_index(header, "coordinates")

    return [
        {
            "id": tsv.cell(row, id_index),
            "title": tsv.cell(row, title_index),
            "author": tsv.cell(row, author_index),
            "traditionId": tsv.cell(row, tradition_index),
            "languageId": tsv.cell(row, language_index),
            "dateComposed": tsv.int_or_zero(row, composed_index),
            "datePublished": _int(row, published_index),
            "genre": tsv.cell(row, genre_index),
            "form": tsv.cell(row, form_index),
            "description": tsv.cell(row, description_index),
            "significance": tsv.cell(row, significance_index),
            "originalScript": tsv.cell(row, script_index),
            "coordinates": _coordinates(row, coordinates_index),
        }
        for row in rows
    ]


def load_rivers_and_waters(lexicons: Path) -> list[Record]:
    """`rivers-and-waters.tsv` → the hydrological features.

    ``loadRiversAndWaters``. `length_km` is ``parseInt(cell) || null``, so a
    river recorded as 0 km long reads as unmeasured.
    """
    parsed = tsv.read_tsv(lexicons, "rivers-and-waters.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.required_index(header, "name")
    alternate_index = tsv.index_of(header, "alternate_names")
    type_index = tsv.index_of(header, "water_type")
    coordinates_index = tsv.index_of(header, "coordinates")
    length_index = tsv.index_of(header, "length_km")
    region_index = tsv.index_of(header, "region")
    start_index = tsv.index_of(header, "time_start")
    end_index = tsv.index_of(header, "time_end")
    importance_index = tsv.index_of(header, "historical_importance")
    civilizations_index = tsv.index_of(header, "associated_civilizations")
    languages_index = tsv.index_of(header, "associated_languages")
    modern_index = tsv.index_of(header, "modern_name")
    description_index = tsv.index_of(header, "description")

    def _length(row: list[str]) -> int | None:
        parsed_length = _int(row, length_index)
        return None if not parsed_length else parsed_length

    return [
        {
            "id": tsv.cell(row, id_index),
            "name": tsv.cell(row, name_index),
            "alternateNames": _loose_list(row, alternate_index),
            "waterType": tsv.text_cell(row, type_index),
            "coordinates": tsv.json_cell(row, coordinates_index, []),
            "lengthKm": _length(row),
            "region": tsv.text_cell(row, region_index),
            "timeStart": _int(row, start_index),
            "timeEnd": _int(row, end_index),
            "historicalImportance": tsv.text_cell(row, importance_index),
            "associatedCivilizations": _loose_list(row, civilizations_index),
            "associatedLanguages": _loose_list(row, languages_index),
            "modernName": tsv.text_cell(row, modern_index),
            "description": tsv.text_cell(row, description_index),
        }
        for row in rows
    ]


def load_daily_life(lexicons: Path) -> list[Record]:
    """`daily-life.tsv` → the everyday-practice entries (``loadDailyLife``)."""
    parsed = tsv.read_tsv(lexicons, "daily-life.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    culture_index = tsv.required_index(header, "culture_profile_id")
    category_index = tsv.required_index(header, "category")
    title_index = tsv.required_index(header, "title")
    description_index = tsv.required_index(header, "description")
    social_class_index = tsv.required_index(header, "social_class")
    gender_index = tsv.required_index(header, "gender_context")
    age_index = tsv.required_index(header, "age_group")
    season_index = tsv.required_index(header, "season")
    start_index = tsv.required_index(header, "time_period_start")
    end_index = tsv.required_index(header, "time_period_end")
    sources_index = tsv.required_index(header, "sources")

    return [
        {
            "id": tsv.cell(row, id_index),
            "cultureProfileId": tsv.cell(row, culture_index),
            "category": tsv.cell(row, category_index),
            "title": tsv.cell(row, title_index),
            "description": tsv.cell(row, description_index),
            "socialClass": tsv.cell(row, social_class_index),
            "genderContext": tsv.cell(row, gender_index),
            "ageGroup": tsv.cell(row, age_index),
            "season": tsv.cell(row, season_index),
            "timePeriodStart": tsv.text_cell(row, start_index),
            "timePeriodEnd": tsv.text_cell(row, end_index),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


def load_culture_events(lexicons: Path) -> list[Record]:
    """`culture-events.tsv` → the per-culture timeline events.

    ``loadCultureEvents``. `year` is an unguarded ``parseInt``, so an unreadable
    one is ``NaN`` over there — collapsed to absent here, per this module's rule.
    Ordering is the caller's (:func:`pinakes.lexicons.ethnography.culture_events`).
    """
    parsed = tsv.read_tsv(lexicons, "culture-events.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    culture_index = tsv.required_index(header, "culture_profile_id")
    year_index = tsv.required_index(header, "year")
    lane_index = tsv.required_index(header, "lane")
    type_index = tsv.required_index(header, "event_type")
    title_index = tsv.required_index(header, "title")
    description_index = tsv.required_index(header, "description")
    magnitude_index = tsv.required_index(header, "magnitude")
    sources_index = tsv.index_of(header, "sources")

    def _year(row: list[str]) -> int | None:
        value = tsv.js_parse_int(tsv.cell(row, year_index))
        return None if math.isnan(value) else int(value)

    return [
        {
            "id": tsv.cell(row, id_index),
            "cultureProfileId": tsv.cell(row, culture_index),
            "year": _year(row),
            "lane": tsv.cell(row, lane_index),
            "eventType": tsv.cell(row, type_index),
            "title": tsv.cell(row, title_index),
            "description": tsv.cell(row, description_index),
            "magnitude": tsv.cell(row, magnitude_index),
            "sources": tsv.json_cell(row, sources_index, []),
        }
        for row in rows
    ]


#: The Wikimedia Commons image columns, in the order the handler emits them,
#: paired with how each cell is read. The whole domain is inline in
#: `routes.ts` rather than in `tsv-storage.ts`, which is why it has no `load*`
#: twin over there and why :func:`load_wikimedia_commons_images` carries its own
#: (subtly different) reader.
_COMMONS_TEXT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("id", "id"),
    ("title", "title"),
    ("description", "description"),
    ("imageUrl", "image_url"),
    ("thumbUrl", "thumb_url"),
    ("artist", "artist"),
    ("license", "license"),
)


def load_wikimedia_commons_images(lexicons: Path) -> list[Record]:
    """`wikimedia-commons-images.tsv` → the scraped image records.

    The handler this comes from reads the file **inline**, with its own parser,
    and two things about that parser are observable. It splits on ``"\\n"``
    alone, so a CRLF file keeps a ``\\r`` on the last column of every row; and a
    file with a header but no rows answers the same empty payload a missing file
    does. Both reproduced — this reader is deliberately *not*
    :func:`pinakes.analytics.tsv.parse_tsv`.
    """
    path = Path(lexicons) / "wikimedia-commons-images.tsv"
    if not path.is_file():
        return []
    content = path.read_text(encoding="utf-8")
    lines = [line for line in content.split("\n") if line.strip() != ""]
    if len(lines) <= 1:
        return []
    header = lines[0].split("\t")

    def _index(name: str) -> int:
        return tsv.index_of(header, name)

    records: list[Record] = []
    for line in lines[1:]:
        row = line.split("\t")
        record: Record = {
            key: tsv.text_cell(row, _index(column))
            for key, column in _COMMONS_TEXT_COLUMNS
        }
        record["categories"] = tsv.json_cell(row, _index("categories"), [])
        record["coordinates"] = tsv.json_cell(row, _index("coordinates"), None)
        record["dateCreated"] = tsv.text_cell(row, _index("date_created"))
        record["associatedCulture"] = tsv.text_cell(row, _index("associated_culture"))
        record["associatedLanguageIds"] = tsv.json_cell(
            row, _index("associated_language_ids"), []
        )
        record["artifactType"] = tsv.text_cell(row, _index("artifact_type"))
        record["region"] = tsv.text_cell(row, _index("region"))
        record["source"] = tsv.text_cell(row, _index("source"))
        records.append(record)
    return records


def find_by_id(records: list[Record], identifier: str) -> Record | None:
    """The first record whose ``id`` is *identifier* — ``Array.find``, by id."""
    for record in records:
        if record.get("id") == identifier:
            return record
    return None
