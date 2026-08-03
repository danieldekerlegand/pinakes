# Artifact versioning — DVC removed, and how to bring it back

> **The `ml/…` rows below are historical.** That workspace was extracted into the private
> **`lugh`** repo (`docs/LUGH-EXTRACTION-PLAN.md`), taking its datasets/models with it — so
> the only large artifact this repo still owns is `build/corpus`, which is also the handoff
> lugh now pulls. Any versioning scheme adopted here has to publish it, not just store it.

**Status: there is no content-addressed artifact versioning in this repo.** DVC was
removed in the flatten's Phase 0 (see
[UNIFIED-PROJECT-PLAN.md](./UNIFIED-PROJECT-PLAN.md) §4/§9). Large build outputs
are plain git-ignored directories, regenerated from committed inputs.

## What was removed

| Removed | Was |
|---------|-----|
| `.dvc/`, `.dvcignore` | repo-root DVC init + a `localremote` pointing at `dvc-storage/` |
| `build/corpus.dvc` | pointer for the canonical node/edge TSV export |
| `engine/out/pinakes-full.dvc` | pointer for the full Datalog/Neo4j rebuild output |
| `ml/data.dvc`, `ml/models.dvc` | pointers for ML datasets/embeddings and the slm-pilot GGUF bundle |
| `dvc>=3.0` in `ml/pyproject.toml` | 54 transitive packages in `ml/uv.lock` |

## Why

- The `dvc-storage/` local-directory remote was **stranded** — the pointers named
  content hashes whose bytes no longer existed anywhere, so `dvc pull` could not
  restore any of them. The pins were decorative.
- Every tracked tree is **regenerable** from committed inputs (category specs,
  export CLIs, `configs/*.json`, seeds) — the exporters are deterministic and
  byte-stable by design, which is what made DVC attractive but also makes it
  optional.
- The slm-pilot GGUF (`ml/models`, 1.9 GB) was never finetuned in production, so
  the one genuinely un-regenerable artifact never existed.
- A local-only remote gives no collaborator or CI benefit — the cost (a 54-package
  dependency tree, four pointer files that drift, a re-pin step after every
  regeneration) bought nothing.

The output paths stay git-ignored as regenerable build outputs:
`build/corpus`, `engine/out/`, `ml/data`, `ml/artifacts`, `ml/models`.

## Historical hashes

Metrics recorded against a specific corpus version still cite the DVC md5 that
pinned it (e.g. `docs/ml-baselines.md` cites the canonical export as
`e418c976755c57876e0be1438c6295b7.dir`). Those strings are now **provenance
labels, not resolvable references** — nothing can fetch that tree. Treat them as
"which build this number came from", and re-measure rather than trying to restore.

## Re-enabling later

Bring versioning back if — and only if — one of these becomes true: CI needs to
fetch a build output, a collaborator needs the exact bytes, or a published metric
must be reproducible from a pinned dataset.

### Option A — DVC with a *cloud* remote

The mistake to avoid repeating is the local-directory remote. Point it at
real storage from the start:

```bash
uv add --project ml 'dvc[s3]>=3.0'          # or dvc[gs], dvc[azure]
uv run --project ml dvc init                # recreates .dvc/ + .dvcignore at the repo root
uv run --project ml dvc remote add -d origin s3://<bucket>/pinakes
uv run --project ml dvc add build/corpus ml/data
git add build/corpus.dvc ml/data.dvc .dvc .dvcignore
uv run --project ml dvc push
```

Then drop the corresponding `.gitignore` entries for whatever DVC starts managing
(DVC writes its own ignore rules next to each tracked path).

### Option B — git-lfs

Simpler if the only need is "a few large binaries travel with the repo", with no
pipeline/experiment features:

```bash
git lfs install
git lfs track "ml/models/**/*.gguf"
git add .gitattributes
```

LFS stores bytes on the git remote, so there is no separate storage to configure —
but it has no notion of "this metric was measured on that dataset version", which
is the property DVC pointers provided.

### Option C — published release artifacts

The lowest-friction option and the current de-facto plan: publish a versioned
tarball of a corpus build as a GitHub release asset and record its sha256 next to
any metric measured on it. No tooling, no daemon, no dependency tree.
