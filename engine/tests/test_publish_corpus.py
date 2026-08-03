"""Tests for publishing ``build/corpus`` as a versioned release artifact (91 US-1).

DVC is gone (``docs/artifact-versioning.md``), so the pinakes → consumer corpus
handoff is a published tarball plus a checksum a downloader can verify. These pin
what ``publish_corpus`` guarantees: a content-addressed ``corpus-<version>.tar.gz``,
a ``sha256sum``-format sidecar, **stability** (re-running over an unchanged corpus
reproduces the version, the bytes and the digest), and a clear no-op when the corpus
has not been exported yet.
"""

from __future__ import annotations

import hashlib
import json
import tarfile
from pathlib import Path

import pytest
import yaml

from pinakes_engine import cli
from pinakes_engine.orchestrate.package import PackageError, corpus_digest
from pinakes_engine.orchestrate.publish import (
    VERSION_LENGTH,
    CorpusMissingError,
    corpus_version,
    default_corpus_dir,
    publish_corpus,
    repo_root,
)

#: The release path that turns a packaged corpus into a private release asset.
WORKFLOW = "publish-corpus.yml"


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _corpus(tmp_path: Path, *, name: str = "corpus", value: str = "A") -> Path:
    """A tiny stand-in for ``build/corpus``: nodes/ + edges/ + its own manifest."""
    root = tmp_path / name
    _write(
        root / "nodes" / "language.tsv",
        f"csid:ID\t:LABEL\tname\tlicense\ncs:language:Q1\tLanguage\t{value}\tCC-BY-4.0\n",
    )
    _write(
        root / "edges" / "descends-from.tsv",
        ":START_ID\t:END_ID\t:TYPE\ncs:language:Q1\tcs:language:Q1\tDESCENDS_FROM\n",
    )
    _write(
        root / "manifest.json",
        json.dumps({"nodes_by_label": {"Language": 1}, "edges_by_type": {}}),
    )
    return root


def test_publishes_a_content_addressed_archive_manifest_and_checksum(
    tmp_path: Path,
) -> None:
    result = publish_corpus(_corpus(tmp_path), tmp_path / "dist")

    assert (
        result.version
        == corpus_digest(_corpus(tmp_path)).removeprefix("sha256:")[:VERSION_LENGTH]
    )
    assert result.name == f"corpus-{result.version}"
    assert result.archive.name == f"corpus-{result.version}.tar.gz"
    assert result.archive.is_file()
    assert result.manifest.is_file()
    assert result.checksum.name == f"corpus-{result.version}.tar.gz.sha256"


def test_checksum_sidecar_is_sha256sum_format_over_the_archive(tmp_path: Path) -> None:
    result = publish_corpus(_corpus(tmp_path), tmp_path / "dist")

    expected = hashlib.sha256(result.archive.read_bytes()).hexdigest()
    assert result.sha256 == expected
    # `sha256sum -c <file>` needs "<hex><2 spaces><name>" and a bare filename, so
    # verification works from the directory the asset was downloaded into.
    assert result.checksum.read_text(encoding="utf-8") == (
        f"{expected}  {result.archive.name}\n"
    )


def test_republishing_an_unchanged_corpus_is_stable(tmp_path: Path) -> None:
    source = _corpus(tmp_path)

    first = publish_corpus(source, tmp_path / "a")
    second = publish_corpus(source, tmp_path / "b")

    assert first.version == second.version
    assert first.sha256 == second.sha256
    assert first.archive.read_bytes() == second.archive.read_bytes()
    assert first.checksum.read_bytes() == second.checksum.read_bytes()


def test_a_changed_corpus_publishes_under_a_different_version(tmp_path: Path) -> None:
    before = publish_corpus(_corpus(tmp_path, name="a"), tmp_path / "dist")
    after = publish_corpus(_corpus(tmp_path, name="b", value="B"), tmp_path / "dist")

    assert before.version != after.version
    assert before.sha256 != after.sha256


def test_an_explicit_version_names_the_artifact(tmp_path: Path) -> None:
    result = publish_corpus(_corpus(tmp_path), tmp_path / "dist", version="2026.08.1")

    assert result.version == "2026.08.1"
    assert result.archive.name == "corpus-2026.08.1.tar.gz"
    assert result.checksum.name == "corpus-2026.08.1.tar.gz.sha256"


def test_archive_keeps_both_the_corpus_manifest_and_the_release_manifest(
    tmp_path: Path,
) -> None:
    # build/corpus ships its OWN top-level manifest.json, so the release manifest
    # moves aside rather than colliding with it (one arcname, two members = the
    # corpus manifest silently wins on extract).
    result = publish_corpus(_corpus(tmp_path), tmp_path / "dist")

    with tarfile.open(result.archive) as tar:
        names = tar.getnames()
        release = tar.extractfile(f"{result.name}/release-manifest.json")
        assert release is not None
        embedded = json.loads(release.read().decode("utf-8"))
    assert f"{result.name}/manifest.json" in names
    assert f"{result.name}/nodes/language.tsv" in names
    assert embedded["digest"] == result.package.digest
    assert embedded == json.loads(result.manifest.read_text(encoding="utf-8"))


def test_missing_corpus_raises_the_distinct_missing_error(tmp_path: Path) -> None:
    with pytest.raises(CorpusMissingError, match="export-for-engine"):
        publish_corpus(tmp_path / "build" / "corpus", tmp_path / "dist")


