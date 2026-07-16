"""Unit + snapshot tests for the triple-verbalization generator (US-002).

Unit tests drive the pure core with tiny temp-dir fixtures, so they run in CI
where the DVC-tracked ``export/culturescrape`` is absent. The snapshot test (live
corpus vs committed manifest) is SKIPPED when the export is not present — the
local reproducibility gate, mirroring the triples exporter (US-002 Phase 2).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.export_verbalizations import DEFAULT_MANIFEST, build
from pinakes_ml.triples import EXCLUDED_RELATIONS
from pinakes_ml.verbalize import (
    EDGE_TEMPLATES,
    build_examples,
    build_manifest,
    content_hash,
    load_nodes,
    serialize_examples,
)

_NODE_HEADER = "\t".join(
    [
        "csid:ID",
        "name",
        "time_start:int",
        "time_end:int",
        "lat:float",
        "lon:float",
        "source",
        "source_url",
        "source_query",
        "license",
    ]
)
_EDGE_HEADER = "\t".join(
    [
        ":START_ID",
        ":END_ID",
        ":TYPE",
        "source",
        "source_url",
        "source_query",
        "license",
    ]
)


def _node_row(csid: str, name: str, **kw: str) -> str:
    cells = {
        "time_start:int": "",
        "time_end:int": "",
        "lat:float": "",
        "lon:float": "",
        "source": "pinakes",
        "source_url": "http://example/" + csid,
        "source_query": "",
        "license": "CC-BY-4.0",
    }
    cells.update(kw)
    return "\t".join(
        [
            csid,
            name,
            cells["time_start:int"],
            cells["time_end:int"],
            cells["lat:float"],
            cells["lon:float"],
            cells["source"],
            cells["source_url"],
            cells["source_query"],
            cells["license"],
        ]
    )


def _edge_row(head: str, tail: str, rel: str, **kw: str) -> str:
    cells = {
        "source": "pinakes",
        "source_url": "",
        "source_query": "",
        "license": "CC-BY-4.0",
    }
    cells.update(kw)
    return "\t".join(
        [
            head,
            tail,
            rel,
            cells["source"],
            cells["source_url"],
            cells["source_query"],
            cells["license"],
        ]
    )


@pytest.fixture()
def export_dir(tmp_path: Path) -> Path:
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()

    (nodes / "language.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row("cs:language:a", "Latin", **{"time_start:int": "-100"}),
                _node_row("cs:language:b", "Proto-Italic"),
                # null-island coords (0,0) + year-0 sentinel must both be skipped
                _node_row(
                    "cs:language:c",
                    "Placeholder",
                    **{"time_end:int": "0", "lat:float": "0", "lon:float": "0"},
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (nodes / "place.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row(
                    "cs:place:rome",
                    "Rome",
                    **{
                        "time_start:int": "-753",
                        "time_end:int": "476",
                        "lat:float": "41.9",
                        "lon:float": "12.5",
                    },
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    (edges / "descended-from.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM",
                          source_query="Ernout & Meillet"),
                # duplicate supporting row for the SAME fact — dedups to one
                _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM",
                          source_query="second citation"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (edges / "spoken-in.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:language:a", "cs:place:rome", "SPOKEN_IN"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    # a derived temporal relation that must be excluded entirely
    (edges / "contemporary.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:language:a", "cs:place:rome", "CONTEMPORARY_WITH"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return tmp_path


def test_edge_examples_use_names_and_templates(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    edges = [e for e in examples if e.kind == "edge"]
    descends = next(e for e in edges if e.relation == "DESCENDS_FROM")
    assert descends.head_name == "Latin"
    assert descends.tail_name == "Proto-Italic"
    assert "Latin" in descends.text and "Proto-Italic" in descends.text
    assert descends.template_id.startswith("descends_from.")
    # source triple carried in structured form
    assert descends.head == "cs:language:a"
    assert descends.tail == "cs:language:b"


def test_edges_dedup_on_triple_identity(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    descends = [e for e in examples if e.relation == "DESCENDS_FROM"]
    assert len(descends) == 1
    # provenance comes from the lexicographically-first supporting row
    assert descends[0].source_query == "Ernout & Meillet"


def test_excludes_derived_temporal_relations(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    rels = {e.relation for e in examples}
    assert not (rels & EXCLUDED_RELATIONS)
    assert "CONTEMPORARY_WITH" not in rels


def test_attribute_examples_dates_and_coordinates(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    attrs = [e for e in examples if e.kind == "attribute"]
    rome_date = next(
        e for e in attrs if e.head == "cs:place:rome" and e.relation == "DATED"
    )
    assert rome_date.value == "753 BCE to 476 CE"
    assert "Rome" in rome_date.text
    rome_loc = next(
        e for e in attrs if e.head == "cs:place:rome" and e.relation == "LOCATED_AT"
    )
    assert rome_loc.value == "41.9000, 12.5000"
    # single-year date (Latin, time_start only)
    latin_date = next(
        e for e in attrs if e.head == "cs:language:a" and e.relation == "DATED"
    )
    assert latin_date.value == "100 BCE"


def test_null_placeholder_attributes_skipped(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    # cs:language:c has only (0,0) coords + year-0 end → no attribute example
    assert not [e for e in examples if e.head == "cs:language:c"]


def test_provenance_and_license_carried(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    for e in examples:
        assert e.license == "CC-BY-4.0"
        assert e.source == "pinakes"


def test_output_is_deterministic(export_dir: Path) -> None:
    a, _ = build_examples(export_dir)
    b, _ = build_examples(export_dir)
    assert [e.as_json_line() for e in a] == [e.as_json_line() for e in b]
    assert content_hash(a) == content_hash(b)


def test_jsonl_schema_is_uniform_and_valid(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    body = serialize_examples(examples)
    keys = None
    for line in body.splitlines():
        record = json.loads(line)  # each line is valid JSON
        if keys is None:
            keys = set(record)
        assert set(record) == keys  # HF-compatible: identical feature set


def test_manifest_counts_and_stability(export_dir: Path) -> None:
    _, m1 = build(export_dir)
    _, m2 = build(export_dir)
    assert m1 == m2
    assert m1["counts"]["examples"] == m1["counts"]["edges"] + m1["counts"][
        "attributes"
    ]
    assert m1["edgeCounts"]["DESCENDS_FROM"] == 1
    assert m1["edgeCounts"]["SPOKEN_IN"] == 1
    assert "CONTEMPORARY_WITH" not in m1["edgeCounts"]
    assert m1["licenseCounts"]["CC-BY-4.0"] == m1["counts"]["examples"]


def test_unknown_endpoint_is_skipped_and_counted(tmp_path: Path) -> None:
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()
    (nodes / "language.tsv").write_text(
        _NODE_HEADER + "\n" + _node_row("cs:language:a", "Latin") + "\n",
        encoding="utf-8",
    )
    (edges / "descended-from.tsv").write_text(
        _EDGE_HEADER
        + "\n"
        + _edge_row("cs:language:a", "cs:language:missing", "DESCENDS_FROM")
        + "\n",
        encoding="utf-8",
    )
    examples, skipped = build_examples(tmp_path)
    assert [e for e in examples if e.kind == "edge"] == []
    assert skipped["unknownEndpointNode"] == 1


def test_load_nodes_is_header_driven(export_dir: Path) -> None:
    nodes = load_nodes(export_dir / "nodes")
    assert nodes["cs:place:rome"].name == "Rome"
    assert nodes["cs:place:rome"].time_start == -753
    assert nodes["cs:language:c"].time_end is None  # year-0 sentinel


# --- Template-coverage gate: every non-derived edge type has a template --------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"


def test_every_exported_edge_type_has_a_template() -> None:
    schema = json.loads(_SCHEMA.read_text(encoding="utf-8"))
    for edge_type in schema["edgeTypes"]:
        token = edge_type["type"]
        if token in EXCLUDED_RELATIONS:
            continue
        assert token in EDGE_TEMPLATES, f"no verbalization template for {token}"
        assert EDGE_TEMPLATES[token], f"empty template list for {token}"


# --- Live reproducibility gate (skipped when the DVC export is absent) ---------

_LIVE_EXPORT = _REPO_ROOT / "export" / "culturescrape"


@pytest.mark.skipif(
    not (_LIVE_EXPORT / "nodes").exists(),
    reason="canonical export not present (DVC-tracked; run `dvc pull` locally)",
)
def test_committed_manifest_matches_live_corpus() -> None:
    """The committed manifest must equal a fresh build of the live corpus."""
    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    examples, skipped = build_examples(_LIVE_EXPORT)
    fresh = build_manifest(examples, skipped)
    assert fresh == committed
