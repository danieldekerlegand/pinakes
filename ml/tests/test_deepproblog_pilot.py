"""Unit + feasibility tests for the DeepProbLog pilot (Phase 5, US-004).

``problog`` is a **declared** ``ml/`` dependency, so — unlike the macOS-only
``scallopy`` backend in US-003 — the exact ProbLog inference the DeepProbLog model
would compile runs for real in the ``ml/**`` CI. These tests drive:

* the pure program renderers + proof-multiplicity + cycle detection (deterministic);
* real ProbLog exact evaluation on tiny tractable programs (the semantics-divergence
  numbers the report turns on: noisy-or vs widest-path);
* the scale probe on a fixture (grounding vs proof-count divergence);
* the ``deepproblog`` dependency gate (undeclared package → asserts its message).
"""

from __future__ import annotations

import importlib.util

import pytest

from linguascrape_ml.deepproblog_pilot import (
    DOC_MARK_START,
    FeasibilityConfig,
    ScalePoint,
    count_paths,
    evaluate_program,
    extract_marked_section,
    ground_size,
    has_cycle,
    minmax_chain_width,
    problog_two_path_marginal,
    proof_multiplicity,
    reachable_multihop_pairs,
    render_deepproblog_program,
    render_probe_table,
    render_problog_program,
    require_deepproblog_deps,
    sanitize_atom,
    scale_probe,
    tractable_subgraph,
    upsert_marked_section,
)

# A tiny descent line + a branch, in csid space.
_CHAIN = [
    ("cs:language:a", "cs:language:b"),
    ("cs:language:b", "cs:language:c"),
    ("cs:language:c", "cs:language:d"),
]


# --- program rendering -------------------------------------------------------


def test_sanitize_atom_is_problog_safe_and_injective() -> None:
    a = sanitize_atom("cs:language:Q123")
    b = sanitize_atom("cs:culture:Q123")
    assert a == "n_cs_language_q123" and a != b
    assert a[0].isalpha() and all(c.isalnum() or c == "_" for c in a)


def test_render_problog_program_annotates_and_closes() -> None:
    prog = render_problog_program(_CHAIN, 0.6, [("cs:language:a", "cs:language:d")])
    assert "0.600000::edge(n_cs_language_a,n_cs_language_b)." in prog
    assert "ancestor(X,Y) :- edge(X,Y)." in prog
    assert "ancestor(X,Y) :- edge(X,Z), ancestor(Z,Y)." in prog
    assert "query(ancestor(n_cs_language_a,n_cs_language_d))." in prog


def test_render_problog_certain_fact_is_unannotated() -> None:
    prog = render_problog_program([("x", "y")], 1.0, [])
    assert "edge(n_x,n_y)." in prog
    assert "::edge(n_x,n_y)" not in prog  # a certain fact carries no annotation


def test_render_problog_per_edge_probability_map() -> None:
    probs = {("x", "y"): 0.3, ("y", "z"): 0.9}
    prog = render_problog_program([("x", "y"), ("y", "z")], probs, [])
    assert "0.300000::edge(n_x,n_y)." in prog
    assert "0.900000::edge(n_y,n_z)." in prog


def test_render_deepproblog_program_uses_neural_ad() -> None:
    prog = render_deepproblog_program()
    assert "nn(edge_net, [H, T]) :: edge(H, T)." in prog
    assert "ancestor(X, Y) :- edge(X, Y)." in prog
    assert "ancestor(X, Y) :- edge(X, Z), ancestor(Z, Y)." in prog


# --- proof multiplicity + cycle detection (the hardness driver) --------------


def test_count_paths_single_chain() -> None:
    adj = {"a": ["b"], "b": ["c"], "c": ["d"]}
    assert count_paths(adj, "a", "d", cap=100) == 1


def test_count_paths_exponential_ladder() -> None:
    # Layers of width 2: #paths(x0_0 -> x_{L-1}_0) doubles per extra layer.
    def ladder(layers: int, width: int) -> dict[str, list[str]]:
        adj: dict[str, list[str]] = {}
        for i in range(layers - 1):
            for a in range(width):
                adj[f"x{i}_{a}"] = [f"x{i+1}_{b}" for b in range(width)]
        return adj

    adj = ladder(6, 2)
    # source reaches the sink via 2**(layers-2) width-1 choices = 2**4 = 16 paths.
    assert count_paths(adj, "x0_0", "x5_0", cap=1000) == 2 ** 4


def test_count_paths_caps() -> None:
    adj = {"s": [f"m{i}" for i in range(20)]}
    for i in range(20):
        adj[f"m{i}"] = ["t"]
    assert count_paths(adj, "s", "t", cap=5) == 5  # 20 paths, capped at 5


def test_proof_multiplicity_and_has_cycle() -> None:
    mult = proof_multiplicity(_CHAIN, [("cs:language:a", "cs:language:d")], cap=100)
    assert mult[("cs:language:a", "cs:language:d")] == 1
    assert not has_cycle(_CHAIN)
    assert has_cycle(_CHAIN + [("cs:language:d", "cs:language:a")])


