"""The shipped ``science-tech`` blueprint must capture the lineage of devices.

Offline and fixture-backed: the blueprint expands to a category per stub and a
runnable job with no network. This guards the domain's acceptance criteria —
one verified Wikidata class per category covering inventions, scientific
instruments, technologies, materials, vehicles, and machines, with only valid
dimensions and only registered link ``:TYPE``s, leaning into the genetic /
derivation axis so invention-lineage chains are minted.
"""

from __future__ import annotations

from pathlib import Path

from culturescrape.acquire.categories import VALID_DIMENSIONS, load_category
from culturescrape.ontology.registry import is_registered
from culturescrape.orchestrate.generate import generate
from culturescrape.orchestrate.jobs import load_job

BLUEPRINT = Path(__file__).resolve().parent.parent / "blueprints" / "science-tech.yml"

# Each required slice of the domain, mapped to the stub id that covers it.
REQUIRED_CATEGORIES = {
    "inventions": "inventions",
    "scientific instruments": "scientific-instruments",
    "technologies": "technologies",
    "materials": "materials",
    "vehicles": "vehicles",
    "machines": "machines",
}


def test_science_tech_blueprint_generates_and_validates_offline(tmp_path: Path) -> None:
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "science-tech.yml"

    result = generate(BLUEPRINT, out, job=job_path, force=True)

    # Every stub expands to a category file that the real loader accepts.
    ids = set()
    for cat_path in result.categories:
        spec = load_category(cat_path)
        ids.add(spec.id)
        bad_dims = [d for d in spec.dimensions if d not in VALID_DIMENSIONS]
        assert not bad_dims, f"{spec.id}: invalid dimensions {bad_dims}"
        for link in spec.links:
            assert is_registered(link.type), (
                f"{spec.id}: link :TYPE {link.type!r} is not registered"
            )

    # Every required slice of the domain is present.
    for slice_name, cat_id in REQUIRED_CATEGORIES.items():
        assert cat_id in ids, f"missing category for {slice_name!r}: {cat_id}"

    # The job lists and re-validates every generated category, with no network.
    assert result.job == job_path
    job = load_job(job_path)
    assert job.name == "science-tech"
    assert {spec.id for spec in job.categories} == ids


def test_science_tech_lineage_links_are_derivation_types(tmp_path: Path) -> None:
    """Invention lineage is minted with registered genetic ``:TYPE``s."""
    out = tmp_path / "categories"
    generate(BLUEPRINT, out, force=True)

    spec = load_category(out / "inventions.yml")
    link_types = {link.type for link in spec.links}
    assert {"DERIVED_FROM", "INFLUENCED_BY", "VARIANT_OF"} <= link_types
    assert "genetic" in spec.dimensions
