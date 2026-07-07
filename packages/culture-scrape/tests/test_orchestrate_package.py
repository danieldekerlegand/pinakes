"""Tests for packaging a built corpus into a publishable artifact.

The repo is kept lean by publishing corpora as release artifacts rather than
committing them (``docs/storage.md``). These tests pin what ``package_corpus``
produces: a manifest with counts, per-file hashes, and a bundle digest; a
byte-for-byte reproducible archive (so the same corpus always packs identically);
both the job-root and bare-corpus layouts; and the failure when the source is not
a corpus.
"""

from __future__ import annotations

import json
import tarfile
from pathlib import Path

import pytest

from culturescrape import cli
from culturescrape.orchestrate.package import PackageError, package_corpus


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _job_root(tmp_path: Path) -> Path:
    """A minimal job output root: corpus/ + exports + catalog.json."""
    root = tmp_path / "out" / "demo"
    _write(root / "corpus" / "nodes" / "entities.tsv", "csid:ID\tname\nc:1\tA\n")
    _write(root / "corpus" / "edges" / "edges.tsv", ":START_ID\t:END_ID\nc:1\tc:1\n")
    _write(
        root / "corpus" / "metrics.json",
        json.dumps({"node_count": 1, "edge_count": 1}),
    )
    _write(root / "corpus-datalog" / "graph.pl", "node('c:1').\n")
    _write(root / "catalog.json", "{}\n")
    return root


def test_package_writes_archive_and_manifest(tmp_path: Path) -> None:
    result = package_corpus(_job_root(tmp_path), tmp_path / "dist")

    assert result.archive.is_file()
    assert result.manifest.is_file()
    assert result.name == "demo"
    assert result.digest.startswith("sha256:")


def test_manifest_records_node_and_edge_type_counts(tmp_path: Path) -> None:
    # When the corpus carries a CorpusManifest, the published manifest surfaces
    # its per-type breakdown so a downloader sees each :LABEL / :TYPE's share.
    root = _job_root(tmp_path)
    _write(
        root / "corpus" / "manifest.json",
        json.dumps(
            {
                "node_count": 1,
                "edge_count": 1,
                "nodes_by_label": {"Language": 1},
                "edges_by_type": {"BORROWED_FROM": 1},
            }
        ),
    )
    manifest = json.loads(
        package_corpus(root, tmp_path / "dist").manifest.read_text("utf-8")
    )
    assert manifest["nodes_by_label"] == {"Language": 1}
    assert manifest["edges_by_type"] == {"BORROWED_FROM": 1}


def test_manifest_type_counts_default_empty_without_a_corpus_manifest(
    tmp_path: Path,
) -> None:
    # The bare metrics.json fixture has no CorpusManifest, so the type maps are
    # present-but-empty rather than absent (a stable manifest shape).
    manifest = json.loads(
        package_corpus(_job_root(tmp_path), tmp_path / "dist").manifest.read_text(
            "utf-8"
        )
    )
    assert manifest["nodes_by_label"] == {}
    assert manifest["edges_by_type"] == {}


def test_manifest_records_counts_hashes_and_sorted_files(tmp_path: Path) -> None:
    result = package_corpus(_job_root(tmp_path), tmp_path / "dist")

    manifest = json.loads(result.manifest.read_text(encoding="utf-8"))
    assert manifest["node_count"] == 1
    assert manifest["edge_count"] == 1
    paths = [entry["path"] for entry in manifest["files"]]
    # The exports and catalog are bundled alongside the canonical corpus...
    assert "corpus/nodes/entities.tsv" in paths
    assert "corpus-datalog/graph.pl" in paths
    assert "catalog.json" in paths
    # ...listed in sorted order, each with a hash and a byte count.
    assert paths == sorted(paths)
    for entry in manifest["files"]:
        assert len(entry["sha256"]) == 64
        assert entry["bytes"] > 0


def test_archive_is_byte_for_byte_reproducible(tmp_path: Path) -> None:
    root = _job_root(tmp_path)
    first = package_corpus(root, tmp_path / "a")
    second = package_corpus(root, tmp_path / "b")

    assert first.digest == second.digest
    assert first.archive.read_bytes() == second.archive.read_bytes()
    assert first.manifest.read_bytes() == second.manifest.read_bytes()


def test_archive_lays_files_out_under_the_name(tmp_path: Path) -> None:
    result = package_corpus(_job_root(tmp_path), tmp_path / "dist", name="release-1")

    assert result.name == "release-1"
    with tarfile.open(result.archive) as tar:
        names = tar.getnames()
    assert "release-1/manifest.json" in names
    assert "release-1/corpus/nodes/entities.tsv" in names
    # Embedded timestamps are normalized so the bundle is reproducible.
    with tarfile.open(result.archive) as tar:
        assert all(member.mtime == 0 for member in tar.getmembers())


def test_bare_corpus_directory_is_packageable(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _write(corpus / "nodes" / "n.tsv", "csid:ID\nc:1\n")
    _write(corpus / "edges" / "e.tsv", ":START_ID\t:END_ID\nc:1\tc:1\n")

    result = package_corpus(corpus, tmp_path / "dist")

    paths = [entry.path for entry in result.files]
    assert "nodes/n.tsv" in paths
    assert "edges/e.tsv" in paths


def test_counts_absent_without_metrics(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _write(corpus / "nodes" / "n.tsv", "csid:ID\nc:1\n")
    _write(corpus / "edges" / "e.tsv", ":START_ID\t:END_ID\nc:1\tc:1\n")

    manifest = json.loads(
        package_corpus(corpus, tmp_path / "dist").manifest.read_text("utf-8")
    )
    assert manifest["node_count"] is None
    assert manifest["edge_count"] is None


def test_non_corpus_directory_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "empty").mkdir()
    with pytest.raises(PackageError, match="not a corpus"):
        package_corpus(tmp_path / "empty", tmp_path / "dist")

    with pytest.raises(PackageError, match="not a directory"):
        package_corpus(tmp_path / "missing", tmp_path / "dist")


def test_cli_package_end_to_end(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = _job_root(tmp_path)

    exit_code = cli.main(["package", str(root), "--out", str(tmp_path / "dist")])

    assert exit_code == 0
    assert (tmp_path / "dist" / "demo.tar.gz").is_file()
    assert "packaged demo" in capsys.readouterr().out


def test_cli_package_reports_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "empty").mkdir()
    exit_code = cli.main(["package", str(tmp_path / "empty")])

    assert exit_code == 2
    assert "error:" in capsys.readouterr().err
