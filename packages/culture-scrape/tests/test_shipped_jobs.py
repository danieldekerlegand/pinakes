"""Guards over every shipped ``jobs/<domain>.yml``.

These exercise the *real* job specs (not fixtures) so a job that points at a
deleted category, names an unregistered link ``:TYPE``, or declares an invalid
dimension fails CI rather than a live ``culturescrape run``. As the corpus grows
new domains, dropping a generated ``jobs/<domain>.yml`` in is automatically
covered — no per-domain test to remember to add.
"""

from pathlib import Path

import pytest

from culturescrape.acquire import CategorySpec
from culturescrape.acquire.categories import VALID_DIMENSIONS
from culturescrape.ontology import validate_type
from culturescrape.orchestrate import Job, load_job

REPO_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = REPO_ROOT / "jobs"
CATEGORIES_DIR = REPO_ROOT / "categories"

#: Every shipped job spec, by name, so failures point at the offending file.
SHIPPED_JOBS = sorted(JOBS_DIR.glob("*.yml"))


def test_jobs_directory_is_not_empty() -> None:
    # Guard against a glob that silently matches nothing (e.g. a moved directory),
    # which would make every parametrized test below vacuously pass.
    assert SHIPPED_JOBS


@pytest.mark.parametrize("job_path", SHIPPED_JOBS, ids=lambda p: p.name)
def test_shipped_job_parses(job_path: Path) -> None:
    job = load_job(job_path)

    assert isinstance(job, Job)
    assert job.categories
    assert all(isinstance(spec, CategorySpec) for spec in job.categories)


@pytest.mark.parametrize("job_path", SHIPPED_JOBS, ids=lambda p: p.name)
def test_shipped_job_references_only_existing_categories(job_path: Path) -> None:
    import yaml

    raw = yaml.safe_load(job_path.read_text(encoding="utf-8"))
    for ref in raw["categories"]:
        resolved = (job_path.parent / ref).resolve()
        assert resolved.is_file(), f"{job_path.name} references missing {ref}"
        # Generated jobs live under jobs/ and point at the shared categories/ dir.
        assert resolved.parent == CATEGORIES_DIR


@pytest.mark.parametrize("job_path", SHIPPED_JOBS, ids=lambda p: p.name)
def test_shipped_job_uses_registered_types_and_valid_dimensions(
    job_path: Path,
) -> None:
    job = load_job(job_path)
    for spec in job.categories:
        assert spec.dimensions
        assert set(spec.dimensions) <= VALID_DIMENSIONS
        for link in spec.links:
            validate_type(link.type)  # raises on an unregistered :TYPE
