"""DeepProbLog feasibility run + Scallop comparison (Phase 5, US-004).

The neurosymbolic pilot's second half. US-003 built a **differentiable rule-guided
link predictor** in Scallop's ``minmaxprob`` provenance; this module runs the *same
task* through the **DeepProbLog / ProbLog** stack, measures where exact probabilistic
inference ceils out at corpus scale, and feeds the written go/no-go comparison
(``docs/neurosymbolic-pilot-report.md``) that shapes the next PRD.

**Why this can run honestly on any host.** DeepProbLog's inference *backend is
ProbLog* — its neural annotated disjunctions only replace a fact's fixed probability
with a network output; grounding and knowledge-compilation (the cost that determines
feasibility) are ordinary ProbLog. ``problog`` is a **declared** ``ml/`` dependency
(unlike ``scallopy`` / the finetune stack), so the ProbLog program the DeepProbLog
model would compile runs here for real, and the scale ceiling is measured directly.
The ``deepproblog`` package itself (the neural-AD training loop) is undeclared —
gated by :func:`require_deepproblog_deps` and ``# pragma: no cover``, exactly like the
macOS-only ``scallopy`` backend in US-003.

**What is measured (all deterministic + portable, so it runs in CI on fixtures):**

* :func:`render_problog_program` — the runnable annotated-fact ProbLog program (base
  ``descends_from`` facts carrying their neural/soft edge probability + the recursive
  ``ancestor`` rule + the training queries). :func:`render_deepproblog_program` emits
  the faithful DeepProbLog **neural-AD** analogue (``nn(edge_net, [H,T]) :: edge(H,T)``)
  as a committed artifact, the ``.pl`` counterpart of US-001's ``build_scl_program``.
* :func:`proof_multiplicity` — the number of distinct proofs (simple paths) per query.
  This is the exact-inference hardness driver: d-DNNF / SDD size grows with the proof
  count, **not** with the grounding size. On a dense "ladder" it is exponential while
  the ground formula stays compact — the crux of the Scallop-vs-DeepProbLog story.
* :func:`ground_size` — ProbLog's Python grounder node count (no external compiler),
  a deterministic, portable complexity metric.
* :func:`evaluate_program` — a best-effort *exact* ProbLog evaluation, wall-clock- and
  crash-guarded (the bundled ``dsharp`` d-DNNF compiler segfaults on dense/cyclic
  instances on this host, and ``pysdd`` is not installed — a real integration-cost
  datapoint recorded, never fatal).
* :func:`scale_probe` — sweeps corpus subset sizes and records grounding + proof
  multiplicity + compile feasibility per size: *the scale ceiling, measured*.

The semantics divergence the report turns on is exact and unit-tested:
:func:`problog_chain_marginal` (ProbLog's **noisy-or over independent proofs**) vs
:func:`minmax_chain_width` (Scallop's **widest-path bottleneck**) — the same recursive
``ancestor`` rule, two different probabilistic semantics, different numbers.
"""

from __future__ import annotations

import re
import signal
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

# Pair of csids (head, tail) in string space — the corpus edge/query unit here.
Pair = tuple[str, str]

# The recursive relation both engines close over (US-003's "ancestor chains").
ANCESTOR_PREDICATE = "ancestor"
EDGE_PREDICATE = "edge"


# --- configuration -----------------------------------------------------------


