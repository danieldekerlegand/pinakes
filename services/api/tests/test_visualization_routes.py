"""The three `/api/visualizations/*` feeds (pinakes:80 US-1).

No recorded fixture grades these three, so this file is the grading. It asserts
the rules a shape check would miss: which weight an intensity carries, what the
year filter does with an undated contact and with a junk bound, that a regional
cuisine link never overwrites a food-type one, and that the chord matrix is
written symmetrically from a directed tally.

`conftest.py`'s autouse `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at
an empty temp tree, so every test seeds its own TSVs.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

CONTACT_HEADER = (
    "id\tsource_language_id\ttarget_language_id\tcontact_type\ttime_period\t"
    "region\tfeatures_transferred\texample_features\tintensity"
)
LANGUAGE_HEADER = (
    "id\tname\tnative_name\tiso639_1\tiso639_2\tfamily_id\tparent_language_id\t"
    "region\tcountries\tnative_speakers\ttotal_speakers\tstatus\ttime_origin\t"
    "time_end\tclassification\twriting_system\tis_historical_variant\tis_dialect\t"
    "chronological_order\thistorical_context\tlatitude\tlongitude\tconfidence\t"
    "endangerment_status\tretrieved_at\tsource_url\tsources\twikidata_qid\tglottocode"
)
FAMILY_HEADER = (
    "id\tname\tparent_id\tdescription\ttaxonomic_level\tregion\ttotal_speakers\t"
    "language_count"
)
CUISINE_HEADER = (
    "id\tname\tnative_name\tregion\tcoordinates\tassociated_language_ids\t"
    "time_origin\ttime_end\tdescription\twikidata_qid\tsource_url\tretrieved_at\t"
    "confidence\tsources"
)
ITEM_HEADER = "id\tcuisine_id\tname\tfood_type\ttime_origin\ttime_end"


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


def language(identifier: str, name: str, family: str) -> str:
    cells = [""] * 29
    cells[0], cells[1], cells[5] = identifier, name, family
    return "\t".join(cells)


def contact(
    identifier: str, source: str, target: str, period: str, intensity: str
) -> str:
    return "\t".join(
        [identifier, source, target, "borrowing", period, "", "", "", intensity]
    )


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    write(
        lexicons,
        "languages.tsv",
        LANGUAGE_HEADER,
        language("fra", "French", "indo_european__italic"),
        language("eng", "English", "indo_european__germanic"),
        language("fin", "Finnish", "uralic__finnic"),
    )
    write(
        lexicons,
        "families.tsv",
        FAMILY_HEADER,
        "indo_european__italic\tItalic\t\t\tFamily\tEurope\t\t",
        "indo_european__germanic\tGermanic\t\t\tFamily\tEurope\t\t",
        "uralic__finnic\tFinnic\t\t\tFamily\tEurope\t\t",
    )
    write(
        lexicons,
        "language-contacts.tsv",
        CONTACT_HEADER,
        contact("lc-1", "fra", "eng", "1066-1400", "heavy"),
        contact("lc-2", "fin", "eng", "Bronze Age", "moderate"),
        contact("lc-3", "eng", "fra", "1800", "casual"),
    )
    return lexicons


# ── Sankey ───────────────────────────────────────────────────────────────────


def test_intensity_is_weighted_three_two_one(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    links = unbuilt_client.get("/api/visualizations/sankey").json()["links"]
    assert [link["value"] for link in links] == [3, 2, 1]


def test_nodes_are_minted_in_first_seen_order_and_carry_their_family(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    nodes = unbuilt_client.get("/api/visualizations/sankey").json()["nodes"]
    assert [node["id"] for node in nodes] == ["fra", "eng", "fin"]
    assert nodes[0] == {
        "id": "fra",
        "name": "French",
        "group": "indo_european__italic",
    }


def test_an_unknown_language_keeps_its_id_and_lands_in_the_unknown_group(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "language-contacts.tsv",
        CONTACT_HEADER,
        contact("lc-1", "xxx", "eng", "1200", "casual"),
    )
    nodes = unbuilt_client.get("/api/visualizations/sankey").json()["nodes"]
    assert nodes[0] == {"id": "xxx", "name": "xxx", "group": "unknown"}


def test_an_undated_contact_survives_the_year_filter(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """The filter can only reject a row it managed to date."""
    body = unbuilt_client.get(
        "/api/visualizations/sankey?yearStart=1500&yearEnd=1900"
    ).json()
    assert [link["timePeriod"] for link in body["links"]] == ["Bronze Age", "1800"]


def test_a_junk_bound_rejects_nothing(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/visualizations/sankey?yearStart=soon").json()
    assert len(body["links"]) == 3


def test_the_first_integer_of_the_period_is_the_year(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`1066-1400` dates as 1066, so a window opening at 1100 excludes it."""
    body = unbuilt_client.get("/api/visualizations/sankey?yearStart=1100").json()
    assert [link["timePeriod"] for link in body["links"]] == ["Bronze Age", "1800"]


