# Extracting `ml/` → `lugh` — the fine-tuning platform

**Status:** **EXECUTED** (`tasks/chief/90-extract-lugh.json`). The repo exists and is private
(`github.com/danieldekerlegand/lugh`, 44 commits of `ml/` history preserved via `git subtree
split`, seeded with its own `.chief/` + the four tasklists staged below); `ml/` and
`tasks/extraction-staging/` are gone from pinakes, and the app-side KFT wrapper now dispatches
to a lugh checkout resolved from `LUGH_ROOT`. What remains is lugh's own program (10→40) plus
the argos/cuneiform reconciliation below. Original "how" for extracting
`pinakes/ml/` into its own **private** repo, **`lugh`**, the ecosystem's specialized,
local-only fine-tuning provider. Builds on [ML-EXTRACTION-ANALYSIS.md](ML-EXTRACTION-ANALYSIS.md)
(the why + coupling) and the cross-project fine-tuning survey.

## Decisions (locked)

- **Name:** `lugh` (Lugh Samildánach, "master of all arts") — repo + fabric identity.
- **Visibility:** **private** repo, for now.
- **Fabric provider id:** `lugh:agent:finetune` (replaces the ecosystem's placeholder
  `pinakes:agent:finetune`). It is the **specialized, local-only KFT provider** — a peer to
  agora's *general* trainer, and the executor cuneiform's control plane routes jobs to.
- **Extract now:** the coupling is clean and one-directional; the schema is codegen'd + drift-gated
  (flatten tasklist 40 merged), so the "is the contract stable?" gate resolves in favor of go.

## Why lugh is the right home (survey result)

koine defines the KFT contract; **agora** hosts the *general* trainer (stubbed compute, no torch);
**cuneiform** is the *control plane* (CLI + flywheel) that **delegates** training to
`pinakes:agent:finetune`; **pinakes/ml** is the only real trainer. So lugh fills a pre-designed
slot: cuneiform already routes to it and agora's registry already selects it. Bonus: **argos forked
`pinakes_ml.slm_finetune`** for its edit-ops SLM pilot — a standalone lugh lets argos *depend on* it
instead of drifting from a copy.

## What crosses the boundary (the coupling to sever)

`ml/` reads exactly four things from outside itself, all one-directional (nothing reads *into* ml/):

| Input | Handling in lugh |
|---|---|
| `build/corpus/` (the canonical node/edge corpus) | **published artifact** pulled from pinakes (DVC is gone) |
| `contracts/canonical-schema.json` | **vendored mirror + drift gate** (koine-mirror pattern) |
| `engine/src/pinakes_engine/datalog/rules_registry.tsv` | **vendored mirror + drift gate** |
| `engine/tests/fixtures/insimul/world-export.json` | **vendored mirror** (or Insimul publishes it) |

Plus `ml/tests/test_lib_export.py` drives loaders over `engine/`'s golden export fixtures — vendor
those fixtures too, or drop that test's live tier (it's `skipif`-guarded already).

## Extraction mechanics

1. **History-preserving split.** `git subtree split -P ml -b lugh-export` (or `git filter-repo
   --path ml/ --path-rename ml/:`) so lugh keeps the ml/ commit history, not a flat snapshot.
2. **Create the private repo:** `gh repo create <owner>/lugh --private`, push the split branch as
   `main`, restructure at the root (the `ml/` contents become the repo root; `pinakes_ml` package
   stays the import name, or rename to `lugh` — see open question).
3. **Corpus handoff:** lugh's `_REPO_ROOT/build/corpus` default becomes an **env/config override**
   (`LUGH_CORPUS_DIR`) pointing at a pulled published-artifact tarball; without it, the live-corpus
   tests `skipif`-skip (as they do today), so CI stays green fixture-only.
3. **Fabric registration:** a KCB manifest advertises `lugh:agent:finetune` (mirror agora
   `trainer/manifest.py`); align `kft.py`/`kft_run.py`'s minted identity from `pinakes:` → `lugh:`.
4. **Pinakes side:** remove `ml/`, add a pointer (`README` + `docs/`) naming lugh as the training
   consumer, and update the two planning docs' "ml/ stays" notes.

## Port the valuable bits from cuneiform's archived `train.py`

Cuneiform's retired `archive/apps/web/scripts/train.py` is a *generic* harness with four things
`pinakes/ml` (task-specialized, ChatML-bound) lacks — port them into lugh's **general executor**
(the KFT provider path), reconciled with the existing `kft.py`/`kft_run.py` contract layer:

- **Multi-format dataset auto-detection + formatters** (`alpaca`/`sharegpt`/`chatml`/`completion`/
  `text`) — turns "trains our tasks" into "trains any KFT job's dataset."
