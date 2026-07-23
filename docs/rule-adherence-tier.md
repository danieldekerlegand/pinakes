# Rule-adherence eval tier (tier 4) — the VESPACE port

**insimul-bridge US-004.** The fourth tier of the `ml/` eval harness scores
**generated Prolog rules against the world they were authored for**: can this
rule ever fire, given the world's character-creation layer and its action set?

- Implementation: [`ml/src/pinakes_ml/rule_adherence.py`](../ml/src/pinakes_ml/rule_adherence.py) (pure, stdlib-only)
- CLI: `cd ml && uv run pinakes-eval-rule-adherence` (`--check` is the ratchet gate)
- Baseline: [`ml/manifests/rule-adherence-baseline.json`](../ml/manifests/rule-adherence-baseline.json)
- Reported in: the `RULE-ADHERENCE`-marked section of [`docs/ml-baselines.md`](ml-baselines.md)

The other tiers: link-prediction metrics (tier 1), logical consistency (tier 2),
KGQA accuracy (tier 3) — all in `docs/ml-baselines.md` — plus the
cinematography-adherence tier (Bridge 3, `ml/manifests/cinematography-adherence-baseline.json`),
this tier's sibling on the Analyzer side.

## Provenance — what is ported, and from where

Insimul's VESPACE harness (`insimul-server/server/__tests__/vespace-rule-generation-e2e/`,
written up in `docs/editor/evaluation/VESPACE_TRANSLATION_VALIDATION_METHODOLOGY.md`
and the two `vespace-validation-*/findings.md` reports) measures LLM-authored
Insimul Prolog on exactly these axes. `INSIMUL_SYNC_PLAN.md` §"Evaluation" calls
for porting it here as a fourth tier.

**No Insimul code is imported.** `rule_adherence.py` is stdlib-only and
self-contained, the same discipline as `consistency.py` (tier 2) and
`cinematography_eval.py` (the Analyzer adherence tier, whose constraint vocabulary
is vendored as data). What crosses the boundary is the *metric definitions*,
reimplemented here and cited below so a reader can check the port against the
source. The upstream modules, at the time of the port:

| Upstream module | What was reimplemented |
| --- | --- |
| `insimul-prolog-parser.ts` | comment stripping, clause splitting, top-level conjunction splitting, goal name/arity classification |
| `prolog-rule-validator.ts` | the five structural checks + their constants |
| `insimul-vocabulary.ts` | predicate-key shape (`name/arity`, `family:type`), effect-term → produced-key extraction, intrinsic/producible/dead classification |
| `reachability-analyzer.ts` | the per-rule reachability scores, the fireability formula and its λ defaults, and the corpus aggregate (stats, histogram, dead-key tally) |
| `insimul-reachability-analyzer.ts` | the Prolog-path scorer: which goals count as conditions, and the `attribute:Type` special case |
| `shared/referential-integrity-validator.ts` | entity-reference detection over predicate arguments |

## The world context

The upstream harness builds two artifacts before scoring — an **intrinsic
registry** (predicates presumed set at character creation, always producible)
and a **producibility index** (predicates some action effect can make true). Both
are derived here from a **`CanonicalWorldExport`** — the bridge-2 artifact
US-003 already ingests — rather than from the VESPACE corpus:

- **Intrinsic keys** = every *fact* (bodyless clause) in the export's `prologKb`.
  Upstream seeds this from the corpus's trait / profession / clothing / attribute
  conditions, on the charitable assumption that any trait naming a rule "could
  have been authored onto some character". A world export carries the same
  information more directly: its KB's ground facts *are* the state that exists
  before any action runs. `attribute(C, Type, V)` facts additionally register
  `attribute:Type`.
- **Producible keys** = the effect terms in each action's Prolog `content` —
  the bodies of its `action_accept/3`, `action_reject/3` and `action_outcome/3`
  clauses — lowered through the upstream `effectTermToProducedKeys` table
  (`modify_network(_, _, Dim, _, _)` → `Dim/3`, `add_status(_, T)` → `T/1`,
  `modify_attribute(_, Type, _, _)` → `attribute:Type`, …).
- **Entity atoms** = ids + `sanitize_atom`ed names of characters, buildings,
  businesses, settlements, lots, quests, items and truths.
- **Value atoms** = the enum-ish fields a world declares (`terrain`,
  `occupation`, `businessType`, `status`, tags, skill names, …). These are *not*
  entity references, so they are excluded from the referential check.

A **predicate key** is `name/arity` for ordinary predicates (`flattered/1`,
`affinity/3`) or `family:type` for parameterised families (`attribute:charisma`,
`social_record:embarrassing_event`) — the parameterised form because the
analyser asks "is *this* attribute producible?", not "is any `attribute/3` clause
producible?".

## The metrics

### Validity rates

| Metric | Definition |
| --- | --- |
| `parse` | rules whose Prolog splits into clauses / all candidate rules. A rule fails on unbalanced delimiters, an unterminated quoted atom, or a fragment with no terminating period. |
| `structuralValidity` | parsed rules with no structural error / parsed rules |
| `schemaValidity` | parsed rules whose every body goal names a key in the world vocabulary / parsed rules — the *predicate-invention* rate, inverted |
| `referentialIntegrity` | parsed rules whose entity-position atoms all resolve / parsed rules |
| `fullyValid` | parsed rules clean on all three / parsed rules |

