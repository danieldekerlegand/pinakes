"""The descriptive-linguistics reads — 24 routes over seven TSVs (pinakes:80 US-1).

No fixture in `contracts/parity/` records any of these, so this file *is* the
grading, the same standing `test_domain_routes.py` has. What it asserts is what
the live diff against Express proved and a shape check never could: which rows
survive each filter, which `filters` echo a group emits (three of the seven emit
none at all), and — the thing most likely to be "regularised" away — which
`/api/languages/{id}/*` sub-resource answers a **404** for a language with no
rows and which answers an empty list.

`conftest.py`'s autouse `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at
an empty temp tree, so every test seeds its own TSVs; row counts against the
live corpus belong in `test_lexicon_storage.py`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

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


def ids(rows: list[dict[str, Any]]) -> list[str]:
    return [row["id"] for row in rows]


# ── Sample texts ─────────────────────────────────────────────────────────────


@pytest.fixture
def sample_texts(corpus: Path) -> Path:
    write(
        corpus,
        "sample-texts.tsv",
        "id\tlanguage_id\ttitle\ttext\ttransliteration\tgenre\tscript",
        "t1\takk\tEnuma Elish\tenuma\t  e-nu-ma  \tepic\tCuneiform",
        "t2\takk\tCode\tsumma\t\tlegal\tcuneiform",
        "t3\tgrc\tIliad\tmenin\t\tEpic\tGreek",
    )
    return corpus


def test_sample_texts_echo_the_local_variable_names_not_the_parameters(
    unbuilt_client: TestClient, sample_texts: Path
) -> None:
    """`?language_id=` comes back as `languageId` — the handler's variable."""
    body = unbuilt_client.get("/api/sample-texts?language_id=akk&genre=epic").json()
    assert body["filters"] == {"languageId": "akk", "genre": "epic"}
    assert ids(body["texts"]) == ["t1"]


def test_a_blank_sample_text_parameter_echoes_but_does_not_filter(
    unbuilt_client: TestClient, sample_texts: Path
) -> None:
    """These three are read raw, so a blank one is `""` in the echo and falsy in
    the filter — the `_echo`-drops-`undefined` rule seen from the other side."""
    body = unbuilt_client.get("/api/sample-texts?genre=").json()
    assert body["filters"] == {"genre": ""}
    assert body["count"] == 3


def test_a_sample_text_language_is_exact_and_its_genre_and_script_are_not(
    unbuilt_client: TestClient, sample_texts: Path
) -> None:
    assert ids(unbuilt_client.get("/api/sample-texts?genre=EPIC").json()["texts"]) == [
        "t1",
        "t3",
    ]
    assert ids(
        unbuilt_client.get("/api/sample-texts?script=CUNEIFORM").json()["texts"]
    ) == ["t1", "t2"]
    assert unbuilt_client.get("/api/sample-texts?language_id=AKK").json()["count"] == 0


def test_only_a_sample_text_transliteration_is_trimmed(
    unbuilt_client: TestClient, sample_texts: Path
) -> None:
    body = unbuilt_client.get("/api/sample-texts/t1").json()
    assert body["transliteration"] == "e-nu-ma"
    assert body["text"] == "enuma"


def test_a_missing_sample_text_is_a_templated_404(
    unbuilt_client: TestClient, sample_texts: Path
) -> None:
    response = unbuilt_client.get("/api/sample-texts/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Sample text 'nope' not found"}


def test_a_language_with_no_sample_texts_is_an_empty_list_not_a_404(
    unbuilt_client: TestClient, sample_texts: Path
) -> None:
    """The one language sub-resource in this file that does *not* 404."""
    body = unbuilt_client.get("/api/languages/zzz/sample-texts").json()
    assert body == {"texts": [], "count": 0, "languageId": "zzz"}


# ── Phonological inventories ─────────────────────────────────────────────────


@pytest.fixture
def inventories(corpus: Path) -> Path:
    write(
        corpus,
        "phonological-inventories.tsv",
        "id\tlanguage_id\tconsonants\tvowels\ttones\tsyllable_structure",
        'p1\takk\t["b","d"]\t["a","i"]\tnull\tCVC',
        'p2\tyue\t["p"]\t["a"]\t["high","low"]\tCV',
    )
    return corpus


