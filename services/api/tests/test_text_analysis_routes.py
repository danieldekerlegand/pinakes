"""`POST /api/text-analysis/{origins,compare}` (pinakes:80 US-1).

The etymology trace is the whole surface, so most of this file is about the
walk: which relation it prefers, what a cycle resolves to, and the difference
between a word that is *absent* from the corpus and one that is present with no
ancestor. The rest pins the two 400s and the two percentage rules.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.lexicons import etymology

RELATION_HEADER = (
    "id\tsource_word\tsource_language\ttarget_word\ttarget_language\trelation_type"
)
LANGUAGE_HEADER = (
    "id\tname\tnative_name\tiso639_1\tiso639_2\tfamily_id\tparent_language_id\t"
    "region\tcountries\tnative_speakers\ttotal_speakers\tstatus\ttime_origin\t"
    "time_end\tclassification\twriting_system\tis_historical_variant\tis_dialect\t"
    "chronological_order\thistorical_context\tlatitude\tlongitude\tconfidence\t"
    "endangerment_status\tretrieved_at\tsource_url\tsources\twikidata_qid\tglottocode"
)


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


def language(identifier: str, name: str) -> str:
    """A language row. `family_id` is filled because a language without one is
    dropped by the loader outright (`lexicons/storage.load_languages`)."""
    cells = [""] * 29
    cells[0], cells[1], cells[5] = identifier, name, "fam"
    return "\t".join(cells)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    write(
        lexicons,
        "languages.tsv",
        LANGUAGE_HEADER,
        language("eng", "English"),
        language("ang", "Old English"),
        language("fra", "French"),
        language("lat", "Latin"),
    )
    write(
        lexicons,
        "etymology-relations.tsv",
        RELATION_HEADER,
        "er1\tmother\teng\tmodor\tang\tderived_from",
        "er2\tmodor\tang\tmater\tlat\tderived_from",
        "er3\tcourt\teng\tcort\tfra\tborrowed_from",
        "er4\tcort\tfra\tcohors\tlat\tderived_from",
    )
    return lexicons


def origins(client: TestClient, text: str, language_id: str = "eng") -> Any:
    return client.post(
        "/api/text-analysis/origins", json={"text": text, "language": language_id}
    )


# ── The trace ────────────────────────────────────────────────────────────────


def test_a_word_traces_to_its_oldest_recorded_ancestor(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = origins(unbuilt_client, "mother").json()
    assert body["origins"] == [
        {
            "language": "lat",
            "languageName": "Latin",
            "count": 1,
            "percentage": 100,
            "words": ["mother"],
        }
    ]
    assert body["wordDetails"][0]["chain"] == [
        {"word": "mother", "language": "eng", "languageName": "English"},
        {"word": "modor", "language": "ang", "languageName": "Old English"},
        {"word": "mater", "language": "lat", "languageName": "Latin"},
    ]


def test_a_word_the_corpus_has_never_heard_of_is_unknown(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = origins(unbuilt_client, "quokka").json()
    assert body["unknownWords"] == 1
    assert body["analyzedWords"] == 0
    assert body["wordDetails"][0] == {"word": "quokka", "origin": None, "chain": []}


def test_a_word_present_only_as_a_target_is_its_own_origin(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`cohors` has no ancestor but is attested, so it originates in Latin."""
    body = origins(unbuilt_client, "cohors", "lat").json()
    assert body["origins"][0]["language"] == "lat"
    assert body["wordDetails"][0]["chain"] == [
        {"word": "cohors", "language": "lat", "languageName": "Latin"}
    ]


def test_derived_from_outranks_borrowed_from(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "etymology-relations.tsv",
        RELATION_HEADER,
        "er1\tfoo\teng\tborrowed\tfra\tborrowed_from",
        "er2\tfoo\teng\tderived\tlat\tderived_from",
    )
    body = origins(unbuilt_client, "foo").json()
    assert body["origins"][0]["language"] == "lat"


def test_a_cycle_resolves_to_the_language_it_was_re_entered_at(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "etymology-relations.tsv",
        RELATION_HEADER,
        "er1\tping\teng\tpong\tfra\tderived_from",
        "er2\tpong\tfra\tping\teng\tderived_from",
    )
    body = origins(unbuilt_client, "ping").json()
    assert body["origins"][0]["language"] == "eng"
    assert body["unknownWords"] == 0


