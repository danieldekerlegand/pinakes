"""The shipped ``sports-games`` blueprint must cover play across cultures.

Offline and fixture-backed: the blueprint expands to a category per stub and a
runnable job with no network. This guards the domain's acceptance criteria —
one verified class per category covering sports, martial arts, board games,
card games, traditional/folk games, and toys, with only valid dimensions and
only registered link ``:TYPE``s.
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
    / "sports-games.yml"
)

# Each required slice of the domain, mapped to the stub id that covers it.
REQUIRED_CATEGORIES = {
    "sports": "sports",
    "martial arts": "martial-arts",
    "board games": "board-games",
    "card games": "card-games",
    "traditional/folk games": "traditional-games",
    "toys": "toys",
}


def test_sports_games_blueprint_generates_and_validates_offline(tmp_path: Path) -> None:
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "sports-games.yml"

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

    # Every required slice of play and competition is present.
    for slice_name, cat_id in REQUIRED_CATEGORIES.items():
        assert cat_id in ids, f"missing category for {slice_name!r}: {cat_id}"

    # The job lists and re-validates every generated category, with no network.
    assert result.job == job_path
    job = load_job(job_path)
    assert job.name == "sports-games"
    assert {spec.id for spec in job.categories} == ids


def test_sports_games_lineage_links_are_game_family_types(tmp_path: Path) -> None:
    """Game-family lineage is minted with registered genetic ``:TYPE``s."""
    out = tmp_path / "categories"
    generate(BLUEPRINT, out, force=True)

    spec = load_category(out / "board-games.yml")
    link_types = {link.type for link in spec.links}
    assert {"VARIANT_OF", "DERIVED_FROM"} <= link_types
    assert "genetic" in spec.dimensions
