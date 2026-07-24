"""KFT run outputs — telemetry, the minted model, its weight assets (90 US-2).

The other half of the provider that :mod:`pinakes_ml.kft` opens. Admission
decides *whether* a job runs and what config it becomes; this module describes
what the run **emitted**, in the ecosystem's terms:

* the **training-telemetry stream** (KFT §6) — ``{job, step, metrics,
  checkpoint?, samples?, ts}`` events built from the trainer's own per-step log
  (``TrainOutcome.log_history``) plus a tier-4 adherence point per scored stage,
  and a terminal event carrying the minted model, its weight assets and the
  resolved eval results;
* the tuned model as a **minted KINP ``model`` entity** (KFT §5.1/§5.2) with
  ``based_on``/``derived_from`` its base and a PROV activity record pinning
  ``used`` / ``generated`` / ``seed`` / ``config_hash``;
* every adapter / merged / GGUF artifact as a **KMI weight asset** (KFT §5.3) —
  ``media:derived_from`` up the merge chain, ``media:variant_of`` for the
  quantization — reusing the paths :mod:`pinakes_ml.slm_gguf` already lays out.

The rule that ties them together is **KFT §5.4 (FT-A)**: the model and every
asset inherit the run's most-restrictive egress class and union license class
from :class:`~pinakes_ml.kft.EgressDecision`. Pinakes's corpora are
containment-gated, so in practice that is ``local-only`` — the tuned model is a
git/DVC-local artifact that :func:`check_publishable` refuses to hand to a
cross-boundary destination. Half a gate (§4.2 alone) would let a model trained on
private data walk out carrying what it memorized.

Three deliberate constraints, all of them the existing house style:

* **Pure, and no wall clock.** Every ``ts`` is a parameter, not a
  ``datetime.now()`` — the CLI supplies it, tests pin it, and the stream is
  byte-reproducible for a given run. Nothing here imports the heavy stack.
* **Nothing is minted for bytes that do not exist.** A requested export that was
  not produced is *reported* (:attr:`RunOutputs.pending_exports`), never given a
  placeholder id — an asset id is a content address or it is a lie.
* **A stub run says so.** The CI smoke's telemetry is well-formed and
  step-accurate but carries no loss (:func:`~pinakes_ml.slm_finetune.
  stub_log_history`), because a fabricated loss curve is exactly what KFT §6
  exists to replace.

CLI: ``pinakes-train-slm --kft-job`` (:mod:`pinakes_ml.train_slm`).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pinakes_ml.kft import (
    KFT_VERSION,
    AdmittedJob,
    EgressDecision,
    JobRejected,
)
from pinakes_ml.slm_finetune import TrainOutcome

#: Bumped when the telemetry event / run-record shape changes.
RUN_RECORD_VERSION = "1"

#: The namespace pinakes mints its own entities and assets in.
NAMESPACE = "pinakes"

#: The signing agent recorded on the PROV activity (KFT §5.2/§7) — the training
#: provider, not the job's author.
DEFAULT_AGENT = f"{NAMESPACE}:org:ml"

#: KFT §6 lifecycle, reusing the names Cuneiform's engine already models.
LIFECYCLE_STATES: tuple[str, ...] = (
    "pending",
    "running",
    "succeeded",
    "failed",
    "canceled",
)
TERMINAL_STATES: tuple[str, ...] = ("succeeded", "failed", "canceled")


# --- telemetry (KFT §6) ---------------------------------------------------------

#: trl/transformers log key → the KFT §6 metric name. The §6 example spells the
#: training loss ``train_loss`` and the schedule ``lr``; the trainer spells them
#: ``loss`` and ``learning_rate``. Everything else numeric passes through under
#: its own name (``grad_norm``, ``epoch``, ``eval_loss``, …) rather than being
#: dropped — same "report what you do not translate" discipline as
#: :func:`pinakes_ml.kft.map_hyperparams`.
METRIC_NAMES: dict[str, str] = {
    "loss": "train_loss",
    "learning_rate": "lr",
}


#: The three event kinds this provider emits, and the ``event_id`` prefix each
#: gets. KFT §6 addresses an event by ``job`` + ``step`` alone, which assumes one
#: event per step; this pipeline emits a *training* row, an *eval* row (tier-4
#: adherence per scored stage) and a *terminal* row, and the last two share a
#: step with the last training row. So the address carries the kind too —
#: otherwise "idempotent under redelivery" would silently coalesce three
#: different events. Worth proposing upstream as a §6 clarification.
KIND_TRAIN = "train"
KIND_EVAL = "eval"
KIND_TERMINAL = "terminal"


@dataclass(frozen=True)
class TelemetryEvent:
    """One KFT §6 training-telemetry event.

    Idempotent under redelivery by construction: :attr:`event_id` addresses the
    event by ``job`` + ``kind`` + ``step``, so a consumer that sees an event
    twice sees the same id and can drop the duplicate without an exactly-once
    transport (KCB §4).

    ``checkpoint``/``samples`` are the spec's optionals — this provider produces
    neither today (it saves one adapter at the end, and rule authoring has no
    preview media), so they stay empty rather than being filled with something
    that is not a KMI asset.
    """

    job: str
    step: int
    metrics: Mapping[str, float] = field(default_factory=dict)
    ts: str = ""
    checkpoint: str | None = None
    samples: tuple[str, ...] = ()
    #: :data:`KIND_TRAIN` / ``eval:<stage>`` / :data:`KIND_TERMINAL`.
    kind: str = KIND_TRAIN
    #: ``running`` for a progress event; a :data:`TERMINAL_STATES` member on the
    #: completion event, which also carries :attr:`result`.
    state: str = "running"
    #: The §6 completion payload — model id, weight asset ids, eval results.
    result: Mapping[str, Any] | None = None

    @property
    def event_id(self) -> str:
        """The content address of this event: ``<job>#<kind>:<step>``."""
        return f"{self.job}#{self.kind}:{self.step}"

    def as_dict(self) -> dict[str, Any]:
        """The wire shape — absent optionals are omitted, never nulled."""
        payload: dict[str, Any] = {
            "job": self.job,
            "step": self.step,
            "metrics": {k: self.metrics[k] for k in sorted(self.metrics)},
            "ts": self.ts,
            "kind": self.kind,
            "state": self.state,
            "eventId": self.event_id,
        }
        if self.checkpoint is not None:
            payload["checkpoint"] = self.checkpoint
        if self.samples:
            payload["samples"] = list(self.samples)
        if self.result is not None:
            payload["result"] = dict(self.result)
        return payload