@dataclass(frozen=True)
class FeasibilityConfig:
    """Config for one DeepProbLog feasibility run (committed as an artifact).

    Round-trippable (``from_dict`` / ``to_dict``) and frozen, the same discipline as
    US-003's :class:`~pinakes_ml.scallop_train.PilotConfig`. Paths resolve
    against the ``ml/`` root via :meth:`resolved`.
    """

    triples_dir: str = "data/triples"
    # The target relation exercised in DeepProbLog (the one with a sound recursive
    # rule — borrowing has none, so it is direct-only and not part of the closure).
    target_relation: str = "DESCENDS_FROM"
    # Corpus subset sizes swept by the scale probe (number of base edges).
    scale_sizes: tuple[int, ...] = (25, 50, 100, 200, 400, 800)
    # Multi-hop queries per probe size (kept small — each is exactly compiled).
    queries_per_size: int = 20
    # Simple-path proof-count cap (>= this is reported as "exceeded", never enumerated
    # to exhaustion — the cap itself signals the exponential regime).
    proof_cap: int = 10_000
    # Per-evaluation wall-clock budget (seconds). Exceeding it, or a compiler crash,
    # is recorded as a ceiling hit, not an error.
    eval_timeout: float = 10.0
    # Max edges in the tractable reduced subgraph the "task runs in DeepProbLog"
    # demonstration compiles (small enough that exact inference always succeeds).
    reduced_max_edges: int = 12
    # Deterministic pseudo-confidence for base edges when no scorer is supplied
    # (keeps the probe reproducible without loading the torch neural predicate).
    default_edge_prob: float = 0.6
    seed: int = 20260713

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> FeasibilityConfig:
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown config keys: {sorted(unknown)}")
        payload = dict(data)
        if payload.get("scale_sizes") is not None:
            payload["scale_sizes"] = tuple(payload["scale_sizes"])  # type: ignore[arg-type]
        return cls(**payload)  # type: ignore[arg-type]

    @classmethod
    def from_json(cls, path: Path | str) -> FeasibilityConfig:
        import json

        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["scale_sizes"] = list(self.scale_sizes)
        return data

    def resolved(self, base: Path | str) -> FeasibilityConfig:
        base = Path(base)
        triples = Path(self.triples_dir)
        return FeasibilityConfig.from_dict(
            {
                **self.to_dict(),
                "triples_dir": str(
                    triples if triples.is_absolute() else base / triples
                ),
            }
        )


# --- ProbLog program rendering -----------------------------------------------

# A ProbLog constant must start lowercase and contain only [a-z0-9_]; csids carry
# ``:`` and ``-``. Prefix + character-class scrub gives a stable, collision-free atom.
_UNSAFE = re.compile(r"[^a-z0-9_]")


def sanitize_atom(csid: str) -> str:
    """A ProbLog-safe lowercase constant for a csid (stable + injective in practice).

    ``cs:language:Q123`` → ``n_cs_language_q123``. Injective on the corpus vocab
    (csids differ in their alnum content), so distinct entities stay distinct facts.
    """
    return "n_" + _UNSAFE.sub("_", csid.lower())


def _prob_atom(prob: float) -> str:
    """A certain fact (prob >= 1) is unannotated; otherwise ``W::`` annotated."""
    return "" if prob >= 1.0 else f"{prob:.6f}::"


def render_problog_program(
    base_pairs: Sequence[Pair],
    edge_prob: Mapping[Pair, float] | float,
    queries: Iterable[Pair],
    *,
    ancestor: str = ANCESTOR_PREDICATE,
    edge: str = EDGE_PREDICATE,
) -> str:
    """The runnable ProbLog program the DeepProbLog model compiles per query.

    Annotated base ``edge`` facts (each carrying its soft/neural probability) + the
    recursive ``ancestor`` closure + a ``query/1`` per requested pair. This is exactly
    what DeepProbLog grounds and knowledge-compiles; feeding it to the declared
    ``problog`` engine (:func:`evaluate_program`) measures the real inference cost.
    """
    lines = [
        "% Rule-guided link prediction — DeepProbLog/ProbLog feasibility (US-004).",
        f"% Base {edge}/2 facts carry the soft edge probability; the recursive",
        f"% {ancestor}/2 rule is the same closure US-003 runs under minmaxprob.",
    ]
    for h, t in base_pairs:
        p = edge_prob if isinstance(edge_prob, (int, float)) else edge_prob[(h, t)]
        lines.append(f"{_prob_atom(float(p))}{edge}({sanitize_atom(h)},{sanitize_atom(t)}).")
    lines.append(f"{ancestor}(X,Y) :- {edge}(X,Y).")
    lines.append(f"{ancestor}(X,Y) :- {edge}(X,Z), {ancestor}(Z,Y).")
    for h, t in queries:
        lines.append(f"query({ancestor}({sanitize_atom(h)},{sanitize_atom(t)})).")
    return "\n".join(lines) + "\n"


