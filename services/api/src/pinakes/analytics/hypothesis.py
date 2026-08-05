"""Hypothesis generation — the port of `server/services/hypothesis-generation.ts`.

Two families of *generated, explicitly-speculative* research leads over the
cross-domain corpus:

* **common-ancestor hypotheses** — clusters of three-or-more distant, unrelated
  cultures carrying the same rare trait. This is the n-way generalization of the
  pairwise anomaly in :mod:`pinakes.analytics.anomaly`, and it reuses that
  module's rarity primitives rather than restating them: ``feature_key``,
  ``compute_feature_prevalence``, ``feature_rarity`` and ``haversine_km`` are
  imported, exactly as the TypeScript imported them from `anomaly-detection.ts`.
* **undiscovered-site-region predictions** — stretches of a documented migration
  corridor that run far from any recorded site, each returned as a center plus an
  **uncertainty radius** so the client can draw it as a map overlay.

The three invariants worth keeping in sight, because they are what makes a
surviving lead a lead:

* **Same-lineage and short-range clusters are excluded structurally.** A cluster
  whose whole membership shares a ``group_ids`` entry is an *expected* similarity,
  and one whose located members lie closer than ``min_spread_km`` is not "distant"
  at all. Neither is ever emitted, whatever it shares.
* **An empty known-site set is the strongest signal, not a missing one.**
  :func:`nearest_known_km` answers ``inf`` there, and that maps to a capped
  :data:`NO_KNOWN_SITE_GAP_KM` — a corridor with no recorded site anywhere is
  precisely where an undiscovered one would be.
* **Honesty is structural.** Every lead carries ``speculative: true`` **and**
  ``generated: true``, and the result carries both :data:`DISCLAIMER` and
  :data:`DISTINCT_FROM_CURATED` — these are generated leads, never the curated
  `urheimat-hypotheses` dataset, which is a different route and a different port
  unit entirely.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pinakes.analytics import tsv
from pinakes.analytics.anomaly import (
    CultureNode,
    NodeFeature,
    compute_feature_prevalence,
    feature_key,
    feature_rarity,
    haversine_km,
)
from pinakes.analytics.jsmath import js_round, locale_int, round_to

# ── Ancestor clustering ──────────────────────────────────────────────────────

#: Minimum cultures in a cluster — "cultures A/B/C share X".
DEFAULT_MIN_MEMBERS = 3
#: Minimum rarity for a trait to anchor a cluster.
DEFAULT_MIN_RARITY = 0.4
#: A trait carried by more cultures than this is not a distinctive signal.
DEFAULT_MAX_ANCHOR_PREVALENCE = 8
#: How far apart the two farthest members must lie to count as "distant", in km.
DEFAULT_MIN_SPREAD_KM = 2000
#: Maximum ancestor hypotheses returned.
DEFAULT_MAX_ANCESTOR = 25
#: Hard cap on nodes, guarding the clustering scan.
DEFAULT_MAX_NODES = 4000

# ── Site prediction ──────────────────────────────────────────────────────────

#: How far a corridor point must lie from any known site to count as a gap, in km.
DEFAULT_MIN_GAP_KM = 300
#: Cap on how large an uncertainty radius can grow, in km.
DEFAULT_MAX_UNCERTAINTY_KM = 400
#: Maximum site predictions returned.
DEFAULT_MAX_SITE_PREDICTIONS = 25
#: Effective gap for a corridor point with NO known site anywhere in the corpus.
#: A whole corridor devoid of recorded sites is the strongest "undiscovered"
#: signal, so it is treated as a large — but finite, and capped — gap rather than
#: dropped for having no distance to measure.
NO_KNOWN_SITE_GAP_KM = 3000

DISCLAIMER = (
    "Automatically generated hypotheses. These are computational leads, not "
    "findings: a shared rare trait may reflect independent invention or sampling "
    "bias, and a predicted site region is a probabilistic guess from incomplete "
    "data. Treat every item here as a direction for research to confirm or refute."
)

DISTINCT_FROM_CURATED = (
    "Generated leads — distinct from the curated `urheimat-hypotheses` dataset, "
    "which is a human-reviewed scholarly resource. These are produced by the "
    "correlation engine, marked speculative, and never overwrite or stand in for it."
)


@dataclass(frozen=True)
class Corridor:
    """A migration/trade corridor as an ordered list of lat/lng waypoints."""

    id: str
    name: str
    points: list[dict[str, float]]
    #: The peoples/route label, for the rationale prose.
    peoples: list[str] = field(default_factory=list)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def centroid_of(coordinates: Sequence[Mapping[str, float]]) -> dict[str, float] | None:
    """Mean of a list of coordinates, or ``None`` when there are none.

    The two accumulators are explicit loops, not :func:`sum`: CPython's builtin
    uses Neumaier compensated summation, which is *more* accurate than
    ``Array.reduce`` and therefore the wrong answer here — the mean is rounded
    and published (`services/api/CLAUDE.md`).
    """
    if not coordinates:
        return None
    lat = 0.0
    lng = 0.0
    for point in coordinates:
        lat += point["lat"]
        lng += point["lng"]
    return {
        "lat": round_to(lat / len(coordinates), 3),
        "lng": round_to(lng / len(coordinates), 3),
    }


def max_spread_km(coordinates: Sequence[Mapping[str, float]]) -> int | None:
    """Largest pairwise great-circle distance, or ``None`` for fewer than two."""
    if len(coordinates) < 2:
        return None
    widest = 0.0
    for index, first in enumerate(coordinates):
        for second in coordinates[index + 1 :]:
            distance = haversine_km(first, second)
            if distance > widest:
                widest = distance
    return js_round(widest)


def _merge_provenance(groups: Iterable[Iterable[str]]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for source in group:
            value = (source or "").strip()
            if not value or value in seen:
                continue
            seen.add(value)
            merged.append(value)
    return merged


def _all_share_a_group(members: Sequence[CultureNode]) -> bool:
    """Whether one ``group_ids`` entry is common to every member.

    Such a cluster is an *expected* similarity — one lineage, one language
    community — and is never a hypothesis.
    """
    if len(members) < 2:
        return True
    counts: dict[str, int] = {}
    for member in members:
        for group in dict.fromkeys(member.group_ids):
            counts[group] = counts.get(group, 0) + 1
    return any(count == len(members) for count in counts.values())


def _traits_shared_by_all(
    members: Sequence[CultureNode],
    prevalence: Mapping[str, int],
    total: int,
    min_rarity: float,
) -> list[dict[str, Any]]:
    """Rare traits present in EVERY member, rarest first."""
    if not members:
        return []

    labels: dict[str, NodeFeature] = {}
    common: dict[str, None] | None = None
    for member in members:
        keys = dict.fromkeys(feature_key(feature) for feature in member.features)
        for feature in member.features:
            labels.setdefault(feature_key(feature), feature)
        if common is None:
            common = keys
        else:
            common = {key: None for key in common if key in keys}

    shared: list[dict[str, Any]] = []
    for key in common or {}:
        count = prevalence.get(key, 0)
        # A trait every node carries is no signal at all.
        if count >= total:
            continue
        rarity = round_to(feature_rarity(count, total), 3)
        if rarity < min_rarity:
            continue
        feature = labels[key]
        shared.append(
            {
                "type": feature.type,
                "key": feature.key,
                "label": feature.label,
                "prevalence": count,
                "frequency": round_to(count / total if total > 0 else 0, 3),
                "rarity": rarity,
            }
        )
    shared.sort(key=lambda trait: (-float(trait["rarity"]), str(trait["key"])))
    return shared


def _ancestor_prose(
    members: Sequence[CultureNode],
    shared: Sequence[Mapping[str, Any]],
    spread: int | None,
) -> str:
    names = [member.name for member in members]
    name_list = (
        ", ".join(names)
        if len(names) <= 3
        else f"{', '.join(names[:3])} (+{len(names) - 3} more)"
    )
    traits = ", ".join(f'"{trait["label"]}"' for trait in shared[:3])
    more = f" and {len(shared) - 3} other rare traits" if len(shared) > 3 else ""
    distance = (
        f" despite lying up to ~{locale_int(spread)} km apart"
        if spread is not None
        else ""
    )
    return (
        f"{name_list} all share {traits}{more}{distance}. A rare trait recurring "
        "across cultures this distant and unrelated may point to a common "
        "ancestor, an undocumented diffusion route, or independent innovation — "
        "a lead to investigate, not a conclusion."
    )


def _build_ancestor_hypothesis(
    members: Sequence[CultureNode],
    shared: Sequence[Mapping[str, Any]],
    spread: int | None,
    located: Sequence[Mapping[str, float]],
) -> dict[str, Any]:
    ordered = sorted(members, key=lambda member: member.id)
    provenance = _merge_provenance(member.sources for member in ordered)

    # More independent rare traits, more members, provenance and real coordinates
    # all raise support — capped below certainty. The member term is measured
    # against the DEFAULT minimum even when the caller lowered it, as it was.
    confidence = round_to(
        _clamp(
            0.2
            + 0.1 * min(len(shared), 4)
            + 0.05 * min(len(members) - DEFAULT_MIN_MEMBERS + 1, 4)
            + (0.15 if provenance else 0)
            + (0.1 if spread is not None else 0),
            0,
            0.9,
        ),
        3,
    )

    identifier = f"ancestor:{'+'.join(member.id for member in ordered)}"[:200]
    return {
        "id": identifier,
        "kind": "common-ancestor",
        "members": [
            {"id": member.id, "name": member.name, "domain": member.domain}
            for member in ordered
        ],
        "sharedTraits": list(shared),
        "centroid": centroid_of(located),
        "spreadKm": spread,
        "confidence": confidence,
        "hypothesis": _ancestor_prose(ordered, shared, spread),
        "speculative": True,
        "generated": True,
        "provenance": provenance,
    }


def generate_ancestor_hypotheses(
    nodes: Sequence[CultureNode],
    *,
    min_members: int = DEFAULT_MIN_MEMBERS,
    min_rarity: float = DEFAULT_MIN_RARITY,
    max_anchor_prevalence: int = DEFAULT_MAX_ANCHOR_PREVALENCE,
    min_spread_km: float = DEFAULT_MIN_SPREAD_KM,
    max_ancestor_hypotheses: int = DEFAULT_MAX_ANCESTOR,
    max_nodes: int = DEFAULT_MAX_NODES,
) -> list[dict[str, Any]]:
    """Cluster cultures that all carry the same rare trait.

    Each rare trait whose carrier set is large enough, diverse enough (not one
    lineage) and geographically spread becomes a candidate cluster; the cluster's
    evidence is EVERY rare trait its whole membership shares — the anchor plus any
    corroborating co-occurring rare trait. Identical member sets are emitted once.
    """
    considered = list(nodes[:max_nodes])
    total = len(considered)
    prevalence = compute_feature_prevalence(considered)

    # feature key -> the nodes carrying it, each counted once.
    carriers: dict[str, list[CultureNode]] = {}
    for node in considered:
        for key in dict.fromkeys(feature_key(feature) for feature in node.features):
            carriers.setdefault(key, []).append(node)

    anchors = [
        (key, prevalence.get(key, 0), feature_rarity(prevalence.get(key, 0), total))
        for key in carriers
    ]
    anchors = [
        anchor
        for anchor in anchors
        if min_members <= anchor[1] <= max_anchor_prevalence and anchor[2] >= min_rarity
    ]
    # Rarest first, then by key, for stable and meaningful ids.
    anchors.sort(key=lambda anchor: (-anchor[2], anchor[0]))

    hypotheses: list[dict[str, Any]] = []
    emitted: set[str] = set()

    for key, _prev, _rarity in anchors:
        members = carriers.get(key, [])
        if len(members) < min_members:
            continue

        # Same-lineage clusters are expected, not hypotheses.
        if _all_share_a_group(members):
            continue

        located = [member.coordinates for member in members if member.coordinates]
        spread = max_spread_km(located)
        # With coordinates for two or more members, they must really be far apart.
        if spread is not None and spread < min_spread_km:
            continue

        # A corroborating trait shared by the same set is one cluster, not two.
        member_key = "|".join(sorted(member.id for member in members))
        if member_key in emitted:
            continue
        emitted.add(member_key)

        shared = _traits_shared_by_all(members, prevalence, total, min_rarity)
        # The anchor should be among them; guard against an empty evidence set.
        if not shared:
            continue

        hypotheses.append(
            _build_ancestor_hypothesis(members, shared, spread, located)
        )

    hypotheses.sort(
        key=lambda found: (
            -float(found["confidence"]),
            -len(found["sharedTraits"]),
            str(found["id"]),
        )
    )
    return hypotheses[:max_ancestor_hypotheses]


# ── Undiscovered-site-region prediction ──────────────────────────────────────


def nearest_known_km(
    point: Mapping[str, float], known: Sequence[Mapping[str, float]]
) -> float:
    """Distance to the nearest of a set of known points; ``inf`` when there are none."""
    nearest = math.inf
    for site in known:
        distance = haversine_km(point, site)
        if distance < nearest:
            nearest = distance
    return nearest


def sample_corridor(
    points: Sequence[Mapping[str, float]],
) -> list[dict[str, float]]:
    """Every waypoint plus the midpoint of every leg.

    The midpoints matter: a long straight leg between two waypoints is exactly
    where a gap would hide, and sampling only the waypoints would miss it.
    """
    if not points:
        return []
    if len(points) == 1:
        return [dict(points[0])]
    sampled: list[dict[str, float]] = []
    for first, second in zip(points, points[1:], strict=False):
        sampled.append(dict(first))
        sampled.append(
            {
                "lat": (first["lat"] + second["lat"]) / 2,
                "lng": (first["lng"] + second["lng"]) / 2,
            }
        )
    sampled.append(dict(points[-1]))
    return sampled


def _site_rationale(corridor: Corridor, gap: float) -> str:
    peoples = f" ({', '.join(corridor.peoples)})" if corridor.peoples else ""
    return (
        f"On the {corridor.name} corridor{peoples}, this point lies "
        f"~{locale_int(js_round(gap))} km from the nearest recorded site — a "
        "stretch travellers crossed but where no settlement is documented. An "
        "undiscovered site may lie within the highlighted region; the radius "
        "reflects the positional uncertainty."
    )


def predict_site_regions(
    corridors: Sequence[Corridor],
    known_sites: Sequence[Mapping[str, float]],
    *,
    min_gap_km: float = DEFAULT_MIN_GAP_KM,
    max_uncertainty_km: float = DEFAULT_MAX_UNCERTAINTY_KM,
    max_site_predictions: int = DEFAULT_MAX_SITE_PREDICTIONS,
) -> list[dict[str, Any]]:
    """Scan corridor samples for points far from any known site.

    A surviving gap becomes a predicted region whose uncertainty radius scales
    with the gap. Near-identical centers collapse into one ~1° cell, so a single
    long empty corridor yields a lead rather than a stream of them.
    """
    predictions: list[dict[str, Any]] = []

    for corridor in corridors:
        seen_cells: set[str] = set()
        for point in sample_corridor(corridor.points):
            raw = nearest_known_km(point, known_sites)
            # No known site anywhere ⇒ a capped "very far" gap, the strongest lead.
            gap = raw if math.isfinite(raw) else float(NO_KNOWN_SITE_GAP_KM)
            if gap < min_gap_km:
                continue

            cell = f"{js_round(point['lat'])},{js_round(point['lng'])}"
            if cell in seen_cells:
                continue
            seen_cells.add(cell)

            uncertainty = js_round(_clamp(gap * 0.5, 50, max_uncertainty_km))
            # A bigger gap on a documented corridor is a stronger lead, but an
            # enormous one is also less certain — hence the cap and the taper.
            confidence = round_to(_clamp(0.25 + 0.4 * min(gap / 1500, 1), 0.2, 0.85), 3)

            predictions.append(
                {
                    "id": (
                        f"site:{corridor.id}:"
                        f"{js_round(point['lat'])}:{js_round(point['lng'])}"
                    ),
                    "kind": "site-location",
                    "center": {
                        "lat": round_to(point["lat"], 3),
                        "lng": round_to(point["lng"], 3),
                    },
                    "uncertaintyRadiusKm": uncertainty,
                    "confidence": confidence,
                    "nearestKnownKm": js_round(gap),
                    "basedOn": {
                        "corridorId": corridor.id,
                        "corridorName": corridor.name,
                    },
                    "rationale": _site_rationale(corridor, gap),
                    "speculative": True,
                    "generated": True,
                }
            )

    predictions.sort(
        key=lambda found: (
            -float(found["nearestKnownKm"]),
            -float(found["confidence"]),
            str(found["id"]),
        )
    )
    return predictions[:max_site_predictions]


def site_predictions_to_geojson(
    predictions: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Project predictions into a ``[lng, lat]`` FeatureCollection of circles.

    Each feature carries its ``uncertaintyRadiusKm`` so the map layer draws a
    circle whose *size* is the uncertainty region and whose styling is the
    confidence — the overlay is the honest shape of the claim.
    """
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        prediction["center"]["lng"],
                        prediction["center"]["lat"],
                    ],
                },
                "properties": {
                    "id": prediction["id"],
                    "kind": "site-location",
                    "uncertaintyRadiusKm": prediction["uncertaintyRadiusKm"],
                    "confidence": prediction["confidence"],
                    "nearestKnownKm": prediction["nearestKnownKm"],
                    "corridorName": prediction["basedOn"]["corridorName"],
                    "rationale": prediction["rationale"],
                    "speculative": True,
                    "generated": True,
                },
            }
            for prediction in predictions
        ],
    }


