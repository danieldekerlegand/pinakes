"""Tests for loading and validating pipeline job configs."""

from pathlib import Path

import pytest

from culturescrape.acquire import CategorySpec
from culturescrape.orchestrate import (
    STAGE_ORDER,
    Job,
    JobConfigError,
    load_job,
)

FIXTURES = Path(__file__).parent / "fixtures" / "jobs"


def test_load_valid_returns_typed_job() -> None:
    job = load_job(FIXTURES / "valid.yml")

    assert isinstance(job, Job)
    assert job.name == "seed-corpus"
    assert job.description == "A small multi-domain corpus run."
    assert len(job.categories) == 1
    assert isinstance(job.categories[0], CategorySpec)
    assert job.categories[0].id == "peruvian-dishes"


def test_stages_are_returned_in_canonical_order() -> None:
    # The fixture declares stages out of order and omits 'link'.
    job = load_job(FIXTURES / "valid.yml")
    assert job.stages == ("acquire", "normalize", "export")


def test_omitted_stages_default_to_full_pipeline(tmp_path: Path) -> None:
    path = tmp_path / "job.yml"
    path.write_text(
        "name: j\ncategories: [c.yml]\noutput_root: out\n", encoding="utf-8"
    )
    (tmp_path / "c.yml").write_text(
        "id: c\nlabel: L\ndescription: d\n"
        "source:\n  type: dump\ndimensions: [temporal]\n",
        encoding="utf-8",
    )

    job = load_job(path)
    assert job.stages == STAGE_ORDER


def test_relative_paths_resolve_against_job_dir(tmp_path: Path) -> None:
    path = tmp_path / "job.yml"
    path.write_text(
        "name: j\ncategories: [c.yml]\noutput_root: out\nstages: [acquire]\n",
        encoding="utf-8",
    )
    (tmp_path / "c.yml").write_text(
        "id: c\nlabel: L\ndescription: d\n"
        "source:\n  type: dump\ndimensions: [temporal]\n",
        encoding="utf-8",
    )

    job = load_job(path)
    assert job.output_root == tmp_path / "out"


def test_output_dir_for_each_stage() -> None:
    job = load_job(FIXTURES / "valid.yml")
    assert job.output_dir("acquire") == job.output_root / "acquire"
    assert job.output_dir("export") == job.output_root / "export"


def test_output_dir_rejects_unrun_stage() -> None:
    job = load_job(FIXTURES / "valid.yml")
    with pytest.raises(ValueError, match="not run by job"):
        job.output_dir("link")


def test_job_is_frozen() -> None:
    job = load_job(FIXTURES / "valid.yml")
    with pytest.raises(AttributeError):
        job.name = "mutated"  # type: ignore[misc]


def test_missing_required_keys_lists_all() -> None:
    with pytest.raises(JobConfigError) as exc:
        load_job(FIXTURES / "invalid_missing_keys.yml")

    message = str(exc.value)
    assert "missing required keys" in message
    assert "name" in message
    assert "categories" in message
    assert "output_root" in message


def test_bad_values_lists_every_problem() -> None:
    with pytest.raises(JobConfigError) as exc:
        load_job(FIXTURES / "invalid_bad_values.yml")

    message = str(exc.value)
    assert "unexpected_key" in message  # unknown top-level key
    assert "teleport" in message  # invalid stage
    assert "duplicate stages: acquire" in message  # acquire listed twice
    # A referenced category that fails to validate surfaces nested.
    assert "categories[0]" in message
    assert "missing required keys" in message


def test_empty_categories_rejected(tmp_path: Path) -> None:
    path = tmp_path / "job.yml"
    path.write_text(
        "name: j\ncategories: []\noutput_root: out\n", encoding="utf-8"
    )
    with pytest.raises(JobConfigError, match="at least one category"):
        load_job(path)


def test_missing_referenced_category_reports_path(tmp_path: Path) -> None:
    path = tmp_path / "job.yml"
    path.write_text(
        "name: j\ncategories: [nope.yml]\noutput_root: out\n", encoding="utf-8"
    )
    with pytest.raises(JobConfigError, match="cannot read category file"):
        load_job(path)


def test_missing_file_raises_clear_error(tmp_path: Path) -> None:
    with pytest.raises(JobConfigError, match="cannot read job file"):
        load_job(tmp_path / "does-not-exist.yml")


def test_invalid_yaml_raises_clear_error(tmp_path: Path) -> None:
    path = tmp_path / "broken.yml"
    path.write_text("name: j\n  bad: : indent\n", encoding="utf-8")
    with pytest.raises(JobConfigError, match="invalid YAML"):
        load_job(path)


def test_non_mapping_top_level_raises(tmp_path: Path) -> None:
    path = tmp_path / "list.yml"
    path.write_text("- not\n- a\n- mapping\n", encoding="utf-8")
    with pytest.raises(JobConfigError, match="expected a YAML mapping"):
        load_job(path)
