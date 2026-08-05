"""The ethnographic / linguistic / literary filters — `tsv-storage.ts`, part 3.

Same split as :mod:`pinakes.lexicons.catalog` and :mod:`pinakes.lexicons.domains`
and for the same reason: a loader is graded by row counts against the live
corpus, a filter by which rows survive. This module is the ``get<Domain>(…)``
bodies for the twenty-three domains :mod:`pinakes.lexicons.storage` grew in the
cutover's fourth slice, plus the two recursive walks and the two joins that have
no loader of their own.

**The filter dialects are, again, per-domain and not negotiable.** Four rules
appear here and none of them is uniform across neighbours:

* **exact** — a sample text's `languageId`, every `grammar-features` filter,
  every `verb-paradigms` filter, every `language-contacts` filter, every
  `sound-changes` filter, a literary tradition's `region`, a literary work's
  `traditionId`/`genre`/`languageId`, a lineage's `relationshipType`/
  `sourceId`/`targetId`, a style evolution's `transitionType`, a daily-life
  `category`, a river's `historicalImportance`, an etymology relation's
  `sourceLanguage`/`targetLanguage`;
* **case-folded whole** — every `ingredient-origins` and `cooking-techniques`
  filter, a building type's `category`, all three `city-layouts` filters, a
  dance's `danceType`, a sample text's `genre`/`script`, a river's `waterType`,
  an etymology relation's `relationType`;
* **case-folded substring** — a dance's `region`, a river's `region`, a social
  organisation's `politicalStructure`/`subsistencePattern`/`region`, a Commons
  image's `associatedCulture`/`region`;
* **membership** — a dance's `associatedLanguageIds`, a haplogroup's
  `associatedLanguageFamilyIds`, a literary tradition's `genreFocus`, an
  ingredient's `cuisinesAdopted`, a technique's `cuisinesUsing`.

Three rules are worth naming on their own because they change what a query
means rather than how a string is compared:

* **`?parentId=null` is a value, not an absence.** `getHaplogroups` tests
  `!== undefined` on that one filter and then compares the literal string
  ``"null"`` against a real ``null`` parent — which is how the client asks for
  the roots of the tree. A blank `?parentId=` therefore selects the haplogroups
  with a blank parent id, of which there are none.
* **`social_class` and `gender_context` filters are inclusive of `"all"`.**
  A query for the practices of one class returns that class's entries *plus*
  every entry marked as applying to everybody. Narrowing that to an exact match
  would silently drop the majority of the table.
* **A river's temporal filter is nullish-open at both ends.** An undated
  feature matches every bound rather than none — the opposite of the
  archaeological-culture filter in :mod:`pinakes.lexicons.layers`.
"""

from __future__ import annotations

from functools import cmp_to_key
from pathlib import Path
from typing import Any

from pinakes.lexicons import storage
from pinakes.lexicons.storage import Record

#: The relation types `services/etymology-trace.ts` walks. A relation outside
#: this set is a real edge in the table and simply not an ancestry claim.
ANCESTOR_RELATIONS: tuple[str, ...] = ("derived_from", "etymology", "borrowed_from")

#: `getCulturalLineage{Ancestors,Descendants}`'s default breadth cap, and the
#: `?maxDepth=` fallback on both routes.
DEFAULT_LINEAGE_DEPTH = 20


def _active(value: str | None) -> bool:
    """``if (filters?.x)`` — a blank query parameter is the filter's absence."""
    return bool(value)


def _lower(value: Any) -> str:
    return str(value or "").lower()


def _same(value: Any, wanted: str) -> bool:
    """``value.toLowerCase() === wanted.toLowerCase()``."""
    return _lower(value) == wanted.lower()


def _includes(haystack: Any, needle: str) -> bool:
    """``haystack.toLowerCase().includes(needle.toLowerCase())``."""
    return needle.lower() in _lower(haystack)


# ── Haplogroups ──────────────────────────────────────────────────────────────


