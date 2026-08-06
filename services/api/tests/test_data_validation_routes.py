"""The three `/api/data-validation/*` reads (pinakes:80 US-1).

The schema table and the cross-reference table are data, so what is worth
grading is the *walk* over them: which issue each disagreement raises, at which
severity, on which row number — and the four ways a cross-reference rule can
contribute nothing at all.

The published rule list is asserted key by key, because the absent
`optional`/`isJsonArray` keys are the contract (`JSON.stringify` writes no key
for an `undefined`) and a defaulted `False` would be a different document.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.analytics import validation

FAMILY_HEADER = (
    "id\tname\tparent_id\tdescription\ttaxonomic_level\tregion\ttotal_speakers\t"
    "language_count"
)
CUISINE_ITEM_HEADER = "id\tcuisine_id\tname\tfood_type\ttime_origin\ttime_end"
CUISINE_HEADER = (
    "id\tname\tnative_name\tregion\tcoordinates\tassociated_language_ids\t"
    "time_origin\ttime_end\tdescription\twikidata_qid\tsource_url\tretrieved_at\t"
    "confidence\tsources"
)


def write(directory: Path, filename: str, *rows: str) -> None:
    (directory / filename).write_text("\n".join(rows) + "\n", encoding="utf-8")


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def issues_of(body: dict[str, Any], filename: str) -> list[dict[str, Any]]:
    result = next(row for row in body["fileResults"] if row["file"] == filename)
    return list(result["issues"])


def validate(client: TestClient, query: str = "") -> Any:
    return client.get(f"/api/data-validation/validate{query}").json()


# ── The schema pass ──────────────────────────────────────────────────────────


def test_a_missing_file_is_one_error_and_no_rows(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = validate(unbuilt_client, "?files=families.tsv")
    assert body["filesValidated"] == 1
    assert body["totalRows"] == 0
    assert issues_of(body, "families.tsv") == [
        {
            "file": "families.tsv",
            "severity": "error",
            "message": "File not found: families.tsv",
        }
    ]


def test_a_missing_column_is_an_error_when_required_and_a_warning_otherwise(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "families.tsv", "id\tparent_id", "indo\t")
    issues = issues_of(validate(unbuilt_client, "?files=families.tsv"), "families.tsv")
    by_column = {issue["column"]: issue for issue in issues if "row" not in issue}
    assert by_column["name"]["severity"] == "error"
    assert by_column["total_speakers"]["severity"] == "warning"
    assert by_column["name"]["message"] == "Missing column 'name'"


def test_a_blank_required_cell_is_reported_with_its_row_number(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "families.tsv", FAMILY_HEADER, "indo\t\t\t\t\t\t\t")
    issues = issues_of(validate(unbuilt_client, "?files=families.tsv"), "families.tsv")
    assert {
        "file": "families.tsv",
        "row": 2,
        "column": "name",
        "severity": "error",
        "message": "Required field 'name' is empty",
    } in issues


def test_a_duplicate_id_is_reported_on_the_second_row(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "families.tsv",
        FAMILY_HEADER,
        "indo\tIndo\t\t\t\t\t\t",
        "indo\tIndo again\t\t\t\t\t\t",
    )
    issues = issues_of(validate(unbuilt_client, "?files=families.tsv"), "families.tsv")
    duplicates = [issue for issue in issues if issue["message"].startswith("Duplicate")]
    assert duplicates == [
        {
            "file": "families.tsv",
            "row": 3,
            "column": "id",
            "severity": "error",
            "message": "Duplicate ID 'indo'",
            "value": "indo",
        }
    ]


def test_a_number_column_must_match_the_whole_cell(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`Number("1e3")` is 1000 and `Number("12px")` is `NaN` — `parseInt` differs."""
    write(
        corpus,
        "families.tsv",
        FAMILY_HEADER,
        "a\tA\t\t\t\t\t1e3\t",
        "b\tB\t\t\t\t\t12px\t",
    )
    issues = issues_of(validate(unbuilt_client, "?files=families.tsv"), "families.tsv")
    invalid = [issue for issue in issues if issue["message"] == "Invalid number value"]
    assert invalid == [
        {
            "file": "families.tsv",
            "row": 3,
            "column": "total_speakers",
            "severity": "error",
            "message": "Invalid number value",
            "value": "12px",
        }
    ]


