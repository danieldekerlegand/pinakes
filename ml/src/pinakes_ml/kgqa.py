"""Multi-hop KG-grounded QA synthesis (neurosymbolic roadmap Phase 5, US-003).

Turns the canonical **node** + **edge** export
(``export/culturescrape/{nodes,edges}/*.tsv``) into chain-of-reasoning question /
answer training examples: each QA pair is grounded in an explicit **graph path**
or a **rule derivation**, and that path/derivation IS the reference answer's
justification (carried on the example as structured ``evidence``).

Two grounding kinds:

* **path** — a two-hop simple path ``head -r1-> mid -r2-> tail`` sampled from the
  neighbourhood graph (the ML-side mirror of a Neo4j ``findPath`` / neighbourhood
  expansion). The question states the first hop and asks for the second, so the
  answer can only be reached by following the chain. Only paths whose final hop
  ``(mid, r2)`` resolves to a **single** tail are emitted, so the answer is
  unambiguous for exact-match evaluation.
* **derivation** — an ``ancestor/2`` transitive-closure chain over
  ``DESCENDS_FROM`` (the ML-side mirror of the Datalog ``ancestor`` rule the
  materializer emits). For a node whose line of descent is an unambiguous simple
  path to a single root (every step has exactly one parent), the question asks for
  the *ultimate* ancestor; the whole chain is the derivation that justifies it.

Everything here is a **pure** function of the export directory + seed (no
wall-clock, no network, no MLflow, no live Neo4j — the graph is loaded from the
committed TSV export exactly like :mod:`pinakes_ml.triples` and
:mod:`pinakes_ml.verbalize`), so tests drive it with tiny temp-dir fixtures
and the build is byte-reproducible. The thin CLI + MLflow logging live in
:mod:`pinakes_ml.export_kgqa`; the OPTIONAL Gemini-polish pass (a clearly
separated variant, never required for CI) lives in
:mod:`pinakes_ml.polish_kgqa` and reuses :func:`apply_polish` here.

Design mirrors :mod:`pinakes_ml.verbalize`:

* **Derived temporal relations are excluded** (via
  :data:`~pinakes_ml.triples.EXCLUDED_RELATIONS`) — reused through
  :func:`~pinakes_ml.verbalize.load_edge_rows`, which drops them.
* **Edges dedup on ``(head, relation, tail)``** — provenance for a fact comes
  from the lexicographically-first supporting row (``load_edge_rows`` returns the
  rows already sorted, so the first-seen wins).
* **Splits are leakage-safe** — every QA sharing a *subject* entity is assigned to
  one split as a unit, so an entity's questions never straddle the held-out eval
  boundary (mirrors the unordered-pair grouping in :func:`triples.split_triples`).
"""

from __future__ import annotations

import hashlib
import json
import random
from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path

from pinakes_ml.verbalize import NodeInfo, load_edge_rows, load_nodes

# Pinned salt for deterministic sampling. A corpus change moves the manifest; a
# reroll never does (same seed ⇒ same sample + split).
DEFAULT_SEED = 20260713

# Fraction of QA examples reserved as the held-out KGQA eval split (US-004 scores
# on it). Subject-grouped so an entity's questions never straddle the boundary.
DEFAULT_EVAL_RATIO = 0.15

# Per-kind candidate caps. The seeded sample only fires when candidates exceed the
# cap; on today's corpus every candidate is kept (deterministic sorted order).
DEFAULT_MAX_PER_KIND = 8000

# The genealogical relation whose transitive closure gives the ancestor derivation.
DESCENT_RELATION = "DESCENDS_FROM"

# Minimum hops for a derivation to be genuinely multi-hop (1 hop = a stored edge).
MIN_DERIVATION_HOPS = 2

# License restrictiveness, least → most. The top-level QA ``license`` is the
# most-restrictive class across its evidence edges, so a consumer filtering by
# license sees the binding constraint. An unknown license ranks most-restrictive.
LICENSE_PRECEDENCE: tuple[str, ...] = (
    "CC0-1.0",
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "GFDL-1.3-or-later",
)