def _numeric(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def step_metrics(row: Mapping[str, Any]) -> dict[str, float]:
    """The KFT §6 ``metrics`` block for one trainer log row."""
    metrics: dict[str, float] = {}
    for key, value in row.items():
        if key == "step":
            continue
        number = _numeric(value)
        if number is not None:
            metrics[METRIC_NAMES.get(key, key)] = number
    return metrics


def training_events(
    job: str, outcome: TrainOutcome, *, ts: str
) -> tuple[TelemetryEvent, ...]:
    """The per-step half of the stream, replayed from the trainer's own log.

    ``ml/``'s trainer is a batch process, not a live streamer: the log rows are
    read off ``trainer.state.log_history`` once training returns, so every event
    carries the run's **emission** timestamp rather than a per-step one. That is
    stated here rather than interpolated — a made-up per-step clock would be the
    same class of fiction as a made-up loss.
    """
    events: list[TelemetryEvent] = []
    for index, row in enumerate(outcome.log_history, start=1):
        step = row.get("step")
        events.append(
            TelemetryEvent(
                job=job,
                step=int(step) if isinstance(step, int) else index,
                metrics=step_metrics(row),
                ts=ts,
            )
        )
    return tuple(events)


def stage_events(
    job: str,
    scores: Mapping[str, Mapping[str, Mapping[str, Any]]],
    *,
    ts: str,
    final_step: int,
) -> dict[str, TelemetryEvent]:
    """The adherence half of the stream: one event per scored stage.

    The pipeline measures tier-4 rule adherence twice — the untuned base and the
    tuned model — so the honest "adherence curve" is those two points, at step 0
    and at the last training step. Metrics are flattened ``<arm>.<metric>`` so a
    subscriber reading the §6 ``metrics`` map needs no nesting.

    Keyed by stage so the caller can put the untuned point *before* the training
    rows and the tuned point after them — a stream whose steps run backwards is
    not a curve.
    """
    events: dict[str, TelemetryEvent] = {}
    for stage, step in (("untuned", 0), ("finetuned", final_step)):
        arms = scores.get(stage)
        if not arms:
            continue
        metrics: dict[str, float] = {}
        for arm, values in arms.items():
            for key, value in values.items():
                number = _numeric(value)
                if number is not None:
                    metrics[f"{arm}.{key}"] = number
        events[stage] = TelemetryEvent(
            job=job,
            step=step,
            metrics=metrics,
            ts=ts,
            kind=f"{KIND_EVAL}:{stage}",
        )
    return events


# --- weight & export assets (KFT §5.3) ------------------------------------------

MEDIA_TYPE_SAFETENSORS = "application/vnd.koine.model+safetensors"
MEDIA_TYPE_GGUF = "application/vnd.koine.model+gguf"

REL_DERIVED_FROM = "media:derived_from"
REL_VARIANT_OF = "media:variant_of"

ROLE_ADAPTER = "adapter"
ROLE_MERGED = "merged-fp16"
ROLE_GGUF = "gguf"

#: The KFT §5.3 export matrix as data: role → (media type, lineage relation, the
#: roles it links back to). ``base`` is not a role but the *base-model entity* —
#: pinakes never mints an asset for weights it does not hold, so the adapter's
#: ``media:derived_from`` points at the entity whose external anchor resolves to
#: the Hub bytes (KFT §5.1, FT-G).
ARTIFACT_SPECS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    ROLE_ADAPTER: (MEDIA_TYPE_SAFETENSORS, REL_DERIVED_FROM, ("base",)),
    ROLE_MERGED: (MEDIA_TYPE_SAFETENSORS, REL_DERIVED_FROM, (ROLE_ADAPTER, "base")),
    ROLE_GGUF: (MEDIA_TYPE_GGUF, REL_VARIANT_OF, (ROLE_MERGED,)),
}