The five structural checks, with the upstream constants:

| `check_id` | Fires when |
| --- | --- |
| `rule_atom_budget` | the rule handle exceeds 48 chars or 6 underscore-separated words — a sentence, not a handle |
| `literal_actor_atom` | an argument is a source-system actor label (`someone`, `other`, `initiator`, …) rather than a variable; it never unifies, so the body is unreachable |
| `family_prefix_predicate` | a predicate name smashes the family into the atom (`trait_female/1`, `network_affinity/2`) instead of naming the concrete predicate |
| `opaque_effect_payload` | an `effect/2` payload is a sentinel word (`unknown`, `high`, `low`, …) the engine cannot apply as a delta |
| `body_reaches_head` | a `rule_applies/3` body references neither head variable |

`schemaValidity` and `referentialIntegrity` never double-count a structural
mistake: atoms the structural checks own (literal actor labels, opaque payloads)
are skipped by the referential walk, as are all arguments of **engine
predicates** — the wrapper heads (`rule_applies/3`, `rule_effect/4`, …) and
effect terms (`modify_network/5`, `add_status/2`, …), none of whose argument
slots name an entity. Engine predicates are always schema-valid and are excluded
from the condition set: an effect payload is not something a rule has to satisfy.

### Reachability and fireability

For each parsed rule, over its scorable body goals (comparisons like `V > 5` and
unparseable goals are excluded; a negated goal `\+ p(X)` **is** scored — the
predicate must be definable for the negation to mean anything):

```
total_conditions             = scorable goals
intrinsic_conditions         = goals whose key is in the intrinsic registry
action_conditions            = total - intrinsic
action_conditions_producible = action-derived goals some action effect produces
dead_conditions              = action-derived AND not producible

reachability_charitable = (intrinsic + action_producible) / total
reachability_strict     = action_producible / action_conditions   (1.0 when none)
complexity              = total_conditions

fireability_index = reachability_charitable
                    × exp(-intrinsic × λ_i  -  action × λ_a)
```

with the upstream defaults **λ_i = 0.05** and **λ_a = 0.25**: an intrinsic
condition only narrows the actor pool (cheap), while an action-derived condition
demands a runtime action sequence to satisfy (expensive). Differentiating means a
rule with 5 traits + 1 status scores very differently from one with 1 trait + 5
statuses even though both have charitable reachability 1.0 and 6 conditions.

*Charitable* reachability is the headline: "if we are generous about what initial
state could exist, can the action set fill in the rest?". *Strict* isolates the
action-driven slice and exposes rules that rely on statuses/relationships the
action set never produces. All three are in [0, 1]; fireability compresses fast
as the action slice grows.

The aggregate reports mean/median/min/max for each, a charitable-reachability
histogram over the upstream buckets (`[0.00, 0.25)` … `[1.00, 1.00]`), the count
of fully reachable rules, rules with ≥1 dead condition, rules whose action slice
is *entirely* dead, and the dead keys ranked by how many rules each one kills.

## The fixture

`ml/fixtures/insimul/world-export.json` is a small `CanonicalWorldExport` shaped
after the VESPACE salon corpus: three characters, an intrinsic KB
(`female/1`, `noble/1`, `virtuous/1`, `attribute:charisma`, …), and five actions
producing `affinity/3`, `flattered/1`, `ally/2`, `embarrassed/1`, `resents/2`,
`social_record:embarrassing_event` and `attribute:charisma`.

`ml/fixtures/insimul/generated-rules.json` is the candidate rule set — eight
hand-authored rules, one per scored dimension, including the **known-dead**
`married/2`, `trusts/3` and `esteems/3` conditions that validation 2 §3.4 reports
as the residual dead-key set after vocabulary grounding. The committed baseline
is the assertion that they score as expected: those three rules are exactly the
ones with a fully dead action slice.

The tier also runs against real converted worlds. Scoring the bridge-2 fixture
world in place:

```bash
cd ml
W=../core/tests/fixtures/insimul/world-export.json
uv run pinakes-eval-rule-adherence --world "$W" --rules "$W" \
    --baseline /tmp/laterre.json --no-doc --no-mlflow
```

That world exports **no** actions, so its own rules score 0% schema validity —
an honest finding about the export, not a bug in the tier. A `CanonicalWorldExport`
must carry `systems.actions` with Prolog `content` for the producibility index to
mean anything; until Insimul emits it, reachability over converted worlds is a
floor.

## Deliberate deviations from the upstream code

1. **Negated goals keep their closing parenthesis.** Upstream's `parseGoal`
   strips a trailing `)` after removing the `\+` prefix, which mangles
   `\+ flattered(Y)` into an unparseable token — contradicting its own docstring
   ("negated goals are still scored"). The port unwraps only a *redundant* outer
   paren pair, so `\+ p(X)` and `\+(p(X))` both score. Worth reporting upstream.
2. **Structural checks emit stable `check_id`s, not prose.** The upstream error
   strings are retry-prompt copy; a committed baseline wants short stable keys.
3. **The vocabulary is world-derived, not corpus-derived.** Upstream keys the
   intrinsic registry off the VESPACE corpus being analysed; here the world
   export is the single source, so the same evaluator works for any converted
   world without a companion corpus.
4. **One row per rule, not per clause.** A candidate rule's conditions are the
   union of its clauses' body goals, matching the rule-level granularity the
   findings report.
