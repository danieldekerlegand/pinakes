"""Behaviour of the ported `/api/citations` group (pinakes:61 US-2).

`server/routes/citations.test.ts` drove the route with injectable in-memory
fetchers, so it never exercised the corpus reading at all. That reading is the
half most likely to drift, so these tests seed real lexicon TSVs in the
temp-directory corpus (`isolated_data_trees["lexicons"]`) and go through the
whole path — file to row to `CitableEntity` to rendered document.

The pure rendering itself is graded next door in `test_citation_export.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


def write_tsv(
    directory: Path, filename: str, header: list[str], *rows: list[str]
) -> None:
    """Write one lexicon file, in the corpus's tab-separated shape."""
    directory.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header), *("\t".join(row) for row in rows)]
    (directory / filename).write_text("\n".join(lines) + "\n", encoding="utf-8")


def seed_culture_profiles(lexicons: Path) -> None:
    write_tsv(
        lexicons,
        "culture-profiles.tsv",
        ["id", "name", "region", "time_period_start", "sources"],
        [
            "minoan",
            "Minoan Civilization",
            "Crete",
            "-2000",
            json.dumps(["Evans 1921", "Archaeological evidence"]),
        ],
        ["unsourced", "Unsourced Culture", "", "", ""],
    )


# ── The index ────────────────────────────────────────────────────────────────


def test_the_index_lists_the_citable_domains_and_formats(
    unbuilt_client: TestClient,
) -> None:
    """The route with a recorded fixture (`get-citations-index`), and the one
    route in this group Express still answers too."""
    body = unbuilt_client.get("/api/citations").json()
    assert body["domains"] == [
        "culture-profiles",
        "civilizations",
        "deities",
        "archaeological-sites",
    ]
    assert body["formats"] == ["bibtex", "ris", "csljson"]


# ── BibTeX, the default ──────────────────────────────────────────────────────


