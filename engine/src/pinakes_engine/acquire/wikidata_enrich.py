"""Dump-backed enrichment of an already-scraped corpus.

A corpus built from the live SPARQL Query Service carries only what a lightweight
``SELECT`` returns — a label, maybe an image — even though each node already knows
its ``wikidata_qid``. The bulk dump holds the *same* entities with far more depth
(multilingual names, coordinates, inception, derivation). This module closes that
gap **without rescraping**: given the canonical node rows and a local dump, it
looks each node's QID up in the dump, hydrates the configured attributes (reusing
the declarative :mod:`pinakes_engine.acquire.wikidata_hydration` profiles), and
fills the node's *missing* canonical columns and the ephemeral reference fields
the ontology linkers read — so the existing
:func:`~pinakes_engine.ontology.run.run_linkers` pass produces more edges
(``inception`` → temporal, ``coordinate``/``country`` → geographic, ``based on`` →
genetic, multilingual names → ``NAMED_IN`` via
:class:`~pinakes_engine.ontology.named_in.NamedInLinker`).

Enrichment is **provenance-aware and idempotent**:

* a value is written only into a column that is currently *empty*, so an existing
  (higher- or equal-confidence) value is never clobbered;
* every node it touches records, in its ``extra`` overflow cell, that those
  columns came from the dump and *which dump version* (the date in the dump's file
  name) — so a corpus says where its enriched values came from;
* re-running over an already-enriched corpus changes nothing: the columns are
  already filled and the provenance record already lists them.

The dump is a **local** path, streamed once and never fetched. Only the QIDs the
corpus actually carries are kept in memory, so the lookup cost is bounded by the
corpus size, not the dump size.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.wikidata_dump import DumpReadStats, iter_entities
from pinakes_engine.acquire.wikidata_dump_index import dump_version
from pinakes_engine.acquire.wikidata_hydration import (
    HydrationProfile,
    hydrate_entity,
)
from pinakes_engine.schema.ids import IdError, normalize_qid
from pinakes_engine.schema.normalize import (
    normalize_text,
    parse_lat_lon,
    parse_point,
    parse_temporal,
)
from pinakes_engine.schema.tsvio import MULTI_DELIMITER, Row

logger = logging.getLogger(__name__)

#: The ``extra`` overflow column (``pinakes_engine.schema.mapper.OVERFLOW_KEY``);
#: inlined so this acquisition module does not import the mapper (which would pull
#: the schema package back into ``acquire`` mid-initialisation).
OVERFLOW_KEY = "extra"

#: The node field the naming linker reads its attested language codes from
#: (kept in sync with ``pinakes_engine.ontology.named_in.NAMED_IN_FIELD``; not
#: imported to keep ``acquire`` independent of ``ontology``).
NAMED_IN_FIELD = "named_in_langs"

#: ``extra`` overflow key under which the dump provenance note is recorded.
ENRICHED_KEY = "enriched"

#: Canonical *scalar* columns the enrichment may fill from a hydrated value.
#: Mirrors :data:`pinakes_engine.schema.mapper._DIRECT_SCALARS` minus the columns
#: handled explicitly (temporal/geographic) or owned by the corpus
#: (``wikidata_qid``); a hydrated field named here lands in its column verbatim.
_FILL_COLUMNS = frozenset(
    {
        "name",
        "lang",
        "description",
        "period",
        "place_qid",
        "tgn_id",
        "pleiades_id",
        "language_code",
        "script",
        "etymology",
        "getty_id",
        "derived_from_csid",
    }
)

#: Reference fields the ontology linkers read off a node (genetic ancestor /
#: linguistic parent / etymon). They are *not* schema columns, so they ride on the
#: in-memory node only to drive the linkers and are dropped on write. Mirrors
#: :data:`pinakes_engine.schema.mapper._DIMENSION_REFS`.
_REF_FIELDS = frozenset(
    {
        "derived_from_qid",
        "influenced_by_qid",
        "variant_of_qid",
        "parent_qid",
        "parent_code",
        "etymon_qid",
        "derivation_mode",
    }
)


@dataclass
class EnrichmentReport:
    """A tally of what one :func:`enrich_nodes` pass produced.

    Attributes:
        dump_version: The ``YYYYMMDD`` version of the dump, or ``"unknown"``.
        nodes_total: Node rows considered.
        nodes_with_qid: Nodes carrying a well-formed ``wikidata_qid``.
        nodes_found: Nodes whose QID was present in the dump lookup.
        nodes_enriched: Nodes that gained at least one filled column.
        fields_filled: Count of nodes a given canonical column was filled on,
            keyed by column name (sorted on access via :meth:`render`).
    """

    dump_version: str
    nodes_total: int = 0
    nodes_with_qid: int = 0
    nodes_found: int = 0
    nodes_enriched: int = 0
    fields_filled: dict[str, int] = field(default_factory=dict)

    def render(self) -> str:
        """Render a short, human-readable one-block summary."""
        lines = [
            f"enriched {self.nodes_enriched}/{self.nodes_total} node(s) "
            f"from dump v{self.dump_version} "
            f"({self.nodes_found}/{self.nodes_with_qid} QID(s) found in the dump)",
        ]
        if self.fields_filled:
            breakdown = ", ".join(
                f"{column}={count}"
                for column, count in sorted(self.fields_filled.items())
            )
            lines.append(f"  fields filled: {breakdown}")
        return "\n".join(lines)


def build_qid_lookup(
    dump_path: Path | str,
    qids: Iterable[str],
    *,
    stats: DumpReadStats | None = None,
) -> dict[str, dict[str, Any]]:
    """Return a ``QID -> entity`` map for *qids*, scanning the dump once.

    Streams every entity from *dump_path* but keeps only those whose id is in
    *qids*, so memory is bounded by the corpus size rather than the dump size.
    The scan stops early once every wanted QID has been found.

    Args:
        dump_path: Local path to the dump (never fetched).
        qids: The QIDs to collect (already normalised to ``Q<number>``).
        stats: Optional :class:`DumpReadStats` to accumulate the read tally into.
    """
    wanted = set(qids)
    found: dict[str, dict[str, Any]] = {}
    if not wanted:
        return found
    for entity in iter_entities(dump_path, stats=stats):
        eid = entity.get("id")
        if isinstance(eid, str) and eid in wanted and eid not in found:
            found[eid] = entity
            if len(found) == len(wanted):
                break
    return found


def entity_named_languages(
    entity: Mapping[str, Any], languages: Sequence[str]
) -> list[str]:
    """The subset of *languages* the *entity* carries a label or alias in.

    Returned in *languages* order, de-duplicated — the codes a ``NAMED_IN`` edge
    is attested for. A language the entity has no name in is omitted.
    """
    labels = entity.get("labels")
    aliases = entity.get("aliases")
    out: list[str] = []
    for lang in languages:
        if lang in out:
            continue
        has_label = (
            isinstance(labels, Mapping)
            and isinstance(labels.get(lang), Mapping)
            and isinstance(labels[lang].get("value"), str)
        )
        has_alias = isinstance(aliases, Mapping) and bool(aliases.get(lang))
        if has_label or has_alias:
            out.append(lang)
    return out


def enrich_nodes(
    nodes: Sequence[Row],
    lookup: Mapping[str, Mapping[str, Any]],
    *,
    profile: HydrationProfile,
    languages: Sequence[str],
    dump_version: str,
) -> tuple[list[Row], EnrichmentReport]:
    """Fill *nodes*' missing attributes from the dump *lookup*, idempotently.

    For each node carrying a ``wikidata_qid`` present in *lookup*, *profile* is
    applied to the dump entity and the resulting values are written into the
    node's *empty* canonical columns (temporal/geographic resolved exactly as
    :mod:`pinakes_engine.schema.mapper` does), additive multilingual names are
    merged into ``aliases``, the linker reference fields ride onto the node, and
    the attested *languages* are written to ``named_in_langs`` for the
    :class:`~pinakes_engine.ontology.named_in.NamedInLinker`. A per-node provenance
    note (dump version + the columns filled) is recorded in the ``extra`` cell.

    The input rows are never mutated; enriched copies are returned alongside an
    :class:`EnrichmentReport`.
    """
    report = EnrichmentReport(dump_version=dump_version, nodes_total=len(nodes))
    result: list[Row] = []
    for node in nodes:
        enriched = _copy_node(node)
        qid = _norm_qid(_scalar(enriched, "wikidata_qid"))
        if qid is None:
            result.append(enriched)
            continue
        report.nodes_with_qid += 1
        entity = lookup.get(qid)
        if entity is None:
            result.append(enriched)
            continue
        report.nodes_found += 1
        filled = _apply_entity(enriched, entity, profile, languages)
        if filled:
            report.nodes_enriched += 1
            for column in filled:
                report.fields_filled[column] = report.fields_filled.get(column, 0) + 1
            _record_provenance(enriched, dump_version, filled)
        result.append(enriched)
    return result, report


def _apply_entity(
    node: Row,
    entity: Mapping[str, Any],
    profile: HydrationProfile,
    languages: Sequence[str],
) -> set[str]:
    """Write *entity*'s hydrated values into *node*'s empty columns.

    Returns the set of canonical columns this call filled (empty before, set now).
    Aliases are additive; reference fields and ``named_in_langs`` ride on the node
    to drive the linkers but are not counted as filled columns (they do not
    persist to TSV).
    """
    hydrated = hydrate_entity(
        entity,
        profile,
        alias_languages=tuple(languages),
        exclude_alias=_scalar(node, "name") or None,
    )
    filled: set[str] = set()
    consumed: set[str] = set()

    _fill_temporal(node, hydrated, filled, consumed)
    _fill_geographic(node, hydrated, filled, consumed)

    for column in _FILL_COLUMNS:
        if column in hydrated:
            consumed.add(column)  # has a canonical home; never overflow it
            if not _scalar(node, column):
                node[column] = normalize_text(hydrated[column])
                filled.add(column)

    # Reference fields drive the genetic/linguistic linkers; ephemeral, so they
    # are set (without clobbering) but never persisted nor counted as filled.
    for ref in _REF_FIELDS:
        if ref in hydrated:
            consumed.add(ref)
            if not _scalar(node, ref):
                node[ref] = normalize_text(hydrated[ref])

    if "aliases" in hydrated:
        consumed.add("aliases")
        if _merge_aliases(node, hydrated["aliases"]):
            filled.add("aliases")

    named = entity_named_languages(entity, languages)
    if named:
        node[NAMED_IN_FIELD] = named

    _carry_overflow(node, hydrated, consumed)
    return filled


def _fill_temporal(
    node: Row, hydrated: Mapping[str, str], filled: set[str], consumed: set[str]
) -> None:
    """Resolve a hydrated ``time_start_iso`` into the empty ``time_*`` columns."""
    raw = hydrated.get("time_start_iso")
    if not raw:
        return
    consumed.add("time_start_iso")
    span = parse_temporal(raw)
    candidates = {
        "time_start": None if span.time_start is None else str(span.time_start),
        "time_end": None if span.time_end is None else str(span.time_end),
        "time_start_iso": span.time_start_iso,
    }
    for column, value in candidates.items():
        if value is not None and not _scalar(node, column):
            node[column] = value
            filled.add(column)


def _fill_geographic(
    node: Row, hydrated: Mapping[str, str], filled: set[str], consumed: set[str]
) -> None:
    """Resolve hydrated coordinates into the empty ``lat`` / ``lon`` columns."""
    if "coordinates" in hydrated:
        consumed.add("coordinates")
        coord = parse_point(hydrated["coordinates"])
    elif "lat" in hydrated and "lon" in hydrated:
        consumed.update({"lat", "lon"})
        coord = parse_lat_lon(hydrated["lat"], hydrated["lon"])
    else:
        return
    if coord is None or _scalar(node, "lat") or _scalar(node, "lon"):
        return
    node["lat"] = repr(coord.lat)
    node["lon"] = repr(coord.lon)
    filled.update({"lat", "lon"})


def _merge_aliases(node: Row, raw: str) -> bool:
    """Union the dump's ``;``-joined names into *node*'s ``aliases`` list.

    Returns whether the dump contributed any name at all (a stable signal, so the
    provenance note lists ``aliases`` consistently across idempotent re-runs even
    once every name is already present).
    """
    incoming = [
        normalize_text(part) for part in raw.split(MULTI_DELIMITER) if part.strip()
    ]
    if not incoming:
        return False
    existing = node.get("aliases")
    current = list(existing) if isinstance(existing, list) else []
    seen = set(current)
    for name in incoming:
        if name not in seen:
            seen.add(name)
            current.append(name)
    node["aliases"] = current
    return True


def _carry_overflow(
    node: Row, hydrated: Mapping[str, str], consumed: set[str]
) -> None:
    """Stash hydrated values with no canonical home into the ``extra`` overflow.

    A profile may yield an attribute (e.g. ``material``) the schema has no column
    and no linker for; rather than drop it, it is preserved under its own key in
    the ``extra`` JSON cell — mirroring the mapper's overflow so nothing is lost.
    """
    leftover = {
        key: normalize_text(value)
        for key, value in hydrated.items()
        if key not in consumed
    }
    if not leftover:
        return
    data = _load_extra(node)
    for key, value in leftover.items():
        data.setdefault(key, value)
    node[OVERFLOW_KEY] = _dump_extra(data)


def _record_provenance(node: Row, dump_version: str, filled: set[str]) -> None:
    """Record, in *node*'s ``extra`` cell, the dump-sourced columns and version.

    The recorded column list is the *union* of any prior record and the columns
    filled this run, so re-enriching an already-enriched node leaves the note (and
    thus the whole row) byte-identical.
    """
    data = _load_extra(node)
    prior = data.get(ENRICHED_KEY)
    fields: set[str] = set(filled)
    if isinstance(prior, Mapping):
        recorded = prior.get("fields")
        if isinstance(recorded, list):
            fields.update(str(item) for item in recorded)
    data[ENRICHED_KEY] = {"dump": dump_version, "fields": sorted(fields)}
    node[OVERFLOW_KEY] = _dump_extra(data)


def _load_extra(node: Row) -> dict[str, Any]:
    """Parse *node*'s ``extra`` JSON cell into a dict (empty when absent/odd)."""
    raw = node.get(OVERFLOW_KEY)
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _dump_extra(data: Mapping[str, Any]) -> str:
    """Render an ``extra`` dict as stable JSON (the mapper's encoding)."""
    return json.dumps(data, ensure_ascii=False, sort_keys=True)


def _copy_node(node: Row) -> Row:
    """A deep-enough copy of *node*: scalars shared, list cells duplicated."""
    return {
        key: (list(value) if isinstance(value, list) else value)
        for key, value in node.items()
    }


def _scalar(row: Row, key: str) -> str:
    """Return *row*'s scalar cell for *key*, or ``""`` if missing or multi-value."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _norm_qid(value: str) -> str | None:
    """Normalize a ``wikidata_qid`` cell to ``Q<number>``, or ``None`` if absent."""
    if not value:
        return None
    try:
        return normalize_qid(value)
    except IdError:
        return None


def corpus_qids(nodes: Iterable[Row]) -> set[str]:
    """The set of well-formed ``wikidata_qid``s carried by *nodes*."""
    qids: set[str] = set()
    for node in nodes:
        qid = _norm_qid(_scalar(node, "wikidata_qid"))
        if qid is not None:
            qids.add(qid)
    return qids


def resolve_dump_version(dump_path: Path | str) -> str:
    """The ``YYYYMMDD`` version parsed from the dump file name, or ``"unknown"``."""
    return dump_version(Path(dump_path))
