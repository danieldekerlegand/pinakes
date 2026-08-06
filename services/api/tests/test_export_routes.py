"""`/api/export/*` — the per-profile open-dataset exporter.

The whole group was proved byte-identical to the live Express app over 71
requests before landing (`.chief/state/progress.txt`); these cases are the ones
worth keeping, and they concentrate on the four places where a plausible
rewrite would quietly disagree: the identity "remap", the substring filter, the
`includeFiles` coercions, and the download's wrong-by-design content type.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.dataset import export as pipeline

WRITING_SYSTEMS = "\n".join(
    [
        "id\tname\tlanguage_id\tdirection\textra",
        "latin\tLatin\tlat\tltr\tone",
        "greek\t  Greek  \tell\tltr",
        "cune\tCuneiform, early\tsux\tltr\tsays \"hi\"",
        "linb\tLinear B — 𐀀\tgmy\tltr\tné",
    ]
)

FAMILIES = "\n".join(
    [
        "id\tname\tregion",
        "ie\tIndo-European\tEURASIA",
        "aa\tAfro-Asiatic\tAFRICA",
    ]
)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    """A tiny lexicons tree covering two of the five profiles."""
    lexicons: Path = isolated_data_trees["lexicons"]
    (lexicons / "writing-systems.tsv").write_text(
        WRITING_SYSTEMS + "\n", encoding="utf-8"
    )
    (lexicons / "families.tsv").write_text(FAMILIES + "\n", encoding="utf-8")
    return lexicons


@pytest.fixture
def client(corpus: Path) -> TestClient:
    return TestClient(create_app(client_directory=Path("/nonexistent")))


# ── The profile catalogue ────────────────────────────────────────────────────


def test_the_five_profiles_are_listed_in_declaration_order(client: TestClient) -> None:
    body = client.get("/api/export/datasets").json()
    assert [profile["id"] for profile in body] == [
        "languages",
        "phonology",
        "grammar",
        "etymology",
        "writing-systems",
    ]
    assert body[0]["files"] == ["languages.tsv", "families.tsv"]


def test_one_profile_by_id_and_a_404_for_anything_else(client: TestClient) -> None:
    assert client.get("/api/export/datasets/grammar").json()["name"] == (
        "Grammatical Features"
    )
    missing = client.get("/api/export/datasets/nope")
    assert missing.status_code == 404
    assert missing.json() == {"message": "Dataset not found"}


# ── Validation ───────────────────────────────────────────────────────────────


def test_the_complaints_come_back_in_the_typescripts_order(client: TestClient) -> None:
    body = client.post("/api/export", json={}).json()
    assert body["message"] == "Invalid export options"
    assert body["errors"] == ["Dataset is required", "Format is required"]


def test_a_blank_dataset_is_required_not_unknown(client: TestClient) -> None:
    """`!options.dataset` is truthiness, so `""` never reaches the id lookup."""
    body = client.post("/api/export", json={"dataset": "", "format": "csv"}).json()
    assert body["errors"] == ["Dataset is required"]


def test_a_non_string_dataset_falls_through_to_the_unknown_branch(
    client: TestClient,
) -> None:
    body = client.post("/api/export", json={"dataset": 7, "format": "csv"}).json()
    assert body["errors"] == [
        "Unknown dataset: 7. Available: "
        "languages, phonology, grammar, etymology, writing-systems"
    ]


def test_an_unknown_format_names_the_four_that_work(client: TestClient) -> None:
    body = client.post("/api/export", json={"dataset": "grammar", "format": "xml"})
    assert body.status_code == 400
    assert body.json()["errors"] == [
        "Invalid format: xml. Available: cldf, csv, tsv, json"
    ]


def test_an_include_file_outside_the_profile_is_rejected(client: TestClient) -> None:
    body = client.post(
        "/api/export",
        json={"dataset": "languages", "format": "csv", "includeFiles": ["nope.tsv"]},
    ).json()
    assert body["errors"] == [
        "File nope.tsv is not part of dataset languages. "
        "Available: languages.tsv, families.tsv"
    ]


def test_a_string_include_files_is_validated_one_character_at_a_time(
    client: TestClient,
) -> None:
    """`for (const f of "families.tsv")` iterates **characters**, and each 400s.

    So a caller who sends a bare string instead of an array gets one complaint
    per letter — twelve of them, deduped by the language to nine. Absurd, and
    exactly what Express answers; the alternative reading (a substring test,
    which is what `exportDataset`'s `.includes` would have done had validation
    let it through) is never reached.
    """
    response = client.post(
        "/api/export",
        json={
            "dataset": "languages",
            "format": "csv",
            "includeFiles": "families.tsv",
        },
    )
    assert response.status_code == 400
    errors = response.json()["errors"]
    assert len(errors) == len("families.tsv")
    assert errors[0].startswith("File f is not part of dataset languages.")


def test_a_string_include_files_would_have_been_a_substring_test() -> None:
    """The reading validation never reaches, pinned so the two stay distinct."""
    assert pipeline._js_includes("families.tsv", "families.tsv") is True
    assert pipeline._js_includes("families.tsv", "languages.tsv") is False


# ── Export bodies ────────────────────────────────────────────────────────────


def test_a_missing_file_contributes_no_entry_at_all(client: TestClient) -> None:
    """The corpus has no `languages.tsv`, so the profile exports one file."""
    body = client.post(
        "/api/export", json={"dataset": "languages", "format": "tsv"}
    ).json()
    assert [entry["filename"] for entry in body["files"]] == ["families.tsv"]
    assert body["metadata"]["fileCount"] == 1
    assert body["metadata"]["totalRows"] == 2


def test_headers_are_renamed_and_unmapped_columns_keep_their_names(
    client: TestClient,
) -> None:
    body = client.post(
        "/api/export", json={"dataset": "writing-systems", "format": "tsv"}
    ).json()
    header = body["files"][0]["content"].split("\n")[0]
    # id/name/language_id are mapped; direction and extra are not.
    assert header == "ID\tName\tLanguage_ID\tdirection\textra"


def test_every_cell_is_trimmed_and_a_short_row_is_padded(client: TestClient) -> None:
    rows = client.post(
        "/api/export", json={"dataset": "writing-systems", "format": "tsv"}
    ).json()["files"][0]["content"].split("\n")
    assert rows[2] == "greek\tGreek\tell\tltr\t"


def test_csv_quotes_a_comma_and_doubles_an_inner_quote(client: TestClient) -> None:
    content = client.post(
        "/api/export", json={"dataset": "writing-systems", "format": "csv"}
    ).json()["files"][0]["content"]
    assert '"Cuneiform, early"' in content
    assert '"says ""hi"""' in content


