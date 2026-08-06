"""The `/api/linguistic-distance/*` group — `routers/linguistic_distance.py`.

The whole slice was diffed against the live Express app before landing (the
throwaway-script method the earlier cutover slices describe), driving both sides
from the *same* pseudo-random generator so that LDND — which samples its
different-meaning baseline with `Math.random()` — is reproducible on both. That
is what :func:`_sequence` stands in for here: a generator whose draws are known,
so a test can state what LDND *is* rather than that it is between 0 and 1.

Three groups of assertion, in this order: the pure edit distances and set
algebra, the routes over a temp corpus, and the handful of facts about the
**live** corpus that this port's behaviour actually rests on — 108 languages
with word data, acyclic parent chains, and the 105 malformed
`tense_aspect_mood` cells that make half the enhanced surface a 500.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.distance import calculator, enhanced, phonetic, utf16
from pinakes.lexicons import storage
from pinakes.paths import LEXICONS_RELPATH, repo_root

LIVE_LEXICONS = repo_root() / LEXICONS_RELPATH


def _sequence(*values: float) -> Callable[[], float]:
    """A generator handing back `values`, then cycling — `Math.random`'s stand-in."""
    state = {"index": 0}

    def draw() -> float:
        value = values[state["index"] % len(values)]
        state["index"] += 1
        return value

    return draw


@pytest.fixture(autouse=True)
def reset_distance_random() -> Iterator[None]:
    """`calculator.configure` is module state; leave it as we found it."""
    yield
    calculator.configure()


# --------------------------------------------------------------------------
# The temp corpus
# --------------------------------------------------------------------------

LANGUAGE_HEADER = (
    "id\tname\tnative_name\tiso639_1\tiso639_2\tfamily_id\tparent_language_id\t"
    "region\tcountries\tnative_speakers\ttotal_speakers\tstatus\ttime_origin\t"
    "time_end\tclassification\twriting_system\tis_historical_variant\tis_dialect\t"
    "chronological_order\thistorical_context\tlatitude\tlongitude"
)

WORDS_HEADER = (
    "Language_ID\tGlottocode\tConcept_ID\tWord_Form\trawIPA\tIPA\tASJP\tList\t"
    "Dolgo\tNext_Step"
)

PHONOLOGY_HEADER = (
    "id\tlanguage_id\tconsonants\tvowels\ttones\tphonotactic_patterns\t"
    "syllable_structure\tstress_system"
)

GRAMMAR_HEADER = (
    "id\tlanguage_id\tword_order\tmorphological_type\tcase_system\tgender_system\t"
    "number_system\ttense_aspect_mood\tagreement_system\tnegation_strategy\t"
    "question_formation\trelative_clause_strategy\tnoun_class_count\t"
    "verb_valency_changes\tevidentiality\tergativity"
)


def _language(
    identifier: str,
    name: str,
    family: str,
    parent: str = "",
    latitude: str = "",
    longitude: str = "",
) -> str:
    cells = [""] * 22
    cells[0] = identifier
    cells[1] = name
    cells[5] = family
    cells[6] = parent
    cells[11] = "living"
    cells[20] = latitude
    cells[21] = longitude
    return "\t".join(cells)


def _word(language: str, concept: str, form: str, ipa: str = "", asjp: str = "") -> str:
    cells = [""] * 10
    cells[0] = language
    cells[2] = concept
    cells[3] = form
    cells[5] = ipa
    cells[6] = asjp
    return "\t".join(cells)


def _phonology(
    language: str,
    consonants: list[str],
    vowels: list[str],
    tones: list[str] | None = None,
    syllable: str = "CVC",
    stress: str = "initial",
) -> str:
    return "\t".join(
        [
            f"phon-{language}",
            language,
            json.dumps(consonants),
            json.dumps(vowels),
            "null" if tones is None else json.dumps(tones),
            "{}",
            syllable,
            stress,
        ]
    )


