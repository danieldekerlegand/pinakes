# Should `ml/` become its own repo? — extract-vs-keep analysis

> **Stale on DVC.** Written before the flatten's Phase 0 removed DVC. The
> `dvc-storage` remote referenced below no longer exists and the `*.dvc`
> pointers are deleted, so the "shared DVC remote" option costs a fresh setup
> rather than reusing what's there. See `docs/artifact-versioning.md`.

**Question:** Pinakes's mission is *scraping + AI to produce and visualize large heterogeneous
datasets* (a data hub). The `ml/` workspace (neurosymbolic training, SLM pilot, KFT provider)
is a distinct concern. Should it move to a separate training-focused repo?

## TL;DR recommendation

**Yes — extract, but stage it.** `ml/` is already a self-contained island and, in ecosystem
terms, a *consumer* of the canonical corpus, not part of the data-hub product. Extraction
aligns Pinakes back to its stated mission and fits the koine/agora producer↔consumer-over-
fabric model that the rest of the ecosystem already follows. The cost is bounded and known:
the corpus handoff plus **three contract files** that become vendored-with-drift-gate mirrors.

**But gate it on one thing:** how settled `contracts/canonical-schema.json` and the datalog
`rules_registry.tsv` are. If those are still churning weekly, keep `ml/` in-repo a while
longer — every change would otherwise need a cross-repo drift-gate roundtrip. If they've
stabilized, extract now.

## What `ml/` is

A separate `uv` workspace (Python 3.11), ~18.5k LOC across 39 modules + 22 test files, its
own heavy stack (torch, pykeen, problog, scallopy, trl/peft, llama.cpp) kept deliberately out
of the `engine/` sidecar. Feature surface (see [ml/CLAUDE.md](../ml/CLAUDE.md)): triples export +
PyKEEN baselines (eval tier 1), logical-consistency ratchet (tier 2), KGQA (tier 3), rule
adherence (tier 4), the Scallop/DeepProbLog neurosymbolic pilot, the full SLM productization
pilot (QLoRA → GGUF → Insimul handoff), and a **KFT fine-tuning provider** for the koine/agora
fabric. It is `1.1 GB` on disk (mostly `.venv` + DVC-materialized `ml/data`/`ml/models`).

## The exact coupling (what "extract" actually has to sever)

`ml/` reaches outside itself in only five places, all via explicit `DEFAULT_*` constants
(`_REPO_ROOT`-anchored):

| What ml/ reads | Where | Used by | Kind |
|---|---|---|---|
| `build/corpus/` corpus | DVC tree | triples, verbalize, kgqa, eval_kgqa, scallop | **the seam** |
| `build/corpus.dvc` (md5) | git | train_baselines (records corpus version) | pointer |
| `contracts/canonical-schema.json` | git | consistency, kgqa, queries, train_baselines, train_scallop (6 modules) | **contract** |
| `engine/src/pinakes_engine/datalog/rules_registry.tsv` | git | export_scallop (`DEFAULT_REGISTRY`) | **contract** |
| `engine/tests/fixtures/insimul/world-export.json` | git | export_insimul_datasets (`DEFAULT_WORLDS`), eval_rule_adherence | fixture-as-input |

Plus `ml/tests/test_lib_export.py` drives the loaders over `engine/`'s committed golden export
fixtures (`engine/tests/fixtures/parity/golden/neo4j-export/`). Nothing in `engine/`, `server/`,
or `web/` reads *into* `ml/` — the dependency is strictly one-directional (ml → engine/shared),
which is what makes extraction clean.

## Case FOR extraction

- **Mission clarity.** Pinakes = produce/visualize datasets. Training models *from* that
  dataset (and shipping them to Insimul/Argos/Cuneiform) is a different product. The repo
  already *feels* like two products bolted together (TS+React hub + a heavy Python ML lab).
- **Ecosystem fit.** The fabric is explicitly producer↔consumer with no central hub. `ml/` is
  already a **KFT provider** (`kft.py`/`kft_run.py`) and an **Insimul-bridge producer**
  (rule-SFT / lore-QA datasets). Those are fabric roles, not data-hub roles — they belong to a
  peer repo that Pinakes *feeds*, exactly like Argos or Tessera.
