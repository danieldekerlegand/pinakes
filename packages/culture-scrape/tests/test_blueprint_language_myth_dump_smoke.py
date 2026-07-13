"""End-to-end offline proof of the merged (dump + LinguaScrape) corpus (US-004).

US-004 needs the next shape past the US-003 single-blueprint proof: several dump
domains (language, myth-religion) stitched together *and* merged with the
existing LinguaScrape convergence export, then verified to load into Neo4j
idempotently. This module proves that path where a real slice is present:

* :func:`~culturescrape.orchestrate.merge.write_merged_job` assembles a job over
  a language + myth subset (dump mode) plus the committed LinguaScrape fixture
  export;
* :func:`~culturescrape.orchestrate.corpus.build_corpus` acquires + stitches it
  offline (an HTTP factory that *raises* fails any accidental fetch);
* the merged corpus is schema-valid, carries both native dump nodes and
  LinguaScrape-origin edges, MERGE-loads **idempotently**
  (:func:`~culturescrape.neo4j.merge_load.verify_idempotent_load`), and reconciles
  against a curated lexicon.

Like ``test_blueprint_food_drink_dump_smoke`` it is skipped on a fresh checkout /
CI (no slice). To stay fast it builds a 2-class subset per domain rather than the
whole blueprints.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import yaml

from culturescrape.acquire.factory import build_adapter
from culturescrape.neo4j.merge_load import verify_idempotent_load
from culturescrape.ontology.metrics import read_dataset
from culturescrape.orchestrate.corpus import (
    CorpusBuild,
    build_corpus,
    corpus_component_fraction,
    corpus_qa_policy,
)
from culturescrape.orchestrate.generate import DumpSource
from culturescrape.orchestrate.jobs import load_job
from culturescrape.orchestrate.manifest import build_manifest
from culturescrape.orchestrate.merge import write_merged_job
from culturescrape.schema.lexicon_reconcile import reconcile_corpus_against_lexicon
from culturescrape.schema.validate import validate_directory

#: Where ``build-slice`` writes by convention (gitignored); overridable by env.
_DEFAULT_SLICE_DIR = Path(__file__).parent.parent / "out" / "wikidata"

#: The committed LinguaScrape fixture export (nodes/ + edges/).
_LS_FIXTURE = Path(__file__).parent / "fixtures" / "linguascrape" / "export"


def _resolve_slice() -> Path | None:
    """The real slice to smoke-test, or ``None`` when none is present.

    Mirrors the other real-slice smoke tests (``tests/`` is not a package, so the
    tiny locator is duplicated rather than cross-imported): honours
    ``CULTURESCRAPE_WIKIDATA_SLICE``, else the newest slice in the conventional dir.
    """
    env = os.environ.get("CULTURESCRAPE_WIKIDATA_SLICE")
    if env:
        path = Path(env)
        return path if path.exists() else None
    if not _DEFAULT_SLICE_DIR.is_dir():
        return None
    candidates = [
        p
        for p in _DEFAULT_SLICE_DIR.iterdir()
        if p.is_file()
        and not p.name.endswith(".manifest.json")
        and p.name.endswith((".json", ".json.gz", ".json.bz2"))
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


_SLICE = _resolve_slice()

pytestmark = pytest.mark.skipif(
    _SLICE is None,
    reason="no real Wikidata slice present "
    "(build one with `culturescrape build-slice`; see docs/wikidata-dump-runbook.md)",
)

#: Small language + myth subsets — a couple of classes each keeps acquire cheap.
_LANGUAGE_MINI = {
    "defaults": {"label": "Language", "dimensions": ["linguistic", "geographic"]},
    "categories": [
        {"id": "writing-systems", "name": "writing system", "wikidata_class": "Q8192"},
        {"id": "alphabets", "name": "alphabet", "wikidata_class": "Q9779"},
    ],
}
_MYTH_MINI = {
    "defaults": {
        "label": "Concept;CulturalArtifact",
        "dimensions": ["geographic", "linguistic"],
        "links": [{"type": "ORIGINATES_FROM", "to": "place"}],
    },
    "categories": [
        {"id": "deities", "name": "deity", "wikidata_class": "Q178885"},
        {"id": "demons", "name": "demon", "wikidata_class": "Q177413"},
    ],
}


def _raise_no_network():  # type: ignore[no-untyped-def]
    raise AssertionError("the merged dump pipeline must not open a network connection")


@pytest.fixture(scope="module")
def merged() -> Iterator[CorpusBuild]:
    """Build the language+myth+LinguaScrape merged subset once, fully offline."""
    assert _SLICE is not None
    slice_path = _SLICE.resolve()
    sidecar = Path(f"{slice_path}.index.sqlite3")
    index = sidecar if sidecar.exists() else None

    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        lang = root / "language-mini.yml"
        myth = root / "myth-mini.yml"
        lang.write_text(yaml.safe_dump(_LANGUAGE_MINI), encoding="utf-8")
        myth.write_text(yaml.safe_dump(_MYTH_MINI), encoding="utf-8")

        result = write_merged_job(
            [lang, myth],
            root / "categories",
            root / "merged.job.yml",
            dump=DumpSource(path=slice_path, index=index, hydrate="default"),
            name="merged-mini",
            linguascrape_export=_LS_FIXTURE,
            min_component_fraction=0.0,
            min_provenance_completeness=0.0,
        )
        job = load_job(result.job)

        def factory(spec):  # type: ignore[no-untyped-def]
            return build_adapter(spec, http_factory=_raise_no_network)

        build = build_corpus(
            job,
            adapter_factory=factory,
            force=True,
            workers=2,
            qa=corpus_qa_policy(job),
            min_component_fraction=corpus_component_fraction(job),
        )
        yield build


def test_merged_corpus_builds_offline_and_validates(merged: CorpusBuild) -> None:
    """The merged blueprint+export corpus acquires offline into schema-valid TSV."""
    assert validate_directory(merged.dataset_dir) == []
    assert merged.metrics.node_count > 0


def test_merged_corpus_carries_both_sources(merged: CorpusBuild) -> None:
    """The stitched corpus holds native dump nodes AND LinguaScrape-origin edges."""
    nodes, edges = read_dataset(merged.dataset_dir)
    manifest = build_manifest(merged.name, nodes, edges)
    # LinguaScrape contributed at least one edge to the merged corpus.
    assert manifest.linguascrape_edges_by_type
    # And the dump domains contributed nodes (more than the 4-node LS fixture).
    assert manifest.node_count > 4


def test_merged_corpus_loads_neo4j_idempotently(merged: CorpusBuild) -> None:
    """A MERGE double-load leaves node/edge counts by label/:TYPE unchanged."""
    report = verify_idempotent_load(merged.dataset_dir)
    assert report.idempotent
    # The Entity anchor's tally is the true node total (labels overlap).
    assert report.counts.nodes_by_label["Entity"] == report.node_total
    assert report.node_total == merged.metrics.node_count


def test_merged_corpus_reconciles_against_curated_lexicon(
    merged: CorpusBuild, tmp_path: Path
) -> None:
    """Reconciling a corpus node type against a curated lexicon summary is sound."""
    # Any node file works; reconcile it against a lexicon seeded from its names.
    node_files = sorted((merged.dataset_dir / "nodes").glob("*.tsv"))
    assert node_files, "the merged corpus produced node files"
    from culturescrape.schema.lexicon_reconcile import read_corpus_nodes

    picked = next(
        (p for p in node_files if read_corpus_nodes(p)), node_files[0]
    )
    node_type = picked.stem
    names = [n["name"] for n in read_corpus_nodes(picked) if n.get("name")][:3]
    lexicon = tmp_path / "curated.tsv"
    rows = "\n".join(f"seed-{i}\t{name}\t" for i, name in enumerate(names))
    lexicon.write_text(f"id\tname\tregion\n{rows}\n", encoding="utf-8")

    _report, summary = reconcile_corpus_against_lexicon(
        picked,
        lexicon,
        domain="merged smoke",
        label="Entity",
        node_type=node_type,
    )
    assert summary.matched + summary.new + summary.ambiguous == summary.incoming_total
    assert summary.union_distinct == summary.existing_total + summary.new
