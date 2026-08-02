"""US-008: the reproducible pinakes convergence build.

Drives the *real* shipped job (``jobs/pinakes.yml`` +
``categories/pinakes.yml``) through the whole corpus pipeline — acquire,
normalize, stitch, link, validate, gate, export — from the committed fixture
export, so the run is deterministic and offline (the ``pinakes-export``
adapter reads a local directory; no network). It proves the recipe end to end
and pins the corpus shape against the committed manifest snapshot.
"""

import json
from dataclasses import replace
from pathlib import Path

import pytest

from culturescrape.datalog.export import Engine
from culturescrape.orchestrate import Job, load_job
from culturescrape.orchestrate.corpus import (
    CorpusBuild,
    build_corpus,
    corpus_component_fraction,
    corpus_qa_policy,
)
from culturescrape.orchestrate.jobs import JobConfigError, _parse_fraction
from culturescrape.orchestrate.manifest import manifest_for_dataset
from culturescrape.schema.validate import validate_directory

REPO_ROOT = Path(__file__).resolve().parent.parent
JOB_PATH = REPO_ROOT / "inputs" / "jobs" / "pinakes.yml"
FIXTURE_EXPORT = REPO_ROOT / "tests" / "fixtures" / "pinakes" / "export"
COMMITTED_MANIFEST = REPO_ROOT / "docs" / "convergence-manifest.json"


def _job(output_root: Path) -> Job:
    """The shipped job, retargeted at the absolute fixture export + *output_root*.

    The category's ``source.query`` is a package-root-relative path; making it
    absolute lets the build run from any working directory (pytest's included).
    """
    job = load_job(JOB_PATH)
    (category,) = job.categories
    category = replace(
        category, source=replace(category.source, query=str(FIXTURE_EXPORT))
    )
    return replace(job, categories=(category,), output_root=output_root)


def _build(output_root: Path) -> CorpusBuild:
    job = _job(output_root)
    return build_corpus(
        job,
        qa=corpus_qa_policy(job),
        min_component_fraction=corpus_component_fraction(job),
    )


def test_shipped_job_declares_relaxed_corpus_floors() -> None:
    # The recipe is self-contained: the floors that let a pinakes-only
    # corpus pass live in the committed job, not in a hand-typed CLI flag.
    job = load_job(JOB_PATH)
    assert job.min_provenance_completeness == 0.0
    assert job.min_component_fraction == 0.5


def test_build_produces_validated_canonical_tsv(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    dataset = build.dataset_dir
    assert any((dataset / "nodes").glob("*.tsv"))
    assert any((dataset / "edges").glob("*.tsv"))
    # `culturescrape validate` passes (asserted independently of the build gate).
    assert validate_directory(dataset) == []


def test_build_passes_quality_gates(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    assert build.qa.ok
    assert build.qa.violations == ()
    gates = {gate.key: gate for gate in build.qa.gates}
    # The correctness gates stay strictly clean, and the pinakes-scoped
    # provenance gate confirms every pinakes row keeps its source stamp.
    assert gates["dangling_edge_rate"].value == 0.0
    assert gates["duplicate_rate"].value == 0.0
    assert gates["pinakes_provenance_completeness"].value == 1.0


def test_build_generates_neo4j_and_datalog_exports(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    script_path = build.import_plan.script_path
    assert script_path is not None
    assert script_path.is_file()
    assert build.datalog.fact_count > 0
    assert build.datalog.programs[Engine.SWIPL].is_file()
    assert build.datalog.programs[Engine.SOUFFLE].is_file()


def test_build_writes_manifest_matching_committed_snapshot(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    written = json.loads((build.dataset_dir / "manifest.json").read_text("utf-8"))
    committed = json.loads(COMMITTED_MANIFEST.read_text("utf-8"))
    # The committed fingerprint must match a fresh build, so a corpus that
    # silently gains/drops a node or edge type fails CI.
    assert written == committed
    # It records node/edge type counts and the pinakes-origin edge subset.
    assert written["nodes_by_label"]
    assert written["edges_by_type"]
    assert written["pinakes_edges_by_type"] == {"DESCENDS_FROM": 1}


def test_manifest_for_dataset_reproduces_the_written_manifest(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    reread = manifest_for_dataset(build.name, build.dataset_dir).to_dict()
    written = json.loads((build.dataset_dir / "manifest.json").read_text("utf-8"))
    assert reread == written


def test_build_is_idempotent(tmp_path: Path) -> None:
    first = _build(tmp_path / "a")
    second = _build(tmp_path / "b")

    # Re-minted csids and byte-stable output make the corpus deterministic.
    a = (first.dataset_dir / "manifest.json").read_text("utf-8")
    b = (second.dataset_dir / "manifest.json").read_text("utf-8")
    assert a == b


@pytest.mark.parametrize("bad", [-0.1, 1.5, "0.5", True])
def test_parse_fraction_rejects_out_of_range_or_non_numbers(bad: object) -> None:
    errors: list[str] = []
    assert _parse_fraction(bad, "min_component_fraction", errors) is None
    assert errors


def test_parse_fraction_accepts_bounds_and_none() -> None:
    errors: list[str] = []
    assert _parse_fraction(None, "x", errors) is None
    assert _parse_fraction(0, "x", errors) == 0.0
    assert _parse_fraction(1, "x", errors) == 1.0
    assert _parse_fraction(0.5, "x", errors) == 0.5
    assert not errors


def test_load_job_rejects_an_out_of_range_fraction(tmp_path: Path) -> None:
    category = REPO_ROOT / "inputs" / "categories" / "pinakes.yml"
    path = tmp_path / "bad.yml"
    path.write_text(
        "name: bad\n"
        f"categories: ['{category}']\n"
        "output_root: ./out\n"
        "min_component_fraction: 2\n",
        encoding="utf-8",
    )
    with pytest.raises(JobConfigError, match="min_component_fraction"):
        load_job(path)
