"""Tests for declarative rich-entity hydration of dump entities.

These exercise :func:`~pinakes_engine.acquire.wikidata_hydration.hydrate_entity`
and its profiles directly on small synthetic entity dicts (the same shape
:func:`~pinakes_engine.acquire.wikidata_dump.iter_entities` yields), so each
:class:`ValueKind`, qualifier read, rank rule, and alias rule is checked in
isolation, offline.
"""

from __future__ import annotations

from typing import Any

import pytest

from pinakes_engine.acquire.wikidata_hydration import (
    DEFAULT_PROFILE,
    LANGUAGE_PROFILE,
    HydrationProfile,
    PropertyMapping,
    UnknownProfileError,
    ValueKind,
    get_profile,
    hydrate_entity,
    merge_languages,
    split_languages,
)


def _stmt(
    prop: str,
    value: Any,
    *,
    rank: str = "normal",
    qualifiers: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One statement carrying a value snak for *prop*."""
    statement: dict[str, Any] = {
        "mainsnak": {
            "snaktype": "value",
            "property": prop,
            "datavalue": {"value": value},
        },
        "type": "statement",
        "rank": rank,
    }
    if qualifiers is not None:
        statement["qualifiers"] = qualifiers
    return statement


def _entity(claims: dict[str, list[Any]], **rest: Any) -> dict[str, Any]:
    return {"id": "Q1", "labels": {}, "claims": claims, **rest}


def _one(prop: str, value: Any, **stmt: Any) -> dict[str, Any]:
    """An entity with a single *prop* statement carrying *value*."""
    return _entity({prop: [_stmt(prop, value, **stmt)]})


def _profile(*mappings: PropertyMapping) -> HydrationProfile:
    return HydrationProfile(name="test", mappings=mappings)


# --- value kinds --------------------------------------------------------------


def test_entity_kind_reads_target_qid() -> None:
    entity = _one("P495", {"entity-type": "item", "id": "Q419"})
    mapping = PropertyMapping("P495", "place_qid", ValueKind.ENTITY)
    assert hydrate_entity(entity, _profile(mapping)) == {"place_qid": "Q419"}


def test_time_kind_reduces_year_only_precision() -> None:
    entity = _one("P571", {"time": "+1535-00-00T00:00:00Z", "precision": 9})
    mapping = PropertyMapping("P571", "time_start_iso", ValueKind.TIME)
    assert hydrate_entity(entity, _profile(mapping)) == {"time_start_iso": "1535"}


def test_time_kind_keeps_full_date_and_bce_sign() -> None:
    mapping = PropertyMapping("P571", "d", ValueKind.TIME)
    day = _one("P571", {"time": "+1879-03-14T00:00:00Z"})
    assert hydrate_entity(day, _profile(mapping)) == {"d": "1879-03-14"}
    bce = _one("P571", {"time": "-0500-00-00T00:00:00Z"})
    assert hydrate_entity(bce, _profile(mapping)) == {"d": "-500"}


def test_coordinate_kind_formats_lat_lon() -> None:
    entity = _one("P625", {"latitude": -12.05, "longitude": -77.05})
    mapping = PropertyMapping("P625", "coordinates", ValueKind.COORDINATE)
    fields = hydrate_entity(entity, _profile(mapping))
    assert fields == {"coordinates": "-12.05, -77.05"}


def test_monolingual_kind_reads_text() -> None:
    entity = _one("P1582", {"text": "from Quechua", "language": "en"})
    mapping = PropertyMapping("P1582", "etymology", ValueKind.MONOLINGUAL)
    assert hydrate_entity(entity, _profile(mapping)) == {"etymology": "from Quechua"}


def test_string_and_quantity_kinds() -> None:
    code = _one("P424", "qu")
    code_map = PropertyMapping("P424", "language_code", ValueKind.STRING)
    assert hydrate_entity(code, _profile(code_map)) == {"language_code": "qu"}
    qty = _one("P1114", {"amount": "+5", "unit": "1"})
    qty_map = PropertyMapping("P1114", "count", ValueKind.QUANTITY)
    assert hydrate_entity(qty, _profile(qty_map)) == {"count": "5"}


def test_kind_mismatch_yields_nothing() -> None:
    # An entity-valued snak read as TIME must not produce a garbage value.
    entity = _one("P495", {"entity-type": "item", "id": "Q419"})
    mapping = PropertyMapping("P495", "x", ValueKind.TIME)
    assert hydrate_entity(entity, _profile(mapping)) == {}


def test_novalue_snak_is_skipped() -> None:
    snak = {"mainsnak": {"snaktype": "novalue", "property": "P571"}, "rank": "normal"}
    entity = _entity({"P571": [snak]})
    mapping = PropertyMapping("P571", "t", ValueKind.TIME)
    assert hydrate_entity(entity, _profile(mapping)) == {}


# --- statements, qualifiers, ranks --------------------------------------------


def test_first_mapping_for_a_field_wins() -> None:
    # Two properties feed place_qid; the earlier mapping takes precedence.
    entity = _entity(
        {
            "P276": [_stmt("P276", {"id": "Q276"})],
            "P495": [_stmt("P495", {"id": "Q495"})],
        }
    )
    profile = _profile(
        PropertyMapping("P495", "place_qid", ValueKind.ENTITY),
        PropertyMapping("P276", "place_qid", ValueKind.ENTITY),
    )
    assert hydrate_entity(entity, profile) == {"place_qid": "Q495"}


def test_preferred_rank_beats_normal() -> None:
    entity = _entity(
        {
            "P571": [
                _stmt("P571", {"time": "+1500-00-00T00:00:00Z"}),
                _stmt("P571", {"time": "+1600-00-00T00:00:00Z"}, rank="preferred"),
            ]
        }
    )
    mapping = PropertyMapping("P571", "t", ValueKind.TIME)
    assert hydrate_entity(entity, _profile(mapping)) == {"t": "1600"}


def test_deprecated_rank_is_dropped() -> None:
    value = {"time": "+1500-00-00T00:00:00Z"}
    entity = _entity({"P571": [_stmt("P571", value, rank="deprecated")]})
    mapping = PropertyMapping("P571", "t", ValueKind.TIME)
    assert hydrate_entity(entity, _profile(mapping)) == {}


def test_qualifier_is_read_instead_of_main_value() -> None:
    qualifiers = {
        "P580": [
            {
                "snaktype": "value",
                "property": "P580",
                "datavalue": {"value": {"time": "+1700-00-00T00:00:00Z"}},
            }
        ]
    }
    entity = _entity({"P276": [_stmt("P276", {"id": "Q900"}, qualifiers=qualifiers)]})
    mapping = PropertyMapping(
        "P276", "time_start_iso", ValueKind.TIME, qualifier="P580"
    )
    assert hydrate_entity(entity, _profile(mapping)) == {"time_start_iso": "1700"}


# --- multi-value extraction (US-005) ------------------------------------------


def _entity_snak(prop: str, value: Any) -> dict[str, Any]:
    """A bare value snak for *prop* (for hand-building qualifier/reference lists)."""
    return {"snaktype": "value", "property": prop, "datavalue": {"value": value}}


def test_multi_collects_every_statement_value_deduped() -> None:
    entity = _entity(
        {
            "P17": [
                _stmt("P17", {"id": "Q30"}),
                _stmt("P17", {"id": "Q16"}),
                _stmt("P17", {"id": "Q30"}),  # duplicate → dropped
            ]
        }
    )
    mapping = PropertyMapping("P17", "spoken_in_qids", ValueKind.ENTITY, multi=True)
    assert hydrate_entity(entity, _profile(mapping)) == {"spoken_in_qids": "Q30;Q16"}


def test_single_value_default_keeps_only_the_first_of_many() -> None:
    # Same entity, a non-multi mapping: unchanged historical behaviour.
    entity = _entity(
        {"P17": [_stmt("P17", {"id": "Q30"}), _stmt("P17", {"id": "Q16"})]}
    )
    mapping = PropertyMapping("P17", "place_qid", ValueKind.ENTITY)
    assert hydrate_entity(entity, _profile(mapping)) == {"place_qid": "Q30"}


def test_multi_orders_preferred_first_and_drops_deprecated() -> None:
    entity = _entity(
        {
            "P279": [
                _stmt("P279", {"id": "Q1"}),
                _stmt("P279", {"id": "Q2"}, rank="preferred"),
                _stmt("P279", {"id": "Q3"}, rank="deprecated"),
            ]
        }
    )
    mapping = PropertyMapping("P279", "parent_qids", ValueKind.ENTITY, multi=True)
    # Q2 (preferred) leads; Q1 (normal) follows; Q3 (deprecated) is absent.
    assert hydrate_entity(entity, _profile(mapping)) == {"parent_qids": "Q2;Q1"}


def test_multi_qualifier_reads_every_qualifier_snak() -> None:
    qualifiers = {
        "P1545": [_entity_snak("P1545", "1"), _entity_snak("P1545", "2")]
    }
    entity = _entity({"P527": [_stmt("P527", {"id": "Q9"}, qualifiers=qualifiers)]})
    single = PropertyMapping("P527", "ord", ValueKind.STRING, qualifier="P1545")
    # A non-multi qualifier mapping still reads only the first snak (legacy).
    assert hydrate_entity(entity, _profile(single)) == {"ord": "1"}
    multi = PropertyMapping(
        "P527", "ords", ValueKind.STRING, qualifier="P1545", multi=True
    )
    assert hydrate_entity(entity, _profile(multi)) == {"ords": "1;2"}


# --- reference extraction (US-005) --------------------------------------------


def _stmt_with_refs(prop: str, value: Any, ref_urls: list[str]) -> dict[str, Any]:
    """A statement whose references each carry one P854 reference URL."""
    statement = _stmt(prop, value)
    statement["references"] = [
        {"snaks": {"P854": [_entity_snak("P854", url)]}} for url in ref_urls
    ]
    return statement


def test_reference_extracts_first_reference_url() -> None:
    entity = _entity(
        {"P279": [_stmt_with_refs("P279", {"id": "Q1"}, ["http://a", "http://b"])]}
    )
    mapping = PropertyMapping("P279", "references", ValueKind.STRING, reference="P854")
    assert hydrate_entity(entity, _profile(mapping)) == {"references": "http://a"}


def test_reference_multi_collects_all_reference_urls_across_statements() -> None:
    entity = _entity(
        {
            "P279": [
                _stmt_with_refs("P279", {"id": "Q1"}, ["http://a", "http://b"]),
                _stmt_with_refs("P279", {"id": "Q2"}, ["http://b", "http://c"]),
            ]
        }
    )
    mapping = PropertyMapping(
        "P279", "references", ValueKind.STRING, reference="P854", multi=True
    )
    # Deduped across statements, in document order.
    assert hydrate_entity(entity, _profile(mapping)) == {
        "references": "http://a;http://b;http://c"
    }


def test_reference_precedes_qualifier_when_both_set() -> None:
    # A statement carrying both a qualifier and a reference: reference wins.
    statement = _stmt_with_refs("P279", {"id": "Q1"}, ["http://ref"])
    statement["qualifiers"] = {"P805": [_entity_snak("P805", "Q999")]}
    entity = _entity({"P279": [statement]})
    mapping = PropertyMapping(
        "P279", "x", ValueKind.STRING, reference="P854", qualifier="P805"
    )
    assert hydrate_entity(entity, _profile(mapping)) == {"x": "http://ref"}


def test_reference_absent_yields_nothing() -> None:
    entity = _entity({"P279": [_stmt("P279", {"id": "Q1"})]})  # no references
    mapping = PropertyMapping("P279", "references", ValueKind.STRING, reference="P854")
    assert hydrate_entity(entity, _profile(mapping)) == {}


# --- multilingual labels / aliases --------------------------------------------


def test_aliases_collect_labels_and_aliases_excluding_primary() -> None:
    entity = _entity(
        {},
        labels={
            "en": {"language": "en", "value": "ceviche"},
            "es": {"language": "es", "value": "cebiche"},
        },
        aliases={"en": [{"language": "en", "value": "seviche"}]},
    )
    fields = hydrate_entity(
        entity, _profile(), alias_languages=("en", "es"), exclude_alias="ceviche"
    )
    assert fields == {"aliases": "seviche;cebiche"}


def test_no_alias_languages_means_no_aliases_field() -> None:
    entity = _entity({}, labels={"en": {"language": "en", "value": "ceviche"}})
    assert hydrate_entity(entity, _profile()) == {}


# --- profiles -----------------------------------------------------------------


def test_default_profile_covers_every_dimension() -> None:
    targets = {m.field for m in DEFAULT_PROFILE.mappings}
    assert "time_start_iso" in targets  # temporal
    assert "place_qid" in targets  # geographic
    assert "derived_from_qid" in targets  # genetic
    assert "language_code" in targets  # linguistic


def test_language_profile_maps_parent_and_code() -> None:
    targets = {m.field for m in LANGUAGE_PROFILE.mappings}
    assert {"parent_qid", "language_code", "place_qid"} <= targets


def test_language_profile_opts_into_richer_extraction() -> None:
    # US-005: the language profile keeps its single-value linker fields AND adds
    # multi-value aggregations + a reference-URL citation, all opt-in.
    by_field = {m.field: m for m in LANGUAGE_PROFILE.mappings}
    assert {"parent_qids", "spoken_in_qids", "scripts", "references"} <= set(by_field)
    assert by_field["parent_qids"].multi and not by_field["parent_qid"].multi
    assert by_field["references"].reference == "P854"


def test_default_profile_stays_single_value() -> None:
    # AC2: default behaviour is unchanged — no mapping opts into multi/reference.
    assert not any(
        m.multi or m.reference is not None for m in DEFAULT_PROFILE.mappings
    )


def test_get_profile_returns_registered_profile() -> None:
    assert get_profile("default") is DEFAULT_PROFILE
    assert get_profile("language") is LANGUAGE_PROFILE


def test_get_profile_unknown_raises_with_known_names() -> None:
    with pytest.raises(UnknownProfileError, match="default"):
        get_profile("nope")


def test_split_and_merge_languages() -> None:
    assert split_languages("en; es ;;fr") == ("en", "es", "fr")
    assert split_languages(None) == ()
    assert merge_languages("en", ["es", "en", "fr"]) == ("en", "es", "fr")