def render_deepproblog_program(
    *, ancestor: str = ANCESTOR_PREDICATE, edge: str = EDGE_PREDICATE
) -> str:
    """The faithful DeepProbLog **neural-AD** program (a committed artifact).

    Where :func:`render_problog_program` writes fixed ``W::edge(h,t)`` annotations,
    DeepProbLog replaces the probability with a network: ``nn(edge_net, [H,T]) ::
    edge(H,T)`` binds a registered neural module ``edge_net`` (the US-003 PyKEEN-fed
    edge scorer) to the ``edge/2`` probability. The ``ancestor`` closure is identical.
    Pure function of the predicate names → committed + asserted by a test, the ``.pl``
    counterpart of US-001's ``build_scl_program``.
    """
    return (
        "% DeepProbLog program (neurosymbolic roadmap Phase 5, US-004).\n"
        "% edge/2's probability is produced by a neural module `edge_net` — the same\n"
        "% PyKEEN-fed edge scorer as the US-003 Scallop pilot — via a neural AD.\n"
        f"nn(edge_net, [H, T]) :: {edge}(H, T).\n"
        f"{ancestor}(X, Y) :- {edge}(X, Y).\n"
        f"{ancestor}(X, Y) :- {edge}(X, Z), {ancestor}(Z, Y).\n"
    )


# --- proof multiplicity (the exact-inference hardness driver) ----------------


def _adjacency(base_pairs: Iterable[Pair]) -> dict[str, list[str]]:
    adj: dict[str, list[str]] = {}
    for h, t in base_pairs:
        adj.setdefault(h, []).append(t)
    return adj


def count_paths(
    adj: Mapping[str, Sequence[str]], source: str, target: str, *, cap: int
) -> int:
    """Number of distinct **simple** directed paths ``source -> ... -> target``.

    The count of independent proofs of ``ancestor(source, target)`` — what a
    knowledge compiler must disjoin, so it drives d-DNNF / SDD size and the exact
    inference cost. Simple paths (no repeated node) is the right notion: ProbLog's
    tabled evaluation breaks cycles, so a cycle multiplies but does not infinitely
    unfold the proofs. Counting stops at ``cap`` (returned as the "exponential
    regime" sentinel) so a dense graph never enumerates to exhaustion.
    """
    count = 0
    stack: list[tuple[str, frozenset[str]]] = [(source, frozenset({source}))]
    while stack:
        node, seen = stack.pop()
        for nxt in adj.get(node, ()):  # type: ignore[arg-type]
            if nxt == target:
                count += 1
                if count >= cap:
                    return cap
            elif nxt not in seen:
                stack.append((nxt, seen | {nxt}))
    return count


def proof_multiplicity(
    base_pairs: Sequence[Pair], queries: Iterable[Pair], *, cap: int
) -> dict[Pair, int]:
    """Per-query proof (simple-path) count, capped at ``cap``."""
    adj = _adjacency(base_pairs)
    return {(h, t): count_paths(adj, h, t, cap=cap) for h, t in queries}


def has_cycle(base_pairs: Iterable[Pair]) -> bool:
    """Whether the directed edge graph contains a cycle (iterative DFS, no recursion).

    A cyclic probabilistic ``ancestor`` relation is the pathological case for exact
    knowledge compilation; the corpus descent graph has cycles (the same ones the
    US-003 tier-2 consistency ratchet counts), so this is recorded in the report.
    """
    adj = _adjacency(base_pairs)
    color: dict[str, int] = {}  # 0/absent=white, 1=grey (on stack), 2=black
    for root in list(adj):
        if color.get(root):
            continue
        stack: list[tuple[str, int]] = [(root, 0)]
        color[root] = 1
        while stack:
            node, i = stack[-1]
            nbrs = adj.get(node, [])
            if i < len(nbrs):
                stack[-1] = (node, i + 1)
                nxt = nbrs[i]
                c = color.get(nxt, 0)
                if c == 1:
                    return True
                if c == 0:
                    color[nxt] = 1
                    stack.append((nxt, 0))
            else:
                color[node] = 2
                stack.pop()
    return False


# --- exact ProbLog evaluation (best-effort, crash/timeout guarded) -----------