# ── Orchestrator ─────────────────────────────────────────────────────────────


def generate_hypotheses(
    nodes: Sequence[CultureNode],
    corridors: Sequence[Corridor],
    known_sites: Sequence[Mapping[str, float]],
    *,
    min_members: int = DEFAULT_MIN_MEMBERS,
    min_rarity: float = DEFAULT_MIN_RARITY,
    max_anchor_prevalence: int = DEFAULT_MAX_ANCHOR_PREVALENCE,
    min_spread_km: float = DEFAULT_MIN_SPREAD_KM,
    max_ancestor_hypotheses: int = DEFAULT_MAX_ANCESTOR,
    max_nodes: int = DEFAULT_MAX_NODES,
    min_gap_km: float = DEFAULT_MIN_GAP_KM,
    max_uncertainty_km: float = DEFAULT_MAX_UNCERTAINTY_KM,
    max_site_predictions: int = DEFAULT_MAX_SITE_PREDICTIONS,
) -> dict[str, Any]:
    """Both families of lead, the honest stats, and the two framing notes."""
    considered = list(nodes[:max_nodes])
    prevalence = compute_feature_prevalence(considered)

    ancestor_hypotheses = generate_ancestor_hypotheses(
        nodes,
        min_members=min_members,
        min_rarity=min_rarity,
        max_anchor_prevalence=max_anchor_prevalence,
        min_spread_km=min_spread_km,
        max_ancestor_hypotheses=max_ancestor_hypotheses,
        max_nodes=max_nodes,
    )
    site_predictions = predict_site_regions(
        corridors,
        known_sites,
        min_gap_km=min_gap_km,
        max_uncertainty_km=max_uncertainty_km,
        max_site_predictions=max_site_predictions,
    )

    return {
        "ancestorHypotheses": ancestor_hypotheses,
        "sitePredictions": site_predictions,
        "stats": {
            "nodesConsidered": len(considered),
            "traitsIndexed": len(prevalence),
            "clustersFound": len(ancestor_hypotheses),
            "corridorsScanned": len(corridors),
            "knownSites": len(known_sites),
        },
        "disclaimer": DISCLAIMER,
        "distinctFromCurated": DISTINCT_FROM_CURATED,
    }


