"""Admission tests for the KFT finetune-job adapter (90-finetune-provider US-1).

What these hold:

* the **golden fixture admits** — ``ml/fixtures/kft/finetune-job.json`` maps onto
  a valid :class:`~pinakes_ml.slm_finetune.SlmPilotConfig` with the job's
  hyperparameters actually applied (a mapping table that silently drops half the
  job is worse than no mapping at all);
* the **specialization is enforced** — every ``modality × method`` refusal path
  (FT-F) raises with its own code and a report, before any compute;
* the **base model is an entity** — the ``pinakes:model:…`` id resolves to its
  Hub coordinate through the committed external anchor (FT-G), and an unanchored
  or unknown base is refused;
* the **run anchor carries seed + config_hash** (FT-C);
* the **egress gate holds (KFT §4.2)** — the effective class folds every training
  record together with the base's own, a cross-boundary ``compute.class`` is
  refused with a report rather than downgraded, and an input the gate cannot
  classify is refused rather than guessed at;
* the module stays in the **slim env** — no heavy import, asserted in a
  subprocess, and the ``require_finetune_deps`` gate is untouched.

Everything here runs on committed files: no DVC corpus, no network, no model.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from pinakes_ml.kft import (
    DEFAULT_BASE_MODELS,
    DEFAULT_JOB_FIXTURE,
    HF_ANCHOR_PREFIX,
    KFT_VERSION,
    LICENSE_CLASS_ORDER,
    LICENSE_CLASSES,
    METHODS,
    MODALITIES,
    MODALITY_METHODS,
    PROVIDER_METHODS,
    PROVIDER_MODALITY,
    TIER_EGRESS,
    AdmittedJob,
    BaseModelAnchor,
    FinetuneJob,
    JobRejected,
    admit,
    engine_config_hash,
    license_class_of,
    load_base_models,
    map_hyperparams,
    most_restrictive_egress,
    most_restrictive_license,
    resolve_base_model,
)
from pinakes_ml.slm_finetune import SlmPilotConfig

_ML_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def payload() -> dict[str, Any]:
    return json.loads(DEFAULT_JOB_FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def anchors() -> dict[str, BaseModelAnchor]:
    return load_base_models()


def _job(payload: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """A deep-ish copy of the golden fixture with top-level keys replaced."""
    return {**json.loads(json.dumps(payload)), **overrides}


# --- the golden fixture ---------------------------------------------------------


def test_the_golden_fixture_admits_to_a_pilot_config(payload, anchors) -> None:
    admitted = admit(payload, anchors=anchors)

    assert isinstance(admitted, AdmittedJob)
    assert isinstance(admitted.config, SlmPilotConfig)
    # The base model arrives as an ENTITY and leaves as a Hub coordinate (FT-G).
    assert admitted.job.base_model == "pinakes:model:qwen2.5-3b-instruct"
    assert admitted.config.base_model == "Qwen/Qwen2.5-3B-Instruct"
    assert admitted.config.run_name == "kft-ft-run-insimul-slm-9f2a"
    assert admitted.config.output_dir == "artifacts/kft/ft-run-insimul-slm-9f2a"


def test_the_jobs_hyperparameters_reach_the_config(payload, anchors) -> None:
    config = admit(payload, anchors=anchors).config
    hyper = payload["hyperparams"]

    assert config.num_train_epochs == float(hyper["epochs"])
    assert config.learning_rate == hyper["lr"]
    assert config.max_seq_length == hyper["max_seq_len"]
    assert config.lora_r == hyper["lora"]["r"]
    assert config.lora_alpha == hyper["lora"]["alpha"]
    assert config.lora_dropout == hyper["lora"]["dropout"]
    assert list(config.lora_target_modules) == hyper["lora"]["target_modules"]
    # qlora defaults to 4-bit; this job pins it off (bitsandbytes is CUDA-only
    # and the job asks for local-mps compute).
    assert config.load_in_4bit is False
    assert admit(_job(payload, hyperparams={}), anchors=anchors).config.load_in_4bit


def test_the_config_round_trips_and_resolves(payload, anchors) -> None:
    admitted = admit(payload, anchors=anchors)
    # Admission yields an ml/-relative config — the same shape a committed
    # configs/*.json holds — and path resolution stays on .resolved(base).
    assert not Path(admitted.config.output_dir).is_absolute()
    resolved = admitted.resolved(_ML_ROOT)
    assert Path(resolved.config.output_dir) == _ML_ROOT / admitted.config.output_dir
    assert Path(resolved.config.eval_manifest).is_absolute()
    # The engine config hash is taken BEFORE resolution, so it is host-independent.
    assert resolved.anchor.engine_config_hash == admitted.anchor.engine_config_hash
    assert engine_config_hash(admitted.config) == admitted.anchor.engine_config_hash
    assert SlmPilotConfig.from_dict(admitted.config.to_dict()) == admitted.config


def test_the_job_round_trips_through_the_wire_shape(payload) -> None:
    job = FinetuneJob.from_json(DEFAULT_JOB_FIXTURE)
    assert FinetuneJob.from_dict(job.to_dict()) == job
    assert job.to_dict() == payload


# --- the reproducibility anchor (KFT §5.2, FT-C) --------------------------------


def test_the_run_anchor_carries_seed_config_hash_and_inputs(payload, anchors) -> None:
    anchor = admit(payload, anchors=anchors).anchor

    assert anchor.kft_version == payload["kft_version"]
    assert anchor.job == payload["job"]
    assert anchor.seed == payload["seed"] == admit(payload, anchors=anchors).config.seed
    assert anchor.config_hash == payload["config_hash"]
    assert anchor.engine_config_hash.startswith("sha256-")
    # PROV `used`: every pinned input id, data then base (KFT §5.2).
    assert list(anchor.used) == [
        *payload["dataset"]["knowledge"],
        payload["base_model"],
    ]
    assert list(anchor.export) == payload["export"]
    assert anchor.compute_class == payload["compute"]["class"]
    assert json.dumps(anchor.as_dict(), sort_keys=True)


def test_a_seedless_job_falls_back_to_the_pilot_default(payload, anchors) -> None:
    seedless = _job(payload)
    del seedless["seed"]
    admitted = admit(seedless, anchors=anchors)
    assert admitted.config.seed == SlmPilotConfig().seed
    assert admitted.anchor.seed == SlmPilotConfig().seed
    assert admitted.anchor.config_hash == payload["config_hash"]


def test_the_engine_config_hash_moves_with_the_parameters(payload, anchors) -> None:
    base = admit(payload, anchors=anchors).anchor.engine_config_hash
    other = admit(
        _job(payload, hyperparams={**payload["hyperparams"], "epochs": 9}),
        anchors=anchors,
    ).anchor.engine_config_hash
    assert base != other


# --- modality x method: the specialization (KFT §3.1, FT-F) ---------------------


def test_the_provider_slice_is_narrower_than_the_kft_table() -> None:
    assert PROVIDER_MODALITY in MODALITIES
    assert set(PROVIDER_METHODS) < set(MODALITY_METHODS[PROVIDER_MODALITY])
    assert set(MODALITY_METHODS) == set(MODALITIES)
    for methods in MODALITY_METHODS.values():
        assert set(methods) <= set(METHODS)


@pytest.mark.parametrize(
    ("modality", "method", "code"),
    [
        # Nonsense pairs — not in the KFT §3.1 table at all.
        ("text-to-image", "dpo", "incompatible-modality-method"),
        ("text-to-video", "full", "incompatible-modality-method"),
        # Outside the vocabulary.
        ("audio-to-text", "lora", "unknown-modality"),
        ("text-generation", "rlhf", "unknown-method"),
        # Legitimate KFT jobs that belong to the GENERAL trainer.
        ("image-text-to-text", "qlora", "unsupported-modality"),
        ("text-generation", "dpo", "unsupported-method"),
        ("text-generation", "full", "unsupported-method"),
    ],
)
def test_an_incompatible_modality_method_is_rejected_at_admission(
    payload, anchors, modality, method, code
) -> None:
    with pytest.raises(JobRejected) as excinfo:
        admit(_job(payload, modality=modality, method=method), anchors=anchors)

    rejected = excinfo.value
    assert rejected.code == code
    report = rejected.report
    assert report["rejected"] is True
    assert report["provider"] == "pinakes"
    assert report["kftVersion"] == KFT_VERSION
    assert str(rejected)
    # A routing refusal names where the job SHOULD go; a nonsense pair does not.
    if code.startswith("unsupported-"):
        assert "agora" in str(rejected)


@pytest.mark.parametrize("method", PROVIDER_METHODS)
def test_every_supported_method_admits(payload, anchors, method) -> None:
    job = _job(payload, method=method)
    del job["hyperparams"]["load_in_4bit"]
    admitted = admit(job, anchors=anchors)
    assert admitted.job.method == method
    # 4-bit is the method's meaning, not an operator setting.
    assert admitted.config.load_in_4bit is (method == "qlora")


def test_a_multimodal_dataset_is_routed_away(payload, anchors) -> None:
    job = _job(payload)
    job["dataset"]["media"] = ["analyzer:asset:blake3-a1b2c3d4"]
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == "unsupported-dataset-plane"
    assert "agora" in str(excinfo.value)


def test_an_empty_dataset_is_rejected(payload, anchors) -> None:
    job = _job(payload)
    job["dataset"] = {"header": job["dataset"]["header"]}
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == "empty-dataset"


# --- the egress gate (KFT §4.2, NORMATIVE) --------------------------------------


def _open_corpus(job: dict[str, Any]) -> dict[str, Any]:
    """Re-tier the golden job's corpus as open data — the non-gated control.

    Everything pinakes actually trains on is containment-gated, so the only way
    to exercise the *other* branch of §4.2 is to hand it a corpus that is not.
    """
    job["dataset"]["header"] = {
        **job["dataset"]["header"],
        "tier": "curated",
        "license": "CC-BY-4.0",
    }
    return job


def test_the_golden_job_resolves_local_only(payload, anchors) -> None:
    decision = admit(payload, anchors=anchors).egress

    # synthetic tier -> containment-gated -> local-only, even though the BASE is
    # exportable: §4.2 takes the most restrictive input, not the average.
    assert decision.effective == "local-only"
    assert decision.local_only
    assert (decision.dataset_egress, decision.base_egress) == (
        "local-only",
        "exportable",
    )
    assert decision.tier == "synthetic"
    # The union license spans {data ∪ base} (§4.3, FT-B) and takes the strictest
    # class — a research-licensed base cannot make a proprietary corpus laxer.
    assert decision.licenses == (
        "LicenseRef-Insimul-Proprietary",
        "LicenseRef-Qwen-Research",
    )
    assert decision.license_class == "proprietary"
    assert decision.compute_class == payload["compute"]["class"]
    assert json.dumps(decision.as_dict(), sort_keys=True)


@pytest.mark.parametrize(
    "compute_class", ["single-gpu-a100-80gb", "managed-training-api", "cloud-h100"]
)
def test_a_local_only_run_refuses_cross_boundary_compute(
    payload, anchors, compute_class
) -> None:
    job = _job(payload)
    job["compute"]["class"] = compute_class
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)

    rejected = excinfo.value
    assert rejected.code == "cross-boundary-compute"
    assert rejected.detail["computeClass"] == compute_class
    assert rejected.detail["effective"] == "local-only"
    assert rejected.report["provider"] == "pinakes"
    # Rejected WITH A REPORT — never silently downgraded, never silently placed.
    assert "never bursts" in str(rejected)


def test_an_explicit_local_only_pin_is_honoured_as_a_floor(payload, anchors) -> None:
    # An all-exportable corpus that PINS local-only stays pinned (§4.2) …
    job = _open_corpus(_job(payload))
    job["compute"]["egress"] = "local-only"
    assert admit(job, anchors=anchors).egress.effective == "local-only"
    # … and the pin is then unsatisfiable on cross-boundary compute (FT-J):
    # refused at admission, never hung and never quietly cloud-placed.
    job["compute"]["class"] = "single-gpu-a100-80gb"
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == "cross-boundary-compute"


def test_an_exportable_assertion_is_verified_not_trusted(payload, anchors) -> None:
    job = _job(payload)
    job["compute"]["egress"] = "exportable"
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == "egress-assertion-violated"
    assert excinfo.value.detail["datasetEgress"] == "local-only"


def test_an_exportable_corpus_still_places_only_locally(payload, anchors) -> None:
    """The specialization: pinakes owns no cloud placement at all (KFT §9)."""
    job = _open_corpus(_job(payload))
    decision = admit(job, anchors=anchors).egress
    assert decision.effective == "exportable"
    assert decision.license_class == "non-commercial"  # from the base (FT-B)

    job["compute"]["class"] = "single-gpu-a100-80gb"
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    # A different fact from cross-boundary-compute: the job breaks no gate, this
    # provider simply is not the one to run it.
    assert excinfo.value.code == "unsupported-compute-class"
    assert "agora" in str(excinfo.value)


def test_a_header_egress_pin_overrides_the_tier(payload, anchors) -> None:
    job = _open_corpus(_job(payload))
    job["dataset"]["header"]["egress"] = "local-only"
    assert admit(job, anchors=anchors).egress.dataset_egress == "local-only"


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda h: h.pop("tier"), "unknown-tier"),
        (lambda h: h.update(tier="trusted"), "unknown-tier"),
        (lambda h: h.pop("license"), "unresolved-license"),
        (lambda h: h.update(license=""), "unresolved-license"),
        (lambda h: h.update(license="MegaCorp-EULA-7"), "unresolved-license"),
    ],
)
def test_the_gate_refuses_inputs_it_cannot_classify(
    payload, anchors, mutate, code
) -> None:
    """KGP §7/§7.1 forbid defaulting a tier or a license — so neither is guessed."""
    job = _job(payload)
    mutate(job["dataset"]["header"])
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == code


def test_a_headerless_dataset_cannot_be_gated(payload, anchors) -> None:
    job = _job(payload)
    del job["dataset"]["header"]
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == "missing-dataset-header"


def test_the_tier_and_license_tables_mirror_koine(anchors) -> None:
    # The KGP §7 tier vocabulary, vendored as data (koine provenance.schema.json
    # $defs/tier). A tier koine adds without a row here would be silently
    # unclassifiable — the mirror is the gate.
    assert set(TIER_EGRESS) == {"curated", "acquired", "synthetic", "personal"}
    # The two containment-gated tiers are exactly the local-only ones.
    assert {t for t, e in TIER_EGRESS.items() if e == "local-only"} == {
        "synthetic",
        "personal",
    }
    assert set(LICENSE_CLASSES.values()) <= set(LICENSE_CLASS_ORDER)
    # Every base in the committed registry classifies (§4.3 needs it).
    for anchor in anchors.values():
        assert license_class_of(anchor.license) == anchor.license_class


def test_the_restriction_ladders_take_the_strictest(payload) -> None:
    assert most_restrictive_egress(["exportable", "exportable"]) == "exportable"
    assert most_restrictive_egress(["exportable", "local-only"]) == "local-only"
    assert most_restrictive_egress([]) == "exportable"
    assert most_restrictive_license(["attribution", "proprietary"]) == "proprietary"
    assert most_restrictive_license(["personal", "attribution"]) == "personal"
    assert most_restrictive_license([]) == "public-domain"


# --- base-model entities + external anchors (KFT §5.1, FT-G) --------------------


def test_every_committed_slm_pilot_config_base_model_is_anchored(anchors) -> None:
    coordinates = {anchor.hf_coordinate for anchor in anchors.values()}
    configs = sorted((_ML_ROOT / "configs").glob("slm-pilot-*.json"))
    assert configs, "expected the committed slm-pilot configs"
    for path in configs:
        base = json.loads(path.read_text(encoding="utf-8"))["base_model"]
        assert base in coordinates, f"{path.name}: {base} has no minted entity"


def test_anchors_are_well_formed(anchors) -> None:
    registry = json.loads(DEFAULT_BASE_MODELS.read_text(encoding="utf-8"))
    assert registry["kftVersion"] == KFT_VERSION
    assert anchors
    for entity_id, anchor in anchors.items():
        assert entity_id.startswith("pinakes:model:")
        assert anchor.same_as.startswith(HF_ANCHOR_PREFIX)
        assert anchor.hf_coordinate and "/" in anchor.hf_coordinate
        assert anchor.modality in MODALITIES
        assert anchor.license and anchor.license_class
        assert anchor.egress in ("exportable", "local-only")
        assert resolve_base_model(entity_id, anchors) is anchor


def test_an_unknown_or_unanchored_base_model_is_refused(payload, anchors) -> None:
    with pytest.raises(JobRejected) as excinfo:
        admit(_job(payload, base_model="hf:model:Qwen/Qwen2.5-3B"), anchors=anchors)
    assert excinfo.value.code == "unknown-base-model"
    assert "configs/kft-base-models.json" in str(excinfo.value)

    unanchored = {"pinakes:model:mystery": BaseModelAnchor("pinakes:model:mystery", "")}
    with pytest.raises(JobRejected) as excinfo:
        admit(_job(payload, base_model="pinakes:model:mystery"), anchors=unanchored)
    assert excinfo.value.code == "unanchored-base-model"


def test_a_base_model_of_the_wrong_modality_is_refused(payload) -> None:
    mismatched = {
        payload["base_model"]: BaseModelAnchor(
            payload["base_model"],
            f"{HF_ANCHOR_PREFIX}Qwen/Qwen2.5-VL-3B-Instruct",
            modality="image-text-to-text",
        )
    }
    with pytest.raises(JobRejected) as excinfo:
        admit(payload, anchors=mismatched)
    assert excinfo.value.code == "base-model-modality-mismatch"


# --- structural validation (the schema's additionalProperties: false) -----------


@pytest.mark.parametrize(
    "mutate",
    [
        lambda j: j.update(gpu_hours=4),
        lambda j: j["dataset"].update(inline_records=[{"text": "no"}]),
        lambda j: j["compute"].update(region="us-east"),
        lambda j: j.update(compute={"egress": "derived"}),
        lambda j: j.update(job="not-a-kinp-id"),
        lambda j: j.update(seed="42"),
        lambda j: j["compute"].update(egress="public"),
        lambda j: j.pop("dataset"),
    ],
)
def test_a_malformed_job_is_rejected_not_coerced(payload, anchors, mutate) -> None:
    job = _job(payload)
    mutate(job)
    with pytest.raises(JobRejected) as excinfo:
        admit(job, anchors=anchors)
    assert excinfo.value.code == "malformed-job"


def test_a_newer_kft_minor_is_refused(payload, anchors) -> None:
    with pytest.raises(JobRejected) as excinfo:
        admit(_job(payload, kft_version="0.4.0"), anchors=anchors)
    assert excinfo.value.code == "unsupported-kft-version"
    # An older minor still admits — the contract is backward-compatible.
    assert admit(_job(payload, kft_version="0.2.0"), anchors=anchors)


# --- hyperparameters this engine does not implement are REPORTED ----------------


def test_unimplemented_hyperparams_are_reported_never_dropped(payload, anchors) -> None:
    job = _job(payload)
    job["hyperparams"] = {
        **job["hyperparams"],
        "optim": "adamw_8bit",
        "lora": {**job["hyperparams"]["lora"], "bias": "none"},
    }
    admitted = admit(job, anchors=anchors)
    assert admitted.ignored_hyperparams == ("lora.bias", "optim")
    # …and the ones it DOES implement still landed.
    assert admitted.config.lora_r == job["hyperparams"]["lora"]["r"]


def test_a_mistyped_hyperparam_is_rejected(anchors) -> None:
    overrides, ignored = map_hyperparams({"epochs": 2, "lr": 1e-4})
    assert overrides == {"num_train_epochs": 2.0, "learning_rate": 1e-4}
    assert ignored == ()
    with pytest.raises(JobRejected) as excinfo:
        map_hyperparams({"epochs": "three"})
    assert excinfo.value.code == "invalid-hyperparam"


# --- the slim-env invariant (ml/CLAUDE.md) --------------------------------------


def test_importing_kft_pulls_in_no_heavy_stack() -> None:
    """The adapter must load in the slim CI env — no torch/trl/peft.

    Checked in a subprocess because the heavy stack may already be imported by
    another test in this session; what matters is that *this* import does not
    pull it in.
    """
    probe = (
        "import sys, pinakes_ml.kft;"
        "print([m for m in ('torch','trl','peft','transformers','datasets')"
        " if m in sys.modules])"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "[]", result.stdout
