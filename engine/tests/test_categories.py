"""Tests for loading and validating category specifications."""

from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    CategorySpecError,
    Link,
    SourceSpec,
    load_category,
)

FIXTURES = Path(__file__).parent / "fixtures" / "categories"


def test_load_valid_returns_typed_spec() -> None:
    spec = load_category(FIXTURES / "valid.yml")

    assert isinstance(spec, CategorySpec)
    assert spec.id == "peruvian-dishes"
    assert spec.label == "Dish;CulturalArtifact"
    assert spec.description == "Every Peruvian dish"
    assert spec.dimensions == ("temporal", "geographic", "linguistic")
    assert spec.links == (Link(type="ORIGINATES_FROM", to="place"),)


def test_load_valid_parses_source_and_query() -> None:
    spec = load_category(FIXTURES / "valid.yml")

    assert isinstance(spec.source, SourceSpec)
    assert spec.source.type == "wikidata-sparql"
    assert spec.source.query is not None
    assert "wdt:P31 wd:Q746549" in spec.source.query


def test_spec_is_frozen() -> None:
    spec = load_category(FIXTURES / "valid.yml")
    with pytest.raises(AttributeError):
        spec.id = "mutated"  # type: ignore[misc]


def test_missing_required_keys_lists_all() -> None:
    with pytest.raises(CategorySpecError) as exc:
        load_category(FIXTURES / "invalid_missing_keys.yml")

    message = str(exc.value)
    assert "missing required keys" in message
    assert "label" in message
    assert "source" in message


def test_bad_values_lists_every_problem() -> None:
    with pytest.raises(CategorySpecError) as exc:
        load_category(FIXTURES / "invalid_bad_values.yml")

    message = str(exc.value)
    assert "carrier-pigeon" in message  # invalid source.type
    assert "culinary" in message  # invalid dimension
    assert "unexpected_key" in message  # unknown top-level key
    assert "links[0].to" in message  # malformed link


def test_links_default_to_empty_when_omitted(tmp_path: Path) -> None:
    path = tmp_path / "no_links.yml"
    path.write_text(
        "id: c\nlabel: L\ndescription: d\n"
        "source:\n  type: dump\ndimensions: [temporal]\n",
        encoding="utf-8",
    )

    spec = load_category(path)
    assert spec.links == ()
    assert spec.source.query is None


def test_source_params_parse_and_coerce_to_strings(tmp_path: Path) -> None:
    path = tmp_path / "petscan.yml"
    path.write_text(
        "id: c\nlabel: L\ndescription: d\n"
        "source:\n  type: petscan\n  params:\n"
        "    categories: Peruvian cuisine\n    depth: 3\n"
        "    combination: subset\n"
        "dimensions: [geographic]\n",
        encoding="utf-8",
    )

    spec = load_category(path)
    assert spec.source.params == {
        "categories": "Peruvian cuisine",
        "depth": "3",  # YAML int coerced to string for the request
        "combination": "subset",
    }


def test_source_params_default_to_empty_when_omitted() -> None:
    spec = load_category(FIXTURES / "valid.yml")
    assert spec.source.params == {}


def test_non_mapping_source_params_raises(tmp_path: Path) -> None:
    path = tmp_path / "bad_params.yml"
    path.write_text(
        "id: c\nlabel: L\ndescription: d\n"
        "source:\n  type: petscan\n  params: not-a-mapping\n"
        "dimensions: [geographic]\n",
        encoding="utf-8",
    )
    with pytest.raises(CategorySpecError, match="source.params"):
        load_category(path)


def test_missing_file_raises_clear_error(tmp_path: Path) -> None:
    with pytest.raises(CategorySpecError, match="cannot read category file"):
        load_category(tmp_path / "does-not-exist.yml")


def test_invalid_yaml_raises_clear_error(tmp_path: Path) -> None:
    path = tmp_path / "broken.yml"
    path.write_text("id: c\n  bad: : indentation\n", encoding="utf-8")
    with pytest.raises(CategorySpecError, match="invalid YAML"):
        load_category(path)


def test_non_mapping_top_level_raises(tmp_path: Path) -> None:
    path = tmp_path / "list.yml"
    path.write_text("- not\n- a\n- mapping\n", encoding="utf-8")
    with pytest.raises(CategorySpecError, match="expected a YAML mapping"):
        load_category(path)