- **Toolchain isolation is already real.** Separate `uv` workspace, separate lock, separate CI
  gates, a heavy dep stack that must never touch the sidecar. Extraction just makes the
  existing boundary a repo boundary.
- **Independent model release.** The GGUF/KFT deliverables version on their own cadence
  (`ml/models.dvc`, 1.9 GB) — awkward to couple to the data-hub's release rhythm.
- **Cognitive load.** Removing 39 ML modules + the heavy stack shrinks Pinakes to its core.

## Case AGAINST / the real costs

- **The corpus handoff.** A separate repo can't read `build/corpus` locally. Options:
  (a) a **shared DVC remote** both repos pull from (lowest friction — the `dvc-storage` remote
  already exists); (b) publish the corpus as a **versioned dataset** (KGP/KMI asset) the ml
  repo pulls by version. Either way it's new cross-repo plumbing.
- **Three contract files become drift-gated mirrors.** `canonical-schema.json`,
  `rules_registry.tsv`, and the insimul `world-export.json` fixture must be vendored into the
  ml repo with the ecosystem's **byte-identical mirror + drift-failing test** convention
  (like the koine mirror the repo already does for `predicate-mapping.json`). Each is a small
  file, but a schema change now needs a two-repo update instead of one.
- **Co-evolution friction.** `ml/`'s consistency/queries/scallop logic tracks the schema and
  rules closely. If those are still changing often, the drift-gate roundtrips will hurt.
- **DVC split.** `ml/data.dvc` + `ml/models.dvc` move with the repo (fine), but they and the
  corpus pointer must share (or re-point at) a remote. One more thing to keep coherent.
- **Operational overhead.** Another repo: CI, chief tasklists, `dependsOn: pinakes:*` edges,
  release process, and the insimul-bridge work now spans three repos (pinakes-core → ml →
  insimul).

## The crux: corpus + contracts handoff

The whole decision reduces to whether you're comfortable turning **four things** into
cross-repo dependencies:

1. **corpus** → shared DVC remote or published dataset (mechanical, the remote exists);
2. **`canonical-schema.json`** → vendored mirror + drift gate;
3. **`rules_registry.tsv`** → vendored mirror + drift gate;
4. **insimul `world-export.json` fixture** → vendored mirror (or Insimul publishes it).

If those four are acceptable, extraction is clean and one-directional. The established
"vendor-with-drift-gate, not submodules" convention is exactly designed for #2–4.

## Recommended path (if extracting)

1. **Stabilize first.** Confirm `canonical-schema.json` + `rules_registry.tsv` aren't in active
   flux. If they are, defer — this is the one real blocker.
2. **Make the corpus a published input.** Point the new repo's `build/corpus` at the
   shared DVC remote (or publish a versioned corpus asset); keep `_REPO_ROOT/build/corpus`
   resolving via an env/config override instead of a repo-relative path.
3. **Vendor the 3 contract files** with drift-failing tests (mirror the existing koine-mirror
   pattern in `scripts/regen-registry-mirror.ts`).
4. **Move `ml/` + its DVC pointers** (`ml/data.dvc`, `ml/models.dvc`) into the new repo; wire
   its `uv` CI (remember `uv sync --extra dev` — the gap this session hit).
5. **Register it as a fabric peer** (KCB provider / KFT provider) so Insimul dials it directly,
   per ADR-0001 — no code in Pinakes should import it.
6. **Leave a stub/pointer** in Pinakes docs (README + ECOSYSTEM) naming the new repo as the
   training consumer.

## Decision checklist

- Extract **now** if: the schema + rules registry are stable, and you want Pinakes to be purely
  the data hub.
- Extract **later** if: the schema/rules are still churning weekly (drift-gate cost too high
  right now), or the SLM/KFT pilots are mid-flight and you don't want to move goalposts.
- **Don't** keep it merged long-term purely to avoid the corpus handoff — that handoff is the
  same one the ecosystem already expects between any producer and consumer.

*Grounding: coupling verified against the tree at `main@3ff971d2` (post data-reorg). See
[DATA-INVENTORY.md](DATA-INVENTORY.md) for the data-layout context this builds on.*
