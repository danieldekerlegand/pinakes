"""Training-query generator — the supervised signal (neurosymbolic roadmap Phase 5).

US-002 of the Scallop pilot. The rule-guided link-prediction loop (US-003) trains
on **training queries**: known-true positive edges paired with **type-constrained
negatives** — head/tail corruptions that stay well-formed under the canonical
schema's ``from``/``to`` node-type constraints, so they are *hard* (a plausible,
type-correct edge) yet *false*.

The two pilot target relations are :data:`TARGET_RELATIONS`
(``DESCENDS_FROM``/``BORROWED_FROM`` — both populated in the corpus). Positives are
drawn from a **held-out** split (default ``valid``) so they are distinct from the
``train`` edges that seed the Scallop program *and* from the ``test`` split US-003
evaluates on — a clean three-way separation:

* ``train``  → observed base facts fed to the Scallop program;
* ``valid``  → training-query positives (this generator's supervised signal);
* ``test``   → reserved for the US-003 held-out link-prediction evaluation.

**Type-constrained corruption.** For each positive ``(h, r, t)`` a corrupted
negative replaces the head (or tail) with another entity whose node type is allowed
on that end of ``r`` per ``contracts/canonical-schema.json`` (reusing
:func:`pinakes_ml.consistency.load_edge_constraints` /
:func:`~pinakes_ml.consistency.node_type_of`). An entity's type is read off its
``cs:<node-type>:<id>`` csid. A corruption that reconstructs the positive, duplicates
an already-generated negative, or lands on **any** known-true edge (the *filtered*
setting — train ∪ valid ∪ test) is rejected and resampled, so a negative is never a
real edge (the leakage guarantee AC2 requires against the train facts, here enforced
against the whole known-positive set).

Everything here is a **pure** function over in-memory triples (no wall-clock, no
network, no torch), deterministic under a pinned seed, so tests drive it with tiny
fixtures and the committed manifest is byte-reproducible. The filesystem writes +
MLflow logging live in the thin CLI :mod:`pinakes_ml.export_queries`.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass

from pinakes_ml.consistency import EdgeConstraint, node_type_of
from pinakes_ml.triples import Triple

# The pilot's two link-prediction target relations (edge ``:TYPE`` tokens, matching
# ``Triple.relation``). Both are populated in the corpus; both are type-constrained
# on each end in ``contracts/canonical-schema.json`` (so corruption pools are non-empty
# and the negatives are hard). Sorted for a deterministic manifest.
TARGET_RELATIONS: tuple[str, ...] = ("BORROWED_FROM", "DESCENDS_FROM")

# Default number of type-constrained negatives per positive edge.
DEFAULT_NEGATIVE_RATIO = 4

# Pinned generator seed — committed so every rerun reproduces byte-identical queries.
DEFAULT_SEED = 20260713

# The split the positives are drawn from (held out from the ``train`` base facts and
# from the ``test`` eval split). See the module docstring for the three-way split.
DEFAULT_SPLIT = "valid"

# Give up on a positive's negative after this many collisions (positive-reconstruction
# / duplicate / known-true). Pools are thousands of entities, so this is never hit in
# practice; exhaustion is counted + reported rather than silently emitting a bad edge.
MAX_SAMPLE_ATTEMPTS = 256


@dataclass(frozen=True)
class Query:
    """One training query — a positive or a type-constrained negative.

    ``source`` is the ``head\\trel\\ttail`` row of the positive this query belongs
    to (a positive's ``source`` is its own row), so a negative is trivially grouped
    with the positive it corrupts. ``corrupted`` is ``""`` for a positive, else the
    corrupted end (``"head"``/``"tail"``).
    """

    relation: str
    head: str
    tail: str
    label: int  # 1 = positive (true edge), 0 = type-constrained negative
    corrupted: str  # "" | "head" | "tail"
    head_type: str
    tail_type: str
    source: str

    def triple(self) -> Triple:
        return Triple(relation=self.relation, head=self.head, tail=self.tail)

    def as_record(self) -> dict[str, object]:
        """Flat, uniform JSONL record (HF-``datasets``-compatible schema)."""
        return {
            "relation": self.relation,
            "head": self.head,
            "tail": self.tail,
            "label": self.label,
            "corrupted": self.corrupted,
            "head_type": self.head_type,
            "tail_type": self.tail_type,
            "source": self.source,
        }


@dataclass(frozen=True)
class GenStats:
    """Non-query bookkeeping from a generation run (folded into the manifest)."""

    collisions_rejected: int  # resamples due to positive-reconstruction/dup/known-true
    insufficient_pool_negatives: int  # negatives dropped — pool exhausted (should be 0)


# --- entity typing + corruption pools ----------------------------------------


def entity_types(triples: list[Triple]) -> dict[str, str | None]:
    """Map every entity (head ∪ tail) to its node type read off its csid.

    ``None`` for a malformed csid — such an entity is excluded from every
    type-constrained corruption pool (it provably isn't an allowed type).
    """
    types: dict[str, str | None] = {}
    for t in triples:
        for entity in (t.head, t.tail):
            if entity not in types:
                types[entity] = node_type_of(entity)
    return types


def corruption_pool(
    types_by_entity: dict[str, str | None], allowed: frozenset[str] | None
) -> list[str]:
    """Sorted entities eligible to replace a constrained end.

    ``allowed is None`` means the end is unconstrained (polymorphic edge) — every
    entity is eligible. Otherwise only entities whose node type is in ``allowed``.
    """
    if allowed is None:
        return sorted(types_by_entity)
    return sorted(e for e, ty in types_by_entity.items() if ty in allowed)


# --- generation --------------------------------------------------------------


def _corrupt(
    positive: Triple,
    side: str,
    replacement: str,
    types_by_entity: dict[str, str | None],
) -> Query:
    """Build a negative ``Query`` by replacing ``side`` of *positive*."""
    if side == "tail":
        head, tail = positive.head, replacement
    else:
        head, tail = replacement, positive.tail
    return Query(
        relation=positive.relation,
        head=head,
        tail=tail,
        label=0,
        corrupted=side,
        head_type=types_by_entity.get(head) or "?",
        tail_type=types_by_entity.get(tail) or "?",
        source=positive.as_row(),
    )


def generate_queries(
    positives: list[Triple],
    *,
    known_positives: set[Triple],
    types_by_entity: dict[str, str | None],
    constraints: dict[str, EdgeConstraint],
    negative_ratio: int = DEFAULT_NEGATIVE_RATIO,
    seed: int = DEFAULT_SEED,
) -> tuple[list[Query], GenStats]:
    """Emit positives + ``negative_ratio`` type-constrained negatives each.

    Deterministic under ``seed``: positives are sorted, then a single seeded
    :class:`random.Random` drives every corruption draw. Negatives alternate the
    corrupted end (tail, head, tail, …) so each positive gets a balanced mix. A draw
    that reconstructs the positive, duplicates an already-emitted negative for that
    positive, or lands on a **known-true** edge (``known_positives`` — the filtered
    train ∪ valid ∪ test set) is rejected and resampled, so no negative is a real
    edge. Pool exhaustion (never seen at corpus scale) drops the negative and is
    counted in :class:`GenStats`.
    """
    rng = random.Random(seed)
    queries: list[Query] = []
    collisions = 0
    insufficient = 0

    # Pre-compute per-relation-end pools once (sorted → deterministic choice).
    pools: dict[tuple[str, str], list[str]] = {}
    for rel in {p.relation for p in positives}:
        from_types, to_types = constraints.get(rel, (None, None))
        pools[(rel, "head")] = corruption_pool(types_by_entity, from_types)
        pools[(rel, "tail")] = corruption_pool(types_by_entity, to_types)

    for positive in sorted(positives):
        queries.append(
            Query(
                relation=positive.relation,
                head=positive.head,
                tail=positive.tail,
                label=1,
                corrupted="",
                head_type=types_by_entity.get(positive.head) or "?",
                tail_type=types_by_entity.get(positive.tail) or "?",
                source=positive.as_row(),
            )
        )
        emitted: set[Triple] = set()
        for j in range(negative_ratio):
            side = "tail" if j % 2 == 0 else "head"
            pool = pools[(positive.relation, side)]
            if not pool:
                insufficient += 1
                continue
            for _ in range(MAX_SAMPLE_ATTEMPTS):
                candidate = _corrupt(positive, side, rng.choice(pool), types_by_entity)
                cand_triple = candidate.triple()
                if cand_triple == positive or cand_triple in known_positives:
                    collisions += 1
                    continue
                if cand_triple in emitted:
                    continue
                emitted.add(cand_triple)
                queries.append(candidate)
                break
            else:  # pool exhausted without a fresh, false, well-formed negative
                insufficient += 1

    return queries, GenStats(
        collisions_rejected=collisions, insufficient_pool_negatives=insufficient
    )


# --- serialization + manifest ------------------------------------------------


def _query_sort_key(q: Query) -> tuple[str, str, int, str, str, str]:
    # Group each positive immediately before its negatives (shared ``source``);
    # ``-label`` puts the positive (1) ahead of its negatives (0).
    return (q.relation, q.source, -q.label, q.corrupted, q.head, q.tail)


def serialize_queries(queries: list[Query]) -> str:
    """Serialize to deterministic JSONL (sorted, unicode-preserving, trailing NL)."""
    rows = [
        json.dumps(q.as_record(), sort_keys=True, ensure_ascii=False)
        for q in sorted(queries, key=_query_sort_key)
    ]
    return ("\n".join(rows) + "\n") if rows else ""


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content_hash(queries: list[Query]) -> str:
    """Content hash of the queries as serialized to the JSONL artifact."""
    return _sha256_text(serialize_queries(queries))


def build_manifest(
    queries: list[Query],
    stats: GenStats,
    *,
    known_positives: set[Triple],
    train_positives: set[Triple],
    constraints: dict[str, EdgeConstraint],
    pool_sizes: dict[str, dict[str, int]],
    seed: int = DEFAULT_SEED,
    split: str = DEFAULT_SPLIT,
    negative_ratio: int = DEFAULT_NEGATIVE_RATIO,
) -> dict[str, object]:
    """Deterministic manifest: counts + leakage checks + content hash.

    Committed to git and snapshot-tested against a fresh build, so a corpus change
    (or a non-reproducible generation) fails CI. Contains NO wall-clock — only
    functions of the splits + seed. The two leakage counts recompute the invariant
    directly from the emitted queries (both MUST be 0), so a generator bug that let a
    negative through is caught by the snapshot gate, not just trusted.
    """
    positives = [q for q in queries if q.label == 1]
    negatives = [q for q in queries if q.label == 0]

    per_relation: dict[str, dict[str, int]] = {}
    for rel in TARGET_RELATIONS:
        per_relation[rel] = {
            "positives": sum(1 for q in positives if q.relation == rel),
            "negatives": sum(1 for q in negatives if q.relation == rel),
        }

    leaking_known = sum(1 for q in negatives if q.triple() in known_positives)
    leaking_train = sum(1 for q in negatives if q.triple() in train_positives)

    type_constraints: dict[str, dict[str, list[str] | None]] = {}
    for rel in TARGET_RELATIONS:
        from_types, to_types = constraints.get(rel, (None, None))
        type_constraints[rel] = {
            "from": sorted(from_types) if from_types is not None else None,
            "to": sorted(to_types) if to_types is not None else None,
        }

    return {
        "seed": seed,
        "sourceSplit": split,
        "negativeRatio": negative_ratio,
        "targetRelations": list(TARGET_RELATIONS),
        "typeConstraints": type_constraints,
        "poolSizes": pool_sizes,
        "counts": {
            "positives": len(positives),
            "negatives": len(negatives),
            "queries": len(queries),
        },
        "perRelation": per_relation,
        "leakage": {
            "knownPositives": len(known_positives),
            "trainPositives": len(train_positives),
            "collisionsRejected": stats.collisions_rejected,
            "insufficientPoolNegatives": stats.insufficient_pool_negatives,
            "negativesLeakingKnownPositives": leaking_known,
            "negativesLeakingTrainFacts": leaking_train,
        },
        "queriesSha256": content_hash(queries),
    }


__all__ = [
    "DEFAULT_NEGATIVE_RATIO",
    "DEFAULT_SEED",
    "DEFAULT_SPLIT",
    "TARGET_RELATIONS",
    "GenStats",
    "Query",
    "build_manifest",
    "content_hash",
    "corruption_pool",
    "entity_types",
    "generate_queries",
    "serialize_queries",
]
