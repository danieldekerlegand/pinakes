"""Unit + snapshot tests for the Insimul dataset generators (insimul-bridge US-005).

Unit tests drive the pure core on the committed fixture worlds: the rule-SFT
labelling precedence, the corruption ladder, the world-graph projection, the
rule-derivation matcher and the per-world split. Three gates carry real weight:

* the **committed-manifest snapshot** — a fresh build of the fixtures must equal
  ``ml/manifests/insimul-datasets-manifest.json`` byte for byte;
* the **Bridge-2 seam** — ``build_world_graph`` must reproduce the nodes/edges the
  pinakes-engine ``insimul`` adapter emits, checked against the committed
  ``ml/fixtures/insimul/bridge-graph.json`` (regenerate per ``ml/CLAUDE.md``);
* the **containment invariant** — every emitted record is synthetic tier and
  proprietary-licensed, so nothing here can leak into an open-data release.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from pinakes_ml.export_insimul_datasets import (
    DEFAULT_CANDIDATES,
    DEFAULT_MANIFEST,
    DEFAULT_WORLDS,
    main,
    write_datasets,
)
from pinakes_ml.insimul_datasets import (
    CORRUPTIONS,
    INSIMUL_LICENSE,
    LICENSE_CLASS,
    LORE_QA_FILE,
    REL_QUESTION,
    REL_STATEMENT,
    RULE_PREFERENCE_FILE,
    RULE_SFT_FILE,
    SYNTHETIC_TIER,
    build_datasets,
    build_manifest,
    build_rule_prompt,
    build_world_graph,
    corrupt_rule,
    load_candidate_records,
    load_world,
    mock_model_outputs,
    rule_derivation_examples,
    run_smoke,
    serialize_examples,
    split_by_world,
    world_csid,
    world_facts,
)
from pinakes_ml.rule_adherence import RuleCandidate, evaluate_rule

_ML_ROOT = Path(__file__).resolve().parents[1]
BRIDGE_WORLD = DEFAULT_WORLDS[0]
VESPACE_WORLD = DEFAULT_WORLDS[1]
BRIDGE_GRAPH = _ML_ROOT / "fixtures" / "insimul" / "bridge-graph.json"
CANDIDATES = DEFAULT_CANDIDATES[0]

#: The edge types the Bridge-2 adapter mints (canonical schema v1.3.0 + the
#: shared LOCATED_IN). A new one without templates must fail this suite.
WORLD_EDGE_TYPES = frozenset(
    {"PARENT_OF", "SPOUSE_OF", "EMPLOYED_BY", "RESIDES_IN", "LOCATED_IN", "CAUSED_BY"}
)


@pytest.fixture(scope="module")
def bridge_world():
    return load_world(BRIDGE_WORLD)


@pytest.fixture(scope="module")
def vespace_world():
    return load_world(VESPACE_WORLD)


@pytest.fixture(scope="module")
def datasets():
    return build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)


# --- world reading ------------------------------------------------------------


def test_load_world_reads_active_rules_only(bridge_world) -> None:
    names = {r.name for r in bridge_world.rules}
    assert names == {"flood_displaces_resident", "child_inherits_surname"}
    # `guild_membership` ships with isActive=false — retired content is never
    # training data (the same governance rule scallop.py applies to the registry).
    assert "guild_membership" not in names
    assert bridge_world.world_id == "w-laterre"
    assert bridge_world.name == "La Terre Basse"


def test_load_world_rejects_an_off_contract_export(tmp_path: Path) -> None:
    path = tmp_path / "world.json"
    path.write_text(
        json.dumps(
            {"contractVersion": "insimul-grounding-v9", "worldId": "w", "ir": {}}
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="contractVersion"):
        load_world(path)


def test_load_world_rejects_a_world_without_an_id(tmp_path: Path) -> None:
    path = tmp_path / "world.json"
    path.write_text(
        json.dumps({"contractVersion": "insimul-grounding-v1", "ir": {}}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="worldId"):
        load_world(path)


# --- vocabulary-grounded prompts ----------------------------------------------


def test_prompt_is_grounded_in_the_world_vocabulary(vespace_world) -> None:
    prompt = build_rule_prompt(
        vespace_world, rule_name="courts_a_guest", intent="a host courts a guest"
    )
    assert "w-vespace-fixture" in prompt
    assert "courts_a_guest" in prompt
    assert "a host courts a guest" in prompt
    # An intrinsic key and an action-producible key both appear, separately.
    assert "charming/1" in prompt
    assert "flattered/1" in prompt
    assert "celeste_dubois" in prompt


def test_prompt_is_deterministic_and_budget_capped(vespace_world) -> None:
    first = build_rule_prompt(vespace_world, rule_name="r", max_entities=2)
    assert first == build_rule_prompt(vespace_world, rule_name="r", max_entities=2)
    assert "more)" in first  # truncation is announced, never silent


def test_prompt_says_none_when_a_world_exports_no_actions(bridge_world) -> None:
    prompt = build_rule_prompt(bridge_world, rule_name="r")
    assert "Action-producible predicates" in prompt
    assert prompt.count("(none)") == 1


# --- candidate loading ---------------------------------------------------------


def test_candidate_export_carries_declared_labels_and_reports() -> None:
    records = load_candidate_records(CANDIDATES)
    assert len(records) == 7
    assert {r.world_id for r in records} == {"w-vespace-fixture"}
    assert sum(1 for r in records if r.declared_accepted) == 3
    assert sum(1 for r in records if r.declared_accepted is False) == 4
    assert all(r.validator_report for r in records)
    assert len({r.prompt_id for r in records}) == 3


def test_candidate_loader_accepts_a_status_string(tmp_path: Path) -> None:
    path = tmp_path / "rules.jsonl"
    path.write_text(
        json.dumps({"name": "r", "content": "a :- b.", "status": "REJECTED"}) + "\n",
        encoding="utf-8",
    )
    assert load_candidate_records(path)[0].declared_accepted is False


def test_candidate_loader_accepts_a_rules_object(tmp_path: Path) -> None:
    path = tmp_path / "rules.json"
    path.write_text(
        json.dumps({"worldId": "w1", "rules": [{"id": "g1", "prolog": "a :- b."}]}),
        encoding="utf-8",
    )
    record = load_candidate_records(path)[0]
    assert record.world_id == "w1"
    assert record.name == "g1"
    assert record.declared_accepted is None


# --- the corruption ladder ------------------------------------------------------


@pytest.mark.parametrize("strategy", CORRUPTIONS)
def test_every_corruption_introduces_a_new_defect(strategy, vespace_world) -> None:
    content = (
        "rule_applies(flatterer_gains_ally, X, Y) :- female(Y), flattered(Y), "
        "affinity(X, Y, V), V > 5, ally(X, Y)."
    )
    spoiled = corrupt_rule(content, strategy)
    assert spoiled is not None, f"{strategy} did not apply to a clean rule"
    clean_row = evaluate_rule(RuleCandidate("r", content), vespace_world.context)
    spoiled_row = evaluate_rule(RuleCandidate("r", spoiled), vespace_world.context)
    assert not clean_row.unknown_predicates and not clean_row.missing_references
    assert clean_row.structurally_valid
    assert not (
        spoiled_row.parsed
        and spoiled_row.structurally_valid
        and spoiled_row.schema_valid
        and spoiled_row.referentially_valid
    )


def test_corruption_is_inapplicable_rather_than_faked() -> None:
    # No parenthesised goal to unbalance, no rule atom to lengthen.
    assert corrupt_rule("a.", "parse_error") is None
    assert corrupt_rule("a.", "rule_atom_budget") is None
    assert corrupt_rule("a.", "unknown_predicate") is None


def test_corruption_preserves_negation(vespace_world) -> None:
    content = (
        "rule_applies(tutored_charisma_rises, X, Y) :- charming(X), "
        "\\+ embarrassed(Y)."
    )
    spoiled = corrupt_rule(content, "dangling_entity")
    assert spoiled is not None
    assert "\\+" in spoiled


# --- the rule-SFT dataset -------------------------------------------------------


def test_world_rules_are_accepted_by_declaration(datasets) -> None:
    rows = [
        e
        for e in datasets.sft
        if e.world_id == "w-laterre" and e.corruption == ""
    ]
    assert {e.rule_name for e in rows} == {
        "flood_displaces_resident",
        "child_inherits_surname",
    }
    assert all(e.accepted and e.label_source == "declared" for e in rows)
    # The evaluator's verdict rides along as a diagnostic and does NOT override:
    # this world exports no actions, so its own shipped rules score dead keys.
    assert all(not e.fully_valid for e in rows)
    assert all("unknown:" in e.defects for e in rows)


def test_declared_candidate_labels_win_over_the_evaluator(datasets) -> None:
    rows = {
        (e.rule_name, e.completion): e
        for e in datasets.sft
        if e.world_id == "w-vespace-fixture"
    }
    accepted = [e for e in rows.values() if e.accepted]
    rejected = [e for e in rows.values() if not e.accepted]
    assert len(accepted) == 3 and len(rejected) == 4
    assert all(e.label_source == "declared" for e in rows.values())
    assert all(e.validator_report for e in rows.values())
    # The three declared-accepted candidates are clean under our tier too.
    assert all(e.fully_valid for e in accepted)


def test_corruption_negatives_pair_with_their_own_prompt(datasets) -> None:
    corrupted = [e for e in datasets.sft if e.corruption]
    assert corrupted, "expected corruption-sampled negatives"
    assert all(not e.accepted for e in corrupted)
    assert {e.corruption for e in corrupted} == set(CORRUPTIONS)
    by_rule = {(e.world_id, e.rule_name): e.prompt_id for e in datasets.sft}
    for example in corrupted:
        assert example.prompt_id == by_rule[(example.world_id, example.rule_name)]


def test_preference_pairs_share_a_prompt_and_add_defects(datasets) -> None:
    assert datasets.preferences
    origins = {p.origin for p in datasets.preferences}
    assert origins == {"corruption-sampled", "rejection-sampled"}
    for pair in datasets.preferences:
        assert pair.chosen != pair.rejected
        assert pair.prompt
        assert pair.new_defects, "a rejected side must be distinguishably worse"


def test_rejection_sampled_pairs_come_from_the_producer_export(datasets) -> None:
    sampled = [p for p in datasets.preferences if p.origin == "rejection-sampled"]
    # 3 prompts: 2 rejected + 1 rejected + 1 rejected against one winner each.
    assert len(sampled) == 4
    assert {p.world_id for p in sampled} == {"w-vespace-fixture"}


def test_candidates_for_an_unknown_world_are_counted_not_dropped_silently(
    tmp_path: Path,
) -> None:
    path = tmp_path / "rules.jsonl"
    path.write_text(
        json.dumps({"worldId": "w-nope", "name": "r", "content": "a :- b."}) + "\n",
        encoding="utf-8",
    )
    built = build_datasets(DEFAULT_WORLDS, [path])
    assert built.rule_stats["candidatesWithoutWorld"] == 1


# --- the synthetic world graph --------------------------------------------------


def test_world_csid_matches_the_bridge_2_mint() -> None:
    assert (
        world_csid("character", "w-laterre", "c1")
        == "cs:character:insimul:w-laterre:c1"
    )


def test_world_graph_reproduces_the_bridge_2_adapter(bridge_world) -> None:
    """The US-003 -> US-005 seam: same nodes, same names, same edges, same csids."""
    reference = json.loads(BRIDGE_GRAPH.read_text(encoding="utf-8"))
    graph = build_world_graph(bridge_world)
    assert reference["worldId"] == bridge_world.world_id
    assert sorted((c, i.name) for c, i in graph.nodes.items()) == sorted(
        (n["csid"], n["name"]) for n in reference["nodes"]
    )
    assert sorted(graph.edge_index) == sorted(
        (e["head"], e["relation"], e["tail"]) for e in reference["edges"]
    )


def test_every_world_edge_type_has_templates() -> None:
    """Coverage gate — a new v1.3 edge type without phrasings emits no QA."""
    assert WORLD_EDGE_TYPES <= set(REL_STATEMENT)
    assert WORLD_EDGE_TYPES <= set(REL_QUESTION)


def test_graph_edges_carry_the_proprietary_licence(bridge_world) -> None:
    graph = build_world_graph(bridge_world)
    assert {e.license for e in graph.edge_index.values()} == {INSIMUL_LICENSE}
    assert {e.source for e in graph.edge_index.values()} == {"insimul"}


def test_spouse_edges_collapse_to_one_direction(bridge_world) -> None:
    graph = build_world_graph(bridge_world)
    spouse = [k for k in graph.edge_index if k[1] == "SPOUSE_OF"]
    assert len(spouse) == 1  # both stored sides -> one symmetric edge


# --- rule derivations -----------------------------------------------------------


def test_world_facts_project_the_ir_alongside_the_prolog_kb(bridge_world) -> None:
    facts = set(world_facts(bridge_world))
    assert ("parent_of", ("c1", "c3")) in facts  # from the prologKb
    assert ("gender", ("c2", "male")) in facts  # projected from WorldIR
    assert ("last_name", ("c2", "bernard")) in facts  # accent/case folded
    assert ("settlement_terrain", ("s1", "floodplain")) in facts
    assert ("business_owner", ("biz1", "c1")) in facts


def test_rule_derivation_grounds_the_answer_in_the_world_kb(bridge_world) -> None:
    graph = build_world_graph(bridge_world)
    examples, stats = rule_derivation_examples(bridge_world, graph)
    assert len(examples) == 1
    example = examples[0]
    assert example.kind == "rule_derivation"
    assert example.answer == "bernard"
    assert example.subject == world_csid("character", "w-laterre", "c3")
    assert "child_inherits_surname" in example.question
    # The ground premises are stated, so the answer needs the rule to be applied.
    assert "parent_of(c2, c3)" in example.question
    assert "gender(c2, male)" in example.question
    evidence = json.loads(example.evidence)
    assert [e["relation"] for e in evidence] == ["PARENT_OF", "GENDER", "LAST_NAME"]
    assert evidence[0]["head"] == world_csid("character", "w-laterre", "c2")
    # `flood_displaces_resident` names truth_year(flood, Y), which no fact
    # satisfies — an honest miss, reported rather than guessed at.
    assert stats["rulesWithoutDerivation"] == 1


def test_a_derivation_is_never_grounded_in_an_unchecked_premise(
    bridge_world,
) -> None:
    """Negation / comparison / cut goals abort the derivation rather than
    being assumed true."""
    graph = build_world_graph(bridge_world)
    negated = RuleCandidate(
        "negated_rule",
        "rule_effect(negated_rule, C, last_name, N) :- parent_of(F, C), "
        "\\+ gender(F, male), last_name(F, N).",
        True,
    )
    world = replace(bridge_world, rules=(negated,))
    examples, stats = rule_derivation_examples(world, graph)
    assert examples == []
    assert stats["rulesWithoutDerivation"] == 1


# --- lore QA + the per-world split ----------------------------------------------


def test_lore_qa_covers_both_grounding_kinds(datasets) -> None:
    kinds = {example.kind for example in datasets.qa_examples}
    assert kinds == {"path", "rule_derivation"}
    assert all(e.license == INSIMUL_LICENSE for e in datasets.qa_examples)


def test_path_questions_use_the_synthetic_relation_vocabulary(datasets) -> None:
    paths = [e for e in datasets.qa_examples if e.kind == "path"]
    assert paths
    for example in paths:
        first, second = example.relation_path.split(">")
        assert first in WORLD_EDGE_TYPES and second in WORLD_EDGE_TYPES
        assert REL_QUESTION[second].split("{h}")[0].strip() in example.question


def test_split_reserves_whole_worlds(datasets) -> None:
    splits = datasets.splits
    train_worlds = {world_id for world_id, _ in splits.train}
    eval_worlds = {world_id for world_id, _ in splits.eval}
    assert train_worlds and eval_worlds
    assert not (train_worlds & eval_worlds), "a world must never straddle the split"
    assert set(splits.held_out_worlds) == eval_worlds


def test_split_always_holds_out_a_world_when_there_are_several(datasets) -> None:
    # Even a ratio of 0 keeps one world back — the eval tiers must have somewhere
    # to score that training never saw.
    splits = split_by_world(datasets.qa, eval_ratio=0.0)
    assert len(splits.held_out_worlds) == 1
    assert splits.eval


def test_split_of_a_lone_world_holds_nothing_back() -> None:
    splits = split_by_world(build_datasets([BRIDGE_WORLD]).qa, eval_ratio=0.0)
    assert splits.held_out_worlds == ()
    assert splits.train and not splits.eval


# --- containment ----------------------------------------------------------------


def test_every_record_is_synthetic_tier_and_proprietary(datasets) -> None:
    """The PRD invariant: synthetic-tier facts never enter an open release."""
    for example in datasets.sft:
        assert example.tier == SYNTHETIC_TIER
        assert example.license == INSIMUL_LICENSE
        assert example.license_class == LICENSE_CLASS
    for pair in datasets.preferences:
        assert pair.tier == SYNTHETIC_TIER
        assert pair.license_class == LICENSE_CLASS
    for example in datasets.qa_examples:
        assert example.license == INSIMUL_LICENSE


def test_manifest_advertises_the_tier_and_licence_class(datasets) -> None:
    manifest = build_manifest(datasets)
    assert manifest["tier"] == SYNTHETIC_TIER
    assert manifest["licenseClass"] == LICENSE_CLASS
    assert manifest["license"] == INSIMUL_LICENSE
    assert list(manifest["licenseCounts"]) == [INSIMUL_LICENSE]


# --- determinism + the committed snapshot ---------------------------------------


def test_the_build_is_byte_reproducible() -> None:
    first = build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)
    second = build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)
    assert serialize_examples(first.sft) == serialize_examples(second.sft)
    assert serialize_examples(first.preferences) == serialize_examples(
        second.preferences
    )
    assert serialize_examples(first.qa_examples) == serialize_examples(
        second.qa_examples
    )
    assert build_manifest(first) == build_manifest(second)


def test_committed_manifest_matches_a_fresh_build(datasets) -> None:
    """The CI ratchet — the committed snapshot IS a fresh build of the fixtures."""
    manifest = build_manifest(datasets, smoke=run_smoke(datasets))
    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    assert manifest == committed


def test_manifest_hashes_match_the_written_files(
    datasets, tmp_path: Path
) -> None:
    write_datasets(tmp_path, datasets)
    manifest = build_manifest(datasets)
    for name in (RULE_SFT_FILE, RULE_PREFERENCE_FILE, LORE_QA_FILE):
        body = (tmp_path / name).read_text(encoding="utf-8")
        assert (
            hashlib.sha256(body.encode("utf-8")).hexdigest()
            == manifest["files"][name]["sha256"]
        )


# --- the end-to-end smoke --------------------------------------------------------


def test_mock_model_answers_prompts_with_a_realistic_mix(datasets) -> None:
    accepted = [e for e in datasets.sft if e.accepted]
    generations = mock_model_outputs(accepted, corrupt_every=2)
    assert len(generations) == len(accepted)
    contents = {c.content for c in generations}
    reference = {e.completion for e in accepted}
    assert contents & reference, "some generations must be the reference rule"
    assert contents - reference, "some generations must be corrupted"


def test_smoke_scores_the_held_out_world_through_the_tier_4_evaluator(
    datasets,
) -> None:
    smoke = run_smoke(datasets)
    assert smoke["worldId"] in datasets.splits.held_out_worlds
    assert smoke["generations"] > 0
    assert 0.0 <= smoke["parseRate"] <= 1.0
    assert smoke["defectCounts"], "a mock model's mistakes must be visible"


def test_smoke_is_deterministic(datasets) -> None:
    assert run_smoke(datasets) == run_smoke(datasets)


# --- the CLI ----------------------------------------------------------------------


def test_cli_check_passes_against_the_committed_manifest(capsys) -> None:
    assert main(["--check", "--no-mlflow"]) == 0
    assert "PASS" in capsys.readouterr().out


def test_cli_check_reports_drift(tmp_path: Path, capsys) -> None:
    stale = tmp_path / "manifest.json"
    stale.write_text("{}\n", encoding="utf-8")
    assert main(["--check", "--no-mlflow", "--manifest", str(stale)]) == 1
    assert "DRIFT" in capsys.readouterr().out


def test_cli_writes_the_datasets_and_manifest(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    manifest = tmp_path / "manifest.json"
    assert (
        main(
            [
                "--no-mlflow",
                "--data-dir",
                str(data_dir),
                "--manifest",
                str(manifest),
            ]
        )
        == 0
    )
    for name in (RULE_SFT_FILE, RULE_PREFERENCE_FILE, LORE_QA_FILE):
        assert (data_dir / name).exists()
    assert (data_dir / "lore-qa-train.jsonl").exists()
    assert (data_dir / "lore-qa-eval.jsonl").exists()
    written = json.loads(manifest.read_text(encoding="utf-8"))
    assert written["tier"] == SYNTHETIC_TIER
    assert written["smoke"]["generations"] > 0


def test_cli_rejects_a_missing_input(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        main(["--no-mlflow", "--world", str(tmp_path / "nope.json")])
