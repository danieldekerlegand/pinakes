"""Tests for the Scallop context export + Horn-rule translation (Phase-5 US-001).

Two tiers, mirroring the reproducible-artifact pattern (see ``ml/CLAUDE.md``):

* **Fixture unit tests** — drive the pure core with tiny temp-dir fixtures; these
  run in the ``ml/**``-scoped CI (no corpus, no scallopy).
* **Committed-artifact + live gates** — the committed ``program.scl`` /
  translated-rule set are checked against a fresh translation of the *real*
  registry (corpus-independent → runs in CI); the full manifest is checked against
  a fresh build of the live corpus (``skipif`` the export is absent → skips in CI).

``scallopy`` itself is never imported here (its only wheel is macOS/arm64); the
smoke run's *logic* is validated by :func:`reference_derivations`, which the real
scallopy run asserts equality against locally.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.export_scallop import (
    DEFAULT_MANIFEST,
    DEFAULT_PROGRAM,
    DEFAULT_REGISTRY,
    build,
    require_scallop_deps,
    write_context,
)
from pinakes_ml.scallop import (
    SMOKE_TARGETS,
    UntranslatableClause,
    build_manifest,
    build_scl,
    intern_symbols,
    load_registry,
    load_relations,
    reference_derivations,
    relation_name,
    split_clauses,
    transitive_closure,
    translate_clause,
    translate_registry,
    translate_rule,
)

_EDGE_HEADER = ":START_ID\t:END_ID\t:TYPE\tweight:float"


def _write_edge_file(
    edges_dir: Path, name: str, rel: str, pairs: list[tuple[str, str]]
) -> None:
    lines = [_EDGE_HEADER]
    lines += [f"{h}\t{t}\t{rel}\t1.0" for h, t in pairs]
    (edges_dir / f"{name}.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.fixture
def edges_dir(tmp_path: Path) -> Path:
    d = tmp_path / "edges"
    d.mkdir()
    _write_edge_file(
        d, "descended-from", "DESCENDS_FROM",
        [("cs:lang:spa", "cs:lang:lat"), ("cs:lang:lat", "cs:lang:itc")],
    )
    _write_edge_file(
        d, "derived-from", "DERIVED_FROM", [("cs:art:b", "cs:art:a")],
    )
    _write_edge_file(
        d, "influenced-by", "INFLUENCED_BY", [("cs:art:a", "cs:art:z")],
    )
    return d


# --- Corpus loading + interning ---------------------------------------------


def test_relation_name_lowercases_type() -> None:
    assert relation_name("DESCENDS_FROM") == "descends_from"
    assert relation_name("INFLUENCED_BY") == "influenced_by"


def test_load_relations_groups_and_sorts(edges_dir: Path) -> None:
    relations = load_relations(edges_dir)
    assert set(relations) == {"descends_from", "derived_from", "influenced_by"}
    assert relations["descends_from"] == [
        ("cs:lang:lat", "cs:lang:itc"),
        ("cs:lang:spa", "cs:lang:lat"),
    ]


def test_intern_symbols_is_deterministic_and_sorted(edges_dir: Path) -> None:
    relations = load_relations(edges_dir)
    symbols = intern_symbols(relations)
    # Every csid interned exactly once; ids are the sorted-vocab index.
    assert symbols["cs:art:a"] == 0
    ordered = sorted(symbols, key=lambda s: symbols[s])
    assert ordered == sorted(symbols)
    assert set(symbols.values()) == set(range(len(symbols)))


# --- Clause translation ------------------------------------------------------


def test_translate_recursive_closure_clause() -> None:
    scallop, preds = translate_clause(
        "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y)"
    )
    assert scallop == "ancestor(x, y) = descends_from(x, z) and ancestor(z, y)"
    assert set(preds) == {"ancestor", "descends_from"}


def test_translate_comparison_guard() -> None:
    scallop, _ = translate_clause(
        "precedes(X, Y) :- time_end(X, Ex), time_start(Y, Sy), Ex < Sy"
    )
    expected = "precedes(x, y) = time_end(x, ex) and time_start(y, sy) and ex < sy"
    assert scallop == expected


def test_translate_negation_and_string_constant() -> None:
    scallop, preds = translate_clause(
        'from_ok_x(X, Y) :- edge(X, Y), instance_of(X, "Culture")'
    )
    assert scallop == 'from_ok_x(x, y) = edge(x, y) and instance_of(x, "Culture")'
    scallop2, _ = translate_clause("v(X, Y) :- edge(X, Y), !from_ok_x(X, Y)")
    assert scallop2 == "v(x, y) = edge(x, y) and not from_ok_x(x, y)"


def test_non_binary_predicate_is_untranslatable() -> None:
    with pytest.raises(UntranslatableClause, match="non-binary predicate node/3"):
        translate_clause(
            "csid_uniqueness_violation(C, N) :- "
            "node(C, T1, N), node(C, T2, M), N != M"
        )


def test_split_clauses_handles_multi_clause_cell() -> None:
    cell = (
        "ancestor(X, Y) :- descends_from(X, Y). "
        "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y)."
    )
    clauses = split_clauses(cell)
    assert len(clauses) == 2
    assert clauses[0] == "ancestor(X, Y) :- descends_from(X, Y)"


# --- Registry translation ----------------------------------------------------


def _write_registry(path: Path, rows: list[dict[str, str]]) -> None:
    header = [
        "rule_id", "layer", "head", "clause_prolog", "clause_souffle",
        "depends", "source", "source_url", "retrieved_at", "confidence",
        "version", "status",
    ]
    lines = ["\t".join(header)]
    for row in rows:
        lines.append("\t".join(row.get(col, "") for col in header))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_translate_registry_skips_and_reports(tmp_path: Path) -> None:
    registry = tmp_path / "rules_registry.tsv"
    _write_registry(
        registry,
        [
            {
                "rule_id": "curated-ancestor", "layer": "curated", "head": "ancestor",
                "clause_souffle": "ancestor(X, Y) :- descends_from(X, Y). "
                "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y).",
                "depends": "descends_from", "status": "active",
            },
            {
                "rule_id": "schema-csid-uniqueness", "layer": "canonical-schema",
                "head": "csid_uniqueness_violation",
                "clause_souffle": "csid_uniqueness_violation(C, N) :- "
                "node(C, T1, N), node(C, T2, M), N != M.",
                "depends": "node", "status": "active",
            },
            {
                "rule_id": "retired-thing", "layer": "curated", "head": "thing",
                "clause_souffle": "thing(X, Y) :- descends_from(X, Y).",
                "depends": "descends_from", "status": "retired",
            },
        ],
    )
    result = translate_registry(load_registry(registry))
    # active + translatable
    assert [t.rule_id for t in result.translated] == ["curated-ancestor"]
    # active + untranslatable → reported
    assert len(result.skipped) == 1
    assert result.skipped[0].rule_id == "schema-csid-uniqueness"
    assert "node/3" in result.skipped[0].reason
    # retired → silently dropped (not translated, not skipped)


def test_translate_rule_collects_predicates() -> None:
    rule = load_registry_from_str(
        "curated-influenced_transitively", "influenced_transitively",
        "influenced_transitively(X, Y) :- derived_from(X, Y). "
        "influenced_transitively(X, Y) :- influenced_by(X, Y).",
    )
    translated = translate_rule(rule)
    assert set(translated.predicates) == {
        "influenced_transitively", "derived_from", "influenced_by",
    }
    assert len(translated.rules) == 2


def load_registry_from_str(rule_id: str, head: str, clause: str):
    from pinakes_ml.scallop import RegistryRule

    return RegistryRule(
        rule_id=rule_id, layer="curated", head=head, clause=clause,
        depends=(), status="active",
    )


# --- Program emission --------------------------------------------------------


def test_build_scl_declares_base_predicates_and_rules() -> None:
    rule = load_registry_from_str(
        "curated-ancestor", "ancestor",
        "ancestor(X, Y) :- descends_from(X, Y). "
        "ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y).",
    )
    scl = build_scl([translate_rule(rule)])
    # descends_from is a base (never a head) → declared; ancestor is a head → not.
    assert "type descends_from(String, String)" in scl
    assert "type ancestor(" not in scl
    assert "rel ancestor(x, y) = descends_from(x, y)" in scl
    assert scl.endswith("\n")


def test_build_scl_types_temporal_second_arg_as_int() -> None:
    rule = load_registry_from_str(
        "curated-precedes", "precedes",
        "precedes(X, Y) :- time_end(X, Ex), time_start(Y, Sy), Ex < Sy.",
    )
    scl = build_scl([translate_rule(rule)])
    assert "type time_end(String, i32)" in scl
    assert "type time_start(String, i32)" in scl


# --- Reference derivation (the scallopy spot-check oracle) --------------------


def test_transitive_closure_basic_and_cycle() -> None:
    assert transitive_closure({("a", "b"), ("b", "c")}) == {
        ("a", "b"), ("b", "c"), ("a", "c"),
    }
    # A cycle must not loop forever; the closure just saturates.
    closed = transitive_closure({("a", "b"), ("b", "a")})
    assert ("a", "a") in closed and ("b", "b") in closed


def test_reference_derivations_over_fixture(edges_dir: Path) -> None:
    relations = load_relations(edges_dir)
    refs = reference_derivations(relations)
    # ancestor = transitive closure of descends_from (spa→lat→itc).
    assert refs["ancestor"] == {
        ("cs:lang:spa", "cs:lang:lat"),
        ("cs:lang:lat", "cs:lang:itc"),
        ("cs:lang:spa", "cs:lang:itc"),
    }
    # influenced_transitively closes derived_from ∪ influenced_by (b→a→z).
    assert refs["influenced_transitively"] == {
        ("cs:art:b", "cs:art:a"),
        ("cs:art:a", "cs:art:z"),
        ("cs:art:b", "cs:art:z"),
    }


def test_build_manifest_is_deterministic(edges_dir: Path) -> None:
    relations = load_relations(edges_dir)
    symbols = intern_symbols(relations)
    translation = translate_registry(
        [load_registry_from_str(
            "curated-ancestor", "ancestor",
            "ancestor(X, Y) :- descends_from(X, Y).",
        )]
    )
    scl = build_scl(translation.translated)
    m1 = build_manifest(relations, symbols, translation, scl)
    m2 = build_manifest(relations, symbols, translation, scl)
    assert m1 == m2
    assert m1["counts"]["facts"] == 4
    assert set(m1["smoke"]) == set(SMOKE_TARGETS)


# --- Dep gate (runs in CI, where scallopy is absent) -------------------------


def test_require_scallop_deps_raises_when_absent() -> None:
    import importlib.util

    if importlib.util.find_spec("scallopy") is not None:  # pragma: no cover
        pytest.skip("scallopy is installed (compatible interpreter)")
    with pytest.raises(ImportError, match="scallopy"):
        require_scallop_deps()


# --- Committed-artifact gate (registry-derived → runs in CI) -----------------


@pytest.mark.skipif(
    not DEFAULT_REGISTRY.exists(),
    reason="rules registry not present (partial checkout)",
)
def test_committed_program_matches_real_registry() -> None:
    """``ml/scallop/program.scl`` must equal a fresh translation of the registry.

    Corpus-independent: the program is a pure function of the committed registry,
    so this is a real CI gate (a hand-edited program or a registry drift fails).
    """
    translation = translate_registry(load_registry(DEFAULT_REGISTRY))
    fresh = build_scl(translation.translated)
    committed = DEFAULT_PROGRAM.read_text(encoding="utf-8")
    assert fresh == committed
    # Exactly one rule is untranslatable today — the arity-3 csid-uniqueness check.
    assert [s.rule_id for s in translation.skipped] == ["schema-csid-uniqueness"]


@pytest.mark.skipif(
    not DEFAULT_REGISTRY.exists(),
    reason="rules registry not present (partial checkout)",
)
def test_committed_manifest_rule_translation_matches_registry() -> None:
    """The manifest's registry-derived fields must match a fresh translation.

    (The corpus-derived counts are checked by the live gate below.)
    """
    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    translation = translate_registry(load_registry(DEFAULT_REGISTRY))
    assert committed["translatedRuleIds"] == [t.rule_id for t in translation.translated]
    assert committed["skippedRules"] == [
        {"ruleId": s.rule_id, "reason": s.reason} for s in translation.skipped
    ]


# --- Live reproducibility gate (skipped when the export is absent) --------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIVE_EDGES = _REPO_ROOT / "build" / "corpus" / "edges"


@pytest.mark.skipif(
    not (_LIVE_EDGES.exists() and DEFAULT_REGISTRY.exists()),
    reason="canonical export not present (git-ignored; build it locally)",
)
def test_committed_manifest_matches_live_corpus() -> None:
    """The committed manifest must equal a fresh build of the live corpus + registry."""
    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    _relations, _symbols, _translated, _program, manifest = build(
        _LIVE_EDGES, DEFAULT_REGISTRY
    )
    assert manifest == committed


def test_write_context_emits_interned_csvs(tmp_path: Path, edges_dir: Path) -> None:
    relations = load_relations(edges_dir)
    symbols = intern_symbols(relations)
    write_context(tmp_path, relations, symbols)
    csv = (tmp_path / "relations" / "descends_from.csv").read_text(encoding="utf-8")
    assert csv.splitlines()[0] == "head_id,tail_id"
    # every id in the CSV is a valid interned integer
    for line in csv.splitlines()[1:]:
        a, b = line.split(",")
        assert int(a) in symbols.values() and int(b) in symbols.values()
    symbols_tsv = (tmp_path / "symbols.tsv").read_text(encoding="utf-8")
    assert symbols_tsv.splitlines()[0].startswith("0\t")
