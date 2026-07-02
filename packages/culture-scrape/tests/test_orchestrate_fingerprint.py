"""Tests for the stage-input fingerprinting primitives."""

from dataclasses import replace
from pathlib import Path

from culturescrape.acquire.categories import CategorySpec, load_category
from culturescrape.orchestrate.fingerprint import (
    StageManifest,
    combine,
    fingerprint_directory,
    fingerprint_spec,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _spec() -> CategorySpec:
    return load_category(FIXTURES / "categories" / "valid.yml")


def test_spec_fingerprint_is_stable_and_change_sensitive() -> None:
    spec = _spec()
    assert fingerprint_spec(spec) == fingerprint_spec(_spec())
    assert fingerprint_spec(spec) != fingerprint_spec(
        replace(spec, description="something else")
    )
    assert fingerprint_spec(spec) != fingerprint_spec(
        replace(spec, dimensions=(*spec.dimensions, "genetic"))
    )


def test_directory_fingerprint_tracks_content(tmp_path: Path) -> None:
    root = tmp_path / "stage"
    (root / "nodes").mkdir(parents=True)
    (root / "nodes" / "a.tsv").write_text("one\n", encoding="utf-8")
    before = fingerprint_directory(root)

    # Editing a file changes the fingerprint...
    (root / "nodes" / "a.tsv").write_text("two\n", encoding="utf-8")
    assert fingerprint_directory(root) != before

    # ...but the stage manifest is excluded, so writing it does not.
    after_edit = fingerprint_directory(root)
    StageManifest(stage="normalize", input_fingerprint="x", rows=1).write(root)
    assert fingerprint_directory(root) == after_edit


def test_missing_directory_matches_empty_directory(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    assert fingerprint_directory(tmp_path / "absent") == fingerprint_directory(empty)


def test_manifest_round_trips(tmp_path: Path) -> None:
    manifest = StageManifest(stage="link", input_fingerprint="abc123", rows=42)
    manifest.write(tmp_path)
    assert StageManifest.read(tmp_path) == manifest


def test_missing_or_corrupt_manifest_reads_as_none(tmp_path: Path) -> None:
    assert StageManifest.read(tmp_path) is None
    (tmp_path / ".stage.json").write_text("{not json", encoding="utf-8")
    assert StageManifest.read(tmp_path) is None


def test_combine_orders_and_labels_parts() -> None:
    assert combine("a", "b") == combine("a", "b")
    assert combine("a", "b") != combine("b", "a")
