"""The shipped ``blueprints/`` library must expand into valid category specs.

Each blueprint declares a domain's verified Wikidata classes; ``culturescrape
generate`` expands it into the ``categories/`` specs a job runs. This guards the
library: every blueprint must parse and expand without error, so a malformed
stub (a bad id, a missing source, a typo'd QID shape) fails the suite rather than
producing a broken category at generation time.
"""

from pathlib import Path

import pytest

from culturescrape.acquire.categories import (
    VALID_DIMENSIONS,
    CategorySpec,
    load_category,
)
from culturescrape.ontology.registry import is_registered
from culturescrape.orchestrate.generate import generate, load_blueprint

BLUEPRINTS = Path(__file__).resolve().parent.parent / "inputs" / "blueprints"


def _blueprint_files() -> list[Path]:
    return sorted(BLUEPRINTS.glob("*.yml"))


def test_blueprints_directory_is_not_empty() -> None:
    assert _blueprint_files(), "expected blueprints under blueprints/"


@pytest.mark.parametrize("path", _blueprint_files(), ids=lambda p: p.stem)
def test_blueprint_expands_to_valid_specs(path: Path) -> None:
    specs = load_blueprint(path)

    assert specs, f"{path.name} expanded to no categories"
    assert all(isinstance(spec, CategorySpec) for spec in specs)
    # Ids are unique within a blueprint (generation would clobber otherwise).
    ids = [spec.id for spec in specs]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("path", _blueprint_files(), ids=lambda p: p.stem)
def test_blueprint_categories_load_with_valid_dimensions_and_links(
    path: Path, tmp_path: Path
) -> None:
    """Offline, fixture-backed: every shipped blueprint expands to category
    files that ``load_category`` accepts, with only valid dimensions and only
    registered link ``:TYPE``s — no network required."""
    result = generate(path, tmp_path / "categories", force=True)
    assert result.categories, f"{path.name} generated no category files"
    for cat_path in result.categories:
        spec = load_category(cat_path)
        bad_dims = [d for d in spec.dimensions if d not in VALID_DIMENSIONS]
        assert not bad_dims, f"{spec.id}: invalid dimensions {bad_dims}"
        for link in spec.links:
            assert is_registered(link.type), (
                f"{spec.id}: link :TYPE {link.type!r} is not registered in the "
                "ontology registry"
            )


def test_generate_is_idempotent_on_unchanged_blueprint(tmp_path: Path) -> None:
    """Regenerating an unchanged blueprint yields byte-identical outputs."""
    blueprint = next(iter(_blueprint_files()))
    out = tmp_path / "categories"
    job = tmp_path / "jobs" / "job.yml"

    first = generate(blueprint, out, job=job, force=True)
    assert first.job is not None
    snapshot = {p: p.read_bytes() for p in (*first.categories, first.job)}

    generate(blueprint, out, job=job, force=True)
    for path, content in snapshot.items():
        assert path.read_bytes() == content, f"{path.name} changed on regenerate"