def filter_haplogroups(
    haplogroups: list[Record],
    *,
    parent_id: str | None = None,
    language_family_id: str | None = None,
    older_than: float | None = None,
) -> list[Record]:
    """`GET /api/haplogroups` — the tree, sliced three ways.

    `parentId` is presence-tested rather than truthiness-tested (the only such
    filter in this module) and the literal ``"null"`` selects the roots.
    `olderThan` reads ``timeOrigin <= bound``, and these are **years before
    present** rather than signed years, so "older than" really is ``<=``.
    """
    result = haplogroups
    if parent_id is not None:
        if parent_id == "null":
            result = [row for row in result if row.get("parentId") is None]
        else:
            result = [row for row in result if row.get("parentId") == parent_id]
    if _active(language_family_id):
        result = [
            row
            for row in result
            if language_family_id in row.get("associatedLanguageFamilyIds", [])
        ]
    if older_than is not None:
        result = [
            row
            for row in result
            if row.get("timeOrigin") is not None and row["timeOrigin"] <= older_than
        ]
    return result


def haplogroup_with_children(
    haplogroups: list[Record], haplogroup_id: str
) -> Record | None:
    """`GET /api/haplogroups/{id}` — the node plus its direct children only."""
    found = next(
        (row for row in haplogroups if row.get("id") == haplogroup_id), None
    )
    if found is None:
        return None
    children = [row for row in haplogroups if row.get("parentId") == haplogroup_id]
    return {"haplogroup": found, "children": children}


# ── Dance traditions ─────────────────────────────────────────────────────────


def filter_dance_traditions(
    traditions: list[Record],
    *,
    year: float | None = None,
    region: str | None = None,
    language_id: str | None = None,
    dance_type: str | None = None,
) -> list[Record]:
    """`GET /api/dance-traditions` — the same four-filter shape as religions."""
    result = traditions
    if year is not None:
        result = [row for row in result if _spans_year(row, year)]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    if _active(language_id):
        result = [
            row
            for row in result
            if language_id in row.get("associatedLanguageIds", [])
        ]
    if _active(dance_type):
        assert dance_type is not None
        result = [row for row in result if _same(row.get("danceType"), dance_type)]
    return result


def _spans_year(record: Record, year: float) -> bool:
    """``year >= (timeOrigin ?? -Infinity) && year <= (timeEnd ?? Infinity)``."""
    start = record.get("timeOrigin")
    end = record.get("timeEnd")
    return (float("-inf") if start is None else float(start)) <= year <= (
        float("inf") if end is None else float(end)
    )


# ── Foodways ─────────────────────────────────────────────────────────────────


def filter_ingredient_origins(
    items: list[Record],
    *,
    category: str | None = None,
    cuisine_id: str | None = None,
) -> list[Record]:
    """`GET /api/ingredient-origins` — category whole, cuisine by membership."""
    result = items
    if _active(category):
        assert category is not None
        result = [row for row in result if _same(row.get("category"), category)]
    if _active(cuisine_id):
        assert cuisine_id is not None
        result = [
            row
            for row in result
            if any(
                _same(entry, cuisine_id) for entry in row.get("cuisinesAdopted", [])
            )
        ]
    return result


def filter_cooking_techniques(
    items: list[Record],
    *,
    category: str | None = None,
    cuisine_id: str | None = None,
) -> list[Record]:
    """`GET /api/cooking-techniques` — the same two filters over `cuisinesUsing`."""
    result = items
    if _active(category):
        assert category is not None
        result = [row for row in result if _same(row.get("category"), category)]
    if _active(cuisine_id):
        assert cuisine_id is not None
        result = [
            row
            for row in result
            if any(_same(entry, cuisine_id) for entry in row.get("cuisinesUsing", []))
        ]
    return result


# ── Attested texts and phonologies ───────────────────────────────────────────


def filter_sample_texts(
    texts: list[Record],
    *,
    language_id: str | None = None,
    genre: str | None = None,
    script: str | None = None,
) -> list[Record]:
    """`GET /api/sample-texts` — language **exact**, genre and script folded."""
    result = texts
    if _active(language_id):
        result = [row for row in result if row.get("languageId") == language_id]
    if _active(genre):
        assert genre is not None
        result = [row for row in result if _same(row.get("genre"), genre)]
    if _active(script):
        assert script is not None
        result = [row for row in result if _same(row.get("script"), script)]
    return result


