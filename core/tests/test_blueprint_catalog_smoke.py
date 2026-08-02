"""Offline smoke test for the whole blueprint catalog.

One catalog-wide guard so breadth cannot silently rot: with no network, every
shipped ``blueprints/<domain>.yml`` must generate, every generated category must
pass ``load_category`` with only valid dimensions and only registered link
``:TYPE``s, and every shipped ``jobs/<domain>.yml`` must parse. Dropping a new
blueprint or job in is covered automatically — there is no per-domain test to
remember to add for these catalog-wide guarantees.

Per-domain required-slice coverage lives in ``tests/test_blueprint_<domain>.py``;
detailed job guards live in ``tests/test_shipped_jobs.py``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from culturescrape.acquire import CategorySpec
from culturescrape.acquire.categories import VALID_DIMENSIONS, load_category
from culturescrape.ontology.registry import is_registered
from culturescrape.orchestrate.generate import generate, iter_blueprints, load_blueprint
from culturescrape.orchestrate.jobs import Job, load_job

REPO_ROOT = Path(__file__).resolve().parent.parent
BLUEPRINTS = sorted(iter_blueprints(REPO_ROOT / "inputs" / "blueprints"))
SHIPPED_JOBS = sorted((REPO_ROOT / "inputs" / "jobs").glob("*.yml"))
#: The catalog count documented in docs/blueprints.md and README.md, summed over
#: the twelve verified domains (the ``example`` worked example is excluded).
DOCUMENTED_DOMAIN_CATEGORIES = 119


def test_catalog_directories_are_not_empty() -> None:
    # Guard against a glob that silently matches nothing, which would make every
    # parametrized assertion below vacuously pass.
    assert BLUEPRINTS, "expected blueprints under blueprints/"
    assert SHIPPED_JOBS, "expected jobs under jobs/"


def test_documented_category_count_matches_the_catalog() -> None:
    """The category total in docs/blueprints.md and README.md cannot drift from
    what the twelve verified domain blueprints actually expand to."""
    total = sum(
        len(load_blueprint(p)) for p in BLUEPRINTS if p.stem != "example"
    )
    assert total == DOCUMENTED_DOMAIN_CATEGORIES, (
        f"docs claim {DOCUMENTED_DOMAIN_CATEGORIES} domain categories but the "
        f"blueprints expand to {total}; update docs/blueprints.md and README.md"
    )


@pytest.mark.parametrize("blueprint", BLUEPRINTS, ids=lambda p: p.stem)
def test_blueprint_generates_valid_categories_offline(
    blueprint: Path, tmp_path: Path
) -> None:
    """Every blueprint expands to category files that ``load_category`` accepts,
    with only valid dimensions and only registered link ``:TYPE``s — no network."""
    result = generate(blueprint, tmp_path / "categories", force=True)
    assert result.categories, f"{blueprint.name} generated no category files"

    for cat_path in result.categories:
        spec = load_category(cat_path)
        assert isinstance(spec, CategorySpec)

        bad_dims = sorted(set(spec.dimensions) - VALID_DIMENSIONS)
        assert not bad_dims, f"{spec.id}: invalid dimensions {bad_dims}"

        for link in spec.links:
            assert is_registered(link.type), (
                f"{spec.id}: link :TYPE {link.type!r} is not registered in the "
                "ontology registry"
            )


@pytest.mark.parametrize("job_path", SHIPPED_JOBS, ids=lambda p: p.name)
def test_shipped_job_parses_offline(job_path: Path) -> None:
    """Every shipped job parses to a runnable ``Job`` with real categories."""
    job = load_job(job_path)
    assert isinstance(job, Job)
    assert job.categories
    assert all(isinstance(spec, CategorySpec) for spec in job.categories)