- **Unsloth fast path** — pinakes/ml has none; a real local QLoRA speed/memory win.
- **`method: full`** (not just lora/qlora).
- **Streaming JSONL telemetry + graceful SIGTERM/SIGINT cancel**, whose shape matches **KFT §6**
  telemetry that cuneiform's `Subprocess`/`Kcb` runner already reads.

Do **not** port its GGUF export (pinakes/ml already has `export_gguf.py`/`slm_gguf.py`) or trust its
admission (kft.py is more rigorous). Port-the-good-parts-and-reconcile, not wholesale.

## Reconciliation follow-ups (cross-repo)

- **argos** — its `src/filmstudio/edit_ops_slm/` forked `pinakes_ml.slm_finetune`. Once lugh is an
  installable package, argos should **depend on lugh** for the shared SLM plumbing (ChatML/device
  helpers, QLoRA core, GGUF export) and keep only its edit-ops-specific corpus/referee. This also
  touches **cuneiform's export process**, since argos is scaffolded/exported by cuneiform — the
  templates that emit argos's ML deps must point at lugh, not a vendored copy.
- **cuneiform** — flip the KFT routing target `pinakes:agent:finetune` → `lugh:agent:finetune`
  (`finetune_conformance.rs`, `finetune_test.go`, and any registry defaults), and update the
  export/scaffold templates.

## The cross-repo chief program

Three programs, one per repo, wired by `<repo>:<tasklist>` **barriers** (each repo runs its own
`chief run`; a qualified dep just waits for the upstream `completed/` record):

```
pinakes (this repo, tasks/chief/)
  90-extract-lugh          # subtree-split ml/ -> create private lugh -> seed lugh's tasks/chief/ -> remove ml/ + pointer
  91-publish-corpus-artifact  # publish build/corpus as a versioned release tarball + sha256 (the handoff)

lugh (new repo, tasks/chief/ — staged here under tasks/extraction-staging/lugh/, dropped in by 90)
  10-bootstrap             dependsOn pinakes:90-extract-lugh   # uv workspace, CI (uv sync --extra dev), private README
  20-vendor-contracts-corpus  dependsOn 10                     # vendor the 3 files + drift gates; corpus pull via LUGH_CORPUS_DIR
  30-kft-provider-manifest dependsOn 20                        # KCB manifest -> lugh:agent:finetune; kft identity pinakes->lugh
  40-port-general-train-harness dependsOn 30                   # port train.py generic bits (dataset auto-detect, unsloth, full, §6 telemetry)

argos (argos/tasks/chief/)
  reconcile-edit-ops-on-lugh  dependsOn lugh:30-kft-provider-manifest, argos-was-exported-by-cuneiform

cuneiform (cuneiform/tasks/chief/)
  route-to-lugh + revise-export-templates  dependsOn lugh:30-kft-provider-manifest
```

The pinakes tasklists are authored here; the lugh tasklists **were staged** under
`tasks/extraction-staging/lugh/` and copied into `lugh/tasks/chief/` by `90-extract-lugh` US-1 —
that staging directory has since been removed from pinakes (US-2), so lugh's copies are the only
ones. The argos and cuneiform tasklists are authored **in those repos** when we get there
(described above).

## Risks & notes

- **`90-extract-lugh` is the delicate one** — it rewrites/splits history and creates+pushes a new
  repo. Run it **attended** and review the branch before merge (don't rely on auto-merge for it).
- **Private repo:** `gh repo create --private`; release assets (the corpus tarball) are private too —
  lugh's pull must authenticate.
- **No `ml/` consumer breaks:** nothing in pinakes imports `ml/`, so removing it is safe; the paused
  flatten band (`50–80`) never touches `ml/`.
- **`uv sync --extra dev`** — bake it into lugh's CI/warmup (the missing-pytest gap we hit here).

## Open questions

- **Package import name:** keep `pinakes_ml` (least churn) or rename to `lugh`/`lugh_ml` (clean, but
  touches every import + the argos fork)? **Pinakes no longer constrains this** — US-2 made its
  manifest point at the *console script* (`lugh:pinakes-train-slm`) rather than a module path, so a
  package rename inside lugh does not break the advertisement. Renaming the console script would.
- ~~**Corpus artifact host:** GitHub release asset (private) vs an object store (R2/S3)~~ —
  **settled by 91 US-2: a private GitHub release asset** (Option C). `pinakes_engine
  publish-corpus` packages it, `.github/workflows/publish-corpus.yml` uploads it to a
  `corpus-<version>` release, and lugh pulls it with an authenticated `gh release download` +
  `sha256sum -c` into `LUGH_CORPUS_DIR`. Full contract: `docs/artifact-versioning.md`.
- **Insimul fixture:** vendor `world-export.json`, or have Insimul publish it as the source of truth?
