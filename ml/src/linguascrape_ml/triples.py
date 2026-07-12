"""Triples dataset builder — the fact→model bridge (NEUROSYMBOLIC_ROADMAP.md Phase 2).

Turns the canonical **edge** export (``export/culturescrape/edges/*.tsv``, one file
per semantic relation, `neo4j-admin import` header) into a PyKEEN-native
``(head, relation, tail)`` triples dataset with **leakage-safe, deterministic**
train/valid/test splits.

Everything here is a pure function over an input directory (no wall-clock, no
network, no MLflow) so tests can drive it with tiny temp-dir fixtures and the
build is byte-reproducible. The thin CLI + MLflow logging live in
:mod:`linguascrape_ml.export_triples`.

Design decisions (see ``ml/README.md`` §"Triples dataset"):

* **Derived temporal relations are excluded** (:data:`EXCLUDED_RELATIONS`).
  ``contemporary``/``precedes``/``follows`` became Datalog *rules* at query time
  (scale-ready-conversion, T-SR-US-001) — they are no longer stored edges, so
  training on them would be leakage against a derivable target. The current export
  already omits them; the filter is defensive and covered by a unit test.
* **Triples are deduplicated on ``(head, relation, tail)``.** The export emits one
  edge row *per supporting datum* (e.g. a language-pair ``COGNATE_WITH`` edge recurs
  once per shared cognate word, differing only in ``linguascrape_id``); link
  prediction operates on distinct typed edges, not their multiplicity.
* **Splits are grouped by unordered entity pair** so inverse / near-duplicate
  triples never straddle the split boundary (see :func:`split_triples`).
"""

from __future__ import annotations

import hashlib
import random
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

# neo4j-admin import header columns the exporter writes (shared/canonical-schema.json).
_START_COL = ":START_ID"
_END_COL = ":END_ID"
_TYPE_COL = ":TYPE"

# Derived temporal predicates — materialized as Datalog rules, NEVER stored edges
# (scale-ready-conversion T-SR-US-001). If a future export ever re-emits them as
# edges they must still be kept out of training triples: they are trivially
# derivable from time_start/time_end, so including them leaks a computable target.
# PART_OF_PERIOD is deliberately NOT here — it stayed a stored structural edge.
EXCLUDED_RELATIONS = frozenset({"CONTEMPORARY_WITH", "PRECEDES", "FOLLOWS"})

# Default split ratios + seed. Committed so every rerun reproduces the same split;
# a corpus change is what moves the manifest, never a reroll.
DEFAULT_SEED = 20260712
DEFAULT_RATIOS = (0.8, 0.1, 0.1)


@dataclass(frozen=True, order=True)
class Triple:
    """A single ``(head, relation, tail)`` fact. ``order=True`` → deterministic sort.

    Field order puts ``relation`` first so a sorted dump groups by relation, then
    head, then tail — matching how the vocab + splits are serialized.
    """

    relation: str
    head: str
    tail: str

    def as_row(self) -> str:
        """PyKEEN-native TSV row: ``head\\trelation\\ttail`` (no header)."""
        return f"{self.head}\t{self.relation}\t{self.tail}"


@dataclass
class Splits:
    """A leakage-safe train/valid/test partition of the triples."""

    train: list[Triple]
    valid: list[Triple]
    test: list[Triple]

    def items(self) -> list[tuple[str, list[Triple]]]:
        return [("train", self.train), ("valid", self.valid), ("test", self.test)]