def test_phonological_inventories_answer_two_keys_and_no_filters_echo(
    unbuilt_client: TestClient, inventories: Path
) -> None:
    body = unbuilt_client.get("/api/phonological-inventories?language_id=yue").json()
    assert set(body) == {"inventories", "count"}
    assert ids(body["inventories"]) == ["p2"]


def test_a_language_with_no_inventory_is_a_404(
    unbuilt_client: TestClient, inventories: Path
) -> None:
    response = unbuilt_client.get("/api/languages/zzz/phonological-inventory")
    assert response.status_code == 404
    assert response.json() == {
        "message": "No phonological inventory found for language 'zzz'"
    }
    assert (
        unbuilt_client.get("/api/languages/yue/phonological-inventory").json()["id"]
        == "p2"
    )


# ── Etymology ────────────────────────────────────────────────────────────────


@pytest.fixture
def etymology(corpus: Path) -> Path:
    write(
        corpus,
        "etymology-relations.tsv",
        "id\tsource_word\tsource_language\ttarget_word\ttarget_language\trelation_type",
        "e1\tmother\teng\tmodor\tang\tderived_from",
        "e2\tmodor\tang\tmodar\tgem\tderived_from",
        "e3\tmodar\tgem\tmeh2ter\tine\tetymology",
        "e4\tmother\teng\tmater\tlat\tcognate_with",
        "e5\tmeh2ter\tine\tmother\teng\tderived_from",
    )
    return corpus


def test_etymology_languages_are_exact_and_the_relation_type_is_folded(
    unbuilt_client: TestClient, etymology: Path
) -> None:
    body = unbuilt_client.get(
        "/api/etymology-relations?relation_type=DERIVED_FROM"
    ).json()
    assert ids(body["relations"]) == ["e1", "e2", "e5"]
    assert body["filters"] == {"relationType": "DERIVED_FROM"}
    assert (
        unbuilt_client.get("/api/etymology-relations?source_language=ENG").json()[
            "count"
        ]
        == 0
    )


def test_a_word_lookup_matches_either_end_case_insensitively(
    unbuilt_client: TestClient, etymology: Path
) -> None:
    body = unbuilt_client.get("/api/etymology-relations/word/MODOR").json()
    assert ids(body["relations"]) == ["e1", "e2"]
    assert body["word"] == "MODOR"


def test_the_trace_walks_ancestors_and_the_visited_key_depends_on_the_language(
    unbuilt_client: TestClient, etymology: Path
) -> None:
    """`e5` closes a cycle back to `mother`, and the walk terminates one level
    later than "visit each word once" would suggest.

    The `visited` key is ``word|language`` when a language is known and the bare
    word when it is not — so the *root* is remembered as ``mother`` and the same
    word reached through `e5` as ``mother|eng``. It therefore expands a second
    time, and only *its* child hits the already-visited ``modor|ang``. The root
    also has **no `relation` key** at all (``undefined``, which
    `JSON.stringify` drops) and takes its language from the near end of its
    first match.
    """
    body = unbuilt_client.get("/api/etymology-relations/trace/mother").json()
    assert body["direction"] == "ancestors"
    assert body["language"] is None
    root = body["tree"]
    assert "relation" not in root
    assert root["language"] == "eng"
    ang = root["children"][0]
    assert (ang["word"], ang["relation"]) == ("modor", "derived_from")
    ine = ang["children"][0]["children"][0]
    assert ine["word"] == "meh2ter"
    repeat = ine["children"][0]
    assert (repeat["word"], repeat["language"]) == ("mother", "eng")
    assert repeat["children"] == [
        {"word": "modor", "language": "ang", "relation": "derived_from", "children": []}
    ]


def test_the_trace_reverses_only_for_the_exact_word_descendants(
    unbuilt_client: TestClient, etymology: Path
) -> None:
    down = unbuilt_client.get(
        "/api/etymology-relations/trace/modor?direction=descendants"
    ).json()
    assert down["direction"] == "descendants"
    assert [child["word"] for child in down["tree"]["children"]] == ["mother"]
    sideways = unbuilt_client.get(
        "/api/etymology-relations/trace/modor?direction=DESCENDANTS"
    ).json()
    assert sideways["direction"] == "DESCENDANTS"
    assert [child["word"] for child in sideways["tree"]["children"]] == ["modar"]


