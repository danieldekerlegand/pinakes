"""Unit + smoke tests for the PyKEEN baselines (US-003).

Two tiers, mirroring the workspace pattern:

* **Pure / tiny-fixture tests run everywhere (incl. CI).** ``render_baselines_doc``
  is a pure function of numbers, and the training *smoke* trains a tiny in-memory
  factory for one epoch — the "training scripts smoke-tested on a tiny fixture in CI"
  acceptance. Kept small (dim 2, 1 epoch) so CI stays fast.
* **A live gate** trains one baseline on the committed splits for a single epoch,
  SKIPPED when the DVC-tracked ``ml/data/triples`` is absent (as it is in CI). Full,
  many-epoch runs are local-only via the CLI.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from linguascrape_ml.baselines import (
    BASELINE_SEED,
    METRIC_KEYS,
    BaselineOutcome,
    load_label_to_id,
    render_baselines_doc,
    train_baseline,
)
from linguascrape_ml.train_baselines import (
    DEFAULT_DATA_DIR,
    read_dvc_md5,
    save_embeddings,
    sha256_file,
)


def _tiny_factories():
    """Six-entity / two-relation toy graph with a shared vocab across splits."""
    from pykeen.triples import TriplesFactory

    entity_to_id = {c: i for i, c in enumerate(["a", "b", "c", "d", "e", "f"])}
    relation_to_id = {"R": 0, "S": 1}

    def mk(rows):
        return TriplesFactory.from_labeled_triples(
            np.array(rows, dtype=str),
            entity_to_id=entity_to_id,
            relation_to_id=relation_to_id,
        )

    training = mk(
        [["a", "R", "b"], ["b", "R", "c"], ["c", "R", "d"],
         ["a", "S", "c"], ["d", "R", "e"], ["e", "R", "a"], ["f", "R", "a"]]
    )
    validation = mk([["a", "R", "c"], ["b", "S", "d"]])
    testing = mk([["c", "R", "e"], ["d", "S", "a"]])
    return training, validation, testing


# --- vocab loading ------------------------------------------------------------


def test_load_label_to_id(tmp_path: Path) -> None:
    p = tmp_path / "entities.tsv"
    p.write_text("0\talpha\n1\tbeta\n2\tgamma\n", encoding="utf-8")
    assert load_label_to_id(p) == {"alpha": 0, "beta": 1, "gamma": 2}


# --- training smoke (runs in CI) ----------------------------------------------


def test_train_baseline_smoke() -> None:
    training, validation, testing = _tiny_factories()
    outcome = train_baseline(
        "TransE",
        training,
        validation,
        testing,
        embedding_dim=2,
        num_epochs=1,
        device="cpu",
    )
    assert set(outcome.metrics) == set(METRIC_KEYS)
    for value in outcome.metrics.values():
        assert isinstance(value, float)
        assert 0.0 <= value <= 1.0
    # Embeddings are row-aligned to the 6-entity vocab, real for TransE.
    assert outcome.embeddings_shape == (6, 2)
    assert outcome.seed == BASELINE_SEED


def test_save_embeddings_round_trips(tmp_path: Path) -> None:
    training, validation, testing = _tiny_factories()
    outcome = train_baseline(
        "TransE", training, validation, testing,
        embedding_dim=2, num_epochs=1, device="cpu",
    )
    model_dir = save_embeddings(tmp_path, outcome, {"corpus_md5": "deadbeef"})
    loaded = np.load(model_dir / "entity_embeddings.npy")
    assert loaded.shape == (6, 2)
    import json

    meta = json.loads((model_dir / "metadata.json").read_text(encoding="utf-8"))
    assert meta["model"] == "TransE"
    assert meta["shape"] == [6, 2]
    assert meta["corpus_md5"] == "deadbeef"
    assert meta["entities_order"].startswith("ml/data/triples/entities.tsv")


# --- pure doc rendering -------------------------------------------------------


def _outcome(model: str, mrr: float) -> BaselineOutcome:
    return BaselineOutcome(
        model=model,
        metrics={"mrr": mrr, "hits@1": 0.0, "hits@3": 0.1, "hits@10": 0.25},
        embeddings=np.zeros((2, 2), dtype=np.float32),
        embedding_dim=64,
        num_epochs=100,
        seed=BASELINE_SEED,
        device="cpu",
    )


def test_render_baselines_doc_is_deterministic() -> None:
    outcomes = [
        _outcome("TransE", 0.1234),
        _outcome("ComplEx", 0.2),
        _outcome("RotatE", 0.3),
    ]
    kwargs = dict(
        corpus_md5="abc123",
        manifest_sha256="deadbeef",
        triples_sha256="cafef00d",
        counts={"triples": 2267, "entities": 2057, "relations": 8},
        split_counts={"train": 1815, "valid": 227, "test": 225},
    )
    doc = render_baselines_doc(outcomes, **kwargs)
    assert render_baselines_doc(outcomes, **kwargs) == doc  # pure
    assert "| TransE | 0.1234 |" in doc
    assert "`abc123`" in doc
    assert "`deadbeef`" in doc
    # Corpus counts + hyperparameters recorded.
    assert "2267" in doc and "2057" in doc
    assert str(BASELINE_SEED) in doc


def test_render_baselines_doc_preserves_kgqa_section() -> None:
    """A tier-3 block (US-004) is re-appended verbatim, absent by default."""
    outcomes = [_outcome("TransE", 0.1)]
    kwargs = dict(
        corpus_md5="abc",
        manifest_sha256="def",
        triples_sha256="ghi",
        counts={"triples": 1, "entities": 1, "relations": 1},
        split_counts={"train": 1, "valid": 0, "test": 0},
    )
    assert "KGQA-EVAL" not in render_baselines_doc(outcomes, **kwargs)
    block = "<!-- KGQA-EVAL:START -->\ntier 3 numbers\n<!-- KGQA-EVAL:END -->"
    with_block = render_baselines_doc(outcomes, **kwargs, kgqa_section=block)
    assert with_block.count("KGQA-EVAL:START") == 1
    assert with_block.rstrip().endswith("<!-- KGQA-EVAL:END -->")


# --- .dvc / hash helpers ------------------------------------------------------


def test_read_dvc_md5(tmp_path: Path) -> None:
    dvc = tmp_path / "x.dvc"
    dvc.write_text(
        "outs:\n- md5: e418c976755c57876e0be1438c6295b7.dir\n  hash: md5\n",
        encoding="utf-8",
    )
    assert read_dvc_md5(dvc) == "e418c976755c57876e0be1438c6295b7.dir"
    assert read_dvc_md5(tmp_path / "missing.dvc") == "unknown"


def test_sha256_file(tmp_path: Path) -> None:
    p = tmp_path / "f.txt"
    p.write_bytes(b"hello")
    assert sha256_file(p) == (
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )


# --- live gate: train on the committed splits (skipped when absent) -----------


@pytest.mark.skipif(
    not (DEFAULT_DATA_DIR / "train.tsv").exists(),
    reason="triples splits not present (DVC-tracked; run `dvc pull` locally)",
)
def test_baseline_runs_on_committed_splits() -> None:
    """One epoch on the real splits — proves the loader → pipeline path works."""
    from linguascrape_ml.baselines import load_split_factories

    training, validation, testing = load_split_factories(DEFAULT_DATA_DIR)
    outcome = train_baseline(
        "TransE", training, validation, testing,
        embedding_dim=8, num_epochs=1, device="cpu",
    )
    assert set(outcome.metrics) == set(METRIC_KEYS)
    # Embeddings cover the full committed entity vocab.
    n_entities = training.num_entities
    assert outcome.embeddings_shape[0] == n_entities
