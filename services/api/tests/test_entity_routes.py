"""`server/routes/entity-resolver.test.ts` + its service suite, case for case.

`server/services/entity-resolver.ts` stays as the graded spec, so the pure half
below is that file's suite — the registry, the `cs:` id format, the path
round-trip — and the route half is driven against a **seeded temp corpus**, the
same seam `conftest.py`'s autouse `isolated_data_trees` gives every test.

Both Express routes keep answering during the cutover (their fixtures are
replayed against that app), so one test here is specifically the statement that
the two agree on the registry a client reads.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes.lexicons import entity

# ── The pure registry ────────────────────────────────────────────────────────


def test_every_domain_declares_a_label_and_a_graph_node_type() -> None:
    for domain, spec in entity.ENTITY_DOMAINS.items():
        assert spec.label, domain
        assert spec.entity_type, domain


def test_only_the_four_citable_domains_carry_a_citation_domain() -> None:
    """And the citation segment is **plural**, unlike the entity domain."""
    citable = {
        domain: spec.citation_domain
        for domain, spec in entity.ENTITY_DOMAINS.items()
        if spec.citable
    }
    assert citable == {
        "civilization": "civilizations",
        "culture-profile": "culture-profiles",
        "archaeological-site": "archaeological-sites",
        "deity": "deities",
    }


def test_two_domains_share_one_graph_node_type() -> None:
    """`cs:` names the canonical *node* type, not the URL domain."""
    assert entity.stable_entity_id("civilization", "rome") == "cs:culture:rome"
    assert entity.stable_entity_id("culture-profile", "rome") == "cs:culture:rome"
    assert entity.stable_entity_id("archaeological-site", "troy") == "cs:place:troy"


def test_a_canonical_path_round_trips_through_the_parser() -> None:
    for domain in entity.entity_domains():
        path = entity.canonical_entity_path(domain, "an id/with slash")
        assert entity.parse_canonical_entity_path(path) == (domain, "an id/with slash")


@pytest.mark.parametrize(
    "path",
    [
        "https://pinakes.example/entity/language/cmn",
        "/entity/language/cmn/",
        "/entity/language/cmn?tab=map",
        "/entity/language/cmn#top",
    ],
)
def test_the_parser_tolerates_an_origin_a_slash_and_a_query(path: str) -> None:
    assert entity.parse_canonical_entity_path(path) == ("language", "cmn")


@pytest.mark.parametrize(
    "path",
    ["", "/entity/dragons/smaug", "/entity/language", "/entity/language/", "/other/x"],
)
def test_an_unresolvable_path_is_none_never_an_error(path: str) -> None:
    """The caller 404s gracefully; it never has to catch."""
    assert entity.parse_canonical_entity_path(path) is None


def test_a_descriptor_is_relative_without_an_origin_and_absolute_with_one() -> None:
    record = entity.EntityRecordLite(id="cmn", name="Mandarin", region="China")
    relative = entity.describe_entity("language", record)
    absolute = entity.describe_entity("language", record, "https://pinakes.example")
    assert relative["canonicalUrl"] == "/entity/language/cmn"
    assert absolute["canonicalUrl"] == "https://pinakes.example/entity/language/cmn"
    assert relative["canonicalPath"] == absolute["canonicalPath"]


def test_only_culture_profiles_have_a_richer_view() -> None:
    with_view = {
        domain
        for domain, spec in entity.ENTITY_DOMAINS.items()
        if spec.view_path is not None
    }
    assert with_view == {"culture-profile"}
    described = entity.describe_entity(
        "culture-profile", entity.EntityRecordLite(id="cp 1", name="One")
    )
    assert described["viewPath"] == "/culture-profile/cp%201/report"


# ── The routes, over a seeded corpus ─────────────────────────────────────────


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    """One row per entity domain, in the temp lexicons tree."""
    lexicons = isolated_data_trees["lexicons"]
    files = {
        "languages.tsv": [
            "id\tname\tfamily_id\tstatus\tregion",
            "cmn\tMandarin\tsino_tibetan\tliving\tChina",
        ],
        "families.tsv": [
            "id\tname\ttaxonomic_level",
            "sino_tibetan\tSino-Tibetan\tfamily",
        ],
        "civilizations.tsv": [
            "id\tname\ttime_period_start",
            "rome\tRome\t-753",
        ],
        "culture-profiles.tsv": [
            "id\tname\tregion\ttime_period_start",
            "cp-sumerian\tSumerian\tMesopotamia\t-4500",
        ],
        "archaeological-sites.tsv": [
            "id\tname\tcoordinates\tsite_type\ttime_period_start",
            'troy\tTroy\t{"lat": 39.9, "lng": 26.2}\tsettlement\t-3000',
        ],
        "deities.tsv": [
            "id\tname\tmythology\ttime_origin",
            "zeus\tZeus\tGreek\t-800",
        ],
        "religions.tsv": [
            "id\tname\torigin_region",
            "hinduism\tHinduism\tSouth Asia",
        ],
        "cuisines.tsv": ["id\tname\tregion", "chinese\tChinese\tEast Asia"],
        "trade-goods.tsv": [
            "id\tname\tcategory\torigin_region\torigin_coordinates\ttrade_routes"
            "\ttime_period\teconomic_significance\tassociated_languages",
            "tg-001\tSilk\ttextile\tChina\t\t[]\t-3000 to 1500\thigh\t[]",
        ],
        "writing-systems.tsv": ["id\tname\ttype", "ws_001\tCuneiform\tlogographic"],
        "battles.tsv": ["id\tname\tdate", "kadesh\tBattle of Kadesh\t-1274"],
        "urheimat-hypotheses.tsv": [
            "id\tlanguage_family_id\thypothesis_name\tproposed_region"
            "\tproposed_coordinates\tproposed_boundary\ttime_range_start"
            "\ttime_range_end\tsupporting_evidence\tcompeting_hypotheses"
            "\tscholarly_consensus_level\tkey_proponents\tsources",
            "ie-steppe\tindo_european\tSteppe hypothesis\tPontic Steppe"
            "\t\t\t-4500\t-2500\t\t[]\t80\t[]\t[]",
        ],
    }
    for name, lines in files.items():
        (lexicons / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return lexicons


def test_the_index_lists_every_domain_and_the_url_template(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.get("/api/entities").json()
    assert body["pathTemplate"] == "/entity/:domain/:id"
    assert [domain["domain"] for domain in body["domains"]] == entity.entity_domains()
    civilization = next(d for d in body["domains"] if d["domain"] == "civilization")
    assert civilization == {
        "domain": "civilization",
        "label": "Civilization",
        "entityType": "culture",
        "citable": True,
    }


@pytest.mark.parametrize(
    ("domain", "identifier", "name"),
    [
        ("language", "cmn", "Mandarin"),
        ("language-family", "sino_tibetan", "Sino-Tibetan"),
        ("civilization", "rome", "Rome"),
        ("culture-profile", "cp-sumerian", "Sumerian"),
        ("archaeological-site", "troy", "Troy"),
        ("deity", "zeus", "Zeus"),
        ("religion", "hinduism", "Hinduism"),
        ("cuisine", "chinese", "Chinese"),
        ("trade-good", "tg-001", "Silk"),
        ("writing-system", "ws_001", "Cuneiform"),
        ("battle", "kadesh", "Battle of Kadesh"),
        ("urheimat-hypothesis", "ie-steppe", "Steppe hypothesis"),
    ],
)
def test_every_domain_resolves_a_real_row(
    unbuilt_client: TestClient,
    corpus: Path,
    domain: str,
    identifier: str,
    name: str,
) -> None:
    """Every fetcher reads a *different* file and a different name column."""
    body = unbuilt_client.get(f"/api/entity/{domain}/{identifier}").json()
    assert body["name"] == name
    assert body["domain"] == domain
    assert body["canonicalPath"] == f"/entity/{domain}/{identifier}"
    assert body["stableId"].startswith("cs:")


def test_the_canonical_url_is_absolute_against_the_request(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/entity/language/cmn").json()
    assert body["canonicalUrl"] == "http://testserver/entity/language/cmn"


def test_a_forwarded_proto_wins_over_the_connection_scheme(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Behind a terminating proxy the minted URL has to say `https`."""
    body = unbuilt_client.get(
        "/api/entity/language/cmn", headers={"x-forwarded-proto": "https,http"}
    ).json()
    assert body["canonicalUrl"] == "https://testserver/entity/language/cmn"


