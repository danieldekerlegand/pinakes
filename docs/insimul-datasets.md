# Insimul SLM datasets — rule-SFT + lore-consistency QA

> **DVC was removed** (flatten Phase 0). Every `dvc pull` / `dvc add` /
> `dvc push` below is stale: those trees are plain git-ignored build outputs
> now — regenerate them instead, and skip any "re-pin" step. Recorded DVC
> md5s are historical provenance labels, not fetchable references.
> Rationale + how to re-enable versioning: `docs/artifact-versioning.md`.

**insimul-bridge US-005.** The training feed of the Insimul bridge: converted
worlds (the Bridge-2 `CanonicalWorldExport` artifacts US-003 ingests) become
three SLM datasets — rule-authoring SFT, rule-authoring preference pairs, and
multi-hop lore-consistency QA — plus a per-world held-out split the eval tiers
score on.

- Implementation: [`ml/src/pinakes_ml/insimul_datasets.py`](../ml/src/pinakes_ml/insimul_datasets.py) (pure, stdlib-only)
- CLI: `cd ml && uv run pinakes-export-insimul` (`--check` is the manifest ratchet)
- Manifest: [`ml/manifests/insimul-datasets-manifest.json`](../ml/manifests/insimul-datasets-manifest.json)
- Data (DVC-tracked, git-ignored, **never committed**): `ml/data/insimul/`
- Fixtures: `ml/fixtures/insimul/{world-export,rule-candidates.jsonl,bridge-graph}.json`
  plus the Bridge-2 world at `engine/tests/fixtures/insimul/world-export.json`

The Insimul bridge spec §5.1 is the spec: *"Rule-authoring SFT — (world context +
vocabulary-grounded instruction → validated Prolog rule). Scale via rejection
sampling … accepted rules are SFT data, rejections are preference-pair
negatives. Lore-consistency QA — pinakes's multi-hop KG-grounded QA generator
runs verbatim on converted worlds; rule derivations are the reasoning targets."*

## ⚠️ Containment

**Everything here is `synthetic` tier and proprietary-licensed.** A converted
world is generated content, not observation. Every record and the manifest carry
`tier: "synthetic"`, `license: "LicenseRef-Insimul-Proprietary"` and
`licenseClass: "proprietary"`; the datasets land in the DVC-tracked, git-ignored
`ml/data/insimul/` tree and must never enter an open-data release
(the Insimul bridge spec §7 "License leakage"). The corpus-side gate is
`pinakes_engine.orchestrate.tiers.assert_no_synthetic_records`; the dataset-side
gate is `test_every_record_is_synthetic_tier_and_proprietary`.

## Dataset 1 — rule-authoring SFT (`rule-sft.jsonl`)

One flat record per candidate rule: a **vocabulary-grounded prompt** and a
completion, labelled `accepted` or `rejected`.

The prompt is built from the world context the tier-4 evaluator distils
(`rule_adherence.build_world_context`) and lists three things separately,
because that separation is exactly what reachability scores:

```
World `w-laterre` (La Terre Basse) — an Insimul CanonicalWorldExport on contract insimul-grounding-v1.
Intrinsic predicates (true at world creation): business/1, business_owner/2, married_to/2, parent_of/2, person/1
Action-producible predicates (some action effect can make these true): (none)
Entities you may name: 12_rue_verte, b1, b2, bellevue, biz1, …, s1, … (+6 more)
Write ONE Prolog rule named `child_inherits_surname` capturing: A child takes the father's surname unless overridden.
Use only the predicates and entities listed above; emit a single clause ending in a period.
```

Every list is sorted and budget-capped with an explicit `(+N more)` — never a
silent truncation — so the prompt is a deterministic function of the export.

### How a rule gets its label

| Precedence | Source | `label_source` |
| --- | --- | --- |
| 1 | an Insimul `rules.jsonl` candidate's `accepted` / `status` + `validatorReport` | `declared` |
| 1 | a world export's own active `systems.rules` / `baseRules` (they shipped with the world) | `declared` |
| 2 | anything else — scored by `rule_adherence.evaluate_rule`, accepted iff fully valid | `evaluated` |

**The declaration wins; our evaluator's verdict rides along as a diagnostic**
(`defects`, `fully_valid`, `reachability_charitable`, `fireability_index`), never
as an override. That matters today: Bridge-2 exports carry no `systems.actions`,
so *every* action-derived condition in a converted world's own rules scores dead
(see [`docs/rule-adherence-tier.md`](rule-adherence-tier.md)). Overriding the
label on that basis would throw away the world's ground truth to satisfy a metric
whose floor is a known producer-side gap.

Inactive rules (`isActive: false`) are retired content and are never emitted —
the same governance rule `scallop.py` applies to the Datalog registry.

## Dataset 2 — preference pairs (`rule-preferences.jsonl`)

`(prompt, chosen, rejected)` with the defects the rejected side *adds*. Two
origins:

