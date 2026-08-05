"""`server/routes/summaries.test.ts` + `entity-summary.test.ts`, case for case.

`server/services/entity-summary.ts` stays as the graded spec, so the pure half
below is that suite: the projection, the pagination, and the **subset
property** — every summary field is a real field of the detail record — which
the retired Express detail test used to assert against a fixture and which is
asserted here against the *live* corpus, where a ragged row can actually break
it.

The route half runs over the temp lexicons tree `conftest.py` installs, plus one
live-corpus case per domain so a contract field that no longer exists in the TSV
is caught by the reader that serves it.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contracts_dir

from pinakes.lexicons import summary

LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"

LANGUAGES = [
    "id\tname\tfamily_id\tstatus\tnative_name\tiso639_1\tregion",
    "cmn\tMandarin\tsino_tibetan\tliving\t普通话\tzh\tChina",
    "eng\tEnglish\tindo_european\tliving\tEnglish\ten\tGlobal",
    "lat\tLatin\tindo_european\textinct\tLingua Latina\tla\tItaly",
]


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "languages.tsv").write_text("\n".join(LANGUAGES) + "\n", "utf-8")
    return lexicons


# ── The pure projection ──────────────────────────────────────────────────────


def test_every_contract_leads_with_id_and_name() -> None:
    """So every summary is both renderable and hydratable."""
    for domain in summary.summary_domains():
        assert summary.summary_fields(domain)[:2] == ["id", "name"]


def test_a_field_the_record_lacks_is_omitted_not_nulled() -> None:
    """Inventing a key the detail record has not got would break the subset."""
    projected = summary.summarize_entity("languages", {"id": "x", "name": "X"})
    assert projected == {"id": "x", "name": "X"}


def test_the_projection_is_in_contract_order_not_record_order() -> None:
    record = {"status": "living", "name": "X", "id": "x"}
    assert list(summary.summarize_entity("languages", record)) == [
        "id",
        "name",
        "status",
    ]


def test_civilizations_have_no_summary_contract() -> None:
    """They are GeoJSON features; the map bbox API is that layer's read path."""
    assert not summary.is_summary_domain("civilizations")


@pytest.mark.parametrize(
    ("offset", "limit", "ids", "has_more"),
    [
        (None, None, ["a", "b", "c"], False),
        (None, 2, ["a", "b"], True),
        (1, 2, ["b", "c"], False),
        (2, None, ["c"], False),
        (99, 2, [], False),
        (-5, None, ["a", "b", "c"], False),
        (None, 0, [], True),
        (0.9, 1.9, ["a"], True),
    ],
)
def test_pagination_is_total_over_any_input(
    offset: float | None, limit: float | None, ids: list[str], has_more: bool
) -> None:
    """Any offset/limit yields a valid, bounded page — never an error."""
    records = [{"id": name, "name": name.upper()} for name in ("a", "b", "c")]
    page = summary.summarize_list("languages", records, offset, limit)
    assert [row["id"] for row in page["summaries"]] == ids
    assert page["total"] == 3
    assert page["returned"] == len(ids)
    assert page["hasMore"] is has_more


def test_an_unbounded_page_reports_a_null_limit() -> None:
    page = summary.summarize_list("languages", [{"id": "a", "name": "A"}])
    assert page["limit"] is None
    assert page["hasMore"] is False


# ── The routes ───────────────────────────────────────────────────────────────


