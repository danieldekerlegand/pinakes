"""Insimul SLM dataset generators — rule-SFT + lore QA (insimul-bridge US-005).

Bridge 4's training feed. Turns **converted Insimul worlds** (the Bridge-2
``CanonicalWorldExport`` artifacts US-003 ingests) into two ``ml/`` datasets:

* **rule-authoring SFT** (``rule-sft.jsonl``) — one record per candidate rule:
  a *vocabulary-grounded* prompt (the world's intrinsic predicates, its
  action-producible predicates and its entity roster, distilled by
  :func:`~pinakes_ml.rule_adherence.build_world_context`) paired with a Prolog
  rule, labelled ``accepted`` or ``rejected``. Plus **preference pairs**
  (``rule-preferences.jsonl``) — the same prompt with a chosen and a rejected
  completion.
* **lore-consistency QA** (``lore-qa.jsonl``) — the Phase-5a multi-hop
  KG-grounded QA generator (:mod:`pinakes_ml.kgqa`) run over the synthetic-tier
  world graph, with the world's own **rule derivations** as a second reasoning
  target.

Two ways a rule gets its accepted/rejected label, in strict precedence:

1. **Declared.** An Insimul ``rules.jsonl`` rejection-sampling export ships
   ``accepted`` + a ``validatorReport`` per candidate; a world export's own
   ``systems.rules``/``baseRules`` shipped with the world, so they are accepted
   by construction. The declaration wins — our evaluator's verdict rides along
   as a diagnostic, never as an override (today's Bridge-2 exports carry no
   ``systems.actions``, so *every* action-derived condition scores dead; see
   ``docs/rule-adherence-tier.md``).
2. **Evaluated.** A candidate with no declared label is scored by
   :func:`~pinakes_ml.rule_adherence.evaluate_rule` and accepted iff it is
   fully valid (parses, structurally + schema + referentially clean).

Negatives come from two places. A declared export's rejected candidates are
genuine **rejection-sampled** negatives. A world that ships only its accepted
rules gets **corruption-sampled** negatives instead: a fixed, deterministic
ladder of authoring mistakes (:data:`CORRUPTIONS`) applied to each accepted
rule, each kept only when the evaluator confirms it introduces a *new* defect
the original did not have — the same "verify the negative, never fake it"
discipline as :mod:`pinakes_ml.queries`' type-constrained corruption pools.

**Everything is ``synthetic`` tier and proprietary-licensed.** A converted world
is generated content, not observation: every record and the manifest carry
``tier: "synthetic"`` and ``LicenseRef-Insimul-Proprietary`` (the adapter's
:data:`INSIMUL_LICENSE`), and the datasets land in the DVC-tracked, git-ignored
``ml/data/insimul/`` tree — never in an open-data release (INSIMUL_SYNC_PLAN §7
"License leakage"; ``orchestrate.tiers.assert_no_synthetic_records`` is the
corpus-side gate).

Pure + stdlib-only (no Insimul import, no ``culturescrape`` import — ``ml/`` is a
separate uv workspace), no wall-clock and no MLflow, so the committed manifest is
byte-reproducible. The thin CLI + MLflow logging live in
:mod:`pinakes_ml.export_insimul_datasets`.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from pinakes_ml.kgqa import EvidenceEdge, Graph, QAExample, path_examples
from pinakes_ml.rule_adherence import (
    ANALYZER_VERSION,
    Clause,
    ParseError,
    RuleCandidate,
    RuleRow,
    WorldContext,
    build_world_context,
    evaluate_rule,
    parse_goal,
    parse_prolog_source,
    sanitize_atom,
)
from pinakes_ml.verbalize import NodeInfo

__all__ = [
    "CORRUPTIONS",
    "DATASET_VERSION",
    "DEFAULT_EVAL_RATIO",
    "DEFAULT_SEED",
    "INSIMUL_LICENSE",
    "INSIMUL_SOURCE",
    "LICENSE_CLASS",
    "LORE_QA_FILE",
    "MAX_NEGATIVES_PER_RULE",
    "REL_QUESTION",
    "REL_STATEMENT",
    "RULE_PREFERENCE_FILE",
    "RULE_SFT_FILE",
    "SYNTHETIC_TIER",
    "PreferencePair",
    "RuleSftExample",
    "World",
    "WorldSplits",
    "build_datasets",
    "build_lore_qa",
    "build_manifest",
    "build_rule_prompt",
    "build_world_graph",
    "corrupt_rule",
    "load_candidate_records",
    "load_world",
    "mock_model_outputs",
    "rule_derivation_examples",
    "run_smoke",
    "serialize_examples",
    "split_by_world",
    "world_csid",
    "world_facts",
]

#: Bumped when a record shape or a generation rule changes, so a committed
#: manifest is attributable to the generator that produced it (same role as
#: ``rule_adherence.ANALYZER_VERSION`` on the eval tier).
DATASET_VERSION = "1"

#: The trust tier every record carries — ``orchestrate.tiers.TIER_SYNTHETIC``.
SYNTHETIC_TIER = "synthetic"
#: The acquisition-adapter source name (``acquire.insimul.INSIMUL_SOURCE``).
INSIMUL_SOURCE = "insimul"
#: The per-record SPDX id a generated world carries, mirrored from
#: ``acquire.insimul.INSIMUL_LICENSE``. It is an unregistered ``LicenseRef``, so
#: culture-scrape's SPDX classifier files it ``unknown`` (verify before
#: redistribute); the dataset-facing class is the blunter, truthful one below.
INSIMUL_LICENSE = "LicenseRef-Insimul-Proprietary"
#: The license class the manifests advertise. Bridge-2 output is proprietary and
#: never enters an open-data release (INSIMUL_SYNC_PLAN §7).
LICENSE_CLASS = "proprietary"
#: The ``contractVersion`` literal ``@insimul/core`` pins on a world export.
CONTRACT_VERSION = "insimul-grounding-v1"

#: Output dataset filenames under ``ml/data/insimul/``.
RULE_SFT_FILE = "rule-sft.jsonl"
RULE_PREFERENCE_FILE = "rule-preferences.jsonl"
LORE_QA_FILE = "lore-qa.jsonl"

#: Pinned salt for the deterministic per-world eval draw.
DEFAULT_SEED = 20260722
#: Share of lore-QA examples reserved for the held-out per-world eval split. The
#: draw is whole-world (never a partial world), and at least one world is held
#: out whenever there are two or more — the adherence + KGQA tiers score there.
DEFAULT_EVAL_RATIO = 0.25
#: Cap on corruption-sampled negatives kept per accepted rule. The default runs
#: the whole :data:`CORRUPTIONS` ladder; lower it to trade coverage for size (the
#: cut is deterministic — strategies are always tried in their declared order).
MAX_NEGATIVES_PER_RULE = 5

#: Prompt budget — how many vocabulary keys / entity ids a prompt lists before
#: it truncates (with an explicit "+N more", never a silent cut).
_MAX_PROMPT_PREDICATES = 24
_MAX_PROMPT_ENTITIES = 16

#: Canonical node types the Bridge-2 adapter mints, and their csid type slugs.
_NODE_TYPE_CHARACTER = "character"
_NODE_TYPE_BUILDING = "building"
_NODE_TYPE_BUSINESS = "business"
_NODE_TYPE_PLACE = "place"
_NODE_TYPE_TRUTH = "myth-motif"

# Statement / question phrasings for the synthetic world vocabulary — the
# ``kgqa.REL_STATEMENT``/``REL_QUESTION`` tables for the five schema-v1.3.0 edge
# types the insimul adapter emits, plus the shared ``LOCATED_IN``. A relation
# missing from either table emits no question, so `test_every_world_edge_type_
# has_templates` is the coverage gate (same shape as verbalize's).
REL_STATEMENT: dict[str, str] = {
    "PARENT_OF": "{h} is a parent of {t}",
    "SPOUSE_OF": "{h} is married to {t}",
    "EMPLOYED_BY": "{h} works at {t}",
    "RESIDES_IN": "{h} lives at {t}",
    "LOCATED_IN": "{h} stands in {t}",
    "CAUSED_BY": "{h} was caused by {t}",
}

REL_QUESTION: dict[str, str] = {
    "PARENT_OF": "who is a child of {h}?",
    "SPOUSE_OF": "who is {h} married to?",
    "EMPLOYED_BY": "where does {h} work?",
    "RESIDES_IN": "where does {h} live?",
    "LOCATED_IN": "which settlement does {h} stand in?",
    "CAUSED_BY": "what caused {h}?",
}

#: The rule-derivation question. The rule text and its ground premises are stated
#: so the answer is reachable only by applying the rule to the world's own facts.
DERIVATION_TEMPLATE = (
    "In the world {world}, the rule `{rule}` reads:\n    {content}\n"
    "The world's knowledge base holds {premises}. "
    "Applying the rule to those facts, what is {question_var}?"
)

_VARIABLE_RE = re.compile(r"^[A-Z_]\w*$")


# --- world reading ------------------------------------------------------------


def world_csid(node_type: str, world_id: str, entity_id: str) -> str:
    """The Bridge-2 world-scoped csid for *entity_id*.

    Mirrors ``acquire.insimul.WorldExport.csid`` — an alias-anchored
    ``mint_csid`` whose local part is the alias **verbatim**, i.e.
    ``cs:<type>:insimul:<worldId>:<entityId>``. Reimplemented (not imported):
    ``ml/`` is a separate uv workspace from ``core``, so the
    seam is gated by a committed cross-check fixture instead — see
    ``ml/fixtures/insimul/bridge-graph.json`` and its test.
    """
    return f"cs:{node_type}:{INSIMUL_SOURCE}:{world_id}:{entity_id}"


@dataclass(frozen=True)
class World:
    """One converted world: the raw export, its distilled context, its rules."""

    world_id: str
    export: Mapping[str, Any]
    context: WorldContext
    #: The world's own shipped rules (``systems.rules`` + ``systems.baseRules``),
    #: active only — an inactive rule is retired content, never training data.
    rules: tuple[RuleCandidate, ...] = ()
    #: Human-readable descriptions keyed by rule name (prompt material).
    descriptions: Mapping[str, str] = field(default_factory=dict)

    @property
    def name(self) -> str:
        meta = _section(self.export, "meta")
        return _text(meta.get("worldName")) or self.world_id

    @property
    def seed(self) -> str:
        return _text(self.export.get("seed"))

    @property
    def contract_version(self) -> str:
        return _text(self.export.get("contractVersion"))

    def as_dict(self) -> dict[str, Any]:
        return {
            "worldId": self.world_id,
            "worldName": self.name,
            "seed": self.seed,
            "contractVersion": self.contract_version,
            "rules": len(self.rules),
            **self.context.as_dict(),
        }


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _section(export: Mapping[str, Any], *path: str) -> Mapping[str, Any]:
    node: Any = export.get("ir") if "ir" in export else export
    for key in path:
        if not isinstance(node, Mapping):
            return {}
        node = node.get(key)
    return node if isinstance(node, Mapping) else {}


def _collection(export: Mapping[str, Any], *path: str) -> list[Mapping[str, Any]]:
    node: Any = export.get("ir") if "ir" in export else export
    for key in path[:-1]:
        if not isinstance(node, Mapping):
            return []
        node = node.get(key)
    if not isinstance(node, Mapping):
        return []
    value = node.get(path[-1])
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def load_world(path: Path | str) -> World:
    """Read a ``CanonicalWorldExport`` file into a :class:`World`."""
    export = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(export, Mapping):
        raise ValueError(f"{path}: not a CanonicalWorldExport object")
    contract = _text(export.get("contractVersion"))
    if contract != CONTRACT_VERSION:
        raise ValueError(
            f"{path}: expected contractVersion {CONTRACT_VERSION!r}, got "
            f"{contract!r} — refusing to build a dataset from an off-contract export"
        )
    world_id = _text(export.get("worldId"))
    if not world_id:
        raise ValueError(f"{path}: world export has no 'worldId'")

    rules: list[RuleCandidate] = []
    descriptions: dict[str, str] = {}
    for record in (
        *_collection(export, "systems", "rules"),
        *_collection(export, "systems", "baseRules"),
    ):
        content = _text(record.get("content"))
        name = _text(record.get("name")) or _text(record.get("id"))
        if not content or not name:
            continue
        active = record.get("isActive")
        if active is not None and not bool(active):
            continue  # retired content — the governance rule scallop.py uses too
        rules.append(RuleCandidate(name, content, True))
        descriptions[name] = _text(record.get("description"))

    return World(
        world_id=world_id,
        export=export,
        context=build_world_context(export),
        rules=tuple(rules),
        descriptions=descriptions,
    )


# --- vocabulary-grounded prompts ----------------------------------------------


def _listing(values: Sequence[str], cap: int) -> str:
    if not values:
        return "(none)"
    if len(values) <= cap:
        return ", ".join(values)
    return ", ".join(values[:cap]) + f", … (+{len(values) - cap} more)"


def build_rule_prompt(
    world: World,
    *,
    rule_name: str,
    intent: str = "",
    max_predicates: int = _MAX_PROMPT_PREDICATES,
    max_entities: int = _MAX_PROMPT_ENTITIES,
) -> str:
    """The instruction half of an SFT record — grounded in *world*'s vocabulary.

    Everything listed is sorted and budget-capped with an explicit "+N more", so
    the prompt is a deterministic function of the export (no sampling, no clock).
    Intrinsic and action-producible predicates are listed separately because that
    distinction is exactly what the tier-4 reachability metric scores.
    """
    context = world.context
    intrinsic = sorted(context.intrinsic_keys)
    producible = sorted(context.producible_keys)
    entities = sorted(context.entity_atoms)
    goal = intent or f"the rule named `{rule_name}`"
    return (
        f"World `{world.world_id}` ({world.name}) — an Insimul "
        f"CanonicalWorldExport on contract {world.contract_version}.\n"
        f"Intrinsic predicates (true at world creation): "
        f"{_listing(intrinsic, max_predicates)}\n"
        f"Action-producible predicates (some action effect can make these true): "
        f"{_listing(producible, max_predicates)}\n"
        f"Entities you may name: {_listing(entities, max_entities)}\n"
        f"Write ONE Prolog rule named `{rule_name}` capturing: {goal}\n"
        f"Use only the predicates and entities listed above; emit a single "
        f"clause ending in a period."
    )


# --- candidate rules ----------------------------------------------------------


@dataclass(frozen=True)
class _CandidateRecord:
    """One rule candidate as read from an input, before scoring."""

    world_id: str
    name: str
    content: str
    prompt_id: str
    intent: str
    declared_accepted: bool | None
    validator_report: str


def _report_json(value: Any) -> str:
    if value is None:
        return ""
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def load_candidate_records(path: Path | str) -> list[_CandidateRecord]:
    """Read an Insimul rejection-sampling export into candidate records.

    Accepts a ``rules.jsonl`` (one candidate object per line — the shape
    INSIMUL_SYNC_PLAN §5.1 describes for "generate across many worlds, filter
    through Insimul's 4-layer validator stack"), a ``{"rules": [...]}`` JSON
    document, or a bare JSON list. Recognised keys per record: ``worldId``,
    ``name``/``id``, ``content``/``prolog``/``rule``, ``promptId``,
    ``intent``/``description``, ``accepted``/``isAccepted``/``status``, and
    ``validatorReport``/``report`` (carried verbatim as a JSON string, so a
    consumer can train on the validator feedback).
    """
    text = Path(path).read_text(encoding="utf-8")
    try:
        data: Any = json.loads(text)
    except json.JSONDecodeError:
        data = [json.loads(line) for line in text.splitlines() if line.strip()]
    default_world = ""
    if isinstance(data, Mapping):
        default_world = _text(data.get("worldId"))
        raw = data.get("rules")
        if isinstance(raw, list):
            records = list(raw)
        elif any(data.get(key) for key in ("content", "prolog", "rule")):
            # A one-line JSONL parses as a bare object — it is one candidate,
            # not an empty ``{"rules": []}`` envelope.
            records = [data]
        else:
            records = []
    elif isinstance(data, list):
        records = list(data)
    else:
        raise ValueError(f"{path}: unrecognised candidate-file shape")

    out: list[_CandidateRecord] = []
    for index, record in enumerate(records):
        if not isinstance(record, Mapping):
            continue
        content = _text(
            record.get("content") or record.get("prolog") or record.get("rule")
        )
        if not content:
            continue
        name = (
            _text(record.get("name"))
            or _text(record.get("id"))
            or f"rule_{index + 1:03d}"
        )
        declared: bool | None = None
        for key in ("accepted", "isAccepted"):
            if record.get(key) is not None:
                declared = bool(record.get(key))
                break
        status = _text(record.get("status")).lower()
        if declared is None and status in ("accepted", "rejected"):
            declared = status == "accepted"
        out.append(
            _CandidateRecord(
                world_id=_text(record.get("worldId")) or default_world,
                name=name,
                content=content,
                prompt_id=_text(record.get("promptId")),
                intent=_text(record.get("intent") or record.get("description")),
                declared_accepted=declared,
                validator_report=_report_json(
                    record.get("validatorReport") or record.get("report")
                ),
            )
        )
    return out


# --- corruption-sampled negatives ---------------------------------------------

#: The fixed ladder of authoring mistakes used to synthesize negatives, in the
#: order they are tried. Each maps to a defect the tier-4 validator stack names.
CORRUPTIONS: tuple[str, ...] = (
    "unknown_predicate",
    "dangling_entity",
    "literal_actor_atom",
    "rule_atom_budget",
    "parse_error",
)

#: A predicate suffix guaranteed absent from any world vocabulary.
_UNATTESTED_SUFFIX = "_unattested"
#: An entity atom guaranteed absent from any world roster.
_DANGLING_ENTITY = "nonexistent_entity"
#: A literal actor label the structural checks reject (``_LITERAL_ACTOR_ATOMS``).
_LITERAL_ACTOR = "someone"
#: Over the 48-char / 6-word rule-atom budget the structural checks enforce.
_SENTENCE_ATOM = "rule_that_describes_a_very_long_and_wordy_authoring_mistake"


def _render_goal(raw: str, negated: bool) -> str:
    return f"\\+ {raw}" if negated else raw


def _rebuild(head: str, goal_texts: Sequence[str]) -> str:
    if not goal_texts:
        return f"{head}."
    return f"{head} :- " + ", ".join(goal_texts) + "."


def _clause_parts(content: str) -> tuple[Clause, list[str]] | None:
    """The single rule clause of *content* plus its rendered goal texts."""
    try:
        clauses = parse_prolog_source(content)
    except ParseError:
        return None
    rules = [c for c in clauses if c.goals]
    if not rules:
        return None
    clause = rules[0]
    return clause, [_render_goal(g.raw.strip(), False) for g in clause.goals]


def corrupt_rule(content: str, strategy: str) -> str | None:
    """Apply one deterministic authoring mistake to *content*.

    Returns ``None`` when the strategy does not apply (e.g. no variable argument
    to spoil), so a caller drops that negative rather than emitting a fake one.
    """
    if strategy == "parse_error":
        stripped = content.rstrip().rstrip(".")
        cut = stripped.rfind(")")
        if cut < 0:
            return None
        return stripped[:cut] + stripped[cut + 1 :] + "."

    parts = _clause_parts(content)
    if parts is None:
        return None
    clause, texts = parts

    if strategy == "rule_atom_budget":
        if not clause.rule_atom:
            return None
        head = clause.head.replace(clause.rule_atom, _SENTENCE_ATOM, 1)
        return _rebuild(head, texts)

    for index, goal in enumerate(clause.goals):
        if goal.is_comparison or not goal.name or goal.arity == 0:
            continue
        if strategy == "unknown_predicate":
            renamed = f"{goal.name}{_UNATTESTED_SUFFIX}({', '.join(goal.args)})"
            texts[index] = _render_goal(renamed, goal.negated)
            return _rebuild(clause.head, texts)
        replacement = (
            _DANGLING_ENTITY if strategy == "dangling_entity" else _LITERAL_ACTOR
        )
        for slot, arg in enumerate(goal.args):
            if not _VARIABLE_RE.match(arg.strip()):
                continue
            args = list(goal.args)
            args[slot] = replacement
            spoiled = f"{goal.name}({', '.join(a.strip() for a in args)})"
            texts[index] = _render_goal(spoiled, goal.negated)
            return _rebuild(clause.head, texts)
    return None


def _defects(row: RuleRow) -> frozenset[str]:
    """The defect set a scorecard reports — the currency negatives trade in."""
    if not row.parsed:
        return frozenset({"parse"})
    return frozenset(
        [f"structural:{e}" for e in row.structural_errors]
        + [f"unknown:{k}" for k in row.unknown_predicates]
        + [f"missing:{a}" for a in row.missing_references]
    )


# --- rule-SFT records ----------------------------------------------------------


@dataclass(frozen=True)
class RuleSftExample:
    """One flat, uniform rule-authoring SFT record (HF-datasets-compatible)."""

    kind: str  # "accepted" | "rejected"
    world_id: str
    rule_name: str
    prompt_id: str
    prompt: str
    completion: str
    accepted: bool
    label_source: str  # "declared" | "evaluated"
    corruption: str  # the CORRUPTIONS strategy, "" for a natural candidate
    defects: str  # ";"-joined defect ids the tier-4 validator stack found
    validator_report: str  # the producer's own report, JSON, "" when absent
    parsed: bool
    fully_valid: bool
    reachability_charitable: float
    fireability_index: float
    tier: str
    license: str
    license_class: str
    source: str
    contract_version: str

    def _sort_key(self) -> tuple[Any, ...]:
        return (
            self.world_id,
            self.rule_name,
            self.kind,
            self.corruption,
            self.completion,
        )

    def as_json_line(self) -> str:
        return json.dumps(asdict(self), sort_keys=True, ensure_ascii=False)


@dataclass(frozen=True)
class PreferencePair:
    """One (prompt, chosen, rejected) rule-authoring preference pair."""

    world_id: str
    rule_name: str
    prompt_id: str
    prompt: str
    chosen: str
    rejected: str
    origin: str  # "rejection-sampled" | "corruption-sampled"
    corruption: str
    new_defects: str  # ";"-joined defects the rejected side adds
    tier: str
    license: str
    license_class: str
    source: str

    def _sort_key(self) -> tuple[Any, ...]:
        return (self.world_id, self.rule_name, self.corruption, self.rejected)

    def as_json_line(self) -> str:
        return json.dumps(asdict(self), sort_keys=True, ensure_ascii=False)


def _prompt_id(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]


def _sft_example(
    world: World,
    *,
    rule_name: str,
    prompt: str,
    prompt_id: str,
    content: str,
    accepted: bool,
    label_source: str,
    corruption: str,
    validator_report: str,
    row: RuleRow,
) -> RuleSftExample:
    return RuleSftExample(
        kind="accepted" if accepted else "rejected",
        world_id=world.world_id,
        rule_name=rule_name,
        prompt_id=prompt_id,
        prompt=prompt,
        completion=content.strip(),
        accepted=accepted,
        label_source=label_source,
        corruption=corruption,
        defects=";".join(sorted(_defects(row))),
        validator_report=validator_report,
        parsed=row.parsed,
        fully_valid=(
            row.parsed
            and row.structurally_valid
            and row.schema_valid
            and row.referentially_valid
        ),
        reachability_charitable=round(row.reachability_charitable, 6),
        fireability_index=round(row.fireability_index, 6),
        tier=SYNTHETIC_TIER,
        license=INSIMUL_LICENSE,
        license_class=LICENSE_CLASS,
        source=INSIMUL_SOURCE,
        contract_version=world.contract_version,
    )


def _build_rule_dataset(
    worlds: Mapping[str, World],
    candidates: Sequence[_CandidateRecord],
    *,
    max_negatives_per_rule: int = MAX_NEGATIVES_PER_RULE,
) -> tuple[list[RuleSftExample], list[PreferencePair], dict[str, int]]:
    """Rule-SFT examples + preference pairs over every world and candidate set."""
    examples: list[RuleSftExample] = []
    pairs: list[PreferencePair] = []
    stats: dict[str, int] = {
        "acceptedRules": 0,
        "rejectedCandidates": 0,
        "corruptionsAttempted": 0,
        "corruptionsKept": 0,
        "corruptionsInert": 0,
        "corruptionsInapplicable": 0,
        "candidatesWithoutWorld": 0,
    }

    # 1. Each world's own shipped rules — accepted by declaration — plus a
    #    deterministic ladder of corruption-sampled negatives per rule.
    for world_id in sorted(worlds):
        world = worlds[world_id]
        for rule in world.rules:
            prompt = build_rule_prompt(
                world,
                rule_name=rule.name,
                intent=world.descriptions.get(rule.name, ""),
            )
            prompt_id = _prompt_id(prompt)
            row = evaluate_rule(rule, world.context)
            base_defects = _defects(row)
            examples.append(
                _sft_example(
                    world,
                    rule_name=rule.name,
                    prompt=prompt,
                    prompt_id=prompt_id,
                    content=rule.content,
                    accepted=True,
                    label_source="declared",
                    corruption="",
                    validator_report="",
                    row=row,
                )
            )
            stats["acceptedRules"] += 1

            kept = 0
            for strategy in CORRUPTIONS:
                if kept >= max_negatives_per_rule:
                    break
                stats["corruptionsAttempted"] += 1
                spoiled = corrupt_rule(rule.content, strategy)
                if spoiled is None:
                    stats["corruptionsInapplicable"] += 1
                    continue
                spoiled_row = evaluate_rule(
                    RuleCandidate(rule.name, spoiled, True), world.context
                )
                new_defects = _defects(spoiled_row) - base_defects
                if not new_defects:
                    # The mistake did not actually make the rule worse — never
                    # emit a negative the validator cannot tell apart.
                    stats["corruptionsInert"] += 1
                    continue
                stats["corruptionsKept"] += 1
                kept += 1
                examples.append(
                    _sft_example(
                        world,
                        rule_name=rule.name,
                        prompt=prompt,
                        prompt_id=prompt_id,
                        content=spoiled,
                        accepted=False,
                        label_source="evaluated",
                        corruption=strategy,
                        validator_report="",
                        row=spoiled_row,
                    )
                )
                pairs.append(
                    PreferencePair(
                        world_id=world.world_id,
                        rule_name=rule.name,
                        prompt_id=prompt_id,
                        prompt=prompt,
                        chosen=rule.content.strip(),
                        rejected=spoiled.strip(),
                        origin="corruption-sampled",
                        corruption=strategy,
                        new_defects=";".join(sorted(new_defects)),
                        tier=SYNTHETIC_TIER,
                        license=INSIMUL_LICENSE,
                        license_class=LICENSE_CLASS,
                        source=INSIMUL_SOURCE,
                    )
                )

    # 2. Producer-supplied candidates — the rejection-sampling exhaust. Grouped by
    #    promptId so an accepted and a rejected answer to the SAME prompt pair up.
    groups: dict[tuple[str, str], list[tuple[_CandidateRecord, RuleSftExample]]] = (
        defaultdict(list)
    )
    for record in candidates:
        world = worlds.get(record.world_id)
        if world is None:
            stats["candidatesWithoutWorld"] += 1
            continue
        prompt = build_rule_prompt(
            world, rule_name=record.name, intent=record.intent
        )
        prompt_id = record.prompt_id or _prompt_id(prompt)
        row = evaluate_rule(
            RuleCandidate(record.name, record.content, True), world.context
        )
        fully_valid = row.parsed and not _defects(row)
        accepted = (
            record.declared_accepted
            if record.declared_accepted is not None
            else fully_valid
        )
        example = _sft_example(
            world,
            rule_name=record.name,
            prompt=prompt,
            prompt_id=prompt_id,
            content=record.content,
            accepted=accepted,
            label_source=(
                "declared" if record.declared_accepted is not None else "evaluated"
            ),
            corruption="",
            validator_report=record.validator_report,
            row=row,
        )
        examples.append(example)
        stats["acceptedRules" if accepted else "rejectedCandidates"] += 1
        groups[(record.world_id, prompt_id)].append((record, example))

    for (world_id, prompt_id) in sorted(groups):
        members = groups[(world_id, prompt_id)]
        chosen = sorted(
            (e for _, e in members if e.accepted), key=lambda e: e.completion
        )
        losers = sorted(
            (e for _, e in members if not e.accepted), key=lambda e: e.completion
        )
        for winner in chosen:
            for loser in losers:
                pairs.append(
                    PreferencePair(
                        world_id=world_id,
                        rule_name=winner.rule_name,
                        prompt_id=prompt_id,
                        prompt=winner.prompt,
                        chosen=winner.completion,
                        rejected=loser.completion,
                        origin="rejection-sampled",
                        corruption="",
                        new_defects=";".join(
                            sorted(
                                set(filter(None, loser.defects.split(";")))
                                - set(filter(None, winner.defects.split(";")))
                            )
                        ),
                        tier=SYNTHETIC_TIER,
                        license=INSIMUL_LICENSE,
                        license_class=LICENSE_CLASS,
                        source=INSIMUL_SOURCE,
                    )
                )

    examples.sort(key=lambda e: e._sort_key())
    pairs.sort(key=lambda p: p._sort_key())
    return examples, pairs, stats


# --- the synthetic world graph -------------------------------------------------


def _character_name(character: Mapping[str, Any]) -> str:
    parts = [
        _text(character.get(key))
        for key in ("firstName", "middleName", "lastName", "suffix")
    ]
    return " ".join(p for p in parts if p) or _text(character.get("id"))


def _lot_addresses(export: Mapping[str, Any]) -> dict[str, str]:
    addresses: dict[str, str] = {}
    for settlement in _collection(export, "geography", "settlements"):
        lots = settlement.get("lots")
        if not isinstance(lots, list):
            continue
        for lot in lots:
            if isinstance(lot, Mapping):
                lot_id, address = _text(lot.get("id")), _text(lot.get("address"))
                if lot_id and address:
                    addresses[lot_id] = address
    return addresses


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _world_nodes(world: World) -> dict[str, NodeInfo]:
    """``csid → NodeInfo`` for every node the Bridge-2 adapter mints.

    Names follow the adapter exactly (a building falls back to its lot address
    then its spec type; a truth uses its title) so the graph keys and labels
    match the ones a converted world carries in the canonical corpus.
    """
    export = world.export
    world_id = world.world_id
    source_url = f"{INSIMUL_SOURCE}:world:{world_id}"
    source_query = ";".join(
        part
        for part in (
            f"seed={world.seed}",
            f"contractVersion={world.contract_version}",
            (
                f"predicateSchemaHash={_text(export.get('predicateSchemaHash'))}"
                if _text(export.get("predicateSchemaHash"))
                else ""
            ),
        )
        if part
    )

    def node(node_type: str, entity_id: str, name: str, *,
             start: int | None = None, end: int | None = None) -> NodeInfo:
        return NodeInfo(
            csid=world_csid(node_type, world_id, entity_id),
            name=name,
            time_start=start,
            time_end=end,
            lat=None,
            lon=None,
            source=INSIMUL_SOURCE,
            source_url=source_url,
            source_query=source_query,
            license=INSIMUL_LICENSE,
        )

    nodes: dict[str, NodeInfo] = {}
    for character in _collection(export, "entities", "characters"):
        entity_id = _text(character.get("id"))
        if entity_id:
            info = node(
                _NODE_TYPE_CHARACTER,
                entity_id,
                _character_name(character),
                start=_int_or_none(character.get("birthYear")),
            )
            nodes[info.csid] = info
    addresses = _lot_addresses(export)
    for building in _collection(export, "entities", "buildings"):
        entity_id = _text(building.get("id"))
        if not entity_id:
            continue
        spec = building.get("spec")
        building_type = (
            _text(spec.get("buildingType")) if isinstance(spec, Mapping) else ""
        )
        name = addresses.get(_text(building.get("lotId")), "") or building_type
        info = node(_NODE_TYPE_BUILDING, entity_id, name or entity_id)
        nodes[info.csid] = info
    for business in _collection(export, "entities", "businesses"):
        entity_id = _text(business.get("id"))
        if entity_id:
            info = node(
                _NODE_TYPE_BUSINESS,
                entity_id,
                _text(business.get("name")) or entity_id,
                start=_int_or_none(business.get("foundedYear")),
            )
            nodes[info.csid] = info
    for settlement in _collection(export, "geography", "settlements"):
        entity_id = _text(settlement.get("id"))
        if entity_id:
            info = node(
                _NODE_TYPE_PLACE,
                entity_id,
                _text(settlement.get("name")) or entity_id,
                start=_int_or_none(settlement.get("foundedYear")),
            )
            nodes[info.csid] = info
    for truth in _collection(export, "systems", "truths"):
        entity_id = _text(truth.get("id"))
        if entity_id:
            year = _int_or_none(truth.get("timeYear"))
            info = node(
                _NODE_TYPE_TRUTH,
                entity_id,
                _text(truth.get("title")) or entity_id,
                start=year,
                end=year,
            )
            nodes[info.csid] = info
    return nodes


def _ids(export: Mapping[str, Any], *path: str) -> set[str]:
    return {
        _text(item.get("id")) for item in _collection(export, *path) if item.get("id")
    }


def _id_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_text(item) for item in value if _text(item)]


def _world_edge_pairs(world: World) -> list[tuple[str, str, str]]:
    """``(head_csid, :TYPE, tail_csid)`` triples, mirroring ``insimul.world_edges``.

    Both stored directions of every relationship are read and deduplicated —
    Insimul persists ``childIds`` *and* ``parentIds``, a building's
    ``occupantIds`` *and* a character's ``homeResidenceId`` — because the
    canonical graph holds one edge per fact, not one per stored direction.
    ``SPOUSE_OF`` is symmetric, so its endpoints are sorted.
    """
    export = world.export
    wid = world.world_id
    characters = _ids(export, "entities", "characters")
    buildings = _ids(export, "entities", "buildings")
    businesses = _ids(export, "entities", "businesses")
    settlements = _ids(export, "geography", "settlements")
    truths = _ids(export, "systems", "truths")

    def cid(node_type: str, entity_id: str) -> str:
        return world_csid(node_type, wid, entity_id)

    groups: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for character in _collection(export, "entities", "characters"):
        entity_id = _text(character.get("id"))
        if entity_id not in characters:
            continue
        for child_id in _id_list(character.get("childIds")):
            if child_id in characters:
                groups["PARENT_OF"].add(
                    (cid(_NODE_TYPE_CHARACTER, entity_id),
                     cid(_NODE_TYPE_CHARACTER, child_id))
                )
        for parent_id in _id_list(character.get("parentIds")):
            if parent_id in characters:
                groups["PARENT_OF"].add(
                    (cid(_NODE_TYPE_CHARACTER, parent_id),
                     cid(_NODE_TYPE_CHARACTER, entity_id))
                )
        spouse_id = _text(character.get("spouseId"))
        if spouse_id in characters:
            ends = sorted(
                (cid(_NODE_TYPE_CHARACTER, entity_id),
                 cid(_NODE_TYPE_CHARACTER, spouse_id))
            )
            groups["SPOUSE_OF"].add((ends[0], ends[1]))
        home_id = _text(character.get("homeResidenceId"))
        if home_id in buildings:
            groups["RESIDES_IN"].add(
                (cid(_NODE_TYPE_CHARACTER, entity_id),
                 cid(_NODE_TYPE_BUILDING, home_id))
            )
    for business in _collection(export, "entities", "businesses"):
        business_id = _text(business.get("id"))
        if business_id not in businesses:
            continue
        for key in ("ownerId", "founderId"):
            person_id = _text(business.get(key))
            if person_id in characters:
                groups["EMPLOYED_BY"].add(
                    (cid(_NODE_TYPE_CHARACTER, person_id),
                     cid(_NODE_TYPE_BUSINESS, business_id))
                )
        settlement_id = _text(business.get("settlementId"))
        if settlement_id in settlements:
            groups["LOCATED_IN"].add(
                (cid(_NODE_TYPE_BUSINESS, business_id),
                 cid(_NODE_TYPE_PLACE, settlement_id))
            )
    for building in _collection(export, "entities", "buildings"):
        building_id = _text(building.get("id"))
        if building_id not in buildings:
            continue
        for occupant_id in _id_list(building.get("occupantIds")):
            if occupant_id in characters:
                groups["RESIDES_IN"].add(
                    (cid(_NODE_TYPE_CHARACTER, occupant_id),
                     cid(_NODE_TYPE_BUILDING, building_id))
                )
        settlement_id = _text(building.get("settlementId"))
        if settlement_id in settlements:
            groups["LOCATED_IN"].add(
                (cid(_NODE_TYPE_BUILDING, building_id),
                 cid(_NODE_TYPE_PLACE, settlement_id))
            )
    for truth in _collection(export, "systems", "truths"):
        entity_id = _text(truth.get("id"))
        if entity_id not in truths:
            continue
        for cause_id in _id_list(truth.get("causedByTruthIds")):
            if cause_id in truths:
                groups["CAUSED_BY"].add(
                    (cid(_NODE_TYPE_TRUTH, entity_id),
                     cid(_NODE_TYPE_TRUTH, cause_id))
                )
        for effect_id in _id_list(truth.get("causesTruthIds")):
            if effect_id in truths:
                groups["CAUSED_BY"].add(
                    (cid(_NODE_TYPE_TRUTH, effect_id),
                     cid(_NODE_TYPE_TRUTH, entity_id))
                )

    return [
        (start, edge_type, end)
        for edge_type in sorted(groups)
        for start, end in sorted(groups[edge_type])
    ]


def build_world_graph(world: World) -> Graph:
    """Project a converted world into a :class:`~pinakes_ml.kgqa.Graph`.

    The same nodes and edges the Bridge-2 acquisition adapter would land in the
    canonical corpus (csids included), assembled in memory so the QA generator
    runs on a world export without a DVC corpus round-trip.
    """
    nodes = _world_nodes(world)
    edge_index: dict[tuple[str, str, str], EvidenceEdge] = {}
    for head, relation, tail in _world_edge_pairs(world):
        head_info, tail_info = nodes.get(head), nodes.get(tail)
        if head_info is None or tail_info is None:
            continue
        edge_index[(head, relation, tail)] = EvidenceEdge(
            head=head,
            head_name=head_info.name,
            relation=relation,
            tail=tail,
            tail_name=tail_info.name,
            source=head_info.source,
            source_url=head_info.source_url,
            license=head_info.license,
        )
    adjacency: dict[str, list[tuple[str, str]]] = defaultdict(list)
    rel_out: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for (head, relation, tail) in sorted(edge_index):
        adjacency[head].append((relation, tail))
        rel_out[relation][head].append(tail)
    return Graph(
        nodes=nodes, edge_index=edge_index, adjacency=adjacency, rel_out=rel_out
    )


# --- rule derivations ----------------------------------------------------------

#: World fields projected into ground Prolog facts alongside the export's own
#: ``prologKb``. Each entry is ``(collection path, predicate, field)`` and emits
#: ``predicate(<entityId>, <sanitized value>)``.
_PROJECTED_FIELDS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("entities", "characters"), "gender", "gender"),
    (("entities", "characters"), "first_name", "firstName"),
    (("entities", "characters"), "last_name", "lastName"),
    (("entities", "characters"), "occupation", "occupation"),
    (("entities", "characters"), "status", "status"),
    (("geography", "settlements"), "settlement_terrain", "terrain"),
    (("geography", "settlements"), "settlement_type", "settlementType"),
    (("entities", "businesses"), "business_type", "businessType"),
)

Fact = tuple[str, tuple[str, ...]]


def world_facts(world: World) -> list[Fact]:
    """The world's ground fact base: its ``prologKb`` facts + projected WorldIR.

    The export's ``prologKb`` bodyless clauses are the character-creation layer
    (the same source :func:`rule_adherence.build_world_context` reads for the
    intrinsic vocabulary). WorldIR fields that a rule body plausibly names but
    the KB does not spell out — a character's gender/surname/occupation, a
    settlement's terrain, the residence and ownership joins — are projected here
    so a rule can actually be *derived*, not merely parsed. Values are lowered
    with :func:`rule_adherence.sanitize_atom`, the same folding the entity roster
    uses, so ``"Bernard"`` and ``bernard`` are one atom.
    """
    export = world.export
    facts: set[Fact] = set()
    kb = export.get("prologKb")
    if isinstance(kb, str) and kb.strip():
        try:
            for clause in parse_prolog_source(kb):
                if clause.goals:
                    continue  # a rule, not a fact
                goal = parse_goal(clause.head)
                if goal.name and not goal.is_comparison:
                    facts.add((goal.name, tuple(a.strip() for a in goal.args)))
        except ParseError:
            pass  # an unparseable KB simply contributes no derivations

    for path, predicate, source_field in _PROJECTED_FIELDS:
        for entity in _collection(export, *path):
            entity_id = _text(entity.get("id"))
            value = _text(entity.get(source_field))
            if entity_id and value:
                facts.add((predicate, (entity_id, sanitize_atom(value))))

    for character in _collection(export, "entities", "characters"):
        entity_id = _text(character.get("id"))
        if not entity_id:
            continue
        facts.add(("person", (entity_id,)))
        for child_id in _id_list(character.get("childIds")):
            facts.add(("parent_of", (entity_id, child_id)))
        for parent_id in _id_list(character.get("parentIds")):
            facts.add(("parent_of", (parent_id, entity_id)))
        spouse_id = _text(character.get("spouseId"))
        if spouse_id:
            facts.add(("married_to", (entity_id, spouse_id)))
        home_id = _text(character.get("homeResidenceId"))
        if home_id:
            facts.add(("residence_resident", (home_id, entity_id)))
    for building in _collection(export, "entities", "buildings"):
        building_id = _text(building.get("id"))
        settlement_id = _text(building.get("settlementId"))
        if building_id and settlement_id:
            facts.add(("lot_of_settlement", (building_id, settlement_id)))
        for occupant_id in _id_list(building.get("occupantIds")):
            if building_id:
                facts.add(("residence_resident", (building_id, occupant_id)))
    for business in _collection(export, "entities", "businesses"):
        business_id = _text(business.get("id"))
        owner_id = _text(business.get("ownerId"))
        if business_id and owner_id:
            facts.add(("business_owner", (business_id, owner_id)))
        settlement_id = _text(business.get("settlementId"))
        if business_id and settlement_id:
            facts.add(("business_of_settlement", (business_id, settlement_id)))
    return sorted(facts)


def _bind(token: str, bindings: Mapping[str, str]) -> str:
    return bindings.get(token, token)


def _solve(
    goals: Sequence[Any],
    index: int,
    facts_by_key: Mapping[tuple[str, int], list[Fact]],
    bindings: dict[str, str],
) -> Iterator[dict[str, str]]:
    """Depth-first conjunctive resolution over a ground fact base.

    Deliberately minimal: no negation, no arithmetic, no recursion into other
    rules — a world rule's body is a flat conjunction of world-state goals, and
    the derivation only has to be *witnessed*, not proved complete. Goals we
    cannot decide (comparisons, cuts, negations) abort the derivation rather than
    being assumed true, so a QA is never grounded in a premise we did not check.
    """
    if index >= len(goals):
        yield dict(bindings)
        return
    goal = goals[index]
    if goal.is_comparison or goal.negated or not goal.name:
        return
    for _, args in facts_by_key.get((goal.name, goal.arity), ()):
        trial = dict(bindings)
        for slot, token in enumerate(goal.args):
            token = token.strip()
            value = args[slot]
            if token == "_":
                continue
            if _VARIABLE_RE.match(token):
                if trial.setdefault(token, value) != value:
                    break
            elif token != value:
                break
        else:
            yield from _solve(goals, index + 1, facts_by_key, trial)


def _premise_edge(
    goal: Any,
    bindings: Mapping[str, str],
    entity_csid: Mapping[str, str],
    world_id: str,
) -> EvidenceEdge:
    """One ground premise rendered as structured evidence.

    A premise is a ground *goal*, not necessarily a corpus edge: an entity-valued
    argument resolves to its csid, a value atom (``male``, ``bernard``) rides as
    itself, and a unary goal leaves the tail empty.
    """
    slots = [_bind(arg.strip(), bindings) for arg in goal.args]
    head_atom = slots[0]
    tail_atom = slots[1] if len(slots) > 1 else ""
    return EvidenceEdge(
        head=entity_csid.get(head_atom, head_atom),
        head_name=head_atom,
        relation=goal.name.upper(),
        tail=entity_csid.get(tail_atom, tail_atom),
        tail_name=tail_atom,
        source=INSIMUL_SOURCE,
        source_url=f"{INSIMUL_SOURCE}:world:{world_id}",
        license=INSIMUL_LICENSE,
    )


def _render_ground(goal: Any, bindings: Mapping[str, str]) -> str:
    args = ", ".join(_bind(a.strip(), bindings) for a in goal.args)
    return f"{goal.name}({args})" if goal.args else goal.name


def rule_derivation_examples(
    world: World, graph: Graph
) -> tuple[list[QAExample], dict[str, int]]:
    """QA whose reasoning target is one of the world's own rule derivations.

    For each active world rule, the body is resolved against the world fact base
    (:func:`world_facts`); the first binding in deterministic order becomes the
    derivation. The question states the rule and its *ground* premises and asks
    for the value the head assigns — so the answer is reachable only by applying
    the rule. ``evidence`` carries the ground premises as
    :class:`~pinakes_ml.kgqa.EvidenceEdge` rows (relation = the premise's
    predicate, upper-cased): these are ground **goals**, not necessarily corpus
    edges, which is what makes a rule derivation distinguishable from a path.
    """
    facts_by_key: dict[tuple[str, int], list[Fact]] = defaultdict(list)
    for name, args in world_facts(world):
        facts_by_key[(name, len(args))].append((name, args))

    nodes = graph.nodes
    entity_csid: dict[str, str] = {}
    for csid in nodes:
        entity_csid.setdefault(csid.rsplit(":", 1)[-1], csid)

    examples: list[QAExample] = []
    unbound = 0
    underivable = 0
    for rule in world.rules:
        try:
            clauses = parse_prolog_source(rule.content)
        except ParseError:
            underivable += 1
            continue
        clause = next((c for c in clauses if c.goals), None)
        if clause is None:
            underivable += 1
            continue
        head = parse_goal(clause.head)
        if not head.args:
            unbound += 1
            continue
        answer_slot = head.args[-1].strip()
        if not _VARIABLE_RE.match(answer_slot) or answer_slot == "_":
            unbound += 1
            continue
        solution = next(_solve(clause.goals, 0, facts_by_key, {}), None)
        if solution is None or answer_slot not in solution:
            underivable += 1
            continue

        premises = [_render_ground(g, solution) for g in clause.goals]
        answer = solution[answer_slot]
        subject_token = next(
            (
                solution[a.strip()]
                for a in head.args
                if _VARIABLE_RE.match(a.strip())
                and a.strip() in solution
                and solution[a.strip()] in entity_csid
            ),
            "",
        )
        subject = entity_csid.get(subject_token, "")
        if not subject:
            underivable += 1
            continue
        evidence = [
            _premise_edge(g, solution, entity_csid, world.world_id)
            for g in clause.goals
            if g.args
        ]
        question = DERIVATION_TEMPLATE.format(
            world=world.name,
            rule=rule.name,
            content=rule.content.strip(),
            premises=", ".join(premises),
            question_var=f"the value bound to {answer_slot}",
        )
        examples.append(
            QAExample(
                question=question,
                answer=answer,
                kind="rule_derivation",
                reasoning_type="rule_derivation",
                hops=len(clause.goals),
                subject=subject,
                subject_name=nodes[subject].name,
                answer_id=entity_csid.get(answer, ""),
                relation_path=">".join(
                    g.name.upper() for g in clause.goals if g.name
                ),
                evidence=json.dumps(
                    [e.as_dict() for e in evidence],
                    sort_keys=True,
                    ensure_ascii=False,
                ),
                template_id=f"rule_derivation.{rule.name}",
                source=INSIMUL_SOURCE,
                source_url=f"{INSIMUL_SOURCE}:world:{world.world_id}",
                license=INSIMUL_LICENSE,
            )
        )
    return examples, {
        "rulesWithUnboundHead": unbound,
        "rulesWithoutDerivation": underivable,
    }


# --- lore QA + the per-world split ---------------------------------------------


def build_lore_qa(
    worlds: Mapping[str, World]
) -> tuple[list[tuple[str, QAExample]], dict[str, int]]:
    """``(worldId, example)`` pairs across every world, plus candidate stats."""
    tagged: list[tuple[str, QAExample]] = []
    stats: dict[str, int] = {
        "pathCandidates": 0,
        "ruleDerivationCandidates": 0,
        "ambiguousFinalHop": 0,
        "rulesWithUnboundHead": 0,
        "rulesWithoutDerivation": 0,
    }
    for world_id in sorted(worlds):
        world = worlds[world_id]
        graph = build_world_graph(world)
        paths, path_stats = path_examples(
            graph, statements=REL_STATEMENT, questions=REL_QUESTION
        )
        derivations, deriv_stats = rule_derivation_examples(world, graph)
        stats["pathCandidates"] += len(paths)
        stats["ruleDerivationCandidates"] += len(derivations)
        for key, value in {**path_stats, **deriv_stats}.items():
            stats[key] = stats.get(key, 0) + value
        tagged.extend((world_id, example) for example in paths + derivations)
    tagged.sort(key=lambda item: (item[0], item[1]._sort_key()))
    return tagged, stats


@dataclass
class WorldSplits:
    """A whole-world train / held-out-eval partition of the lore QA."""

    train: list[tuple[str, QAExample]]
    eval: list[tuple[str, QAExample]]
    held_out_worlds: tuple[str, ...]

    def items(self) -> list[tuple[str, list[tuple[str, QAExample]]]]:
        return [("train", self.train), ("eval", self.eval)]


def split_by_world(
    tagged: Sequence[tuple[str, QAExample]],
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
) -> WorldSplits:
    """Reserve whole worlds as the held-out eval split.

    Grouping is per *world*, not per subject entity: a world is a closed KB with
    its own rule set, so an entity-level split would leak a world's vocabulary
    and rules into training and make the tier-4 adherence + tier-3 KGQA scores on
    it meaningless. Worlds are sorted, seeded-shuffled and greedily drawn until
    the eval example target is met; with two or more worlds at least one is
    always held out, so the eval tiers never score on a world they trained on.
    """
    groups: dict[str, list[tuple[str, QAExample]]] = defaultdict(list)
    for world_id, example in tagged:
        groups[world_id].append((world_id, example))
    keys = sorted(groups)
    random.Random(seed).shuffle(keys)

    target = round(eval_ratio * len(tagged))
    train: list[tuple[str, QAExample]] = []
    held: list[tuple[str, QAExample]] = []
    held_worlds: list[str] = []
    for position, key in enumerate(keys):
        must_hold = len(keys) > 1 and position == 0
        if must_hold or len(held) < target:
            held.extend(groups[key])
            held_worlds.append(key)
        else:
            train.extend(groups[key])
    train.sort(key=lambda item: (item[0], item[1]._sort_key()))
    held.sort(key=lambda item: (item[0], item[1]._sort_key()))
    return WorldSplits(
        train=train, eval=held, held_out_worlds=tuple(sorted(held_worlds))
    )


# --- serialization + manifest ---------------------------------------------------


def serialize_examples(examples: Iterable[Any]) -> str:
    """Exact JSONL body for any record type exposing ``as_json_line``."""
    lines = [e.as_json_line() for e in examples]
    return "\n".join(lines) + "\n" if lines else ""


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _counter(values: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


@dataclass
class Datasets:
    """The three built datasets plus the stats behind them."""

    worlds: dict[str, World]
    sft: list[RuleSftExample]
    preferences: list[PreferencePair]
    qa: list[tuple[str, QAExample]]
    splits: WorldSplits
    rule_stats: dict[str, int]
    qa_stats: dict[str, int]

    @property
    def qa_examples(self) -> list[QAExample]:
        return [example for _, example in self.qa]


def build_datasets(
    world_paths: Sequence[Path | str],
    candidate_paths: Sequence[Path | str] = (),
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
    max_negatives_per_rule: int = MAX_NEGATIVES_PER_RULE,
) -> Datasets:
    """Pure build over world exports + optional candidate exports."""
    worlds: dict[str, World] = {}
    for path in world_paths:
        world = load_world(path)
        worlds[world.world_id] = world
    candidates: list[_CandidateRecord] = []
    for path in candidate_paths:
        candidates.extend(load_candidate_records(path))
    if len(worlds) == 1:
        # A lone world's id is the default owner of an unlabelled candidate set.
        only = next(iter(worlds))
        candidates = [
            c if c.world_id else _CandidateRecord(**{**asdict(c), "world_id": only})
            for c in candidates
        ]

    sft, preferences, rule_stats = _build_rule_dataset(
        worlds, candidates, max_negatives_per_rule=max_negatives_per_rule
    )
    qa, qa_stats = build_lore_qa(worlds)
    splits = split_by_world(qa, seed=seed, eval_ratio=eval_ratio)
    return Datasets(
        worlds=worlds,
        sft=sft,
        preferences=preferences,
        qa=qa,
        splits=splits,
        rule_stats=rule_stats,
        qa_stats=qa_stats,
    )


def build_manifest(
    datasets: Datasets,
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
    smoke: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """The deterministic, committable manifest.

    No wall-clock — a pure function of the world exports + candidate sets + seed,
    so a rebuild is a git no-op and the snapshot test is a real gate. It carries
    the ``synthetic`` tier and the ``proprietary`` license class on its face: a
    reader that finds those must keep the datasets out of any open-data release.
    """
    qa = datasets.qa_examples
    manifest: dict[str, Any] = {
        "datasetVersion": DATASET_VERSION,
        "analyzerVersion": ANALYZER_VERSION,
        "seed": seed,
        "evalRatio": eval_ratio,
        "tier": SYNTHETIC_TIER,
        "license": INSIMUL_LICENSE,
        "licenseClass": LICENSE_CLASS,
        "source": INSIMUL_SOURCE,
        "worlds": [
            datasets.worlds[world_id].as_dict()
            for world_id in sorted(datasets.worlds)
        ],
        "heldOutWorlds": list(datasets.splits.held_out_worlds),
        "files": {
            RULE_SFT_FILE: {
                "count": len(datasets.sft),
                "sha256": _sha256(serialize_examples(datasets.sft)),
            },
            RULE_PREFERENCE_FILE: {
                "count": len(datasets.preferences),
                "sha256": _sha256(serialize_examples(datasets.preferences)),
            },
            LORE_QA_FILE: {
                "count": len(qa),
                "sha256": _sha256(serialize_examples(qa)),
            },
        },
        "ruleSft": {
            "kindCounts": _counter(e.kind for e in datasets.sft),
            "labelSourceCounts": _counter(e.label_source for e in datasets.sft),
            "corruptionCounts": _counter(
                e.corruption for e in datasets.sft if e.corruption
            ),
            "worldCounts": _counter(e.world_id for e in datasets.sft),
            "fullyValid": sum(1 for e in datasets.sft if e.fully_valid),
            "candidateStats": dict(sorted(datasets.rule_stats.items())),
        },
        "preferences": {
            "originCounts": _counter(p.origin for p in datasets.preferences),
            "worldCounts": _counter(p.world_id for p in datasets.preferences),
        },
        "loreQa": {
            "kindCounts": _counter(e.kind for e in qa),
            "reasoningTypeCounts": _counter(e.reasoning_type for e in qa),
            "relationPathCounts": _counter(e.relation_path for e in qa),
            "hopsHistogram": _counter(str(e.hops) for e in qa),
            "worldCounts": _counter(world_id for world_id, _ in datasets.qa),
            "candidateStats": dict(sorted(datasets.qa_stats.items())),
            "splits": {
                name: {
                    "examples": len(part),
                    "worlds": sorted({world_id for world_id, _ in part}),
                    "sha256": _sha256(
                        serialize_examples(example for _, example in part)
                    ),
                }
                for name, part in datasets.splits.items()
            },
        },
        "licenseCounts": _counter(
            [e.license for e in datasets.sft]
            + [p.license for p in datasets.preferences]
            + [e.license for e in qa]
        ),
    }
    if smoke is not None:
        manifest["smoke"] = dict(smoke)
    return manifest


# --- end-to-end smoke -----------------------------------------------------------


def mock_model_outputs(
    examples: Sequence[RuleSftExample], *, corrupt_every: int = 2
) -> list[RuleCandidate]:
    """A deterministic stand-in for a fine-tuned rule-authoring model.

    Answers each accepted prompt with the reference completion, except every
    *corrupt_every*-th, which it answers with a corruption — so the adherence
    tier sees a realistic mix of valid and invalid generations without a model,
    a network or a seed. The same "deterministic fake system" seam
    :func:`kgqa_eval.evaluate_systems` uses for the tier-3 before/after harness.
    """
    accepted = [e for e in examples if e.accepted]
    out: list[RuleCandidate] = []
    for index, example in enumerate(accepted):
        content = example.completion
        if corrupt_every > 0 and index % corrupt_every == corrupt_every - 1:
            strategy = CORRUPTIONS[index % len(CORRUPTIONS)]
            content = corrupt_rule(example.completion, strategy) or content
        out.append(RuleCandidate(f"{example.rule_name}__gen{index:03d}", content, True))
    return out


def run_smoke(
    datasets: Datasets, *, corrupt_every: int = 2
) -> dict[str, Any]:
    """Generate → mock-generate → score: the tier-4 loop over a held-out world.

    Takes the first held-out world (the split the eval tiers are reserved for),
    replays its rule-SFT prompts through :func:`mock_model_outputs`, and scores
    the results with the US-004 rule-adherence tier. Returns a deterministic,
    committable summary — the CLI logs it to MLflow.
    """
    held = datasets.splits.held_out_worlds
    world_id = held[0] if held else next(iter(sorted(datasets.worlds)))
    world = datasets.worlds[world_id]
    prompts = [e for e in datasets.sft if e.world_id == world_id]
    generations = mock_model_outputs(prompts, corrupt_every=corrupt_every)
    rows = [evaluate_rule(c, world.context) for c in generations]
    parsed = [r for r in rows if r.parsed]
    fully_valid = sum(1 for r in parsed if not _defects(r))
    total = len(rows) or 1
    return {
        "worldId": world_id,
        "sftRecords": len(prompts),
        "generations": len(rows),
        "parsed": len(parsed),
        "fullyValid": fully_valid,
        "parseRate": round(len(parsed) / total, 6),
        "fullyValidRate": round(fully_valid / total, 6),
        "meanReachabilityCharitable": round(
            sum(r.reachability_charitable for r in parsed) / (len(parsed) or 1), 6
        ),
        "defectCounts": _counter(
            defect for r in rows for defect in sorted(_defects(r))
        ),
    }
