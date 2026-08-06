"""The ethnographic, material and literary reads — the rest of slice four.

The cutover's fourth slice, second half (pinakes:80 US-1): sixteen more groups
from `server/routes.ts` plus the five `/api/culture-profiles/{id}/*`
sub-resources. Everything under HTTP is :mod:`pinakes.lexicons.storage` and
:mod:`pinakes.lexicons.ethnography`, except `/api/data-freshness`, which is the
only route in this service that grades the corpus by **mtime** and therefore has
its own module (:mod:`pinakes.lexicons.freshness`).

Four things here are not guessable from the route names:

* **Both 500 spellings live in this file.** `social-structures`,
  `rivers-and-waters`, `daily-life`, `data-freshness` and every
  `/api/culture-profiles/{id}/*` sub-resource answer ``{message}`` alone; the
  other eleven groups answer ``{message, error}``. That split is Express's, not
  a tidy-up waiting to happen.
* **`GET /api/city-layouts` is registered twice in `routes.ts` and the first
  wins.** The live handler reads `culture_profile_id` and `layout_type`; the
  dead one at line 4750 also reads `settlement_id` and answers a different 404
  message and a different 500 shape. This file is the *first* registration.
* **`GET /api/cultural-lineages` answers a bare array**, alone in the slice — no
  count, no filters envelope. And its two recursive walks return **edges**, so a
  lineage reachable by two paths appears twice.
* **`/api/wikimedia-commons-images` has no loader on the TypeScript side.** It
  parses the file inline in the handler, with a reader that differs from
  `tsv-storage.ts`'s in two observable ways — see
  :func:`pinakes.lexicons.storage.load_wikimedia_commons_images`. The file does
  not exist in this checkout, so the live answer is the empty payload.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.lexicons import ethnography, freshness, storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads, retired

logger = logging.getLogger("pinakes.ethnography")

router = APIRouter(tags=["catalog"])


def _failed(context: str, message: str, error: Exception) -> Any:
    return _reads.failed(logger, context, message, error)


def _failed_plain(context: str, message: str) -> Any:
    return _reads.failed_plain(logger, context, message)


def _js_truthy(value: float | None) -> bool:
    """A number as ``if (x)`` reads it: ``0`` and ``NaN`` are both **false**.

    Python disagrees on the second — `bool(float("nan"))` is `True` — and the
    freshness thresholds are the one place in this file where that matters.
    """
    return value is not None and value != 0 and not math.isnan(value)


# ── Haplogroups ──────────────────────────────────────────────────────────────


@router.get("/api/haplogroups")
def haplogroups(request: Request) -> Any:
    """The Y-chromosome tree, flat. `?parentId=null` selects the roots."""
    parent_id = _reads.text(request, "parentId")
    language_family_id = _reads.text(request, "languageFamilyId")
    older_than = _reads.query_int(request, "olderThan")
    try:
        found = ethnography.filter_haplogroups(
            storage.load_haplogroups(lexicons_dir()),
            parent_id=parent_id,
            language_family_id=language_family_id,
            older_than=older_than,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching haplogroups", "Failed to fetch haplogroups", error)
    return {
        "haplogroups": found,
        "count": len(found),
        "filters": _reads.echo(
            parentId=parent_id,
            languageFamilyId=language_family_id,
            olderThan=older_than,
        ),
    }


@router.get("/api/haplogroups/tree")
def haplogroup_tree() -> Any:
    """The whole table, unfiltered.

    Registered ahead of `/api/haplogroups/{id}`, as on Express — Starlette
    matches in registration order, so swapping the two would resolve `tree` as
    an id and answer a 404.
    """
    try:
        found = storage.load_haplogroups(lexicons_dir())
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching haplogroup tree", "Failed to fetch haplogroup tree", error
        )
    return {"haplogroups": found, "count": len(found)}


@router.get("/api/haplogroups/{id}")
def haplogroup(id: str) -> Any:
    """One haplogroup plus its **direct** children — not the whole subtree."""
    try:
        found = ethnography.haplogroup_with_children(
            storage.load_haplogroups(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching haplogroup", "Failed to fetch haplogroup", error)
    if found is None:
        return _reads.missing(f"Haplogroup '{id}' not found")
    return {**found, "childCount": len(found["children"])}


# ── Dance traditions ─────────────────────────────────────────────────────────


@router.get("/api/dance-traditions")
def dance_traditions(request: Request) -> Any:
    year = _reads.query_int(request, "year")
    region = _reads.text(request, "region")
    language_id = _reads.text(request, "languageId")
    dance_type = _reads.text(request, "danceType")
    try:
        found = ethnography.filter_dance_traditions(
            storage.load_dance_traditions(lexicons_dir()),
            year=year,
            region=region,
            language_id=language_id,
            dance_type=dance_type,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching dance traditions", "Failed to fetch dance traditions", error
        )
    return {
        "traditions": found,
        "count": len(found),
        "filters": _reads.echo(
            year=year, region=region, languageId=language_id, danceType=dance_type
        ),
    }


@router.get("/api/dance-traditions/{id}")
def dance_tradition(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_dance_traditions(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching dance tradition", "Failed to fetch dance tradition", error
        )
    if found is None:
        return _reads.missing(f"Dance tradition '{id}' not found")
    return found


# ── Foodways ─────────────────────────────────────────────────────────────────


@router.get("/api/ingredient-origins")
def ingredient_origins(request: Request) -> Any:
    category = _reads.text(request, "category")
    cuisine_id = _reads.text(request, "cuisineId")
    try:
        found = ethnography.filter_ingredient_origins(
            storage.load_ingredient_origins(lexicons_dir()),
            category=category,
            cuisine_id=cuisine_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching ingredient origins", "Failed to fetch ingredient origins", error
        )
    return {
        "ingredientOrigins": found,
        "count": len(found),
        "filters": _reads.echo(category=category, cuisineId=cuisine_id),
    }


@router.get("/api/ingredient-origins/{id}")
def ingredient_origin(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_ingredient_origins(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching ingredient origin", "Failed to fetch ingredient origin", error
        )
    if found is None:
        return _reads.missing("Ingredient origin not found")
    return found


@router.get("/api/cooking-techniques")
def cooking_techniques(request: Request) -> Any:
    category = _reads.text(request, "category")
    cuisine_id = _reads.text(request, "cuisineId")
    try:
        found = ethnography.filter_cooking_techniques(
            storage.load_cooking_techniques(lexicons_dir()),
            category=category,
            cuisine_id=cuisine_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching cooking techniques", "Failed to fetch cooking techniques", error
        )
    return {
        "cookingTechniques": found,
        "count": len(found),
        "filters": _reads.echo(category=category, cuisineId=cuisine_id),
    }


@router.get("/api/cooking-techniques/{id}")
def cooking_technique(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_cooking_techniques(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching cooking technique", "Failed to fetch cooking technique", error
        )
    if found is None:
        return _reads.missing("Cooking technique not found")
    return found


# ── Built form ───────────────────────────────────────────────────────────────


@router.get("/api/art-style-evolutions")
def art_style_evolutions(request: Request) -> Any:
    """Tradition-to-tradition transitions; `?tradition_id=` matches either end."""
    tradition_id = _reads.text(request, "tradition_id")
    transition_type = _reads.text(request, "transition_type")
    try:
        found = ethnography.filter_style_evolutions(
            storage.load_style_evolutions(lexicons_dir()),
            tradition_id=tradition_id,
            transition_type=transition_type,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching style evolutions", "Failed to fetch style evolutions", error
        )
    return {"evolutions": found, "count": len(found)}


@router.get("/api/building-types")
def building_types(request: Request) -> Any:
    category = _reads.text(request, "category")
    try:
        found = ethnography.filter_building_types(
            storage.load_building_types(lexicons_dir()), category=category
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching building types", "Failed to fetch building types", error
        )
    return {"buildingTypes": found, "count": len(found)}


@router.get("/api/building-types/categories", include_in_schema=False)
def building_type_categories() -> Any:
    """Re-registered here **only** to keep it ahead of `/api/building-types/{id}`.

    `routers/retired.py` owns this path and its body; on Express the static
    registration precedes the wildcard, so `categories` is never read as an id.
    Here the two live in different modules and `discover_routers` mounts them in
    module-name order — `ethnography` before `retired` — so without this the
    wildcard would swallow it and a retired route would answer 404. The body is
    the retirement module's, not a copy;
    `test_the_retired_categories_route_outranks_the_building_type_id_route` is
    the guard, and `tests/test_retired_routes.py` still grades the payload.
    """
    return JSONResponse(
        status_code=retired.RETIRED_STATUS,
        content=retired.retired_body(
            "GET /api/building-types/categories", ("building-types",)
        ),
    )


@router.get("/api/building-types/{id}")
def building_type(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_building_types(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching building type", "Failed to fetch building type", error)
    if found is None:
        return _reads.missing("Building type not found")
    return found


@router.get("/api/city-layouts")
def city_layouts(request: Request) -> Any:
    """The **first** of two registrations of this path: no `settlement_id`."""
    culture_profile_id = _reads.text(request, "culture_profile_id")
    layout_type = _reads.text(request, "layout_type")
    try:
        found = ethnography.filter_city_layouts(
            storage.load_city_layouts(lexicons_dir()),
            culture_profile_id=culture_profile_id,
            layout_type=layout_type,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching city layouts", "Failed to fetch city layouts", error)
    return {"layouts": found, "count": len(found)}


@router.get("/api/city-layouts/{id}")
def city_layout(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_city_layouts(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching city layout", "Failed to fetch city layout", error)
    if found is None:
        return _reads.missing("City layout not found")
    return found


# ── Social organisation ──────────────────────────────────────────────────────


@router.get("/api/social-organization")
def social_organization(request: Request) -> Any:
    political_structure = _reads.text(request, "political_structure")
    descent_system = _reads.text(request, "descent_system")
    subsistence_pattern = _reads.text(request, "subsistence_pattern")
    region = _reads.text(request, "region")
    try:
        found = ethnography.filter_social_organization(
            storage.load_social_organization(lexicons_dir()),
            political_structure=political_structure,
            descent_system=descent_system,
            subsistence_pattern=subsistence_pattern,
            region=region,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching social organization",
            "Failed to fetch social organization data",
            error,
        )
    return {"organizations": found, "count": len(found)}


@router.get("/api/social-organization/{id}")
def social_organization_entry(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_social_organization(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching social organization",
            "Failed to fetch social organization entry",
            error,
        )
    if found is None:
        return _reads.missing("Social organization entry not found")
    return found


@router.get("/api/social-structures")
def social_structures(request: Request) -> Any:
    culture_profile_id = _reads.text(request, "culture_profile_id")
    structure_type = _reads.text(request, "structure_type")
    try:
        found = ethnography.filter_social_structures(
            storage.load_social_structures(lexicons_dir()),
            culture_profile_id=culture_profile_id,
            structure_type=structure_type,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching social structures", "Failed to fetch social structures"
        )
    return {"structures": found, "count": len(found)}


@router.get("/api/social-structures/{id}")
def social_structure(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_social_structures(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching social structure", "Failed to fetch social structure"
        )
    if found is None:
        return _reads.missing(f"Social structure '{id}' not found")
    return found


@router.get("/api/daily-life")
def daily_life(request: Request) -> Any:
    """Everyday practice. `social_class`/`gender_context` keep the ``"all"`` rows."""
    culture_profile_id = _reads.text(request, "culture_profile_id")
    category = _reads.text(request, "category")
    social_class = _reads.text(request, "social_class")
    gender_context = _reads.text(request, "gender_context")
    try:
        found = ethnography.filter_daily_life(
            storage.load_daily_life(lexicons_dir()),
            culture_profile_id=culture_profile_id,
            category=category,
            social_class=social_class,
            gender_context=gender_context,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching daily life entries", "Failed to fetch daily life entries"
        )
    return {"entries": found, "count": len(found)}


@router.get("/api/daily-life/{id}")
def daily_life_entry(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_daily_life(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching daily life entry", "Failed to fetch daily life entry"
        )
    if found is None:
        return _reads.missing("Daily life entry not found")
    return found


# ── Waterways ────────────────────────────────────────────────────────────────


@router.get("/api/rivers-and-waters")
def rivers_and_waters(request: Request) -> Any:
    water_type = _reads.text(request, "water_type")
    region = _reads.text(request, "region")
    historical_importance = _reads.text(request, "historical_importance")
    time_start = _reads.query_int(request, "time_start")
    time_end = _reads.query_int(request, "time_end")
    try:
        found = ethnography.filter_rivers_and_waters(
            storage.load_rivers_and_waters(lexicons_dir()),
            water_type=water_type,
            region=region,
            historical_importance=historical_importance,
            time_start=time_start,
            time_end=time_end,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching rivers and waters", "Failed to fetch rivers and water features"
        )
    return {"features": found, "count": len(found)}


@router.get("/api/rivers-and-waters/{id}")
def river_water_feature(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_rivers_and_waters(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching river/water feature", "Failed to fetch river/water feature"
        )
    if found is None:
        return _reads.missing("River/water feature not found")
    return found


# ── Cultural lineages ────────────────────────────────────────────────────────


@router.get("/api/cultural-lineages")
def cultural_lineages(request: Request) -> Any:
    """A **bare array** — the only response in the slice with no envelope."""
    relationship_type = _reads.text(request, "relationship_type")
    source_id = _reads.text(request, "source_id")
    target_id = _reads.text(request, "target_id")
    try:
        return ethnography.filter_cultural_lineages(
            storage.load_cultural_lineages(lexicons_dir()),
            relationship_type=relationship_type,
            source_id=source_id,
            target_id=target_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching cultural lineages", "Failed to fetch cultural lineages", error
        )


@router.get("/api/cultural-lineages/ancestors/{entityId}")
def cultural_lineage_ancestors(entityId: str, request: Request) -> Any:
    """A breadth-first walk up the descent edges, capped at `?maxDepth=` rounds."""
    max_depth = _reads.query_int(request, "maxDepth")
    try:
        found = ethnography.lineage_ancestors(
            storage.load_cultural_lineages(lexicons_dir()),
            entityId,
            ethnography.DEFAULT_LINEAGE_DEPTH if max_depth is None else max_depth,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching cultural lineage ancestors",
            "Failed to fetch cultural lineage ancestors",
            error,
        )
    return {"entityId": entityId, "lineages": found, "count": len(found)}


@router.get("/api/cultural-lineages/descendants/{entityId}")
def cultural_lineage_descendants(entityId: str, request: Request) -> Any:
    max_depth = _reads.query_int(request, "maxDepth")
    try:
        found = ethnography.lineage_descendants(
            storage.load_cultural_lineages(lexicons_dir()),
            entityId,
            ethnography.DEFAULT_LINEAGE_DEPTH if max_depth is None else max_depth,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching cultural lineage descendants",
            "Failed to fetch cultural lineage descendants",
            error,
        )
    return {"entityId": entityId, "lineages": found, "count": len(found)}


@router.get("/api/cultural-lineages/{id}")
def cultural_lineage(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_cultural_lineages(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching cultural lineage", "Failed to fetch cultural lineage", error
        )
    if found is None:
        return _reads.missing(f"Cultural lineage '{id}' not found")
    return found


# ── Literature ───────────────────────────────────────────────────────────────


@router.get("/api/literary-traditions")
def literary_traditions(request: Request) -> Any:
    region = _reads.text(request, "region")
    genre = _reads.text(request, "genre")
    try:
        found = ethnography.filter_literary_traditions(
            storage.load_literary_traditions(lexicons_dir()),
            region=region,
            genre=genre,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching literary traditions", "Failed to fetch literary traditions", error
        )
    return {"traditions": found, "count": len(found)}


@router.get("/api/literary-traditions/{id}")
def literary_tradition(id: str) -> Any:
    """The tradition **with its works** spread beside it, plus a `workCount`."""
    try:
        lexicons = lexicons_dir()
        found = storage.find_by_id(storage.load_literary_traditions(lexicons), id)
        works = (
            ethnography.filter_literary_works(
                storage.load_literary_works(lexicons), tradition_id=id
            )
            if found is not None
            else []
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching literary tradition", "Failed to fetch literary tradition", error
        )
    if found is None:
        return _reads.missing("Literary tradition not found")
    return {"tradition": found, "works": works, "workCount": len(works)}


@router.get("/api/literary-works")
def literary_works(request: Request) -> Any:
    tradition_id = _reads.text(request, "tradition_id")
    genre = _reads.text(request, "genre")
    language_id = _reads.text(request, "language_id")
    try:
        found = ethnography.filter_literary_works(
            storage.load_literary_works(lexicons_dir()),
            tradition_id=tradition_id,
            genre=genre,
            language_id=language_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching literary works", "Failed to fetch literary works", error
        )
    return {"works": found, "count": len(found)}


@router.get("/api/literary-works/{id}")
def literary_work(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_literary_works(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching literary work", "Failed to fetch literary work", error)
    if found is None:
        return _reads.missing("Literary work not found")
    return found


@router.get("/api/narratives")
def narratives() -> Any:
    """The guided map tours. No filters at all on this one."""
    try:
        found = storage.load_narratives(lexicons_dir())
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching narratives", "Failed to fetch narratives", error)
    return {"narratives": found, "count": len(found)}


@router.get("/api/narratives/{id}")
def narrative(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_narratives(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching narrative", "Failed to fetch narrative", error)
    if found is None:
        return _reads.missing("Narrative not found")
    return found


# ── Culture-profile sub-resources ────────────────────────────────────────────


@router.get("/api/culture-profiles/{id}/city-layouts")
def culture_profile_city_layouts(id: str) -> Any:
    try:
        found = ethnography.filter_city_layouts(
            storage.load_city_layouts(lexicons_dir()), culture_profile_id=id
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching city layouts for culture profile",
            "Failed to fetch city layouts for culture profile",
        )
    return {"layouts": found, "count": len(found)}


@router.get("/api/culture-profiles/{id}/social-structures")
def culture_profile_social_structures(id: str) -> Any:
    try:
        found = ethnography.filter_social_structures(
            storage.load_social_structures(lexicons_dir()), culture_profile_id=id
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching social structures for culture profile",
            "Failed to fetch social structures for culture profile",
        )
    return {"structures": found, "count": len(found)}


@router.get("/api/culture-profiles/{id}/daily-life")
def culture_profile_daily_life(id: str) -> Any:
    """Grouped by category, in row order — and **not** counted."""
    try:
        grouped = ethnography.daily_life_by_category(
            storage.load_daily_life(lexicons_dir()), id
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching daily life by culture",
            "Failed to fetch daily life entries for culture",
        )
    return {"cultureProfileId": id, "categories": grouped}


@router.get("/api/culture-profiles/{id}/evolution-events")
def culture_profile_evolution_events(id: str) -> Any:
    """This culture's timeline, oldest first. An unknown id is an empty list."""
    try:
        found = ethnography.culture_events(
            storage.load_culture_events(lexicons_dir()), id
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching culture evolution events",
            "Failed to fetch culture evolution events",
        )
    return {"cultureProfileId": id, "events": found, "count": len(found)}


