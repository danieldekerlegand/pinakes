"""The geographic linker: ``LOCATED_IN`` / ``ORIGINATES_FROM`` / ``ADJACENT_TO``.

Turns the geographic dimension of the canonical schema (``docs/data-model.md``)
into edges so the network is navigable by place. Given the node and edge sets it:

* resolves each node's place identifier (``place_qid`` / ``tgn_id`` /
  ``pleiades_id``) to a **place node**, *reusing* an existing place that already
  carries that identifier or *creating* a minimal one, and links the node to it
  with ``LOCATED_IN`` — or ``ORIGINATES_FROM`` when the node's label marks the
  place as its origin (configurable via *origin_labels*);
* for a node with **only ``lat`` / ``lon``** and no place identifier, attaches it
  to the *nearest* existing place that has coordinates, within a configurable
  ``radius_km``, at a deliberately **lower confidence** so the weaker inference is
  flagged;
* emits ``ADJACENT_TO`` between places that **share a container** — places whose
  ``place_qid`` (their containing place, straight from the source data) is the
  same are treated as neighbours.

Place creation needs more than the :class:`~pinakes_engine.ontology.linker.Linker`
contract returns (which is edges only), so the full result — new place nodes *and*
edges — is exposed through :meth:`GeographicLinker.link_geography`; :meth:`link`
satisfies the pipeline interface by returning just that result's edges.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar, Protocol

from pinakes_engine.ontology.linker import (
    DEFAULT_REGISTRY,
    Edge,
    Linker,
    LinkResult,
    Node,
    inferred_edge,
)
from pinakes_engine.ontology.registry import Dimension
from pinakes_engine.schema.ids import IdError, mint_csid, normalize_qid


class _Emit(Protocol):
    """The callback :meth:`GeographicLinker._emit_adjacency` adds an edge with."""

    def __call__(
        self, start: str, end: str, rel: str, confidence: float
    ) -> None: ...

#: The ``:LABEL`` token a place node carries.
PLACE_LABEL = "Place"

#: Mean Earth radius (km) for the haversine great-circle distance.
_EARTH_RADIUS_KM = 6371.0088

#: Runs of non-slug characters in an external authority id, collapsed to ``-``.
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _scalar(row: Node | Edge, key: str) -> str:
    """Return *row*'s scalar cell for *key*, or ``""`` if missing or multi-value."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _labels(node: Node) -> list[str]:
    """Return *node*'s ``:LABEL`` tokens (tolerating a scalar or missing cell)."""
    value = node.get(":LABEL")
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        return [value]
    return []


def _coords(node: Node) -> tuple[float, float] | None:
    """Return *node*'s ``(lat, lon)`` as floats, or ``None`` if absent/unparsable."""
    lat, lon = _scalar(node, "lat"), _scalar(node, "lon")
    if not lat or not lon:
        return None
    try:
        return float(lat), float(lon)
    except ValueError:
        return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two WGS84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _authority_local(kind: str, value: str) -> str | None:
    """Return the ``csid`` local part for a non-QID authority id, or ``None``."""
    safe = _NON_SLUG_RE.sub("-", value.lower()).strip("-")
    return f"{kind}-{safe}" if safe else None


@dataclass(frozen=True)
class GeoResult:
    """The geographic linker's full output: new place nodes plus inferred edges.

    *places* are the place nodes the linker had to create (reused places are
    already in the input and are not repeated here); *edges* are the
    ``LOCATED_IN`` / ``ORIGINATES_FROM`` / ``ADJACENT_TO`` edges. The edges carry
    ``confidence`` but not ``source`` — when run through the pipeline that tag is
    stamped from the linker name; callers using :meth:`GeographicLinker.link`
    directly get the same untagged edges.
    """

    places: list[Node]
    edges: list[Edge]


