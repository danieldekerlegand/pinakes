"""Insimul ``CanonicalWorldExport`` ingest adapter (insimul-bridge US-003, Bridge 2).

Insimul (``~/Development/workspace`` — hybrid-AI game-world authoring over a
tau-prolog / Trealla symbolic layer) exports a generated world as a single
**``CanonicalWorldExport``** JSON document (``@insimul/core``
``packages/core/schemas/canonical-world-export.schema.json``, US-CE7): a
``contractVersion`` / ``worldId`` / ``seed`` / ``predicateSchemaHash`` envelope
around the world's WorldIR (``ir``) and the combined Prolog knowledge base
(``prologKb``). This adapter reads such a file *from local disk* and emits one
:class:`~pinakes_engine.acquire.records.RawRecord` per canonical node / edge, so
every generated world becomes corpus — with its ground-truth rule set attached
(:func:`world_rule_entries`).

Unlike an export that already ships final csids, the world export ships
**Insimul's own** entity ids, which are MongoDB ObjectIds
unique *within a world only* — never across worlds or projects (the registry's
``projects.insimul.idSpace`` rule). So this adapter mints the csid itself, alias-
anchored and world-scoped: ``cs:<type>:insimul:<worldId>:<entityId>``. The mint is
a pure function of the export's own bytes, so a re-ingest of the same artifact
produces byte-identical rows (**idempotent**: 0 changes) and every edge endpoint
resolves against a node this same run emitted.

Mapping (``contracts/predicate-mapping.json`` ``projects.insimul``, entries 9-15,
landed as canonical schema **v1.3.0**):

===================================  ==========================================
WorldIR                               canonical
===================================  ==========================================
``entities.characters[]``             ``character`` node (entry 9)
``…[].childIds`` / ``.parentIds``     ``PARENT_OF`` edge, (parent, child) (10)
``…[].spouseId``                      ``SPOUSE_OF`` edge, sorted endpoints (11)
``…[].homeResidenceId``               ``RESIDES_IN`` edge (15)
``entities.buildings[]``              ``building`` node (entry 13)
``…[].occupantIds``                   ``RESIDES_IN`` edge (15)
``entities.businesses[]``             ``business`` node (entry 13)
``…[].ownerId`` / ``.founderId``      ``EMPLOYED_BY`` edge (entry 14)
``geography.settlements[]``           ``place`` node (entry 2)
``…[].settlementId``                  ``LOCATED_IN`` edge (entry 7)
``systems.truths[]``                  ``myth-motif`` node (entry 6)
``…[].causedByTruthIds``              ``CAUSED_BY`` edge, (effect, cause) (12)
``systems.rules[]`` + ``baseRules``   rules-registry entries (entry 17)
===================================  ==========================================

Two mappings are worth calling out because they are *deliberate omissions*:

* **A settlement's ``position`` is NOT ``lat``/``lon``.** WorldIR positions are
  world-space metres around a procedural terrain, not WGS-84 — writing them into
  the canonical geographic columns would put a generated town at latitude 412.
  The whole ``position`` rides into the node overflow instead.
* **A truth is not an event node.** The canonical vocabulary has no general event
  type and v1.3 did not coin one, so a truth anchors on ``myth-motif`` — the type
  the registry already pairs Insimul truths with (entry 6) — and ``caused-by``
  stays endpoint-unconstrained in the schema.

Every row lands in the **synthetic trust tier** (see
:mod:`pinakes_engine.orchestrate.tiers`): the adapter stamps the acquisition source
:data:`INSIMUL_SOURCE`, which
:func:`~pinakes_engine.orchestrate.tiers.classify_tier` maps to
:data:`~pinakes_engine.orchestrate.tiers.TIER_SYNTHETIC`, and the per-record SPDX
licence is :data:`INSIMUL_LICENSE` (a proprietary ``LicenseRef``, so
``schema.license_class`` classifies it ``unknown`` — never redistributed). The
hard containment gate
(:func:`~pinakes_engine.orchestrate.tiers.assert_no_synthetic_records`) keeps those
rows out of every packaged / open-data artifact.

Configuration (all under ``source.params`` unless noted):

* ``adapter`` — ``insimul`` (this adapter's id);
* ``path`` — the ``CanonicalWorldExport`` JSON file, when not given as
  ``source.query``;
* ``source`` — the provenance source name (default :data:`INSIMUL_SOURCE`; must
  stay a synthetic source or the tier gate lets generated facts escape);
* ``license`` — an SPDX id overriding :data:`INSIMUL_LICENSE` (rarely wanted: a
  generated world is proprietary by construction).
"""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.confidence import confidence_for
from pinakes_engine.schema.ids import mint_csid

