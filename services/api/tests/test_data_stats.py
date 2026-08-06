"""`GET /api/data/stats` — the corpus inventory, against fixtures and live.

Graded both ways, the shape `test_lexicon_storage.py` uses: the synthetic half
pins the counting rules (a header-only file is zero, an absent file is zero, a
CRLF header still finds its last column) and the live half asserts the numbers
the committed corpus actually produces, so the port goes red if either the
handler or the corpus drifts.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contracts_dir

from pinakes.routers import data_stats

LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def by_name(datasets: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(entry for entry in datasets if entry["name"] == name)


# ── The counting rules ───────────────────────────────────────────────────────


def test_a_row_is_a_non_blank_line_minus_the_header(corpus: Path) -> None:
    (corpus / "battles.tsv").write_text(
        "id\tname\n\nb1\tKadesh\n\n\nb2\tSalamis\n\n", encoding="utf-8"
    )
    assert data_stats.count_rows(corpus, "battles.tsv") == 2


def test_a_header_only_file_and_an_absent_file_both_count_zero(
    corpus: Path,
) -> None:
    (corpus / "battles.tsv").write_text("id\tname\n", encoding="utf-8")
    assert data_stats.count_rows(corpus, "battles.tsv") == 0
    assert data_stats.count_rows(corpus, "nothing-here.tsv") == 0


def test_the_inventory_never_parses_and_so_survives_a_broken_file(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`ingredient-origins.tsv` is missing the `category` column its loader
    requires, so `/api/ingredient-origins` is a 500 on both backends. The
    inventory still counts its rows — it reads lines, not columns."""
    (corpus / "ingredient-origins.tsv").write_text(
        "id\tcuisine_id\nio1\tlevantine\nio2\tnordic\n", encoding="utf-8"
    )
    datasets = unbuilt_client.get("/api/data/stats").json()["datasets"]
    assert by_name(datasets, "Ingredient Origins")["count"] == 2


def test_a_crlf_header_keeps_its_carriage_return_on_the_last_column(
    corpus: Path,
) -> None:
    """The split is on `"\\n"` alone, not `/\\r?\\n/`, so a CRLF file's last
    header cell reads as `writingSystem\\r` and `indexOf` misses it. Python's
    universal-newline translation would silently "fix" that and report a column
    node does not find — `families.tsv` is CRLF in the live corpus today."""
    (corpus / "languages.tsv").write_bytes(
        b"id\tlatitude\tlongitude\toriginYear\twritingSystem\r\n"
        b"fin\t60.2\t24.9\t-1000\tLatin\r\n"
    )
    coverage = data_stats.language_coverage(corpus)
    assert coverage == {"coordinates": 1, "temporal": 1, "writingSystem": 0}


def test_coordinates_need_both_halves(corpus: Path) -> None:
    (corpus / "languages.tsv").write_text(
        "id\tlatitude\tlongitude\toriginYear\twritingSystem\n"
        "a\t60.2\t24.9\t-1000\tLatin\n"
        "b\t60.2\t\t\t\n"
        "c\t\t24.9\t-500\t\n",
        encoding="utf-8",
    )
    assert data_stats.language_coverage(corpus) == {
        "coordinates": 1,
        "temporal": 2,
        "writingSystem": 1,
    }


def test_a_languages_file_with_no_rows_is_all_zeroes(corpus: Path) -> None:
    (corpus / "languages.tsv").write_text("id\tlatitude\n", encoding="utf-8")
    assert data_stats.language_coverage(corpus) == {
        "coordinates": 0,
        "temporal": 0,
        "writingSystem": 0,
    }


# ── The catalog ──────────────────────────────────────────────────────────────


def test_deities_and_myth_motifs_appear_under_two_categories(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """The dedup key is `category:file`, not `file`. Deduping by file alone
    would silently drop the whole Mythology section."""
    datasets = unbuilt_client.get("/api/data/stats").json()["datasets"]
    pairs = [(entry["category"], entry["file"]) for entry in datasets]
    assert ("Religion", "deities.tsv") in pairs
    assert ("Mythology", "deities.tsv") in pairs
    assert ("Religion", "myth-motifs.tsv") in pairs
    assert ("Mythology", "myth-motifs.tsv") in pairs
    assert len(pairs) == len(set(pairs)) == len(data_stats.DATASETS)


def test_only_word_forms_carries_a_unit_and_only_languages_a_coverage(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`JSON.stringify` drops an `undefined` key, so the absent ones are absent
    rather than null — a client testing `in`/`?.` would read them differently."""
    datasets = unbuilt_client.get("/api/data/stats").json()["datasets"]
    assert [entry["name"] for entry in datasets if "unit" in entry] == ["Word Forms"]
    assert by_name(datasets, "Word Forms")["unit"] == "forms"
    assert [entry["name"] for entry in datasets if "coverage" in entry] == [
        "Languages"
    ]


def test_every_dataset_entry_has_the_same_four_required_keys(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    datasets = unbuilt_client.get("/api/data/stats").json()["datasets"]
    for entry in datasets:
        assert {"category", "name", "count", "file"} <= set(entry)
        assert entry["count"] == 0  # the fixture corpus is empty


# ── The live corpus ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Language Families", 543),
        ("Languages", 1099),
        ("Base Words (Concepts)", 1016),
        # 121,633 *lines*, but only 105,768 concept × language cells reach
        # `/api/scraping/coverage` — `loadForms` keys on the pair, so a repeated
        # one overwrites. The two numbers disagreeing is not a bug in either.
        ("Word Forms", 121633),
    ],
)
def test_the_live_corpus_row_counts(name: str, expected: int) -> None:
    """Line counts, not parsed rows — the numbers this route publishes. They
    move when the corpus does, which is the point of pinning them."""
    filename = next(
        entry[2] for entry in data_stats.DATASETS if entry[1] == name
    )
    assert data_stats.count_rows(LIVE_LEXICONS, filename) == expected


def test_the_live_language_coverage() -> None:
    assert data_stats.language_coverage(LIVE_LEXICONS) == {
        "coordinates": 1099,
        "temporal": 0,
        "writingSystem": 0,
    }