def filter_phonological_inventories(
    inventories: list[Record], *, language_id: str | None = None
) -> list[Record]:
    """`GET /api/phonological-inventories` — one exact filter."""
    if not _active(language_id):
        return inventories
    return [row for row in inventories if row.get("languageId") == language_id]


def inventory_for_language(
    inventories: list[Record], language_id: str
) -> Record | None:
    """`GET /api/languages/{id}/phonological-inventory` — the first match."""
    return next(
        (row for row in inventories if row.get("languageId") == language_id), None
    )


# ── Etymology ────────────────────────────────────────────────────────────────


def filter_etymology_relations(
    relations: list[Record],
    *,
    source_language: str | None = None,
    target_language: str | None = None,
    relation_type: str | None = None,
) -> list[Record]:
    """`GET /api/etymology-relations` — languages exact, relation type folded."""
    result = relations
    if _active(source_language):
        result = [
            row for row in result if row.get("sourceLanguage") == source_language
        ]
    if _active(target_language):
        result = [
            row for row in result if row.get("targetLanguage") == target_language
        ]
    if _active(relation_type):
        assert relation_type is not None
        result = [
            row for row in result if _same(row.get("relationType"), relation_type)
        ]
    return result


def relations_for_word(relations: list[Record], word: str) -> list[Record]:
    """`GET /api/etymology-relations/word/{word}` — either end of the edge."""
    normalized = word.lower()
    return [
        row
        for row in relations
        if _lower(row.get("sourceWord")) == normalized
        or _lower(row.get("targetWord")) == normalized
    ]


def trace_etymology(
    relations: list[Record], word: str, language: str | None = None
) -> Record:
    """`services/etymology-trace.ts` ``traceEtymology`` — the ancestor tree.

    Source → target, following only :data:`ANCESTOR_RELATIONS`. The `visited`
    set is **shared across the whole walk**, not per branch, so a word reached
    twice is expanded once and the second occurrence is a leaf — that is what
    bounds a cyclic table, and it means the tree's shape depends on traversal
    order. Reproduced rather than turned into a DAG.
    """
    return _trace(relations, word, language, ancestors=True)


def trace_descendants(
    relations: list[Record], word: str, language: str | None = None
) -> Record:
    """``traceDescendants`` — the same walk with the edge read target → source."""
    return _trace(relations, word, language, ancestors=False)


def _trace(
    relations: list[Record], word: str, language: str | None, *, ancestors: bool
) -> Record:
    visited: set[str] = set()
    near_word = "sourceWord" if ancestors else "targetWord"
    near_language = "sourceLanguage" if ancestors else "targetLanguage"
    far_word = "targetWord" if ancestors else "sourceWord"
    far_language = "targetLanguage" if ancestors else "sourceLanguage"

    def walk(
        current: str, current_language: str | None, relation: str | None
    ) -> Record:
        key = (
            f"{current.lower()}|{current_language.lower()}"
            if current_language
            else current.lower()
        )
        if key in visited:
            # `lang ?? "unknown"` — nullish again; a blank stays blank.
            language = "unknown" if current_language is None else current_language
            return _node(current, language, relation, [])
        visited.add(key)

        normalized = current.lower()
        matches = [
            row
            for row in relations
            if row.get("relationType") in ANCESTOR_RELATIONS
            and _lower(row.get(near_word)) == normalized
            and (
                not current_language
                or _lower(row.get(near_language)) == current_language.lower()
            )
        ]
        children = [
            walk(row[far_word], row[far_language], row["relationType"])
            for row in matches
        ]
        # `lang ?? …` — **nullish**, not truthy. `?language=` reaches here as
        # `""` and stays `""`; only an *absent* language falls back. And the
        # fallback reads the **near** end of the first match, not the far one,
        # so an unlabelled root is reported with its own language rather than
        # its parent's. Both copied; both are what the client renders.
        resolved = (
            (matches[0][near_language] if matches else "unknown")
            if current_language is None
            else current_language
        )
        return _node(current, resolved, relation, children)

    return walk(word, language, None)


