"""Sankey and chord diagram data — the three `/api/visualizations/*` builders.

Ported off the handlers registered inline in `server/routes.ts` (pinakes:80
US-1, the tenth slice). There is no `server/services/*.ts` behind these: the
whole computation was in the route bodies, so this module *is* the port and the
router above it is the adapter it should always have had.

Three rules in here are contract rather than implementation.

* **`timePeriod` is free text and the year is its first integer.**
  ``/(-?\\d+)/`` on `"1066-1400"` matches `1066`; on `"Bronze Age"` it matches
  nothing and the row is **kept**. JavaScript's ``\\d`` is ASCII where Python's
  is Unicode, so the pattern is spelled ``[0-9]`` here — an Arabic-Indic digit
  would parse on one backend and not the other otherwise.
* **The filter is skipped entirely when neither bound is given**, and the guard
  is ``!yearStart && !yearEnd`` — *truthiness*, so ``?yearStart=0`` is no filter
  at all. Same shape as `getMaterialCultureDistributions` in
  :mod:`pinakes.lexicons.layers`.
* **The chord matrix is written symmetrically from a directed tally.** Both
  ``A|B`` and ``B|A`` can be present, and each adds its weight to *both* cells —
  so a family pair with contacts in both directions is counted twice per cell.
  Reproduced; the client renders the matrix as given.
"""

from __future__ import annotations

import re
from typing import Any

Record = dict[str, Any]

#: `/(-?\d+)/` with JavaScript's ASCII `\d`. The first integer anywhere in the
#: cell, sign included.
_FIRST_INTEGER = re.compile(r"-?[0-9]+")

#: `intensity === "heavy" ? 3 : intensity === "moderate" ? 2 : 1` — anything
#: else, including an absent cell, weighs one.
_INTENSITY = {"heavy": 3, "moderate": 2}


def _intensity_value(contact: Record) -> int:
    intensity = contact.get("intensity")
    return _INTENSITY.get(intensity, 1) if isinstance(intensity, str) else 1


def _falsy(value: float | None) -> bool:
    """``!value`` — and ``NaN`` is falsy in JavaScript where it is truthy here.

    The distinction is unobservable through these two routes (a `NaN` bound
    rejects nothing, so the early return and the filter agree), but writing
    ``not value`` would leave the next reader to re-derive that. Same trap
    :mod:`pinakes.lexicons.freshness` documents for `?freshDays=abc`.
    """
    return value is None or value == 0 or value != value


def filter_contacts_by_year(
    contacts: list[Record],
    *,
    year_start: float | None = None,
    year_end: float | None = None,
) -> list[Record]:
    """The temporal filter both the sankey and the chord builder apply.

    A contact whose `timePeriod` carries no integer at all is **kept** — the
    filter can only reject a row it managed to date. A `NaN` bound (``?yearStart=soon``)
    is not absent: every comparison against it is false, so it rejects nothing
    either, which is why the two rules read differently here than in the layer
    filters.
    """
    if _falsy(year_start) and _falsy(year_end):
        return contacts
    kept: list[Record] = []
    for contact in contacts:
        period = contact.get("timePeriod")
        match = _FIRST_INTEGER.search(period) if isinstance(period, str) else None
        if match is None:
            kept.append(contact)
            continue
        year = int(match.group(0))
        if year_start is not None and year < year_start:
            continue
        if year_end is not None and year > year_end:
            continue
        kept.append(contact)
    return kept


def build_language_sankey(
    contacts: list[Record],
    languages: list[Record],
    *,
    year_start: float | None = None,
    year_end: float | None = None,
) -> Record:
    """`GET /api/visualizations/sankey` — contacts as a language-to-language flow.

    Nodes are minted in **first-seen order** across the surviving links (source
    before target, per link), and a language the corpus does not carry keeps its
    id as its name and lands in the ``unknown`` group.
    """
    filtered = filter_contacts_by_year(
        contacts, year_start=year_start, year_end=year_end
    )
    by_id = {row.get("id"): row for row in languages}

    node_ids: dict[Any, None] = {}
    links: list[Record] = []
    for contact in filtered:
        node_ids.setdefault(contact.get("sourceLanguageId"), None)
        node_ids.setdefault(contact.get("targetLanguageId"), None)
        links.append(
            {
                "source": contact.get("sourceLanguageId"),
                "target": contact.get("targetLanguageId"),
                "value": _intensity_value(contact),
                "contactType": contact.get("contactType"),
                "timePeriod": contact.get("timePeriod"),
            }
        )

    nodes = [
        {
            "id": identifier,
            "name": (by_id.get(identifier) or {}).get("name") or identifier,
            "group": (by_id.get(identifier) or {}).get("familyId") or "unknown",
        }
        for identifier in node_ids
    ]
    return {"nodes": nodes, "links": links}


