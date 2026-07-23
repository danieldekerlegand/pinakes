"""Unit + snapshot tests for the rule-adherence eval tier (insimul-bridge US-004).

Unit tests exercise the parser, the validator stack and the reachability formulas
on tiny hand-built inputs. The snapshot test is the CI ratchet: the committed
baseline equals a fresh eval of the committed fixture world + rule set — and the
fixture's known-dead conditions (`married/2`, `trusts/3`, `esteems/3`, the
residual set Insimul's VESPACE validation 2 reports) score as expected.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from pinakes_ml.eval_rule_adherence import (
    DEFAULT_BASELINE,
    DEFAULT_RULES,
    DEFAULT_WORLD,
    main,
)
from pinakes_ml.rule_adherence import (
    DEFAULT_ACTION_LAMBDA,
    DEFAULT_INTRINSIC_LAMBDA,
    DOC_MARK_END,
    DOC_MARK_START,
    ParseError,
    RuleCandidate,
    build_report,
    build_world_context,
    classify_key,
    effect_term_keys,
    evaluate_rule,
    extract_marked_section,
    goal_predicate_key,
    load_rules,
    load_world_context,
    parse_goal,
    parse_prolog_source,
    render_adherence_section,
    sanitize_atom,
    split_conjunction,
    strip_comments,
    upsert_marked_section,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
#: The bridge-2 (US-003) fixture world — a real CanonicalWorldExport.
BRIDGE_WORLD = (
    _REPO_ROOT / "core" / "tests" / "fixtures" / "insimul" / "world-export.json"
)


@pytest.fixture(scope="module")
def context():
    return load_world_context(DEFAULT_WORLD)


def _row(content: str, ctx, name: str = "r"):
    return evaluate_rule(RuleCandidate(name, content), ctx)


# --- parser -------------------------------------------------------------------


def test_strip_comments_keeps_quoted_percent() -> None:
    assert strip_comments("a(X). % trailing\nb('100%').").strip() == (
        "a(X). \nb('100%')."
    )


def test_split_conjunction_respects_nesting() -> None:
    body = "p(X), q(f(A, B)), R > 5"
    assert split_conjunction(body) == ["p(X)", "q(f(A, B))", "R > 5"]


def test_parse_goal_classifies_calls_atoms_and_comparisons() -> None:
    assert parse_goal("affinity(X, Y, V)").arity == 3
    assert parse_goal("V >= 5").is_comparison is True
    assert parse_goal("current_year").name == "current_year"


def test_negated_goal_is_still_scored() -> None:
    """The upstream parser drops the closing paren here — this port does not."""
    for token in (r"\+ embarrassed(Y)", r"\+(embarrassed(Y))"):
        goal = parse_goal(token)
        assert goal.negated is True
        assert (goal.name, goal.arity) == ("embarrassed", 1)


def test_parse_errors_are_the_parse_rate_failures() -> None:
    for bad in ("rule_applies(r, X, Y :- female(X).", "p(X)", "p('unclosed).", ""):
        with pytest.raises(ParseError):
            parse_prolog_source(bad)


def test_goal_predicate_key_special_cases_the_attribute_family() -> None:
    assert goal_predicate_key(parse_goal("attribute(X, charisma, V)")) == (
        "attribute:charisma"
    )
    assert goal_predicate_key(parse_goal("attribute(X, Type, V)")) == "attribute/3"
    assert goal_predicate_key(parse_goal("V > 5")) is None


def test_sanitize_atom_folds_accents() -> None:
    assert sanitize_atom("Marie Angélique Bernard") == "marie_angelique_bernard"


# --- world context ------------------------------------------------------------


def test_effect_term_keys_covers_the_effect_vocabulary() -> None:
    cases = {
        "modify_network(X, Y, affinity, '+', 5)": ["affinity/3"],
        "modify_attribute(Y, charisma, '+', 1)": ["attribute:charisma"],
        "add_status(Y, flattered)": ["flattered/1"],
        "remove_trait(Y, shy)": ["shy/1"],
        "add_directed_status(X, Y, resents)": ["resents/2"],
        "add_relationship(X, Y, ally)": ["ally/2"],
        "record_event(X, Y, duel)": ["duel/2"],
        "record_social_event(X, Y, embarrassing_event)": [
            "social_record:embarrassing_event"
        ],
        "set_intent(X, flatter, Y, 5)": ["intent/4"],
        "not_an_effect(X)": [],
    }
    for term, expected in cases.items():
        assert effect_term_keys(term) == expected


def test_world_context_splits_intrinsic_from_producible(context) -> None:
    # KB facts are the character-creation layer.
    assert "female/1" in context.intrinsic_keys
    assert "attribute:sophistication" in context.intrinsic_keys
    # Action effects are the producibility index.
    assert {"affinity/3", "ally/2", "flattered/1"} <= context.producible_keys
    # The residual VESPACE dead-key set is in neither.
    for key in ("married/2", "trusts/3", "esteems/3"):
        assert classify_key(key, context) == "dead"
    assert context.action_count == 5
    assert "celeste_dubois" in context.entity_atoms
    assert "salonniere" in context.value_atoms


def test_intrinsic_wins_over_producible(context) -> None:
    """`attribute:charisma` is both KB-set and tutor-producible — intrinsic wins."""
    assert "attribute:charisma" in context.intrinsic_keys
    assert "attribute:charisma" in context.producible_keys
    assert classify_key("attribute:charisma", context) == "intrinsic"


def test_load_rules_accepts_a_world_export() -> None:
    """A converted world can be scored against its own vocabulary."""
    names = {c.name for c in load_rules(BRIDGE_WORLD)}
    assert {"flood_displaces_resident", "child_inherits_surname"} <= names


def test_load_rules_accepts_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "gen.jsonl"
    path.write_text(
        '{"name": "a", "content": "rule_applies(a, X, Y) :- female(X)."}\n'
        '{"name": "b", "prolog": "rule_applies(b, X, Y) :- male(X)."}\n',
        encoding="utf-8",
    )
    assert [c.name for c in load_rules(path)] == ["a", "b"]


# --- reachability formulas ----------------------------------------------------


def test_fully_reachable_rule_scores_one(context) -> None:
    row = _row(
        "rule_applies(r, X, Y) :- female(Y), flattered(Y), affinity(X, Y, V),"
        " V > 5, ally(X, Y).",
        context,
    )
    # The comparison goal is excluded, so 4 conditions — not 5.
    assert (row.total_conditions, row.intrinsic_conditions) == (4, 1)
    assert row.reachability_charitable == 1.0
    assert row.reachability_strict == 1.0
    assert row.fireability_index == pytest.approx(
        math.exp(-1 * DEFAULT_INTRINSIC_LAMBDA - 3 * DEFAULT_ACTION_LAMBDA)
    )


def test_dead_conditions_sink_strict_reachability(context) -> None:
    row = _row(
        "rule_applies(r, X, Y) :- noble(X), married(X, Y), esteems(X, Y, V), V > 3.",
        context,
    )
    assert row.dead_condition_keys == ("esteems/3", "married/2")
    assert row.reachability_charitable == pytest.approx(1 / 3)
    assert row.reachability_strict == 0.0  # fully dead action slice
    assert row.schema_valid is False  # a dead key is also an undeclared one


def test_a_rule_with_no_action_conditions_is_trivially_strict(context) -> None:
    row = _row("rule_applies(r, X, Y) :- noble(X), virtuous(Y).", context)
    assert (row.action_conditions, row.reachability_strict) == (0, 1.0)


def test_lambdas_are_tunable(context) -> None:
    content = "rule_applies(r, X, Y) :- noble(X), flattered(Y)."
    flat = evaluate_rule(
        RuleCandidate("r", content), context, intrinsic_lambda=0, action_lambda=0
    )
    assert flat.fireability_index == 1.0


# --- validator stack ----------------------------------------------------------


def test_structural_checks_fire_on_the_known_failure_modes(context) -> None:
    row = _row(
        "rule_applies(trait_prefixed_sentence_rule_about_being_rich_and_old, X, Y)"
        " :- trait_female(someone), effect(X, high).",
        context,
    )
    assert set(row.structural_errors) == {
        "rule_atom_budget",
        "literal_actor_atom",
        "family_prefix_predicate",
        "opaque_effect_payload",
    }
    # The structural mistake is not double-counted as a dangling entity.
    assert row.missing_references == ()


def test_body_reaches_head_check(context) -> None:
    row = _row("rule_applies(r, X, Y) :- noble(alphonse_martin).", context)
    assert "body_reaches_head" in row.structural_errors
    # …and a body that does touch a head variable is clean.
    assert "body_reaches_head" not in _row(
        "rule_applies(r, X, Y) :- noble(X).", context
    ).structural_errors


def test_referential_integrity_flags_unknown_entities(context) -> None:
    row = _row(
        "rule_applies(r, X, Y) :- male(X), affinity(X, marguerite_valmont, V), V > 5.",
        context,
    )
    assert row.missing_references == ("marguerite_valmont",)
    assert row.referentially_valid is False
    # A real world entity resolves.
    assert _row(
        "rule_applies(r, X, Y) :- ally(X, celeste_dubois).", context
    ).missing_references == ()


def test_engine_predicate_arguments_are_not_entity_references(context) -> None:
    """`rule_effect(_, C, occupation, salonniere)` names a field, not an entity."""
    row = _row(
        "rule_effect(salon_promotion, C, occupation, salonniere) :-"
        " ally(C, celeste_dubois).",
        context,
        name="salon_promotion",
    )
    assert row.missing_references == ()
    assert row.unknown_predicates == ()
    # …and the engine head is not counted as a condition to satisfy.
    assert row.total_conditions == 1


def test_unparseable_rule_scores_zero_without_crashing(context) -> None:
    row = _row("rule_applies(broken, X, Y :- female(X).", context)
    assert row.parsed is False and row.parse_error
    assert row.reachability_charitable == 0.0
    assert row.structurally_valid is False and row.schema_valid is False


# --- report + doc block -------------------------------------------------------


def test_report_is_deterministic(context) -> None:
    rules = load_rules(DEFAULT_RULES)
    assert build_report(rules, context) == build_report(rules, context)


def test_report_aggregates_the_fixture(context) -> None:
    report = build_report(load_rules(DEFAULT_RULES), context)
    counts = report["counts"]
    assert counts["rules"] == 8 and counts["parsed"] == 7
    assert report["rates"]["parse"] == pytest.approx(7 / 8)
    # The residual VESPACE dead-key set is what the dead-condition table names.
    dead = {d["key"] for d in report["topDeadConditions"]}
    assert {"married/2", "trusts/3", "esteems/3"} <= dead
    assert report["reachability"]["fullyDeadActionSlice"] == 3
    assert report["missingReferences"] == ["marguerite_valmont"]
    assert sum(report["reachability"]["histogram"].values()) == counts["parsed"]


def test_empty_rule_set_does_not_divide_by_zero(context) -> None:
    report = build_report([], context)
    assert report["counts"]["rules"] == 0
    assert report["rates"]["parse"] == 0.0
    assert report["reachability"]["charitable"]["mean"] == 0.0


def test_doc_section_upsert_is_idempotent(context) -> None:
    report = build_report(load_rules(DEFAULT_RULES), context)
    section = render_adherence_section(report)
    assert section.startswith(DOC_MARK_START) and section.rstrip().endswith(
        DOC_MARK_END
    )
    once = upsert_marked_section("# doc\n", section)
    assert upsert_marked_section(once, section) == once
    assert extract_marked_section(once) == section.rstrip("\n")


def test_world_context_from_a_bare_mapping() -> None:
    ctx = build_world_context(
        {"worldId": "w", "contractVersion": "v", "prologKb": "person(a).\n"}
    )
    assert ctx.intrinsic_keys == frozenset({"person/1"})
    assert ctx.producible_keys == frozenset()


# --- committed-artifact ratchet (CI gate) -------------------------------------


def test_committed_baseline_matches_fixture(context) -> None:
    committed = json.loads(DEFAULT_BASELINE.read_text(encoding="utf-8"))
    assert build_report(load_rules(DEFAULT_RULES), context) == committed


def test_check_mode_passes_on_the_committed_baseline() -> None:
    assert main(["--check", "--no-mlflow"]) == 0


def test_check_mode_fails_on_drift(tmp_path: Path) -> None:
    stale = tmp_path / "baseline.json"
    stale.write_text("{}\n", encoding="utf-8")
    assert main(["--check", "--no-mlflow", "--baseline", str(stale)]) == 1


def test_the_bridge_world_scores_end_to_end() -> None:
    """The real bridge-2 artifact loads and scores — the US-003 → US-004 seam."""
    ctx = load_world_context(BRIDGE_WORLD)
    report = build_report(load_rules(BRIDGE_WORLD), ctx)
    assert report["counts"]["rules"] == 3
    assert report["rates"]["parse"] == 1.0
    # That export carries no actions, so nothing is action-producible — an honest
    # floor over converted worlds, documented in docs/rule-adherence-tier.md.
    assert ctx.action_count == 0
    assert report["reachability"]["strict"]["max"] == 0.0