# ── The corpus projection ────────────────────────────────────────────────────


def waypoints_to_points(waypoints: Any) -> list[dict[str, float]]:
    """A GeoJSON LineString's ``coordinates`` as ordered lat/lng points.

    GeoJSON is ``[lng, lat]``; everything above is ``{lat, lng}``. A malformed
    cell yields no points rather than raising — half the corpus's geometry
    columns are hand-authored.
    """
    if not isinstance(waypoints, Mapping):
        return []
    coordinates = waypoints.get("coordinates")
    if not isinstance(coordinates, list):
        return []
    points: list[dict[str, float]] = []
    for pair in coordinates:
        if (
            isinstance(pair, list)
            and len(pair) >= 2
            and isinstance(pair[0], (int, float))
            and not isinstance(pair[0], bool)
            and isinstance(pair[1], (int, float))
            and not isinstance(pair[1], bool)
        ):
            points.append({"lat": float(pair[1]), "lng": float(pair[0])})
    return points


def load_corridors(lexicons: Path) -> list[Corridor]:
    """`migration-routes.tsv` → corridors. A route with <2 waypoints is not one."""
    parsed = tsv.read_tsv(lexicons, "migration-routes.tsv")
    if parsed is None:
        return []
    header, rows = parsed
    id_index = tsv.required_index(header, "id")
    name_index = tsv.index_of(header, "name")
    waypoints_index = tsv.index_of(header, "waypoints")
    peoples_index = tsv.index_of(header, "peoples")

    corridors: list[Corridor] = []
    for row in rows:
        points = waypoints_to_points(tsv.json_cell(row, waypoints_index, {}))
        if len(points) < 2:
            continue
        corridors.append(
            Corridor(
                id=tsv.cell(row, id_index),
                name=tsv.text_cell(row, name_index),
                points=points,
                peoples=tsv.json_array(row, peoples_index),
            )
        )
    return corridors