def build_cuisine_sankey(cuisines: list[Record], items: list[Record]) -> Record:
    """`GET /api/visualizations/cuisine-sankey` — cuisines joined two ways.

    A shared **food type** links every pair of cuisines serving it (weight = the
    number of food types they share); a shared **region** then links every pair
    in it — but only where no food-type link already exists, because the second
    pass never overwrites and never increments. So a regional link always weighs
    one, and its `timePeriod` carries the region name where a food-type link
    carries the food type. Both are the field names the client's generic sankey
    renderer reads.
    """
    nodes = [
        {"id": row.get("id"), "name": row.get("name"), "group": row.get("region")}
        for row in cuisines
    ]
    cuisine_ids = {row.get("id") for row in cuisines}

    by_food_type: dict[Any, list[Any]] = {}
    for item in items:
        if item.get("cuisineId") not in cuisine_ids:
            continue
        by_food_type.setdefault(item.get("foodType"), []).append(item.get("cuisineId"))

    links: dict[str, Record] = {}
    for food_type, cuisine_list in by_food_type.items():
        unique = list(dict.fromkeys(cuisine_list))
        for index, first in enumerate(unique):
            for second in unique[index + 1 :]:
                low, high = sorted([str(first), str(second)])
                key = f"{low}->{high}"
                existing = links.get(key)
                if existing is None:
                    links[key] = {
                        "source": low,
                        "target": high,
                        "value": 1,
                        "contactType": "shared_food_type",
                        "timePeriod": food_type,
                    }
                else:
                    existing["value"] += 1

    by_region: dict[Any, list[Record]] = {}
    for cuisine in cuisines:
        by_region.setdefault(cuisine.get("region"), []).append(cuisine)

    for region, region_cuisines in by_region.items():
        for index, first in enumerate(region_cuisines):
            for second in region_cuisines[index + 1 :]:
                low, high = sorted([str(first.get("id")), str(second.get("id"))])
                key = f"{low}->{high}"
                if key not in links:
                    links[key] = {
                        "source": low,
                        "target": high,
                        "value": 1,
                        "contactType": "regional",
                        "timePeriod": region,
                    }

    return {"nodes": nodes, "links": list(links.values())}


def build_family_chord(
    contacts: list[Record],
    languages: list[Record],
    families: list[Record],
    *,
    year_start: float | None = None,
    year_end: float | None = None,
) -> Record:
    """`GET /api/visualizations/chord` — mutual influence between families.

    Intra-family contacts are **skipped**, so a family only appears once one of
    its languages was in contact with another family's. A language the corpus
    does not carry counts as the family ``unknown``, which therefore shows up on
    the diagram as a real participant.
    """
    filtered = filter_contacts_by_year(
        contacts, year_start=year_start, year_end=year_end
    )
    language_by_id = {row.get("id"): row for row in languages}
    family_names = {row.get("id"): row.get("name") for row in families}

    pairs: dict[tuple[Any, Any], int] = {}
    family_ids: dict[Any, None] = {}
    for contact in filtered:
        source = language_by_id.get(contact.get("sourceLanguageId")) or {}
        target = language_by_id.get(contact.get("targetLanguageId")) or {}
        source_family = source.get("familyId") or "unknown"
        target_family = target.get("familyId") or "unknown"
        if source_family == target_family:
            continue
        family_ids.setdefault(source_family, None)
        family_ids.setdefault(target_family, None)
        key = (source_family, target_family)
        pairs[key] = pairs.get(key, 0) + _intensity_value(contact)

    id_list = list(family_ids)
    names = [family_names.get(identifier) or identifier for identifier in id_list]
    size = len(id_list)
    matrix = [[0 for _ in range(size)] for _ in range(size)]
    for (source_family, target_family), value in pairs.items():
        row = id_list.index(source_family)
        column = id_list.index(target_family)
        if row >= 0 and column >= 0:
            matrix[row][column] += value
            matrix[column][row] += value

    return {"names": names, "matrix": matrix}