@dataclass
class FeasResult:
    """Outcome of a best-effort exact ProbLog evaluation of one program."""

    ok: bool
    seconds: float
    marginals: dict[str, float] = field(default_factory=dict)
    error: str | None = None


class _Timeout(Exception):
    pass


def ground_size(program_text: str) -> int:
    """Node count of ProbLog's ground formula (Python grounder — no external compiler).

    Deterministic + portable, so a CI test can assert it; it grows with the *relevant*
    grounding of the queries, and — the point of the comparison — stays compact even
    when the proof count (and thus compilation cost) is exploding.
    """
    from problog.formula import LogicFormula
    from problog.program import PrologString

    return len(LogicFormula.create_from(PrologString(program_text)))


def evaluate_program(program_text: str, *, timeout: float = 10.0) -> FeasResult:
    """Exact ProbLog inference, guarded so a slow/crashing compile is *measured*.

    The bundled ``dsharp`` d-DNNF compiler segfaults on dense/cyclic instances on this
    host (raising ``DSharpError``) and ``pysdd`` is absent — both are recorded as a
    ceiling hit (``ok=False`` with the error name), never propagated. A wall-clock
    ``SIGALRM`` bounds genuinely slow (non-crashing) compiles. Small tractable
    programs return their exact query marginals in ``marginals``.
    """
    import time

    from problog import get_evaluatable
    from problog.program import PrologString

    def _handler(signum: int, frame: object) -> None:  # pragma: no cover - timing
        raise _Timeout()

    prev = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, _handler)
    signal.setitimer(signal.ITIMER_REAL, max(timeout, 0.0))
    start = time.perf_counter()
    try:
        result = get_evaluatable().create_from(PrologString(program_text)).evaluate()
        marginals = {str(k): float(v) for k, v in result.items()}
        elapsed = time.perf_counter() - start
        return FeasResult(ok=True, seconds=elapsed, marginals=marginals)
    except _Timeout:  # pragma: no cover - host/size dependent
        return FeasResult(False, time.perf_counter() - start, error="timeout")
    except Exception as exc:  # noqa: BLE001 - a ceiling hit is data, not a failure
        return FeasResult(
            False, time.perf_counter() - start, error=type(exc).__name__
        )
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0.0)
        signal.signal(signal.SIGALRM, prev)


# --- semantics divergence: noisy-or (ProbLog) vs widest-path (Scallop) --------


def problog_chain_marginal(edge_probs: Sequence[float]) -> float:
    """Exact ``ancestor`` marginal of a single directed chain under ProbLog.

    A chain contributes exactly one proof, whose probability is the product of its
    edge probabilities (independent causes). For a single path this equals ProbLog's
    exact marginal; :func:`problog_two_path_marginal` covers the multi-proof case.
    """
    p = 1.0
    for w in edge_probs:
        p *= w
    return p


def problog_two_path_marginal(
    path_a: Sequence[float], path_b: Sequence[float]
) -> float:
    """Exact ProbLog marginal of ``ancestor`` reachable by **two disjoint** paths.

    ProbLog's semantics is a **noisy-or over independent proofs**:
    ``1 - (1 - P_a)(1 - P_b)`` where each ``P`` is that path's product. This is the
    number the report contrasts with Scallop's widest-path max — the two engines
    return *different* probabilities for the same rule, the crux of the expressiveness
    axis. Both path products are assumed edge-disjoint (independent).
    """
    pa = problog_chain_marginal(path_a)
    pb = problog_chain_marginal(path_b)
    return 1.0 - (1.0 - pa) * (1.0 - pb)


def minmax_chain_width(edge_probs: Sequence[float]) -> float:
    """Scallop's ``minmaxprob`` bottleneck of a single chain — ``min`` edge prob.

    The widest-path semantics US-003's
    :func:`~pinakes_ml.scallop_train.minmax_widths` computes: a path's strength
    is its weakest edge. For two paths Scallop takes the
    ``max`` of the per-path minima (best bottleneck), never the noisy-or.
    """
    return min(edge_probs) if edge_probs else 1.0


# --- scale probe (the ceiling, measured) -------------------------------------


