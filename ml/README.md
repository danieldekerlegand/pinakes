# `ml/` — LinguaScrape ML / neurosymbolic workspace

Phase 2 of [`NEUROSYMBOLIC_ROADMAP.md`](../NEUROSYMBOLIC_ROADMAP.md): the first
**fact → model loop**, built at the *current* corpus scale (deliberately before
scale-up, so corpus growth becomes measurable). This workspace is intentionally
**separate from the `packages/culture-scrape/` sidecar** so the sidecar Docker
image stays slim — the sidecar never imports torch/pykeen.

Deliverables (one Ralph story each):

| Story | Deliverable |
|-------|-------------|
| US-001 | This workspace + DVC + MLflow infrastructure |
| US-002 | Triples exporter + committed deterministic splits |
| US-003 | PyKEEN embedding baselines (TransE/ComplEx/RotatE) with recorded metrics |
| US-004 | ProbLog dialect emitter (in the sidecar; the DeepProbLog on-ramp) |
| US-005 | Logical-consistency evaluation harness (CI ratchet) |

## Environment

[uv](https://docs.astral.sh/uv/)-managed, **Python 3.11** (pinned in
`.python-version`; the ML wheel stack lags newer interpreters).

```bash
cd ml
uv sync --extra dev          # create .venv + install torch/pykeen/problog/mlflow/dvc/…
uv run python -c 'import torch, pykeen, problog'   # import smoke (what CI runs)
```

- **torch** picks its device at runtime — MPS on Apple Silicon, CPU elsewhere;
  no code change needed. **No model training runs in CI** (imports + a tiny
  MLflow smoke only); full baseline runs are local-only.
- **scallopy** (the Scallop neurosymbolic pilot, roadmap Phase 5.4) is *not* a
  declared dependency — its only wheel (0.1.0) is cp39-only and doesn't resolve
  on Python 3.11. Install it manually when the Phase-5 pilot begins.

### Quality checks (what "ml/ checks pass" means)

```bash
cd ml
uv run ruff check .          # lint
uv run pytest                # smoke tests (imports + MLflow file backend)
```

## Experiment tracking — MLflow (local file backend)

All scripts log to a **local file store** (no server, no DB): `ml/mlruns` by
default, overridable with `MLFLOW_TRACKING_URI`. Never wire `mlflow.set_tracking_uri`
by hand — use the helper in `linguascrape_ml.tracking`:

```python
import mlflow
from linguascrape_ml import start_run

with start_run(run_name="transe-baseline"):   # configures URI + experiment, opens the run
    mlflow.log_param("model", "TransE")
    mlflow.log_metric("mrr", 0.31)
```

The helper also opts into MLflow's file backend (`MLFLOW_ALLOW_FILE_STORE=true`,
via `setdefault`) — MLflow ≥3 puts the file store in "maintenance mode" and
raises without that opt-out. We require the file backend (no server/DB, so runs
stay reproducible and CI-safe), so the helper sets it for you.

Runs group under the `linguascrape-baselines` experiment. Browse them with
`uv run mlflow ui` (defaults to the same file store) → http://127.0.0.1:5000.
`mlruns/` is git-ignored — metrics that must be preserved are committed to
`docs/ml-baselines.md` (US-003), not the run store.

## Dataset & artifact versioning — DVC

Exports are already deterministic / byte-stable, so DVC is a natural fit: a
committed `.dvc` pointer file pins the **exact content hash** of a build output,
which later stories cite as "the corpus version this metric was measured on".

DVC is initialized at the **repo root** (`.dvc/` there, run `dvc` from the repo
root). A **local directory remote** (`dvc-storage/`, git-ignored) is the default,
so nothing leaves the machine and no cloud credentials are needed.

**Tracked paths** (large / regenerable build outputs, git-ignored, DVC-pinned):

| Path | What it is |
|------|-----------|
| `export/culturescrape` | Canonical node/edge TSV export (the corpus the triples exporter reads) |
| `packages/culture-scrape/out/linguascrape-full` | Full Datalog/Neo4j rebuild output |
| `ml/data` | ML datasets (triples + splits, US-002) and trained artifacts (embeddings, US-003) |

### Workflow

```bash
# From the repo root. Use `uv run --project ml dvc …` (dvc lives in the ml venv).
alias dvc='uv run --project ml dvc'

# After regenerating a build output, re-pin its hash:
npx tsx scripts/export-for-culturescrape.ts   # regenerate export/culturescrape
dvc add export/culturescrape                   # updates export/culturescrape.dvc
git add export/culturescrape.dvc               # commit the new pointer

# Push/pull the actual bytes to/from the local remote:
dvc push                                        # store cached versions in dvc-storage/
dvc pull                                        # restore them on a fresh checkout

# `dvc repro` runs once a dvc.yaml pipeline exists (US-002 adds the triples stage).
```

The `.dvc` pointer changes **only** when the tracked content changes, so a
byte-identical rebuild is a git no-op — the same property the export manifest
and reconciliation snapshots rely on.

## Layout

```
ml/
├── pyproject.toml            # uv workspace (Python 3.11), deps + ruff/pytest config
├── .python-version          # 3.11
├── README.md                # this file
├── src/linguascrape_ml/
│   ├── __init__.py
│   └── tracking.py          # MLflow file-backend wiring (start_run helper)
├── tests/
│   └── test_smoke.py        # import smoke + MLflow file-backend logging test
└── data/                    # DVC-tracked datasets/artifacts (git-ignored)
```
