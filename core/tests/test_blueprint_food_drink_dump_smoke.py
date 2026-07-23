"""End-to-end offline proof of a whole blueprint built from a **real** dump slice.

US-003: the food-drink blueprint must build from the Wikidata dump slice with no
network — ``generate`` (dump mode) → acquire → normalize → stitch → link → export
→ QA — and the built corpus must load into Neo4j (bulk-import script), export to
Datalog, and answer a real engine query. This is the companion to the fixture-only
``test_wikidata_dump_smoke``: it runs only where an API-composed slice has actually
been built on this machine (see ``docs/wikidata-dump-runbook.md``), so CI and a
fresh checkout — which have no slice — skip the whole module rather than fail it.

To stay fast where it *does* run, it builds a **2-category subset** of food-drink
(dishes + cheeses) rather than all 14 classes; the codepath exercised — the
``DumpSource`` expansion, the corpus build, the exports — is identical. The
acquisition adapter is driven with an HTTP factory that *raises*, so a network
call anywhere in the offline path fails the test loudly.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import yaml

from culturescrape.acquire.factory import build_adapter
from culturescrape.datalog.export import collect_facts
from culturescrape.datalog.materialize import summarize
from culturescrape.datalog.rules import RULES
from culturescrape.orchestrate.corpus import (
    CorpusBuild,
    build_corpus,
    corpus_component_fraction,
    corpus_qa_policy,
)
from culturescrape.orchestrate.generate import DumpSource, generate
from culturescrape.orchestrate.jobs import load_job
from culturescrape.schema.lexicon_reconcile import (
    read_corpus_nodes,
    reconcile_corpus_against_lexicon,
)
from culturescrape.schema.validate import validate_directory

#: Where ``build-slice`` writes by convention (gitignored); overridable by env.
_DEFAULT_SLICE_DIR = Path(__file__).parent.parent / "out" / "wikidata"

#: The temporal rules recompute an O(n^2) span-overlap join every fixpoint round
#: (see ``cli`` ``datalog-materialize --exclude``); skip them in the smoke query.
_ENGINE_ONLY_RULES = frozenset({"contemporary", "precedes", "follows"})


def _resolve_slice() -> Path | None:
    """The real slice to smoke-test, or ``None`` when none is present.

    Mirrors ``test_wikidata_slice_smoke`` / ``test_wikidata_dump_index_smoke``:
    honours ``CULTURESCRAPE_WIKIDATA_SLICE`` (an explicit path), else the newest
    ``*.json``/``*.json.gz``/``*.json.bz2`` in the conventional output dir
    (ignoring ``.manifest.json`` sidecars).
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

#: A 2-class food-drink subset — the same shape the shipped blueprint uses.
_MINI_BLUEPRINT = {
    "defaults": {
        "label": "Dish;CulturalArtifact",
        "dimensions": ["temporal", "geographic", "linguistic"],
        "links": [{"type": "ORIGINATES_FROM", "to": "place"}],
    },
    "categories": [
        {"id": "dishes", "name": "dish", "wikidata_class": "Q746549"},
        {"id": "cheeses", "name": "cheese", "wikidata_class": "Q10943"},
    ],
}


def _raise_no_network():  # type: ignore[no-untyped-def]
    raise AssertionError("the dump pipeline must not open a network connection")


@pytest.fixture(scope="module")
def corpus() -> Iterator[CorpusBuild]:
    """Build the food-drink dump subset once, fully offline, for the module.

    Expands the mini blueprint against the real slice via :func:`generate`'s dump
    mode, then drives :func:`build_corpus` with a network-raising adapter factory
    so any accidental fetch fails. Yields the finished :class:`CorpusBuild`.
    """
    assert _SLICE is not None  # narrowed by skipif; reasserted for the type
    slice_path = _SLICE.resolve()
    sidecar = Path(f"{slice_path}.index.sqlite3")
    index = sidecar if sidecar.exists() else None

    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        blueprint = root / "food-drink-mini.yml"
        blueprint.write_text(yaml.safe_dump(_MINI_BLUEPRINT), encoding="utf-8")
        result = generate(
            blueprint,
            root / "categories",
            job=root / "food-drink-mini.job.yml",
            dump=DumpSource(path=slice_path, index=index, hydrate="default"),
        )
        assert result.job is not None
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


def test_dump_corpus_builds_offline_and_validates(corpus: CorpusBuild) -> None:
    """The whole blueprint acquires offline into schema-valid, connected TSV."""
    assert validate_directory(corpus.dataset_dir) == []
    assert corpus.metrics.node_count > 0
    # The domain links through shared place hubs — one largely-connected graph
    # that clears the default corpus connectivity floor (no relaxation needed).
    assert corpus.connected


def test_dump_corpus_passes_qa_gates(corpus: CorpusBuild) -> None:
    """The corpus clears the enforced corpus QA gates (no violations)."""
    assert corpus.qa.ok, [gate.label for gate in corpus.qa.violations]


def test_dump_corpus_exports_neo4j_and_datalog(corpus: CorpusBuild) -> None:
    """The built corpus yields a Neo4j bulk-import script and a Datalog program."""
    assert corpus.import_plan.script_path.exists()
    assert corpus.import_plan.node_files  # at least one node file to import
    assert corpus.datalog.fact_count > 0


def test_dump_corpus_datalog_engine_answers_smoke_query(
    corpus: CorpusBuild,
) -> None:
    """A real (engine-free) Datalog evaluator derives facts over the corpus.

    Excludes the arithmetic temporal rules (intractable to materialise; derived
    lazily by a real swipl/souffle) and asserts the structural rules produce at
    least one derived tuple — the corpus is queryable, not just exported.
    """
    facts = collect_facts(corpus.dataset_dir)
    rules = tuple(rule for rule in RULES if rule.name not in _ENGINE_ONLY_RULES)
    summary = summarize(facts, rules)
    assert summary.base_relations  # the export projected base relations
    assert summary.derived_total > 0  # and the engine derived new tuples from them


def test_dump_corpus_reconciles_against_curated_lexicon(
    corpus: CorpusBuild, tmp_path: Path
) -> None:
    """Reconciling the corpus against a curated lexicon reports matched/new/ambiguous.

    Seeds a tiny curated lexicon from real corpus node names (guaranteed matches)
    to exercise the offline cascade end to end and prove the summary invariants:
    every acquired row lands matched/new/ambiguous, matched rows collapse onto the
    curated node, and ambiguous rows are withheld from ``union_distinct`` (never
    auto-merged).
    """
    dish_tsv = corpus.dataset_dir / "nodes" / "dish.tsv"
    names = [n["name"] for n in read_corpus_nodes(dish_tsv) if n.get("name")][:3]
    assert len(names) == 3, "expected named dish nodes to seed the lexicon"

    lexicon = tmp_path / "curated-cuisines.tsv"
    rows = "\n".join(f"seed-{i}\t{name}\t" for i, name in enumerate(names))
    lexicon.write_text(f"id\tname\tregion\n{rows}\n", encoding="utf-8")

    _report, summary = reconcile_corpus_against_lexicon(
        dish_tsv,
        lexicon,
        domain="food-drink smoke",
        label="Dish",
        node_type="dish",
    )
    assert summary.matched >= 3  # the seeded curated names re-match their nodes
    assert summary.matched + summary.new + summary.ambiguous == summary.incoming_total
    # union_distinct never counts an ambiguous (withheld) row.
    assert summary.union_distinct == summary.existing_total + summary.new
