"""Offline smoke test for ``culturescrape enrich`` over the fixture corpus.

Drives the whole step end to end against the committed baseline corpus (SPARQL-
style label-only dish nodes) and the fixture dump slice: enrichment must fill the
nodes' missing attributes from the dump and the linkers must turn that depth into
edges in every targeted dimension, all offline.
"""

from __future__ import annotations

import json
from pathlib import Path

from culturescrape import cli
from culturescrape.ontology.metrics import read_dataset
from culturescrape.schema.validate import validate_directory

_CORPUS = Path(__file__).parent / "fixtures" / "enrich-corpus"
_DUMP = Path(__file__).parent / "fixtures" / "wikidata" / "peruvian_dishes_dump.json"


def _run(directory: Path, out: Path) -> int:
    return cli.main(
        [
            "enrich",
            str(directory),
            str(_DUMP),
            "--out",
            str(out),
            "--languages",
            "en,es",
        ]
    )


def test_enrich_fills_attributes_and_links_every_dimension(tmp_path: Path) -> None:
    out = tmp_path / "out"
    assert _run(_CORPUS, out) == 0
    assert validate_directory(out) == []

    nodes, edges = read_dataset(out)
    by_csid = {n["csid"]: n for n in nodes}

    # The baseline carried only label + qid; enrichment fills the depth.
    ceviche = by_csid["cs:dish:Q207058"]
    assert ceviche["time_start"] == "1535"
    assert ceviche["place_qid"] == "Q419"
    assert ceviche["lat"] == "-12.05"
    assert ceviche["aliases"] == ["seviche", "cebiche"]

    # Provenance: the row records it was enriched from the dump.
    assert "enriched" in json.loads(ceviche["extra"])  # type: ignore[arg-type]

    # Every targeted dimension produced registered edges.
    by_type = {str(e[":TYPE"]) for e in edges}
    assert "LOCATED_IN" in by_type  # geographic
    assert "DERIVED_FROM" in by_type  # genetic
    assert "NAMED_IN" in by_type  # linguistic (multilingual names)
    assert {"CONTEMPORARY_WITH", "PRECEDES"} & by_type  # temporal


def test_enrich_metrics_show_the_added_links(tmp_path: Path) -> None:
    out = tmp_path / "out"
    assert _run(_CORPUS, out) == 0
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    # The label-only baseline had no edges; enrichment + linking adds them.
    assert metrics["edge_count"] > 0
    dims = metrics["edges_by_dimension"]
    assert {"geographic", "temporal", "linguistic", "genetic"} <= set(dims)


def test_enrich_is_idempotent(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    assert _run(_CORPUS, first) == 0
    # Re-enriching the already-enriched corpus yields byte-identical TSV.
    assert _run(first, second) == 0
    for name in ("nodes/dish.tsv", "nodes/language.tsv", "edges/named-in.tsv"):
        assert (first / name).read_text(encoding="utf-8") == (
            second / name
        ).read_text(encoding="utf-8")


def test_enrich_rejects_a_missing_directory(tmp_path: Path) -> None:
    assert _run(tmp_path / "nope", tmp_path / "out") == 2


def test_enrich_rejects_an_unknown_profile(tmp_path: Path) -> None:
    code = cli.main(
        [
            "enrich",
            str(_CORPUS),
            str(_DUMP),
            "--out",
            str(tmp_path / "out"),
            "--profile",
            "bogus",
        ]
    )
    assert code == 2