def _grammar(
    language: str,
    word_order: str = "SVO",
    morphology: str = "fusional",
    case: list[str] | None = None,
    gender: list[str] | None = None,
    tam: Any = None,
) -> str:
    cells = [f"gram-{language}", language, word_order, morphology]
    cells.append(json.dumps(case or []))
    cells.append(json.dumps(gender or []))
    cells.append("[]")
    cells.append(json.dumps(tam if tam is not None else []))
    cells.extend(
        ["agreement", "particle", "intonation", "relative", "0", "[]", "none", "none"]
    )
    return "\t".join(cells)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    """A four-language corpus: two related, one unrelated, one bare."""
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "languages.tsv").write_text(
        "\n".join(
            [
                LANGUAGE_HEADER,
                _language("aa", "Ayy", "north", latitude="60", longitude="20"),
                _language(
                    "ab", "Bee", "north", parent="aa", latitude="61", longitude="21"
                ),
                _language("zz", "Zed", "south"),
                _language("bare", "Bare", "south", latitude="n/a", longitude="n/a"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (lexicons / "words.tsv").write_text(
        "\n".join(
            [
                WORDS_HEADER,
                _word("aa", "hand", "kasi", "k a s i", "kasi"),
                _word("aa", "foot", "jalka", "j a l k a", "yalka"),
                _word("aa", "water", "vesi", "v e s i", "wesi"),
                _word("ab", "hand", "kasi", "k a s i", "kasi"),
                _word("ab", "foot", "jalg", "j a l g", "yalg"),
                _word("ab", "sun", "paike", "p a i k e", "payke"),
                _word("zz", "hand", "mano", "m a n o", "mano"),
                _word("zz", "foot", "pie", "p i e", "pie"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (lexicons / "phonological-inventories.tsv").write_text(
        "\n".join(
            [
                PHONOLOGY_HEADER,
                _phonology("aa", ["k", "s", "j", "l"], ["a", "i", "e"]),
                _phonology("ab", ["k", "s", "j", "g"], ["a", "i", "e"]),
                _phonology("zz", ["m", "n", "p"], ["a", "o"], syllable="CV"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (lexicons / "grammar-features.tsv").write_text(
        "\n".join(
            [
                GRAMMAR_HEADER,
                _grammar(
                    "aa", case=["nominative", "genitive"], tam=["past", "present"]
                ),
                _grammar(
                    "ab", case=["nominative", "partitive"], tam=["past", "present"]
                ),
                _grammar(
                    "zz", word_order="SOV", morphology="agglutinative", tam=["past"]
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return lexicons


@pytest.fixture
def client(corpus: Path) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


# --------------------------------------------------------------------------
# Edit distance
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("first", "second", "expected"),
    [
        ("", "", 0),
        ("abc", "abc", 0),
        ("abc", "abd", 1),
        ("kitten", "sitting", 3),
        ("", "abc", 3),
    ],
)
def test_levenshtein(first: str, second: str, expected: int) -> None:
    assert calculator.levenshtein(first, second) == expected


def test_normalized_levenshtein_divides_by_the_longer_string() -> None:
    assert calculator.normalized_levenshtein("", "") == 0
    assert calculator.normalized_levenshtein("abc", "abd") == 1 / 3
    assert calculator.normalized_levenshtein("", "abcd") == 1


def test_an_astral_word_form_is_two_units_long_as_in_javascript() -> None:
    """`𐀀` is one Python character and two JavaScript ones.

    The orthographic fallback compares raw word forms, so the normalisation
    divisor of any comparison touching an ancient script would differ from
    Express's if this counted code points.
    """
    linear_b = "\U00010000"
    assert len(linear_b) == 1
    assert utf16.length(linear_b) == 2
    assert calculator.normalized_levenshtein(linear_b, "ab") == 1


def test_a_voicing_change_costs_less_than_a_place_change() -> None:
    """The divisor is 1.9: voicing (0.2) + the widest place gap (0.7) + manner (1)."""
    assert phonetic.phonetic_distance("p", "p") == 0
    assert phonetic.phonetic_distance("p", "b") == pytest.approx(0.2 / 1.9)
    assert phonetic.phonetic_distance("p", "f") == pytest.approx((0.3 + 0.6) / 1.9)
    # bilabial to alveolar is three steps, which is the widest bracket there is.
    assert phonetic.phonetic_distance("p", "t") == pytest.approx(0.7 / 1.9)
    assert phonetic.phonetic_distance("p", "d") == pytest.approx((0.2 + 0.7) / 1.9)
    assert phonetic.phonetic_distance("i", "y") == pytest.approx(0.2 / 1.55)
    # A consonant against a vowel, and an unknown symbol, both cost the flat 1.
    assert phonetic.phonetic_distance("p", "a") == 1.0
    assert phonetic.phonetic_distance("p", "?") == 1.0


def test_the_weighted_edit_distance_is_never_above_the_flat_one() -> None:
    """Substitution is weighted; insertion and deletion still cost a flat 1."""
    assert phonetic.normalized_phonetic_levenshtein("pat", "bat") < (
        calculator.normalized_levenshtein("pat", "bat")
    )
    assert phonetic.normalized_phonetic_levenshtein("pat", "pat") == 0


# --------------------------------------------------------------------------
# LDND
# --------------------------------------------------------------------------


def test_no_shared_vocabulary_is_minus_one_not_an_error(corpus: Path) -> None:
    lexicon = calculator.Lexicon(corpus)
    metrics = calculator.calculate_ldnd(lexicon.forms("aa"), lexicon.forms("bare"))
    assert metrics == {
        "ldnd": -1,
        "avgLevenshtein": -1,
        "comparedWords": 0,
        "coverage": 0,
        "sharedCognates": 0,
    }


def test_ldnd_is_the_same_meaning_average_over_the_different_meaning_one(
    corpus: Path,
) -> None:
    """With the sampler pinned, the whole metric is arithmetic.

    `aa` and `ab` share `hand` (identical ASJP) and `foot` (`yalka`/`yalg`), so
    the same-meaning average is `(0 + 2/5) / 2`. Every sampled pair here is the
    first concept of each language — the same concept, which is *skipped* — so
    the baseline falls back to 1.0 and LDND is the average itself.
    """
    calculator.configure(_sequence(0.0))
    lexicon = calculator.Lexicon(corpus)
    metrics = calculator.calculate_ldnd(lexicon.forms("aa"), lexicon.forms("ab"))
    assert metrics["comparedWords"] == 2
    assert metrics["avgLevenshtein"] == pytest.approx((0 + 2 / 5) / 2)
    assert metrics["ldnd"] == pytest.approx(metrics["avgLevenshtein"])
    assert metrics["sharedCognates"] == 2
    assert metrics["coverage"] == pytest.approx(2 / 3)


def test_a_skipped_sample_still_consumes_two_draws(corpus: Path) -> None:
    """The two indices are drawn *before* the same-concept test.

    That is what lets one generator reproduce the same sample on both backends;
    drawing lazily would desynchronise the sequence at the first skip.
    """
    draws: list[float] = []

    def counted() -> float:
        draws.append(0.0)
        return 0.0

    calculator.configure(counted)
    lexicon = calculator.Lexicon(corpus)
    calculator.calculate_ldnd(lexicon.forms("aa"), lexicon.forms("ab"))
    # min(100, 2 shared * 2) = 4 iterations, every one of them skipped.
    assert len(draws) == 8


def test_the_phonetic_mode_chooses_the_column_per_pair(corpus: Path) -> None:
    calculator.configure(_sequence(0.0))
    lexicon = calculator.Lexicon(corpus)
    asjp = calculator.calculate_ldnd(lexicon.forms("aa"), lexicon.forms("ab"), "asjp")
    calculator.configure(_sequence(0.0))
    ipa = calculator.calculate_ldnd(lexicon.forms("aa"), lexicon.forms("ab"), "ipa")
    calculator.configure(_sequence(0.0))
    wordform = calculator.calculate_ldnd(
        lexicon.forms("aa"), lexicon.forms("ab"), "wordform"
    )
    # `jalka`/`jalg` is 2/5 as ASJP and as orthography, but the IPA column has
    # its spaces stripped, which is the same five characters again.
    assert asjp["avgLevenshtein"] == pytest.approx(wordform["avgLevenshtein"])
    assert ipa["avgLevenshtein"] == pytest.approx(0.2)


def test_a_per_language_file_outranks_the_bulk_table(corpus: Path) -> None:
    (corpus / "zz.tsv").write_text(
        "\n".join(
            [
                "Concept_ID\tWord_Form\tIPA\tASJP\tDolgo",
                "hand\tkasi\tk a s i\tkasi\tKVSV",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    forms = calculator.Lexicon(corpus).forms("zz")
    assert list(forms) == ["hand"]
    assert forms["hand"].word_form == "kasi"
    assert forms["hand"].dolgo == "KVSV"


def test_available_language_ids_read_every_tsv_as_a_language(corpus: Path) -> None:
    """Including the domain files, which is why the route intersects the result."""
    (corpus / "deities.tsv").write_text("id\tname\n", encoding="utf-8")
    available = calculator.Lexicon(corpus).available_language_ids()
    assert "deities" in available
    assert "grammar-features" in available
    assert "languages" not in available
    assert {"aa", "ab", "zz"} <= set(available)


# --------------------------------------------------------------------------
# Genealogy and geography
# --------------------------------------------------------------------------


def test_genealogy_distance(corpus: Path) -> None:
    languages = storage.load_languages(corpus)
    by_id = {language["id"]: language for language in languages}
    assert (
        calculator.calculate_genealogy_distance(by_id["aa"], by_id["aa"], languages)
        == 0
    )
    assert (
        calculator.calculate_genealogy_distance(by_id["aa"], by_id["ab"], languages)
        == 1
    )
    assert (
        calculator.calculate_genealogy_distance(by_id["aa"], by_id["zz"], languages)
        == -1
    )


def test_geographic_distance_is_none_without_both_coordinates(corpus: Path) -> None:
    """A blank cell is the *origin*, not nothing — only an unreadable one is null.

    `load_languages` reads a coordinate through `Number("")`, which is 0, so
    `zz` (blank cells) really does sit at Null Island and really does have a
    measurable distance. `bare` carries `n/a`, which is `NaN`, and that is what
    a missing coordinate looks like in this corpus.
    """
    by_id = {language["id"]: language for language in storage.load_languages(corpus)}
    assert by_id["zz"]["coordinates"] == {"lat": 0, "lng": 0}
    assert calculator.calculate_geographic_distance(by_id["aa"], by_id["bare"]) is None
    kilometres = calculator.calculate_geographic_distance(by_id["aa"], by_id["ab"])
    assert kilometres is not None
    assert kilometres == pytest.approx(123.94, abs=0.01)


# --------------------------------------------------------------------------
# Jaccard and the malformed-cell 500
# --------------------------------------------------------------------------


def test_two_empty_lists_are_identical_not_incomparable() -> None:
    assert enhanced.jaccard_similarity([], []) == 1
    assert enhanced.jaccard_similarity(["a"], []) == 0
    assert enhanced.jaccard_similarity(["a", "b"], ["b", "c"]) == pytest.approx(1 / 3)


def test_a_set_membership_key_keeps_true_and_one_apart() -> None:
    assert enhanced.jaccard_similarity([True], [1]) == 0


def test_an_object_valued_cell_raises_the_way_new_set_does() -> None:
    with pytest.raises(enhanced.NotIterableError) as raised:
        enhanced.jaccard_similarity({"tenses": ["past"]}, ["past"])
    assert str(raised.value) == (
        "object is not iterable (cannot read property Symbol(Symbol.iterator))"
    )


# --------------------------------------------------------------------------
# The routes
# --------------------------------------------------------------------------


def test_the_group_is_ported() -> None:
    app = create_app()
    outstanding = {
        route.path
        for route in app.state.parity_coverage.unported
        if route.port_unit == "linguistic-distance"
    }
    assert outstanding == set()


def test_available_languages_intersects_the_scan_with_the_language_table(
    client: TestClient, corpus: Path
) -> None:
    (corpus / "deities.tsv").write_text("id\tname\n", encoding="utf-8")
    answer = client.get("/api/linguistic-distance/available-languages").json()
    assert [language["id"] for language in answer["languages"]] == ["aa", "ab", "zz"]
    assert answer == {
        "languages": answer["languages"],
        "count": 3,
        "totalLanguages": 4,
    }


def test_pairwise_carries_the_genealogical_and_geographic_gaps(
    client: TestClient,
) -> None:
    calculator.configure(_sequence(0.0))
    answer = client.post(
        "/api/linguistic-distance/pairwise",
        json={"language1Id": "aa", "language2Id": "ab"},
    )
    assert answer.status_code == 200
    body = answer.json()
    assert list(body) == [
        "language1",
        "language2",
        "lexical",
        "confidence",
        "genealogical",
        "geographic",
    ]
    assert body["genealogical"] == {"distance": 1, "sameFamily": True}
    assert body["geographic"]["hasData"] is True
    assert body["lexical"]["comparedWords"] == 2


def test_an_integral_score_serialises_without_a_fractional_part(
    client: TestClient,
) -> None:
    """`-1`, not `-1.0` — `jsmath.js_number` over every derived value."""
    answer = client.post(
        "/api/linguistic-distance/pairwise",
        json={"language1Id": "aa", "language2Id": "bare"},
    )
    assert '"ldnd":-1' in answer.text.replace(" ", "")
    assert '"coverage":0' in answer.text.replace(" ", "")


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({}, "Both language1Id and language2Id are required"),
        ({"language1Id": "aa"}, "Both language1Id and language2Id are required"),
        (
            {"language1Id": "", "language2Id": "ab"},
            "Both language1Id and language2Id are required",
        ),
        (["aa", "ab"], "Both language1Id and language2Id are required"),
    ],
)
def test_pairwise_refusals(client: TestClient, body: Any, message: str) -> None:
    answer = client.post("/api/linguistic-distance/pairwise", json=body)
    assert answer.status_code == 400
    assert answer.json() == {"message": message}


def test_an_empty_array_id_is_present_in_javascript_and_so_404s(
    client: TestClient,
) -> None:
    """`![]` is false, so the guard passes and the *lookup* is what fails."""
    answer = client.post(
        "/api/linguistic-distance/pairwise",
        json={"language1Id": [], "language2Id": []},
    )
    assert answer.status_code == 404
    assert answer.json() == {"message": "One or both languages not found"}


@pytest.mark.parametrize(
    ("body", "status", "message"),
    [
        ({}, 400, "languageIds array is required"),
        ({"languageIds": "aa"}, 400, "languageIds array is required"),
        ({"languageIds": []}, 400, "At least 2 languages are required"),
        ({"languageIds": ["aa"]}, 400, "At least 2 languages are required"),
        (
            {"languageIds": ["aa"] * 51},
            400,
            "Maximum 50 languages allowed for matrix calculation",
        ),
        ({"languageIds": ["aa", "nope"]}, 404, "One or more languages not found"),
    ],
)
def test_matrix_refusals(
    client: TestClient, body: Any, status: int, message: str
) -> None:
    answer = client.post("/api/linguistic-distance/matrix", json=body)
    assert answer.status_code == status
    assert answer.json() == {"message": message}


def test_the_matrix_is_symmetric_with_an_uncomputed_diagonal(
    client: TestClient,
) -> None:
    calculator.configure(_sequence(0.0))
    body = client.post(
        "/api/linguistic-distance/matrix",
        json={"languageIds": ["aa", "ab", "zz"], "metric": "levenshtein"},
    ).json()
    assert body["metric"] == "levenshtein"
    matrix = body["matrix"]
    assert [row[index] for index, row in enumerate(matrix)] == [0, 0, 0]
    assert matrix[0][1] == matrix[1][0]
    assert matrix[0][2] == matrix[2][0]


def test_an_unrecognised_metric_and_mode_fall_back_rather_than_422(
    client: TestClient,
) -> None:
    calculator.configure(_sequence(0.0))
    body = client.post(
        "/api/linguistic-distance/matrix",
        json={"languageIds": ["aa", "ab"], "metric": "bogus", "phoneticMode": "bogus"},
    ).json()
    assert body["metric"] == "ldnd"


@pytest.mark.parametrize("query", ["", "?k=", "?k=abc", "?k=0", "?k=0.5", "?k=-0.5"])
def test_a_falsy_k_is_the_default_ten(client: TestClient, query: str) -> None:
    calculator.configure(_sequence(0.0))
    answer = client.get(f"/api/linguistic-distance/nearest/aa{query}")
    assert answer.status_code == 200
    # `parseInt("0.5")` is 0 and `parseInt("-0.5")` is **-0**, both falsy, so
    # both are the default too. Three other languages in the corpus, so ten is
    # not a limit here — what is asserted is that no spelling here is a 4xx.
    assert answer.json()["count"] == 3


@pytest.mark.parametrize("k", ["-1", "-2.5", "101", "1000"])
def test_an_out_of_range_k_is_a_400(client: TestClient, k: str) -> None:
    answer = client.get(f"/api/linguistic-distance/nearest/aa?k={k}")
    assert answer.status_code == 400
    assert answer.json() == {"message": "k must be between 1 and 100"}


def test_nearest_ranks_ascending_so_a_language_with_no_data_leads(
    client: TestClient,
) -> None:
    calculator.configure(_sequence(0.0))
    body = client.get("/api/linguistic-distance/nearest/aa?k=3").json()
    assert body["targetLanguage"]["id"] == "aa"
    ranked = body["nearestLanguages"]
    assert ranked[0]["language2"]["id"] == "bare"
    assert ranked[0]["lexical"]["ldnd"] == -1
    assert [entry["language2"]["id"] for entry in ranked[1:]] == ["ab", "zz"] or [
        entry["language2"]["id"] for entry in ranked[1:]
    ] == ["zz", "ab"]


def test_an_unknown_language_is_a_404_on_both_nearest_routes(
    client: TestClient,
) -> None:
    assert client.get("/api/linguistic-distance/nearest/nope").status_code == 404
    answer = client.get("/api/linguistic-distance/enhanced/nearest/nope")
    assert answer.status_code == 404
    assert answer.json() == {"message": "Language not found"}


def test_enhanced_pairwise_describes_every_measurable_dimension(
    client: TestClient,
) -> None:
    calculator.configure(_sequence(0.0))
    answer = client.post(
        "/api/linguistic-distance/enhanced/pairwise",
        json={"language1Id": "aa", "language2Id": "ab"},
    )
    assert answer.status_code == 200
    body = answer.json()
    assert list(body) == [
        "language1Id",
        "language2Id",
        "distances",
        "breakdown",
        "language1",
        "language2",
        "mode",
        "description",
    ]
    assert body["mode"] == "combined"
    assert set(body["breakdown"]) == {"phonological", "grammatical"}
    assert body["distances"]["vocabulary"] is not None
    assert "similar grammatically" in body["description"]
    assert " but " in body["description"]
    assert body["description"].startswith("Ayy and Bee are ")


def test_a_dimension_with_no_data_is_null_and_leaves_the_others_alone(
    client: TestClient,
) -> None:
    body = client.post(
        "/api/linguistic-distance/enhanced/pairwise",
        json={"language1Id": "aa", "language2Id": "bare"},
    ).json()
    assert body["distances"] == {
        "vocabulary": None,
        "phonological": None,
        "grammatical": None,
        "combined": None,
    }
    assert body["breakdown"] == {}
    assert body["description"] == "Insufficient data to compare Ayy and Bare"


def test_an_unrecognised_mode_falls_back_on_the_post_and_400s_on_the_get(
    client: TestClient,
) -> None:
    calculator.configure(_sequence(0.0))
    posted = client.post(
        "/api/linguistic-distance/enhanced/pairwise",
        json={"language1Id": "aa", "language2Id": "ab", "mode": "bogus"},
    )
    assert posted.status_code == 200
    assert posted.json()["mode"] == "combined"

    got = client.get("/api/linguistic-distance/enhanced/nearest/aa?mode=bogus")
    assert got.status_code == 400
    assert got.json() == {
        "message": (
            "mode must be one of: vocabulary, phonological, grammatical, combined"
        )
    }


def test_a_blank_mode_is_combined(client: TestClient) -> None:
    answer = client.get("/api/linguistic-distance/enhanced/nearest/aa?mode=")
    assert answer.status_code == 200
    assert answer.json()["mode"] == "combined"


def test_enhanced_nearest_answers_vocabulary_from_the_lexical_ranker(
    client: TestClient,
) -> None:
    """A different result shape from the other three modes, on purpose."""
    calculator.configure(_sequence(0.0))
    body = client.get(
        "/api/linguistic-distance/enhanced/nearest/aa?mode=vocabulary&k=2"
    ).json()
    assert body["mode"] == "vocabulary"
    assert body["count"] == 2
    assert set(body["nearestLanguages"][0]) == {"language", "distance"}


def test_a_dimension_ranks_only_the_languages_that_have_it(client: TestClient) -> None:
    body = client.get(
        "/api/linguistic-distance/enhanced/nearest/aa?mode=phonological&k=10"
    ).json()
    ranked = [entry["language"]["id"] for entry in body["nearestLanguages"]]
    assert ranked == ["ab", "zz"]
    assert body["count"] == 2


def test_a_ranked_language_with_no_row_in_the_table_falls_back_to_its_id(
    client: TestClient, corpus: Path
) -> None:
    """`languages.find(...) || {id, name}` — a profile for an unlisted language."""
    path = corpus / "phonological-inventories.tsv"
    path.write_text(
        path.read_text(encoding="utf-8").rstrip("\n")
        + "\n"
        + _phonology("ghost", ["k"], ["a"])
        + "\n",
        encoding="utf-8",
    )
    body = client.get(
        "/api/linguistic-distance/enhanced/nearest/aa?mode=phonological&k=10"
    ).json()
    ghost = [
        entry["language"]
        for entry in body["nearestLanguages"]
        if entry["language"]["id"] == "ghost"
    ]
    assert ghost == [{"id": "ghost", "name": "ghost"}]


def test_an_object_valued_grammar_cell_is_a_500_naming_the_javascript_reason(
    client: TestClient, corpus: Path
) -> None:
    """The live corpus's 105 malformed rows, in miniature."""
    path = corpus / "grammar-features.tsv"
    path.write_text(
        "\n".join(
            [
                GRAMMAR_HEADER,
                _grammar("aa", tam={"tenses": ["past"], "aspects": ["perfective"]}),
                _grammar("ab", tam=["past"]),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    answer = client.post(
        "/api/linguistic-distance/enhanced/pairwise",
        json={"language1Id": "aa", "language2Id": "ab", "mode": "grammatical"},
    )
    assert answer.status_code == 500
    assert answer.json() == {
        "message": "Failed to calculate enhanced distance",
        "error": (
            "object is not iterable (cannot read property Symbol(Symbol.iterator))"
        ),
    }


# --------------------------------------------------------------------------
# The live corpus
# --------------------------------------------------------------------------


def test_the_live_corpus_has_word_data_for_108_languages() -> None:
    lexicon = calculator.Lexicon(LIVE_LEXICONS)
    available = set(lexicon.available_language_ids())
    languages = storage.load_languages(LIVE_LEXICONS)
    assert len([one for one in languages if one["id"] in available]) == 108
    assert len(languages) == 1099


def test_every_live_parent_chain_terminates() -> None:
    """`calculateGenealogyDistance` walks `parentLanguageId` with no cycle guard.

    Neither backend has one, so a cycle in `languages.tsv` would hang a request
    on both. This is the tripwire: it fails on the corpus change rather than on
    the request.
    """
    languages = storage.load_languages(LIVE_LEXICONS)
    by_id = {language["id"]: language for language in languages}
    for language in languages:
        seen = {language["id"]}
        current = language
        while current.get("parentLanguageId"):
            parent_id = current["parentLanguageId"]
            assert parent_id not in seen, f"cycle through {parent_id}"
            seen.add(parent_id)
            parent = by_id.get(parent_id)
            if parent is None:
                break
            current = parent


def test_105_live_grammar_rows_hold_an_object_where_an_array_belongs() -> None:
    """The count behind the enhanced surface's 500s — see `NotIterableError`.

    When this number reaches zero the corpus has been repaired and
    `enhanced/nearest?mode=grammatical` starts answering 200 on both backends.
    Nothing in this service needs changing when it does; the test is the notice.
    """
    rows = storage.load_grammar_features(LIVE_LEXICONS)
    malformed = [row for row in rows if not isinstance(row["tenseAspectMood"], list)]
    assert len(rows) == 1091
    assert len(malformed) == 105
    with pytest.raises(enhanced.NotIterableError):
        enhanced.jaccard_similarity(malformed[0]["tenseAspectMood"], [])
