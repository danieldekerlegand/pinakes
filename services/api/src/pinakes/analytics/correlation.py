"""Cross-domain correlation, ported off `server/services/cross-domain-correlation*.ts`.

Two paths, one scorer. :func:`score_correlations` and :func:`rank_correlations`
are pure over an already-loaded ``list[DomainEntity]``, and both the in-memory
TSV loaders below *and* the graph-backed projection feed them the same shape —
which is the parity guarantee the TypeScript documented and this port keeps: on
a shared fixture the two paths produce identical results, so the ``source``
field says which one answered and nothing else changes.

The graph path stays **opt-in** (``CORRELATION_GRAPH_ENABLED``) and degrades:
with the flag off, a domain that has no `:LABEL`, or an unreachable Neo4j, the
in-memory path runs instead. Out of the box that means every answer carries
``source: "memory"`` — the recorded contract of a checkout with no graph stack.

What the port is careful about:

* **Rounding is rendered, not computed.** Scores are ``Math.round(x * 100) / 100``
  and the summary's average is ``toFixed(2)``; see :mod:`pinakes.analytics.jsmath`
  for why Python's defaults would disagree.
* **Self-pairs are excluded on (id, domain), not on id.** Correlating a domain
  with itself is legal and drops only the diagonal.
* **A blank coordinate cell is the origin.** The loaders default `coordinates`
  to ``{0, 0}`` rather than to nothing (see :mod:`pinakes.analytics.corpus`), so
  such rows really do score geographic proximity to each other.
"""

from __future__ import annotations

import datetime as _datetime
import math
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pinakes.analytics import corpus
from pinakes.analytics.jsmath import js_round, round_to, to_fixed
from pinakes.engine import graph as engine_graph
from pinakes.engine.errors import EngineUnavailable

#: The cultural domains a correlation query may name.
DOMAIN_TYPES: tuple[str, ...] = (
    "language",
    "cuisine",
    "music",
    "religion",
    "haplogroup",
    "civilization",
)

#: The three relationships that can be scored between two domains.
RELATIONSHIP_TYPES: tuple[str, ...] = (
    "co-occurrence",
    "temporal-correlation",
    "geographic-overlap",
)

#: Ranked output is capped here, before the summary is built from it.
RESULT_LIMIT = 50

#: Earth's mean radius, in kilometres.
EARTH_RADIUS_KM = 6371


@dataclass(frozen=True)
class DomainEntity:
    """The storage-agnostic shape both loading paths project into."""

    id: str
    name: str
    domain: str
    language_ids: list[str]
    region: str | None
    coordinates: dict[str, float] | None
    time_start: int | None
    time_end: int | None


#: The curated correlation queries `/api/cross-domain/prebuilt-queries` lists.
PREBUILT_QUERIES: tuple[dict[str, Any], ...] = (
    {
        "id": "ie-r1b",
        "name": "Indo-European languages vs. R1b haplogroup distribution",
        "description": (
            "Explores the co-occurrence of Indo-European language speakers and "
            "the R1b Y-DNA haplogroup, which is concentrated in Western Europe "
            "and often linked to the spread of Celtic and Italic branches."
        ),
        "request": {
            "domainA": "language",
            "domainB": "haplogroup",
            "relationshipType": "co-occurrence",
        },
    },
    {
        "id": "islam-arabic",
        "name": "Spread of Islam vs. Arabic loanwords",
        "description": (
            "Examines the temporal and geographic correlation between the "
            "expansion of Islam and the adoption of Arabic loanwords across "
            "contact languages from Swahili to Malay."
        ),
        "request": {
            "domainA": "religion",
            "domainB": "language",
            "relationshipType": "temporal-correlation",
        },
    },
    {
        "id": "austronesian-outrigger",
        "name": "Austronesian expansion vs. outrigger canoe archaeology",
        "description": (
            "Traces the geographic overlap between Austronesian-speaking "
            "populations and archaeological evidence of outrigger canoe "
            "technology from Taiwan to Madagascar."
        ),
        "request": {
            "domainA": "language",
            "domainB": "civilization",
            "relationshipType": "geographic-overlap",
        },
    },
    {
        "id": "roman-roads-romance",
        "name": "Roman roads vs. Romance language boundaries",
        "description": (
            "Investigates how Roman infrastructure and civilization boundaries "
            "correlate with the modern distribution of Romance languages "
            "descended from Latin."
        ),
        "request": {
            "domainA": "civilization",
            "domainB": "language",
            "relationshipType": "geographic-overlap",
        },
    },
)


