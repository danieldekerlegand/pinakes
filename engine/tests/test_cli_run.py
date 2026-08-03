"""Tests for the ``pinakes_engine run`` top-level orchestration command.

``run`` is the single entrypoint that drives a whole job: the full pipeline
assembles, links, validates, gates, and exports the stitched corpus (US-008),
while a stage subset runs only those per-category stages. The seed run is
exercised offline by replaying the recorded fixtures under
``tests/fixtures/seed-corpus/`` (the same fixtures the US-008 corpus test uses),
so invoking ``run`` on the seed job reproduces its outputs without the network.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from pinakes_engine import cli
from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.neo4j.admin_import import SCRIPT_NAME
from pinakes_engine.orchestrate import load_job, runner
from pinakes_engine.schema.pipeline import read_raw_records

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).parent / "fixtures" / "seed-corpus"

#: The seed categories, in the order the shipped job declares them — derived from
#: the real ``jobs/seed-corpus.yml`` so the offline run mirrors what ships and a
#: new seed domain is exercised here the moment it is added to the job.
SEED_CATEGORY_IDS = tuple(
    spec.id
    for spec in load_job(REPO_ROOT / "inputs" / "jobs" / "seed-corpus.yml").categories
)


class _FixtureAdapter(SourceAdapter):
    """Replays a category's recorded fixture instead of touching the network."""

    name = "fixture"
    source_type = "dump"

    def __init__(self, category_id: str) -> None:
        self._path = FIXTURES / f"{category_id}.jsonl"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from read_raw_records(self._path)


@pytest.fixture
def offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the runner build fixture-replaying adapters instead of real ones."""
    monkeypatch.setattr(
        runner,
        "build_adapter",
        lambda spec, *, http_factory: _FixtureAdapter(spec.id),
    )


def _write_seed_job(tmp_path: Path) -> Path:
    """Write a seed job pointing at the real categories but a temp output root."""
    job = tmp_path / "seed.yml"
    categories = "".join(
        f"  - {REPO_ROOT / 'inputs' / 'categories' / f'{cid}.yml'}\n"
        for cid in SEED_CATEGORY_IDS
    )
    job.write_text(
        "name: seed-corpus\n"
        "description: offline seed run\n"
        "categories:\n" + categories + f"output_root: {tmp_path / 'out'}\n",
        encoding="utf-8",
    )
    return job


def test_run_seed_job_reproduces_us008_outputs(
    tmp_path: Path, offline: None, capsys: pytest.CaptureFixture[str]
) -> None:
    job = _write_seed_job(tmp_path)

    exit_code = cli.main(["run", str(job)])

    assert exit_code == 0
    out = tmp_path / "out"
    # Canonical corpus TSV (nodes + edges), validated and gated.
    assert any((out / "corpus" / "nodes").glob("*.tsv"))
    assert any((out / "corpus" / "edges").glob("*.tsv"))
    assert (out / "corpus" / "metrics.json").is_file()
    assert (out / "corpus" / "qa.json").is_file()
    # Neo4j import script and Datalog exports for the corpus.
    assert (out / "corpus-neo4j" / SCRIPT_NAME).is_file()
    assert any((out / "corpus-datalog").glob("*.pl"))
    assert any((out / "corpus-datalog").glob("*.dl"))

    summary = capsys.readouterr().out
    assert "corpus seed-corpus" in summary
    assert "connected" in summary


def test_run_validates_against_the_direct_corpus_build(
    tmp_path: Path, offline: None
) -> None:
    # The CLI run must be byte-identical to building the corpus directly, so the
    # CLI is a thin shell over build_corpus, not a divergent path.
    from dataclasses import replace

    from pinakes_engine.orchestrate import load_job
    from pinakes_engine.orchestrate.corpus import build_corpus

    direct = build_corpus(
        replace(load_job(_write_seed_job(tmp_path)), output_root=tmp_path / "direct"),
        adapter_factory=lambda spec: _FixtureAdapter(spec.id),
    )

    assert cli.main(["run", str(_write_seed_job(tmp_path))]) == 0

    def snapshot(root: Path) -> dict[str, str]:
        return {
            str(path.relative_to(root)): path.read_text(encoding="utf-8")
            for path in sorted(root.rglob("*.tsv"))
        }

    assert snapshot(tmp_path / "out" / "corpus") == snapshot(direct.dataset_dir)


def test_run_with_stage_subset_skips_corpus_assembly(
    tmp_path: Path, offline: None
) -> None:
    job = _write_seed_job(tmp_path)

    exit_code = cli.main(["run", str(job), "--stages", "acquire", "normalize"])

    assert exit_code == 0
    out = tmp_path / "out"
    # The requested per-category stages ran...
    assert (out / "acquire" / "peruvian-dishes" / "records.jsonl").is_file()
    assert any((out / "normalize" / "peruvian-dishes" / "nodes").glob("*.tsv"))
    # ...but the corpus was not stitched, linked, or exported.
    assert not (out / "corpus").exists()
    assert not (out / "corpus-neo4j").exists()


def test_run_force_recomputes(tmp_path: Path, offline: None) -> None:
    job = _write_seed_job(tmp_path)
    assert cli.main(["run", str(job), "--stages", "acquire"]) == 0
    # A second --force run still succeeds (recomputes rather than skipping).
    assert cli.main(["run", str(job), "--stages", "acquire", "--force"]) == 0


def test_run_unreadable_job_exits_with_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = cli.main(["run", str(tmp_path / "missing.yml")])

    assert exit_code == 2
    assert "error:" in capsys.readouterr().err


def test_help_lists_every_subcommand(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["--help"])

    assert excinfo.value.code == 0
    text = capsys.readouterr().out
    for command in (
        "fetch",
        "normalize",
        "link",
        "to-neo4j",
        "from-neo4j",
        "to-datalog",
        "run",
        "catalog",
        "validate",
    ):
        assert command in text
