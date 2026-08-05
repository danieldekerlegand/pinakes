"""`GET /api/word-comparisons` and `GET /api/languages/{id}/word-list`.

Fixture-free routes, so this file is the grading. The pagination cases are the
reason it exists: `?limit=` decides the response's *type*, and three of the four
junk-parameter answers are counter-intuitive enough that a reimplementation
would get them wrong in a way no shape check would catch. Every expectation was
diffed against the live Express app.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


@pytest.fixture
def words(corpus: Path) -> Path:
    write(
        corpus,
        "words-base.tsv",
        "number\tid_nelex\tgloss_en",
        "1\tAuge::N\teye",
        "2\tOhr::N\tear",
        "3\tNase::N\tnose",
        "4\tMund::N\tmouth",
    )
    write(
        corpus,
        "words.tsv",
        "Language_ID\tConcept_ID\tWord_Form\tIPA",
        "fin\tAuge::N\tsilmä\ts i l m æ",
        "fin\tOhr::N\tkorva\t",
        "fin\tNase::N\tnenä\tn ɛ n æ",
        "est\tAuge::N\tsilm\ts i l m",
        "hun\tMund::N\tszáj\t",
    )
    return corpus


# ── Word comparisons ─────────────────────────────────────────────────────────


def test_no_languages_parameter_is_a_400(
    unbuilt_client: TestClient, words: Path
) -> None:
    for url in ("/api/word-comparisons", "/api/word-comparisons?languages="):
        response = unbuilt_client.get(url)
        assert response.status_code == 400, url
        assert response.json() == {"message": "Languages parameter is required"}


def test_a_comma_joined_list_is_one_language_not_two(
    unbuilt_client: TestClient, words: Path
) -> None:
    """Express never splits on a comma — `Array.isArray(q) ? q : [q]`. The array
    form is the *repeated* parameter, which is why the handler reads `getlist`.
    A client that sends `?languages=fin,est` gets the "at least 2" refusal."""
    response = unbuilt_client.get("/api/word-comparisons?languages=fin,est")
    assert response.status_code == 400
    assert response.json() == {
        "message": "At least 2 languages are required for comparison"
    }


def test_one_language_is_a_400_but_two_blank_ones_are_an_empty_list(
    unbuilt_client: TestClient, words: Path
) -> None:
    """`["", ""]` is a truthy array of length two, so it passes both guards and
    then matches nothing. Both servers answer `[]` rather than a 400."""
    assert unbuilt_client.get("/api/word-comparisons?languages=fin").status_code == 400
    blank = unbuilt_client.get("/api/word-comparisons?languages=&languages=")
    assert blank.status_code == 200
    assert blank.json() == []


def test_a_concept_no_selected_language_attests_is_dropped_entirely(
    unbuilt_client: TestClient, words: Path
) -> None:
    """And `translations` carries only the languages that have a form, so the
    key set varies row to row."""
    body = unbuilt_client.get(
        "/api/word-comparisons?languages=fin&languages=est"
    ).json()
    assert body == [
        {
            "baseWord": "eye",
            "conceptId": "Auge::N",
            "translations": {
                "fin": {"form": "silmä", "ipa": "s i l m æ"},
                "est": {"form": "silm", "ipa": "s i l m"},
            },
        },
        {
            "baseWord": "ear",
            "conceptId": "Ohr::N",
            "translations": {"fin": {"form": "korva", "ipa": None}},
        },
        {
            "baseWord": "nose",
            "conceptId": "Nase::N",
            "translations": {"fin": {"form": "nenä", "ipa": "n ɛ n æ"}},
        },
    ]


def test_an_unknown_language_in_the_selection_is_simply_absent(
    unbuilt_client: TestClient, words: Path
) -> None:
    body = unbuilt_client.get(
        "/api/word-comparisons?languages=fin&languages=zzz"
    ).json()
    assert all("zzz" not in row["translations"] for row in body)
    assert len(body) == 3


# ── Pagination, shared by both routes ────────────────────────────────────────


def test_no_limit_answers_a_bare_array_and_a_limit_answers_an_envelope(
    unbuilt_client: TestClient, words: Path
) -> None:
    """The branch is the contract: a client that always destructures `items`
    breaks on the first request that omits the limit."""
    bare = unbuilt_client.get(
        "/api/word-comparisons?languages=fin&languages=est"
    ).json()
    assert isinstance(bare, list)

    paged = unbuilt_client.get(
        "/api/word-comparisons?languages=fin&languages=est&limit=2"
    ).json()
    assert list(paged) == ["items", "total", "limit", "offset"]
    assert paged["total"] == 3
    assert [row["conceptId"] for row in paged["items"]] == ["Auge::N", "Ohr::N"]


def test_a_blank_limit_is_no_limit_at_all(
    unbuilt_client: TestClient, words: Path
) -> None:
    """`req.query.limit ? … : undefined` — `""` is falsy, so the bare array."""
    body = unbuilt_client.get("/api/languages/fin/word-list?limit=").json()
    assert isinstance(body, list)
    assert len(body) == 4


def test_an_unparseable_limit_returns_an_empty_page_echoed_as_null(
    unbuilt_client: TestClient, words: Path
) -> None:
    """`parseInt("abc")` is `NaN`; `slice(0, NaN)` clamps to nothing, and `NaN`
    serialises as `null`. A junk limit is an empty page on both servers — NOT
    the whole list, and NOT a 422."""
    body = unbuilt_client.get("/api/languages/fin/word-list?limit=abc").json()
    assert body == {"items": [], "total": 4, "limit": None, "offset": 0}


def test_an_unparseable_offset_is_null_in_the_echo_and_zero_in_the_slice(
    unbuilt_client: TestClient, words: Path
) -> None:
    body = unbuilt_client.get(
        "/api/languages/fin/word-list?limit=2&offset=abc"
    ).json()
    assert body == {"items": [], "total": 4, "limit": 2, "offset": None}


def test_a_negative_offset_wraps_from_the_end(
    unbuilt_client: TestClient, words: Path
) -> None:
    """Both ends wrap, and the *end* is `offset + limit` — still negative when
    the limit is smaller than the offset's magnitude. So `offset=-2&limit=2` is
    `slice(-2, 0)`, whose end precedes its start and yields nothing, while
    `offset=-4&limit=3` is `slice(-4, -1)` and really does take three. The
    offset is echoed as the caller sent it either way."""
    empty = unbuilt_client.get(
        "/api/languages/fin/word-list?limit=2&offset=-2"
    ).json()
    assert empty["items"] == []
    assert empty["offset"] == -2

    wrapped = unbuilt_client.get(
        "/api/languages/fin/word-list?limit=3&offset=-4"
    ).json()
    assert [row["conceptId"] for row in wrapped["items"]] == [
        "Auge::N",
        "Ohr::N",
        "Nase::N",
    ]


def test_an_offset_past_the_end_is_an_empty_page_not_a_404(
    unbuilt_client: TestClient, words: Path
) -> None:
    body = unbuilt_client.get(
        "/api/word-comparisons?languages=fin&languages=est&limit=4&offset=99999"
    ).json()
    assert body == {"items": [], "total": 3, "limit": 4, "offset": 99999}


def test_a_fractional_limit_is_truncated_by_parseInt(
    unbuilt_client: TestClient, words: Path
) -> None:
    body = unbuilt_client.get("/api/languages/fin/word-list?limit=2.9").json()
    assert body["limit"] == 2
    assert len(body["items"]) == 2


# ── The per-language word list ───────────────────────────────────────────────


def test_the_word_list_is_the_whole_concept_spine_with_nulls(
    unbuilt_client: TestClient, words: Path
) -> None:
    """Unfiltered on purpose — a concept the language has no form for is a row
    with `translation: null`. That is what keeps the length stable across
    languages, which the client's pagination depends on."""
    body = unbuilt_client.get("/api/languages/est/word-list").json()
    assert body == [
        {
            "baseWord": "eye",
            "conceptId": "Auge::N",
            "translation": "silm",
            "ipa": "s i l m",
        },
        {"baseWord": "ear", "conceptId": "Ohr::N", "translation": None, "ipa": None},
        {"baseWord": "nose", "conceptId": "Nase::N", "translation": None, "ipa": None},
        {"baseWord": "mouth", "conceptId": "Mund::N", "translation": None, "ipa": None},
    ]


def test_an_unknown_language_gets_the_spine_with_every_form_null(
    unbuilt_client: TestClient, words: Path
) -> None:
    body = unbuilt_client.get("/api/languages/zzz/word-list").json()
    assert len(body) == 4
    assert all(row["translation"] is None and row["ipa"] is None for row in body)


def test_both_routes_answer_a_500_when_the_concept_list_is_missing(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`loadBaseWords` raises where `loadForms` warns, so the concept spine
    being gone is a broken corpus rather than an empty one."""
    comparisons = unbuilt_client.get(
        "/api/word-comparisons?languages=fin&languages=est"
    )
    assert comparisons.status_code == 500
    assert comparisons.json() == {"message": "Failed to fetch word comparisons"}

    word_list = unbuilt_client.get("/api/languages/fin/word-list")
    assert word_list.status_code == 500
    assert word_list.json() == {"message": "Failed to fetch language word list"}