def haversine_km(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    """Great-circle distance between two lat/lng points, in kilometres."""
    d_lat = math.radians(b["lat"] - a["lat"])
    d_lng = math.radians(b["lng"] - a["lng"])
    a_lat = math.radians(a["lat"])
    b_lat = math.radians(b["lat"])
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(a_lat) * math.cos(b_lat) * math.sin(d_lng / 2) ** 2
    )
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def _entity_ref(entity: DomainEntity) -> dict[str, str]:
    return {"id": entity.id, "name": entity.name, "domain": entity.domain}


def _same_entity(a: DomainEntity, b: DomainEntity) -> bool:
    """The diagonal a self-correlation drops — matched on id *and* domain."""
    return a.id == b.id and a.domain == b.domain


def _shared_languages(a: DomainEntity, b: DomainEntity) -> list[str]:
    """``a.languageIds.filter(id => b.languageIds.includes(id))``.

    Order and duplicates are kept: the Jaccard numerator counts entries, so a
    repeated id in `a` really does raise the score.
    """
    return [identifier for identifier in a.language_ids if identifier in b.language_ids]


def compute_co_occurrence(
    entities_a: Sequence[DomainEntity], entities_b: Sequence[DomainEntity]
) -> list[dict[str, Any]]:
    """Jaccard similarity of the two entities' associated-language sets."""
    correlations: list[dict[str, Any]] = []
    for a in entities_a:
        if not a.language_ids:
            continue
        for b in entities_b:
            if not b.language_ids:
                continue
            if _same_entity(a, b):
                continue
            shared = _shared_languages(a, b)
            if not shared:
                continue
            union = set(a.language_ids) | set(b.language_ids)
            score = len(shared) / len(union)
            correlations.append(
                {
                    "entityA": _entity_ref(a),
                    "entityB": _entity_ref(b),
                    "score": round_to(score, 2),
                    "evidence": [
                        f"Shared language IDs: {', '.join(shared)}",
                        f"Jaccard similarity: {len(shared)}/{len(union)}",
                    ],
                }
            )
    return correlations


def compute_temporal_correlation(
    entities_a: Sequence[DomainEntity],
    entities_b: Sequence[DomainEntity],
    now_year: int,
) -> list[dict[str, Any]]:
    """Overlapping active spans, boosted when the pair also shares languages.

    ``now_year`` closes an open-ended span and is a parameter so the result is
    deterministic — the TypeScript defaulted it to the wall clock.
    """
    correlations: list[dict[str, Any]] = []
    for a in entities_a:
        if a.time_start is None:
            continue
        a_end = a.time_end if a.time_end is not None else now_year
        for b in entities_b:
            if b.time_start is None:
                continue
            if _same_entity(a, b):
                continue
            b_end = b.time_end if b.time_end is not None else now_year

            overlap_start = max(a.time_start, b.time_start)
            overlap_end = min(a_end, b_end)
            if overlap_start > overlap_end:
                continue

            overlap_years = overlap_end - overlap_start
            max_span = max(a_end - a.time_start, b_end - b.time_start, 1)
            score = min(overlap_years / max_span, 1)
            if score < 0.1:
                continue

            shared = _shared_languages(a, b)
            boosted = min(score + len(shared) * 0.05, 1)

            evidence = [
                f"Temporal overlap: {overlap_years} years "
                f"({overlap_start} to {overlap_end})"
            ]
            if shared:
                evidence.append(f"Also share languages: {', '.join(shared)}")

            correlations.append(
                {
                    "entityA": _entity_ref(a),
                    "entityB": _entity_ref(b),
                    "score": round_to(boosted, 2),
                    "evidence": evidence,
                }
            )
    return correlations


def compute_geographic_overlap(
    entities_a: Sequence[DomainEntity], entities_b: Sequence[DomainEntity]
) -> list[dict[str, Any]]:
    """Coordinate proximity (< 2000 km) and/or overlapping region names."""
    correlations: list[dict[str, Any]] = []
    for a in entities_a:
        for b in entities_b:
            if _same_entity(a, b):
                continue

            evidence: list[str] = []
            score = 0.0

            if a.coordinates and b.coordinates:
                distance = haversine_km(a.coordinates, b.coordinates)
                if distance < 2000:
                    score = max(score, 1 - distance / 2000)
                    evidence.append(f"Geographic distance: {js_round(distance)} km")

            if a.region and b.region:
                region_a = a.region.lower()
                region_b = b.region.lower()
                if region_a == region_b or region_a in region_b or region_b in region_a:
                    score = max(score, 0.5)
                    evidence.append(f"Shared region: {a.region}")

            shared = _shared_languages(a, b)
            if shared:
                score = min(score + len(shared) * 0.05, 1)
                evidence.append(f"Shared languages: {', '.join(shared)}")

            if score < 0.1 or not evidence:
                continue

            correlations.append(
                {
                    "entityA": _entity_ref(a),
                    "entityB": _entity_ref(b),
                    "score": round_to(score, 2),
                    "evidence": evidence,
                }
            )
    return correlations


