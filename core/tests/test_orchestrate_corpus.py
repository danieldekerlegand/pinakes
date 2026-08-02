"""Build the seed corpus end to end, offline, from recorded fixtures.

This is the reproducible CI proof for T6-US-008: the *real* shipped job
(``jobs/seed-corpus.yml`` and its ``categories/*.yml``) is driven through the
whole pipeline — acquire, normalize, stitch, link, validate, gate, export — using
recorded raw records instead of the network, so the run is deterministic and
needs no Wikidata/PetScan access. The fixtures under
``tests/fixtures/seed-corpus/`` are a small recorded subset of each category.
"""

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import RawRecord
from culturescrape.datalog.export import (
    PROLOG_PROGRAM_NAME,
    Engine,
)
from culturescrape.neo4j.admin_import import SCRIPT_NAME
from culturescrape.orchestrate import Job, load_job
from culturescrape.orchestrate.corpus import (
    CORPUS_DIRNAME,
    DEFAULT_MIN_COMPONENT_FRACTION,
    CorpusBuild,
    CorpusBuildError,
    build_corpus,
)
from culturescrape.orchestrate.runner import AdapterFactory
from culturescrape.schema.pipeline import read_raw_records
from culturescrape.schema.validate import validate_directory

REPO_ROOT = Path(__file__).resolve().parent.parent
JOB_PATH = REPO_ROOT / "inputs" / "jobs" / "seed-corpus.yml"
FIXTURES = Path(__file__).parent / "fixtures" / "seed-corpus"

#: Every seed category must have a recorded fixture for the offline run.
SEED_CATEGORY_IDS = {
    "peruvian-dishes",
    "italian-sculptures",
    "german-architectural-monuments",
    "us-civil-war-battles",
    "indo-european-languages",
}


class _FixtureAdapter(SourceAdapter):
    """Replays a category's recorded fixture instead of touching the network."""

    name = "fixture"
    source_type = "dump"

    def __init__(self, category_id: str) -> None:
        self._path = FIXTURES / f"{category_id}.jsonl"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from read_raw_records(self._path)


def _fixture_factory() -> AdapterFactory:
    return lambda spec: _FixtureAdapter(spec.id)


def _seed_job(output_root: Path) -> Job:
    return replace(load_job(JOB_PATH), output_root=output_root)


def _build(output_root: Path) -> CorpusBuild:
    return build_corpus(_seed_job(output_root), adapter_factory=_fixture_factory())


def test_every_seed_category_has_a_fixture() -> None:
    # The offline run is only reproducible if each shipped category is recorded.
    recorded = {path.stem for path in FIXTURES.glob("*.jsonl")}
    assert SEED_CATEGORY_IDS <= recorded


def test_corpus_produces_validated_canonical_tsv(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    dataset = build.dataset_dir
    assert dataset == tmp_path / "out" / CORPUS_DIRNAME
    assert any((dataset / "nodes").glob("*.tsv"))
    assert any((dataset / "edges").glob("*.tsv"))
    # Schema validation passes (build_corpus would have raised otherwise, but
    # assert it independently so the criterion is checked, not assumed).
    assert validate_directory(dataset) == []


def test_corpus_passes_quality_gates(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    assert build.qa.ok
    assert build.qa.violations == ()
    # The gates that guard linking correctness must be strictly clean.
    gates = {gate.key: gate for gate in build.qa.gates}
    assert gates["dangling_edge_rate"].value == 0.0
    assert gates["duplicate_rate"].value == 0.0


def test_corpus_is_one_connected_component(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    metrics = build.metrics
    # The seed corpus links every domain through shared place and period hubs,
    # so it collapses into a single component covering every node.
    assert metrics.component_count == 1
    assert metrics.largest_component_fraction == 1.0
    assert metrics.largest_component_fraction >= DEFAULT_MIN_COMPONENT_FRACTION
    assert build.connected
    # The connectivity report is persisted beside the dataset.
    assert (build.dataset_dir / "metrics.json").is_file()


def test_corpus_spans_geographic_and_temporal_dimensions(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    # Cross-dimensional linking wired the corpus together: place hubs
    # (geographic) and period hubs (temporal) both carry connectivity.
    dimensions = build.metrics.edges_by_dimension
    assert dimensions.get("geographic", 0) > 0
    assert dimensions.get("temporal", 0) > 0


def test_corpus_generates_neo4j_import_script(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    script = build.import_plan.script_path
    assert script is not None and script.name == SCRIPT_NAME
    assert script.is_file()
    text = script.read_text(encoding="utf-8")
    assert "neo4j-admin" in text
    # The command references the corpus node and edge files.
    assert build.import_plan.node_files
    assert build.import_plan.edge_files


def test_corpus_generates_datalog_exports(tmp_path: Path) -> None:
    build = _build(tmp_path / "out")

    assert build.datalog.fact_count > 0
    prolog = build.datalog.programs[Engine.SWIPL]
    souffle = build.datalog.programs[Engine.SOUFFLE]
    assert prolog.name == PROLOG_PROGRAM_NAME
    assert prolog.is_file()
    assert souffle.is_file()
    # Soufflé writes one .facts file per relation beside its program.
    assert any(souffle.parent.glob("*.facts"))


def test_corpus_build_is_reproducible(tmp_path: Path) -> None:
    # Same recorded inputs must yield byte-identical canonical TSV across runs,
    # so the corpus is reproducible offline in CI.
    first = _build(tmp_path / "a").dataset_dir
    second = _build(tmp_path / "b").dataset_dir

    def snapshot(root: Path) -> dict[str, str]:
        return {
            str(path.relative_to(root)): path.read_text(encoding="utf-8")
            for path in sorted(root.rglob("*.tsv"))
        }

    assert snapshot(first) == snapshot(second)


def test_corpus_build_fails_when_a_category_cannot_be_acquired(
    tmp_path: Path,
) -> None:
    class _BrokenAdapter(SourceAdapter):
        name = "broken"
        source_type = "dump"

        def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
            raise RuntimeError("network down")
            yield  # pragma: no cover - unreachable, marks this a generator

    with pytest.raises(CorpusBuildError):
        build_corpus(
            _seed_job(tmp_path / "out"),
            adapter_factory=lambda spec: _BrokenAdapter(),
        )