def test_a_blank_trace_language_stays_blank_rather_than_taking_the_default(
    unbuilt_client: TestClient, etymology: Path
) -> None:
    """`lang ?? …` is nullish in three places, and `""` is not nullish. This is
    the divergence the live diff against Express caught."""
    body = unbuilt_client.get("/api/etymology-relations/trace/modor?language=").json()
    assert body["language"] == ""
    assert body["tree"]["language"] == ""
    absent = unbuilt_client.get("/api/etymology-relations/trace/modor").json()
    assert absent["language"] is None
    assert absent["tree"]["language"] == "ang"


def test_an_unknown_word_traces_to_a_lone_unknown_node(
    unbuilt_client: TestClient, etymology: Path
) -> None:
    body = unbuilt_client.get("/api/etymology-relations/trace/zzz").json()
    assert body["tree"] == {"word": "zzz", "language": "unknown", "children": []}


# ── Grammar features ─────────────────────────────────────────────────────────


@pytest.fixture
def grammar(corpus: Path) -> Path:
    write(
        corpus,
        "grammar-features.tsv",
        "id\tlanguage_id\tword_order\tmorphological_type\tcase_system"
        "\tnoun_class_count",
        'g1\takk\tSOV\tfusional\t["nominative"]\t3',
        "g2\tgrc\tSOV\tfusional\t\t",
        "g3\teng\tSVO\tanalytic\t[]\tnope",
    )
    return corpus


def test_grammar_features_answer_two_keys_and_three_exact_filters(
    unbuilt_client: TestClient, grammar: Path
) -> None:
    body = unbuilt_client.get("/api/grammar-features?word_order=SOV").json()
    assert set(body) == {"features", "count"}
    assert ids(body["features"]) == ["g1", "g2"]
    lowercase = unbuilt_client.get("/api/grammar-features?word_order=sov").json()
    assert lowercase["count"] == 0


def test_an_unreadable_noun_class_count_is_zero(
    unbuilt_client: TestClient, grammar: Path
) -> None:
    """``parseInt(cell || "0", 10) || 0`` — blank and junk both land on zero."""
    counts = {
        row["id"]: row["nounClassCount"]
        for row in unbuilt_client.get("/api/grammar-features").json()["features"]
    }
    assert counts == {"g1": 3, "g2": 0, "g3": 0}


def test_a_language_with_no_grammar_profile_is_a_404(
    unbuilt_client: TestClient, grammar: Path
) -> None:
    response = unbuilt_client.get("/api/languages/zzz/grammar-features")
    assert response.status_code == 404
    assert response.json() == {
        "message": "No grammar features found for language 'zzz'"
    }
    assert (
        unbuilt_client.get("/api/languages/akk/grammar-features").json()["id"] == "g1"
    )


# ── Verb paradigms ───────────────────────────────────────────────────────────


@pytest.fixture
def paradigms(corpus: Path) -> Path:
    write(
        corpus,
        "verb-paradigms.tsv",
        "id\tlanguage_id\tverb_concept\tconjugation_table\tirregular",
        'v1\tlat\tto be\t{"1sg":"sum"}\ttrue',
        "v2\tlat\tto go\t\tfalse",
        "v3\tgrc\tto be\tnot json\t",
    )
    return corpus


def test_a_language_with_no_paradigms_is_a_404_where_the_list_is_not(
    unbuilt_client: TestClient, paradigms: Path
) -> None:
    """The list route answers an empty page for the same query the sub-resource
    404s on. Both are Express's, and the pair is the reason this file exists."""
    assert unbuilt_client.get("/api/verb-paradigms?language_id=zzz").json() == {
        "paradigms": [],
        "count": 0,
    }
    response = unbuilt_client.get("/api/languages/zzz/verb-paradigms")
    assert response.status_code == 404
    assert response.json() == {"message": "No verb paradigms found for language 'zzz'"}


