"""`pinakes.lexicons.canonical_edges` — the corpus's relationships, extracted.

`server/services/canonical-edges.ts` is the graded spec and is **not** retired:
`scripts/export-for-engine.ts` still reads it to write the canonical
`build/corpus/` TSVs. This module is the *dedup* reader only, and the two are
pinned to each other by :func:`test_the_live_corpus_yields_the_recorded_totals`
— 5,836 edges and 1,531 skips, which is what the TypeScript extracts from the
same directory.

The rest of the file is the per-rule coverage that number cannot give you: a
count would stay right while a *direction* flipped.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pinakes.lexicons import canonical_edges
from pinakes.paths import LEXICONS_RELPATH, repo_root

#: What `extractAllCanonicalEdges("data/source/lexicons")` returns today. A
#: change here is a change to the corpus or to the mapping, never to this file
#: alone — regenerate on the TypeScript side and move both together.
LIVE_EDGE_COUNT = 5836
LIVE_SKIPPED_COUNT = 1531


def _live_corpus() -> Path:
    """The real corpus, not the temp one `isolated_data_trees` installs."""
    return repo_root() / LEXICONS_RELPATH


def test_the_live_corpus_yields_the_recorded_totals() -> None:
    extraction = canonical_edges.extract_all_canonical_edges(_live_corpus())

    assert len(extraction.edges) == LIVE_EDGE_COUNT
    assert len(extraction.skipped) == LIVE_SKIPPED_COUNT


def test_the_edge_bearing_file_list_comes_from_the_mapping() -> None:
    """Not a hard-coded list: a file that gains an `edge` disposition upstream
    starts being read here with no edit."""
    files = canonical_edges.edge_bearing_files()

    assert "cultural-lineages.tsv" in files  # an edge table
    assert "languages.tsv" in files  # embedded FKs only
    assert "sample-texts.tsv" not in files


LINEAGES_HEADER = [
    "id",
    "source_id",
    "target_id",
    "relationship_type",
    "time_start",
    "time_end",
    "confidence",
    "sources",
]


def _rows(*rows: list[str]) -> list[list[str]]:
    return list(rows)


def test_a_free_text_relationship_is_aligned_to_a_canonical_type() -> None:
    """`evolved-into` is not a canonical edge name; `descended-from` is."""
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(["cl-1", "a", "b", "evolved-into", "-500", "-100", "80", "[]"]),
    )

    edge = extraction.edges[0]
    assert edge.edge_name == "descended-from"
    assert edge.type == "DESCENDS_FROM"
    assert edge.start_id == "a"
    assert edge.end_id == "b"
    assert edge.time_start == -500
    assert edge.time_end == -100


def test_a_relationship_with_no_canonical_home_is_skipped_not_mistyped() -> None:
    """`preceded-by` is temporal precedence, which no canonical edge expresses.
    Emitting it as `influenced-by` would assert something the corpus does not."""
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(["cl-1", "a", "b", "preceded-by", "", "", "", "[]"]),
    )

    assert extraction.edges == []
    assert extraction.skipped[0].reason == "skipped-type"
    assert extraction.skipped[0].value == "preceded-by"


def test_an_unrecognised_relationship_token_is_reported_separately() -> None:
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(["cl-1", "a", "b", "vibes-with", "", "", "", "[]"]),
    )
    assert extraction.skipped[0].reason == "unmapped-type"


@pytest.mark.parametrize("token", ["null", "NONE", "n/a", "undefined", ""])
def test_a_placeholder_endpoint_is_no_endpoint(token: str) -> None:
    """`writing-systems.tsv` writes a literal `"null"` for a root script; a
    dangling edge to a phantom `null` node would be worse than no edge."""
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(["cl-1", "a", token, "split-from", "", "", "", "[]"]),
    )
    assert extraction.edges == []
    assert extraction.skipped[0].reason == "missing-endpoint"


def test_a_self_reference_is_skipped() -> None:
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(["cl-1", "a", "a", "split-from", "", "", "", "[]"]),
    )
    assert extraction.edges == []
    assert extraction.skipped[0].reason == "self-reference"
    assert extraction.skipped[0].value == "a"


def test_confidence_above_one_is_read_as_a_percentage() -> None:
    """The corpus mixes 0–100 and 0–1 scales in the same column family."""
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(
            ["cl-1", "a", "b", "split-from", "", "", "80", "[]"],
            ["cl-2", "c", "d", "split-from", "", "", "0.4", "[]"],
            ["cl-3", "e", "f", "split-from", "", "", "", "[]"],
        ),
    )

    assert [edge.provenance.confidence for edge in extraction.edges] == [
        0.8,
        0.4,
        canonical_edges.DEFAULT_EDGE_CONFIDENCE,
    ]


def test_a_json_array_sources_cell_is_joined_and_a_blank_one_falls_back() -> None:
    extraction = canonical_edges.extract_edges_from_lexicon(
        "cultural-lineages.tsv",
        LINEAGES_HEADER,
        _rows(
            [
                "cl-1",
                "a",
                "b",
                "split-from",
                "",
                "",
                "",
                '["Anthony 2007","Ringe 2006"]',
            ],
            ["cl-2", "c", "d", "split-from", "", "", "", ""],
        ),
    )

    assert extraction.edges[0].provenance.source == "Anthony 2007; Ringe 2006"
    assert extraction.edges[1].provenance.source == "cultural-lineages.tsv"


def test_an_embedded_foreign_key_becomes_an_edge() -> None:
    """A node table's `family_id` column is a relationship, not a string."""
    extraction = canonical_edges.extract_edges_from_lexicon(
        "languages.tsv",
        ["id", "name", "family_id", "status"],
        _rows(["lat", "Latin", "indo_european", "extinct"]),
    )

    assert len(extraction.edges) == 1
    edge = extraction.edges[0]
    assert (edge.start_id, edge.end_id) == ("lat", "indo_european")
    assert edge.time_start is None
    assert edge.pinakes_id is None


def test_a_file_the_mapping_does_not_know_yields_nothing() -> None:
    extraction = canonical_edges.extract_edges_from_lexicon(
        "not-a-lexicon.tsv", ["id"], _rows(["x"])
    )
    assert extraction == canonical_edges.FileExtraction(edges=[], skipped=[])


def test_an_absent_corpus_is_an_empty_extraction_not_an_error(
    tmp_path: Path,
) -> None:
    """The reader's standing rule: a missing file is an empty domain."""
    extraction = canonical_edges.extract_all_canonical_edges(tmp_path)
    assert extraction.edges == []
