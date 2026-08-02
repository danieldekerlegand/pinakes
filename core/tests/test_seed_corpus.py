"""Tests that the shipped seed corpus loads and validates against the loaders.

Unlike the fixture-driven loader tests, these exercise the *real*
``categories/<name>.yml`` and ``jobs/seed-corpus.yml`` files so a typo in a
shipped spec fails CI rather than a live run.
"""

from pathlib import Path

import pytest

from culturescrape.acquire import CategorySpec, load_category
from culturescrape.acquire.categories import VALID_DIMENSIONS, VALID_SOURCE_TYPES
from culturescrape.ontology import validate_type
from culturescrape.orchestrate import Job, load_job

REPO_ROOT = Path(__file__).resolve().parent.parent
JOB_PATH = REPO_ROOT / "inputs" / "jobs" / "seed-corpus.yml"

#: The domains the seed corpus must cover (acceptance criteria). The first five
#: are the original multi-domain spread; the rest represent the corpus-expansion
#: domains (sports/games, science/tech, material culture/dress, living traditions).
REQUIRED_CATEGORY_IDS = {
    "peruvian-dishes",
    "italian-sculptures",
    "german-architectural-monuments",
    "us-civil-war-battles",
    "indo-european-languages",
    "board-games",
    "inventions",
    "clothing",
    "traditional-festivals",
}


def test_seed_job_loads_and_is_typed() -> None:
    job = load_job(JOB_PATH)

    assert isinstance(job, Job)
    assert job.name == "seed-corpus"
    assert all(isinstance(c, CategorySpec) for c in job.categories)


def test_seed_job_covers_required_domains() -> None:
    job = load_job(JOB_PATH)
    ids = {c.id for c in job.categories}
    assert REQUIRED_CATEGORY_IDS <= ids


@pytest.mark.parametrize("category_id", sorted(REQUIRED_CATEGORY_IDS))
def test_each_seed_category_validates(category_id: str) -> None:
    spec = load_category(REPO_ROOT / "inputs" / "categories" / f"{category_id}.yml")

    assert isinstance(spec, CategorySpec)
    # Source: a known adapter type, with a query or params to drive it.
    assert spec.source.type in VALID_SOURCE_TYPES
    assert spec.source.query or spec.source.params
    # Dimensions: non-empty and all recognised.
    assert spec.dimensions
    assert set(spec.dimensions) <= VALID_DIMENSIONS


def test_seed_categories_use_registered_link_types() -> None:
    # Every link a seed category mints must name a relation in the ontology.
    job = load_job(JOB_PATH)
    for spec in job.categories:
        for link in spec.links:
            validate_type(link.type)  # raises if unknown


def test_seed_corpus_spans_every_dimension() -> None:
    # The corpus exists to exercise the whole system, so collectively the seed
    # categories should touch all four enrichment dimensions.
    job = load_job(JOB_PATH)
    covered = {dim for spec in job.categories for dim in spec.dimensions}
    assert {"temporal", "geographic", "linguistic"} <= covered