def _node(
    word: str, language: str, relation: str | None, children: list[Record]
) -> Record:
    """One `EtymologyTreeNode`. `relation` is *undefined* on the root, and
    ``JSON.stringify`` drops it — so the root really has no `relation` key."""
    node: Record = {"word": word, "language": language}
    if relation is not None:
        node["relation"] = relation
    node["children"] = children
    return node


# ── Grammar, paradigms, contacts, sound changes ──────────────────────────────


def filter_grammar_features(
    features: list[Record],
    *,
    language_id: str | None = None,
    word_order: str | None = None,
    morphological_type: str | None = None,
) -> list[Record]:
    """`GET /api/grammar-features` — three exact filters."""
    result = features
    if _active(language_id):
        result = [row for row in result if row.get("languageId") == language_id]
    if _active(word_order):
        result = [row for row in result if row.get("wordOrder") == word_order]
    if _active(morphological_type):
        result = [
            row
            for row in result
            if row.get("morphologicalType") == morphological_type
        ]
    return result


def features_for_language(features: list[Record], language_id: str) -> Record | None:
    """`GET /api/languages/{id}/grammar-features` — the first profile."""
    return next(
        (row for row in features if row.get("languageId") == language_id), None
    )


def filter_verb_paradigms(
    paradigms: list[Record],
    *,
    language_id: str | None = None,
    verb_concept: str | None = None,
) -> list[Record]:
    """`GET /api/verb-paradigms` — two exact filters."""
    result = paradigms
    if _active(language_id):
        result = [row for row in result if row.get("languageId") == language_id]
    if _active(verb_concept):
        result = [row for row in result if row.get("verbConcept") == verb_concept]
    return result


def filter_language_contacts(
    contacts: list[Record],
    *,
    source_language_id: str | None = None,
    target_language_id: str | None = None,
    contact_type: str | None = None,
    intensity: str | None = None,
) -> list[Record]:
    """`GET /api/language-contacts` — four exact filters."""
    result = contacts
    if _active(source_language_id):
        result = [
            row for row in result if row.get("sourceLanguageId") == source_language_id
        ]
    if _active(target_language_id):
        result = [
            row for row in result if row.get("targetLanguageId") == target_language_id
        ]
    if _active(contact_type):
        result = [row for row in result if row.get("contactType") == contact_type]
    if _active(intensity):
        result = [row for row in result if row.get("intensity") == intensity]
    return result


def contacts_for_language(contacts: list[Record], language_id: str) -> list[Record]:
    """`GET /api/languages/{id}/contacts` — either end of the contact."""
    return [
        row
        for row in contacts
        if row.get("sourceLanguageId") == language_id
        or row.get("targetLanguageId") == language_id
    ]


def filter_sound_changes(
    changes: list[Record],
    *,
    family_id: str | None = None,
    source_language_id: str | None = None,
    target_language_id: str | None = None,
) -> list[Record]:
    """`GET /api/sound-changes` — three exact filters."""
    result = changes
    if _active(family_id):
        result = [row for row in result if row.get("familyId") == family_id]
    if _active(source_language_id):
        result = [
            row for row in result if row.get("sourceLanguageId") == source_language_id
        ]
    if _active(target_language_id):
        result = [
            row for row in result if row.get("targetLanguageId") == target_language_id
        ]
    return result


# ── Built form ───────────────────────────────────────────────────────────────


def filter_style_evolutions(
    evolutions: list[Record],
    *,
    tradition_id: str | None = None,
    transition_type: str | None = None,
) -> list[Record]:
    """`GET /api/art-style-evolutions` — a tradition matches at **either** end."""
    result = evolutions
    if _active(tradition_id):
        result = [
            row
            for row in result
            if row.get("fromTraditionId") == tradition_id
            or row.get("toTraditionId") == tradition_id
        ]
    if _active(transition_type):
        result = [
            row for row in result if row.get("transitionType") == transition_type
        ]
    return result


