"""Unit + snapshot tests for the training-query generator (Scallop pilot US-002).

The unit tests drive the pure core with tiny in-memory fixtures, so they run in CI
where the DVC-tracked ``ml/data`` is absent. The snapshot test (live triples splits
vs committed manifest) is SKIPPED when the splits are not present — the local
reproducibility gate, mirroring the workspace's "data is DVC-tracked" split.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from linguascrape_ml.consistency import EdgeConstraint
from linguascrape_ml.queries import (
    TARGET_RELATIONS,
    build_manifest,
    corruption_pool,
    entity_types,
    generate_queries,
    serialize_queries,
)
from linguascrape_ml.triples import Triple

# A tiny typed csid universe: languages, cultures, and one place (never allowed on
# either target relation, so it must never appear in a negative).
_LANGS = [f"cs:language:l{i}" for i in range(6)]
_CULTURES = [f"cs:culture:c{i}" for i in range(4)]
_PLACES = [f"cs:place:p{i}" for i in range(3)]

# DESCENDS_FROM: language|culture on each end. BORROWED_FROM: language only.
_LANG_CULTURE = frozenset({"language", "culture"})
_CONSTRAINTS: dict[str, EdgeConstraint] = {
    "DESCENDS_FROM": (_LANG_CULTURE, _LANG_CULTURE),
    "BORROWED_FROM": (frozenset({"language"}), frozenset({"language"})),
}


def _universe() -> list[Triple]:
    """Triples that populate the entity-type map (every entity appears somewhere)."""
    trips = [Triple("DESCENDS_FROM", _LANGS[i], _LANGS[i + 1]) for i in range(5)]
    trips += [Triple("DESCENDS_FROM", _CULTURES[i], _CULTURES[i + 1]) for i in range(3)]
    trips += [Triple("BORROWED_FROM", _LANGS[0], _LANGS[3])]
    # a place only reachable via a non-target edge, so it's in the type map but never
    # type-compatible with a target relation.
    trips += [Triple("SPOKEN_IN", _LANGS[i], _PLACES[i]) for i in range(3)]
    return sorted(set(trips))


def test_entity_types_read_from_csid() -> None:
    types = entity_types(_universe())
    assert types[_LANGS[0]] == "language"
    assert types[_CULTURES[0]] == "culture"
    assert types[_PLACES[0]] == "place"
    # a malformed csid → None
    assert entity_types([Triple("DESCENDS_FROM", "bogus", _LANGS[0])])["bogus"] is None


def test_corruption_pool_filters_by_type() -> None:
    types = entity_types(_universe())
    lang_pool = corruption_pool(types, frozenset({"language"}))
    assert set(lang_pool) == set(_LANGS)
    assert all("cs:language:" in e for e in lang_pool)
    assert lang_pool == sorted(lang_pool)  # deterministic
    # unconstrained end (None) → every entity is eligible
    assert set(corruption_pool(types, None)) == set(_LANGS + _CULTURES + _PLACES)


def test_negatives_are_type_respecting() -> None:
    types = entity_types(_universe())
    positives = [Triple("BORROWED_FROM", _LANGS[0], _LANGS[3])]
    queries, _ = generate_queries(
        positives,
        known_positives={positives[0]},
        types_by_entity=types,
        constraints=_CONSTRAINTS,
        negative_ratio=4,
    )
    negatives = [q for q in queries if q.label == 0]
    assert negatives  # some were emitted
    for q in negatives:
        # BORROWED_FROM is language→language, so BOTH endpoints stay languages —
        # a place could never be corrupted in.
        assert q.head_type == "language" and q.tail_type == "language"
        assert q.head in _LANGS and q.tail in _LANGS


def test_descends_from_negatives_allow_both_compatible_types() -> None:
    types = entity_types(_universe())
    positives = [Triple("DESCENDS_FROM", _LANGS[0], _CULTURES[0])]
    queries, _ = generate_queries(
        positives,
        known_positives={positives[0]},
        types_by_entity=types,
        constraints=_CONSTRAINTS,
        negative_ratio=8,
        seed=1,
    )
    negatives = [q for q in queries if q.label == 0]
    # every endpoint of a negative is language OR culture — never a place.
    for q in negatives:
        assert q.head_type in {"language", "culture"}
        assert q.tail_type in {"language", "culture"}
        assert q.head not in _PLACES and q.tail not in _PLACES


def test_no_negative_leaks_a_known_positive() -> None:
    types = entity_types(_universe())
    universe = _universe()
    positives = [t for t in universe if t.relation in TARGET_RELATIONS]
    known = set(positives)
    queries, _ = generate_queries(
        positives,
        known_positives=known,
        types_by_entity=types,
        constraints=_CONSTRAINTS,
        negative_ratio=6,
        seed=3,
    )
    for q in queries:
        if q.label == 0:
            assert q.triple() not in known  # never a real edge
            head, rel, tail = q.source.split("\t")
            assert q.triple() != Triple(rel, head, tail)  # not its own positive


def test_negative_never_reconstructs_its_positive() -> None:
    types = entity_types(_universe())
    p = Triple("DESCENDS_FROM", _LANGS[0], _CULTURES[0])
    queries, _ = generate_queries(
        [p], known_positives={p}, types_by_entity=types, constraints=_CONSTRAINTS,
        negative_ratio=8, seed=5,
    )
    for q in (q for q in queries if q.label == 0):
        assert q.triple() != p


def test_positive_carries_its_own_source_and_grouping() -> None:
    types = entity_types(_universe())
    p = Triple("BORROWED_FROM", _LANGS[0], _LANGS[3])
    queries, _ = generate_queries(
        [p], known_positives={p}, types_by_entity=types, constraints=_CONSTRAINTS,
        negative_ratio=3,
    )
    pos = [q for q in queries if q.label == 1]
    assert len(pos) == 1 and pos[0].source == p.as_row()
    # every negative shares the positive's source (grouping key)
    assert all(q.source == p.as_row() for q in queries)


def test_ratio_and_side_alternation() -> None:
    types = entity_types(_universe())
    p = Triple("BORROWED_FROM", _LANGS[0], _LANGS[3])
    queries, _ = generate_queries(
        [p], known_positives={p}, types_by_entity=types, constraints=_CONSTRAINTS,
        negative_ratio=4, seed=7,
    )
    negs = [q for q in queries if q.label == 0]
    assert len(negs) == 4  # pool is large enough — no shortfall
    sides = {q.corrupted for q in negs}
    assert sides == {"head", "tail"}  # both ends corrupted


def test_generation_is_deterministic() -> None:
    types = entity_types(_universe())
    positives = [t for t in _universe() if t.relation in TARGET_RELATIONS]
    known = set(positives)
    a, sa = generate_queries(positives, known_positives=known, types_by_entity=types,
                             constraints=_CONSTRAINTS, negative_ratio=5, seed=11)
    b, sb = generate_queries(positives, known_positives=known, types_by_entity=types,
                             constraints=_CONSTRAINTS, negative_ratio=5, seed=11)
    assert serialize_queries(a) == serialize_queries(b)
    assert sa == sb


def test_seed_changes_the_negatives() -> None:
    types = entity_types(_universe())
    p = Triple("DESCENDS_FROM", _LANGS[0], _CULTURES[0])
    a, _ = generate_queries([p], known_positives={p}, types_by_entity=types,
                            constraints=_CONSTRAINTS, negative_ratio=6, seed=1)
    b, _ = generate_queries([p], known_positives={p}, types_by_entity=types,
                            constraints=_CONSTRAINTS, negative_ratio=6, seed=2)
    neg_a = {q.triple() for q in a if q.label == 0}
    neg_b = {q.triple() for q in b if q.label == 0}
    assert neg_a != neg_b


def test_insufficient_pool_when_no_compatible_entity() -> None:
    # The corruption end requires a node type ("deity") that NO entity in the corpus
    # has, so the pool is empty on both ends → every negative is a reported shortfall,
    # never a type-incorrect fake.
    types = entity_types(_universe())  # only languages/cultures/places exist
    constraints: dict[str, EdgeConstraint] = {
        "BORROWED_FROM": (frozenset({"deity"}), frozenset({"deity"}))
    }
    p = Triple("BORROWED_FROM", _LANGS[0], _LANGS[3])
    queries, stats = generate_queries(
        [p], known_positives={p}, types_by_entity=types, constraints=constraints,
        negative_ratio=4,
    )
    assert stats.insufficient_pool_negatives == 4
    assert not [q for q in queries if q.label == 0]  # no negative emitted
    assert [q for q in queries if q.label == 1]  # positive still emitted


def test_manifest_leakage_counts_are_zero_and_stable() -> None:
    types = entity_types(_universe())
    positives = [t for t in _universe() if t.relation in TARGET_RELATIONS]
    train = {Triple("DESCENDS_FROM", _LANGS[0], _LANGS[1])}
    known = set(positives) | train
    queries, stats = generate_queries(
        positives, known_positives=known, types_by_entity=types,
        constraints=_CONSTRAINTS, negative_ratio=4, seed=13,
    )
    pool_sizes = {
        rel: {
            "from": len(corruption_pool(types, _CONSTRAINTS[rel][0])),
            "to": len(corruption_pool(types, _CONSTRAINTS[rel][1])),
        }
        for rel in TARGET_RELATIONS
    }
    m1 = build_manifest(queries, stats, known_positives=known, train_positives=train,
                        constraints=_CONSTRAINTS, pool_sizes=pool_sizes)
    m2 = build_manifest(queries, stats, known_positives=known, train_positives=train,
                        constraints=_CONSTRAINTS, pool_sizes=pool_sizes)
    assert m1 == m2
    assert m1["leakage"]["negativesLeakingKnownPositives"] == 0
    assert m1["leakage"]["negativesLeakingTrainFacts"] == 0
    counts = m1["counts"]
    assert counts["queries"] == counts["positives"] + counts["negatives"]


def test_serialize_is_flat_uniform_jsonl() -> None:
    types = entity_types(_universe())
    p = Triple("BORROWED_FROM", _LANGS[0], _LANGS[3])
    queries, _ = generate_queries([p], known_positives={p}, types_by_entity=types,
                                  constraints=_CONSTRAINTS, negative_ratio=2)
    body = serialize_queries(queries)
    keysets = {tuple(sorted(json.loads(line))) for line in body.splitlines()}
    assert len(keysets) == 1  # every record has the identical key set (HF-compatible)
    assert body.endswith("\n")


# --- Live reproducibility gate (skipped when the DVC data is absent) -----------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ML_ROOT = _REPO_ROOT / "ml"
_TRIPLES_DIR = _ML_ROOT / "data" / "triples"
_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"


@pytest.mark.skipif(
    not (_TRIPLES_DIR / "valid.tsv").exists(),
    reason="triples splits not present (DVC-tracked; run `dvc pull` locally)",
)
def test_committed_manifest_matches_live_splits() -> None:
    """The committed manifest must equal a fresh build of the live triples splits."""
    from linguascrape_ml.export_queries import DEFAULT_MANIFEST, build

    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    _, fresh = build(_TRIPLES_DIR, _SCHEMA)
    assert fresh == committed