def test_reachable_multihop_pairs_are_at_least_two_hops() -> None:
    pairs = reachable_multihop_pairs(_CHAIN, limit=10)
    # a->c, a->d, b->d are the >=2-hop pairs; a->b/b->c/c->d are 1-hop (excluded).
    assert ("cs:language:a", "cs:language:c") in pairs
    assert ("cs:language:a", "cs:language:d") in pairs
    assert ("cs:language:a", "cs:language:b") not in pairs


# --- real ProbLog exact inference (declared dep — runs in CI) ----------------


def test_ground_size_is_deterministic() -> None:
    prog = render_problog_program(_CHAIN, 0.6, [("cs:language:a", "cs:language:d")])
    assert ground_size(prog) == ground_size(prog)
    assert ground_size(prog) > 0


def test_evaluate_program_exact_chain_marginal() -> None:
    # a->b->c->d all 0.5 => exact P(anc(a,d)) = 0.5**3 = 0.125 (single proof).
    prog = render_problog_program(_CHAIN, 0.5, [("cs:language:a", "cs:language:d")])
    result = evaluate_program(prog, timeout=10.0)
    assert result.ok, result.error
    (value,) = result.marginals.values()
    assert value == pytest.approx(0.125, abs=1e-9)


def test_problog_matches_two_path_noisy_or() -> None:
    # Two disjoint proofs a->b->d (0.9,0.8) and a->c->d (0.5,0.5).
    base = [("a", "b"), ("b", "d"), ("a", "c"), ("c", "d")]
    probs = {("a", "b"): 0.9, ("b", "d"): 0.8, ("a", "c"): 0.5, ("c", "d"): 0.5}
    prog = render_problog_program(base, probs, [("a", "d")])
    result = evaluate_program(prog, timeout=10.0)
    assert result.ok, result.error
    (value,) = result.marginals.values()
    expected = problog_two_path_marginal([0.9, 0.8], [0.5, 0.5])  # noisy-or = 0.79
    assert value == pytest.approx(expected, abs=1e-9)
    # ... and it differs from Scallop's widest-path max of the two bottlenecks (0.8).
    scallop = max(minmax_chain_width([0.9, 0.8]), minmax_chain_width([0.5, 0.5]))
    assert scallop == pytest.approx(0.8)
    assert abs(value - scallop) > 0.005  # the two engines disagree — the report's crux


# --- scale probe -------------------------------------------------------------


def test_scale_probe_records_grounding_and_proofs() -> None:
    config = FeasibilityConfig.from_dict(
        {"scale_sizes": [2, 3], "queries_per_size": 5, "eval_timeout": 10.0}
    )
    points = scale_probe(_CHAIN, config)
    assert [p.num_edges for p in points] == [2, 3]
    for p in points:
        assert isinstance(p, ScalePoint)
        assert p.ground_nodes >= 0
        assert p.max_proof_multiplicity >= 0


def test_tractable_subgraph_is_bounded_and_connected() -> None:
    edges = tractable_subgraph(_CHAIN, max_edges=2)
    assert len(edges) <= 2
    assert edges[0][0] == "cs:language:a"  # rooted at the deepest-reaching source


# --- report probe table ------------------------------------------------------


def test_render_probe_table_and_upsert_idempotent() -> None:
    points = [
        ScalePoint(50, 20, 105, 4, False, 20, 0.03, None),
        ScalePoint(800, 20, 105, 10000, True, 18, 2.1, "DSharpError"),
    ]
    table = render_probe_table(points, has_cycle=True)
    assert DOC_MARK_START in table
    assert "≥10000" in table  # cap-hit rendered as a lower bound
    assert "20/20" in table and "18/20" in table
    assert "ceiling: DSharpError" in table
    assert "cycle" in table.lower()

    doc = "# Report\n\nprose\n"
    once = upsert_marked_section(doc, table)
    twice = upsert_marked_section(once, table)
    assert once == twice
    assert extract_marked_section(once) is not None
    assert once.count(DOC_MARK_START) == 1


# --- config round-trip -------------------------------------------------------


def test_config_round_trip_and_rejects_unknown() -> None:
    config = FeasibilityConfig(scale_sizes=(10, 20), proof_cap=500)
    restored = FeasibilityConfig.from_dict(config.to_dict())
    assert restored == config
    with pytest.raises(ValueError, match="unknown config keys"):
        FeasibilityConfig.from_dict({**config.to_dict(), "bogus": 1})


def test_config_resolves_paths() -> None:
    resolved = FeasibilityConfig().resolved("/ml")
    assert resolved.triples_dir == "/ml/data/triples"


# --- dependency gate ---------------------------------------------------------


@pytest.mark.skipif(
    importlib.util.find_spec("deepproblog") is not None,
    reason="deepproblog installed locally — the gate is a no-op",
)
def test_require_deepproblog_deps_raises_actionable_message() -> None:
    with pytest.raises(ModuleNotFoundError, match="deepproblog"):
        require_deepproblog_deps()
