"""`/api/import/*` — pasted CSV/TSV appended to, or replacing, a lexicon file.

The only route group in this service that writes a lexicon row with no review
step, so most of what is pinned here is about *what ends up on disk*: the backup
that is always taken, the header remap, the dedup key, and the trailing-newline
repair that makes an append safe on a file that was missing one.

`conftest.py`'s autouse `isolated_data_trees` is what keeps these writes off the
live corpus. Do not write a case here that resolves the real lexicons directory.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.dataset import bulk_import as importer

TARGET = "\n".join(
    [
        "id\tname\tlanguage_id\tdirection",
        "latin\tLatin\tlat\tltr",
        "greek\tGreek\tell\tltr",
    ]
)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons: Path = isolated_data_trees["lexicons"]
    (lexicons / "writing-systems.tsv").write_text(TARGET + "\n", encoding="utf-8")
    (lexicons / "families.tsv").write_text("id\tname\nie\tIndo-European\n", "utf-8")
    return lexicons


@pytest.fixture
def client(corpus: Path) -> TestClient:
    return TestClient(create_app(client_directory=Path("/nonexistent")))


def _rows(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").rstrip("\n").split("\n")


# ── Targets ──────────────────────────────────────────────────────────────────


def test_the_targets_are_every_tsv_with_its_header(client: TestClient) -> None:
    body = client.get("/api/import/targets").json()
    assert [entry["file"] for entry in body] == [
        "families.tsv",
        "writing-systems.tsv",
    ]
    assert body[1]["headers"] == ["id", "name", "language_id", "direction"]


def test_a_missing_corpus_is_a_500_not_an_empty_list(
    isolated_data_trees: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`readdir` threw; an empty list would claim the corpus admits no imports."""
    monkeypatch.setenv("PINAKES_LEXICONS_DIR", "/nonexistent/lexicons")
    client = TestClient(create_app(client_directory=Path("/nonexistent")))
    response = client.get("/api/import/targets")
    assert response.status_code == 500
    assert response.json() == {"message": "Failed to list import targets"}


# ── Refusals ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"content": "a\tb", "mode": "append"}, "Missing required field: target"),
        ({"target": "x.tsv", "mode": "append"}, "Missing required field: content"),
        (
            {"target": "x.tsv", "content": "a", "mode": "upsert"},
            "Mode must be 'append' or 'replace'",
        ),
        (
            {"target": "x.tsv", "content": "a"},
            "Mode must be 'append' or 'replace'",
        ),
    ],
)
def test_the_body_is_validated_field_by_field(
    client: TestClient, body: dict[str, str], message: str
) -> None:
    response = client.post("/api/import/bulk", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": message}


@pytest.mark.parametrize(
    "target", ["../evil.tsv", "sub/evil.tsv", "evil.csv", "writing-systems.tsv.bak"]
)
def test_a_target_outside_the_corpus_is_refused_before_anything_is_read(
    client: TestClient, target: str
) -> None:
    body = client.post(
        "/api/import/bulk",
        json={"target": target, "content": "id\nx", "mode": "append"},
    ).json()
    assert body["errors"] == [f"Invalid target file: {target}"]
    assert "backupPath" not in body


def test_a_target_that_does_not_exist_names_itself(client: TestClient) -> None:
    body = client.post(
        "/api/import/bulk",
        json={"target": "nope.tsv", "content": "id\nx", "mode": "append"},
    ).json()
    assert body["errors"] == ["Target file does not exist: nope.tsv"]


def test_nothing_matching_lists_the_targets_own_header(client: TestClient) -> None:
    response = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "zzz\tyyy\n1\t2",
            "mode": "append",
        },
    )
    assert response.status_code == 400
    assert response.json()["errors"] == [
        "No matching columns found. Expected: id, name, language_id, direction"
    ]


def test_a_header_with_no_rows_is_refused(client: TestClient) -> None:
    body = client.post(
        "/api/import/bulk",
        json={"target": "writing-systems.tsv", "content": "id\tname", "mode": "append"},
    ).json()
    assert body["errors"] == ["No data rows found in import data"]


# ── Append ───────────────────────────────────────────────────────────────────


def test_a_csv_paste_is_remapped_by_header_name_and_trimmed(
    client: TestClient, corpus: Path
) -> None:
    """Column *order* is irrelevant and `direction` is filled blank."""
    response = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "name,id\n Cuneiform ,cune\nLinear B,linb",
            "mode": "append",
        },
    )
    assert response.status_code == 200
    assert response.json()["rowsImported"] == 2
    assert _rows(corpus / "writing-systems.tsv")[3:] == [
        "cune\tCuneiform\t\t",
        "linb\tLinear B\t\t",
    ]


def test_an_unmapped_column_is_a_warning_that_still_answers_200(
    client: TestClient,
) -> None:
    """The `errors[]` array carries two kinds of thing; the prefix is the tell."""
    response = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\tbogus\ncune\tCuneiform\tx",
            "mode": "append",
        },
    )
    assert response.status_code == 200
    assert response.json()["errors"] == ["Unmapped columns (ignored): bogus"]
    assert response.json()["rowsImported"] == 1


