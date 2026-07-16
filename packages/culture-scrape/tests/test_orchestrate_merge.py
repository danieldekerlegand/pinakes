"""Unit tests for the merged-corpus job assembler (US-004).

These run in CI with **no** dump slice: they exercise :func:`write_merged_job`'s
assembly — expanding several blueprints in dump mode, appending the Pinakes
export category, and writing one runnable job — using a tiny local blueprint and
a fixture Pinakes export directory. The end-to-end build against the *real*
slice lives in ``test_blueprint_language_myth_dump_smoke`` (skipif-gated).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from culturescrape.orchestrate.generate import DumpSource
from culturescrape.orchestrate.jobs import load_job
from culturescrape.orchestrate.merge import (
    PINAKES_CATEGORY_ID,
    MergeError,
    write_merged_job,
)


def _write_blueprint(path: Path, *, name: str, cid: str, qid: str) -> Path:
    path.write_text(
        "defaults:\n"
        "  label: Concept\n"
        "  dimensions: [geographic, linguistic]\n"
        "categories:\n"
        f"  - {{id: {cid}, name: {name}, wikidata_class: {qid}}}\n",
        encoding="utf-8",
    )
    return path


def _fixture_export(root: Path) -> Path:
    """A minimal canonical export (nodes/ + edges/) the adapter accepts."""
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    (root / "nodes" / "language.tsv").write_text(
        "csid:ID\t:LABEL\tname\tsource\n"
        "cs:language:q1\tLanguage\tLatin\tpinakes\n",
        encoding="utf-8",
    )
    return root


def _dump(tmp_path: Path) -> DumpSource:
    return DumpSource(
        path=tmp_path / "slice.json.gz",
        index=tmp_path / "slice.json.gz.index.sqlite3",
        hydrate="default",
    )


def test_merge_writes_one_job_over_all_blueprint_categories(tmp_path: Path) -> None:
    bp1 = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    bp2 = _write_blueprint(
        tmp_path / "myth.yml", name="deity", cid="deities", qid="Q178885"
    )
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "merged.yml"

    result = write_merged_job(
        [bp1, bp2], out, job_path, dump=_dump(tmp_path), name="merged-dump"
    )

    assert result.job == job_path
    job = load_job(job_path)
    assert job.name == "merged-dump"
    # Both blueprints' categories are stitched by the one job.
    assert {spec.id for spec in job.categories} == {"languages", "deities"}
    # Every category is a dump source (offline), not a live SPARQL query.
    assert all(spec.source.type == "wikidata-dump" for spec in job.categories)


def test_merge_appends_pinakes_export_category(tmp_path: Path) -> None:
    bp = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    export = _fixture_export(tmp_path / "export")
    out = tmp_path / "categories"
    job_path = tmp_path / "jobs" / "merged.yml"

    write_merged_job(
        [bp],
        out,
        job_path,
        dump=_dump(tmp_path),
        pinakes_export=export,
    )

    job = load_job(job_path)
    ids = {spec.id for spec in job.categories}
    assert ids == {"languages", PINAKES_CATEGORY_ID}
    ls = next(s for s in job.categories if s.id == PINAKES_CATEGORY_ID)
    assert ls.source.params.get("adapter") == "pinakes-export"
    # Stored as an absolute path so it resolves independent of the run CWD.
    assert Path(ls.source.query or "").is_absolute()
    assert Path(ls.source.query or "").samefile(export)


def test_merge_writes_corpus_floor_overrides(tmp_path: Path) -> None:
    bp = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    job_path = tmp_path / "jobs" / "merged.yml"
    write_merged_job(
        [bp],
        tmp_path / "categories",
        job_path,
        dump=_dump(tmp_path),
        min_component_fraction=0.12,
        min_provenance_completeness=0.0,
    )
    job = load_job(job_path)
    assert job.min_component_fraction == 0.12
    assert job.min_provenance_completeness == 0.0


def test_merge_requires_at_least_one_blueprint(tmp_path: Path) -> None:
    with pytest.raises(MergeError, match="at least one blueprint"):
        write_merged_job(
            [], tmp_path / "categories", tmp_path / "job.yml", dump=_dump(tmp_path)
        )


def test_merge_rejects_a_non_directory_export(tmp_path: Path) -> None:
    bp = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    missing = tmp_path / "does-not-exist"
    with pytest.raises(MergeError, match="not a directory"):
        write_merged_job(
            [bp],
            tmp_path / "categories",
            tmp_path / "job.yml",
            dump=_dump(tmp_path),
            pinakes_export=missing,
        )


def test_merge_refuses_to_overwrite_without_force(tmp_path: Path) -> None:
    bp = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    job_path = tmp_path / "jobs" / "merged.yml"
    write_merged_job([bp], tmp_path / "categories", job_path, dump=_dump(tmp_path))
    with pytest.raises((MergeError, Exception)):
        write_merged_job(
            [bp], tmp_path / "categories", job_path, dump=_dump(tmp_path)
        )
    # With force it succeeds.
    write_merged_job(
        [bp], tmp_path / "categories", job_path, dump=_dump(tmp_path), force=True
    )


def test_merged_job_enables_tiered_trust_by_default(tmp_path: Path) -> None:
    bp = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    job_path = tmp_path / "jobs" / "merged.yml"
    write_merged_job([bp], tmp_path / "categories", job_path, dump=_dump(tmp_path))
    # A merged corpus is the auto-admission surface: QID-anchored + reference-backed
    # facts admit with a tier label, weaker acquired facts quarantine (US-002).
    assert load_job(job_path).tiered_trust is True


def test_merged_job_can_opt_out_of_tiered_trust(tmp_path: Path) -> None:
    bp = _write_blueprint(
        tmp_path / "language.yml", name="language", cid="languages", qid="Q34770"
    )
    job_path = tmp_path / "jobs" / "merged.yml"
    write_merged_job(
        [bp],
        tmp_path / "categories",
        job_path,
        dump=_dump(tmp_path),
        tiered_trust=False,
    )
    assert load_job(job_path).tiered_trust is False
