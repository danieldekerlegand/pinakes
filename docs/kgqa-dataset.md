# Multi-hop KG-grounded QA dataset (KGQA)

> **DVC was removed** (flatten Phase 0). Every `dvc pull` / `dvc add` /
> `dvc push` below is stale: those trees are plain git-ignored build outputs
> now — regenerate them instead, and skip any "re-pin" step. Recorded DVC
> md5s are historical provenance labels, not fetchable references.
> Rationale + how to re-enable versioning: `docs/artifact-versioning.md`.

Neurosymbolic roadmap **Phase 5, US-003**. Chain-of-reasoning question/answer
training data synthesised deterministically from the canonical export
(`export/culturescrape/{nodes,edges}`). Every QA pair is grounded in an explicit
**graph path** or **rule derivation**, and that path/derivation *is* the reference
answer's justification (carried on each example as structured `evidence`).

- **Generator (pure core):** `ml/src/pinakes_ml/kgqa.py`
- **CLI:** `uv run pinakes-export-kgqa` (`ml/src/pinakes_ml/export_kgqa.py`)
- **Committed manifest (the snapshot):** `ml/manifests/kgqa-manifest.json`
- **Data (DVC-tracked, git-ignored):** `ml/data/kgqa/{train,eval}.jsonl` (via `ml/data.dvc`)
- **OPTIONAL Gemini-polish variant:** `ml/src/pinakes_ml/polish_kgqa.py`

The build is a pure function of the export + seed (`DEFAULT_SEED = 20260713`), so a
byte-identical corpus is a git no-op on the manifest. A live snapshot gate
(`test_committed_manifest_matches_live_corpus`) asserts the committed manifest equals
a fresh build of the local canonical corpus; it skips in CI where the DVC export is
absent.

## Grounding kinds

- **`path` — two-hop multi-hop path** (`reasoning_type = multi_hop_path`). A simple
  path `head -r1-> mid -r2-> tail` sampled from the neighbourhood graph (the ML-side
  mirror of a Neo4j `findPath` / neighbourhood expansion). The question states the
  first hop and asks for the second, so the answer can only be reached by following
  the chain. Only paths whose final hop `(mid, r2)` resolves to a **single** tail are
  emitted, so the answer is unambiguous for exact-match evaluation (ambiguous final
  hops are counted in `candidateStats.ambiguousFinalHop` and dropped).
- **`derivation` — ancestor-chain** (`reasoning_type = ancestor_chain`). The transitive
  closure of `DESCENDS_FROM` (the ML-side mirror of the Datalog `ancestor/2` rule the
  materializer emits). For a node whose line of descent is an unambiguous simple path
  to a single root (every step has exactly one parent), the question asks for the
  *ultimate* ancestor; the whole chain is the derivation that justifies it. Only
  genuinely multi-hop chains (`MIN_DERIVATION_HOPS = 2`) are emitted; branching
  (`ambiguousAncestorBranch`) and cyclic (`cyclicDescent`) descents are dropped.

## Record schema (flat, HF-datasets-compatible JSONL)

One record per line, uniform string keys across both kinds so
`datasets.load_dataset("json", …)` infers one feature set:

`question`, `answer`, `kind` (`path`|`derivation`), `reasoning_type`, `hops` (int),
`subject`/`subject_name` (anchor entity csid + name; the split-grouping key),
`answer_id` (answer entity csid), `relation_path` (`>`-joined relations along the
chain), `evidence` (JSON-encoded `list[EvidenceEdge]` — the grounding path/derivation
in structured form: head/tail csids + names, relation, `source`/`source_url`/`license`
per edge), `template_id`, and top-level provenance `source`/`source_url`/`license`.
The top-level `license` is the **most-restrictive** SPDX class across the evidence
edges (so a consumer filtering by license sees the binding constraint).

## Composition (committed snapshot — seed 20260713)

| Metric | Value |
| --- | --- |
| Total examples | **2,626** |
| ├ path (multi_hop_path) | 1,489 |
| └ derivation (ancestor_chain) | 1,137 |
| Train split | 2,232 |
| Held-out eval split | 394 (15 %) |
| License classes | `CC-BY-4.0` (2,626) |

**Hops histogram:** 2 → 2,580 · 3 → 8 · 4 → 6 · 5 → 6 · 6 → 9 · 7 → 13 · 8 → 4.