def test_duplicate_ids_are_skipped_against_the_file_and_against_the_batch(
    client: TestClient,
) -> None:
    body = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\nlatin\tAgain\ncune\tOne\ncune\tTwo",
            "mode": "append",
        },
    ).json()
    assert body["rowsImported"] == 1
    assert body["rowsSkipped"] == 2


def test_skip_duplicates_false_lets_a_repeat_through(
    client: TestClient, corpus: Path
) -> None:
    body = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\nlatin\tAgain",
            "mode": "append",
            "skipDuplicates": False,
        },
    ).json()
    assert body["rowsImported"] == 1
    assert _rows(corpus / "writing-systems.tsv")[-1] == "latin\tAgain\t\t"


def test_anything_but_a_literal_false_still_dedups(client: TestClient) -> None:
    """`skipDuplicates !== false` — `null`, `0` and `"no"` all mean *do* skip."""
    for value in (None, 0, "no"):
        body = client.post(
            "/api/import/bulk",
            json={
                "target": "writing-systems.tsv",
                "content": "id\tname\nlatin\tAgain",
                "mode": "append",
                "skipDuplicates": value,
            },
        ).json()
        assert body["rowsSkipped"] == 1, value


def test_a_file_with_no_trailing_newline_is_topped_up_before_the_append(
    client: TestClient, corpus: Path
) -> None:
    target = corpus / "writing-systems.tsv"
    target.write_text(TARGET, encoding="utf-8")
    client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\ncune\tCuneiform",
            "mode": "append",
        },
    )
    assert _rows(target) == [
        "id\tname\tlanguage_id\tdirection",
        "latin\tLatin\tlat\tltr",
        "greek\tGreek\tell\tltr",
        "cune\tCuneiform\t\t",
    ]


def test_dedup_does_nothing_when_no_incoming_column_feeds_the_id(
    client: TestClient,
) -> None:
    """The dedup key is *target column 0*, so a paste without it cannot dedup."""
    body = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "name\tdirection\nLatin\tltr\nLatin\tltr",
            "mode": "append",
        },
    ).json()
    assert body["rowsImported"] == 2
    assert body["rowsSkipped"] == 0


# ── Replace ──────────────────────────────────────────────────────────────────


def test_replace_rewrites_the_table_and_keeps_the_targets_header(
    client: TestClient, corpus: Path
) -> None:
    body = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\nonly\tOnly one",
            "mode": "replace",
        },
    ).json()
    assert body["rowsImported"] == 1
    assert _rows(corpus / "writing-systems.tsv") == [
        "id\tname\tlanguage_id\tdirection",
        "only\tOnly one\t\t",
    ]


def test_replace_leaves_no_tmp_file_behind(client: TestClient, corpus: Path) -> None:
    client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\nonly\tOnly",
            "mode": "replace",
        },
    )
    assert not (corpus / "writing-systems.tsv.tmp").exists()


# ── The backup ───────────────────────────────────────────────────────────────


def test_every_write_is_backed_up_first_and_the_response_names_it(
    client: TestClient, corpus: Path
) -> None:
    body = client.post(
        "/api/import/bulk",
        json={
            "target": "writing-systems.tsv",
            "content": "id\tname\nonly\tOnly",
            "mode": "replace",
        },
    ).json()
    backup = Path(str(body["backupPath"]))
    assert backup.parent == corpus / ".backups"
    assert backup.name.startswith("writing-systems_")
    assert backup.read_text(encoding="utf-8") == TARGET + "\n"


def test_the_backup_stamp_has_no_colons_or_dots(corpus: Path) -> None:
    result = importer.bulk_import(
        target="writing-systems.tsv",
        content="id\tname\nonly\tOnly",
        mode="replace",
        stamp="2026-08-05T12:34:56.789Z",
    )
    assert Path(str(result["backupPath"])).name == (
        "writing-systems_2026-08-05T12-34-56-789Z.tsv"
    )


# ── The 400/200 discriminator ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("errors", "blocking"),
    [
        ([], False),
        (["Unmapped columns (ignored): bogus"], False),
        (["Target file does not exist: x.tsv"], True),
        (["Unmapped columns (ignored): a", "No data rows found in import data"], True),
    ],
)
def test_only_an_unmapped_columns_warning_still_answers_200(
    errors: list[str], blocking: bool
) -> None:
    assert importer.has_blocking_errors(errors) is blocking


# ── The delimiter sniff ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("header", "delimiter"),
    [
        ("a\tb\tc", "\t"),
        ("a,b,c", ","),
        ("a", "\t"),
        ("a,b\tc", "\t"),
        ("a,b,c\td", ","),
    ],
)
def test_tab_wins_ties(header: str, delimiter: str) -> None:
    """`tabs >= commas`, so a single-column paste with no comma reads as TSV."""
    assert importer.detect_delimiter(header) == delimiter