class GeographicLinker(Linker):
    """Infers geographic edges, creating place nodes as needed.

    Configuration:

    * *radius_km* — the largest distance a coordinate-only node may be from a
      place to be attached to it;
    * *id_confidence* — confidence for an identifier-based ``LOCATED_IN`` /
      ``ORIGINATES_FROM`` (a place id is a strong signal);
    * *nearest_confidence* — confidence for a coordinate-based attachment (lower,
      flagging the weaker inference);
    * *adjacency_confidence* — confidence for a derived ``ADJACENT_TO``;
    * *origin_labels* — ``:LABEL`` tokens whose place is the node's *origin*
      rather than its location, so those nodes are linked with ``ORIGINATES_FROM``.
    """

    name: ClassVar[str] = "geographic"
    dimension: ClassVar[Dimension] = Dimension.GEOGRAPHIC

    def __init__(
        self,
        *,
        radius_km: float = 50.0,
        id_confidence: float = 0.95,
        nearest_confidence: float = 0.4,
        adjacency_confidence: float = 0.6,
        origin_labels: frozenset[str] = frozenset(),
    ) -> None:
        if radius_km <= 0:
            raise ValueError(f"radius_km must be positive, got {radius_km!r}")
        self.radius_km = radius_km
        self.id_confidence = id_confidence
        self.nearest_confidence = nearest_confidence
        self.adjacency_confidence = adjacency_confidence
        self.origin_labels = origin_labels

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return the inferred edges only (the :class:`Linker` contract)."""
        return self.link_geography(nodes, edges).edges

    def link_full(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinkResult:
        """Return the inferred edges plus the place nodes the linker created."""
        result = self.link_geography(nodes, edges)
        return LinkResult(edges=result.edges, nodes=result.places)

    def link_geography(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> GeoResult:
        """Resolve places and infer geographic edges from *nodes* and *edges*."""
        # Index existing places by the identifier each authority keys them on, so
        # a node referencing that identifier reuses the place instead of cloning.
        by_qid: dict[str, str] = {}
        by_tgn: dict[str, str] = {}
        by_pleiades: dict[str, str] = {}
        coord_places: list[tuple[str, float, float]] = []
        for node in nodes:
            if PLACE_LABEL not in _labels(node):
                continue
            csid = _scalar(node, "csid")
            qid = self._norm_qid(_scalar(node, "wikidata_qid"))
            if qid:
                by_qid[qid] = csid
            if tgn := _scalar(node, "tgn_id"):
                by_tgn[tgn] = csid
            if pleiades := _scalar(node, "pleiades_id"):
                by_pleiades[pleiades] = csid
            if (point := _coords(node)) is not None:
                coord_places.append((csid, point[0], point[1]))

        created: dict[str, Node] = {}
        emitted: set[tuple[str, str, str]] = {
            (_scalar(e, ":START_ID"), _scalar(e, ":END_ID"), _scalar(e, ":TYPE"))
            for e in edges
        }
        result_edges: list[Edge] = []

        def emit(start: str, end: str, rel: str, confidence: float) -> None:
            key = (start, end, rel)
            if start and end and start != end and key not in emitted:
                emitted.add(key)
                result_edges.append(inferred_edge(start, end, rel, confidence))

        for node in nodes:
            source = _scalar(node, "csid")
            if not source:
                continue
            rel = self._relation_for(_labels(node))
            targets = self._resolve_ids(
                node, by_qid, by_tgn, by_pleiades, created
            )
            if targets:
                for target in targets:
                    emit(source, target, rel, self.id_confidence)
                continue
            # Only coordinates: attach to the nearest known place, flagged lower.
            if (point := _coords(node)) is not None:
                nearest = self._nearest(point[0], point[1], source, coord_places)
                if nearest is not None:
                    emit(source, nearest, rel, self.nearest_confidence)

        self._emit_adjacency(nodes, emit)
        return GeoResult(places=list(created.values()), edges=result_edges)

    def _relation_for(self, labels: Sequence[str]) -> str:
        """``ORIGINATES_FROM`` if a label marks origin, else ``LOCATED_IN``."""
        if any(label in self.origin_labels for label in labels):
            return "ORIGINATES_FROM"
        return "LOCATED_IN"

    def _resolve_ids(
        self,
        node: Node,
        by_qid: dict[str, str],
        by_tgn: dict[str, str],
        by_pleiades: dict[str, str],
        created: dict[str, Node],
    ) -> list[str]:
        """Resolve *node*'s place identifiers to distinct place ``csid``s."""
        targets: list[str] = []

        def add(csid: str | None) -> None:
            if csid is not None and csid not in targets:
                targets.append(csid)

        if qid := self._norm_qid(_scalar(node, "place_qid")):
            add(self._reuse_or_create(by_qid, qid, "wikidata_qid", qid, created))
        if tgn := _scalar(node, "tgn_id"):
            csid = self._authority_csid("tgn", tgn)
            add(self._reuse_or_create(by_tgn, tgn, "tgn_id", tgn, created, csid))
        if pleiades := _scalar(node, "pleiades_id"):
            csid = self._authority_csid("pleiades", pleiades)
            add(
                self._reuse_or_create(
                    by_pleiades, pleiades, "pleiades_id", pleiades, created, csid
                )
            )
        return targets

    def _reuse_or_create(
        self,
        index: dict[str, str],
        key: str,
        id_column: str,
        id_value: str,
        created: dict[str, Node],
        csid: str | None = None,
    ) -> str | None:
        """Return the place ``csid`` for *key*, creating the place if unseen.

        *index* maps an identifier value to the ``csid`` of a place already
        carrying it; on a miss a minimal place node is minted (at *csid*, or a
        QID-anchored id when *csid* is ``None``) and recorded so a second node
        with the same identifier reuses it within the run.
        """
        if key in index:
            return index[key]
        if csid is None:
            csid = mint_csid("place", qid=id_value)
        index[key] = csid
        if csid not in created:
            created[csid] = {
                "csid": csid,
                ":LABEL": [PLACE_LABEL],
                "name": id_value,
                id_column: id_value,
                "source": f"inferred:{self.name}",
                "confidence": str(self.id_confidence),
            }
        return csid

    def _authority_csid(self, kind: str, value: str) -> str | None:
        """Deterministic place ``csid`` for a non-QID authority id, or ``None``."""
        local = _authority_local(kind, value)
        return f"cs:place:{local}" if local is not None else None

    def _nearest(
        self,
        lat: float,
        lon: float,
        exclude: str,
        candidates: Sequence[tuple[str, float, float]],
    ) -> str | None:
        """The closest candidate place within ``radius_km``, ties by ``csid``."""
        best: tuple[str, float] | None = None
        for csid, plat, plon in candidates:
            if csid == exclude:
                continue
            dist = _haversine_km(lat, lon, plat, plon)
            if dist > self.radius_km:
                continue
            if best is None or dist < best[1] or (dist == best[1] and csid < best[0]):
                best = (csid, dist)
        return best[0] if best is not None else None

    def _emit_adjacency(self, nodes: Sequence[Node], emit: _Emit) -> None:
        """Emit ``ADJACENT_TO`` between places that share a containing place."""
        siblings: dict[str, list[str]] = {}
        for node in nodes:
            if PLACE_LABEL not in _labels(node):
                continue
            container = self._norm_qid(_scalar(node, "place_qid"))
            csid = _scalar(node, "csid")
            if container and csid:
                siblings.setdefault(container, []).append(csid)
        for members in siblings.values():
            ordered = sorted(set(members))
            for i, left in enumerate(ordered):
                for right in ordered[i + 1 :]:
                    emit(left, right, "ADJACENT_TO", self.adjacency_confidence)

    @staticmethod
    def _norm_qid(value: str) -> str | None:
        """Normalize a QID cell to ``Q<number>``, or ``None`` if not a QID."""
        if not value:
            return None
        try:
            return normalize_qid(value)
        except IdError:
            return None


#: Register a default-config geographic linker into the process-wide registry.
DEFAULT_REGISTRY.register(GeographicLinker())
