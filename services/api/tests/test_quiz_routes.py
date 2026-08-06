"""`GET /api/quiz` and `POST /api/quiz/score-map` (pinakes:80 US-1).

The generator draws from `Math.random()`, so nothing here can assert on a
*particular* quiz. What it asserts instead is everything that is decided before
the draw — the two vocabularies, the count clamp, which generator a category
selects, what a thin corpus does — plus the scorer, which is deterministic.

Every test that needs a predictable draw installs a scripted random source
through `learning.quiz.configure`, the seam that replaces monkeypatching
`Math.random` on the Express side; `conftest.py`'s autouse `reset_quiz_random`
takes it back out.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.learning import quiz

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


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


def language(
    identifier: str,
    name: str,
    *,
    family: str = "fam",
    region: str = "Europe",
    speakers: str = "1000",
    latitude: str = "",
    longitude: str = "",
) -> str:
    cells = [""] * 29
    cells[0], cells[1], cells[5] = identifier, name, family
    cells[7], cells[10] = region, speakers
    cells[20], cells[21] = latitude, longitude
    return "\t".join(cells)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    write(
        lexicons,
        "languages.tsv",
        LANGUAGE_HEADER,
        language("a", "Alpha", speakers="400", latitude="10", longitude="20"),
        language("b", "Beta", speakers="300", region="Asia"),
        language("c", "Gamma", speakers="200", region="Africa"),
        language("d", "Delta", speakers="100", region="Oceania"),
    )
    write(
        lexicons,
        "families.tsv",
        FAMILY_HEADER,
        "fam\tFamily One\t\t\tFamily\tEurope\t\t",
        "two\tFamily Two\t\t\tFamily\tAsia\t\t",
        "three\tFamily Three\t\t\tFamily\tAfrica\t\t",
        "four\tFamily Four\t\t\tFamily\tOceania\t\t",
    )
    return lexicons


@pytest.fixture
def scripted() -> Iterator[None]:
    """A source that always draws 0 — the first generator, the first candidate."""
    quiz.configure(lambda: 0.0)
    yield
    quiz.configure(None)


# ── The two vocabularies ─────────────────────────────────────────────────────


def test_an_unknown_category_is_a_400_listing_the_admitted_ones(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.get("/api/quiz?category=nonsense")
    assert response.status_code == 400
    assert response.json() == {
        "message": (
            "Invalid category. Must be one of: mixed, languages, families, "
            "grammar, writing_systems, geography"
        )
    }


@pytest.mark.parametrize("category", ["cuisine", "civilizations"])
def test_the_two_mixed_only_categories_cannot_be_asked_for_by_name(
    unbuilt_client: TestClient, corpus: Path, category: str
) -> None:
    """They have a generator each, and `validCategories` does not admit them."""
    assert category in quiz.GENERATORS
    assert unbuilt_client.get(f"/api/quiz?category={category}").status_code == 400


def test_an_unknown_difficulty_is_a_400(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.get("/api/quiz?difficulty=impossible")
    assert response.status_code == 400
    assert response.json() == {
        "message": "Invalid difficulty. Must be one of: easy, medium, hard"
    }


def test_a_blank_category_is_mixed(
    unbuilt_client: TestClient, corpus: Path, scripted: None
) -> None:
    body = unbuilt_client.get("/api/quiz?category=&difficulty=").json()
    assert body["category"] == "mixed"
    assert body["difficulty"] == "medium"


# ── The count clamp ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("query", "expected"),
    [("", 10), ("count=abc", 10), ("count=0", 10), ("count=99", 30), ("count=-4", 1)],
)
def test_the_count_is_parsed_then_clamped(
    unbuilt_client: TestClient,
    corpus: Path,
    scripted: None,
    query: str,
    expected: int,
) -> None:
    body = unbuilt_client.get(f"/api/quiz?category=languages&{query}").json()
    assert len(body["questions"]) == expected


# ── Which generator a category selects ───────────────────────────────────────


def test_a_named_category_only_draws_its_own_generator(
    unbuilt_client: TestClient, corpus: Path, scripted: None
) -> None:
    body = unbuilt_client.get("/api/quiz?category=families&count=3").json()
    assert {question["category"] for question in body["questions"]} == {"families"}
    assert {question["type"] for question in body["questions"]} == {"multiple_choice"}


def test_the_speaker_question_answers_with_the_order_not_an_index(
    unbuilt_client: TestClient, corpus: Path, scripted: None
) -> None:
    question = unbuilt_client.get("/api/quiz?category=languages&count=1").json()[
        "questions"
    ][0]
    assert question["type"] == "drag_sort"
    assert question["answer"] == ["Alpha", "Beta", "Gamma", "Delta"]
    assert sorted(question["options"]) == sorted(question["answer"])
    assert question["explanation"].startswith("Alpha: 400 speakers")


def test_a_corpus_too_thin_for_a_question_yields_an_empty_quiz(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path], scripted: None
) -> None:
    """Three attempts per question, every one of them `None`, and no error."""
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    write(lexicons, "languages.tsv", LANGUAGE_HEADER, language("a", "Alpha"))
    body = unbuilt_client.get("/api/quiz?category=languages&count=2").json()
    assert body == {"questions": [], "category": "languages", "difficulty": "medium"}


def test_a_hint_is_absent_rather_than_null_when_there_is_no_region(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path], scripted: None
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    write(
        lexicons,
        "languages.tsv",
        LANGUAGE_HEADER,
        *[
            language(identifier, identifier.upper(), region="")
            for identifier in ("a", "b", "c", "d")
        ],
    )
    write(
        lexicons,
        "families.tsv",
        FAMILY_HEADER,
        "fam\tFamily One\t\t\tFamily\t\t\t",
        "two\tFamily Two\t\t\tFamily\t\t\t",
        "three\tFamily Three\t\t\tFamily\t\t\t",
        "four\tFamily Four\t\t\tFamily\t\t\t",
    )
    question = unbuilt_client.get("/api/quiz?category=families&count=1").json()[
        "questions"
    ][0]
    assert "hint" not in question


# ── The primitives ───────────────────────────────────────────────────────────


def test_the_shuffle_walks_from_the_end(scripted: None) -> None:
    """With every draw at 0, Fisher-Yates rotates the list left by one."""
    assert quiz.shuffle(["a", "b", "c"]) == ["b", "c", "a"]


def test_an_id_is_the_base_36_fraction_digits_of_the_draw() -> None:
    """`(0.5).toString(36)` is `"0.i"`, so a draw of a half is a **one**-character
    id on both backends — the eight digits are a ceiling, not a width."""
    quiz.configure(lambda: 0.5)
    assert quiz.make_id() == "i"
    quiz.configure(lambda: 0.123456789)
    identifier = quiz.make_id()
    assert len(identifier) == 8
    assert all(
        character in "0123456789abcdefghijklmnopqrstuvwxyz"
        for character in identifier
    )


def test_the_chronology_window_tightens_with_difficulty() -> None:
    items: list[dict[str, Any]] = [
        {"name": name, "year": year}
        for name, year in [("a", -3000), ("b", -2000), ("c", -100), ("d", 500)]
    ]
    quiz.configure(lambda: 0.0)
    assert quiz.chronology_item_count("easy") == 3
    assert quiz.chronology_item_count("hard") == 5
    hard = quiz.select_chronology_items(items, 4, "hard")
    assert hard is not None
    assert [item["name"] for item in hard] == ["a", "b", "c", "d"]
    assert quiz.select_chronology_items(items, 5, "hard") is None


def test_the_chronological_answer_is_earliest_first() -> None:
    assert quiz.order_civilizations_chronologically(
        [{"name": "late", "year": 500}, {"name": "early", "year": -800}]
    ) == ["early", "late"]


# ── The scorer ───────────────────────────────────────────────────────────────


def test_a_click_inside_the_difficulty_radius_is_correct(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.post(
        "/api/quiz/score-map",
        json={
            "answer": {"lat": 48.85, "lng": 2.35},
            "guess": {"lat": 51.5, "lng": -0.12},
            "difficulty": "medium",
        },
    ).json()
    assert body["correct"] is True
    assert 340 < body["distanceKm"] < 345


def test_an_unknown_difficulty_scores_as_hard(unbuilt_client: TestClient) -> None:
    """Paris to Munich is ~680 km: inside `medium`\'s 800, outside `hard`\'s 400."""
    payload: dict[str, Any] = {
        "answer": {"lat": 48.85, "lng": 2.35},
        "guess": {"lat": 48.14, "lng": 11.58},
        "difficulty": "impossible",
    }
    assert (
        unbuilt_client.post("/api/quiz/score-map", json=payload).json()["correct"]
        is False
    )
    payload["difficulty"] = "medium"
    assert (
        unbuilt_client.post("/api/quiz/score-map", json=payload).json()["correct"]
        is True
    )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"answer": {"lat": 1, "lng": 2}},
        {"answer": {"lat": 1}, "guess": {"lat": 1, "lng": 2}},
        {"answer": "somewhere", "guess": {"lat": 1, "lng": 2}},
    ],
)
def test_an_incomplete_pair_of_points_is_a_400(
    unbuilt_client: TestClient, payload: dict[str, Any]
) -> None:
    response = unbuilt_client.post("/api/quiz/score-map", json=payload)
    assert response.status_code == 400
    assert response.json() == {"message": "answer and guess must have lat and lng"}


def test_a_click_on_the_equator_is_refused(unbuilt_client: TestClient) -> None:
    """`!answer.lat` is truthiness, so latitude 0 reads as a missing field."""
    response = unbuilt_client.post(
        "/api/quiz/score-map",
        json={"answer": {"lat": 0, "lng": 10}, "guess": {"lat": 1, "lng": 2}},
    )
    assert response.status_code == 400