#: Minting order — a lineage link may only name an asset already minted.
ARTIFACT_ORDER: tuple[str, ...] = (ROLE_ADAPTER, ROLE_MERGED, ROLE_GGUF)

#: KFT §3 ``export`` string → the role it asks for. The variant suffix
#: (``gguf:Q4_K_M``) is split off and recorded on the asset.
EXPORT_ROLES: dict[str, str] = {
    "safetensors-adapter": ROLE_ADAPTER,
    "adapter": ROLE_ADAPTER,
    "merged-fp16": ROLE_MERGED,
    "safetensors": ROLE_MERGED,
    "gguf": ROLE_GGUF,
}


def content_digest(path: Path | str) -> tuple[str, int]:
    """``(sha256, sizeBytes)`` of a file — or of a directory, as a tree address.

    A GGUF is one file; a LoRA adapter and a merged checkpoint are directories.
    A directory's address is the sha256 over its sorted ``<relpath>\\n<sha256>``
    lines, so it is stable across hosts and changes whenever any member does —
    the same shape DVC gives a tracked tree. Reuses
    :func:`pinakes_ml.slm_gguf.file_identity` for the per-file leg so there is
    one place that knows how an artifact is hashed.
    """
    from pinakes_ml.slm_gguf import file_identity

    path = Path(path)
    if path.is_file():
        identity = file_identity(path)
        return str(identity["sha256"]), int(identity["sizeBytes"] or 0)
    digest = hashlib.sha256()
    total = 0
    for member in sorted(p for p in path.rglob("*") if p.is_file()):
        identity = file_identity(member)
        digest.update(
            f"{member.relative_to(path).as_posix()}\n{identity['sha256']}\n".encode()
        )
        total += int(identity["sizeBytes"] or 0)
    return digest.hexdigest(), total


def mint_asset_id(sha256: str) -> str:
    """A KMI asset's KINP CURIE — content-addressed, unlike the model (FT-C)."""
    return f"{NAMESPACE}:asset:sha256-{sha256}"


@dataclass(frozen=True)
class WeightAsset:
    """One minted KMI weight/export asset, with its lineage and inheritance."""

    asset_id: str
    role: str
    media_type: str
    relation: str
    derived_from: tuple[str, ...]
    #: KFT §5.4 (FT-A): inherited from the run, never re-derived downstream.
    egress: str
    license_class: str
    licenses: tuple[str, ...]
    size_bytes: int
    #: ``ml/``-relative where possible; nothing machine-local ships (§5.4).
    path: str
    #: The quantization / variant suffix off the ``export`` string, if any.
    variant: str = ""

    @property
    def content_hash(self) -> str:
        """koine ``provenance.schema.json#/$defs/assetId`` spelling."""
        return "sha256:" + self.asset_id.rsplit("sha256-", 1)[-1]

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "assetId": self.asset_id,
            "contentHash": self.content_hash,
            "role": self.role,
            "mediaType": self.media_type,
            "lineage": {self.relation: list(self.derived_from)},
            "egress": self.egress,
            "licenseClass": self.license_class,
            "licenses": list(self.licenses),
            "sizeBytes": self.size_bytes,
            "path": self.path,
        }
        if self.variant:
            payload["variant"] = self.variant
        return payload


