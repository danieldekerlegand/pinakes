"""Smoke test for the commands in ``docs/quickstart.md``.

The quickstart promises a new user can go from a clean checkout to a queryable
graph by running a fixed sequence of ``culturescrape`` commands. This test runs
that same sequence offline — the network ``fetch`` is replayed from the recorded
seed fixtures (as in ``test_cli_run.py``), and the back half runs against the
ready-made sample corpus the guide uses (``datalog/examples/dataset``) — so a
command that drifts from the doc fails the suite rather than misleading a reader.

Each test maps to a numbered section of the quickstart.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest

from culturescrape import cli
from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import RawRecord
from culturescrape.datalog.examples import (
    ANCESTRY,
    example_file,
    lint_example,
    run_example,
)
from culturescrape.neo4j.admin_import import SCRIPT_NAME
from culturescrape.orchestrate import load_job, runner
from culturescrape.schema.pipeline import read_raw_records

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_FIXTURES = Path(__file__).parent / "fixtures" / "seed-corpus"

#: The bundled sample corpus the quickstart links, imports, exports, and queries.
SAMPLE_CORPUS = REPO_ROOT / "datalog" / "examples" / "dataset"

#: A category whose raw records the quickstart normalizes (§3, stage by stage).
QUICKSTART_CATEGORY = "peruvian-dishes"

#: The seed categories, derived from the shipped ``jobs/seed-corpus.yml`` so the
#: quickstart smoke run mirrors the corpus the guide tells a reader to build.
SEED_CATEGORY_IDS = tuple(
    spec.id for spec in load_job(REPO_ROOT / "jobs" / "seed-corpus.yml").categories
)


class _FixtureAdapter(SourceAdapter):
    """Replays a category's recorded fixture instead of touching the network."""

    name = "fixture"
    source_type = "dump"

    def __init__(self, category_id: str) -> None:
        self._path = SEED_FIXTURES / f"{category_id}.jsonl"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from read_raw_records(self._path)


@pytest.fixture
def offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make ``run`` build fixture-replaying adapters instead of real ones."""
    monkeypatch.setattr(
        runner,
        "build_adapter",
        lambda spec, *, http_factory: _FixtureAdapter(spec.id),
    )


def _write_seed_job(tmp_path: Path) -> Path:
    """Write the seed job pointing at the real categories but a temp output root."""
    categories = "".join(
        f"  - {REPO_ROOT / 'categories' / f'{cid}.yml'}\n"
        for cid in SEED_CATEGORY_IDS
    )
    job = tmp_path / "seed.yml"
    job.write_text(
        "name: seed-corpus\n"
        "description: offline quickstart smoke run\n"
        "categories:\n" + categories + f"output_root: {tmp_path / 'out'}\n",
        encoding="utf-8",
    )
    return job


def test_cli_is_installed() -> None:
    """§1 — ``culturescrape --help`` exits cleanly and lists the run command."""
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["--help"])
    assert excinfo.value.code == 0


def test_run_the_pipeline_one_command(tmp_path: Path, offline: None) -> None:
    """§3 — ``culturescrape run jobs/seed-corpus.yml`` builds the full corpus.

    Stands in for the network ``fetch`` + ``normalize`` + ``link`` + export
    stages the guide describes, replayed from the recorded fixtures.
    """
    assert cli.main(["run", str(_write_seed_job(tmp_path))]) == 0
    corpus = tmp_path / "out" / "corpus"
    assert any((corpus / "nodes").glob("*.tsv"))
    assert any((corpus / "edges").glob("*.tsv"))
    assert (tmp_path / "out" / "corpus-neo4j" / SCRIPT_NAME).is_file()
    assert any((tmp_path / "out" / "corpus-datalog").glob("*.pl"))


def test_normalize_and_validate_a_category(tmp_path: Path) -> None:
    """§3 — normalize a category's raw records, then validate the canonical TSV."""
    raw = SEED_FIXTURES / f"{QUICKSTART_CATEGORY}.jsonl"
    category = REPO_ROOT / "categories" / f"{QUICKSTART_CATEGORY}.yml"
    out = tmp_path / "normalize"

    assert cli.main(
        ["normalize", str(raw), "--category", str(category), "--out", str(out)]
    ) == 0
    assert any((out / "nodes").glob("*.tsv"))
    # `culturescrape validate <dir>` accepts the freshly normalized dataset.
    assert cli.main(["validate", str(out)]) == 0


def test_link_the_sample_corpus(tmp_path: Path) -> None:
    """§3 — ``culturescrape link`` infers cross-dimensional edges and metrics."""
    out = tmp_path / "linked"
    assert cli.main(["link", str(SAMPLE_CORPUS), "--out", str(out)]) == 0
    assert any((out / "nodes").glob("*.tsv"))
    assert (out / "metrics.json").is_file()


def test_import_to_neo4j(tmp_path: Path) -> None:
    """§4 — ``culturescrape to-neo4j`` writes an admin-import script offline."""
    out = tmp_path / "neo4j"
    assert cli.main(["to-neo4j", str(SAMPLE_CORPUS), "--out", str(out)]) == 0
    assert (out / SCRIPT_NAME).is_file()


def test_export_to_datalog(tmp_path: Path) -> None:
    """§5 — ``culturescrape to-datalog`` projects the corpus to both engines."""
    out = tmp_path / "datalog"
    assert cli.main(
        [
            "to-datalog",
            str(SAMPLE_CORPUS),
            "--engine",
            "both",
            "--rules",
            "--out",
            str(out),
        ]
    ) == 0
    assert (out / "graph.pl").is_file()
    assert (out / "graph.dl").is_file()


def test_run_an_example_query(tmp_path: Path) -> None:
    """§6 — the documented example query runs (or, with no engine, lints clean).

    With ``swipl`` installed the query yields exactly the ancestors the doc
    prints; without it, the query file is still validated offline so the step
    cannot reference a relation the schema does not define.
    """
    out = tmp_path / "datalog"
    assert cli.main(
        [
            "to-datalog",
            str(SAMPLE_CORPUS),
            "--engine",
            "swipl",
            "--rules",
            "--out",
            str(out),
        ]
    ) == 0
    query = example_file(ANCESTRY.slug, REPO_ROOT)

    if shutil.which("swipl") is None:
        assert lint_example(query.read_text(encoding="utf-8")) == []
        pytest.skip("swipl not installed; linted the example query instead")

    rows = run_example(out / "graph.pl", query)
    assert rows == ANCESTRY.expected