**Candidate stats:** `pathCandidates` 1,489 · `derivationCandidates` 1,137 ·
`ambiguousFinalHop` 1,549 (dropped) · `ambiguousAncestorBranch` 31 (dropped) ·
`cyclicDescent` 2 (dropped) · `*DroppedBySampling` 0 (every candidate kept under the
`DEFAULT_MAX_PER_KIND = 8000` cap on today's corpus).

Per-`relation_path` and per-`template_id` breakdowns live in the manifest
(`relationPathCounts`, `templateCounts`); `DESCENDS_FROM>DESCENDS_FROM` dominates the
path questions (2,250) and `derivation.ancestor` is the single derivation template
(1,137).

## Held-out eval split — reserved & registered

`ml/data/kgqa/eval.jsonl` is the **held-out KGQA eval split** the eval harness scores
on (roadmap Phase-2 tier 3, activated in Phase 5 / US-004). It is:

- **Leakage-safe** — every QA sharing a *subject* entity is assigned to one split as a
  unit (subject-grouped, seeded shuffle), so an entity's questions never straddle the
  train/eval boundary. See `kgqa.split_examples`.
- **Reserved** at `DEFAULT_EVAL_RATIO = 0.15` and snapshot-hashed in the manifest
  (`splits.eval.{examples,sha256}`).
- **Registered** via `export_kgqa.REGISTERED_EVAL_SPLIT` — the import surface the eval
  harness loads (`name=kgqa`, `split=eval`, `path`, `manifest`, `manifestKey=splits.eval`).
  `export_kgqa.load_split(path)` is the harness's JSONL loader.

## OPTIONAL Gemini-polish variant (never required for CI)

`pinakes-polish-kgqa` produces a **clearly-separated** variant dataset: it
rewrites only the natural-language *question* surface with Gemini, leaving `answer`,
`evidence`, and provenance untouched (the derivation still justifies the unchanged
answer). Each polished record keeps `question_original`, the new `question`, and is
stamped `variant = "gemini-polished"` so it is never confused with the deterministic
core. It runs only with a `GEMINI_API_KEY`; the pure transform (`kgqa.apply_polish`)
is unit-tested with a fake polisher. After generating a variant, `dvc add ml/data`
captures it alongside the deterministic core.

## KGQA evaluation (eval tier 3, US-004)

The held-out `eval` split is scored by the third eval tier — `pinakes-eval-kgqa`
(`ml/src/pinakes_ml/eval_kgqa.py`, pure core in `kgqa_eval.py`). It measures two
deterministic, **network-free** systems and commits the numbers to
`ml/manifests/kgqa-eval-baseline.json` + a tier-3 block in `docs/ml-baselines.md`
(cross-linking the three eval tiers):

- **`graph-retrieval`** — the GraphRAG floor. For each question it expands a
  depth-bounded neighbourhood around the subject (the ML-side mirror of the US-001
  `vector top-k → neighbourhood expansion` retriever) and answers by walking the
  reasoning chain **using only edges it retrieved**, so a chain deeper than the
  retrieval depth (default 2) is answered wrong — an honest depth-limited floor, not
  an oracle.
- **`no-retrieval`** — the control: with no retrieved subgraph it can only restate
  the subject, so the gap between the two rows is the value the retrieved evidence
  adds.

Three scores per system: **exact** / **normalized** answer match against the gold
answer, plus an **evidence-grounding** rate (is the answer a node the system actually
retrieved?). The tier-2 logical-consistency checks (`pinakes_ml.consistency`)
also run over the structured evidence each system produced — descent acyclicity,
canonical-schema `from`/`to` type constraints, and antisymmetry — so a corpus/schema
breach in the reasoning paths (e.g. `DESCENDS_FROM` among node types the schema does
not yet declare) is surfaced. The committed baseline is byte-reproducible (a live
snapshot-gate test asserts it equals a fresh build) and logged to MLflow.

### Live off-the-shelf-LLM variant (local-only, never required for CI)

The deterministic `graph-retrieval` system is the reproducible stand-in for "an
off-the-shelf LLM reading the retrieved subgraph". The **live** measurement answers
the *same* retrieved subgraphs through the existing Gemini proxy — bring the graph
stack up (`npm run dev:full`, needs Neo4j + `GEMINI_API_KEY`) and query
`/api/graph/retrieve` for the subject's subgraph, then have the LLM answer from it;
the no-retrieval control is the same LLM with no subgraph. It is local-only (network
+ API key) and its numbers are not committed — the deterministic floor is what CI and
the baseline track.

## Regenerating

```bash
# Tier-3 KGQA eval (after the eval split exists):
uv run --project ml pinakes-eval-kgqa            # add --no-mlflow to skip logging
git add ml/manifests/kgqa-eval-baseline.json docs/ml-baselines.md

# 1. Ensure the canonical corpus is checked out (not a locally-drifted export):
uv run --project ml dvc checkout --force export/culturescrape.dvc

# 2. Rebuild the deterministic core + committed manifest:
uv run --project ml pinakes-export-kgqa            # add --no-mlflow to skip logging

# 3. Re-pin the data and push:
uv run --project ml dvc add ml/data && uv run --project ml dvc push
git add ml/data.dvc ml/manifests/kgqa-manifest.json
```

A byte-identical corpus leaves the manifest unchanged (a git no-op); only a real
corpus change moves it.
