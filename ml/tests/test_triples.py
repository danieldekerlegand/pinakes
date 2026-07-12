"""Unit + snapshot tests for the triples exporter (US-002).

The unit tests drive the pure core with tiny temp-dir fixtures, so they run in
CI where the DVC-tracked ``export/culturescrape`` is absent. The snapshot test
(live corpus vs committed manifest) is SKIPPED when the export is not present —
it is the local reproducibility gate, mirroring the "training is local-only"
split of this workspace.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from linguascrape_ml.export_triples import DEFAULT_MANIFEST, build
from linguascrape_ml.triples import (
    EXCLUDED_RELATIONS,
    Triple,
    analyze_leakage,
    build_manifest,
    entity_vocab,
    load_triples,
    relation_vocab,
    split_triples,
)

_HEADER = ":START_ID\t:END_ID\t:TYPE\tweight:float\tconfidence:float"


def _edge_file(path: Path, rel: str, pairs: list[tuple[str, str]]) -> None:
    """Write a minimal canonical-edge TSV (header + one row per pair)."""
    lines = [_HEADER]
    lines += [f"{h}\t{t}\t{rel}\t\t0.8" for h, t in pairs]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.fixture()
def edges_dir(tmp_path: Path) -> Path:
    d = tmp_path / "edges"
    d.mkdir()
    _edge_file(d / "descended-from.tsv", "DESCENDS_FROM", [("a", "b"), ("b", "c")])
    _edge_file(d / "cognate-with.tsv", "COGNATE_WITH", [("x", "y"), ("y", "x")])
    # duplicate rows of one (h,r,t) — must collapse to a single triple
    _edge_file(d / "derived-from.tsv", "DERIVED_FROM", [("a", "b"), ("a", "b")])
    # a derived temporal relation that must be excluded entirely
    _edge_file(d / "contemporary.tsv", "CONTEMPORARY_WITH", [("a", "c"), ("b", "c")])
    return d


def test_excludes_derived_temporal_relations(edges_dir: Path) -> None:
    triples = load_triples(edges_dir)
    rels = {t.relation for t in triples}
    assert not (rels & EXCLUDED_RELATIONS)
    assert "CONTEMPORARY_WITH" not in rels


def test_dedups_repeated_triples(edges_dir: Path) -> None:
    triples = load_triples(edges_dir)
    # a→b DERIVED_FROM appears twice on disk + a→b DESCENDS_FROM once
    ab = [t for t in triples if t.head == "a" and t.tail == "b"]
    assert sorted(t.relation for t in ab) == ["DERIVED_FROM", "DESCENDS_FROM"]
    assert len(triples) == len(set(triples))


def test_load_is_sorted_and_deterministic(edges_dir: Path) -> None:
    first = load_triples(edges_dir)
    second = load_triples(edges_dir)
    assert first == second
    assert first == sorted(first)


def test_skips_blank_endpoints(tmp_path: Path) -> None:
    d = tmp_path / "edges"
    d.mkdir()
    _edge_file(d / "descended-from.tsv", "DESCENDS_FROM", [("a", "b"), ("", "c")])
    assert load_triples(d) == [Triple("DESCENDS_FROM", "a", "b")]


def _many_triples(n: int) -> list[Triple]:
    # Distinct entity pairs so grouping doesn't merge them; deterministic.
    return sorted(Triple("DESCENDS_FROM", f"e{i}", f"e{i}b") for i in range(n))


def test_split_is_deterministic() -> None:
    triples = _many_triples(200)
    a = split_triples(triples, seed=7)
    b = split_triples(triples, seed=7)
    assert [t.as_row() for t in a.train] == [t.as_row() for t in b.train]
    assert [t.as_row() for t in a.valid] == [t.as_row() for t in b.valid]
    assert [t.as_row() for t in a.test] == [t.as_row() for t in b.test]


def test_split_seed_changes_partition() -> None:
    triples = _many_triples(200)
    a = split_triples(triples, seed=1)
    b = split_triples(triples, seed=2)
    assert set(a.train) != set(b.train)


def test_split_is_a_partition() -> None:
    triples = _many_triples(200)
    s = split_triples(triples)
    combined = s.train + s.valid + s.test
    assert sorted(combined) == triples
    assert len(combined) == len(set(combined))  # no triple in two splits
    # ~80/10/10
    assert len(s.train) == pytest.approx(160, abs=20)
    assert len(s.valid) == pytest.approx(20, abs=15)


def test_split_keeps_inverse_pairs_together() -> None:
    """Both directions of an entity pair land in the SAME split (no leakage)."""
    triples = sorted(
        [Triple("COGNATE_WITH", "x", "y"), Triple("COGNATE_WITH", "y", "x")]
        + _many_triples(100)
    )
    s = split_triples(triples, seed=3)
    for part in (s.train, s.valid, s.test):
        pair = {t for t in part if {t.head, t.tail} == {"x", "y"}}
        assert len(pair) in (0, 2)  # never split across


def test_manifest_hashes_are_stable(edges_dir: Path) -> None:
    _, _, m1 = build(edges_dir, seed=99)
    _, _, m2 = build(edges_dir, seed=99)
    assert m1 == m2
    assert m1["triplesSha256"] == m2["triplesSha256"]
    assert m1["excludedRelations"] == sorted(EXCLUDED_RELATIONS)


def test_leakage_report_counts(edges_dir: Path) -> None:
    triples = load_triples(edges_dir)
    leak = analyze_leakage(triples)
    # x↔y cognate is a symmetric reverse pair
    assert leak["symmetricReverseTriples"] == 2
    assert leak["reverseDirectionPairs"] >= 2
    # a→b carries both DESCENDS_FROM and DERIVED_FROM
    assert leak["multiRelationPairs"] == 1


def test_vocab_covers_all_ids(edges_dir: Path) -> None:
    triples = load_triples(edges_dir)
    ents = set(entity_vocab(triples))
    for t in triples:
        assert t.head in ents and t.tail in ents
    assert relation_vocab(triples) == sorted({t.relation for t in triples})


# --- Live reproducibility gate (skipped when the DVC export is absent) ---------

# ml/tests/this_file → parents[2] is the repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIVE_EDGES = _REPO_ROOT / "export" / "culturescrape" / "edges"


@pytest.mark.skipif(
    not _LIVE_EDGES.exists(),
    reason="canonical export not present (DVC-tracked; run `dvc pull` locally)",
)
def test_committed_manifest_matches_live_corpus() -> None:
    """The committed split manifest must equal a fresh build of the live corpus.

    An unintended corpus change (or a non-reproducible split) fails here — the
    same ratchet shape as docs/convergence-qa-baseline.json.
    """
    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    triples = load_triples(_LIVE_EDGES)
    splits = split_triples(triples)
    fresh = build_manifest(triples, splits)
    assert fresh == committed