def test_a_region_and_a_year_are_projected_where_the_domain_has_them(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    language = unbuilt_client.get("/api/entity/language/cmn").json()
    profile = unbuilt_client.get("/api/entity/culture-profile/cp-sumerian").json()
    assert (language["region"], language["year"]) == ("China", None)
    assert (profile["region"], profile["year"]) == ("Mesopotamia", -4500)


def test_a_religion_resolves_with_no_region(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """The fetcher reads `region`, which a religion record calls `originRegion`.

    Reproduced from Express rather than fixed — see `pinakes.lexicons.entity`.
    """
    assert unbuilt_client.get("/api/entity/religion/hinduism").json()["region"] is None


def test_a_citable_domain_names_its_plural_citation_segment(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """The client passes `citationDomain` to `/api/citations`, not `domain`."""
    body = unbuilt_client.get("/api/entity/deity/zeus").json()
    assert (body["citable"], body["citationDomain"]) == (True, "deities")
    language = unbuilt_client.get("/api/entity/language/cmn").json()
    assert (language["citable"], language["citationDomain"]) == (False, None)


def test_an_unknown_domain_404s_and_lists_the_domains(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/entity/dragons/smaug")
    assert response.status_code == 404
    body = response.json()
    assert body["error"] == "Unknown entity domain"
    assert body["domains"] == entity.entity_domains()


def test_an_unknown_id_404s_without_listing_anything(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """A renamed entity and a mistyped URL read the same to a bookmark."""
    response = unbuilt_client.get("/api/entity/language/__nope__")
    assert response.status_code == 404
    assert response.json() == {
        "error": "Not found",
        "detail": 'No language with id "__nope__"',
    }


def test_an_empty_corpus_404s_rather_than_500ing(unbuilt_client: TestClient) -> None:
    """`conftest.py` gives every test an empty lexicons tree; that is not an error."""
    assert unbuilt_client.get("/api/entity/language/cmn").status_code == 404


def test_a_broken_corpus_file_is_a_500_naming_the_column(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """A file that has lost its `id` column is broken, not empty."""
    (isolated_data_trees["lexicons"] / "deities.tsv").write_text(
        "name\tmythology\nZeus\tGreek\n", encoding="utf-8"
    )
    response = unbuilt_client.get("/api/entity/deity/zeus")
    assert response.status_code == 500
    assert response.json()["error"] == "entity resolution failed"
    assert "id" in response.json()["detail"]