# Statement clause per edge :TYPE — "{h} <verb> {t}" — used for the earlier hop(s).
REL_STATEMENT: dict[str, str] = {
    "DESCENDS_FROM": "{h} descends from {t}",
    "SPLIT_FROM": "{h} split from {t}",
    "MERGED_WITH": "{h} merged with {t}",
    "INFLUENCED_BY": "{h} was influenced by {t}",
    "CONQUERED_BY": "{h} was conquered by {t}",
    "ABSORBED_INTO": "{h} was absorbed into {t}",
    "SPOKEN_IN": "{h} is spoken in {t}",
    "LOCATED_IN": "{h} is located in {t}",
    "PART_OF_PERIOD": "{h} belongs to the {t} period",
    "BORROWED_FROM": "{h} borrowed a term from {t}",
    "COGNATE_WITH": "{h} is cognate with {t}",
    "DERIVED_FROM": "{h} is derived from {t}",
    "SYNCRETIZED_WITH": "{h} was syncretized with {t}",
}

# Question clause per edge :TYPE — asks for the tail given the head. The answer is
# the tail name. Used for the final hop of a path question.
REL_QUESTION: dict[str, str] = {
    "DESCENDS_FROM": "what does {h} descend from?",
    "SPLIT_FROM": "what did {h} split from?",
    "MERGED_WITH": "what did {h} merge with?",
    "INFLUENCED_BY": "what was {h} influenced by?",
    "CONQUERED_BY": "what was {h} conquered by?",
    "ABSORBED_INTO": "what was {h} absorbed into?",
    "SPOKEN_IN": "where is {h} spoken?",
    "LOCATED_IN": "where is {h} located?",
    "PART_OF_PERIOD": "which period does {h} belong to?",
    "BORROWED_FROM": "what did {h} borrow a term from?",
    "COGNATE_WITH": "what is {h} cognate with?",
    "DERIVED_FROM": "what is {h} derived from?",
    "SYNCRETIZED_WITH": "what was {h} syncretized with?",
}

# Two-hop path question: state the first hop, ask the second.
PATH_TEMPLATE = "{stmt}. Following from there, {ask}"

# Ancestor-derivation question (the transitive-closure chain is the justification).
DERIVATION_TEMPLATE = (
    "Tracing its line of descent step by step, what is the earliest ancestor of "
    "{subject} recorded in the corpus?"
)


@dataclass(frozen=True)
class EvidenceEdge:
    """One grounding edge of a QA path/derivation (structured evidence)."""

    head: str
    head_name: str
    relation: str
    tail: str
    tail_name: str
    source: str
    source_url: str
    license: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class QAExample:
    """One KG-grounded QA training example (a flat, uniform record).

    Flat string fields (``hops`` the sole int) keep the JSONL schema uniform
    across path and derivation rows so ``datasets.load_dataset("json", …)`` infers
    one feature set. ``evidence`` is a JSON-encoded list of :class:`EvidenceEdge`
    dicts — the grounding path/derivation in structured form, kept as a single
    string column so the outer schema stays flat.
    """

    question: str
    answer: str
    kind: str  # "path" | "derivation"
    reasoning_type: str  # "multi_hop_path" | "ancestor_chain"
    hops: int
    subject: str  # anchor entity csid (the split-grouping key)
    subject_name: str
    answer_id: str  # answer entity csid
    relation_path: str  # ">"-joined relations along the grounding chain
    evidence: str  # JSON-encoded list[EvidenceEdge]
    template_id: str
    source: str
    source_url: str
    license: str

    def _sort_key(self) -> tuple[str, ...]:
        return (
            self.kind,
            self.subject,
            self.relation_path,
            self.answer_id,
            self.template_id,
            self.question,
        )

    def as_json_line(self) -> str:
        """Deterministic single-line JSON (sorted keys, unicode preserved)."""
        return json.dumps(asdict(self), sort_keys=True, ensure_ascii=False)


# --- graph construction --------------------------------------------------------


def _most_restrictive(licenses: list[str]) -> str:
    """The most-restrictive SPDX class among evidence edges (unknown ⇒ most)."""
    best = ""
    best_rank = -1
    for lic in licenses:
        rank = (
            LICENSE_PRECEDENCE.index(lic)
            if lic in LICENSE_PRECEDENCE
            else len(LICENSE_PRECEDENCE)
        )
        if rank > best_rank:
            best_rank = rank
            best = lic
    return best


