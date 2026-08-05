"""The four `/api/search*` routes, over a seeded temp corpus.

What is graded here is the HTTP layer specifically: the four *different* answers
to "nothing to search for", the JavaScript number reading on `/spatial`, and the
statement that `/api/search` degrades to local-only when the in-process engine
has no corpus to read — which is the default state of a checkout that has not run
a build.

The service layers have their own suites (`test_global_search.py`,
`test_natural_search.py`); this file does not restate them.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    """Enough of a corpus for the search to have something to find."""
    lexicons = isolated_data_trees["lexicons"]
    files = {
        "languages.tsv": [
            "id\tname\tfamily_id\tstatus\tnative_name\tlatitude\tlongitude"
            "\ttime_origin\ttime_end",
            "sux\tSumerian\tsumerian\textinct\t\t31.0\t45.0\t-3100\t-100",
        ],
        "families.tsv": ["id\tname\ttaxonomic_level", "sumerian\tSumerian\tfamily"],
        # `words-base.tsv` is the one file whose absence raises, so it is not
        # optional here even though nothing below searches it.
        "words-base.tsv": ["number\tid_nelex\tgloss_en", "1\twater\twater"],
        "battles.tsv": [
            "id\tname\tdate\tcoordinates\twar_name\tsignificance",
            "kadesh\tBattle of Kadesh\t1274 BCE\t[36.5, 34.5]\tEgyptian-Hittite"
            "\tFirst recorded peace treaty",
        ],
    }
    for name, lines in files.items():
        (lexicons / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return lexicons


# ── The four empty-query answers ─────────────────────────────────────────────


def test_a_blank_global_search_answers_without_facets_or_filters(
    unbuilt_client: TestClient,
) -> None:
    """The route short-circuits; it never calls the service's blank-query path."""
    for url in ("/api/search", "/api/search?q=", "/api/search?q=%20%20"):
        assert unbuilt_client.get(url).json() == {
            "results": [],
            "query": "",
            "totalCount": 0,
        }


def test_a_blank_natural_search_answers_with_an_empty_parse(
    unbuilt_client: TestClient,
) -> None:
    assert unbuilt_client.get("/api/search/natural").json() == {
        "results": [],
        "query": {"raw": ""},
        "totalCount": 0,
    }


def test_blank_suggestions_are_an_empty_list_not_an_error(
    unbuilt_client: TestClient,
) -> None:
    assert unbuilt_client.get("/api/search/suggestions").json() == {"suggestions": []}


@pytest.mark.parametrize(
    "query", ["", "?lat=1", "?lng=1", "?lat=&lng=", "?lat=abc&lng=2"]
)
def test_spatial_search_requires_two_numeric_coordinates(
    unbuilt_client: TestClient, query: str
) -> None:
    response = unbuilt_client.get(f"/api/search/spatial{query}")
    assert response.status_code == 400
    assert response.json() == {
        "message": "lat and lng are required numeric parameters"
    }


# ── The routes over a corpus ─────────────────────────────────────────────────


def test_global_search_answers_the_seeded_corpus(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/search?q=sumer").json()
    assert body["query"] == "sumer"
    assert {result["entityType"] for result in body["results"]} == {
        "language",
        "language-family",
    }
    assert body["facets"]["source"] == [{"value": "local", "count": 2}]
    assert body["filters"] == {}


def test_global_search_degrades_to_local_only_with_no_engine_corpus(
    unbuilt_client: TestClient, corpus: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A checkout that has never built `build/corpus` still gets its results."""
    monkeypatch.setenv("PINAKES_ENGINE_CORPUS", "/nonexistent/corpus")
    body = unbuilt_client.get("/api/search?q=sumer").json()
    assert body["totalCount"] == 2
    assert all(result["source"] == "local" for result in body["results"])


def test_the_filter_params_are_echoed_and_applied(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get(
        "/api/search?q=sumer&types=language&sources=local,nonsense"
    ).json()
    assert body["filters"] == {"entityTypes": ["language"], "sources": ["local"]}
    assert [result["entityType"] for result in body["results"]] == ["language"]
    # Facets still describe the whole match set, so the chips do not move.
    assert body["facets"]["entityType"] == [
        {"value": "language", "count": 1},
        {"value": "language-family", "count": 1},
    ]


def test_natural_search_parses_and_answers(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get(
        "/api/search/natural?q=What languages were spoken in Mesopotamia?"
    ).json()
    assert body["query"]["entityType"] == "language"
    assert body["query"]["locationName"] == "mesopotamia"
    assert [result["id"] for result in body["results"]] == ["sux"]


def test_spatial_search_reads_its_numbers_the_javascript_way(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`parseFloat` is a *prefix* parse — `lat=31abc` is 31, not a 400."""
    body = unbuilt_client.get("/api/search/spatial?lat=31abc&lng=45").json()
    assert body["query"]["coordinates"] == {"lat": 31.0, "lng": 45.0}
    assert [result["id"] for result in body["results"]] == ["sux"]


def test_an_unparseable_year_is_no_year_filter_rather_than_a_400(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/search/spatial?lat=31&lng=45&year=abc").json()
    assert body["query"]["year"] is None
    assert [result["id"] for result in body["results"]] == ["sux"]


def test_the_radius_narrows_the_search(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    near = unbuilt_client.get("/api/search/spatial?lat=31&lng=45&radius=200").json()
    far = unbuilt_client.get("/api/search/spatial?lat=0&lng=0&radius=1").json()
    assert near["totalCount"] == 1
    assert far["totalCount"] == 0
    assert far["query"]["radiusKm"] == 1


def test_suggestions_answer_a_partial_query(unbuilt_client: TestClient) -> None:
    body = unbuilt_client.get("/api/search/suggestions?q=what").json()
    assert "What civilizations existed in 3000 BCE?" in body["suggestions"]
    assert len(body["suggestions"]) <= 8


def test_a_corpus_with_no_words_base_is_a_500_not_an_empty_search(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """``readFileOrThrow``, carried across — see `lexicons.storage.load_base_words`.

    The empty lexicons tree `conftest.py` hands every test has no
    `words-base.tsv`, so this is the default state rather than a contrivance.
    """
    response = unbuilt_client.get("/api/search?q=sumer")
    assert response.status_code == 500
    assert response.json()["message"] == "Failed to perform search"