def test_cldf_is_csv_and_lands_in_a_csv_file(client: TestClient) -> None:
    as_cldf = client.post(
        "/api/export", json={"dataset": "writing-systems", "format": "cldf"}
    ).json()
    as_csv = client.post(
        "/api/export", json={"dataset": "writing-systems", "format": "csv"}
    ).json()
    assert as_cldf["files"][0]["filename"] == "writing-systems.csv"
    assert as_cldf["files"][0]["content"] == as_csv["files"][0]["content"]


def test_json_is_two_space_indented_and_keeps_non_ascii_literal(
    client: TestClient,
) -> None:
    content = client.post(
        "/api/export", json={"dataset": "writing-systems", "format": "json"}
    ).json()["files"][0]["content"]
    assert content.startswith("[\n  {\n    ")
    assert "Linear B — 𐀀" in content
    assert "\\u" not in content
    assert json.loads(content)[1]["Name"] == "Greek"


def test_a_filter_is_a_case_insensitive_substring(client: TestClient) -> None:
    body = client.post(
        "/api/export",
        json={
            "dataset": "languages",
            "format": "tsv",
            "filters": {"region": "eurasia"},
        },
    ).json()
    assert body["files"][0]["rowCount"] == 1


def test_a_filter_on_a_column_the_file_lacks_is_ignored(client: TestClient) -> None:
    body = client.post(
        "/api/export",
        json={"dataset": "languages", "format": "tsv", "filters": {"nonsense": "x"}},
    ).json()
    assert body["files"][0]["rowCount"] == 2


# ── The download ─────────────────────────────────────────────────────────────


def test_the_download_is_the_first_file_as_an_attachment(client: TestClient) -> None:
    response = client.get("/api/export/download/writing-systems/csv")
    assert response.status_code == 200
    assert response.headers["content-disposition"] == (
        "attachment; filename=writing-systems.csv"
    )
    assert response.text.startswith("ID,Name,Language_ID,direction,extra")


def test_a_tsv_download_is_served_as_text_csv(client: TestClient) -> None:
    """`format === "json" ? "application/json" : "text/csv"` — a port, not a slip.

    The filename says `.tsv` and the content type says CSV. Fixing it here would
    change behaviour for any client keying off the header.
    """
    response = client.get("/api/export/download/writing-systems/tsv")
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"].endswith("writing-systems.tsv")


def test_a_json_download_says_application_json(client: TestClient) -> None:
    response = client.get("/api/export/download/writing-systems/json")
    assert response.headers["content-type"] == "application/json; charset=utf-8"


def test_a_profile_whose_files_are_all_absent_is_a_404(client: TestClient) -> None:
    response = client.get("/api/export/download/grammar/csv")
    assert response.status_code == 404
    assert response.json() == {"message": "No data to export"}


def test_a_blank_include_files_parameter_is_one_empty_name(client: TestClient) -> None:
    """`"".split(",")` is `[""]`, which is a truthy list of one unknown file."""
    response = client.get("/api/export/download/languages/csv?includeFiles=")
    assert response.status_code == 400
    assert response.json()["errors"] == [
        "File  is not part of dataset languages. "
        "Available: languages.tsv, families.tsv"
    ]


def test_every_other_query_parameter_is_a_column_filter(client: TestClient) -> None:
    response = client.get("/api/export/download/languages/csv?region=AFRICA")
    assert response.text.split("\n")[1:] == ["aa,Afro-Asiatic,AFRICA"]


# ── The service directly ─────────────────────────────────────────────────────


def test_an_unknown_profile_raises_rather_than_exporting_nothing() -> None:
    with pytest.raises(pipeline.UnknownDatasetError) as caught:
        pipeline.export_dataset("banana", "json")
    assert str(caught.value) == (
        "Unknown dataset: banana. Available: "
        "languages, phonology, grammar, etymology, writing-systems"
    )


@pytest.mark.parametrize(
    ("fmt", "extension"),
    [("csv", ".csv"), ("cldf", ".csv"), ("json", ".json"), ("tsv", ".tsv")],
)
def test_the_extension_table(fmt: str, extension: str) -> None:
    assert pipeline.extension_for(fmt) == extension