def filter_building_types(
    types: list[Record], *, category: str | None = None
) -> list[Record]:
    """`GET /api/building-types` — one case-folded whole-value filter."""
    if not _active(category):
        return types
    assert category is not None
    return [row for row in types if _same(row.get("category"), category)]


def filter_city_layouts(
    layouts: list[Record],
    *,
    culture_profile_id: str | None = None,
    settlement_id: str | None = None,
    layout_type: str | None = None,
) -> list[Record]:
    """`GET /api/city-layouts` — three case-folded whole-value filters.

    `settlementId` is reachable only from the **second**, dead registration of
    this path in `routes.ts`; the live handler never reads it. Kept on the
    filter because the storage method has it and the culture-profile
    sub-resource shares the same code path.
    """
    result = layouts
    if _active(culture_profile_id):
        assert culture_profile_id is not None
        result = [
            row
            for row in result
            if _same(row.get("cultureProfileId"), culture_profile_id)
        ]
    if _active(settlement_id):
        assert settlement_id is not None
        result = [
            row for row in result if _same(row.get("settlementId"), settlement_id)
        ]
    if _active(layout_type):
        assert layout_type is not None
        result = [row for row in result if _same(row.get("layoutType"), layout_type)]
    return result


# ── Social organisation ──────────────────────────────────────────────────────


def filter_social_organization(
    organizations: list[Record],
    *,
    political_structure: str | None = None,
    descent_system: str | None = None,
    subsistence_pattern: str | None = None,
    region: str | None = None,
) -> list[Record]:
    """`GET /api/social-organization` — three substrings and one exact match.

    `descentSystem` is the exact one, alone among the four. The vocabulary
    there is closed (`patrilineal`, `matrilineal`, `bilateral`, …) where the
    other three are prose.
    """
    result = organizations
    if _active(political_structure):
        assert political_structure is not None
        result = [
            row
            for row in result
            if _includes(row.get("politicalStructure"), political_structure)
        ]
    if _active(descent_system):
        result = [row for row in result if row.get("descentSystem") == descent_system]
    if _active(subsistence_pattern):
        assert subsistence_pattern is not None
        result = [
            row
            for row in result
            if _includes(row.get("subsistencePattern"), subsistence_pattern)
        ]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    return result


def filter_social_structures(
    structures: list[Record],
    *,
    culture_profile_id: str | None = None,
    structure_type: str | None = None,
) -> list[Record]:
    """`GET /api/social-structures` — two exact filters (unlike city layouts)."""
    result = structures
    if _active(culture_profile_id):
        result = [
            row
            for row in result
            if row.get("cultureProfileId") == culture_profile_id
        ]
    if _active(structure_type):
        result = [row for row in result if row.get("structureType") == structure_type]
    return result


def filter_daily_life(
    entries: list[Record],
    *,
    culture_profile_id: str | None = None,
    category: str | None = None,
    social_class: str | None = None,
    gender_context: str | None = None,
) -> list[Record]:
    """`GET /api/daily-life` — two exact filters and two **inclusive** ones.

    A `social_class` or `gender_context` query keeps the rows marked ``"all"``
    alongside the ones that name the value. Most of this table is ``"all"``, so
    an exact match here would empty almost every query.
    """
    result = entries
    if _active(culture_profile_id):
        result = [
            row
            for row in result
            if row.get("cultureProfileId") == culture_profile_id
        ]
    if _active(category):
        result = [row for row in result if row.get("category") == category]
    if _active(social_class):
        result = [
            row
            for row in result
            if row.get("socialClass") in (social_class, "all")
        ]
    if _active(gender_context):
        result = [
            row
            for row in result
            if row.get("genderContext") in (gender_context, "all")
        ]
    return result


