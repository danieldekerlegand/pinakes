"""The shipped ``living-traditions`` blueprint covers enacted and cultivated culture.

Offline and fixture-backed: the blueprint expands to a category per stub and a
runnable job with no network. This guards the domain's acceptance criteria —
one verified Wikidata class per category covering festivals (traditional and
harvest), ceremonies and rites of passage, dances, domesticated breeds, plant
cultivars, medicinal/healing traditions, and folklore creatures, with only
valid dimensions and only registered link ``:TYPE``s. The festival/ritual
classes are the tradition-bearing sub-classes, chosen so the domain does not
collide with the general festival/ritual categories shipped by myth-religion.
Calendrical/seasonal practices mint the temporal axis (PART_OF_PERIOD,
CONTEMPORARY_WITH); everything is rooted with ORIGINATES_FROM.
"""

from __future__ import annotations

from pathlib import Path

from pinakes_engine.acquire.categories import VALID_DIMENSIONS, load_category
from pinakes_engine.ontology.registry import is_registered
from pinakes_engine.orchestrate.generate import generate
from pinakes_engine.orchestrate.jobs import load_job

BLUEPRINT = (
    Path(__file__).resolve().parent.parent
    / "inputs"
    / "blueprints"
    / "living-traditions.yml"
)

# Each required slice of the domain, mapped to the stub id that covers it.
REQUIRED_CATEGORIES = {
    "festivals": "traditional-festivals",
    "festivals (seasonal)": "harvest-festivals",
    "rituals/ceremonies (ceremonies)": "ceremonies",
    "rituals/ceremonies (rites)": "rites-of-passage",
    "dances": "dances",
    "domesticated breeds": "breeds",
    "cultivars": "cultivars",
    "medicinal/healing traditions": "healing-traditions",
    "folklore creatures": "folklore-creatures",
}

# Calendrical/seasonal practices that must mint the temporal axis.
CALENDRICAL_PRACTICES = (
    "traditional-festivals",
    "harvest-festivals",
    "ceremonies",
    "rites-of-passage",
    "dances",
)


def test_living_traditions_blueprint_generates_and_validates_offline(
    tmp_path: Path,
) -> None:
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "living-traditions.yml"

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
        # Every stub roots its entities geographically.
        assert any(link.type == "ORIGINATES_FROM" for link in spec.links), (
            f"{spec.id}: expected ORIGINATES_FROM rooting"
        )

    # Every required slice of the domain is present.
    for slice_name, cat_id in REQUIRED_CATEGORIES.items():
        assert cat_id in ids, f"missing category for {slice_name!r}: {cat_id}"

    # The job lists and re-validates every generated category, with no network.
    assert result.job == job_path
    job = load_job(job_path)
    assert job.name == "living-traditions"
    assert {spec.id for spec in job.categories} == ids


def test_calendrical_practices_mint_the_temporal_axis(tmp_path: Path) -> None:
    """Festivals, rituals, ceremonies and dances mint registered temporal links."""
    out = tmp_path / "categories"
    generate(BLUEPRINT, out, force=True)

    for cat_id in CALENDRICAL_PRACTICES:
        spec = load_category(out / f"{cat_id}.yml")
        link_types = {link.type for link in spec.links}
        assert {"PART_OF_PERIOD", "CONTEMPORARY_WITH"} <= link_types, (
            f"{cat_id}: expected temporal links, got {link_types}"
        )
        assert "temporal" in spec.dimensions