if TYPE_CHECKING:  # pragma: no cover - types only
    from pinakes_engine.datalog.registry import RegistryEntry

#: Provenance ``source`` id stamped on every Insimul-origin row. This is the
#: acquisition-source id the trust-tier classifier keys on to route the row to the
#: synthetic tier (:data:`pinakes_engine.orchestrate.tiers.SYNTHETIC_SOURCES`).
INSIMUL_SOURCE = "insimul"

#: The ``contractVersion`` literal ``@insimul/core`` pins on both bridge artifacts
#: (``canonical-world-export.schema.json`` / ``grounding-pack.schema.json``). An
#: export declaring anything else is rejected rather than parsed on a guess.
CONTRACT_VERSION = "insimul-grounding-v1"

#: The per-record SPDX licence a generated world carries. Bridge-2 output is
#: proprietary (the Insimul bridge spec §7 "License leakage"); the id is unregistered in
#: :mod:`pinakes_engine.schema.license_class`, so it classifies ``unknown`` — the
#: verify-before-redistribute class, which is exactly right here.
INSIMUL_LICENSE = "LicenseRef-Insimul-Proprietary"

#: Confidence stamped on every ingested row. A generated fact is exact *within its
#: closed world* but carries no external anchor on its value, which is the
#: ``inferred`` rubric class (``contracts/confidence-rubric.json``). The corpus's
#: confidence axis measures evidential strength about the real world, and a
#: synthesized fact has none — the trust tier, not the prior, is what marks it.
DEFAULT_CONFIDENCE = confidence_for("inferred")

#: The dialect tier a world's Prolog rules carry (registry entry 17). Insimul runs
#: full ISO Prolog — cuts, negation and ``rule_likelihood/2`` random-chance
#: patterns do NOT cross into pinakes's constrained-Horn Datalog layer, so a
#: world rule is emitted with an empty ``clause_souffle`` and never joins
#: :func:`pinakes_engine.datalog.registry.build_registry`.
WORLD_RULE_DIALECT = "full-prolog"

#: Canonical node types this adapter mints, keyed by the WorldIR collection.
NODE_TYPE_CHARACTER = "character"
NODE_TYPE_BUILDING = "building"
NODE_TYPE_BUSINESS = "business"
NODE_TYPE_PLACE = "place"
NODE_TYPE_TRUTH = "myth-motif"

#: ``:LABEL`` per canonical node type (the canonical-schema label, not the slug).
_LABELS: Mapping[str, str] = {
    NODE_TYPE_CHARACTER: "Character",
    NODE_TYPE_BUILDING: "Building",
    NODE_TYPE_BUSINESS: "Business",
    NODE_TYPE_PLACE: "Place",
    NODE_TYPE_TRUTH: "MythMotif",
}


class InsimulExportError(RuntimeError):
    """Raised when a CanonicalWorldExport is missing, malformed, or off-contract."""