def daily_life_by_category(
    entries: list[Record], culture_profile_id: str
) -> dict[str, list[Record]]:
    """`GET /api/culture-profiles/{id}/daily-life` — grouped, in row order."""
    grouped: dict[str, list[Record]] = {}
    for entry in entries:
        if entry.get("cultureProfileId") != culture_profile_id:
            continue
        grouped.setdefault(str(entry.get("category")), []).append(entry)
    return grouped


def culture_events(events: list[Record], culture_profile_id: str) -> list[Record]:
    """`GET /api/culture-profiles/{id}/evolution-events` — this culture, by year.

    ``sort((a, b) => a.year - b.year)``. A `year` this reader could not parse
    makes that subtraction ``NaN``, which the spec says to treat as ``+0`` —
    i.e. the pair is *equal* and the stable sort leaves it where it was. That
    is what the comparator below reproduces; a plain key sort would raise.
    """
    selected = [
        event
        for event in events
        if event.get("cultureProfileId") == culture_profile_id
    ]
    return sorted(selected, key=cmp_to_key(_by_year))


def _by_year(left: Record, right: Record) -> int:
    first, second = left.get("year"), right.get("year")
    if first is None or second is None:
        return 0
    return -1 if first < second else (1 if first > second else 0)


def socio_cultural(lexicons: Path, profile_id: str) -> Record | None:
    """`GET /api/culture-profiles/{id}/socio-cultural` — the reference join.

    ``getCultureProfileSocioCultural``. Four resolutions, and the last one is
    not like the other three: languages, religions and writing systems are
    looked up **by id** and a dangling reference is silently dropped, while
    settlements are matched by **case-folded name** *or* by sharing the
    profile's `civilizationId`. That last disjunct is why a profile with a blank
    `civilizationId` pulls in every settlement that also has one — reproduced,
    because narrowing it would change which settlements the panel lists.
    """
    profiles = storage.load_culture_profiles(lexicons)
    profile = storage.find_by_id(profiles, profile_id)
    if profile is None:
        return None

    def _named(records: list[Record], wanted: list[Any]) -> list[Record]:
        # `Array.find` takes the FIRST match, so a duplicated id must not be
        # overwritten while the index is built.
        by_id: dict[Any, Record] = {}
        for record in records:
            by_id.setdefault(record.get("id"), record)
        resolved = []
        for identifier in wanted:
            found = by_id.get(identifier)
            if found is not None:
                resolved.append({"id": found["id"], "name": found["name"]})
        return resolved

    settlement_names = {
        _lower(name) for name in profile.get("notableSettlements", [])
    }
    civilization_id = profile.get("civilizationId")
    settlements = [
        settlement
        for settlement in storage.load_settlements(lexicons)
        if _lower(settlement.get("name")) in settlement_names
        or settlement.get("civilizationId") == civilization_id
    ]

    return {
        "profile": profile,
        "languages": _named(
            storage.load_languages(lexicons), profile.get("associatedLanguageIds", [])
        ),
        "religions": _named(
            storage.load_religions(lexicons), profile.get("associatedReligionIds", [])
        ),
        "writingSystems": _named(
            storage.load_writing_systems(lexicons),
            profile.get("associatedWritingSystemIds", []),
        ),
        "settlements": settlements,
    }


# ── Waterways ────────────────────────────────────────────────────────────────


def filter_rivers_and_waters(
    features: list[Record],
    *,
    water_type: str | None = None,
    region: str | None = None,
    historical_importance: str | None = None,
    time_start: float | None = None,
    time_end: float | None = None,
) -> list[Record]:
    """`GET /api/rivers-and-waters` — the overlap test, open at both ends.

    An undated feature (`timeStart`/`timeEnd` ``null``) survives **every**
    temporal query, because each bound is checked with an explicit null escape
    rather than an infinity substitution. That is the opposite default from
    :func:`pinakes.lexicons.layers.filter_archaeological_cultures`.
    """
    result = features
    if _active(water_type):
        assert water_type is not None
        result = [row for row in result if _same(row.get("waterType"), water_type)]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    if _active(historical_importance):
        result = [
            row
            for row in result
            if row.get("historicalImportance") == historical_importance
        ]
    if time_start is not None:
        result = [
            row
            for row in result
            if row.get("timeEnd") is None or row["timeEnd"] >= time_start
        ]
    if time_end is not None:
        result = [
            row
            for row in result
            if row.get("timeStart") is None or row["timeStart"] <= time_end
        ]
    return result