@router.get("/api/culture-profiles/{id}/socio-cultural")
def culture_profile_socio_cultural(id: str) -> Any:
    """The profile with its language / religion / script / settlement references
    resolved to `{id, name}` pairs. An id that names nothing is simply absent
    from the resolved list — the profile is never rejected for a dangling
    reference."""
    try:
        found = ethnography.socio_cultural(lexicons_dir(), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching socio-cultural data", "Failed to fetch socio-cultural data"
        )
    if found is None:
        return _reads.missing("Culture profile not found")
    return found


# ── Corpus freshness and Commons images ──────────────────────────────────────


@router.get("/api/data-freshness")
def data_freshness(request: Request) -> Any:
    """How old every `*.tsv` in the corpus is, against two age thresholds.

    `?freshDays=`/`?agingDays=` are read through ``Number``, and the pair is
    applied only when **either** is *JavaScript*-truthy — which is where the two
    languages part company. `?freshDays=0` is a real zero and falsy, so it is no
    override at all; `?freshDays=abc` is ``NaN``, which is **falsy in JavaScript
    and truthy in Python**, so it too has to read as no override. Give one of
    them and the other falls back through ``??`` (7 / 30), which is why a lone
    `?agingDays=` cannot narrow the fresh window by accident.
    """
    fresh_days = _reads.query_number(request, "freshDays")
    aging_days = _reads.query_number(request, "agingDays")
    thresholds = freshness.DEFAULT_THRESHOLDS
    if _js_truthy(fresh_days) or _js_truthy(aging_days):
        thresholds = freshness.Thresholds(
            fresh_days=7.0 if fresh_days is None else fresh_days,
            aging_days=30.0 if aging_days is None else aging_days,
        )
    try:
        return freshness.freshness_summary(
            lexicons_dir(), datetime.now(tz=UTC), thresholds
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching data freshness", "Failed to fetch data freshness"
        )


@router.get("/api/wikimedia-commons-images")
def wikimedia_commons_images(request: Request) -> Any:
    culture = _reads.text(request, "culture")
    artifact_type = _reads.text(request, "artifact_type")
    region = _reads.text(request, "region")
    try:
        found = ethnography.filter_commons_images(
            storage.load_wikimedia_commons_images(lexicons_dir()),
            culture=culture,
            artifact_type=artifact_type,
            region=region,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching Wikimedia Commons images",
            "Failed to fetch Wikimedia Commons images",
            error,
        )
    return {"images": found, "count": len(found)}
