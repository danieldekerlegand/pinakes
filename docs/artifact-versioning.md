# Artifact versioning — DVC removed, and how to bring it back

> **The `ml/…` rows below are historical.** That workspace was extracted into the private
> **`lugh`** repo (`docs/LUGH-EXTRACTION-PLAN.md`), taking its datasets/models with it — so
> the only large artifact this repo still owns is `build/corpus`, which is also the handoff
> lugh now pulls. Any versioning scheme adopted here has to publish it, not just store it.

**Status: Option C is implemented for `build/corpus`**, producer *and* consumer side — see
[The corpus handoff](#the-corpus-handoff-buildcorpus--consumers) below: a
[packaging command](#the-corpus-handoff-buildcorpus--consumers), a
[release workflow](#publishing-the-release-path) that uploads it as a private asset, and the
[authenticated pull](#pulling-what-a-consumer-runs) consumers perform. Everything else
in this repo is still an unversioned, git-ignored build output regenerated from committed
inputs; DVC was removed in the flatten's Phase 0 (see
[UNIFIED-PROJECT-PLAN.md](./UNIFIED-PROJECT-PLAN.md) §4/§9).

## The corpus handoff: `build/corpus` → consumers

`build/corpus` is the canonical node/edge TSV export and the one large artifact this repo
still owns. With DVC gone, a consumer that needs it (the private **`lugh`** trainer, via
its `LUGH_CORPUS_DIR`) does not check out a pointer — it downloads a **published,
checksummed tarball**. This is the producer side of that seam
([LUGH-EXTRACTION-PLAN.md](./LUGH-EXTRACTION-PLAN.md)).

```bash
# 1. Regenerate the corpus from the committed lexicons (writes the gitignored export).
npx tsx scripts/export-for-engine.ts

# 2. Package it. Writes dist/corpus-<version>.{tar.gz,tar.gz.sha256} + a release manifest.
uv run --all-packages pinakes_engine publish-corpus --out dist
# published corpus-0e6f2a1b3c4d: 27 file(s), 1866091 byte(s) -> dist/corpus-0e6f2a1b3c4d.tar.gz
#   sha256:   3f1c…  (dist/corpus-0e6f2a1b3c4d.tar.gz.sha256)
#   manifest: dist/corpus-0e6f2a1b3c4d-manifest.json (sha256:…)
```

| Written | What it is |
|---|---|
| `dist/corpus-<version>.tar.gz` | the bundle; every file laid out under `corpus-<version>/` |
| `dist/corpus-<version>.tar.gz.sha256` | `sha256sum` format, so a downloader runs `sha256sum -c` and nothing else |
| `dist/corpus-<version>-manifest.json` | node/edge counts, per-type breakdown, per-file SHA-256, bundle digest, and the **licence partition** (what may be redistributed under which terms) |

`dist/` is gitignored — it is a release stage, not a committed tree.

**The version is content-addressed by default:** 12 hex digits of a digest over the sorted
per-file paths and hashes. So the same corpus always publishes under the same name and the
same sha256, and a *different* name always means different bytes. Pass `--version 2026.08.1`
for a semantic release tag instead.

**Why content-addressing is honest here.** `scripts/export-for-engine.ts` mints csids
deterministically and propagates provenance verbatim, so re-exporting the same lexicons is
byte-identical; the archive itself pins mtimes/owner/mode and sorts file order
(`engine/src/pinakes_engine/orchestrate/package.py`). Re-running the whole two-step sequence
reproduces the version. This is **not** true of the engine's own `out/<job>/corpus` — its
acquisition adapter stamps `retrieved_at` with the ingestion wall-clock — so package *that*
with plain `pinakes_engine package`, which pins one point-in-time bundle
(`engine/docs/convergence-build.md`).

**No corpus, no-op.** With `build/corpus` absent the command prints
`nothing to publish: … export it first (npx tsx scripts/export-for-engine.ts)` and exits 0 —
the corpus is a regenerable build output, so its absence in a fresh checkout is not an error.
CI, where the export step ran immediately before, passes `--require-corpus` to turn absence
back into a failure.

> **Path gotcha.** `scripts/export-for-engine.ts` still writes `export/pinakes_engine`, not
> `build/corpus` — a known open item in
> [UNIFIED-PROJECT-PLAN.md §"target layout"](./UNIFIED-PROJECT-PLAN.md) (US-1's blanket rename
> landed on the wrong constant, and flipping it moves five other scripts' output). Until that
> is resolved, publish with `--corpus export/pinakes_engine`. Everything else here is
> unaffected: the packager takes any directory holding `nodes/` + `edges/`.

### Publishing: the release path

[`.github/workflows/publish-corpus.yml`](../.github/workflows/publish-corpus.yml) is the
producer end-to-end. It is **`workflow_dispatch`-only** — a corpus release is a decision,
not a side effect of a push — and runs the two steps above plus the release:

| Step | What |
|---|---|
| `npx tsx scripts/export-for-engine.ts` | regenerate the corpus from the committed lexicons |
| `pinakes_engine publish-corpus --require-corpus --json` | package + checksum; `--require-corpus` makes an absent corpus a failure (the export just ran), `--json` emits `{version, tag, archive, checksum, manifest, sha256, …}` for the release step to key on |
| `sha256sum -c` | verify the sidecar *here*, on the bytes we just wrote — the same command the consumer runs |
| `gh release create corpus-<version> …` | upload the three assets to a release tagged with the corpus version |

Two inputs: `version` (blank = content-addressed) and `dry_run` (package + verify, release
nothing). **Re-running is safe.** The tag is the content-addressed version, so republishing
an unchanged corpus lands on the same tag with byte-identical assets (the workflow detects
the existing release and re-uploads with `--clobber`); a *new* tag always means the corpus
really changed. The release is created with `--latest=false` — a data channel must not
displace the repo's newest software release.

**The assets are private because the repo is.** GitHub release assets inherit repository
visibility, so there is no public URL to leak and every pull must authenticate — which is
exactly the property the handoff needs, since the corpus carries share-alike and
non-commercial licensed records (the release manifest's `licenses` block says which).

### Pulling: what a consumer runs

The consumer is the private [`lugh`](./LUGH-EXTRACTION-PLAN.md) trainer, whose
`LUGH_CORPUS_DIR` points at an extracted bundle (without it, its live-corpus tests skip and
CI stays green fixture-only). The pull is authenticated `gh`, then verify, then extract:

```bash
gh auth status                                  # a token with read access to the private repo
gh release download corpus-<version> \
  --repo <owner>/pinakes --pattern 'corpus-*'   # tarball + .sha256 + manifest

sha256sum -c corpus-<version>.tar.gz.sha256     # MUST pass before extracting
tar -xzf corpus-<version>.tar.gz                # -> corpus-<version>/{nodes,edges}/…

export LUGH_CORPUS_DIR="$PWD/corpus-<version>"
```

- **Verify before extracting, always.** The sidecar is plain `sha256sum` format over a bare
  filename, so `sha256sum -c` works from whatever directory the asset landed in — no
  arguments, no jq, no trust in the transport. On macOS, `shasum -a 256 -c` reads the same
  file.
- **`gh release download` needs the token, not a URL.** A private asset's browser URL is not
  fetchable with a bare `curl`; use `gh` (or `curl -H "Authorization: Bearer $GH_TOKEN" -L`
  against the *API* asset URL with `Accept: application/octet-stream`). In lugh's CI that
  token is a repo secret with read access to this repo — `GITHUB_TOKEN` is scoped to the
  repo it runs in and cannot read this one.
- **Omitting `--pattern` also downloads the release manifest** — `corpus-<version>-manifest.json`
  carries the node/edge counts, per-file SHA-256s and the licence partition. Pull it when the
  consumer needs to record *what* it trained on, or to check a per-file hash after extraction.
  (The same JSON also ships **inside** the tarball as `release-manifest.json`.)
- **Pin the version, don't chase the newest.** Record `corpus-<version>` + the sha256 next to
  any metric measured on it; the content-addressed tag is what makes that reference resolvable
  later. `gh release list` shows what exists.

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

The lowest-friction option, and the one **taken** for `build/corpus`: publish a versioned
tarball of a corpus build as a (private) release asset and record its sha256 next to any
metric measured on it. No tooling, no daemon, no dependency tree. Implemented in
[The corpus handoff](#the-corpus-handoff-buildcorpus--consumers) above —
`pinakes_engine publish-corpus` + `.github/workflows/publish-corpus.yml` +
`gh release download`; the other trees listed here are still unversioned.