@dataclass
class Graph:
    """The neighbourhood graph loaded from the canonical edge export.

    ``edge_index`` maps a distinct ``(head, relation, tail)`` to its provenance
    (from the lexicographically-first supporting row); ``adjacency`` and
    ``rel_out`` are the traversal indices built from those distinct edges.
    """

    nodes: dict[str, NodeInfo]
    edge_index: dict[tuple[str, str, str], EvidenceEdge]
    adjacency: dict[str, list[tuple[str, str]]]  # head -> [(relation, tail)]
    rel_out: dict[str, dict[str, list[str]]]  # relation -> head -> [tail]


def build_graph(export_dir: Path | str) -> Graph:
    """Load nodes + edges into traversal indices. Pure over the export dir."""
    export_dir = Path(export_dir)
    nodes = load_nodes(export_dir / "nodes")
    edge_rows = load_edge_rows(export_dir / "edges")

    edge_index: dict[tuple[str, str, str], EvidenceEdge] = {}
    for row in edge_rows:
        key = (row.head, row.relation, row.tail)
        if key in edge_index:
            continue  # first-wins provenance (rows arrive sorted)
        head = nodes.get(row.head)
        tail = nodes.get(row.tail)
        if head is None or tail is None:
            continue  # an endpoint we cannot name — unusable for a QA
        edge_index[key] = EvidenceEdge(
            head=row.head,
            head_name=head.name,
            relation=row.relation,
            tail=row.tail,
            tail_name=tail.name,
            source=row.source,
            source_url=row.source_url,
            license=row.license,
        )

    adjacency: dict[str, list[tuple[str, str]]] = defaultdict(list)
    rel_out: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for (head, relation, tail) in sorted(edge_index):
        adjacency[head].append((relation, tail))
        rel_out[relation][head].append(tail)
    return Graph(
        nodes=nodes, edge_index=edge_index, adjacency=adjacency, rel_out=rel_out
    )


# --- example construction ------------------------------------------------------


def _evidence_json(edges: list[EvidenceEdge]) -> str:
    return json.dumps([e.as_dict() for e in edges], sort_keys=True, ensure_ascii=False)


def _qa_from_evidence(
    *,
    question: str,
    answer: str,
    kind: str,
    reasoning_type: str,
    subject: str,
    subject_name: str,
    answer_id: str,
    template_id: str,
    edges: list[EvidenceEdge],
) -> QAExample:
    """Assemble a QA example, aggregating provenance from its evidence chain."""
    first = edges[0]
    return QAExample(
        question=question,
        answer=answer,
        kind=kind,
        reasoning_type=reasoning_type,
        hops=len(edges),
        subject=subject,
        subject_name=subject_name,
        answer_id=answer_id,
        relation_path=">".join(e.relation for e in edges),
        evidence=_evidence_json(edges),
        template_id=template_id,
        source=first.source,
        source_url=first.source_url,
        license=_most_restrictive([e.license for e in edges]),
    )


def path_examples(
    graph: Graph,
    *,
    statements: Mapping[str, str] = REL_STATEMENT,
    questions: Mapping[str, str] = REL_QUESTION,
) -> tuple[list[QAExample], dict[str, int]]:
    """Two-hop path QA with a single, unambiguous final answer.

    ``statements``/``questions`` are the per-``:TYPE`` phrasings; overriding them
    is how a caller runs this generator over a graph with a different relation
    vocabulary (``insimul_datasets`` does exactly that for converted worlds). A
    relation absent from either table contributes no question — callers own a
    coverage gate over their own vocabulary, as :mod:`pinakes_ml.verbalize` does.
    """
    examples: list[QAExample] = []
    ambiguous = 0
    seen: set[tuple[str, str, str, str]] = set()
    for head in sorted(graph.adjacency):
        for r1, mid in graph.adjacency[head]:
            if mid == head:
                continue
            for r2, tail in graph.adjacency.get(mid, ()):  # sorted already
                if tail in (head, mid):
                    continue
                if r1 not in statements or r2 not in questions:
                    continue
                # answer must be unique: (mid, r2) resolves to exactly one tail
                if len(graph.rel_out[r2][mid]) != 1:
                    ambiguous += 1
                    continue
                key = (head, r1, mid, r2)
                if key in seen:
                    continue
                seen.add(key)
                e1 = graph.edge_index[(head, r1, mid)]
                e2 = graph.edge_index[(mid, r2, tail)]
                stmt = statements[r1].format(h=e1.head_name, t=e1.tail_name)
                ask = questions[r2].format(h=e2.head_name)
                examples.append(
                    _qa_from_evidence(
                        question=PATH_TEMPLATE.format(stmt=stmt, ask=ask),
                        answer=e2.tail_name,
                        kind="path",
                        reasoning_type="multi_hop_path",
                        subject=head,
                        subject_name=e1.head_name,
                        answer_id=tail,
                        template_id=f"path.{r1.lower()}__{r2.lower()}",
                        edges=[e1, e2],
                    )
                )
    return examples, {"ambiguousFinalHop": ambiguous}


