"""Federated, faceted global search — `server/services/global-search.ts`, ported.

`GET /api/search` merges two result sets: eighteen local lexicon domains scored
by a token-overlap fuzzy matcher, and the shared graph's own full-text hits. The
merge, the dedup and the facet arithmetic are all here; the router is an adapter.

**What changed in the port, and it is the story's point.** The graph half used to
be an HTTP call to the engine sidecar (`server/services/engine-client.ts`
``search``). It is now :func:`pinakes.engine.corpus.search` — the same corpus,
the same payload, loaded into this process. The degradation contract is
unchanged and load-bearing: a graph that is unavailable, disabled or malformed is
**swallowed**, and the user still gets the local results. A search box that
errors because a background store is down is worse than one that quietly returns
less.

Four rules that are contract rather than implementation:

* **Facets are computed over the full, unfiltered match set**, before filtering
  and before the 50-result cap, so the chip counts stay stable while a filter is
  active. ``totalCount`` is the *filtered* count. The two disagree on purpose.
* **Dedup is by csid alias, and local wins.** Each local hit is resolved through
  :mod:`pinakes.search.graph_resolver`; a graph hit sharing that csid is dropped,
  because the local record carries an in-app navigable link and the graph one
  does not.
* **A local hit is `curated` by definition** — it came out of the human-curated
  lexicons. A graph-only hit is classified coarsely from the payload, which
  carries no `source_url`: QID-anchored is `auto-admitted`, else `quarantine`.
* **Relevance is not comparable across halves and is compared anyway.** A local
  hit keeps its ``[0, 1]`` token score; a graph hit that matched an authoritative
  field ranks ``1.0`` and a name match ranks by the same scorer with a ``0.4``
  floor. That floor is what stops a real graph hit falling off the end.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

from pinakes.lexicons import storage
from pinakes.search.graph_resolver import EntityRef, Resolver, graph_resolver

Record = dict[str, Any]

#: How many graph hits to request per federated query.
GRAPH_SEARCH_LIMIT = 25

#: The cap on a merged result page. Facets still describe the whole match set.
RESULT_LIMIT = 50

#: Floor for a graph *name* match, so a real hit is never scored out of the page.
GRAPH_NAME_FLOOR = 0.4

_WHITESPACE = re.compile(r"\s+")


# ── Faceting (pure) ──────────────────────────────────────────────────────────


def _facet_sort_key(bucket: dict[str, Any]) -> tuple[int, str]:
    """Count descending, then value ascending — deterministic either way."""
    return (-int(bucket["count"]), str(bucket["value"]))


def _count_by(
    items: Sequence[Record], key: Callable[[Record], str | None]
) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for item in items:
        value = key(item)
        if not value:  # skips absent *and* empty-string values, as `!value` did
            continue
        counts[value] = counts.get(value, 0) + 1
    return sorted(
        ({"value": value, "count": count} for value, count in counts.items()),
        key=_facet_sort_key,
    )


def empty_facets() -> dict[str, Any]:
    """An empty facet set (blank query / no results)."""
    return {"entityType": [], "source": []}


def compute_facets(results: Sequence[Record]) -> dict[str, Any]:
    """`entityType` + `source` facet counts over a result set. Pure."""
    return {
        "entityType": _count_by(results, lambda result: result.get("entityType")),
        "source": _count_by(results, lambda result: result.get("source")),
    }


def combine_facets(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Merge two facet sets by summing counts per value. Pure."""

    def merge(
        first: Sequence[dict[str, Any]], second: Sequence[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        counts: dict[str, int] = {}
        for bucket in [*first, *second]:
            value = str(bucket["value"])
            counts[value] = counts.get(value, 0) + int(bucket["count"])
        return sorted(
            ({"value": value, "count": count} for value, count in counts.items()),
            key=_facet_sort_key,
        )

    return {
        "entityType": merge(left["entityType"], right["entityType"]),
        "source": merge(left["source"], right["source"]),
    }


def matches_filters(result: Record, filters: dict[str, Any]) -> bool:
    """Does a result pass the facet filters? Empty dimensions match all. Pure."""
    entity_types = filters.get("entityTypes")
    if entity_types and result.get("entityType") not in entity_types:
        return False
    sources = filters.get("sources")
    if sources and result.get("source") not in sources:
        return False
    return True


def apply_facet_filters(
    results: Sequence[Record], filters: dict[str, Any]
) -> list[Record]:
    """Keep only results passing the filters (a no-op when none is set). Pure."""
    if not filters.get("entityTypes") and not filters.get("sources"):
        return list(results)
    return [result for result in results if matches_filters(result, filters)]


def parse_search_filters(
    types: str | None = None, sources: str | None = None
) -> dict[str, Any]:
    """``?types=a,b&sources=local,graph`` → the filter object. Pure.

    Unknown source values are dropped and blanks ignored; an empty dimension is
    *absent* from the result rather than an empty list, because the object is
    echoed back to the client and ``JSON.stringify`` omitted the unset key.
    """

    def split_csv(raw: str | None) -> list[str]:
        if not isinstance(raw, str):
            return []
        return [item.strip() for item in raw.split(",") if item.strip()]

    filters: dict[str, Any] = {}
    entity_types = split_csv(types)
    if entity_types:
        filters["entityTypes"] = entity_types
    wanted = [item for item in split_csv(sources) if item in {"local", "graph"}]
    if wanted:
        filters["sources"] = wanted
    return filters


# ── Scoring (pure) ───────────────────────────────────────────────────────────


def fuzzy_match(text: str, query_tokens: Sequence[str]) -> float:
    """Token-containment score in ``[0, 1]``, boosted for exact matches.

    The ratio of query tokens appearing anywhere in *text*, ``+0.3`` when the
    whole query is a substring and a further ``+0.5`` when the text *is* the
    query, capped at ``1.0``.
    """
    lowered = text.lower()
    matched = sum(1 for token in query_tokens if token in lowered)
    if matched == 0:
        return 0.0
    score = matched / len(query_tokens)
    full_query = " ".join(query_tokens)
    if full_query in lowered:
        score += 0.3
    if lowered == full_query:
        score += 0.5
    return min(score, 1.0)


def best_score(query_tokens: Sequence[str], *fields: str | None) -> float:
    """The best :func:`fuzzy_match` across the given fields; blanks are skipped."""
    best = 0.0
    for value in fields:
        if value:
            score = fuzzy_match(value, query_tokens)
            if score > best:
                best = score
    return best


def _text(record: Record, key: str) -> str | None:
    """A record field as a scorable string, or ``None`` when it is not one."""
    value = record.get(key)
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _joined(record: Record, key: str) -> str | None:
    """A string-array field joined with spaces — ``Array.join(" ")``."""
    value = record.get(key)
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return None


def _clip(value: str | None, length: int = 120) -> str:
    """``description?.slice(0, 120)`` — an absent description is blank."""
    return (value or "")[:length]


def _property(feature: Record, key: str) -> str | None:
    """One property off a GeoJSON feature, as a string when it is one."""
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return None
    return _text(properties, key)


# ── The local corpus half ────────────────────────────────────────────────────


def local_search(
    query: str, lexicons: Path, filters: dict[str, Any] | None = None
) -> dict[str, Any]:
    """The eighteen-domain local search — ``globalSearch``.

    A blank query short-circuits to an empty response *with* empty facets; every
    other query loads every domain and scores it. Nothing is cached, in keeping
    with the rest of :mod:`pinakes.lexicons.storage`.
    """
    filters = filters or {}
    trimmed = query.strip()
    if not trimmed:
        return {
            "results": [],
            "query": trimmed,
            "totalCount": 0,
            "facets": empty_facets(),
            "filters": filters,
        }

    tokens = _WHITESPACE.split(trimmed.lower())
    hits: list[Record] = []

    def add(
        entity_type: str,
        identifier: str,
        display_name: str,
        description: str,
        link_path: str,
        relevance: float,
    ) -> None:
        hits.append(
            {
                "entityType": entity_type,
                "id": identifier,
                "displayName": display_name,
                "description": description,
                "linkPath": link_path,
                "relevance": relevance,
            }
        )

    for language in storage.load_languages(lexicons):
        score = best_score(
            tokens,
            _text(language, "name"),
            _text(language, "nativeName"),
            _text(language, "id"),
        )
        if score > 0:
            native = language.get("nativeName")
            identifier = str(language["id"])
            add(
                "language",
                identifier,
                str(language["name"]),
                f"{native} — {identifier}" if native else identifier,
                f"/languages/{identifier}",
                score,
            )

    for word in storage.load_base_words(lexicons):
        score = best_score(
            tokens,
            _text(word, "word"),
            _text(word, "definition"),
            _text(word, "category"),
        )
        if score > 0:
            identifier = str(word["id"])
            add(
                "word",
                identifier,
                str(word["word"]),
                (word.get("definition") or word.get("category") or ""),
                f"/words/{identifier}",
                score,
            )

    for family in storage.language_families_with_counts(lexicons):
        score = best_score(tokens, _text(family, "name"))
        if score > 0:
            identifier = str(family["id"])
            add(
                "language-family",
                identifier,
                str(family["name"]),
                "Language family",
                f"/language-families/{identifier}",
                score,
            )

    for system in storage.load_writing_systems(lexicons):
        score = best_score(
            tokens,
            _text(system, "name"),
            _text(system, "type"),
            _text(system, "originRegion"),
        )
        if score > 0:
            identifier = str(system["id"])
            add(
                "writing-system",
                identifier,
                str(system["name"]),
                f"{system['type']} — {system['direction']} — {system['originRegion']}",
                f"/writing-systems/{identifier}",
                score,
            )

    for battle in storage.load_battles(lexicons):
        score = best_score(
            tokens,
            _text(battle, "name"),
            _text(battle, "warName"),
            _text(battle, "significance"),
        )
        if score > 0:
            identifier = str(battle["id"])
            add(
                "battle",
                identifier,
                str(battle["name"]),
                f"{battle['warName']} — {battle['date']}",
                f"/battles/{identifier}",
                score,
            )

    for route in storage.load_migration_routes(lexicons):
        score = best_score(
            tokens,
            _text(route, "name"),
            _text(route, "description"),
            _joined(route, "peoples"),
        )
        if score > 0:
            identifier = str(route["id"])
            add(
                "migration-route",
                identifier,
                str(route["name"]),
                _clip(_text(route, "description")) or str(route["routeType"]),
                f"/migration-routes/{identifier}",
                score,
            )

    for religion in storage.load_religions(lexicons):
        score = best_score(
            tokens,
            _text(religion, "name"),
            _text(religion, "originRegion"),
            _text(religion, "religionType"),
            _text(religion, "description"),
        )
        if score > 0:
            identifier = str(religion["id"])
            add(
                "religion",
                identifier,
                str(religion["name"]),
                f"{religion['religionType']} — {religion['originRegion']}",
                f"/religions/{identifier}",
                score,
            )

    for tradition in storage.load_music_traditions(lexicons):
        score = best_score(
            tokens,
            _text(tradition, "name"),
            _text(tradition, "region"),
            _text(tradition, "description"),
        )
        if score > 0:
            identifier = str(tradition["id"])
            add(
                "music-tradition",
                identifier,
                str(tradition["name"]),
                _clip(_text(tradition, "description")) or str(tradition["region"]),
                f"/music-traditions/{identifier}",
                score,
            )

    for instrument in storage.load_musical_instruments(lexicons):
        score = best_score(
            tokens,
            _text(instrument, "name"),
            _text(instrument, "instrumentFamily"),
            _text(instrument, "originRegion"),
        )
        if score > 0:
            identifier = str(instrument["id"])
            add(
                "musical-instrument",
                identifier,
                str(instrument["name"]),
                f"{instrument['instrumentFamily']} — {instrument['originRegion']}",
                f"/musical-instruments/{identifier}",
                score,
            )

    for cuisine in storage.load_cuisines(lexicons):
        score = best_score(
            tokens,
            _text(cuisine, "name"),
            _text(cuisine, "region"),
            _text(cuisine, "description"),
        )
        if score > 0:
            identifier = str(cuisine["id"])
            add(
                "cuisine",
                identifier,
                str(cuisine["name"]),
                _clip(_text(cuisine, "description")) or str(cuisine["region"]),
                f"/cuisines/{identifier}",
                score,
            )

    for item in storage.load_cuisine_items(lexicons):
        score = best_score(tokens, _text(item, "name"), _text(item, "foodType"))
        if score > 0:
            identifier = str(item["id"])
            add(
                "cuisine-item",
                identifier,
                str(item["name"]),
                str(item["foodType"]),
                f"/cuisine-items/{identifier}",
                score,
            )

    for art in storage.load_art_traditions(lexicons):
        score = best_score(
            tokens,
            _text(art, "name"),
            _text(art, "category"),
            _text(art, "description"),
        )
        if score > 0:
            identifier = str(art["id"])
            add(
                "art-tradition",
                identifier,
                str(art["name"]),
                _clip(_text(art, "description")) or str(art["category"]),
                f"/art-traditions/{identifier}",
                score,
            )

    for style in storage.load_architectural_styles(lexicons):
        score = best_score(
            tokens,
            _text(style, "name"),
            _text(style, "stylePeriod"),
            _text(style, "region"),
            _text(style, "description"),
        )
        if score > 0:
            identifier = str(style["id"])
            add(
                "architectural-style",
                identifier,
                str(style["name"]),
                _clip(_text(style, "description")) or str(style["stylePeriod"]),
                f"/architectural-styles/{identifier}",
                score,
            )

    for kinship in storage.load_kinship_systems(lexicons):
        score = best_score(
            tokens,
            _text(kinship, "id"),
            _text(kinship, "systemType"),
            _text(kinship, "descentRule"),
            _text(kinship, "residenceRule"),
        )
        if score > 0:
            identifier = str(kinship["id"])
            add(
                "kinship-system",
                identifier,
                f"{kinship['systemType']} ({identifier})",
                f"{kinship['descentRule']} — {kinship['residenceRule']}",
                f"/kinship-systems/{identifier}",
                score,
            )

    for good in storage.load_trade_goods(lexicons):
        score = best_score(
            tokens,
            _text(good, "name"),
            _text(good, "category"),
            _text(good, "economicSignificance"),
        )
        if score > 0:
            identifier = str(good["id"])
            add(
                "trade-good",
                identifier,
                str(good["name"]),
                f"{good['category']} — {good['originRegion']}",
                f"/trade-goods/{identifier}",
                score,
            )

    for event in storage.load_foodway_events(lexicons):
        score = best_score(
            tokens,
            _text(event, "name"),
            _text(event, "foodItem"),
            _text(event, "mechanism"),
        )
        if score > 0:
            identifier = str(event["id"])
            add(
                "foodway-event",
                identifier,
                str(event["name"]),
                f"{event['foodItem']} — {event['mechanism']}",
                f"/foodway-events/{identifier}",
                score,
            )

    for civilization in storage.load_civilizations(lexicons):
        name = _property(civilization, "name")
        civilization_id = _property(civilization, "civilizationId")
        capital = _property(civilization, "capital")
        structure = _property(civilization, "politicalStructure")
        score = best_score(tokens, name, capital, structure)
        if score > 0:
            fallback = str(civilization.get("id"))
            add(
                "civilization",
                civilization_id or fallback,
                name or f"Civilization {fallback}",
                " — ".join(
                    part
                    for part in (structure, f"Capital: {capital}" if capital else "")
                    if part
                ),
                f"/civilizations/{civilization_id or fallback}",
                score,
            )

    for site in storage.load_archaeological_sites(lexicons):
        name = _property(site, "name")
        site_id = _property(site, "siteId")
        site_type = _property(site, "siteType")
        properties = site.get("properties")
        findings = (
            _joined(properties, "findings") if isinstance(properties, dict) else None
        )
        score = best_score(tokens, name, site_type, findings)
        if score > 0:
            fallback = str(site.get("id"))
            add(
                "archaeological-site",
                site_id or fallback,
                name or f"Site {fallback}",
                site_type or "",
                f"/archaeological-sites/{site_id or fallback}",
                score,
            )

    # Sort by relevance descending, stamp the source, compute facets over the
    # FULL match set (before filtering and before the cap), then filter and slice.
    hits.sort(key=lambda hit: hit["relevance"], reverse=True)
    stamped = [{**hit, "source": "local", "tier": "curated"} for hit in hits]
    facets = compute_facets(stamped)
    filtered = apply_facet_filters(stamped, filters)

    return {
        "results": filtered[:RESULT_LIMIT],
        "query": trimmed,
        "totalCount": len(filtered),
        "facets": facets,
        "filters": filters,
    }


# ── The shared-graph half ────────────────────────────────────────────────────


def graph_hit_tier(hit: Record) -> str:
    """Coarse trust tier for a **graph-only** hit.

    The search payload carries `csid`/`name`/`label`/`qid`/`field` and no
    `source_url`, which an exact node classification needs — so a QID-anchored
    hit is `auto-admitted` (globally identified, already admitted to the shared
    graph) and a QID-less one `quarantine`. The detail panel refines this from
    the node's full provenance. Local hits never use it; they are `curated`.
    """
    qid = hit.get("qid")
    return "auto-admitted" if isinstance(qid, str) and qid.strip() else "quarantine"


def label_to_entity_type(label: str) -> str:
    """A graph ``:LABEL`` → the app's hyphenated `entityType` convention."""
    return re.sub(r"[\s_]+", "-", label.strip().lower())


def merge_graph_results(
    local_results: Sequence[Record],
    graph_hits: Iterable[Record],
    resolver: Resolver,
    query: str,
    filters: dict[str, Any] | None = None,
) -> tuple[list[Record], int, dict[str, Any]]:
    """Merge shared-graph hits into an already-computed local result set.

    Returns ``(results, graph_count, graph_facets)``. Pure and deterministic
    given a resolver.
    """
    filters = filters or {}

    local_csids: set[str] = set()
    stamped_local: list[Record] = []
    for result in local_results:
        resolved = resolver.resolve(
            EntityRef(
                type=str(result.get("entityType", "")),
                id=str(result.get("id", "")),
                name=str(result.get("displayName", "")),
            )
        )
        merged: Record = {**result, "tier": result.get("tier") or "curated"}
        if resolved is not None:
            local_csids.add(resolved.csid)
            merged["csid"] = resolved.csid
        stamped_local.append(merged)

    tokens = [token for token in query.lower().split() if token]
    seen: set[str] = set()
    graph_results: list[Record] = []
    for hit in graph_hits:
        csid = str(hit.get("csid", ""))
        if csid in local_csids:  # present in both → deduped, local wins
            continue
        if csid in seen:  # duplicate within the payload
            continue
        seen.add(csid)

        exact = hit.get("field") in {"csid", "wikidata_qid"}
        relevance = (
            1.0
            if exact
            else max(fuzzy_match(str(hit.get("name") or ""), tokens), GRAPH_NAME_FLOOR)
        )
        qid = hit.get("qid")
        matched_field = hit.get("field")
        graph_results.append(
            {
                "entityType": label_to_entity_type(str(hit.get("label") or "")),
                "id": csid,
                "displayName": hit.get("name"),
                "description": hit.get("label"),
                "linkPath": hit.get("graph") or "",
                "relevance": relevance,
                "source": "graph",
                "csid": csid,
                "confidence": 1.0 if exact else relevance,
                "tier": graph_hit_tier(hit),
                # `qid`/`matchField` are `|| undefined`, so a blank one is an
                # absent key rather than an empty string; `graphLink` is not —
                # a null there means "the sidecar could not resolve a view".
                "provenance": {
                    key: value
                    for key, value in (
                        ("source", "pinakes-engine graph"),
                        ("qid", qid or None),
                        ("matchField", matched_field or None),
                    )
                    if value is not None
                }
                | {"graphLink": hit.get("graph")},
            }
        )

    # Facets cover the full (deduped, unfiltered) graph contribution so the UI
    # can still offer graph-only facets while a filter is active; the merged
    # results themselves are filtered.
    facets = compute_facets(graph_results)
    filtered_graph = apply_facet_filters(graph_results, filters)
    merged_results = sorted(
        [*stamped_local, *filtered_graph],
        key=lambda result: result["relevance"],
        reverse=True,
    )
    return merged_results[:RESULT_LIMIT], len(filtered_graph), facets


# ── Federation ───────────────────────────────────────────────────────────────


def _engine_search(query: str, limit: int) -> dict[str, Any]:
    """The in-process engine search. Imported lazily — see :func:`federated_search`."""
    from pinakes.engine import corpus

    return corpus.search(query, limit)


def federated_search(
    query: str,
    lexicons: Path,
    filters: dict[str, Any] | None = None,
    *,
    local: Callable[[str, Path, dict[str, Any]], dict[str, Any]] | None = None,
    graph: Callable[[str, int], dict[str, Any]] | None = None,
    resolver: Resolver | None = None,
) -> dict[str, Any]:
    """Local corpus results merged with shared-graph hits.

    Degrades to **local-only** whenever the graph is unavailable, disabled or
    answers something unusable — the failure is swallowed and never surfaced, so
    a search still returns the curated corpus. That is why the ``except`` is
    bare: the TypeScript's ``catch {}`` covered a fetch failure, a non-200, a zod
    rejection and a malformed body alike, and narrowing it here would turn one of
    those into a 500 on a route that used to answer.
    """
    filters = filters or {}
    run_local = local or local_search
    graph_search = graph or _engine_search

    trimmed = query.strip()
    local_response = run_local(trimmed, lexicons, filters)
    if not trimmed:
        return local_response

    try:
        graph_hits = graph_search(trimmed, GRAPH_SEARCH_LIMIT)["results"]
    except Exception:  # noqa: BLE001 - the TypeScript's bare `catch`, deliberately
        return local_response

    results, graph_count, graph_facets = merge_graph_results(
        local_response["results"],
        graph_hits,
        resolver if resolver is not None else graph_resolver(lexicons),
        trimmed,
        filters,
    )
    return {
        "results": results,
        "query": trimmed,
        "totalCount": local_response["totalCount"] + graph_count,
        "facets": combine_facets(
            local_response.get("facets") or empty_facets(), graph_facets
        ),
        "filters": filters,
    }


__all__ = [
    "GRAPH_NAME_FLOOR",
    "GRAPH_SEARCH_LIMIT",
    "RESULT_LIMIT",
    "apply_facet_filters",
    "best_score",
    "combine_facets",
    "compute_facets",
    "empty_facets",
    "federated_search",
    "fuzzy_match",
    "graph_hit_tier",
    "label_to_entity_type",
    "local_search",
    "matches_filters",
    "merge_graph_results",
    "parse_search_filters",
]