def load_known_sites(lexicons: Path) -> list[dict[str, float]]:
    """Everywhere a site or settlement is already recorded.

    Two files with two coordinate dialects: `archaeological-sites.tsv` stores a
    ``{lat, lng}`` JSON cell (and a row whose cell is blank or unparseable is not
    a site at all), while `settlements.tsv` stores flat `latitude`/`longitude`
    columns where an unparseable cell reads as ``0`` — Null Island, faithfully,
    because that is what the distance scan has always measured against.

    Both loaders require columns they never read here (`name`, `site_type`),
    because their TypeScript originals did: a lexicon that has lost one is a
    broken corpus, and reading it as an empty one would silently drop every known
    site and turn the whole corridor scan into "nothing is recorded anywhere".
    """
    sites: list[dict[str, float]] = []

    parsed = tsv.read_tsv(lexicons, "archaeological-sites.tsv")
    if parsed is not None:
        header, rows = parsed
        tsv.required_index(header, "id")
        tsv.required_index(header, "name")
        tsv.required_index(header, "site_type")
        coordinates_index = tsv.required_index(header, "coordinates")
        for row in rows:
            if not tsv.cell(row, coordinates_index).strip():
                continue
            cell = tsv.json_cell(row, coordinates_index, None)
            if cell is None:
                continue
            # A cell that parses but is not a lat/lng object yields NaNs, as the
            # TypeScript's `coords.lat` did; NaN never wins a nearest-site
            # comparison on either side, so the row is counted and ignored.
            lat = cell.get("lat") if isinstance(cell, Mapping) else None
            lng = cell.get("lng") if isinstance(cell, Mapping) else None
            sites.append(
                {
                    "lat": float(lat) if isinstance(lat, (int, float)) else math.nan,
                    "lng": float(lng) if isinstance(lng, (int, float)) else math.nan,
                }
            )

    parsed = tsv.read_tsv(lexicons, "settlements.tsv")
    if parsed is not None:
        header, rows = parsed
        tsv.required_index(header, "id")
        tsv.required_index(header, "name")
        lat_index = tsv.index_of(header, "latitude")
        lng_index = tsv.index_of(header, "longitude")
        for row in rows:
            latitude = tsv.js_parse_float(tsv.cell(row, lat_index))
            longitude = tsv.js_parse_float(tsv.cell(row, lng_index))
            sites.append(
                {
                    "lat": 0.0 if math.isnan(latitude) else latitude,
                    "lng": 0.0 if math.isnan(longitude) else longitude,
                }
            )

    return sites