def _derivation_examples(graph: Graph) -> tuple[list[QAExample], dict[str, int]]:
    """Ancestor-chain QA: the transitive ``DESCENDS_FROM`` closure is the answer's
    justification. Only chains with a single unambiguous root are emitted."""
    parents = graph.rel_out.get(DESCENT_RELATION, {})
    examples: list[QAExample] = []
    ambiguous = 0
    cyclic = 0
    for start in sorted(parents):
        edges: list[EvidenceEdge] = []
        current = start
        visited: set[str] = {start}
        ok = True
        while True:
            outs = parents.get(current, [])
            if len(outs) == 0:
                break  # reached a root
            if len(outs) > 1:
                ok = False
                ambiguous += 1
                break
            nxt = outs[0]
            if nxt in visited:
                ok = False
                cyclic += 1
                break
            edges.append(graph.edge_index[(current, DESCENT_RELATION, nxt)])
            visited.add(nxt)
            current = nxt
        if not ok or len(edges) < MIN_DERIVATION_HOPS:
            continue
        root = edges[-1]
        subject = graph.nodes[start]
        examples.append(
            _qa_from_evidence(
                question=DERIVATION_TEMPLATE.format(subject=subject.name),
                answer=root.tail_name,
                kind="derivation",
                reasoning_type="ancestor_chain",
                subject=start,
                subject_name=subject.name,
                answer_id=root.tail,
                template_id="derivation.ancestor",
                edges=edges,
            )
        )
    return examples, {"ambiguousAncestorBranch": ambiguous, "cyclicDescent": cyclic}


def _sample(
    examples: list[QAExample], *, seed: int, cap: int
) -> tuple[list[QAExample], int]:
    """Deterministically cap a candidate list. Returns (kept, dropped)."""
    if len(examples) <= cap:
        return examples, 0
    ordered = sorted(examples, key=lambda e: e._sort_key())
    idx = list(range(len(ordered)))
    random.Random(seed).shuffle(idx)
    kept = [ordered[i] for i in sorted(idx[:cap])]
    return kept, len(ordered) - cap


def build_examples(
    export_dir: Path | str,
    *,
    seed: int = DEFAULT_SEED,
    max_per_kind: int = DEFAULT_MAX_PER_KIND,
) -> tuple[list[QAExample], dict[str, int]]:
    """Pure build: load graph → sample path + derivation QA → sorted examples.

    Output is sorted by :meth:`QAExample._sort_key` so serialization is
    byte-reproducible. The returned stats dict records candidate/skip counts.
    """
    graph = build_graph(export_dir)
    path_all, path_stats = path_examples(graph)
    deriv_all, deriv_stats = _derivation_examples(graph)
    path_kept, path_dropped = _sample(path_all, seed=seed, cap=max_per_kind)
    deriv_kept, deriv_dropped = _sample(deriv_all, seed=seed + 1, cap=max_per_kind)
    examples = sorted(path_kept + deriv_kept, key=lambda e: e._sort_key())
    stats = {
        "pathCandidates": len(path_all),
        "derivationCandidates": len(deriv_all),
        "pathDroppedBySampling": path_dropped,
        "derivationDroppedBySampling": deriv_dropped,
        **path_stats,
        **deriv_stats,
    }
    return examples, stats


# --- leakage-safe train / held-out-eval split ----------------------------------


@dataclass
class Splits:
    """A subject-grouped train / held-out-eval partition of the QA examples."""

    train: list[QAExample]
    eval: list[QAExample]

    def items(self) -> list[tuple[str, list[QAExample]]]:
        return [("train", self.train), ("eval", self.eval)]