# --- the model entity + its PROV activity (KFT §5.1/§5.2) -----------------------


def mint_model_id(admitted: AdmittedJob) -> str:
    """Mint the tuned model's KINP entity id from the **run**, not the bytes.

    KFT §5.2/FT-C: GPU nondeterminism rules out content-addressing a finetuned
    model, so the id is minted off the reproducibility anchor that *is* stable —
    the base entity and the job's PROV activity. Two runs are two activities and
    therefore two model entities; re-deriving the id for one activity is
    idempotent, which is what makes the whole record replayable.
    """
    base_local = admitted.anchor.base_model.entity_id.split(":", 2)[-1]
    return f"{NAMESPACE}:model:{base_local}-{admitted.job.slug}"


@dataclass(frozen=True)
class ModelEntity:
    """The tuned model as a minted KINP ``model`` entity (KFT §5.1)."""

    entity_id: str
    modality: str
    based_on: str
    derived_from: str
    kft_version: str
    #: KFT §5.4 (FT-A) inheritance — the whole point of minting this record.
    egress: str
    license_class: str
    licenses: tuple[str, ...]
    #: KGP §7 trust tier of the training corpus — descriptive, recorded per §4.3.
    tier: str

    @property
    def local_only(self) -> bool:
        return self.egress == "local-only"

    def lineage_facts(self) -> tuple[str, ...]:
        """The KINP §4 lifecycle relations, in the spec's own Prolog spelling."""
        return (
            f"based_on({self.entity_id}, {self.based_on}).",
            f"derived_from({self.entity_id}, {self.derived_from}).",
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "entityId": self.entity_id,
            "kind": "model",
            "modality": self.modality,
            "basedOn": self.based_on,
            "derivedFrom": self.derived_from,
            "kftVersion": self.kft_version,
            "egress": self.egress,
            "licenseClass": self.license_class,
            "licenses": list(self.licenses),
            "tier": self.tier,
            "localOnly": self.local_only,
            "lineage": list(self.lineage_facts()),
        }


def mint_model(admitted: AdmittedJob) -> ModelEntity:
    """The minted model entity, inheriting the admission's §4.2/§5.4 verdict."""
    decision: EgressDecision = admitted.egress
    base = admitted.anchor.base_model
    return ModelEntity(
        entity_id=mint_model_id(admitted),
        modality=admitted.job.modality,
        based_on=base.entity_id,
        derived_from=base.entity_id,
        kft_version=admitted.job.kft_version or KFT_VERSION,
        egress=decision.effective,
        license_class=decision.license_class,
        licenses=decision.licenses,
        tier=decision.tier,
    )


def mint_weight_assets(
    admitted: AdmittedJob,
    model: ModelEntity,
    artifacts: Mapping[str, Path | str],
) -> tuple[tuple[WeightAsset, ...], tuple[str, ...]]:
    """Mint a KMI asset per **produced** artifact; report the rest.

    ``artifacts`` maps a :data:`ARTIFACT_ORDER` role to the path the pipeline
    wrote. A role whose path does not exist yet — a stub run's adapter, a GGUF
    nobody has converted — yields no asset and is returned in the second tuple:
    an unproduced export is a pending fact, not an asset id over zero bytes.
    """
    base_entity = admitted.anchor.base_model.entity_id
    variants = requested_variants(admitted.job.export)
    minted: dict[str, WeightAsset] = {}
    pending: list[str] = []
    for role in ARTIFACT_ORDER:
        path = artifacts.get(role)
        if path is None:
            continue
        if not Path(path).exists():
            pending.append(role)
            continue
        media_type, relation, sources = ARTIFACT_SPECS[role]
        derived_from = tuple(
            base_entity if source == "base" else minted[source].asset_id
            for source in sources
            if source == "base" or source in minted
        )
        sha256, size = content_digest(path)
        minted[role] = WeightAsset(
            asset_id=mint_asset_id(sha256),
            role=role,
            media_type=media_type,
            relation=relation,
            derived_from=derived_from,
            egress=model.egress,
            license_class=model.license_class,
            licenses=model.licenses,
            size_bytes=size,
            path=str(path),
            variant=variants.get(role, ""),
        )
    return tuple(minted[role] for role in ARTIFACT_ORDER if role in minted), tuple(
        pending
    )