def test_a_language_with_paradigms_answers_the_counted_envelope(
    unbuilt_client: TestClient, paradigms: Path
) -> None:
    body = unbuilt_client.get("/api/languages/lat/verb-paradigms").json()
    assert set(body) == {"paradigms", "count"}
    assert ids(body["paradigms"]) == ["v1", "v2"]


def test_an_unparseable_conjugation_table_is_an_empty_object(
    unbuilt_client: TestClient, paradigms: Path
) -> None:
    assert unbuilt_client.get("/api/verb-paradigms/v3").json()["conjugationTable"] == {}


# ── Language contacts ────────────────────────────────────────────────────────


@pytest.fixture
def contacts(corpus: Path) -> Path:
    write(
        corpus,
        "language-contacts.tsv",
        "id\tsource_language_id\ttarget_language_id\tcontact_type\tintensity",
        "c1\takk\tsux\tsubstrate\tintense",
        "c2\tsux\takk\tborrowing\tmoderate",
        "c3\tgrc\tlat\tborrowing\tintense",
    )
    return corpus


def test_a_language_contact_lookup_matches_either_end(
    unbuilt_client: TestClient, contacts: Path
) -> None:
    body = unbuilt_client.get("/api/languages/akk/contacts").json()
    assert ids(body["contacts"]) == ["c1", "c2"]
    assert body["count"] == 2


def test_a_language_with_no_contacts_is_a_404(
    unbuilt_client: TestClient, contacts: Path
) -> None:
    response = unbuilt_client.get("/api/languages/zzz/contacts")
    assert response.status_code == 404
    assert response.json() == {
        "message": "No language contacts found for language 'zzz'"
    }


def test_the_four_contact_filters_are_all_exact(
    unbuilt_client: TestClient, contacts: Path
) -> None:
    assert (
        ids(
            unbuilt_client.get(
                "/api/language-contacts?contact_type=borrowing&intensity=intense"
            ).json()["contacts"]
        )
        == ["c3"]
    )
    assert (
        unbuilt_client.get("/api/language-contacts?contact_type=Borrowing").json()[
            "count"
        ]
        == 0
    )


# ── Sound changes ────────────────────────────────────────────────────────────


@pytest.fixture
def sound_changes(corpus: Path) -> Path:
    write(
        corpus,
        "sound-changes.tsv",
        "id\tname\tfamily_id\tsource_language_id\ttarget_language_id\texamples",
        'sc1\tGrimm\tindo_european\tine\tgem\t["p > f"]',
        "sc2\tVerner\tindo_european\tgem\tgem\tnot json",
    )
    return corpus


def test_sound_changes_answer_two_keys_and_three_exact_filters(
    unbuilt_client: TestClient, sound_changes: Path
) -> None:
    body = unbuilt_client.get(
        "/api/sound-changes?family_id=indo_european&source_language_id=ine"
    ).json()
    assert set(body) == {"changes", "count"}
    assert ids(body["changes"]) == ["sc1"]


def test_a_missing_sound_change_is_a_templated_404(
    unbuilt_client: TestClient, sound_changes: Path
) -> None:
    response = unbuilt_client.get("/api/sound-changes/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Sound change 'nope' not found"}


# ── The two 500 shapes ───────────────────────────────────────────────────────


def test_a_corpus_missing_a_required_column_is_the_message_and_error_500(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Every group in this file answers ``{message, error}``; the ``{message}``
    spelling lives in `routers/ethnography.py`. Both are Express's."""
    write(corpus, "sound-changes.tsv", "name\tfamily_id", "Grimm\tine")
    response = unbuilt_client.get("/api/sound-changes")
    assert response.status_code == 500
    body = response.json()
    assert body["message"] == "Failed to fetch sound changes"
    assert "id" in body["error"]


def test_an_absent_file_is_an_empty_domain_rather_than_a_500(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    for path, key in (
        ("/api/sample-texts", "texts"),
        ("/api/phonological-inventories", "inventories"),
        ("/api/etymology-relations", "relations"),
        ("/api/grammar-features", "features"),
        ("/api/verb-paradigms", "paradigms"),
        ("/api/language-contacts", "contacts"),
        ("/api/sound-changes", "changes"),
    ):
        body = unbuilt_client.get(path).json()
        assert body[key] == [], path
        assert body["count"] == 0, path