def test_a_present_but_non_corpus_directory_is_still_a_package_error(
    tmp_path: Path,
) -> None:
    (tmp_path / "empty").mkdir()
    with pytest.raises(PackageError, match="not a corpus"):
        publish_corpus(tmp_path / "empty", tmp_path / "dist")


def test_default_corpus_dir_points_at_the_repo_root_build_corpus() -> None:
    root = default_corpus_dir()
    assert root.parts[-2:] == ("build", "corpus")
    # The walk out of engine/src/pinakes_engine/orchestrate/ must land on the repo
    # root — prove it by a file only the root carries, not by the corpus (gitignored).
    assert (root.parent.parent / "pyproject.toml").is_file()


def test_corpus_version_is_the_digest_prefix(tmp_path: Path) -> None:
    source = _corpus(tmp_path)
    version = corpus_version(source)

    assert len(version) == VERSION_LENGTH
    assert corpus_digest(source).removeprefix("sha256:").startswith(version)


def test_cli_publish_corpus_end_to_end(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = _corpus(tmp_path)

    exit_code = cli.main(
        ["publish-corpus", "--corpus", str(source), "--out", str(tmp_path / "dist")]
    )

    out = capsys.readouterr().out
    assert exit_code == 0
    version = corpus_version(source)
    assert (tmp_path / "dist" / f"corpus-{version}.tar.gz").is_file()
    assert (tmp_path / "dist" / f"corpus-{version}.tar.gz.sha256").is_file()
    assert f"published corpus-{version}" in out


def test_cli_no_ops_when_the_corpus_is_absent(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = cli.main(
        ["publish-corpus", "--corpus", str(tmp_path / "nope"), "--out", str(tmp_path)]
    )

    assert exit_code == 0
    assert "nothing to publish" in capsys.readouterr().out


def test_cli_json_emits_the_release_paths_the_workflow_keys_on(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # `.github/workflows/publish-corpus.yml` reads THIS, not the human print: the tag
    # names the release, the three paths are the assets it uploads, and the sha256
    # goes in the release notes. Keep the keys stable.
    source = _corpus(tmp_path)
    out = tmp_path / "dist"

    exit_code = cli.main(
        ["publish-corpus", "--corpus", str(source), "--out", str(out), "--json"]
    )

    assert exit_code == 0
    summary = json.loads(capsys.readouterr().out)
    version = corpus_version(source)
    assert summary["published"] is True
    assert summary["version"] == version
    assert summary["tag"] == f"corpus-{version}"
    assert summary["sha256"] == hashlib.sha256(
        (out / f"corpus-{version}.tar.gz").read_bytes()
    ).hexdigest()
    for key in ("archive", "checksum", "manifest"):
        assert Path(summary[key]).is_file(), key
    assert summary["files"] == 3
    assert summary["bytes"] > 0


def test_cli_json_no_op_still_emits_json(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # A caller branches on `published`, never on "did I get JSON at all".
    exit_code = cli.main(
        ["publish-corpus", "--corpus", str(tmp_path / "nope"), "--json"]
    )

    assert exit_code == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["published"] is False
    assert "export-for-engine" in summary["reason"]


def _workflow_steps() -> list[dict[str, object]]:
    path = repo_root() / ".github" / "workflows" / WORKFLOW
    # Hard assert, never a skip: this file IS the release path, and a walk that
    # silently misses it would turn every assertion below into a no-op.
    assert path.is_file(), path
    workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
    steps: list[dict[str, object]] = workflow["jobs"]["publish"]["steps"]
    # `on:` parses as the YAML boolean True — the 1.1 gotcha, not a typo here.
    assert "workflow_dispatch" in workflow[True], "publishing must stay deliberate"
    return steps


def test_the_release_workflow_drives_this_cli_with_the_flags_it_needs() -> None:
    # The workflow is only exercised on a manual dispatch, so a renamed flag would
    # otherwise go unnoticed until someone tries to cut a release.
    run = " ".join(str(step.get("run", "")) for step in _workflow_steps())

    assert "publish-corpus" in run
    assert "--require-corpus" in run  # the export ran above; absence is a real failure
    assert "--json" in run  # the machine-readable contract, not the human print
    assert "sha256sum -c" in run  # verified here before a consumer ever pulls it


def test_the_release_workflow_uploads_the_three_assets_to_a_versioned_release() -> None:
    steps = _workflow_steps()
    upload = next(s for s in steps if "gh release" in str(s.get("run", "")))
    run = str(upload["run"])
    env = upload["env"]
    assert isinstance(env, dict)

    # Keyed to the corpus version, and every asset the pull contract promises.
    assert "gh release create" in run and 'create "$TAG"' in run
    assert '"$ARCHIVE" "$CHECKSUM" "$MANIFEST"' in run
    assert {"TAG", "ARCHIVE", "CHECKSUM", "MANIFEST"} <= set(env)
    # Republishing an unchanged corpus hits the same content-addressed tag.
    assert "--clobber" in run
    # `contents: write` is what lets gh create the release at all.
    workflow_permissions = yaml.safe_load(
        (repo_root() / ".github" / "workflows" / WORKFLOW).read_text(encoding="utf-8")
    )["permissions"]
    assert workflow_permissions["contents"] == "write"


def test_cli_require_corpus_turns_absence_into_a_failure(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = cli.main(
        [
            "publish-corpus",
            "--corpus",
            str(tmp_path / "nope"),
            "--require-corpus",
        ]
    )

    assert exit_code == 2
    assert "error:" in capsys.readouterr().err