def test_the_index_is_the_machine_readable_contract(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.get("/api/summaries").json()
    assert [row["domain"] for row in body["domains"]] == summary.summary_domains()
    languages = body["domains"][0]
    assert languages["detailEndpoint"] == "/api/languages/:id"
    assert languages["fields"] == summary.summary_fields("languages")
    # The loader is an implementation detail of the contract, not part of it.
    assert set(languages) == {"domain", "detailEndpoint", "fields"}


def test_a_page_carries_the_contract_beside_the_rows(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/summaries/languages?limit=2").json()
    assert body["domain"] == "languages"
    assert body["fields"] == summary.summary_fields("languages")
    assert body["detailEndpoint"] == "/api/languages/:id"
    assert [row["id"] for row in body["summaries"]] == ["cmn", "eng"]
    assert (body["total"], body["returned"], body["hasMore"]) == (3, 2, True)


def test_a_summary_row_carries_only_contract_fields(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    row = unbuilt_client.get("/api/summaries/languages?limit=1").json()["summaries"][0]
    assert set(row) <= set(summary.summary_fields("languages"))
    assert "countries" not in row  # a detail field, deliberately not projected


def test_an_unparseable_limit_is_the_default_page_not_a_422(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """A declared `int` parameter would answer 422 — a different contract.

    Note this is the *third* spelling of the rule in this service: the
    contribution queue collapses the page to empty and `/api/changelog` restores
    its own default. Here an unparseable bound means "no limit".
    """
    body = unbuilt_client.get("/api/summaries/languages?limit=abc&offset=xyz").json()
    assert body["returned"] == 3
    assert body["limit"] is None
    assert body["offset"] == 0


def test_a_present_but_empty_bound_is_unstated(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`Number("")` is `0`, which would be a very different page for a limit."""
    body = unbuilt_client.get("/api/summaries/languages?limit=&offset=").json()
    assert body["returned"] == 3
    assert body["limit"] is None


def test_the_detail_route_returns_the_full_unprojected_record(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/summaries/languages/cmn").json()
    assert body["countries"] == []
    assert body["nativeName"] == "普通话"
    for field in summary.summary_fields("languages"):
        assert field in body


def test_the_two_steps_are_lossless(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Every value in the summary is the same value in the detail record."""
    row = unbuilt_client.get("/api/summaries/languages?limit=1").json()["summaries"][0]
    detail = unbuilt_client.get(f"/api/summaries/languages/{row['id']}").json()
    assert all(detail[field] == value for field, value in row.items())


@pytest.mark.parametrize("path", ["/api/summaries/dragons", "/api/summaries/dragons/x"])
def test_an_unknown_domain_404s_and_lists_the_domains(
    unbuilt_client: TestClient, path: str
) -> None:
    response = unbuilt_client.get(path)
    assert response.status_code == 404
    body = response.json()
    assert body["error"] == "Unknown summary domain"
    assert body["domains"] == summary.summary_domains()


def test_an_unknown_id_404s(unbuilt_client: TestClient, corpus: Path) -> None:
    response = unbuilt_client.get("/api/summaries/languages/__nope__")
    assert response.status_code == 404
    assert response.json()["error"] == "Not found"


def test_an_empty_corpus_is_an_empty_page_not_an_error(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.get("/api/summaries/languages").json()
    assert body["total"] == 0
    assert body["summaries"] == []


def test_a_broken_corpus_file_is_a_500(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`trade-goods.tsv` is the one domain that reads every column with `getIdx`."""
    (isolated_data_trees["lexicons"] / "trade-goods.tsv").write_text(
        "id\tname\ntg\tSilk\n", encoding="utf-8"
    )
    response = unbuilt_client.get("/api/summaries/trade-goods")
    assert response.status_code == 500
    assert response.json()["error"] == "summary listing failed"


# ── Against the live corpus ──────────────────────────────────────────────────


@pytest.mark.parametrize("domain", list(summary.SUMMARY_CONTRACTS))
def test_every_summary_field_exists_on_the_live_records(domain: str) -> None:
    """The subset property, where it can actually break.

    A contract field the corpus stopped carrying would silently vanish from
    every summary row — the projection omits what it cannot find — so the list
    would keep 200ing while the client rendered blanks.
    """
    records = summary.SUMMARY_CONTRACTS[domain].load(LIVE_LEXICONS)
    assert records, f"{domain} loaded no rows from the live corpus"
    missing = [
        field
        for field in summary.summary_fields(domain)
        if field not in records[0]
    ]
    assert not missing, f"{domain} summary names fields no record has: {missing}"