def test_the_literal_null_cell_is_exempt_from_every_type_check(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "families.tsv", FAMILY_HEADER, "a\tA\t\t\t\t\tnull\t")
    issues = issues_of(validate(unbuilt_client, "?files=families.tsv"), "families.tsv")
    assert not [issue for issue in issues if "row" in issue]


def test_a_json_array_column_holding_an_object_is_a_warning_naming_its_type(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "cuisines.tsv",
        CUISINE_HEADER,
        'peru\tPeru\t\t\t\t{"a": 1}\t\t\t\t\t\t\t\t',
        "chile\tChile\t\t\t\tnot json\t\t\t\t\t\t\t\t",
    )
    issues = issues_of(validate(unbuilt_client, "?files=cuisines.tsv"), "cuisines.tsv")
    messages = {issue["row"]: issue for issue in issues if "row" in issue}
    assert messages[2]["severity"] == "warning"
    assert messages[2]["message"] == "Expected JSON array but got object"
    assert messages[3]["severity"] == "error"
    assert messages[3]["message"] == "Invalid JSON"


def test_an_end_date_before_its_start_is_a_warning_naming_both(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "cuisines.tsv",
        CUISINE_HEADER,
        "peru\tPeru\t\t\t\t\t-500\t-2000\t\t\t\t\t\t",
    )
    issues = issues_of(validate(unbuilt_client, "?files=cuisines.tsv"), "cuisines.tsv")
    assert issues[-1] == {
        "file": "cuisines.tsv",
        "row": 2,
        "column": "time_end",
        "severity": "warning",
        "message": "End date (-2000) before origin date (-500)",
    }


