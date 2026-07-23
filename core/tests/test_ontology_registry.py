"""Tests for the formal relationship-type ontology."""

import pytest

from culturescrape.ontology import (
    REGISTRY,
    Dimension,
    RelationType,
    UnknownRelationTypeError,
    by_dimension,
    get,
    is_registered,
    lookup,
    relation_types,
    validate_type,
)


def test_lookup_returns_relation_type() -> None:
    rel = lookup("LOCATED_IN")
    assert isinstance(rel, RelationType)
    assert rel.name == "LOCATED_IN"
    assert rel.dimension is Dimension.GEOGRAPHIC
    assert rel.domain == "entity"
    assert rel.range == "place"


def test_get_returns_none_for_unknown() -> None:
    assert get("NOT_A_TYPE") is None
    assert get("LOCATED_IN") is REGISTRY["LOCATED_IN"]


def test_is_registered() -> None:
    assert is_registered("DESCENDS_FROM")
    assert not is_registered("descends_from")  # case-sensitive wire token
    assert not is_registered("BOGUS")


def test_validate_type_rejects_unknown() -> None:
    with pytest.raises(UnknownRelationTypeError):
        validate_type("MADE_UP")


def test_validate_type_accepts_and_returns_known() -> None:
    assert validate_type("CONTEMPORARY_WITH").name == "CONTEMPORARY_WITH"


def test_lookup_rejects_unknown() -> None:
    with pytest.raises(UnknownRelationTypeError):
        lookup("BOGUS")


@pytest.mark.parametrize(
    "name",
    ["ADJACENT_TO", "CONTEMPORARY_WITH", "COGNATE_WITH", "VARIANT_OF"],
)
def test_symmetric_flags(name: str) -> None:
    assert lookup(name).symmetric is True


@pytest.mark.parametrize(
    "name",
    ["LOCATED_IN", "ORIGINATES_FROM", "PRECEDES", "DERIVED_FROM", "INSTANCE_OF"],
)
def test_asymmetric_flags(name: str) -> None:
    assert lookup(name).symmetric is False


@pytest.mark.parametrize(
    "name",
    ["LOCATED_IN", "PRECEDES", "FOLLOWS", "DESCENDS_FROM", "DERIVED_FROM",
     "SUBCLASS_OF", "COGNATE_WITH", "PART_OF"],
)
def test_transitive_flags(name: str) -> None:
    assert lookup(name).transitive is True


def test_contemporary_with_is_symmetric_but_not_transitive() -> None:
    rel = lookup("CONTEMPORARY_WITH")
    assert rel.symmetric is True
    assert rel.transitive is False


def test_registry_covers_every_documented_type() -> None:
    expected = {
        "LOCATED_IN", "ORIGINATES_FROM", "SPOKEN_IN", "ADJACENT_TO",
        "CONTEMPORARY_WITH", "PRECEDES", "FOLLOWS", "PART_OF_PERIOD",
        "DESCENDS_FROM", "BORROWED_FROM", "COGNATE_WITH", "NAMED_IN",
        "DERIVED_FROM", "INFLUENCED_BY", "VARIANT_OF",
        "INSTANCE_OF", "SUBCLASS_OF", "MEMBER_OF_CATEGORY", "CREATED_BY",
        "MADE_OF", "PART_OF", "USES",
        "DEPICTS", "MENTIONS",
        "PARENT_OF", "SPOUSE_OF", "EMPLOYED_BY", "RESIDES_IN", "CAUSED_BY",
    }
    assert set(REGISTRY) == expected


def test_relation_types_keys_match_names() -> None:
    for rel in relation_types():
        assert REGISTRY[rel.name] is rel


def test_by_dimension_partitions_the_registry() -> None:
    grouped = [r.name for r in by_dimension(Dimension.LINGUISTIC)]
    assert grouped == ["DESCENDS_FROM", "BORROWED_FROM", "COGNATE_WITH", "NAMED_IN"]
    total = sum(len(by_dimension(d)) for d in Dimension)
    assert total == len(REGISTRY)