- **`rejection-sampled`** — a producer export's accepted and rejected answers to
  the **same `promptId`**. This is the real thing the Insimul bridge spec §5.1
  describes; the committed fixture `ml/fixtures/insimul/rule-candidates.jsonl`
  is a hand-authored example of the shape (7 candidates over 3 prompts, each
  with its 4-layer `validatorReport`).
- **`corruption-sampled`** — a world that ships only its accepted rules gets
  synthesized negatives instead: a fixed ladder of authoring mistakes applied to
  each accepted rule.

| Strategy | The defect it plants |
| --- | --- |
| `unknown_predicate` | renames a body predicate to `<name>_unattested` → schema-invalid |
| `dangling_entity` | binds an argument to `nonexistent_entity` → referential failure |
| `literal_actor_atom` | binds an argument to `someone` → structural failure |
| `rule_atom_budget` | renames the rule to a sentence-shaped atom → structural failure |
| `parse_error` | drops a closing parenthesis → parse failure |

**A negative is only kept when the evaluator confirms it introduces a defect the
original did not have.** A corruption that changes nothing measurable is counted
(`corruptionsInert`) and discarded, and a strategy that does not apply is counted
(`corruptionsInapplicable`) rather than faked — the same "verify the negative,
never fake it" discipline as the type-constrained corruption pools in
`queries.py`.

## Dataset 3 — lore-consistency QA (`lore-qa.jsonl`)

The Phase-5a KGQA generator, run over a **synthetic-tier world graph**.
`build_world_graph` projects a world export into the same `kgqa.Graph` the
canonical corpus would hold — the same nodes, names, edges and **csids** the
Bridge-2 adapter mints (`cs:<type>:insimul:<worldId>:<entityId>`) — so the QA is
grounded in the graph a converted world actually lands as, without a DVC corpus
round-trip. That seam is gated: `ml/fixtures/insimul/bridge-graph.json` is
generated *by the pinakes-engine adapter* and the test asserts byte parity.

Two grounding kinds:

- **`path`** — `kgqa.path_examples` with the synthetic relation vocabulary
  (`PARENT_OF`, `SPOUSE_OF`, `EMPLOYED_BY`, `RESIDES_IN`, `LOCATED_IN`,
  `CAUSED_BY`). Same machinery as the open corpus, different phrasings; a
  coverage test requires every v1.3.0 edge type to have both a statement and a
  question template.
- **`rule_derivation`** — the AC's "rule derivations are the reasoning targets".
  Each active world rule's body is resolved against the world's ground fact base
  (`world_facts`: the export's `prologKb` facts plus a projection of WorldIR —
  gender, surname, occupation, terrain, residence and ownership joins). The
  question states the rule and its **ground premises** and asks for the value the
  head assigns, so the answer is reachable only by applying the rule.

The matcher is deliberately minimal — a flat conjunctive walk over ground facts,
no negation, no arithmetic, no recursion into other rules. **Goals it cannot
decide (comparisons, cuts, `\+`) abort the derivation** rather than being assumed
true, so a QA is never grounded in a premise that was not checked. A rule with no
witness is reported (`rulesWithoutDerivation`), not guessed at.

### The per-world held-out split

Grouping is per **world**, not per subject entity. A world is a closed KB with
its own rule set, so an entity-level split would leak a world's vocabulary and
rules into training and make the tier-4 adherence and tier-3 KGQA scores on it
meaningless. Worlds are sorted, seeded-shuffled and greedily drawn until the eval
target is met; **with two or more worlds at least one is always held out**, so
the eval tiers always have a world training never saw. `heldOutWorlds` in the
manifest is the registry of that reservation.

## The end-to-end smoke

`--smoke` (on by default) closes the loop: the **held-out** world's rule-SFT
prompts are replayed through `mock_model_outputs` — a deterministic stand-in for
a fine-tuned model that answers with the reference completion except every
*n*-th, which it corrupts — and the generations are scored by the US-004
rule-adherence tier. The summary lands in the manifest's `smoke` block and in
MLflow (run name `insimul-datasets`).

Today's held-out world is `w-laterre`, which exports no actions, so it scores
`fullyValidRate: 0.0`. **That is an honest floor, not a bug** — the fix belongs
on the Insimul side (emit `systems.actions` with Prolog `content`), and it is
recorded as a producer-side gap in the Insimul bridge spec §5.2.

## Reproducing

```sh
cd ml
uv run pinakes-export-insimul                # rebuild data + manifest + smoke
uv run pinakes-export-insimul --check        # ratchet: no writes, exits 1 on drift
uv run pinakes-export-insimul \
  --world /path/to/world-a.json --world /path/to/world-b.json \
  --candidates /path/to/rules.jsonl          # real converted worlds
```

The defaults build from the committed fixtures, so the committed manifest needs
no DVC corpus and the snapshot test is a real CI gate. After building real
datasets, re-pin with `uv run --project ml dvc add ml/data && dvc push` and commit
`ml/data.dvc` — but keep a real manifest out of git if it was built on
non-fixture worlds.

Regenerate the Bridge-2 cross-check fixture after any change to the `insimul`
acquisition adapter — the command is in [`ml/CLAUDE.md`](../ml/CLAUDE.md).
