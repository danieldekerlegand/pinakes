"""`server/services/data-quality-scorer.test.ts` and its route, case for case.

The TypeScript scorer stays as the graded spec — `scripts/coverage-report.ts` and
`scripts/corpus-tier-report.ts` still import it to regenerate the committed
`docs/*.json` snapshots — so this file grades the port two ways: the pure
functions case for case against that suite, and a fresh Python build of the
**live corpus** against those same committed snapshots. The second is the strong
one: it is the two implementations answering with the same numbers about the same
6,722 rows, and it goes red if either side drifts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contracts_dir

from pinakes.analytics import quality

#: The repo checkout, located through the contracts package rather than by a
#: `parents[n]` walk — the failure mode `engine/CLAUDE.md` documents.
REPO_ROOT = contracts_dir().parent
LIVE_LEXICONS = REPO_ROOT / "data" / "source" / "lexicons"

TIER_HEADER = ["id", "name", "wikidata_qid", "source_url", "confidence"]


def tier_file(rows: list[list[str]]) -> dict[str, Any]:
    return {"file": "t.tsv", "node": "place", "header": TIER_HEADER, "rows": rows}


# ── Coverage (pure) ──────────────────────────────────────────────────────────


def test_a_domain_over_its_target_is_met_with_a_percentage_above_one() -> None:
    report = quality.compute_coverage({"civilizations.tsv": 170})
    civilizations = next(
        domain for domain in report["domains"] if domain["domain"] == "civilizations"
    )
    assert civilizations["met"] is True
    assert civilizations["actual"] == 170
    # Rounded to three decimals: 170/150 = 1.1333… -> 1.133.
    assert civilizations["percentOfTarget"] == 1.133


def test_a_domain_under_its_target_is_listed_in_under_target() -> None:
    report = quality.compute_coverage({"language-range-polygons.tsv": 133})
    polygons = next(
        domain
        for domain in report["domains"]
        if domain["domain"] == "language-range-polygons"
    )
    assert polygons["met"] is False
    assert "language-range-polygons" in report["underTarget"]
    assert report["allMet"] is False


def test_an_uncounted_domain_scores_zero_actual() -> None:
    report = quality.compute_coverage({})
    assert report["domainsMet"] == 0
    assert report["domainsUnderTarget"] == len(quality.ROADMAP_TARGETS)
    assert report["allMet"] is False
    assert all(domain["actual"] == 0 for domain in report["domains"])


def test_a_domain_exactly_at_target_counts_as_met() -> None:
    report = quality.compute_coverage({"cuisines.tsv": 80})
    cuisines = next(
        domain for domain in report["domains"] if domain["domain"] == "cuisines"
    )
    assert cuisines["met"] is True


def test_met_plus_under_target_is_always_the_target_count() -> None:
    report = quality.compute_coverage({"civilizations.tsv": 170, "cuisines.tsv": 10})
    assert report["domainsMet"] + report["domainsUnderTarget"] == len(
        quality.ROADMAP_TARGETS
    )


# ── Corpus tiers (pure) ──────────────────────────────────────────────────────


def test_a_qid_anchored_reference_backed_row_auto_admits_the_rest_quarantine() -> None:
    report = quality.compute_corpus_tiers(
        [
            tier_file(
                [
                    ["a", "A", "Q1", "https://x.test", "0.9"],  # qid + url
                    ["b", "B", "Q2", "", "0.8"],  # qid, no url
                    ["c", "C", "", "https://y.test", "0.8"],  # url, no qid
                    ["d", "D", "", "", ""],  # bare
                ]
            )
        ]
    )
    by_tier = {bucket["tier"]: bucket for bucket in report["byTier"]}
    assert by_tier["auto-admitted"]["nodeRows"] == 1
    assert by_tier["auto-admitted"]["fullyProvenanced"] == 1
    assert by_tier["quarantine"]["nodeRows"] == 3
    assert report["totalNodeRows"] == 4
    assert report["autoAdmissionReadyRate"] == 0.25
    # The whole app corpus is curated whatever a row's own provenance says.
    assert report["graphTier"] == "curated"


def test_a_zero_to_hundred_confidence_scale_is_normalised() -> None:
    report = quality.compute_corpus_tiers(
        [tier_file([["a", "A", "Q1", "https://x.test", "90"]])]
    )
    by_tier = {bucket["tier"]: bucket for bucket in report["byTier"]}
    assert by_tier["auto-admitted"]["avgConfidence"] == 0.9


def test_every_trust_tier_gets_a_bucket_in_order() -> None:
    report = quality.compute_corpus_tiers([])
    assert [bucket["tier"] for bucket in report["byTier"]] == list(quality.TRUST_TIERS)
    assert quality.TRUST_TIERS == (
        "curated",
        "auto-admitted",
        "quarantine",
        "inferred",
    )
    assert report["totalNodeRows"] == 0
    assert report["autoAdmissionReadyRate"] == 0


def test_an_unparseable_confidence_cell_is_absent_not_zero() -> None:
    assert quality.normalise_confidence("") is None
    assert quality.normalise_confidence("  ") is None
    assert quality.normalise_confidence("high") is None
    assert quality.normalise_confidence("0.8") == 0.8
    assert quality.normalise_confidence("90") == 0.9


# ── Per-file scoring (pure) ──────────────────────────────────────────────────


def test_a_file_is_scored_on_completeness_uniqueness_and_row_adequacy() -> None:
    score = quality.score_file(
        "t.tsv",
        ["id", "name", "note"],
        [["a", "A", "x"], ["b", "B", ""], ["a", "C", ""]],
    )
    assert score["rowCount"] == 3
    assert score["columnCount"] == 3
    # id and name are full, note is one-third filled.
    assert score["completeness"] == 0.7778
    # Three ids, two distinct.
    assert score["uniqueIdRate"] == 0.6667
    assert score["duplicateIds"] == ["a"]
    # 60% completeness + 20% uniqueness + 20% adequacy (3 of the 10 rows a file
    # needs), weighted on the UNROUNDED components and rounded once at the end.
    assert score["overallScore"] == 0.66
    assert score["fields"][2] == {
        "column": "note",
        "filledCount": 1,
        "totalCount": 3,
        "completeness": 1 / 3,
        "distinctValues": 1,
    }


def test_a_file_with_no_id_column_is_perfectly_unique() -> None:
    score = quality.score_file("t.tsv", ["a", "b"], [["1", "2"], ["1", "2"]])
    assert score["uniqueIdRate"] == 1
    assert score["duplicateIds"] == []


def test_words_style_files_key_on_language_id() -> None:
    score = quality.score_file(
        "words.tsv", ["Form", "Language_ID"], [["a", "eng"], ["b", "eng"]]
    )
    assert score["uniqueIdRate"] == 0.5
    assert score["duplicateIds"] == ["eng"]


def test_an_empty_file_has_no_header_at_all(tmp_path: Path) -> None:
    """`columnCount: 0`, not one blank column — see `parse_tsv_file`."""
    path = tmp_path / "empty.tsv"
    path.write_text("\n\n", encoding="utf-8")
    header, rows = quality.parse_tsv_file(path)
    assert header == []
    assert rows == []
    assert quality.score_file("empty.tsv", header, rows)["columnCount"] == 0


def test_a_crlf_file_keeps_the_carriage_return_on_its_last_column(
    tmp_path: Path,
) -> None:
    """The live `families.tsv` really does report a `language_count\\r` field."""
    path = tmp_path / "crlf.tsv"
    path.write_bytes(b"id\tname\r\na\tA\r\n")
    header, rows = quality.parse_tsv_file(path)
    assert header == ["id", "name\r"]
    assert rows == [["a", "A\r"]]


# ── Referential integrity ────────────────────────────────────────────────────


def test_a_broken_foreign_key_is_reported_with_its_missing_values(
    isolated_data_trees: dict[str, Path],
) -> None:
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "families.tsv").write_text("id\tname\nie\tIndo-European\n", "utf-8")
    (lexicons / "languages.tsv").write_text(
        "id\tname\tfamily_id\nlat\tLatin\tie\ncym\tWelsh\tnope\n", "utf-8"
    )
    checks = {
        (check["sourceFile"], check["sourceColumn"]): check
        for check in quality.check_referential_integrity(lexicons)
    }
    family = checks[("languages.tsv", "family_id")]
    assert family["totalRefs"] == 2
    assert family["validRefs"] == 1
    assert family["missingRefs"] == ["nope"]
    # A source file that is not there is not a check at all.
    assert ("words.tsv", "Language_ID") not in checks


# ── The live corpus ──────────────────────────────────────────────────────────


def test_the_committed_coverage_report_matches_a_fresh_python_build() -> None:
    committed = json.loads(
        (REPO_ROOT / "docs" / "coverage-report.json").read_text(encoding="utf-8")
    )
    assert quality.build_coverage_report(LIVE_LEXICONS) == committed


def test_the_committed_tier_report_matches_a_fresh_python_build() -> None:
    committed = json.loads(
        (REPO_ROOT / "docs" / "corpus-tier-report.json").read_text(encoding="utf-8")
    )
    assert quality.build_corpus_tier_report(LIVE_LEXICONS) == committed


def test_every_tracked_target_file_exists_in_the_corpus() -> None:
    for target in quality.ROADMAP_TARGETS:
        assert (LIVE_LEXICONS / str(target["file"])).is_file()


def test_the_live_report_agrees_with_itself_across_its_four_sections() -> None:
    report = quality.generate_data_quality_report(LIVE_LEXICONS)
    # Coverage row counts agree with the per-file scores in the same report.
    scores = {score["file"]: score for score in report["files"]}
    for domain in report["coverage"]["domains"]:
        score = scores.get(domain["file"])
        if score is not None:
            assert domain["actual"] == score["rowCount"]
    assert report["totalRows"] == sum(score["rowCount"] for score in report["files"])
    # Every node row is classified into exactly one tier.
    tiers = report["tierComposition"]
    assert sum(bucket["nodeRows"] for bucket in tiers["byTier"]) == tiers[
        "totalNodeRows"
    ]
    assert tiers["totalNodeRows"] > 0
    assert tiers["graphTier"] == "curated"


# ── The route ────────────────────────────────────────────────────────────────


def write_quality_corpus(lexicons: Path) -> None:
    (lexicons / "families.tsv").write_text(
        "id\tname\twikidata_qid\tsource_url\tconfidence\n"
        "ie\tIndo-European\tQ19860\thttps://x.test\t90\n"
        "na\tNa-Dene\t\t\t\n",
        encoding="utf-8",
    )
    (lexicons / "languages.tsv").write_text(
        "id\tname\tfamily_id\twikidata_qid\tsource_url\n"
        "lat\tLatin\tie\tQ397\thttps://y.test\n"
        "cym\tWelsh\tie\t\t\n",
        encoding="utf-8",
    )
    (lexicons / "notes.txt").write_text("not a lexicon\n", encoding="utf-8")


def test_the_route_reports_every_section(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_quality_corpus(isolated_data_trees["lexicons"])
    response = unbuilt_client.get("/api/data-quality")
    assert response.status_code == 200
    payload = response.json()

    # Only the .tsv files are graded, sorted by name.
    assert [score["file"] for score in payload["files"]] == [
        "families.tsv",
        "languages.tsv",
    ]
    assert payload["fileCount"] == 2
    assert payload["totalRows"] == 4
    assert payload["timestamp"].endswith("Z")
    assert 0 < payload["overallScore"] <= 1

    family_check = next(
        check
        for check in payload["referentialIntegrity"]
        if check["sourceColumn"] == "family_id"
    )
    assert family_check["totalRefs"] == 2
    assert family_check["validRefs"] == 2

    assert len(payload["coverage"]["domains"]) == len(quality.ROADMAP_TARGETS)
    assert payload["tierComposition"]["totalNodeRows"] == 4
    assert payload["tierComposition"]["autoAdmissionReadyRate"] == 0.5


def test_an_absent_corpus_is_a_500_not_a_clean_bill_of_health(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`readdirSync` threw, and that is the one degrade worth not having."""
    from pinakes import paths

    monkeypatch.setenv(paths.LEXICONS_DIR_ENV, str(tmp_path / "gone"))
    response = unbuilt_client.get("/api/data-quality")
    assert response.status_code == 500
    assert response.json() == {"message": "Failed to generate data quality report"}