def test_the_language_comparison_is_case_folded(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = origins(unbuilt_client, "MOTHER", "ENG").json()
    assert body["origins"][0]["language"] == "lat"


# ── Tokenizing and tallies ───────────────────────────────────────────────────


def test_punctuation_is_stripped_and_edge_marks_trimmed() -> None:
    assert etymology.tokenize("The mother's court, indeed!") == [
        "the",
        "mother's",
        "court",
        "indeed",
    ]
    assert etymology.tokenize("--hello-- 'world'") == ["hello", "world"]


def test_a_non_latin_script_survives_tokenizing() -> None:
    assert etymology.tokenize("мать 母 어머니") == ["мать", "母", "어머니"]


def test_percentages_are_shares_of_every_token_not_of_the_analyzed_ones(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = origins(unbuilt_client, "mother quokka").json()
    assert body["totalWords"] == 2
    assert body["origins"][0]["percentage"] == 50


def test_a_repeated_word_counts_twice_but_is_listed_once(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = origins(unbuilt_client, "mother mother").json()
    assert body["origins"][0]["count"] == 2
    assert body["origins"][0]["words"] == ["mother"]
    assert len(body["wordDetails"]) == 2


def test_origins_are_ordered_by_count_descending(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "etymology-relations.tsv",
        RELATION_HEADER,
        "er1\tone\teng\tuno\tlat\tderived_from",
        "er2\ttwo\teng\tdeux\tfra\tderived_from",
        "er3\tthree\teng\ttrois\tfra\tderived_from",
    )
    body = origins(unbuilt_client, "one two three").json()
    assert [row["language"] for row in body["origins"]] == ["fra", "lat"]


# ── Refusals ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "payload",
    [{}, {"text": "hi"}, {"language": "eng"}, {"text": "", "language": "eng"}],
)
def test_origins_requires_both_fields(
    unbuilt_client: TestClient, corpus: Path, payload: dict[str, Any]
) -> None:
    response = unbuilt_client.post("/api/text-analysis/origins", json=payload)
    assert response.status_code == 400
    assert response.json() == {
        "message": "Both 'text' and 'language' fields are required"
    }


def test_a_non_string_text_is_a_500_carrying_the_engine_message(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.post(
        "/api/text-analysis/origins", json={"text": 12, "language": "eng"}
    )
    assert response.status_code == 500
    assert response.json() == {
        "message": "Failed to analyze text origins",
        "error": "text.toLowerCase is not a function",
    }


def test_compare_requires_all_four_fields(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.post(
        "/api/text-analysis/compare",
        json={"textA": "a", "textB": "b", "languageA": "eng"},
    )
    assert response.status_code == 400
    assert response.json() == {
        "message": (
            "Fields 'textA', 'textB', 'languageA', and 'languageB' are all required"
        )
    }


# ── Compare ──────────────────────────────────────────────────────────────────


def test_compare_partitions_the_union_of_both_origin_tables(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.post(
        "/api/text-analysis/compare",
        json={
            "textA": "mother",
            "textB": "court",
            "languageA": "eng",
            "languageB": "eng",
        },
    ).json()
    comparison = body["comparison"]
    assert comparison["sharedOrigins"] == ["lat"]
    assert comparison["uniqueToA"] == []
    assert comparison["uniqueToB"] == []
    assert comparison["differences"] == [
        {"language": "lat", "percentA": 100, "percentB": 100, "diff": 0}
    ]


def test_an_origin_only_one_side_has_is_unique_to_it(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.post(
        "/api/text-analysis/compare",
        json={
            "textA": "mother",
            "textB": "quokka",
            "languageA": "eng",
            "languageB": "eng",
        },
    ).json()
    assert body["comparison"]["uniqueToA"] == ["lat"]
    assert body["comparison"]["differences"] == [
        {"language": "lat", "percentA": 100, "percentB": 0, "diff": 100}
    ]
    assert body["analysisB"]["unknownWords"] == 1


def test_differences_are_ordered_by_absolute_gap(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.post(
        "/api/text-analysis/compare",
        json={
            "textA": "mother court",
            "textB": "court",
            "languageA": "eng",
            "languageB": "eng",
        },
    ).json()
    gaps = [row["diff"] for row in body["comparison"]["differences"]]
    assert gaps == sorted(gaps, key=lambda value: -abs(value))
