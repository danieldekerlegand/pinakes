"""Declarative rich-entity hydration for the Wikidata dump adapter.

The :class:`~pinakes_engine.acquire.wikidata_dump_adapter.WikidataDumpAdapter`
selects entities by class membership and, on its own, carries only the cheap
fields a lightweight SPARQL ``SELECT`` returns — the item URI, its QID, and a
label. The bulk dump, however, ships *every* statement an entity has, so a
dump-sourced node can be far richer than a SPARQL one at no extra request cost.

This module turns that depth into canonical fields **declaratively**. A
:class:`HydrationProfile` is an ordered list of :class:`PropertyMapping` rows,
each naming a Wikidata property (or one of its qualifiers or references), the
canonical source field it feeds, and how to read the statement's value. A mapping
keeps the single best-rank value by default, or opts in (``multi=True``) to
aggregate *every* value — multiple statements, every qualifier snak, or the
citations behind a statement — into the ``;`` multi-value encoding, so the
pipeline stops silently collapsing an entity's knowledge to one value per field.
:func:`hydrate_entity`
applies a profile to one parsed dump entity and returns a flat
``{field: value}`` dict in exactly the vocabulary
:mod:`pinakes_engine.schema.normalize` and
:func:`pinakes_engine.schema.mapper.map_record` already understand — ``inception``
becomes ``time_start_iso`` years, ``coordinate location`` becomes ``lat``/``lon``,
``country of origin`` becomes ``place_qid``, ``based on`` becomes the genetic
linker's ``derived_from_qid``, and so on. Adding an attribute is therefore a
*config* change (one more :class:`PropertyMapping`), never a code change.

Because the output is plain canonical fields, the richer values flow through the
unchanged mapper into the schema's dimension columns, and from there the existing
temporal / geographic / linguistic / genetic linkers turn them into more edges.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Any

from pinakes_engine.schema.tsvio import MULTI_DELIMITER


class ValueKind(Enum):
    """How to read a Wikidata snak's value into a flat string.

    Each kind knows the ``datavalue`` shape it expects; a snak whose value does
    not match (or that is ``novalue`` / ``somevalue``) yields nothing.
    """

    #: ``wikibase-entityid`` → the target QID (``"Q42"``).
    ENTITY = "entity"
    #: ``time`` → an ISO-ish ``YYYY[-MM[-DD]]`` string (BCE keeps its ``-``).
    TIME = "time"
    #: ``globecoordinate`` → ``"<lat>, <lon>"`` for :func:`parse_point`.
    COORDINATE = "coordinate"
    #: ``monolingualtext`` → its ``text``.
    MONOLINGUAL = "monolingual"
    #: ``string`` / external-id / commons-media → the raw string value.
    STRING = "string"
    #: ``quantity`` → its ``amount`` with a leading ``+`` stripped.
    QUANTITY = "quantity"


@dataclass(frozen=True)
class PropertyMapping:
    """One declarative rule: a Wikidata property → a canonical source field.

    Attributes:
        prop: The statement property to read (e.g. ``"P571"`` for *inception*).
        field: The canonical source-field name the value is written under (e.g.
            ``"time_start_iso"``); it must be a name the normalizer/mapper or an
            ontology linker recognises.
        kind: How to interpret the snak's value (see :class:`ValueKind`).
        qualifier: When set, read this *qualifier* property off each statement
            instead of the statement's main value — so a qualifier (e.g. a date
            on a ``location`` statement) can feed a field too.
        reference: When set, read this snak property off each statement's
            *references* (its citations) instead of the main value — so a
            statement's supporting source (e.g. ``P854`` *reference URL*) can be
            lifted into a field. Takes precedence over ``qualifier``.
        multi: Opt in to **multi-value** extraction. By default a mapping keeps
            only the single best-rank value (preferred beats normal, first
            statement wins) — the historical behaviour. With ``multi`` set, every
            value the mapping's snaks yield across *all* ranked statements is
            collected (deduplicated, best-rank first) and joined with
            :data:`~pinakes_engine.schema.tsvio.MULTI_DELIMITER`; combined with
            ``qualifier``/``reference`` it reads *every* qualifier/reference snak
            per statement, not just the first.
    """

    prop: str
    field: str
    kind: ValueKind
    qualifier: str | None = None
    reference: str | None = None
    multi: bool = False


@dataclass(frozen=True)
class HydrationProfile:
    """A named, ordered set of :class:`PropertyMapping` rules.

    A profile is the unit a category selects via ``source.params['hydrate']``;
    *shared* cross-domain attributes live in :data:`DEFAULT_PROFILE` and a
    domain that needs different mappings (a language's parent chain, say) names
    its own profile in :data:`PROFILES`.
    """

    name: str
    mappings: tuple[PropertyMapping, ...]


# --- value extraction ---------------------------------------------------------

#: Statement ranks, best first; ``deprecated`` statements are dropped entirely.
_RANK_ORDER = {"preferred": 0, "normal": 1}


def _clean_time(raw: str) -> str | None:
    """Reduce a Wikidata time literal to ``YYYY[-MM[-DD]]`` (BCE keeps its sign).

    Wikidata stores times as ``+1879-03-14T00:00:00Z`` with a separate precision;
    a month or day the precision does not reach is written ``00``. This trims the
    time component and drops any ``00`` month/day so the result reads cleanly as a
    year (``"1879"``), year-month, or full date — the forms
    :func:`~pinakes_engine.schema.normalize.parse_temporal` understands.
    """
    text = raw.strip()
    if not text:
        return None
    sign = ""
    if text[0] in "+-":
        sign, text = ("-" if text[0] == "-" else ""), text[1:]
    date = text.split("T", 1)[0]
    parts = date.split("-")
    if not parts or not parts[0]:
        return None
    year = parts[0].lstrip("0") or "0"
    month = parts[1] if len(parts) > 1 else "00"
    day = parts[2] if len(parts) > 2 else "00"
    if month == "00":
        return f"{sign}{year}"
    if day == "00":
        return f"{sign}{year}-{month}"
    return f"{sign}{year}-{month}-{day}"


def _value(snak: Mapping[str, Any], kind: ValueKind) -> str | None:
    """Read one *snak*'s value as a flat string per *kind*, or ``None``.

    Only ``value`` snaks carry data; ``novalue`` / ``somevalue`` and a value
    whose ``datavalue`` shape does not match *kind* return ``None`` so a
    mismatched statement is simply skipped.
    """
    if not isinstance(snak, Mapping) or snak.get("snaktype") != "value":
        return None
    datavalue = snak.get("datavalue")
    if not isinstance(datavalue, Mapping):
        return None
    value = datavalue.get("value")
    if kind is ValueKind.ENTITY:
        if isinstance(value, Mapping):
            qid = value.get("id")
            if isinstance(qid, str):
                return qid
        return None
    if kind is ValueKind.TIME:
        if isinstance(value, Mapping):
            time = value.get("time")
            if isinstance(time, str):
                return _clean_time(time)
        return None
    if kind is ValueKind.COORDINATE:
        if isinstance(value, Mapping):
            lat, lon = value.get("latitude"), value.get("longitude")
            if isinstance(lat, int | float) and isinstance(lon, int | float):
                return f"{lat}, {lon}"
        return None
    if kind is ValueKind.MONOLINGUAL:
        if isinstance(value, Mapping):
            text = value.get("text")
            if isinstance(text, str):
                return text
        return None
    if kind is ValueKind.QUANTITY:
        if isinstance(value, Mapping):
            amount = value.get("amount")
            if isinstance(amount, str):
                return amount.lstrip("+")
        return None
    # ValueKind.STRING and its external-id / commons-media cousins.
    return value if isinstance(value, str) else None


def _ranked_statements(statements: Any) -> list[Mapping[str, Any]]:
    """Return *statements* best-rank first, dropping deprecated ones."""
    if not isinstance(statements, list):
        return []
    kept = [
        st
        for st in statements
        if isinstance(st, Mapping) and st.get("rank") != "deprecated"
    ]
    return sorted(kept, key=lambda st: _RANK_ORDER.get(st.get("rank", "normal"), 1))


def _snaks_for(
    statement: Mapping[str, Any], mapping: PropertyMapping
) -> list[Mapping[str, Any]]:
    """The snaks a *mapping* reads off one *statement*, in document order.

    For a plain mapping that is the single ``mainsnak``; a ``reference`` mapping
    gathers the named snak across *every* reference on the statement, and a
    ``qualifier`` mapping gathers the named qualifier's snaks. A non-``multi``
    mapping only ever consumes the first of these (see :func:`_values`), so the
    legacy single-value read is preserved; ``multi`` reads them all.
    """
    if mapping.reference is not None:
        out: list[Mapping[str, Any]] = []
        references = statement.get("references")
        if isinstance(references, list):
            for reference in references:
                if not isinstance(reference, Mapping):
                    continue
                snaks = reference.get("snaks")
                if isinstance(snaks, Mapping):
                    out.extend(
                        snak
                        for snak in snaks.get(mapping.reference, []) or []
                        if isinstance(snak, Mapping)
                    )
        return out
    if mapping.qualifier is not None:
        qualifiers = statement.get("qualifiers")
        if isinstance(qualifiers, Mapping):
            snaks = qualifiers.get(mapping.qualifier)
            if isinstance(snaks, list):
                return [snak for snak in snaks if isinstance(snak, Mapping)]
        return []
    mainsnak = statement.get("mainsnak")
    return [mainsnak] if isinstance(mainsnak, Mapping) else []


def _values(entity: Mapping[str, Any], mapping: PropertyMapping) -> list[str]:
    """Every value *mapping* extracts from *entity*, best-rank first, deduped.

    A non-``multi`` mapping short-circuits at the first value (so the returned
    list has at most one element — the historical single best-rank value); a
    ``multi`` mapping keeps every distinct value across all ranked statements and
    all of a statement's qualifier/reference snaks.
    """
    claims = entity.get("claims")
    statements = claims.get(mapping.prop) if isinstance(claims, Mapping) else None
    out: list[str] = []
    for statement in _ranked_statements(statements):
        snaks = _snaks_for(statement, mapping)
        if not mapping.multi:
            snaks = snaks[:1]
        for snak in snaks:
            value = _value(snak, mapping.kind)
            if value and value not in out:
                out.append(value)
                if not mapping.multi:
                    return out
    return out


def _aliases(
    entity: Mapping[str, Any],
    languages: Sequence[str],
    *,
    exclude: str | None,
) -> list[str]:
    """Collect alternative names for *languages* (multilingual labels + aliases).

    Gathers each language's label and every registered alias, in *languages*
    order, de-duplicated and with *exclude* (the primary display name already on
    the record) removed so it is not repeated as its own alias.
    """
    out: list[str] = []
    labels = entity.get("labels")
    alias_map = entity.get("aliases")
    for lang in languages:
        if isinstance(labels, Mapping):
            entry = labels.get(lang)
            if isinstance(entry, Mapping) and isinstance(entry.get("value"), str):
                out.append(entry["value"])
        if isinstance(alias_map, Mapping):
            for entry in alias_map.get(lang, []) or []:
                if isinstance(entry, Mapping) and isinstance(entry.get("value"), str):
                    out.append(entry["value"])
    seen: set[str] = set()
    if exclude:
        seen.add(exclude)
    deduped: list[str] = []
    for name in out:
        if name not in seen:
            seen.add(name)
            deduped.append(name)
    return deduped


def hydrate_entity(
    entity: Mapping[str, Any],
    profile: HydrationProfile,
    *,
    alias_languages: Sequence[str] = (),
    exclude_alias: str | None = None,
) -> dict[str, str]:
    """Extract *profile*'s declared fields from one parsed dump *entity*.

    Returns a flat ``{canonical_field: value}`` dict (the first declared mapping
    that yields a value wins a field, so order encodes preference). A ``multi``
    mapping's values are ``;``-joined into the multi-value encoding; a single-value
    mapping keeps only the best-rank value. When *alias_languages* is non-empty the
    entity's labels/aliases in those languages are collected into a ``;``-joined
    ``aliases`` field, minus *exclude_alias* (the primary name) so it is not
    duplicated.
    """
    fields: dict[str, str] = {}
    for mapping in profile.mappings:
        if mapping.field in fields:
            continue
        values = _values(entity, mapping)
        if values:
            fields[mapping.field] = (
                MULTI_DELIMITER.join(values) if mapping.multi else values[0]
            )
    if alias_languages:
        names = _aliases(entity, alias_languages, exclude=exclude_alias)
        if names:
            fields["aliases"] = MULTI_DELIMITER.join(names)
    return fields


# --- profiles -----------------------------------------------------------------

#: Shared cross-domain mappings: the attributes most cultural entities carry.
#: Field names are the canonical vocabulary the mapper/linkers read, so each
#: value lands in a real dimension column with no further wiring.
DEFAULT_PROFILE = HydrationProfile(
    name="default",
    mappings=(
        # temporal — inception feeds time_start/time_end via parse_temporal.
        PropertyMapping("P571", "time_start_iso", ValueKind.TIME),
        # geographic — a precise point, then place identifiers (first wins).
        PropertyMapping("P625", "coordinates", ValueKind.COORDINATE),
        PropertyMapping("P495", "place_qid", ValueKind.ENTITY),  # country of origin
        PropertyMapping("P276", "place_qid", ValueKind.ENTITY),  # location
        PropertyMapping("P17", "place_qid", ValueKind.ENTITY),  # country
        # genetic — derivation references the genetic linker resolves by QID.
        PropertyMapping("P144", "derived_from_qid", ValueKind.ENTITY),  # based on
        PropertyMapping("P737", "influenced_by_qid", ValueKind.ENTITY),
        # linguistic — language of the work/name, kept as a code-ish reference.
        PropertyMapping("P407", "language_code", ValueKind.ENTITY),
        # descriptive — material and a free-text etymology / official name.
        PropertyMapping("P186", "material", ValueKind.ENTITY),
        PropertyMapping("P1582", "etymology", ValueKind.MONOLINGUAL),  # named after
    ),
)

#: A language-family profile: a language's parent and the place it is spoken in.
#:
#: The single-value mappings feed the ontology linkers (which resolve one parent /
#: place / script per node); the ``multi=True`` mappings then aggregate the *full*
#: set into overflow fields so no value is silently dropped, and the ``reference``
#: mapping lifts the citations backing the subclass classification into
#: provenance. Each rich mapping targets its own field (``parent_qids`` beside
#: ``parent_qid``), so the linkers keep their single value while the corpus keeps
#: the whole picture.
LANGUAGE_PROFILE = HydrationProfile(
    name="language",
    mappings=(
        PropertyMapping("P279", "parent_qid", ValueKind.ENTITY),  # subclass → parent
        PropertyMapping("P424", "language_code", ValueKind.STRING),  # wiki lang code
        PropertyMapping("P218", "language_code", ValueKind.STRING),  # ISO 639-1
        PropertyMapping("P17", "place_qid", ValueKind.ENTITY),  # spoken in country
        PropertyMapping("P282", "script", ValueKind.ENTITY),  # writing system
        # richer extraction (US-005) — aggregate every value, keep the citations.
        PropertyMapping("P279", "parent_qids", ValueKind.ENTITY, multi=True),
        PropertyMapping("P17", "spoken_in_qids", ValueKind.ENTITY, multi=True),
        PropertyMapping("P282", "scripts", ValueKind.ENTITY, multi=True),
        PropertyMapping(
            "P279", "references", ValueKind.STRING, reference="P854", multi=True
        ),
    ),
)

#: Named profiles selectable through ``source.params['hydrate']``.
PROFILES: dict[str, HydrationProfile] = {
    DEFAULT_PROFILE.name: DEFAULT_PROFILE,
    LANGUAGE_PROFILE.name: LANGUAGE_PROFILE,
}


class UnknownProfileError(KeyError):
    """Raised when ``source.params['hydrate']`` names no registered profile."""


def get_profile(name: str) -> HydrationProfile:
    """Return the registered :class:`HydrationProfile` for *name*.

    Raises:
        UnknownProfileError: naming the known profiles when *name* is unknown.
    """
    try:
        return PROFILES[name]
    except KeyError:
        known = ", ".join(sorted(PROFILES)) or "<none>"
        raise UnknownProfileError(
            f"unknown hydration profile {name!r}; known profiles: {known}"
        ) from None


def split_languages(raw: str | None) -> tuple[str, ...]:
    """Parse a ``;``-separated language-code list from a param, dropping blanks."""
    if not raw:
        return ()
    return tuple(code.strip() for code in raw.split(MULTI_DELIMITER) if code.strip())


def merge_languages(primary: str, extra: Iterable[str]) -> tuple[str, ...]:
    """Order *primary* first, then *extra*, de-duplicated — the alias languages."""
    ordered: list[str] = [primary]
    for code in extra:
        if code not in ordered:
            ordered.append(code)
    return tuple(ordered)