# ── Cuisine sankey ───────────────────────────────────────────────────────────


@pytest.fixture
def cuisines(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    write(
        lexicons,
        "cuisines.tsv",
        CUISINE_HEADER,
        "peruvian\tPeruvian\t\tAndes\t\t\t\t\t\t\t\t\t\t",
        "chilean\tChilean\t\tAndes\t\t\t\t\t\t\t\t\t\t",
        "thai\tThai\t\tSoutheast Asia\t\t\t\t\t\t\t\t\t\t",
    )
    write(
        lexicons,
        "cuisine-items.tsv",
        ITEM_HEADER,
        "p-1\tperuvian\tCeviche\tSeafood\t\t",
        "c-1\tchilean\tCuranto\tSeafood\t\t",
        "t-1\tthai\tPla Nueng\tSeafood\t\t",
        "p-2\tperuvian\tLomo\tMain Dish\t\t",
        "orphan\tnowhere\tGhost\tSeafood\t\t",
    )
    return lexicons


def test_a_shared_food_type_links_every_pair_that_serves_it(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    links = unbuilt_client.get("/api/visualizations/cuisine-sankey").json()["links"]
    shared = {
        (link["source"], link["target"]): link
        for link in links
        if link["contactType"] == "shared_food_type"
    }
    assert set(shared) == {
        ("chilean", "peruvian"),
        ("peruvian", "thai"),
        ("chilean", "thai"),
    }
    assert shared[("chilean", "peruvian")]["timePeriod"] == "Seafood"


def test_an_item_of_an_unknown_cuisine_is_dropped(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    links = unbuilt_client.get("/api/visualizations/cuisine-sankey").json()["links"]
    assert all("nowhere" not in (link["source"], link["target"]) for link in links)


def test_the_regional_pass_never_overwrites_a_food_type_link(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    """Peru and Chile share both a region and a food type; the food type wins."""
    links = unbuilt_client.get("/api/visualizations/cuisine-sankey").json()["links"]
    andean = next(
        link
        for link in links
        if link["source"] == "chilean" and link["target"] == "peruvian"
    )
    assert andean["contactType"] == "shared_food_type"
    assert not any(link["contactType"] == "regional" for link in links)


def test_nodes_are_the_cuisines_grouped_by_region(
    unbuilt_client: TestClient, cuisines: Path
) -> None:
    nodes = unbuilt_client.get("/api/visualizations/cuisine-sankey").json()["nodes"]
    assert nodes[0] == {"id": "peruvian", "name": "Peruvian", "group": "Andes"}


# ── Chord ────────────────────────────────────────────────────────────────────


def matrix_of(body: dict[str, Any], row: str, column: str) -> Any:
    return body["matrix"][body["names"].index(row)][body["names"].index(column)]


def test_the_matrix_is_symmetric_and_counts_both_directions(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`fra→eng` weighs 3 and `eng→fra` weighs 1; each writes both cells."""
    body = unbuilt_client.get("/api/visualizations/chord").json()
    assert matrix_of(body, "Italic", "Germanic") == 4
    assert matrix_of(body, "Germanic", "Italic") == 4


def test_intra_family_contacts_are_skipped(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "language-contacts.tsv",
        CONTACT_HEADER,
        contact("lc-1", "fra", "fra", "1200", "heavy"),
    )
    body = unbuilt_client.get("/api/visualizations/chord").json()
    assert body == {"names": [], "matrix": []}


def test_a_family_the_corpus_lacks_is_named_by_its_id(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "families.tsv", FAMILY_HEADER, "uralic__finnic\tFinnic\t\t\t\t\t\t")
    body = unbuilt_client.get("/api/visualizations/chord").json()
    assert "indo_european__italic" in body["names"]