class WorldExport:
    """A parsed, validated ``CanonicalWorldExport`` envelope.

    Only the envelope is validated (``contractVersion`` / ``worldId`` / ``seed`` /
    ``ir``): WorldIR itself is an open, fast-moving document, so every collection
    below is read defensively — a missing or non-list collection yields no records
    rather than an error, which is what lets the adapter survive a WorldIR bump.

    Attributes:
        world_id: The world's id (the provenance scope of every minted csid).
        seed: The generation seed, carried as provenance.
        contract_version: The declared ``contractVersion``.
        exported_at: The export timestamp (used as ``retrieved_at`` when UTC-ISO).
        predicate_schema_hash: Insimul's predicate-schema hash for the export.
        ir: The raw WorldIR mapping.
        prolog_kb: The combined Prolog knowledge base text (may be empty).
    """

    def __init__(self, document: Mapping[str, Any]) -> None:
        contract = _text(document.get("contractVersion"))
        if contract != CONTRACT_VERSION:
            raise InsimulExportError(
                f"expected contractVersion {CONTRACT_VERSION!r}, got {contract!r} "
                "— refusing to parse an off-contract world export"
            )
        world_id = _text(document.get("worldId"))
        if not world_id:
            raise InsimulExportError("world export has no 'worldId'")
        ir = document.get("ir")
        if not isinstance(ir, Mapping):
            raise InsimulExportError("world export has no 'ir' object")

        self.world_id = world_id
        self.seed = _text(document.get("seed"))
        self.contract_version = contract
        self.exported_at = _text(document.get("exportedAt"))
        self.predicate_schema_hash = _text(document.get("predicateSchemaHash"))
        self.ir: Mapping[str, Any] = ir
        self.prolog_kb = _text(document.get("prologKb"))

    def csid(self, node_type: str, entity_id: str) -> str:
        """The world-scoped csid for *entity_id* as a *node_type* node.

        Insimul ids are unique within a world only, so the alias carries the world
        with it: ``cs:character:insimul:<worldId>:<entityId>``. Deterministic — the
        same export always mints the same id (idempotent re-ingest).
        """
        return mint_csid(
            node_type, alias=f"{INSIMUL_SOURCE}:{self.world_id}:{entity_id}"
        )

    def section(self, *path: str) -> Mapping[str, Any]:
        """The nested WorldIR mapping at *path*, or an empty mapping if absent."""
        node: Any = self.ir
        for key in path:
            if not isinstance(node, Mapping):
                return {}
            node = node.get(key)
        return node if isinstance(node, Mapping) else {}

    def collection(self, *path: str) -> list[Mapping[str, Any]]:
        """The WorldIR list at *path*, keeping only its mapping members."""
        node: Any = self.ir
        for key in path[:-1]:
            if not isinstance(node, Mapping):
                return []
            node = node.get(key)
        if not isinstance(node, Mapping):
            return []
        value = node.get(path[-1])
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, Mapping)]


def read_world_export(path: str | Path) -> WorldExport:
    """Read and validate the ``CanonicalWorldExport`` JSON file at *path*."""
    file = Path(path)
    try:
        text = file.read_text(encoding="utf-8")
    except OSError as exc:
        raise InsimulExportError(f"cannot read world export {file}: {exc}") from exc
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InsimulExportError(f"{file} is not valid JSON: {exc}") from exc
    if not isinstance(document, Mapping):
        raise InsimulExportError(f"{file} is not a JSON object")
    return WorldExport(document)