@dataclass
class ScalePoint:
    """One row of the scale sweep: complexity + per-query compile feasibility.

    DeepProbLog compiles **per training example**, so each query is knowledge-compiled
    on its own (never batched); the sweep mirrors that — ``queries_compiled`` of
    ``num_queries`` succeeded, at ``avg_query_seconds`` each. ``ground_nodes`` is the
    (portable, no-compiler) grounding size and stays compact even where the proof
    count — the compilation driver — grows.
    """

    num_edges: int
    num_queries: int
    ground_nodes: int
    max_proof_multiplicity: int
    proof_cap_hit: bool
    queries_compiled: int
    avg_query_seconds: float
    error: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def reachable_multihop_pairs(
    base_pairs: Sequence[Pair], *, limit: int, min_hops: int = 2
) -> list[Pair]:
    """Deterministic ``(source, target)`` pairs reachable in >= ``min_hops`` edges.

    BFS from sorted sources so the query set is reproducible; these are the non-trivial
    ``ancestor`` queries (a 1-hop pair is just a base fact, no closure exercised).
    """
    adj = _adjacency(base_pairs)
    pairs: list[Pair] = []
    for source in sorted(adj):
        seen = {source}
        frontier: list[tuple[str, int]] = [(source, 0)]
        while frontier:
            node, depth = frontier.pop(0)
            for nxt in adj.get(node, []):
                if nxt not in seen:
                    seen.add(nxt)
                    if depth + 1 >= min_hops:
                        pairs.append((source, nxt))
                    frontier.append((nxt, depth + 1))
        if len(pairs) >= limit:
            break
    return pairs[:limit]


def scale_probe(
    base_pairs: Sequence[Pair],
    config: FeasibilityConfig,
    *,
    edge_prob: Mapping[Pair, float] | float | None = None,
) -> list[ScalePoint]:
    """Sweep corpus subset sizes; record grounding + proof count + compile feasibility.

    For each size ``N`` (capped at ``len(base_pairs)``): take the first ``N`` base
    edges, draw ``queries_per_size`` reachable multi-hop queries within them, and
    record the deterministic complexity (ground node count, max proof multiplicity)
    plus **per-query** exact-compilation feasibility — each query compiled on its own,
    as DeepProbLog does per training example. The proof multiplicity is the signal that
    diverges from grounding: where it explodes (a dense graph), DeepProbLog's exact
    inference ceils out while Scallop's provenance pass is unaffected. At current corpus
    scale the descent graph is a sparse forest, so per-query inference is tractable and
    the binding constraint is throughput (queries × epochs × per-query compile).
    """
    weight = config.default_edge_prob if edge_prob is None else edge_prob
    points: list[ScalePoint] = []
    seen_sizes: set[int] = set()
    for raw in config.scale_sizes:
        n = min(raw, len(base_pairs))
        if n in seen_sizes:
            continue
        seen_sizes.add(n)
        subset = list(base_pairs[:n])
        queries = reachable_multihop_pairs(subset, limit=config.queries_per_size)
        mult = proof_multiplicity(subset, queries, cap=config.proof_cap)
        max_mult = max(mult.values(), default=0)
        # Grounding size of the whole batch (safe — grounding never invokes the
        # external compiler), a compact portable complexity signal.
        try:
            gnodes = ground_size(render_problog_program(subset, weight, queries))
        except Exception:  # noqa: BLE001 - grounding itself can hit an engine limit
            gnodes = -1
        # Per-query compilation (faithful to DeepProbLog's per-example inference).
        compiled = 0
        total_seconds = 0.0
        first_error: str | None = None
        for q in queries:
            result = evaluate_program(
                render_problog_program(subset, weight, [q]),
                timeout=config.eval_timeout,
            )
            total_seconds += result.seconds
            if result.ok:
                compiled += 1
            elif first_error is None:
                first_error = result.error
        avg = total_seconds / len(queries) if queries else 0.0
        points.append(
            ScalePoint(
                num_edges=n,
                num_queries=len(queries),
                ground_nodes=gnodes,
                max_proof_multiplicity=max_mult,
                proof_cap_hit=max_mult >= config.proof_cap,
                queries_compiled=compiled,
                avg_query_seconds=round(avg, 5),
                error=first_error,
            )
        )
    return points


