"""Anomaly detection — the port of `server/services/anomaly-detection.ts`.

Scans the cross-domain corpus for *statistically unexpected* similarities: a
rare shared musical scale, pottery style, or art motif turning up in two
cultures that are far apart in space **and** unrelated by language or lineage.
Each result is framed as a hypothesis with its evidence and provenance.

The scoring is pure over a generic :class:`CultureNode` — no filesystem, no
clock — and :func:`load_nodes` is the one function that touches the corpus, so
the whole scan is unit-testable on synthetic rows.

Three invariants the port keeps deliberately, because they are what make a
surviving result *unexpected* rather than merely similar:

* **Expected similarities are excluded structurally.** A pair that shares a
  ``group_ids`` entry (same language / lineage) or is geographically near
  (< ``near_km``, default 1500) is never an anomaly, whatever it shares.
* **A universal feature carries no surprise.** Rarity is normalized
  self-information, so a trait every node has scores 0 and is skipped outright.
* **Honesty is structural.** Every result carries ``speculative: true``, a
  plain-language hypothesis and the union of both records' citations, and the
  result carries :data:`DISCLAIMER`. ``confidence`` (how well *documented* the
  observation is) is a separate number from ``surpriseScore`` (how unexpected).
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pinakes.analytics import corpus
from pinakes.analytics.jsmath import js_round, locale_int, round_to

#: Minimum surprise score reported.
DEFAULT_MIN_SURPRISE = 0.15
#: Maximum anomalies returned.
DEFAULT_LIMIT = 50
#: Below this distance a pair is "near", so its similarity is *expected*.
DEFAULT_NEAR_KM = 1500
#: Half the Earth's circumference — the greatest possible great-circle distance.
DEFAULT_MAX_KM = 20015
#: Hard cap on nodes, guarding the O(n²) scan.
DEFAULT_MAX_NODES = 4000

#: Earth's mean radius, in kilometres.
EARTH_RADIUS_KM = 6371

DISCLAIMER = (
    "Hypotheses only. A statistically surprising similarity does not establish "
    "historical contact — independent invention, shared deep ancestry, and "
    "data-sampling artifacts are all alternative explanations. Treat these as "
    "leads for further research, not conclusions."
)

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class NodeFeature:
    """One distinctive trait a culture exhibits, namespaced by ``type``."""

    type: str
    key: str
    label: str


@dataclass(frozen=True)
class CultureNode:
    """A culture carrying a set of features, with locality and grouping."""

    id: str
    name: str
    domain: str
    features: list[NodeFeature]
    coordinates: dict[str, float] | None = None
    region: str | None = None
    #: The "expected similarity" groups — typically associated language ids.
    group_ids: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)


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


def feature_key(feature: NodeFeature) -> str:
    """``type::key`` — the single index key a feature is counted under."""
    return f"{feature.type}::{feature.key}"


def compute_feature_prevalence(nodes: Sequence[CultureNode]) -> dict[str, int]:
    """How many nodes carry each feature.

    A node contributes at most **once** per feature key, so prevalence is a node
    count and not an occurrence count — a tradition listing the same scale twice
    does not make it look commoner than it is.
    """
    prevalence: dict[str, int] = {}
    for node in nodes:
        seen: set[str] = set()
        for feature in node.features:
            key = feature_key(feature)
            if key in seen:
                continue
            seen.add(key)
            prevalence[key] = prevalence.get(key, 0) + 1
    return prevalence


def feature_rarity(prevalence: int, total: int) -> float:
    """``-log2(freq) / log2(total)``, clamped to [0, 1]. Universal features ⇒ 0."""
    if total <= 1 or prevalence <= 0:
        return 0.0
    info = -math.log2(prevalence / total)
    max_info = math.log2(total)
    if max_info <= 0:
        return 0.0
    return min(1.0, max(0.0, info / max_info))


def _regions_match(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    x = a.lower().strip()
    y = b.lower().strip()
    if not x or not y:
        return False
    return x == y or y in x or x in y


def _groups_overlap(a: Sequence[str], b: Sequence[str]) -> bool:
    if not a or not b:
        return False
    known = set(a)
    return any(group in known for group in b)


def separation(
    a: CultureNode,
    b: CultureNode,
    *,
    near_km: float = DEFAULT_NEAR_KM,
    max_km: float = DEFAULT_MAX_KM,
) -> dict[str, Any]:
    """How distant two nodes are: a real distance, else a region/group proxy."""
    if a.coordinates and b.coordinates:
        km = haversine_km(a.coordinates, b.coordinates)
        return {
            "km": js_round(km),
            "factor": max(0.0, min(1.0, km / max_km)),
            "distant": km >= near_km,
            "basis": f"~{locale_int(js_round(km))} km apart",
        }

    same_region = _regions_match(a.region, b.region)
    same_group = _groups_overlap(a.group_ids, b.group_ids)
    distant = not same_region and not same_group
    if distant:
        basis = "different regions and unrelated groups (no coordinates)"
    elif same_region:
        basis = "same region"
    else:
        basis = "related groups"
    return {
        "km": None,
        "factor": 0.6 if distant else 0,
        "distant": distant,
        "basis": basis,
    }


def _shared_features(
    a: CultureNode, b: CultureNode, prevalence: Mapping[str, int], total: int
) -> list[dict[str, Any]]:
    """Non-universal features present in BOTH nodes, rarest first."""
    b_keys = {feature_key(feature) for feature in b.features}

    shared: list[dict[str, Any]] = []
    seen: set[str] = set()
    for feature in a.features:
        key = feature_key(feature)
        if key in seen or key not in b_keys:
            continue
        seen.add(key)
        count = prevalence.get(key, 0)
        # A feature carried by every node carries no surprise — skip it.
        if count >= total:
            continue
        shared.append(
            {
                "type": feature.type,
                "key": feature.key,
                "label": feature.label,
                "prevalence": count,
                "frequency": round_to(count / total if total > 0 else 0, 3),
                "rarity": round_to(feature_rarity(count, total), 3),
            }
        )
    shared.sort(key=lambda entry: (-float(entry["rarity"]), str(entry["key"])))
    return shared


def _merge_provenance(*groups: Iterable[str]) -> list[str]:
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


def _hypothesis(
    a: CultureNode, b: CultureNode, shared: Sequence[Mapping[str, Any]], basis: str
) -> str:
    labels = ", ".join(f'"{entry["label"]}"' for entry in shared[:3])
    more = f" (+{len(shared) - 3} more)" if len(shared) > 3 else ""
    return (
        f"{a.name} and {b.name} both exhibit {labels}{more}, yet are {basis}. "
        "This unexpected shared trait may hint at undocumented contact, deep "
        "shared ancestry, or independent innovation — a lead worth "
        "investigating, not a conclusion."
    )


def pair_anomaly(
    a: CultureNode,
    b: CultureNode,
    prevalence: Mapping[str, int],
    total: int,
    *,
    min_surprise: float = DEFAULT_MIN_SURPRISE,
    near_km: float = DEFAULT_NEAR_KM,
    max_km: float = DEFAULT_MAX_KM,
) -> dict[str, Any] | None:
    """Evaluate one pair, or ``None`` when it is not an anomaly at all."""
    # Sharing a language/lineage group is an EXPECTED similarity.
    if _groups_overlap(a.group_ids, b.group_ids):
        return None

    sep = separation(a, b, near_km=near_km, max_km=max_km)
    if not sep["distant"]:
        return None

    shared = _shared_features(a, b, prevalence, total)
    if not shared:
        return None

    # The rarest shared trait drives the score; corroborating traits add a
    # bounded boost, so ten common traits never outrank one singular one.
    max_rarity = max(float(entry["rarity"]) for entry in shared)
    multi_boost = min(0.15 * (len(shared) - 1), 0.3)
    rarity_score = min(1.0, max_rarity + multi_boost)

    surprise = round_to(rarity_score * float(sep["factor"]), 3)
    if surprise < min_surprise:
        return None

    provenance = _merge_provenance(a.sources, b.sources)
    confidence = round_to(
        max(
            0.0,
            min(
                0.9,
                0.25
                + 0.15 * len(shared)
                + (0.2 if provenance else 0)
                + (0.1 if sep["km"] is not None else 0),
            ),
        ),
        3,
    )

    return {
        "entityA": {"id": a.id, "name": a.name, "domain": a.domain},
        "entityB": {"id": b.id, "name": b.name, "domain": b.domain},
        "sharedFeatures": shared,
        "separation": sep,
        "surpriseScore": surprise,
        "confidence": confidence,
        "hypothesis": _hypothesis(a, b, shared, str(sep["basis"])),
        "speculative": True,
        "provenance": provenance,
    }


def detect_anomalies(
    nodes: Sequence[CultureNode],
    *,
    min_surprise: float = DEFAULT_MIN_SURPRISE,
    limit: int = DEFAULT_LIMIT,
    near_km: float = DEFAULT_NEAR_KM,
    max_km: float = DEFAULT_MAX_KM,
    max_nodes: int = DEFAULT_MAX_NODES,
) -> dict[str, Any]:
    """Scan every comparable pair and return the most surprising anomalies."""
    considered = list(nodes[:max_nodes])
    prevalence = compute_feature_prevalence(considered)
    total = len(considered)

    anomalies: list[dict[str, Any]] = []
    pairs_evaluated = 0
    for i, a in enumerate(considered):
        for b in considered[i + 1 :]:
            pairs_evaluated += 1
            found = pair_anomaly(
                a,
                b,
                prevalence,
                total,
                min_surprise=min_surprise,
                near_km=near_km,
                max_km=max_km,
            )
            if found is not None:
                anomalies.append(found)

    anomalies.sort(
        key=lambda entry: (
            -float(entry["surpriseScore"]),
            -float(entry["confidence"]),
            str(entry["entityA"]["id"]),
            str(entry["entityB"]["id"]),
        )
    )

    return {
        "anomalies": anomalies[:limit],
        "stats": {
            "nodesConsidered": total,
            "pairsEvaluated": pairs_evaluated,
            "featuresIndexed": len(prevalence),
        },
        "disclaimer": DISCLAIMER,
    }


# ── The corpus projection ────────────────────────────────────────────────────


def normalize_key(value: str) -> str:
    """A free-text trait value as a stable, case-insensitive match key."""
    return _NON_ALNUM.sub("-", value.lower().strip()).strip("-")


def trait_features(feature_type: str, values: Iterable[str]) -> list[NodeFeature]:
    """Turn a trait array into deduped, normalized features. Blanks are dropped."""
    features: list[NodeFeature] = []
    seen: set[str] = set()
    for raw in values:
        label = (raw or "").strip()
        if not label:
            continue
        key = normalize_key(label)
        if not key or key in seen:
            continue
        seen.add(key)
        features.append(NodeFeature(type=feature_type, key=key, label=label))
    return features


def load_nodes(lexicons: Path) -> list[CultureNode]:
    """Project the feature-bearing corpus domains into :class:`CultureNode`s.

    The three domains that carry both coordinates and distinctive trait arrays:
    **music-tradition** (scales / rhythms / instruments), **art-tradition**
    (key features + category) and **material-culture** (category). A row with no
    features at all is dropped — it can never be half of an anomaly.

    ``group_ids`` is the associated-language list, so two traditions in the same
    language community are never flagged. Myth motifs and haplogroups are
    supported by the engine above but their corpus projections carry no
    per-culture coordinates, so feeding them richly is a data task, not a code one.
    """
    nodes: list[CultureNode] = []

    for music in corpus.load_music_traditions(lexicons):
        features = [
            *trait_features("music-scale", music.scales),
            *trait_features("music-rhythm", music.rhythmic_patterns),
            *trait_features("music-instrument", music.instruments),
        ]
        if not features:
            continue
        nodes.append(
            CultureNode(
                id=f"music:{music.id}",
                name=music.name,
                domain="music-tradition",
                coordinates=music.coordinates,
                region=music.region or None,
                group_ids=music.associated_language_ids,
                features=features,
                sources=music.sources,
            )
        )

    for art in corpus.load_art_traditions(lexicons):
        features = [
            *trait_features("art-feature", art.key_features),
            *trait_features("art-category", [art.category] if art.category else []),
        ]
        if not features:
            continue
        nodes.append(
            CultureNode(
                id=f"art:{art.id}",
                name=art.name,
                domain="art-tradition",
                coordinates=art.origin_coordinates,
                # An art tradition has no region column; the civilizations it is
                # associated with are the coarse locality signal instead.
                region=art.associated_civilizations or None,
                group_ids=art.associated_languages,
                features=features,
                sources=art.notable_examples,
            )
        )

    for material in corpus.load_material_cultures(lexicons):
        features = trait_features(
            "material-category", [material.category] if material.category else []
        )
        if not features:
            continue
        coordinates = material.origin_coordinates
        nodes.append(
            CultureNode(
                id=f"material:{material.id}",
                name=material.name,
                domain="material-culture",
                # `[lat, lng]` here, `{lat, lng}` in music and art — normalized
                # at exactly this boundary and nowhere else.
                coordinates=(
                    {"lat": coordinates[0], "lng": coordinates[1]}
                    if len(coordinates) == 2
                    else None
                ),
                region=None,
                group_ids=material.associated_languages,
                features=features,
                sources=[],
            )
        )

    return nodes
