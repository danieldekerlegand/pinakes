"""The shipped ``categories/`` examples must load and validate.

These are the runnable templates users model their own categories on (see
``docs/acquisition.md``), so every one must parse cleanly against the loader.
"""

from pathlib import Path

import pytest

from pinakes_engine.acquire import CategorySpec, load_category

CATEGORIES = Path(__file__).resolve().parent.parent / "inputs" / "categories"

#: Every shipped example, with the ``source.type`` it is meant to demonstrate.
EXPECTED_SOURCE_TYPES = {
    "peruvian-dishes": "wikidata-sparql",
    "us-civil-war-battles": "petscan",
    "italian-sculptures": "wikidata-sparql",
}


def _example_files() -> list[Path]:
    return sorted(CATEGORIES.glob("*.yml"))


def test_examples_directory_is_not_empty() -> None:
    assert _example_files(), "expected runnable examples under categories/"


@pytest.mark.parametrize("path", _example_files(), ids=lambda p: p.stem)
def test_example_category_loads(path: Path) -> None:
    spec = load_category(path)

    assert isinstance(spec, CategorySpec)
    assert spec.id == path.stem  # id matches the filename so it is discoverable


def test_required_examples_are_present_with_expected_sources() -> None:
    loaded = {p.stem: load_category(p) for p in _example_files()}

    for name, source_type in EXPECTED_SOURCE_TYPES.items():
        assert name in loaded, f"missing required example category {name!r}"
        assert loaded[name].source.type == source_type


def test_petscan_example_declares_a_runnable_query() -> None:
    spec = load_category(CATEGORIES / "us-civil-war-battles.yml")

    # PetScan needs categories or sparql to have anything to run.
    assert spec.source.params.get("categories") or spec.source.params.get("sparql")
