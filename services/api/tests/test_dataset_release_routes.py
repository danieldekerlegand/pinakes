"""`/api/dataset/*` — versioned, citable snapshots of the whole corpus.

The semver half is pure and is tested directly; the routes are tested for the
three things an adapter decides: what a junk parameter coerces to, where the
version comes from, and that **every** failure is a 400 carrying the thrown
message.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.contributions import changelog
from pinakes.dataset import export as pipeline
from pinakes.routers import _release

WRITING_SYSTEMS = "\n".join(
    ["id\tname\tlanguage_id", "latin\tLatin\tlat", "greek\tGreek\tell"]
)
GRAMMAR = "\n".join(["id\tlanguage_id\tword_order", "g1\tlat\tSOV"])


@pytest.fixture
def client(isolated_data_trees: dict[str, Path]) -> TestClient:
    lexicons: Path = isolated_data_trees["lexicons"]
    (lexicons / "writing-systems.tsv").write_text(
        WRITING_SYSTEMS + "\n", encoding="utf-8"
    )
    (lexicons / "grammar-features.tsv").write_text(GRAMMAR + "\n", encoding="utf-8")
    return TestClient(create_app(client_directory=Path("/nonexistent")))


def _log(kind: str, count: int = 1) -> None:
    for index in range(count):
        changelog.record_change(
            {"domain": "languages", "changeType": kind, "source": "test"},
            entry_id=f"{kind}-{index}",
            now=f"2026-01-0{index % 9 + 1}T00:00:00.000Z",
        )


# ── Semver, pure ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("version", "parsed"),
    [
        ("1.2.3", (1, 2, 3)),
        ("  0.0.0  ", (0, 0, 0)),
        ("1.2", None),
        ("1.2.3.4", None),
        ("v1.2.3", None),
        ("", None),
        (None, None),
        ("١.٢.٣", None),
    ],
)
def test_parse_semver(version: Any, parsed: tuple[int, int, int] | None) -> None:
    """The last case is why the pattern is `[0-9]`: Python's `\\d` is Unicode-wide."""
    assert pipeline.parse_semver(version) == parsed


@pytest.mark.parametrize(
    ("counts", "level", "bumped"),
    [
        ({"added": 0, "modified": 0, "removed": 0}, "patch", "1.2.4"),
        ({"added": 0, "modified": 9, "removed": 0}, "patch", "1.2.4"),
        ({"added": 1, "modified": 0, "removed": 0}, "minor", "1.3.0"),
        ({"added": 5, "modified": 5, "removed": 1}, "major", "2.0.0"),
    ],
)
def test_the_bump_a_changelog_implies(
    counts: dict[str, int], level: str, bumped: str
) -> None:
    assert pipeline.determine_version_bump(counts) == level
    assert pipeline.next_version_from_changelog("1.2.3", counts) == bumped


def test_a_malformed_previous_version_throws_by_name() -> None:
    with pytest.raises(ValueError, match="^Invalid semver: 3.1$"):
        pipeline.bump_version("3.1", "patch")


# ── Coercion ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "fmt"),
    [("csv", "csv"), ("cldf", "cldf"), ("xml", "json"), ("", "json"), (None, "json")],
)
def test_an_unrecognised_format_silently_becomes_json(raw: Any, fmt: str) -> None:
    assert _release.parse_format(raw) == fmt


@pytest.mark.parametrize(
    ("raw", "parsed"),
    [
        ("grammar,writing-systems", ["grammar", "writing-systems"]),
        (" grammar , ", ["grammar"]),
        ("", None),
        (None, None),
        ([], None),
        ([7, "grammar", ""], ["grammar"]),
        ([7], None),
    ],
)
def test_asking_for_no_datasets_gets_you_every_dataset(
    raw: Any, parsed: list[str] | None
) -> None:
    assert _release.parse_datasets(raw) == parsed


# ── The routes ───────────────────────────────────────────────────────────────


