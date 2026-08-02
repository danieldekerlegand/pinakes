"""PyKEEN link-prediction baselines — the metric floor (neurosymbolic roadmap Phase 2).

Trains TransE / ComplEx / RotatE knowledge-graph embeddings on the **committed**
train/valid/test splits (US-002) and records MRR + Hits@{1,3,10}. These are the
statistical floor every future corpus-growth and neurosymbolic result is judged
against, so the run is pinned end-to-end: a fixed seed, the committed vocab as the
entity/relation id map, and the exact corpus/split hashes recorded alongside the
metrics.

Following the workspace's reproducible-artifact pattern (see ``ml/CLAUDE.md``):

* the heavy, device-touching work lives in small functions here that import
  torch/pykeen **lazily** (so ``import pinakes_ml`` stays cheap and the
  sidecar-slim contract is never at risk);
* the *rendering* of the committed metrics doc (:func:`render_baselines_doc`) is a
  **pure** function of already-computed numbers, so it is unit-tested deterministically;
* the filesystem writes + MLflow logging live in the thin CLI
  :mod:`pinakes_ml.train_baselines`.

Full baseline runs are **local-only** (CPU/MPS on the dev machine); CI only
smoke-trains a tiny in-memory fixture for one epoch (see ``tests/test_baselines.py``).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    import numpy as np
    from pykeen.pipeline import PipelineResult
    from pykeen.triples import TriplesFactory

    from pinakes_ml.triples import Triple

# The three canonical baselines, in the order they appear in the metrics doc.
# TransE (translational), ComplEx (bilinear, complex), RotatE (rotation in complex
# space) span the classic KGE model families — a fair spread for a first floor.
DEFAULT_MODELS: tuple[str, ...] = ("TransE", "ComplEx", "RotatE")

# Reuses the triples split seed so "the seed" is one number across the workspace.
BASELINE_SEED = 20260712

# Modest defaults: the corpus is small + very sparse (≈one triple per entity), so a
# large embedding_dim mostly overfits; these keep a full 3-model run to minutes on CPU.
DEFAULT_EMBEDDING_DIM = 64
DEFAULT_NUM_EPOCHS = 100

# The metrics we commit. PyKEEN's ``get_metric`` aliases: ``mrr`` = filtered
# inverse-harmonic-mean rank (both sides, realistic), ``hits@k`` = filtered Hits@k.
METRIC_KEYS: tuple[str, ...] = ("mrr", "hits@1", "hits@3", "hits@10")

# Split TSV filenames the exporter (US-002) writes into ``ml/data/triples/``.
_TRAIN, _VALID, _TEST = "train.tsv", "valid.tsv", "test.tsv"
_ENTITIES, _RELATIONS = "entities.tsv", "relations.tsv"


@dataclass
class BaselineOutcome:
    """One trained baseline: its metrics + the trained entity embeddings.

    ``embeddings`` is row-aligned to the committed ``entities.tsv`` index order (the
    same id map every model shares), so downstream reuse (GraphRAG, Scallop) can join
    on that file without re-deriving ids. ``embeddings_dtype`` records ``complex64``
    for ComplEx/RotatE (their entity representation is genuinely complex).
    """

    model: str
    metrics: dict[str, float]
    embeddings: Any  # numpy.ndarray, shape (num_entities, dim)
    embedding_dim: int
    num_epochs: int
    seed: int
    device: str

    @property
    def embeddings_shape(self) -> tuple[int, ...]:
        return tuple(self.embeddings.shape)

    @property
    def embeddings_dtype(self) -> str:
        return str(self.embeddings.dtype)


def load_label_to_id(path: Path | str) -> dict[str, int]:
    """Parse a committed vocab file (``index<TAB>label``) into ``{label: index}``.

    The exporter writes ``entities.tsv``/``relations.tsv`` in this shape; reusing them
    as the PyKEEN id map (rather than letting each factory derive its own) is what
    makes every model — and every rerun — share one stable id space, and what lets the
    exported embeddings be row-aligned to ``entities.tsv``.
    """
    mapping: dict[str, int] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        idx, label = line.split("\t")
        mapping[label] = int(idx)
    return mapping


def load_split_factories(
    data_dir: Path | str,
) -> tuple[TriplesFactory, TriplesFactory, TriplesFactory]:
    """Load train/valid/test PyKEEN factories sharing the committed vocab id map.

    The full entity/relation vocab is applied to every split, so the id space covers
    all entities (including any that, after the leakage-safe pair grouping, appear only
    in valid/test) and is identical across models — a prerequisite for both filtered
    evaluation and reusable, row-aligned embeddings.
    """
    from pykeen.triples import TriplesFactory

    data_dir = Path(data_dir)
    entity_to_id = load_label_to_id(data_dir / _ENTITIES)
    relation_to_id = load_label_to_id(data_dir / _RELATIONS)

    def _factory(name: str) -> TriplesFactory:
        return TriplesFactory.from_path(
            data_dir / name,
            entity_to_id=entity_to_id,
            relation_to_id=relation_to_id,
        )

    return _factory(_TRAIN), _factory(_VALID), _factory(_TEST)


def run_pipeline(
    model: str,
    training: TriplesFactory,
    validation: TriplesFactory,
    testing: TriplesFactory,
    *,
    seed: int = BASELINE_SEED,
    embedding_dim: int = DEFAULT_EMBEDDING_DIM,
    num_epochs: int = DEFAULT_NUM_EPOCHS,
    device: str = "cpu",
) -> PipelineResult:
    """Train + evaluate one model reproducibly via the PyKEEN pipeline.

    ``random_seed`` pins torch/numpy/python RNGs (PyKEEN's ``set_random_seed``), so a
    rerun on the same device yields the same metrics. ``use_tqdm`` is off so the run is
    quiet in CI/logs.
    """
    from pykeen.pipeline import pipeline

    return pipeline(
        training=training,
        validation=validation,
        testing=testing,
        model=model,
        model_kwargs={"embedding_dim": embedding_dim},
        training_kwargs={
            "num_epochs": num_epochs,
            "use_tqdm": False,
            "use_tqdm_batch": False,
        },
        random_seed=seed,
        device=device,
    )


def extract_metrics(result: PipelineResult) -> dict[str, float]:
    """Pull the committed metrics (:data:`METRIC_KEYS`) out of a pipeline result."""
    return {key: float(result.get_metric(key)) for key in METRIC_KEYS}


def entity_embeddings(result: PipelineResult) -> np.ndarray:
    """Trained entity-embedding matrix, row-aligned to the entity id map.

    Returns the raw entity representation (real for TransE, ``complex64`` for
    ComplEx/RotatE — preserved as-is; ``np.save`` round-trips complex, and the dtype
    is recorded in the export metadata so a consumer knows what it is).
    """
    representation = result.model.entity_representations[0]()
    return representation.detach().cpu().numpy()


def train_baseline(
    model: str,
    training: TriplesFactory,
    validation: TriplesFactory,
    testing: TriplesFactory,
    *,
    seed: int = BASELINE_SEED,
    embedding_dim: int = DEFAULT_EMBEDDING_DIM,
    num_epochs: int = DEFAULT_NUM_EPOCHS,
    device: str = "cpu",
) -> BaselineOutcome:
    """Train one baseline end-to-end and package its metrics + embeddings."""
    result = run_pipeline(
        model,
        training,
        validation,
        testing,
        seed=seed,
        embedding_dim=embedding_dim,
        num_epochs=num_epochs,
        device=device,
    )
    return BaselineOutcome(
        model=model,
        metrics=extract_metrics(result),
        embeddings=entity_embeddings(result),
        embedding_dim=embedding_dim,
        num_epochs=num_epochs,
        seed=seed,
        device=device,
    )


def generate_predictions(
    result: PipelineResult,
    testing: TriplesFactory,
    *,
    top_k: int = 1,
) -> list[Triple]:
    """The model's top-``k`` head- and tail-completions of each test query.

    For every test triple ``(h, r, t)`` this scores the tail query ``(h, r, ?)`` and
    the head query ``(?, r, t)`` over the full entity vocabulary and keeps the ``k``
    best-ranked completions in each direction. The union (deduplicated, sorted) is the
    model's *predicted* edge set — the input the logical-consistency checker
    (:mod:`pinakes_ml.consistency`) ratchets. ``top_k=1`` (the single best guess)
    keeps the committed predictions file small + stable.

    Torch/pykeen are imported lazily here so ``import pinakes_ml`` stays light.
    """
    from pykeen.predict import predict_target

    from pinakes_ml.triples import Triple

    preds: set[Triple] = set()
    tail_seen: set[tuple[str, str]] = set()
    head_seen: set[tuple[str, str]] = set()
    for head, rel, tail in testing.triples:
        if (head, rel) not in tail_seen:
            tail_seen.add((head, rel))
            df = predict_target(
                model=result.model, head=head, relation=rel, triples_factory=testing
            ).df
            for label in df["tail_label"].head(top_k):
                preds.add(Triple(relation=rel, head=head, tail=str(label)))
        if (rel, tail) not in head_seen:
            head_seen.add((rel, tail))
            df = predict_target(
                model=result.model, relation=rel, tail=tail, triples_factory=testing
            ).df
            for label in df["head_label"].head(top_k):
                preds.add(Triple(relation=rel, head=str(label), tail=tail))
    return sorted(preds)


def _fmt(value: float) -> str:
    """Metric formatting for the committed doc — 4 dp, so reruns diff cleanly."""
    return f"{value:.4f}"


def render_baselines_doc(
    outcomes: list[BaselineOutcome],
    *,
    corpus_hash: str,
    manifest_sha256: str,
    triples_sha256: str,
    counts: dict[str, int],
    split_counts: dict[str, int],
    consistency: list[dict[str, object]] | None = None,
    predictions_top_k: int | None = None,
    kgqa_section: str | None = None,
) -> str:
    """Render the committed ``docs/ml-baselines.md`` — a **pure** function of numbers.

    No wall-clock or environment data, so re-running a pinned baseline produces a
    byte-identical doc (a git no-op) and an unintended metric/corpus change shows up
    as a clean diff. Hyperparameters are read off the first outcome (the CLI trains
    every model with the same seed/dim/epochs/device).

    ``consistency`` (US-005) is an optional list of per-model rows
    (``{"model", "numPredictions", "counts": {descentCycles, schemaTypeBreaches,
    asymmetryViolations}}``); when supplied, the logical-consistency counts are
    reported in the same doc, alongside the link-prediction metrics.

    ``kgqa_section`` (US-004) is the tier-3 KGQA-accuracy block (owned by
    ``pinakes-eval-kgqa``, wrapped in its ``KGQA-EVAL`` markers). This CLI
    rewrites the doc from scratch, so it re-appends the existing block verbatim to
    avoid clobbering the tier-3 results a separate CLI wrote.
    """
    head = outcomes[0]
    lines: list[str] = [
        "# ML link-prediction baselines (Phase 2, US-003)",
        "",
        "TransE / ComplEx / RotatE knowledge-graph embedding baselines trained on the",
        "committed triples splits (US-002). These establish the **metric floor** all",
        "future corpus growth and neurosymbolic work is judged against — so every",
        "number below is pinned to an exact corpus version, split manifest, and seed.",
        "",
        "> Regenerated by `uv run pinakes-train-baselines` (see *Reproduce*).",
        "> This file is committed; the trained embeddings and MLflow runs are not"
        " (both git-ignored, regenerable).",
        "",
        "## Corpus & split version",
        "",
        "| Artifact | Hash |",
        "| --- | --- |",
        f"| Canonical export (`build/corpus`, tree sha256) | `{corpus_hash}` |",
        "| Split manifest (`ml/manifests/triples-split-manifest.json`, sha256) |"
        f" `{manifest_sha256}` |",
        f"| Triples content (`triplesSha256`) | `{triples_sha256}` |",
        "",
        f"- Triples: **{counts['triples']}** "
        f"(train {split_counts['train']} / valid {split_counts['valid']} /"
        f" test {split_counts['test']}), "
        f"**{counts['entities']}** entities, **{counts['relations']}** relations.",
        f"- Seed: **{head.seed}** · device: **{head.device}** ·"
        f" embedding_dim: **{head.embedding_dim}** · epochs: **{head.num_epochs}**.",
        "",
        "## Results",
        "",
        "Filtered link-prediction metrics (both sides, realistic rank) on the **test**",
        "split, evaluated against the full entity vocabulary.",
        "",
        "| Model | MRR | Hits@1 | Hits@3 | Hits@10 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for outcome in outcomes:
        m = outcome.metrics
        lines.append(
            f"| {outcome.model} | {_fmt(m['mrr'])} | {_fmt(m['hits@1'])} |"
            f" {_fmt(m['hits@3'])} | {_fmt(m['hits@10'])} |"
        )
    lines += [
        "",
        "> The corpus is small and sparse (≈one triple per entity) and the splits are",
        "> grouped by unordered entity pair to prevent inverse leakage, so many test",
        "> entities are unseen in training — these are a deliberately conservative",
        "> floor, not a tuned result. Corpus growth should move them up.",
        "",
    ]
    if consistency is not None:
        top_k = predictions_top_k if predictions_top_k is not None else 1
        lines += [
            "## Logical consistency (US-005)",
            "",
            f"Each baseline's top-{top_k} link predictions (both directions, per test",
            "triple) are checked against the symbolic rules — **descent acyclicity**,",
            "canonical-schema **from/to type** constraints"
            " (`contracts/canonical-schema.json`),",
            "and relation **antisymmetry** — by"
            " `pinakes_ml.consistency`. The violation",
            "counts are ratcheted in CI against"
            " `ml/manifests/consistency-baseline.json`",
            "(a monotone gate, mirroring `docs/convergence-qa-baseline.json`); a"
            " deliberate",
            "rise is re-baselined with"
            " `uv run pinakes-check-consistency --write-baseline`.",
            "",
            "| Model | Predictions | Descent cycles | Schema type breaches |"
            " Asymmetry violations |",
            "| --- | --- | --- | --- | --- |",
        ]
        for row in consistency:
            c = row["counts"]  # type: ignore[index]
            lines.append(
                f"| {row['model']} | {row['numPredictions']} |"
                f" {c['descentCycles']} | {c['schemaTypeBreaches']} |"  # type: ignore[index]
                f" {c['asymmetryViolations']} |"  # type: ignore[index]
            )
        lines += [
            "",
            "> Predictions are the model's single best (top-1) head- and"
            " tail-completions of",
            "> each test query (`ml/predictions/<model>.tsv`, committed). A"
            " deliberately",
            "> conservative floor: with a near-random baseline most predictions are"
            " schema-",
            "> plausible high-degree nodes, so violations start low — the ratchet"
            " guarantees",
            "> future models (and corpus growth) never make the predictions"
            " *less* logically",
            "> consistent without review.",
            "",
        ]
    lines += [
        "## Trained embeddings",
        "",
        "Each model's entity-embedding matrix is exported to",
        "`ml/data/embeddings/<model>/entity_embeddings.npy` (row-aligned to",
        "`ml/data/triples/entities.tsv` index order) with a `metadata.json` sidecar,",
        "kept under the git-ignored `ml/data` for reuse (GraphRAG, the Scallop pilot).",
        "",
        "## Reproduce",
        "",
        "```bash",
        "cd ml",
        "uv run pinakes-export-triples    # rebuild the git-ignored splits",
        "uv run pinakes-train-baselines   # train all 3, log MLflow, rewrite doc",
        "```",
        "",
        "Metrics are logged to the `pinakes-baselines` MLflow experiment"
        " (local file backend; `uv run mlflow ui`).",
        "",
    ]
    if kgqa_section:
        # Re-append the tier-3 KGQA block verbatim (already marker-wrapped +
        # trailing newline) so a baselines re-run preserves it.
        return "\n".join(lines) + "\n" + kgqa_section.rstrip("\n") + "\n"
    return "\n".join(lines)
