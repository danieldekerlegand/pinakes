"""`server/services/analytical-index.test.ts` and its route, case for case.

The TypeScript suite's device is kept: every facet query is checked against a
pure in-memory reference that re-parses the same TSV the way
`server/tsv-storage.ts` does (``split("\\t")``, blank cells kept as ``""``). That
is what says DuckDB is a faithful mirror of the source-of-truth files rather
than merely a fast one.

One export is deliberately **not** ported: the TypeScript's `query()` escape
hatch for ad-hoc analytical SQL. No route reaches it — the two `/api/analytics`
handlers call `describe()` and `facetCounts()` — so bringing it across would add
an unrouted SQL entry point to this service rather than port one.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes.analytics import index as analytical

LANGUAGES = "\n".join(
    [
        "id\tname\tregion\tstatus",
        "lat\tLatin\tItaly\textinct",
        "grc\tGreek\tGreece\textinct",
        "osc\tOscan\tItaly\textinct",
        "eng\tEnglish\t\tliving",  # blank region cell — must stay ""
        "cmn\tMandarin\tChina\tliving",
    ]
)

BATTLES = "\n".join(
    [
        "id\tname\toutcome",
        "b1\tCannae\tdecisive",
        "b2\tZama\tdecisive",
    ]
)


def reference_facet_counts(text: str, column: str) -> list[dict[str, object]]:
    """Facet counts computed by re-parsing the TSV, with no SQL involved."""
    lines = [line for line in re.split(r"\r?\n", text) if line.strip() != ""]
    header = lines[0].split("\t")
    position = header.index(column)
    counts = Counter(
        row.split("\t")[position] if position < len(row.split("\t")) else ""
        for row in lines[1:]
    )
    ordered = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    return [{"value": value, "count": count} for value, count in ordered]


@pytest.fixture
def corpus(tmp_path: Path) -> Path:
    directory = tmp_path / "lexicons-index"
    directory.mkdir()
    (directory / "languages.tsv").write_text(LANGUAGES, encoding="utf-8")
    (directory / "battles.tsv").write_text(BATTLES, encoding="utf-8")
    return directory


@pytest.fixture
def index(corpus: Path) -> Iterator[analytical.AnalyticalIndex]:
    built = analytical.AnalyticalIndex.create(corpus)
    yield built
    built.close()


# ── Identifiers ──────────────────────────────────────────────────────────────


def test_file_names_become_safe_sql_identifiers() -> None:
    assert analytical.table_name_for_file("language-ranges.tsv") == "language_ranges"
    assert analytical.table_name_for_file("battles.TSV") == "battles"
    assert analytical.table_name_for_file("123-legacy.tsv") == "t_123_legacy"


# ── Construction ─────────────────────────────────────────────────────────────


def test_one_table_is_built_per_tsv(index: analytical.AnalyticalIndex) -> None:
    assert index.tables() == ["battles", "languages"]
    assert index.columns("languages") == ["id", "name", "region", "status"]


def test_the_header_row_is_not_counted(index: analytical.AnalyticalIndex) -> None:
    assert index.count("languages") == 5
    assert index.count("battles") == 2


def test_describe_reports_table_metadata(index: analytical.AnalyticalIndex) -> None:
    described = {entry["table"]: entry for entry in index.describe()}
    assert described["languages"] == {
        "table": "languages",
        "file": "languages.tsv",
        "columns": ["id", "name", "region", "status"],
        "rowCount": 5,
    }


# ── Facets ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("table", "column"),
    [("languages", "region"), ("languages", "status"), ("battles", "outcome")],
)
def test_facet_counts_match_the_in_memory_reference(
    index: analytical.AnalyticalIndex, corpus: Path, table: str, column: str
) -> None:
    text = (corpus / f"{table}.tsv").read_text(encoding="utf-8")
    assert index.facet_counts(table, column) == reference_facet_counts(text, column)


def test_a_blank_cell_stays_an_empty_string(index: analytical.AnalyticalIndex) -> None:
    """The nullstr sentinel is what keeps an empty cell out of SQL NULL."""
    facets = index.facet_counts("languages", "region")
    assert {"value": "", "count": 1} in facets
    assert all(facet["value"] is not None for facet in facets)


def test_facets_order_by_count_then_value(index: analytical.AnalyticalIndex) -> None:
    facets = index.facet_counts("languages", "region")
    # Italy appears twice (Latin, Oscan); the rest once each.
    assert facets[0] == {"value": "Italy", "count": 2}
    singles = [facet["value"] for facet in facets[1:]]
    assert singles == sorted(singles)


def test_an_unknown_table_or_column_is_a_lookup_error(
    index: analytical.AnalyticalIndex,
) -> None:
    with pytest.raises(analytical.UnknownColumnError, match="No column"):
        index.facet_counts("languages", "nope")
    with pytest.raises(analytical.UnknownTableError, match="No indexed table"):
        index.facet_counts("nope", "id")


# ── Incremental refresh ──────────────────────────────────────────────────────


def test_an_unchanged_corpus_rebuilds_nothing(
    index: analytical.AnalyticalIndex,
) -> None:
    result = index.refresh()
    assert result.rebuilt == []
    assert result.dropped == []


def test_only_the_changed_file_is_rebuilt(
    index: analytical.AnalyticalIndex, corpus: Path
) -> None:
    (corpus / "battles.tsv").write_text(
        f"{BATTLES}\nb3\tTrebia\tdecisive", encoding="utf-8"
    )
    result = index.refresh()
    assert result.rebuilt == ["battles"]
    assert result.dropped == []
    assert index.count("battles") == 3
    assert index.count("languages") == 5


def test_a_new_file_is_picked_up(
    index: analytical.AnalyticalIndex, corpus: Path
) -> None:
    (corpus / "religions.tsv").write_text("id\tname\nr1\tShinto\n", encoding="utf-8")
    assert "religions" in index.refresh().rebuilt
    assert index.count("religions") == 1


def test_a_removed_file_drops_its_table(
    index: analytical.AnalyticalIndex, corpus: Path
) -> None:
    (corpus / "battles.tsv").unlink()
    assert index.refresh().dropped == ["battles"]
    assert index.has_table("battles") is False
    assert index.tables() == ["languages"]


def test_an_absent_directory_is_an_empty_index(tmp_path: Path) -> None:
    built = analytical.AnalyticalIndex.create(tmp_path / "nothing-here")
    try:
        assert built.tables() == []
    finally:
        built.close()


# ── The cached singleton ─────────────────────────────────────────────────────


def test_the_singleton_is_keyed_on_the_directory(corpus: Path, tmp_path: Path) -> None:
    """A cached index of the wrong corpus is what the key exists to prevent."""
    other = tmp_path / "other"
    other.mkdir()
    (other / "religions.tsv").write_text("id\tname\nr1\tShinto\n", encoding="utf-8")
    try:
        assert analytical.get_analytical_index(corpus).tables() == [
            "battles",
            "languages",
        ]
        assert analytical.get_analytical_index(other).tables() == ["religions"]
        # And back again — the switch is not one-way.
        assert analytical.get_analytical_index(corpus).tables() == [
            "battles",
            "languages",
        ]
    finally:
        analytical.close_analytical_index()


# ── The routes ───────────────────────────────────────────────────────────────


@pytest.fixture
def served_corpus(isolated_data_trees: dict[str, Path]) -> Iterator[Path]:
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "languages.tsv").write_text(LANGUAGES, encoding="utf-8")
    (lexicons / "battles.tsv").write_text(BATTLES, encoding="utf-8")
    yield lexicons
    analytical.close_analytical_index()


def test_the_tables_route_lists_the_index(
    unbuilt_client: TestClient, served_corpus: Path
) -> None:
    payload = unbuilt_client.get("/api/analytics/tables").json()
    assert [entry["table"] for entry in payload["tables"]] == ["battles", "languages"]
    assert payload["tables"][1]["rowCount"] == 5


def test_the_facets_route_echoes_its_arguments(
    unbuilt_client: TestClient, served_corpus: Path
) -> None:
    payload = unbuilt_client.get("/api/analytics/facets/languages/region").json()
    assert payload["table"] == "languages"
    assert payload["column"] == "region"
    assert payload["facets"][0] == {"value": "Italy", "count": 2}


@pytest.mark.parametrize(
    "url",
    [
        "/api/analytics/facets/nope/id",
        "/api/analytics/facets/languages/nope",
    ],
)
def test_a_bad_table_or_column_is_a_404_not_a_500(
    unbuilt_client: TestClient, served_corpus: Path, url: str
) -> None:
    """A client error, not a server fault — the whole point of the mapping."""
    response = unbuilt_client.get(url)
    assert response.status_code == 404
    assert response.json()["error"] == "analytics facets not found"