def _read_edge_file(path: Path) -> list[Triple]:
    """Parse one ``edges/<rel>.tsv``; header-driven so column order can't bite us."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        return []
    header = lines[0].split("\t")
    try:
        h_idx = header.index(_START_COL)
        t_idx = header.index(_END_COL)
        r_idx = header.index(_TYPE_COL)
    except ValueError as exc:  # not an edge export file
        raise ValueError(f"{path} is missing a canonical edge header column") from exc

    out: list[Triple] = []
    for line in lines[1:]:
        if not line:
            continue
        cols = line.split("\t")
        head, tail, rel = cols[h_idx], cols[t_idx], cols[r_idx]
        if not head or not tail or not rel:
            continue
        if rel in EXCLUDED_RELATIONS:
            continue
        out.append(Triple(relation=rel, head=head, tail=tail))
    return out


def load_triples(edges_dir: Path | str) -> list[Triple]:
    """Load every ``edges/*.tsv``, drop excluded relations, dedup, return sorted.

    Deduplication is on the full ``(head, relation, tail)`` identity. Output is
    sorted so downstream serialization is byte-reproducible.
    """
    edges_dir = Path(edges_dir)
    seen: set[Triple] = set()
    for path in sorted(edges_dir.glob("*.tsv")):
        seen.update(_read_edge_file(path))
    return sorted(seen)


def _pair_key(t: Triple) -> tuple[str, str]:
    """Unordered entity-pair key — the grouping unit that stops inverse leakage."""
    return (t.head, t.tail) if t.head <= t.tail else (t.tail, t.head)


def split_triples(
    triples: list[Triple],
    *,
    seed: int = DEFAULT_SEED,
    ratios: tuple[float, float, float] = DEFAULT_RATIOS,
) -> Splits:
    """Deterministic, leakage-safe train/valid/test split.

    **Leakage mitigation.** Every triple sharing an *unordered* entity pair
    ``{head, tail}`` is assigned as one unit, so no split can contain the inverse
    or a near-duplicate of a triple in another split. This covers:

    * symmetric relations (``COGNATE_WITH``/``SYNCRETIZED_WITH`` store both
      directions — the reverse would otherwise be a free test answer);
    * cross-relation duplicates on the same pair (e.g. a language pair carrying
      both ``DERIVED_FROM`` and ``INFLUENCED_BY``);
    * reverse-direction pairs across the corpus (``A→B`` and ``B→A``).

    Determinism: groups are sorted, then shuffled with a seeded
    :class:`random.Random` (Mersenne Twister — stable across CPython versions),
    then greedily filled to the ``ratios`` triple-count targets. Same triples +
    same seed ⇒ byte-identical splits.
    """
    groups: dict[tuple[str, str], list[Triple]] = defaultdict(list)
    for t in triples:
        groups[_pair_key(t)].append(t)

    keys = sorted(groups)  # deterministic base order before the seeded shuffle
    random.Random(seed).shuffle(keys)

    n = len(triples)
    n_train = round(ratios[0] * n)
    n_valid = round(ratios[1] * n)

    train: list[Triple] = []
    valid: list[Triple] = []
    test: list[Triple] = []
    for key in keys:
        group = groups[key]
        if len(train) < n_train:
            train.extend(group)
        elif len(valid) < n_valid:
            valid.extend(group)
        else:
            test.extend(group)

    train.sort()
    valid.sort()
    test.sort()
    return Splits(train=train, valid=valid, test=test)


def entity_vocab(triples: list[Triple]) -> list[str]:
    """Sorted unique entity ids (heads ∪ tails)."""
    ents: set[str] = set()
    for t in triples:
        ents.add(t.head)
        ents.add(t.tail)
    return sorted(ents)


def relation_vocab(triples: list[Triple]) -> list[str]:
    """Sorted unique relation types."""
    return sorted({t.relation for t in triples})


def analyze_leakage(triples: list[Triple]) -> dict[str, object]:
    """Quantify the inverse / near-duplicate leakage the split mitigates.

    Returns machine-readable counts embedded in the committed manifest so the
    mitigation's justification travels with the dataset:

    * ``unorderedPairGroups`` — split-assignment units (unordered entity pairs);
    * ``reverseDirectionPairs`` — ordered pairs ``(h,t)`` whose reverse ``(t,h)``
      also appears (any relation) — inverse-leakage candidates;
    * ``multiRelationPairs`` — ordered pairs carrying more than one relation;
    * ``symmetricReverseTriples`` — triples whose exact inverse triple (same
      relation, swapped endpoints) is also present.
    """
    ordered_pairs: dict[tuple[str, str], set[str]] = defaultdict(set)
    triple_set = set(triples)
    for t in triples:
        ordered_pairs[(t.head, t.tail)].add(t.relation)

    reverse_direction = sum(
        1 for (h, t) in ordered_pairs if (t, h) in ordered_pairs
    )
    multi_relation = sum(1 for rels in ordered_pairs.values() if len(rels) > 1)
    symmetric_reverse = sum(
        1
        for tr in triples
        if tr.head != tr.tail
        and Triple(relation=tr.relation, head=tr.tail, tail=tr.head) in triple_set
    )
    groups = {_pair_key(t) for t in triples}
    return {
        "unorderedPairGroups": len(groups),
        "reverseDirectionPairs": reverse_direction,
        "multiRelationPairs": multi_relation,
        "symmetricReverseTriples": symmetric_reverse,
    }


def _sha256_lines(lines: list[str]) -> str:
    """Hash the exact bytes a ``\\n``-joined, trailing-newline file would hold."""
    body = ("\n".join(lines) + "\n") if lines else ""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def content_hash(triples: list[Triple]) -> str:
    """Content hash of a triple list as it is serialized to a triples TSV."""
    return _sha256_lines([t.as_row() for t in triples])


def build_manifest(
    triples: list[Triple],
    splits: Splits,
    *,
    seed: int = DEFAULT_SEED,
    ratios: tuple[float, float, float] = DEFAULT_RATIOS,
) -> dict[str, object]:
    """Deterministic split manifest: counts + content hashes + leakage stats.

    Committed to git and snapshot-tested against a fresh build, so an unintended
    corpus change (or a non-reproducible split) fails CI. Contains NO wall-clock
    or environment data — only functions of the triples + seed.
    """
    rel_counts = Counter(t.relation for t in triples)
    splits_meta = {
        name: {"triples": len(part), "sha256": content_hash(part)}
        for name, part in splits.items()
    }
    return {
        "seed": seed,
        "ratios": {"train": ratios[0], "valid": ratios[1], "test": ratios[2]},
        "excludedRelations": sorted(EXCLUDED_RELATIONS),
        "counts": {
            "triples": len(triples),
            "entities": len(entity_vocab(triples)),
            "relations": len(rel_counts),
        },
        "relationCounts": dict(sorted(rel_counts.items())),
        "triplesSha256": content_hash(triples),
        "splits": splits_meta,
        "leakage": analyze_leakage(triples),
    }