def test_the_get_reports_the_seed_version_and_the_row_counts(
    client: TestClient,
) -> None:
    body = client.get("/api/dataset/release?datasets=writing-systems").json()
    assert body["version"] == pipeline.DATASET_RELEASE_VERSION
    assert body["license"] == "CC-BY-4.0"
    assert body["doi"] is None
    assert body["datasets"] == [
        {
            "id": "writing-systems",
            "name": "Writing Systems",
            "fileCount": 1,
            "totalRows": 2,
        }
    ]
    assert body["fileCount"] == 1
    assert body["totalRows"] == 2


def test_the_per_dataset_name_has_the_export_prefix_stripped(
    client: TestClient,
) -> None:
    body = client.get("/api/dataset/release?datasets=grammar").json()
    assert body["datasets"][0]["name"] == "Grammatical Features"


def test_an_unknown_dataset_is_a_400_carrying_the_thrown_message(
    client: TestClient,
) -> None:
    response = client.get("/api/dataset/release?datasets=banana")
    assert response.status_code == 400
    assert response.json()["message"].startswith("Unknown dataset: banana. Available:")


def test_the_full_download_is_an_attachment_named_after_the_version(
    client: TestClient,
) -> None:
    response = client.get("/api/dataset/full?datasets=writing-systems&format=tsv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="pinakes-dataset-v1.0.0.json"'
    )
    body = json.loads(response.text)
    assert body["metadata"]["format"] == "tsv"
    assert body["files"][0]["filename"] == "writing-systems.tsv"
    # `JSON.stringify(snapshot, null, 2)`.
    assert response.text.startswith('{\n  "metadata": {\n    ')


def test_the_post_derives_its_version_from_the_changelog(client: TestClient) -> None:
    _log("added", 2)
    response = client.post(
        "/api/dataset/release", json={"datasets": ["writing-systems"]}
    )
    assert response.status_code == 201
    assert response.json()["version"] == "1.1.0"


def test_a_removal_in_the_changelog_makes_it_a_major(client: TestClient) -> None:
    _log("removed")
    body = client.post(
        "/api/dataset/release",
        json={"datasets": ["writing-systems"], "previousVersion": "4.5.6"},
    ).json()
    assert body["version"] == "5.0.0"


def test_an_explicit_version_wins_and_never_reads_the_changelog(
    client: TestClient,
) -> None:
    _log("removed", 3)
    body = client.post(
        "/api/dataset/release",
        json={"version": "2.4.9", "datasets": ["writing-systems"]},
    ).json()
    assert body["version"] == "2.4.9"


def test_an_empty_changelog_is_a_patch_re_release(client: TestClient) -> None:
    body = client.post(
        "/api/dataset/release", json={"datasets": ["writing-systems"]}
    ).json()
    assert body["version"] == "1.0.1"


def test_a_malformed_previous_version_is_a_400(client: TestClient) -> None:
    response = client.post(
        "/api/dataset/release",
        json={"previousVersion": "3.1", "datasets": ["writing-systems"]},
    )
    assert response.status_code == 400
    assert response.json() == {"message": "Invalid semver: 3.1"}


def test_no_doi_is_minted_without_a_zenodo_token(client: TestClient) -> None:
    body = client.post(
        "/api/dataset/release", json={"datasets": ["writing-systems"]}
    ).json()
    assert body["doi"] is None
    assert body["doiUrl"] is None


def test_a_configured_minter_stamps_the_metadata() -> None:
    """The minter is applied *after* assembly, so it can only add the two keys."""
    minted = pipeline.build_dataset_snapshot(
        datasets=["writing-systems"],
        doi_minter=lambda _m: {"doi": "10.5281/zenodo.1", "doiUrl": "https://doi.org/x"},
        now=lambda: "2026-01-01T00:00:00.000Z",
    )
    assert minted["metadata"]["doi"] == "10.5281/zenodo.1"
    assert minted["metadata"]["doiUrl"] == "https://doi.org/x"


def test_the_null_minter_leaves_the_doi_alone() -> None:
    assert pipeline.null_doi_minter({"title": "x"}) is None