# ── Cultural lineages ────────────────────────────────────────────────────────


def filter_cultural_lineages(
    lineages: list[Record],
    *,
    relationship_type: str | None = None,
    source_id: str | None = None,
    target_id: str | None = None,
) -> list[Record]:
    """`GET /api/cultural-lineages` — three exact filters, a bare array back."""
    result = lineages
    if _active(relationship_type):
        result = [
            row for row in result if row.get("relationshipType") == relationship_type
        ]
    if _active(source_id):
        result = [row for row in result if row.get("sourceId") == source_id]
    if _active(target_id):
        result = [row for row in result if row.get("targetId") == target_id]
    return result


def lineage_ancestors(
    lineages: list[Record], entity_id: str, max_depth: float = DEFAULT_LINEAGE_DEPTH
) -> list[Record]:
    """`GET /api/cultural-lineages/ancestors/{entityId}` — a breadth-first walk.

    Edges are collected, not nodes, so a lineage reachable by two paths appears
    **twice**; only the *entities* are visited-once. `maxDepth` counts rounds of
    expansion, and a non-positive one returns nothing at all.
    """
    return _walk(lineages, entity_id, max_depth, near="targetId", far="sourceId")


def lineage_descendants(
    lineages: list[Record], entity_id: str, max_depth: float = DEFAULT_LINEAGE_DEPTH
) -> list[Record]:
    """`GET /api/cultural-lineages/descendants/{entityId}` — the same, reversed."""
    return _walk(lineages, entity_id, max_depth, near="sourceId", far="targetId")


def _walk(
    lineages: list[Record], entity_id: str, max_depth: float, *, near: str, far: str
) -> list[Record]:
    result: list[Record] = []
    visited: set[str] = set()
    queue = [entity_id]
    depth = 0
    while depth < max_depth and queue:
        next_queue: list[str] = []
        for identifier in queue:
            if identifier in visited:
                continue
            visited.add(identifier)
            for edge in lineages:
                if edge.get(near) != identifier:
                    continue
                result.append(edge)
                next_queue.append(str(edge.get(far)))
        queue = next_queue
        depth += 1
    return result


# ── Literature ───────────────────────────────────────────────────────────────


def filter_literary_traditions(
    traditions: list[Record],
    *,
    region: str | None = None,
    genre: str | None = None,
) -> list[Record]:
    """`GET /api/literary-traditions` — region exact, genre by membership."""
    result = traditions
    if _active(region):
        result = [row for row in result if row.get("region") == region]
    if _active(genre):
        result = [row for row in result if genre in row.get("genreFocus", [])]
    return result


def filter_literary_works(
    works: list[Record],
    *,
    tradition_id: str | None = None,
    genre: str | None = None,
    language_id: str | None = None,
) -> list[Record]:
    """`GET /api/literary-works` — three exact filters."""
    result = works
    if _active(tradition_id):
        result = [row for row in result if row.get("traditionId") == tradition_id]
    if _active(genre):
        result = [row for row in result if row.get("genre") == genre]
    if _active(language_id):
        result = [row for row in result if row.get("languageId") == language_id]
    return result


# ── Wikimedia Commons images ─────────────────────────────────────────────────


def filter_commons_images(
    images: list[Record],
    *,
    culture: str | None = None,
    artifact_type: str | None = None,
    region: str | None = None,
) -> list[Record]:
    """`GET /api/wikimedia-commons-images` — two substrings around one whole."""
    result = images
    if _active(culture):
        assert culture is not None
        result = [
            row for row in result if _includes(row.get("associatedCulture"), culture)
        ]
    if _active(artifact_type):
        assert artifact_type is not None
        result = [
            row for row in result if _same(row.get("artifactType"), artifact_type)
        ]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    return result