class InsimulWorldAdapter(SourceAdapter):
    """Read a local Insimul ``CanonicalWorldExport`` and yield one record per row.

    Nodes are emitted first (characters, buildings, businesses, settlements,
    truths), then edges grouped by ``:TYPE`` — each group sorted by endpoint, so
    the record stream is a pure function of the export's content.
    """

    name = "insimul"
    source_type = "dump"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per canonical row of the configured world."""
        params = category_spec.source.params
        raw_path = (category_spec.source.query or params.get("path") or "").strip()
        if not raw_path:
            raise InsimulExportError(
                f"category {category_spec.id!r} has no world-export path "
                "(source.query or source.params.path) to read"
            )
        export = read_world_export(raw_path)
        source_name = params.get("source") or INSIMUL_SOURCE
        license_ = params.get("license") or INSIMUL_LICENSE
        return iter(world_records(export, source=source_name, license=license_))


# --- record construction ----------------------------------------------------


def world_records(
    export: WorldExport,
    *,
    source: str = INSIMUL_SOURCE,
    license: str = INSIMUL_LICENSE,
) -> list[RawRecord]:
    """Every canonical node + edge record for *export*, in deterministic order.

    Pure: the returned list is a function of the export's bytes alone (no clock,
    no filesystem), which is what makes a re-ingest byte-identical.
    """
    provenance = _provenance(export, source=source, license=license)
    nodes = [
        *_character_nodes(export),
        *_building_nodes(export),
        *_business_nodes(export),
        *_settlement_nodes(export),
        *_truth_nodes(export),
    ]
    edges = world_edges(export)
    return [
        RawRecord(fields=fields, provenance=provenance)
        for fields in [*nodes, *edges]
    ]


def world_edges(export: WorldExport) -> list[dict[str, str]]:
    """Every canonical edge field-map for *export*, grouped by ``:TYPE``, sorted.

    Each group is deduplicated on ``(:START_ID, :END_ID)`` — Insimul stores both
    sides of a relationship (``childIds`` *and* ``parentIds``; a building's
    ``occupantIds`` *and* a character's ``homeResidenceId``), and the canonical
    graph holds one edge per fact, not one per stored direction.
    """
    groups = (
        ("PARENT_OF", _parent_of_pairs(export)),
        ("SPOUSE_OF", _spouse_of_pairs(export)),
        ("EMPLOYED_BY", _employed_by_pairs(export)),
        ("RESIDES_IN", _resides_in_pairs(export)),
        ("LOCATED_IN", _located_in_pairs(export)),
        ("CAUSED_BY", _caused_by_pairs(export)),
    )
    edges: list[dict[str, str]] = []
    for edge_type, pairs in groups:
        for start, end in sorted(set(pairs)):
            edges.append({":START_ID": start, ":END_ID": end, ":TYPE": edge_type})
    return edges


def _provenance(
    export: WorldExport, *, source: str, license: str
) -> Provenance:
    """The provenance every row of *export* carries (world id + seed + contract).

    ``source_url`` is the world URI and ``source_query`` carries the generation
    seed, the contract version and Insimul's predicate-schema hash — the three
    facts the Insimul bridge spec §7 "Identity" requires on a Bridge-2 record so a row
    can always be traced back to the exact artifact that produced it.
    """
    parts = [
        f"seed={export.seed}",
        f"contractVersion={export.contract_version}",
    ]
    if export.predicate_schema_hash:
        parts.append(f"predicateSchemaHash={export.predicate_schema_hash}")
    return Provenance(
        source=source,
        source_url=f"insimul:world:{export.world_id}",
        source_query=";".join(parts),
        retrieved_at=_retrieved_at(export),
        confidence=DEFAULT_CONFIDENCE,
        license=license,
    )


def _retrieved_at(export: WorldExport) -> str:
    """The export's own ``exportedAt`` when it is a UTC ISO-8601 stamp.

    A world export is an artifact, not a live fetch, so its retrieval time IS the
    time it was exported — which keeps a re-ingest byte-identical (no clock reads
    the wall). An export with a missing or non-UTC stamp is rejected rather than
    silently stamped with "now", because that would make re-ingest non-idempotent.
    """
    stamp = export.exported_at
    if not stamp:
        raise InsimulExportError(
            f"world {export.world_id} has no 'exportedAt' timestamp; a Bridge-2 "
            "ingest takes its retrieved_at from the artifact so re-ingest stays "
            "byte-identical"
        )
    try:
        Provenance(
            source="", source_url="", source_query="",
            retrieved_at=stamp, confidence=0.0,
        )
    except ValueError as exc:
        raise InsimulExportError(
            f"world {export.world_id} 'exportedAt' {stamp!r} is not a UTC "
            f"ISO-8601 timestamp: {exc}"
        ) from exc
    return stamp


# --- nodes ------------------------------------------------------------------


def _character_nodes(export: WorldExport) -> list[dict[str, str]]:
    """One ``character`` node per WorldIR character (registry entry 9)."""
    rows: list[dict[str, str]] = []
    for character in export.collection("entities", "characters"):
        entity_id = _text(character.get("id"))
        if not entity_id:
            continue
        row = {
            "csid": export.csid(NODE_TYPE_CHARACTER, entity_id),
            ":LABEL": _LABELS[NODE_TYPE_CHARACTER],
            "name": _character_name(character),
        }
        # birth_year is the one WorldIR field with a canonical temporal home; a
        # person is a point-in-time entity for the corpus's purposes, so the birth
        # year opens the span and nothing closes it.
        birth = _int_text(character.get("birthYear"))
        if birth:
            row["time_start"] = birth
        _carry_overflow(
            row,
            character,
            keys=(
                "gender",
                "isAlive",
                "occupation",
                "status",
                "firstName",
                "middleName",
                "lastName",
                "suffix",
                "currentLocation",
            ),
        )
        rows.append(row)
    return rows


def _building_nodes(export: WorldExport) -> list[dict[str, str]]:
    """One ``building`` node per WorldIR building (registry entry 13).

    A building's name comes from its lot address when the world laid streets out,
    else from its spec type — WorldIR buildings carry no ``name`` field of their
    own, and a nameless node is unusable downstream.
    """
    addresses = _lot_addresses(export)
    rows: list[dict[str, str]] = []
    for building in export.collection("entities", "buildings"):
        entity_id = _text(building.get("id"))
        if not entity_id:
            continue
        lot_id = _text(building.get("lotId"))
        spec = building.get("spec")
        building_type = (
            _text(spec.get("buildingType")) if isinstance(spec, Mapping) else ""
        )
        name = addresses.get(lot_id) or building_type or entity_id
        row = {
            "csid": export.csid(NODE_TYPE_BUILDING, entity_id),
            ":LABEL": _LABELS[NODE_TYPE_BUILDING],
            "name": name,
        }
        if building_type:
            row["description"] = building_type
        _carry_overflow(row, building, keys=("lotId", "settlementId", "businessId"))
        rows.append(row)
    return rows


def _business_nodes(export: WorldExport) -> list[dict[str, str]]:
    """One ``business`` node per WorldIR business (registry entry 13)."""
    rows: list[dict[str, str]] = []
    for business in export.collection("entities", "businesses"):
        entity_id = _text(business.get("id"))
        if not entity_id:
            continue
        row = {
            "csid": export.csid(NODE_TYPE_BUSINESS, entity_id),
            ":LABEL": _LABELS[NODE_TYPE_BUSINESS],
            "name": _text(business.get("name")) or entity_id,
        }
        business_type = _text(business.get("businessType"))
        if business_type:
            row["description"] = business_type
        founded = _int_text(business.get("foundedYear"))
        if founded:
            row["time_start"] = founded
        _carry_overflow(
            row, business, keys=("businessType", "isOutOfBusiness", "settlementId")
        )
        rows.append(row)
    return rows


def _settlement_nodes(export: WorldExport) -> list[dict[str, str]]:
    """One ``place`` node per WorldIR settlement (registry entry 2).

    The settlement's ``position`` is world-space metres, NOT WGS-84, so it is
    deliberately kept out of the canonical ``lat``/``lon`` columns and rides into
    the overflow with the rest of the procedural geometry.
    """
    rows: list[dict[str, str]] = []
    for settlement in export.collection("geography", "settlements"):
        entity_id = _text(settlement.get("id"))
        if not entity_id:
            continue
        row = {
            "csid": export.csid(NODE_TYPE_PLACE, entity_id),
            ":LABEL": _LABELS[NODE_TYPE_PLACE],
            "name": _text(settlement.get("name")) or entity_id,
        }
        description = _text(settlement.get("description"))
        if description:
            row["description"] = description
        founded = _int_text(settlement.get("foundedYear"))
        if founded:
            row["time_start"] = founded
        _carry_overflow(
            row,
            settlement,
            keys=("settlementType", "terrain", "population", "countryId", "stateId"),
        )
        rows.append(row)
    return rows


def _truth_nodes(export: WorldExport) -> list[dict[str, str]]:
    """One ``myth-motif`` node per WorldIR truth that participates in causality.

    Only truths are emitted, never the ``narratives`` / backstory templates they
    were generated from. See the module docstring for why a truth anchors on
    ``myth-motif`` rather than a coined event type.
    """
    rows: list[dict[str, str]] = []
    for truth in export.collection("systems", "truths"):
        entity_id = _text(truth.get("id"))
        if not entity_id:
            continue
        row = {
            "csid": export.csid(NODE_TYPE_TRUTH, entity_id),
            ":LABEL": _LABELS[NODE_TYPE_TRUTH],
            "name": _text(truth.get("title")) or entity_id,
        }
        content = _text(truth.get("content"))
        if content:
            row["description"] = content
        # A truth is a point event: `truth_year` becomes both canonical endpoints
        # (registry entry 16's temporalFields map).
        year = _int_text(truth.get("timeYear"))
        if year:
            row["time_start"] = year
            row["time_end"] = year
        _carry_overflow(
            row,
            truth,
            keys=("entryType", "timestep", "importance", "isPublic", "characterId"),
        )
        rows.append(row)
    return rows


def _lot_addresses(export: WorldExport) -> dict[str, str]:
    """``lotId`` → street address, read off every settlement's ``lots``."""
    addresses: dict[str, str] = {}
    for settlement in export.collection("geography", "settlements"):
        lots = settlement.get("lots")
        if not isinstance(lots, list):
            continue
        for lot in lots:
            if not isinstance(lot, Mapping):
                continue
            lot_id = _text(lot.get("id"))
            address = _text(lot.get("address"))
            if lot_id and address:
                addresses[lot_id] = address
    return addresses


# --- edges ------------------------------------------------------------------


def _parent_of_pairs(export: WorldExport) -> list[tuple[str, str]]:
    """``(parent, child)`` csid pairs — canonical order, both stored sides read."""
    characters = _character_ids(export)
    pairs: list[tuple[str, str]] = []
    for character in export.collection("entities", "characters"):
        entity_id = _text(character.get("id"))
        if entity_id not in characters:
            continue
        for child_id in _id_list(character.get("childIds")):
            if child_id in characters:
                pairs.append(
                    (
                        export.csid(NODE_TYPE_CHARACTER, entity_id),
                        export.csid(NODE_TYPE_CHARACTER, child_id),
                    )
                )
        # `child_of/2` is the same relation with the arguments swapped (KGP §3.2
        # rule 1) — never a second edge type.
        for parent_id in _id_list(character.get("parentIds")):
            if parent_id in characters:
                pairs.append(
                    (
                        export.csid(NODE_TYPE_CHARACTER, parent_id),
                        export.csid(NODE_TYPE_CHARACTER, entity_id),
                    )
                )
    return pairs


def _spouse_of_pairs(export: WorldExport) -> list[tuple[str, str]]:
    """``SPOUSE_OF`` pairs with **sorted** endpoints.

    ``soc:spouse_of`` is symmetric (KGP §3.2 rule 2), so the two directions
    Insimul stores (each spouse names the other) collapse to one edge.
    """
    characters = _character_ids(export)
    pairs: list[tuple[str, str]] = []
    for character in export.collection("entities", "characters"):
        entity_id = _text(character.get("id"))
        spouse_id = _text(character.get("spouseId"))
        if entity_id not in characters or spouse_id not in characters:
            continue
        endpoints = sorted(
            (
                export.csid(NODE_TYPE_CHARACTER, entity_id),
                export.csid(NODE_TYPE_CHARACTER, spouse_id),
            )
        )
        pairs.append((endpoints[0], endpoints[1]))
    return pairs


def _employed_by_pairs(export: WorldExport) -> list[tuple[str, str]]:
    """``(character, business)`` pairs from ``ownerId`` / ``founderId``.

    ``occupation/2`` is a job title (carried as a character node property), not an
    employer — only owner/founder carry an employer id today (registry entry 14).
    """
    characters = _character_ids(export)
    pairs: list[tuple[str, str]] = []
    for business in export.collection("entities", "businesses"):
        business_id = _text(business.get("id"))
        if not business_id:
            continue
        for key in ("ownerId", "founderId"):
            person_id = _text(business.get(key))
            if person_id in characters:
                pairs.append(
                    (
                        export.csid(NODE_TYPE_CHARACTER, person_id),
                        export.csid(NODE_TYPE_BUSINESS, business_id),
                    )
                )
    return pairs


def _resides_in_pairs(export: WorldExport) -> list[tuple[str, str]]:
    """``(character, building)`` pairs — both stored sides of occupancy."""
    characters = _character_ids(export)
    buildings = _entity_ids(export, "entities", "buildings")
    pairs: list[tuple[str, str]] = []
    for character in export.collection("entities", "characters"):
        entity_id = _text(character.get("id"))
        home_id = _text(character.get("homeResidenceId"))
        if entity_id in characters and home_id in buildings:
            pairs.append(
                (
                    export.csid(NODE_TYPE_CHARACTER, entity_id),
                    export.csid(NODE_TYPE_BUILDING, home_id),
                )
            )
    for building in export.collection("entities", "buildings"):
        building_id = _text(building.get("id"))
        if building_id not in buildings:
            continue
        for occupant_id in _id_list(building.get("occupantIds")):
            if occupant_id in characters:
                pairs.append(
                    (
                        export.csid(NODE_TYPE_CHARACTER, occupant_id),
                        export.csid(NODE_TYPE_BUILDING, building_id),
                    )
                )
    return pairs


def _located_in_pairs(export: WorldExport) -> list[tuple[str, str]]:
    """``(building|business, place)`` pairs — positional containment (entry 7)."""
    settlements = _entity_ids(export, "geography", "settlements")
    pairs: list[tuple[str, str]] = []
    for node_type, path in (
        (NODE_TYPE_BUILDING, ("entities", "buildings")),
        (NODE_TYPE_BUSINESS, ("entities", "businesses")),
    ):
        for entity in export.collection(*path):
            entity_id = _text(entity.get("id"))
            settlement_id = _text(entity.get("settlementId"))
            if entity_id and settlement_id in settlements:
                pairs.append(
                    (
                        export.csid(node_type, entity_id),
                        export.csid(NODE_TYPE_PLACE, settlement_id),
                    )
                )
    return pairs


def _caused_by_pairs(export: WorldExport) -> list[tuple[str, str]]:
    """``(effect, cause)`` truth pairs — the world's complete causal chain.

    Read from ``causedByTruthIds`` (this truth's causes) and ``causesTruthIds``
    (this truth's effects), both normalized to canonical (effect, cause) order.
    Insimul does not ship these fields on ``TruthIR`` yet — they are declared by
    the Insimul bridge spec Appendix A row 10 and read forward-compatibly here, so an
    export without them simply yields no causality edges.
    """
    truths = _entity_ids(export, "systems", "truths")
    pairs: list[tuple[str, str]] = []
    for truth in export.collection("systems", "truths"):
        entity_id = _text(truth.get("id"))
        if entity_id not in truths:
            continue
        for cause_id in _id_list(truth.get("causedByTruthIds")):
            if cause_id in truths:
                pairs.append(
                    (
                        export.csid(NODE_TYPE_TRUTH, entity_id),
                        export.csid(NODE_TYPE_TRUTH, cause_id),
                    )
                )
        for effect_id in _id_list(truth.get("causesTruthIds")):
            if effect_id in truths:
                pairs.append(
                    (
                        export.csid(NODE_TYPE_TRUTH, effect_id),
                        export.csid(NODE_TYPE_TRUTH, entity_id),
                    )
                )
    return pairs


# --- world rules ------------------------------------------------------------


def world_rule_entries(export: WorldExport) -> tuple[RegistryEntry, ...]:
    """The world's Prolog rules as provenanced rules-registry entries (entry 17).

    Every rule is **world-scoped** (``rule_id = insimul:<worldId>:<ruleId>``,
    ``source_url = insimul:world:<worldId>``) and **full-prolog**: the clause text
    lands in ``clause_prolog`` and ``clause_souffle`` is left empty, because cuts,
    negation and ``rule_likelihood/2`` random-chance patterns do not cross into
    pinakes's constrained-Horn layer. These entries are deliberately NOT part of
    :func:`pinakes_engine.datalog.registry.build_registry` — the committed registry
    is a generated artifact over code-resident rule sources, whereas a world's
    rules arrive as data, one set per ingested artifact. Write them beside the
    corpus with :func:`pinakes_engine.datalog.registry.write_registry`.

    An inactive rule (``isActive: false``) is recorded with status ``retired`` so
    the world's full rule corpus stays visible without being taken as live.
    """
    # Deferred import: ``datalog`` reaches ``schema`` → ``acquire``, so importing
    # the registry at module scope would close an import cycle (the same reason
    # ``schema.mapper`` defers its ontology-registry import).
    from pinakes_engine.datalog.registry import (
        LAYER_INSIMUL_WORLD,
        RegistryEntry,
        RuleStatus,
    )

    entries: list[RegistryEntry] = []
    seen: set[str] = set()
    for rule in [
        *export.collection("systems", "rules"),
        *export.collection("systems", "baseRules"),
    ]:
        rule_id = _text(rule.get("id"))
        content = _text(rule.get("content"))
        if not rule_id or not content:
            continue
        scoped = f"{INSIMUL_SOURCE}:{export.world_id}:{rule_id}"
        if scoped in seen:
            continue
        seen.add(scoped)
        status = (
            RuleStatus.ACTIVE.value
            if rule.get("isActive") is not False
            else RuleStatus.RETIRED.value
        )
        entries.append(
            RegistryEntry(
                rule_id=scoped,
                layer=LAYER_INSIMUL_WORLD,
                head=_text(rule.get("name")) or rule_id,
                clause_prolog=" ".join(content.split()),
                clause_souffle="",
                depends="",
                source=INSIMUL_SOURCE,
                source_url=f"insimul:world:{export.world_id}",
                retrieved_at=export.exported_at,
                confidence=DEFAULT_CONFIDENCE,
                version=export.contract_version,
                status=status,
            )
        )
    return tuple(sorted(entries, key=lambda e: e.rule_id))


# --- helpers ----------------------------------------------------------------


def _character_ids(export: WorldExport) -> set[str]:
    return _entity_ids(export, "entities", "characters")


def _entity_ids(export: WorldExport, *path: str) -> set[str]:
    """The non-blank ``id`` of every member of the WorldIR collection at *path*."""
    return {
        entity_id
        for entity in export.collection(*path)
        if (entity_id := _text(entity.get("id")))
    }


def _character_name(character: Mapping[str, Any]) -> str:
    """A character's display name from its name parts, blanks dropped."""
    parts = [
        _text(character.get(key))
        for key in ("firstName", "middleName", "lastName", "suffix")
    ]
    return " ".join(part for part in parts if part) or _text(character.get("id"))


def _carry_overflow(
    row: dict[str, str], entity: Mapping[str, Any], *, keys: Sequence[str]
) -> None:
    """Copy each present *keys* cell of *entity* onto *row* as a raw string.

    These are non-canonical WorldIR properties (a character's gender / occupation,
    a settlement's population / terrain), so the mapper routes them into the node
    ``extra`` overflow — never dropped, never coerced into a canonical column.
    """
    for key in keys:
        value = _scalar_text(entity.get(key))
        if value:
            row[key] = value


def _id_list(value: Any) -> list[str]:
    """The non-blank string members of *value* when it is a list, else ``[]``."""
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := _text(item))]


def _text(value: Any) -> str:
    """*value* as a stripped string; ``None`` / non-scalars become ``""``."""
    if value is None or isinstance(value, (list, dict)):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip()


def _scalar_text(value: Any) -> str:
    """:func:`_text`, but a nested object/list is skipped rather than stringified."""
    if isinstance(value, (list, dict)):
        return ""
    return _text(value)


def _int_text(value: Any) -> str:
    """*value* as an integer string, or ``""`` when it is not a whole number."""
    if isinstance(value, bool) or value is None:
        return ""
    try:
        return str(int(value))
    except (TypeError, ValueError):
        return ""