def test_bibtex_is_the_default_and_downloads_as_an_attachment(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_culture_profiles(isolated_data_trees["lexicons"])
    response = unbuilt_client.get("/api/citations/culture-profiles/minoan")
    assert response.status_code == 200
    assert "application/x-bibtex" in response.headers["content-type"]
    disposition = response.headers["content-disposition"]
    assert disposition == 'attachment; filename="minoan.bib"'

    text = response.text
    assert "@misc{pinakes-culture-profile-minoan," in text
    assert "title = {Minoan Civilization}" in text
    assert "year = {-2000}" in text
    assert "note = {pinakes culture profile record; region: Crete}" in text
    # One entry per source, keyed by author + year where one could be recovered.
    assert "@misc{minoan-evans-1921," in text
    assert "author = {Evans}" in text
    # A source that gives up neither an author nor a year keys on the entity
    # stem alone — the index-suffixed fallback is only for a collision.
    assert "@misc{minoan,\n  title = {Archaeological evidence}" in text


def test_the_entity_url_is_built_from_the_request_host(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_culture_profiles(isolated_data_trees["lexicons"])
    text = unbuilt_client.get("/api/citations/culture-profiles/minoan").text
    assert "url = {http://testserver/culture-profile/minoan}" in text


def test_a_forwarded_proto_wins_over_the_connection_scheme(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """Behind a terminating proxy the citation must say `https`, or every
    downloaded `.bib` points at a URL the reader cannot follow."""
    seed_culture_profiles(isolated_data_trees["lexicons"])
    text = unbuilt_client.get(
        "/api/citations/culture-profiles/minoan",
        headers={"x-forwarded-proto": "https,http"},
    ).text
    assert "url = {https://testserver/culture-profile/minoan}" in text


def test_an_entity_with_no_sources_still_yields_a_citation(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The reason every export leads with a record entry: a sourceless entity is
    the common case in a growing corpus, and it must still be citable."""
    seed_culture_profiles(isolated_data_trees["lexicons"])
    text = unbuilt_client.get("/api/citations/culture-profiles/unsourced").text
    assert text.count("@misc{") == 1
    assert "howpublished = {pinakes cultural dataset}" in text
    # No region cell, so the note carries the record descriptor alone.
    assert "note = {pinakes culture profile record}" in text
    assert "year = " not in text


# ── The other two formats ────────────────────────────────────────────────────


def test_ris_renders_the_record_as_a_data_type(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_culture_profiles(isolated_data_trees["lexicons"])
    response = unbuilt_client.get(
        "/api/citations/culture-profiles/minoan?format=ris"
    )
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="minoan.ris"'
    )
    assert response.text.startswith("TY  - DATA\nTI  - Minoan Civilization\n")
    assert "AU  - Evans" in response.text


def test_csljson_is_valid_json_with_the_record_item_first(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_culture_profiles(isolated_data_trees["lexicons"])
    response = unbuilt_client.get(
        "/api/citations/culture-profiles/minoan?format=csljson"
    )
    items = response.json()
    assert len(items) == 3
    assert items[0]["type"] == "dataset"
    assert items[0]["publisher"] == "pinakes cultural dataset"
    assert items[0]["issued"] == {"date-parts": [[-2000]]}
    assert items[1] == {
        "id": "minoan-evans-1921",
        "type": "document",
        "title": "Evans",
        "author": [{"family": "Evans"}],
        "issued": {"date-parts": [[1921]]},
        "note": "Source cited for Minoan Civilization",
    }


# ── The other three domains ──────────────────────────────────────────────────


def test_a_civilization_is_read_out_of_its_own_columns(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_tsv(
        isolated_data_trees["lexicons"],
        "civilizations.tsv",
        ["id", "name", "time_period_start", "sources"],
        ["sumer", "Sumer", "-4500", json.dumps(["Kramer 1963"])],
        ["undated", "Undated Polity", "", "[]"],
    )
    text = unbuilt_client.get("/api/citations/civilizations/sumer").text
    assert "@misc{pinakes-civilization-sumer," in text
    assert "year = {-4500}" in text
    assert "@misc{sumer-kramer-1963," in text


def test_an_undated_civilization_cites_year_zero(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """Not "no year": the loader this reads off defaults a civilization's time
    period to zero, and a citation that quietly dropped the field would disagree
    with every other view of the same record."""
    write_tsv(
        isolated_data_trees["lexicons"],
        "civilizations.tsv",
        ["id", "name", "time_period_start", "sources"],
        ["undated", "Undated Polity", "", "[]"],
    )
    body = unbuilt_client.get("/api/citations/civilizations/undated").text
    assert "year = {0}" in body


def test_a_civilizations_boundary_row_supplies_a_missing_start(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    write_tsv(
        lexicons,
        "civilizations.tsv",
        ["id", "name", "time_period_start", "sources"],
        ["hittite", "Hittite Empire", "", "[]"],
    )
    write_tsv(
        lexicons,
        "civilization-boundaries.tsv",
        ["civilization_id", "geometry", "time_period_start"],
        ["hittite", json.dumps({"type": "Polygon", "coordinates": []}), "-1600"],
    )
    assert "year = {-1600}" in unbuilt_client.get(
        "/api/citations/civilizations/hittite"
    ).text


def test_a_boundary_row_without_a_shape_is_not_a_boundary(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    write_tsv(
        lexicons,
        "civilizations.tsv",
        ["id", "name", "time_period_start", "sources"],
        ["hittite", "Hittite Empire", "", "[]"],
    )
    write_tsv(
        lexicons,
        "civilization-boundaries.tsv",
        ["civilization_id", "geometry", "time_period_start"],
        ["hittite", "", "-1600"],
    )
    assert "year = {0}" in unbuilt_client.get(
        "/api/citations/civilizations/hittite"
    ).text


def test_a_deitys_region_is_its_mythology(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_tsv(
        isolated_data_trees["lexicons"],
        "deities.tsv",
        ["id", "name", "mythology", "time_origin", "sources"],
        ["inanna", "Inanna", "Sumerian", "-3500", json.dumps(["Hesiod Theogony"])],
    )
    text = unbuilt_client.get("/api/citations/deities/inanna").text
    assert "note = {pinakes deity record; region: Sumerian}" in text
    assert "year = {-3500}" in text


def test_a_deity_file_using_the_older_pantheon_column_still_reads(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_tsv(
        isolated_data_trees["lexicons"],
        "deities.tsv",
        ["id", "name", "pantheon", "sources"],
        ["thor", "Thor", "Norse", "[]"],
    )
    assert "region: Norse" in unbuilt_client.get("/api/citations/deities/thor").text


def test_an_archaeological_site_needs_coordinates_to_exist_at_all(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The loader filters coordinate-less rows out before anything can find
    them, so their citation is a 404. Odd, but it is the contract, and it is the
    same answer the map gives for the same row."""
    write_tsv(
        isolated_data_trees["lexicons"],
        "archaeological-sites.tsv",
        ["id", "name", "coordinates", "site_type", "time_period_start", "sources"],
        [
            "catalhoyuk",
            "Çatalhöyük",
            json.dumps({"lat": 37.6, "lng": 32.8}),
            "settlement",
            "-7500",
            json.dumps(["Hodder 2006"]),
        ],
        ["nowhere", "Nowhere", "", "settlement", "-100", "[]"],
    )
    found = unbuilt_client.get("/api/citations/archaeological-sites/catalhoyuk")
    assert found.status_code == 200
    assert "title = {Çatalhöyük}" in found.text
    assert (
        found.headers["content-disposition"]
        == 'attachment; filename="catalhoyuk.bib"'
    )

    assert (
        unbuilt_client.get("/api/citations/archaeological-sites/nowhere").status_code
        == 404
    )


# ── Refusals ─────────────────────────────────────────────────────────────────


def test_an_unknown_domain_is_a_404_that_names_the_known_ones(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/citations/dragons/smaug")
    assert response.status_code == 404
    body = response.json()
    assert body["error"] == "Unknown citation domain"
    assert body["detail"] == 'No citations for "dragons"'
    assert "deities" in body["domains"]


def test_an_unknown_format_is_a_400_that_names_the_known_ones(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """400 rather than 404: the entity exists, the request for it did not."""
    seed_culture_profiles(isolated_data_trees["lexicons"])
    response = unbuilt_client.get("/api/citations/culture-profiles/minoan?format=mla")
    assert response.status_code == 400
    body = response.json()
    assert body["error"] == "Unknown citation format"
    assert body["detail"] == "Expected one of bibtex, ris, csljson"
    assert body["formats"] == ["bibtex", "ris", "csljson"]


def test_the_format_is_checked_before_the_entity_is_fetched(
    unbuilt_client: TestClient,
) -> None:
    """With no corpus at all this is still the 400, not the 404 — which is what
    tells a caller their `?format=` is the problem."""
    response = unbuilt_client.get("/api/citations/deities/nobody?format=mla")
    assert response.status_code == 400


def test_an_unknown_id_is_a_404(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed_culture_profiles(isolated_data_trees["lexicons"])
    response = unbuilt_client.get("/api/citations/culture-profiles/atlantis")
    assert response.status_code == 404
    assert response.json() == {
        "error": "Not found",
        "detail": 'No culture-profiles with id "atlantis"',
    }


def test_an_absent_lexicon_file_is_an_empty_domain_not_a_500(
    unbuilt_client: TestClient,
) -> None:
    assert (
        unbuilt_client.get("/api/citations/culture-profiles/minoan").status_code == 404
    )


def test_a_lexicon_missing_a_required_column_is_a_500(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """A corpus that has lost its `name` column is broken, not empty. Answering
    404 would read as "no such entity" and send someone looking in the wrong
    place."""
    write_tsv(
        isolated_data_trees["lexicons"],
        "deities.tsv",
        ["id", "sources"],
        ["inanna", "[]"],
    )
    response = unbuilt_client.get("/api/citations/deities/inanna")
    assert response.status_code == 500
    assert response.json()["error"] == "citation export failed"
    assert "name" in response.json()["detail"]