def score_correlations(
    relationship_type: str,
    entities_a: Sequence[DomainEntity],
    entities_b: Sequence[DomainEntity],
    now_year: int | None = None,
) -> list[dict[str, Any]]:
    """Dispatch to the scorer for *relationship_type*. Unknown types score nothing."""
    if relationship_type == "co-occurrence":
        return compute_co_occurrence(entities_a, entities_b)
    if relationship_type == "temporal-correlation":
        year = now_year if now_year is not None else _datetime.date.today().year
        return compute_temporal_correlation(entities_a, entities_b, year)
    if relationship_type == "geographic-overlap":
        return compute_geographic_overlap(entities_a, entities_b)
    return []


def rank_correlations(
    domain_a: str,
    domain_b: str,
    relationship_type: str,
    correlations: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    """Sort by score descending, keep the top 50, and build the summary line."""
    ranked = sorted(correlations, key=lambda entry: -float(entry["score"]))[
        :RESULT_LIMIT
    ]
    # Accumulated in a loop, NOT with `sum()`: since 3.12 the builtin uses
    # Neumaier compensated summation over floats, which is more accurate than
    # `Array.reduce` and therefore disagrees with it — on this fixture by one
    # digit of `toFixed(2)`, straight into the summary line.
    total = 0.0
    for entry in ranked:
        total += float(entry["score"])
    average = total / len(ranked) if ranked else 0.0
    summary = (
        f"Found {len(ranked)} {relationship_type} correlations between "
        f"{domain_a} and {domain_b} domains (avg score: {to_fixed(average, 2)})."
    )
    return {
        "domainA": domain_a,
        "domainB": domain_b,
        "correlations": ranked,
        "summary": summary,
    }


# ── The in-memory (TSV) path ─────────────────────────────────────────────────


def load_domain(domain: str, lexicons: Path) -> list[DomainEntity]:
    """Project one corpus domain into :class:`DomainEntity`. Unknown domain ⇒ empty."""
    if domain == "language":
        return [
            DomainEntity(
                id=row.id,
                name=row.name,
                domain="language",
                language_ids=[row.id],
                region=row.region,
                coordinates=row.coordinates,
                time_start=None,
                time_end=None,
            )
            for row in corpus.load_languages(lexicons)
        ]
    if domain == "cuisine":
        return [
            DomainEntity(
                id=row.id,
                name=row.name,
                domain="cuisine",
                language_ids=row.associated_language_ids,
                region=row.region,
                coordinates=row.coordinates,
                time_start=row.time_origin,
                time_end=row.time_end,
            )
            for row in corpus.load_cuisines(lexicons)
        ]
    if domain == "music":
        return [
            DomainEntity(
                id=row.id,
                name=row.name,
                domain="music",
                language_ids=row.associated_language_ids,
                region=row.region,
                coordinates=row.coordinates,
                time_start=row.time_origin,
                time_end=row.time_end,
            )
            for row in corpus.load_music_traditions(lexicons)
        ]
    if domain == "religion":
        return [
            DomainEntity(
                id=row.id,
                name=row.name,
                domain="religion",
                language_ids=row.associated_language_ids,
                region=row.origin_region,
                coordinates=row.coordinates,
                time_start=row.time_origin,
                time_end=row.time_end,
            )
            for row in corpus.load_religions(lexicons)
        ]
    if domain == "haplogroup":
        return [
            DomainEntity(
                id=row.id,
                name=row.name,
                domain="haplogroup",
                # A haplogroup's "languages" are language *families* — the id
                # space differs, which is why haplogroup↔language co-occurrence
                # only ever fires against a family-keyed domain.
                language_ids=row.associated_language_family_ids,
                region=row.geographic_origin,
                coordinates=None,
                time_start=row.time_origin,
                time_end=None,
            )
            for row in corpus.load_haplogroups(lexicons)
        ]
    if domain == "civilization":
        return [
            DomainEntity(
                id=row.id,
                name=row.name,
                domain="civilization",
                language_ids=row.associated_language_ids,
                region=None,
                coordinates=None,
                time_start=row.time_start,
                time_end=row.time_end,
            )
            for row in corpus.load_civilizations(lexicons)
        ]
    return []


def query_correlation(
    domain_a: str,
    domain_b: str,
    relationship_type: str,
    lexicons: Path,
    now_year: int | None = None,
) -> dict[str, Any]:
    """The in-memory path: load both domains off disk and score them."""
    entities_a = load_domain(domain_a, lexicons)
    entities_b = load_domain(domain_b, lexicons)
    scored = score_correlations(relationship_type, entities_a, entities_b, now_year)
    return rank_correlations(domain_a, domain_b, relationship_type, scored)


# ── The graph-backed path ────────────────────────────────────────────────────

#: The correlation domains that exist as node `:LABEL`s in the shared graph, per
#: `contracts/canonical-schema.json`. `music` and `haplogroup` are pinakes-only
#: domains with no graph node type, so a query touching either is never
#: graph-eligible and always takes the in-memory path.
DOMAIN_LABELS: dict[str, str] = {
    "language": "Language",
    "cuisine": "Cuisine",
    "religion": "Religion",
    "civilization": "Culture",
}

#: Opt-in for the graph-backed path. Off by default, so a checkout with no Neo4j
#: keeps serving correlations out of the box.
GRAPH_ENABLED_ENV = "CORRELATION_GRAPH_ENABLED"

_TRUTHY = frozenset({"true", "1", "yes", "on"})

#: Loads every node carrying a `:LABEL`, in the engine's node projection.
NodeLoader = Callable[[str], list[dict[str, Any]]]


def graph_domain_label(domain: str) -> str | None:
    """The `:LABEL` for a domain, or ``None`` when the domain is not in the graph."""
    return DOMAIN_LABELS.get(domain)


def is_graph_eligible(domain_a: str, domain_b: str) -> bool:
    """True when *both* domains map to a graph `:LABEL`."""
    return (
        graph_domain_label(domain_a) is not None
        and graph_domain_label(domain_b) is not None
    )


def is_graph_correlation_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Whether the graph-backed path is switched on."""
    raw = (env if env is not None else os.environ).get(GRAPH_ENABLED_ENV)
    return raw is not None and raw.strip().lower() in _TRUTHY


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _non_empty(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def graph_node_to_domain_entity(node: Mapping[str, Any], domain: str) -> DomainEntity:
    """Project one engine graph node into a :class:`DomainEntity`.

    ``pinakes_id`` — the alias back to the source row — is the entity id when the
    node carries one, so a graph-loaded entity has the same id as its in-memory
    counterpart; otherwise the csid stands in. Coordinates come from the
    canonical `lat`/`lon` dimensions.
    """
    properties = node.get("properties") or {}
    latitude = _finite(properties.get("lat"))
    longitude = _finite(properties.get("lon"))
    time_start = _finite(properties.get("time_start"))
    time_end = _finite(properties.get("time_end"))
    return DomainEntity(
        id=_non_empty(properties.get("pinakes_id")) or str(node.get("csid", "")),
        name=str(node.get("name") or ""),
        domain=domain,
        language_ids=_string_list(properties.get("associated_language_ids")),
        region=_non_empty(properties.get("region")),
        coordinates=(
            {"lat": latitude, "lng": longitude}
            if latitude is not None and longitude is not None
            else None
        ),
        time_start=int(time_start) if time_start is not None else None,
        time_end=int(time_end) if time_end is not None else None,
    )


def correlate_via_graph(
    domain_a: str,
    domain_b: str,
    relationship_type: str,
    *,
    load_nodes: NodeLoader | None = None,
    now_year: int | None = None,
) -> dict[str, Any]:
    """Score a correlation entirely against the shared graph.

    Raises :class:`~pinakes.engine.errors.EngineUnavailable` when a domain has no
    graph label or Neo4j is unreachable — the caller degrades to the in-memory
    path on exactly that error.
    """
    loader = load_nodes if load_nodes is not None else engine_graph.nodes_by_label
    projected: list[list[DomainEntity]] = []
    for domain in (domain_a, domain_b):
        label = graph_domain_label(domain)
        if label is None:
            raise EngineUnavailable(f'domain "{domain}" has no graph label')
        projected.append(
            [graph_node_to_domain_entity(node, domain) for node in loader(label)]
        )
    scored = score_correlations(
        relationship_type, projected[0], projected[1], now_year
    )
    return rank_correlations(domain_a, domain_b, relationship_type, scored)


def correlate_with_graph_fallback(
    domain_a: str,
    domain_b: str,
    relationship_type: str,
    fallback: Callable[[], dict[str, Any]],
    *,
    load_nodes: NodeLoader | None = None,
    now_year: int | None = None,
    env: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], str]:
    """Serve from the graph when it is enabled, eligible and reachable; else *fallback*.

    Returns ``(result, source)`` where *source* is ``"graph"`` or ``"memory"``.
    This is the single decision point the route calls, so the feature flag and
    the degradation live in one tested place.
    """
    if not is_graph_correlation_enabled(env) or not is_graph_eligible(
        domain_a, domain_b
    ):
        return fallback(), "memory"
    try:
        return (
            correlate_via_graph(
                domain_a,
                domain_b,
                relationship_type,
                load_nodes=load_nodes,
                now_year=now_year,
            ),
            "graph",
        )
    except EngineUnavailable:
        return fallback(), "memory"