def tractable_subgraph(
    base_pairs: Sequence[Pair], *, max_edges: int
) -> list[Pair]:
    """A small connected descent subgraph the exact engine always compiles.

    BFS from the source with the deepest reach, bounded to ``max_edges``, so the
    "the task runs in DeepProbLog" demonstration (:func:`evaluate_program` over this
    subgraph) succeeds regardless of host — the reduced subset the acceptance allows.
    """
    adj = _adjacency(base_pairs)
    if not adj:
        return []
    # Pick the source reaching the most nodes (a real multi-hop lineage).
    def reach(src: str) -> int:
        seen = {src}
        frontier = [src]
        while frontier:
            u = frontier.pop()
            for v in adj.get(u, []):
                if v not in seen:
                    seen.add(v)
                    frontier.append(v)
        return len(seen)

    root = max(sorted(adj), key=reach)
    edges: list[Pair] = []
    seen_nodes = {root}
    frontier = [root]
    while frontier and len(edges) < max_edges:
        u = frontier.pop(0)
        for v in adj.get(u, []):
            if len(edges) >= max_edges:
                break
            edges.append((u, v))
            if v not in seen_nodes:
                seen_nodes.add(v)
                frontier.append(v)
    return edges


# --- report probe table (marker-wrapped, upserted into the report doc) --------

# Marker for the machine-regenerated scale-probe table inside the hand-authored
# report — same cooperating-upsert discipline as US-003's SCALLOP-PILOT block, so a
# re-run refreshes only the table and leaves the prose analysis intact.
DOC_MARK_START = (
    "<!-- DEEPPROBLOG-PROBE:START (generated by pinakes-deepproblog) -->"
)
DOC_MARK_END = "<!-- DEEPPROBLOG-PROBE:END -->"


def render_probe_table(points: Sequence[ScalePoint], *, has_cycle: bool) -> str:
    """Render the marker-wrapped scale-probe results table for the report.

    Pure function of the measured points (no wall-clock beyond the recorded seconds),
    so the CLI upserts it idempotently. Records, per corpus subset size, the grounding
    size (compact), the max proof multiplicity (the exploding driver), and whether the
    exact compiler succeeded.
    """
    lines = [
        DOC_MARK_START,
        "",
        "### Measured scale probe (regenerated by `pinakes-deepproblog`)",
        "",
        f"Directed `DESCENDS_FROM` graph contains a cycle: "
        f"**{'yes' if has_cycle else 'no'}** (a cyclic probabilistic `ancestor` "
        "relation is the pathological case for exact knowledge compilation). Each "
        "query is compiled on its own — DeepProbLog's per-example inference.",
        "",
        "| Base edges | Multi-hop queries | Ground nodes | Max proofs / query | "
        "Per-query exact compile |",
        "| --- | --- | --- | --- | --- |",
    ]
    for p in points:
        proofs = (
            f"≥{p.max_proof_multiplicity}"
            if p.proof_cap_hit
            else str(p.max_proof_multiplicity)
        )
        compiled = f"{p.queries_compiled}/{p.num_queries} ✓ ~{p.avg_query_seconds:.3f}s"
        if p.queries_compiled < p.num_queries:
            compiled += f" (ceiling: {p.error})"
        lines.append(
            f"| {p.num_edges} | {p.num_queries} | {p.ground_nodes} | {proofs} | "
            f"{compiled} |"
        )
    lines += [
        "",
        "At current corpus scale the descent graph is a **sparse forest** (few proofs "
        "per query), so *per-query* exact inference is tractable — the binding "
        "constraint is throughput (queries × epochs × per-query compile), not a single "
        "query's cost. Grounding stays compact while the proof count — and thus d-DNNF "
        "/ SDD size — is what would explode on a denser graph (see the ladder in "
        "§Expressiveness). Contrast: US-003's Scallop `minmaxprob` pass closed the "
        "full-corpus `ancestor` relation (3,196 derived pairs) differentiably in one "
        "batched shot.",
        "",
        DOC_MARK_END,
    ]
    return "\n".join(lines) + "\n"