def requested_variants(exports: Sequence[str]) -> dict[str, str]:
    """``export`` strings → ``{role: variant}`` (``gguf:Q4_K_M`` → ``Q4_K_M``)."""
    variants: dict[str, str] = {}
    for entry in exports:
        head, _, variant = entry.partition(":")
        role = EXPORT_ROLES.get(head.strip())
        if role is not None:
            variants[role] = variant.strip()
    return variants


def unsupported_exports(exports: Sequence[str]) -> tuple[str, ...]:
    """Requested export formats this provider has no leg for — reported, not dropped."""
    return tuple(
        entry
        for entry in exports
        if EXPORT_ROLES.get(entry.partition(":")[0].strip()) is None
    )


def build_provenance(
    admitted: AdmittedJob,
    model: ModelEntity,
    assets: Sequence[WeightAsset],
    *,
    agent: str = DEFAULT_AGENT,
    spent_units: int | None = None,
    budget_units: int | None = None,
) -> dict[str, Any]:
    """The KFT §5.2 PROV activity record for the run.

    ``used`` is the admission's pinned input ids (packs, media, the base entity);
    ``generated`` is the minted model plus every weight asset. ``seed`` and
    ``config_hash`` ride here — on the *run* — because the weights cannot carry
    them (FT-C).
    """
    anchor = admitted.anchor
    record: dict[str, Any] = {
        "activity": anchor.job,
        "agent": agent,
        "used": list(anchor.used),
        "generated": [model.entity_id, *(asset.asset_id for asset in assets)],
        "seed": anchor.seed,
        "config_hash": anchor.config_hash,
        "engine_config_hash": anchor.engine_config_hash,
        "kft_version": anchor.kft_version,
        "egress": admitted.egress.as_dict(),
    }
    if budget_units is not None:
        record["budget_units"] = budget_units
    if spent_units is not None:
        record["spent_units"] = spent_units
    return record


# --- §5.4 enforcement: a local-only model does not leave -------------------------

#: Publication destination → does it cross the originating trust boundary?
#: Anything not listed is treated as crossing: for a gate whose failure mode is
#: exfiltrating private training data, the safe default is refusal.
PUBLICATION_TARGETS: dict[str, bool] = {
    "filesystem": False,
    "dvc-local": False,
    "dvc-remote": True,
    "huggingface-hub": True,
    "kcb-registry": True,
    "ollama-registry": True,
}


def check_publishable(model: ModelEntity, destination: str) -> None:
    """KFT §5.4: refuse to push a ``local-only`` model across the boundary.

    The §4.2 gate governs where a run *executes*; this governs what its output
    may do. A model that inherits ``local-only`` MUST NOT be registered in a
    cross-boundary registry or pushed to a Hub — so the refusal lives next to the
    inheritance that causes it, and US-3's KCB surface calls it before it
    advertises anything.
    """
    crosses = PUBLICATION_TARGETS.get(destination, True)
    if model.local_only and crosses:
        raise JobRejected(
            "cross-boundary-publication",
            f"model {model.entity_id!r} inherits egress 'local-only' from its "
            f"training corpus (tier {model.tier!r}) and MUST NOT be published to "
            f"{destination!r} (KFT §5.4, FT-A); local destinations are "
            f"{sorted(k for k, v in PUBLICATION_TARGETS.items() if not v)}",
            entityId=model.entity_id,
            destination=destination,
            egress=model.egress,
        )


# --- the assembled run record ----------------------------------------------------


@dataclass(frozen=True)
class RunOutputs:
    """Everything one admitted run produced, in KFT's terms."""

    model: ModelEntity
    assets: tuple[WeightAsset, ...]
    provenance: Mapping[str, Any]
    telemetry: tuple[TelemetryEvent, ...]
    #: Roles the job asked for that this run did not produce (no asset minted).
    pending_exports: tuple[str, ...] = ()
    #: ``export`` strings this provider has no leg for at all.
    unsupported_exports: tuple[str, ...] = ()

    @property
    def terminal(self) -> TelemetryEvent:
        """The §6 completion event — the last one, by construction."""
        return self.telemetry[-1]

    def as_dict(self) -> dict[str, Any]:
        return {
            "runRecordVersion": RUN_RECORD_VERSION,
            "kftVersion": self.model.kft_version,
            "model": self.model.as_dict(),
            "assets": [asset.as_dict() for asset in self.assets],
            "provenance": dict(self.provenance),
            "pendingExports": list(self.pending_exports),
            "unsupportedExports": list(self.unsupported_exports),
            "telemetry": [event.as_dict() for event in self.telemetry],
        }