def test_the_column_list_is_the_header_as_read(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """CRLF keeps its `\\r`, because the split is on `"\\n"` alone."""
    (corpus / "families.tsv").write_text(
        "id\tname\r\nindo\tIndo\r\n", encoding="utf-8", newline=""
    )
    body = validate(unbuilt_client, "?files=families.tsv")
    result = next(row for row in body["fileResults"] if row["file"] == "families.tsv")
    assert result["columns"] == ["id", "name\r"]


def test_blank_lines_are_dropped_before_the_header_is_taken(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "families.tsv", "", FAMILY_HEADER, "   ", "indo\tIndo\t\t\t\t\t\t")
    body = validate(unbuilt_client, "?files=families.tsv")
    result = next(row for row in body["fileResults"] if row["file"] == "families.tsv")
    assert result["rowCount"] == 1
    assert result["columns"][0] == "id"


# ── The cross-reference pass ─────────────────────────────────────────────────


@pytest.fixture
def joined(corpus: Path) -> Path:
    write(
        corpus,
        "cuisines.tsv",
        CUISINE_HEADER,
        "peru\tPeru\t\t\t\t\t\t\t\t\t\t\t\t",
    )
    write(
        corpus,
        "cuisine-items.tsv",
        CUISINE_ITEM_HEADER,
        "a\tperu\tCeviche\tSeafood\t\t",
        "b\tnowhere\tGhost\tSeafood\t\t",
    )
    return corpus


def test_a_broken_required_reference_is_an_error(
    unbuilt_client: TestClient, joined: Path
) -> None:
    body = validate(unbuilt_client, "?files=cuisine-items.tsv")
    rule = next(
        row for row in body["crossReferences"] if row["sourceColumn"] == "cuisine_id"
    )
    assert rule["totalReferences"] == 2
    assert rule["brokenReferences"] == 1
    assert rule["issues"] == [
        {
            "file": "cuisine-items.tsv",
            "row": 3,
            "column": "cuisine_id",
            "severity": "error",
            "message": "Reference 'nowhere' not found in cuisines.tsv.id",
            "value": "nowhere",
        }
    ]


def test_an_optional_reference_breaks_as_a_warning(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(corpus, "families.tsv", FAMILY_HEADER, "indo\tIndo\tmissing\t\t\t\t\t")
    body = validate(unbuilt_client, "?files=families.tsv")
    rule = next(
        row for row in body["crossReferences"] if row["sourceColumn"] == "parent_id"
    )
    assert rule["issues"][0]["severity"] == "warning"


def test_a_rule_whose_target_is_absent_contributes_nothing(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    write(
        corpus,
        "cuisine-items.tsv",
        CUISINE_ITEM_HEADER,
        "a\tperu\tCeviche\tSeafood\t\t",
    )
    body = validate(unbuilt_client, "?files=cuisine-items.tsv")
    assert body["crossReferences"] == []


def test_files_narrows_the_rules_on_either_side_of_the_join(
    unbuilt_client: TestClient, joined: Path
) -> None:
    """Asking for `cuisines.tsv` still checks the rules that point *at* it."""
    body = validate(unbuilt_client, "?files=cuisines.tsv")
    assert [row["sourceFile"] for row in body["crossReferences"]] == [
        "cuisine-items.tsv"
    ]
    assert body["filesValidated"] == 1


def test_skip_cross_references_is_the_literal_true(
    unbuilt_client: TestClient, joined: Path
) -> None:
    assert (
        validate(unbuilt_client, "?files=cuisine-items.tsv&skipCrossReferences=true")[
            "crossReferences"
        ]
        == []
    )
    assert validate(
        unbuilt_client, "?files=cuisine-items.tsv&skipCrossReferences=1"
    )["crossReferences"]


def test_an_unknown_file_name_validates_nothing_rather_than_400ing(
    unbuilt_client: TestClient, joined: Path
) -> None:
    body = validate(unbuilt_client, "?files=languages")
    assert body["filesValidated"] == 0
    assert body["fileResults"] == []


def test_the_severity_tally_counts_every_issue_from_both_passes(
    unbuilt_client: TestClient, joined: Path
) -> None:
    body = validate(unbuilt_client, "?files=cuisine-items.tsv")
    counted = body["issuesBySeverity"]
    assert body["totalIssues"] == sum(counted.values())
    assert set(counted) == {"error", "warning", "info"}
    assert counted["error"] >= 1


# ── The two catalogue reads ──────────────────────────────────────────────────


def test_the_summary_lists_every_declared_file_present_or_not(
    unbuilt_client: TestClient, joined: Path
) -> None:
    body = unbuilt_client.get("/api/data-validation/summary").json()
    assert body["totalFiles"] == len(validation.FILE_SCHEMAS)
    by_file = {row["file"]: row for row in body["files"]}
    assert by_file["cuisine-items.tsv"] == {
        "file": "cuisine-items.tsv",
        "exists": True,
        "rowCount": 2,
        "columnCount": 6,
    }
    assert by_file["battles.tsv"]["exists"] is False


def test_the_published_rules_omit_their_unset_flags(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/data-validation/cross-references").json()
    assert body["totalRules"] == len(validation.CROSS_REFERENCES)
    assert body["rules"][0] == {
        "sourceFile": "languages.tsv",
        "sourceColumn": "family_id",
        "targetFile": "families.tsv",
        "targetColumn": "id",
        "optional": True,
    }
    required = next(
        rule for rule in body["rules"] if rule["sourceFile"] == "cuisine-items.tsv"
    )
    assert "optional" not in required
    assert "isJsonArray" not in required


def test_the_report_carries_an_iso_timestamp(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    timestamp = validate(unbuilt_client, "?files=families.tsv")["timestamp"]
    assert timestamp.endswith("Z")
    assert timestamp[4] == "-" and timestamp[10] == "T"