def extract_marked_section(doc_text: str) -> str | None:
    """The probe-table block (incl. markers) in *doc_text*, or ``None``."""
    start = doc_text.find(DOC_MARK_START)
    end = doc_text.find(DOC_MARK_END)
    if start == -1 or end == -1 or end < start:
        return None
    return doc_text[start : end + len(DOC_MARK_END)]


def upsert_marked_section(doc_text: str, section: str) -> str:
    """Insert or replace the probe-table block (idempotent; appends if absent)."""
    if not section:
        return doc_text
    existing = extract_marked_section(doc_text)
    body = section if section.endswith("\n") else section + "\n"
    if existing is not None:
        replaced = doc_text.replace(existing, body.rstrip("\n"), 1)
        return replaced if replaced.endswith("\n") else replaced + "\n"
    prefix = doc_text if doc_text.endswith("\n") else doc_text + "\n"
    return f"{prefix}\n{body}"


# --- DeepProbLog dependency gate (undeclared, like scallopy) -----------------

_DEEPPROBLOG_INSTALL_HINT = (
    "DeepProbLog is not installed. It is intentionally NOT a declared `ml/` "
    "dependency (it pulls a specific torch/problog matrix that conflicts with the "
    "pinned stack, and the neural-AD training loop is a Phase-5 feasibility probe, "
    "not part of the core loop) — install it into the venv to run the gated neural "
    "loop: `uv pip install deepproblog`. The declared `problog` engine already runs "
    "the ProbLog program this loop would compile (see evaluate_program / scale_probe)."
)


def require_deepproblog_deps() -> None:
    """Raise an actionable error if the undeclared ``deepproblog`` package is absent.

    Mirrors ``export_scallop.require_scallop_deps`` /
    ``finetune.require_finetune_deps``: the gate runs in CI (deps absent → asserts the
    message) and is a no-op locally when
    the package is installed. The full neural-AD training run that follows it is
    ``# pragma: no cover`` — local-only, and (per the measured ceiling) not tractable at
    full corpus scale anyway.
    """
    import importlib.util

    if importlib.util.find_spec("deepproblog") is None:
        raise ModuleNotFoundError(_DEEPPROBLOG_INSTALL_HINT)


def run_deepproblog_training(  # pragma: no cover - local-only, undeclared deps
    program_text: str,
    edge_scorer: Callable[[Sequence[Pair]], Sequence[float]],
    queries: Sequence[tuple[Pair, int]],
) -> object:
    """Train the DeepProbLog neural-AD model (local-only; gated).

    The engine counterpart of US-003's differentiable Scallop loop: ``edge_scorer``
    (the PyKEEN-fed neural predicate) supplies ``edge/2`` probabilities through a
    DeepProbLog ``Network``, the ``ancestor`` closure propagates them, and the model
    trains on the labelled ``queries``. Gated by :func:`require_deepproblog_deps`; not
    exercised in CI, and — per :func:`scale_probe` — not tractable at full corpus scale
    on this host (the exact compiler ceils out), which is the finding, not a bug.
    """
    require_deepproblog_deps()
    raise NotImplementedError(
        "The DeepProbLog neural-AD training loop is documented in "
        "docs/neurosymbolic-pilot-report.md; it is not run in this pilot because the "
        "exact-inference ceiling (scale_probe) makes a full-corpus run intractable. "
        "Reduce to a tractable_subgraph to exercise it end-to-end."
    )


__all__ = [
    "ANCESTOR_PREDICATE",
    "DOC_MARK_END",
    "DOC_MARK_START",
    "EDGE_PREDICATE",
    "FeasResult",
    "FeasibilityConfig",
    "Pair",
    "ScalePoint",
    "count_paths",
    "evaluate_program",
    "extract_marked_section",
    "ground_size",
    "has_cycle",
    "minmax_chain_width",
    "problog_chain_marginal",
    "problog_two_path_marginal",
    "proof_multiplicity",
    "reachable_multihop_pairs",
    "render_deepproblog_program",
    "render_probe_table",
    "render_problog_program",
    "require_deepproblog_deps",
    "run_deepproblog_training",
    "sanitize_atom",
    "scale_probe",
    "tractable_subgraph",
    "upsert_marked_section",
]
