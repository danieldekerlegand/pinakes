"""The shipped ``material-culture`` blueprint covers the made objects of life.

Offline and fixture-backed: the blueprint expands to a category per stub and a
runnable job with no network. This guards the domain's acceptance criteria —
one verified Wikidata class per category covering clothing/garments, textiles,
crafts, tools, weapons, pottery/ceramics, and currency, with only valid
dimensions and only registered link ``:TYPE``s, minting MADE_OF (Getty AAT
materials) and ORIGINATES_FROM so composition and provenance are queryable.
"""

from __future__ import annotations

from pathlib import Path

from culturescrape.acquire.categories import VALID_DIMENSIONS, load_category
from culturescrape.ontology.registry import is_registered
from culturescrape.orchestrate.generate import generate
from culturescrape.orchestrate.jobs import load_job

_ROOT = Path(__file__).resolve().parent.parent
BLUEPRINT = _ROOT / "blueprints" / "material-culture.yml"

# Each required slice of the domain, mapped to the stub id that covers it.
REQUIRED_CATEGORIES = {
    "clothing/garments": "clothing",
    "textiles": "textiles",
    "crafts": "crafts",
    "tools": "tools",
    "weapons": "weapons",
    "pottery/ceramics": "ceramics",
    "currency": "currency",
}


def test_material_culture_blueprint_generates_and_validates_offline(
    tmp_path: Path,
) -> None:
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "material-culture.yml"

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
    assert job.name == "material-culture"
    assert {spec.id for spec in job.categories} == ids


def test_material_culture_links_are_made_of_and_originates_from(
    tmp_path: Path,
) -> None:
    """Every artifact mints its composition and provenance with registered types."""
    out = tmp_path / "categories"
    generate(BLUEPRINT, out, force=True)

    for cat_id in REQUIRED_CATEGORIES.values():
        spec = load_category(out / f"{cat_id}.yml")
        link_types = {link.type for link in spec.links}
        assert {"MADE_OF", "ORIGINATES_FROM"} <= link_types, (
            f"{cat_id}: expected MADE_OF and ORIGINATES_FROM, got {link_types}"
        )