def split_examples(
    examples: list[QAExample],
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
) -> Splits:
    """Deterministic, leakage-safe train / held-out-eval split.

    Every QA sharing a *subject* entity is assigned as one unit, so an entity's
    questions never straddle the eval boundary. Groups are sorted, seeded-shuffled
    (Mersenne Twister — stable across CPython), then greedily filled to the eval
    example-count target. Same examples + seed ⇒ byte-identical splits.
    """
    groups: dict[str, list[QAExample]] = defaultdict(list)
    for e in examples:
        groups[e.subject].append(e)

    keys = sorted(groups)
    random.Random(seed).shuffle(keys)

    n_eval_target = round(eval_ratio * len(examples))
    train: list[QAExample] = []
    held: list[QAExample] = []
    for key in keys:
        group = groups[key]
        if len(held) < n_eval_target:
            held.extend(group)
        else:
            train.extend(group)
    train.sort(key=lambda e: e._sort_key())
    held.sort(key=lambda e: e._sort_key())
    return Splits(train=train, eval=held)


# --- serialization + manifest --------------------------------------------------


def serialize_examples(examples: list[QAExample]) -> str:
    """Exact JSONL body (one record per line, trailing newline)."""
    if not examples:
        return ""
    return "\n".join(e.as_json_line() for e in examples) + "\n"


def content_hash(examples: list[QAExample]) -> str:
    """sha256 of the exact JSONL bytes a dataset file of these examples holds."""
    return hashlib.sha256(serialize_examples(examples).encode("utf-8")).hexdigest()


def _counter(values: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def _hops_histogram(examples: list[QAExample]) -> dict[str, int]:
    return _counter([str(e.hops) for e in examples])


def build_manifest(
    examples: list[QAExample],
    splits: Splits,
    stats: dict[str, int],
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
) -> dict[str, object]:
    """Deterministic manifest: composition + per-split hashes + candidate stats.

    No wall-clock — a function of the corpus + seed, so it is committed to git and
    snapshot-tested against a fresh build. The ``splits.eval`` entry IS the
    registered held-out KGQA eval split the eval harness (US-004) scores on.
    """
    path = [e for e in examples if e.kind == "path"]
    deriv = [e for e in examples if e.kind == "derivation"]
    return {
        "seed": seed,
        "evalRatio": eval_ratio,
        "counts": {
            "examples": len(examples),
            "path": len(path),
            "derivation": len(deriv),
        },
        "kindCounts": _counter([e.kind for e in examples]),
        "reasoningTypeCounts": _counter([e.reasoning_type for e in examples]),
        "relationPathCounts": _counter([e.relation_path for e in examples]),
        "templateCounts": _counter([e.template_id for e in examples]),
        "licenseCounts": _counter([e.license or "(none)" for e in examples]),
        "hopsHistogram": _hops_histogram(examples),
        "candidateStats": dict(sorted(stats.items())),
        "splits": {
            name: {"examples": len(part), "sha256": content_hash(part)}
            for name, part in splits.items()
        },
        "sha256": content_hash(examples),
    }


# --- OPTIONAL Gemini-polish variant (never required for CI) ---------------------

# Marker distinguishing the polished variant records from the deterministic core.
POLISHED_VARIANT = "gemini-polished"


def apply_polish(
    records: list[dict[str, object]],
    polish_fn: Callable[[str], str],
) -> list[dict[str, object]]:
    """Produce a clearly-separated polished variant of QA records.

    ``polish_fn`` rewrites the *question* surface (a networked Gemini call in the
    CLI; a fake in tests). The grounding — ``answer``/``evidence``/provenance — is
    left untouched, so the derivation still justifies the (unchanged) answer. Each
    output record keeps the original question as ``question_original``, adds the
    polished ``question``, and is stamped ``variant=POLISHED_VARIANT`` so it is
    never confused with the deterministic core dataset. Pure given ``polish_fn``.
    """
    out: list[dict[str, object]] = []
    for record in records:
        polished = dict(record)
        original_question = str(record.get("question", ""))
        polished["question_original"] = original_question
        polished["question"] = polish_fn(original_question)
        polished["variant"] = POLISHED_VARIANT
        out.append(polished)
    return out