def mint_run_outputs(
    admitted: AdmittedJob,
    summary: Mapping[str, Any],
    *,
    artifacts: Mapping[str, Path | str] | None = None,
    ts: str,
    agent: str = DEFAULT_AGENT,
    state: str = "succeeded",
) -> RunOutputs:
    """Turn a finished pipeline run into its KFT §5/§6 record.

    ``summary`` is :func:`pinakes_ml.slm_finetune.build_run_summary`'s output —
    the run's own self-description — so nothing is measured here that the
    pipeline did not already measure. This function only *names* things in the
    ecosystem's vocabulary and stamps the §5.4 inheritance on them.
    """
    if state not in TERMINAL_STATES:
        raise JobRejected(
            "invalid-lifecycle-state",
            f"terminal state {state!r} is not one of {list(TERMINAL_STATES)} "
            f"(KFT §6)",
            state=state,
        )
    training = summary.get("training") or {}
    outcome = TrainOutcome(
        adapter_dir=str(training.get("adapterDir") or ""),
        device=str(training.get("device") or ""),
        num_train_records=int(training.get("numTrainRecords") or 0),
        stub=bool(training.get("stub")),
        log_history=tuple(training.get("logHistory") or ()),
    )
    job_id = admitted.anchor.job
    model = mint_model(admitted)
    assets, pending = mint_weight_assets(admitted, model, artifacts or {})
    provenance = build_provenance(admitted, model, assets, agent=agent)

    scores = summary.get("scores") or {}
    steps = training_events(job_id, outcome, ts=ts)
    final_step = steps[-1].step if steps else 0
    stages = stage_events(job_id, scores, ts=ts, final_step=final_step)
    events: list[TelemetryEvent] = []
    if "untuned" in stages:
        events.append(stages["untuned"])
    events.extend(steps)
    if "finetuned" in stages:
        events.append(stages["finetuned"])
    events.append(
        TelemetryEvent(
            job=job_id,
            step=final_step,
            metrics={},
            ts=ts,
            kind=KIND_TERMINAL,
            state=state,
            result={
                "model": model.entity_id,
                "weights": [asset.asset_id for asset in assets],
                "pendingExports": list(pending),
                "egress": model.egress,
                "licenseClass": model.license_class,
                "eval": {stage: dict(arms) for stage, arms in sorted(scores.items())},
                "evalScenarios": list(admitted.job.eval_scenarios),
                "stub": outcome.stub,
            },
        )
    )
    return RunOutputs(
        model=model,
        assets=assets,
        provenance=provenance,
        telemetry=tuple(events),
        pending_exports=pending,
        unsupported_exports=unsupported_exports(admitted.job.export),
    )


def render_telemetry_jsonl(events: Sequence[TelemetryEvent]) -> str:
    """The stream as JSONL — one event per line, the shape a subscriber tails."""
    return "".join(
        json.dumps(event.as_dict(), sort_keys=True, ensure_ascii=False) + "\n"
        for event in events
    )


__all__ = [
    "ARTIFACT_ORDER",
    "ARTIFACT_SPECS",
    "DEFAULT_AGENT",
    "EXPORT_ROLES",
    "KIND_EVAL",
    "KIND_TERMINAL",
    "KIND_TRAIN",
    "LIFECYCLE_STATES",
    "MEDIA_TYPE_GGUF",
    "MEDIA_TYPE_SAFETENSORS",
    "METRIC_NAMES",
    "NAMESPACE",
    "PUBLICATION_TARGETS",
    "REL_DERIVED_FROM",
    "REL_VARIANT_OF",
    "ROLE_ADAPTER",
    "ROLE_GGUF",
    "ROLE_MERGED",
    "RUN_RECORD_VERSION",
    "TERMINAL_STATES",
    "JobRejected",
    "ModelEntity",
    "RunOutputs",
    "TelemetryEvent",
    "WeightAsset",
    "build_provenance",
    "check_publishable",
    "content_digest",
    "mint_asset_id",
    "mint_model",
    "mint_model_id",
    "mint_run_outputs",
    "mint_weight_assets",
    "render_telemetry_jsonl",
    "requested_variants",
    "stage_events",
    "step_metrics",
    "training_events",
    "unsupported_exports",
]
