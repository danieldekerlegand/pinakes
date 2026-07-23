"""KFT finetune-job admission — ``ml/`` as a specialized KFT provider (90 US-1).

The adapter between the ecosystem contract and this workspace's already-built
trainer: a KFT finetune job (``koine/schemas/finetune-job.schema.json``, KFT
0.3.0 §3) in, a frozen :class:`~pinakes_ml.slm_finetune.SlmPilotConfig` plus a
reproducibility anchor out. **No training logic lives here** — the pipeline is
:mod:`pinakes_ml.slm_finetune`; this module only decides whether a job is one
pinakes will run, and what config it becomes.

Pinakes is the **narrow, specialized** leg of the multi-provider fine-tuning
program (KFT §9, FT-K): agora hosts the general trainer, and this provider
accepts only ``text-generation × {sft, lora, qlora}`` — the SLM rule-authoring /
neurosymbolic job shape ``ml/`` actually implements. Everything else is
**rejected at admission with a report** (KFT §3.1, FT-F) naming the general
trainer, before any compute is committed. A rejection is a routing signal, not a
failure.

Three rules this module exists to hold:

* **A base model is an entity, not a string (KFT §5.1, FT-G).** A job names a
  minted KINP ``model`` entity; the concrete Hugging Face coordinate is read off
  that entity's **external anchor** in the committed registry
  ``ml/configs/kft-base-models.json``. A raw ``hf:…`` coordinate in a job is
  refused — an unanchored base has no license, no egress class and no lineage,
  which US-2 (§4.2/§5.4 inheritance) needs.
* **The run is the reproducibility anchor, not the weights (KFT §5.2, FT-C).**
  GPU nondeterminism means a tuned model cannot be content-addressed, so
  ``seed`` + ``config_hash`` + the pinned input ids ride on the run
  (:class:`RunAnchor`), which US-2 writes into the model's PROV record.
* **Nothing is silently dropped.** Unknown top-level/dataset/compute keys are
  rejected (the schema is ``additionalProperties: false``); ``hyperparams`` is
  deliberately permissive per KFT §9, so a key this engine does not implement is
  *reported* on :attr:`AdmittedJob.ignored_hyperparams`, never quietly ignored.

Pure + stdlib-only apart from the sibling pure modules it maps onto: importing
this module pulls **no** heavy stack (``torch``/``trl``/``peft``), per
``ml/CLAUDE.md`` — a test asserts it in a subprocess.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pinakes_ml.slm_finetune import SlmPilotConfig

_ML_ROOT = Path(__file__).resolve().parents[2]

#: The KFT spec version this adapter implements (``koine/specs/fine-tuning.md``).
KFT_VERSION = "0.3.0"

#: KFT §3.1 modality vocabulary, mirrored as data (the same "vendor the upstream
#: vocabulary, don't import it" discipline :mod:`pinakes_ml.cinematography_eval`
#: uses for Analyzer's rules). Additive upstream; re-mirror when koine adds a row.
MODALITIES: tuple[str, ...] = (
    "text-generation",
    "image-text-to-text",
    "video-text-to-text",
    "text-to-image",
    "text-to-video",
)

#: KFT §3 ``method`` vocabulary.
METHODS: tuple[str, ...] = ("sft", "lora", "qlora", "full", "dpo")

#: The KFT §3.1 compatibility table — ``modality`` and ``method`` are NOT
#: independent, and a provider MUST reject an incompatible pair at admission
#: (FT-F). This is the ecosystem-wide table; :data:`PROVIDER_METHODS` is the
#: narrower slice *this* provider serves.
MODALITY_METHODS: dict[str, tuple[str, ...]] = {
    "text-generation": ("sft", "lora", "qlora", "full", "dpo"),
    "image-text-to-text": ("lora", "qlora"),
    "video-text-to-text": ("lora", "qlora"),
    "text-to-image": ("lora", "full"),
    "text-to-video": ("lora",),
}

#: The specialization (KFT §2/§9, FT-K). ``ml/`` is an SLM rule-authoring
#: QLoRA trainer over a knowledge-plane corpus — that and nothing else.
PROVIDER_MODALITY = "text-generation"
PROVIDER_METHODS: tuple[str, ...] = ("sft", "lora", "qlora")

#: Named in every rejection report so a caller knows where to route instead.
GENERAL_TRAINER = "agora (the general `finetune` trainer, KFT §9)"

#: KFT §4.2 / KGP §7.2 egress vocabulary, plus the schema's default.
EGRESS_CLASSES: tuple[str, ...] = ("derived", "exportable", "local-only")
DEFAULT_EGRESS = "derived"

#: The only external-anchor scheme this provider resolves (KFT §5.1, FT-G).
HF_ANCHOR_PREFIX = "ext:hf:"

#: The committed base-model entity registry (external anchors + license/egress).
DEFAULT_BASE_MODELS = _ML_ROOT / "configs" / "kft-base-models.json"

#: The golden positive job fixture the tests drive this module with.
DEFAULT_JOB_FIXTURE = _ML_ROOT / "fixtures" / "kft" / "finetune-job.json"

#: KINP CURIE — ``namespace:kind:local`` (the schema's ``$defs/kinpId``).
_KINP_ID_RE = re.compile(r"^[a-z0-9-]+:[a-z0-9-]+:\S+$")

_JOB_KEYS = frozenset(
    {
        "kft_version",
        "job",
        "base_model",
        "modality",
        "method",
        "dataset",
        "hyperparams",
        "export",
        "compute",
        "eval",
        "seed",
        "config_hash",
        "signing",
    }
)
_DATASET_KEYS = frozenset({"knowledge", "media", "header"})
_COMPUTE_KEYS = frozenset({"class", "egress"})


# --- rejection (KFT "rejected with a report", never a silent downgrade) ---------


class JobRejected(ValueError):
    """A finetune job this provider will not run, with a machine-readable report.

    KFT §3.1/§4.2 require a rejection to be *reported*, not silently downgraded
    or silently re-placed — so the code and the offending values travel with the
    message. :attr:`report` is what the KCB surface (US-3) returns to the caller.
    """

    def __init__(self, code: str, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.code = code
        self.detail = {k: v for k, v in detail.items() if v is not None}

    @property
    def report(self) -> dict[str, Any]:
        """The rejection as a JSON-serializable report."""
        return {
            "rejected": True,
            "code": self.code,
            "message": str(self),
            "provider": "pinakes",
            "kftVersion": KFT_VERSION,
            "detail": dict(self.detail),
        }


def _require(condition: bool, code: str, message: str, **detail: Any) -> None:
    if not condition:
        raise JobRejected(code, message, **detail)


def _string_tuple(value: object, where: str) -> tuple[str, ...]:
    _require(
        isinstance(value, list | tuple) and all(isinstance(v, str) for v in value),
        "malformed-job",
        f"{where} must be an array of strings, got {type(value).__name__}",
    )
    return tuple(value)  # type: ignore[arg-type]


def _kinp_ids(value: object, where: str) -> tuple[str, ...]:
    ids = _string_tuple(value, where)
    for entry in ids:
        _require(
            bool(_KINP_ID_RE.match(entry)),
            "malformed-job",
            f"{where}: {entry!r} is not a KINP id (namespace:kind:local)",
        )
    return ids


# --- base-model entities + their external anchors (KFT §5.1, FT-G) -------------


@dataclass(frozen=True)
class BaseModelAnchor:
    """A minted KINP ``model`` entity and the Hub coordinate it anchors to.

    ``license``/``license_class``/``egress`` are the base's own axes — KFT §4.2
    (FT-B) folds the base's egress into the run's effective class and §4.3 folds
    its license into the model's union license, so they are recorded here rather
    than rediscovered from the Hub at training time.
    """

    entity_id: str
    same_as: str
    modality: str = PROVIDER_MODALITY
    license: str = ""
    license_class: str = ""
    egress: str = "exportable"

    @property
    def hf_coordinate(self) -> str:
        """The concrete Hugging Face coordinate the entity anchors to."""
        return self.same_as[len(HF_ANCHOR_PREFIX) :]

    def as_dict(self) -> dict[str, Any]:
        return {
            "entityId": self.entity_id,
            "sameAs": self.same_as,
            "coordinate": self.hf_coordinate,
            "modality": self.modality,
            "license": self.license,
            "licenseClass": self.license_class,
            "egress": self.egress,
        }


def load_base_models(
    path: Path | str = DEFAULT_BASE_MODELS,
) -> dict[str, BaseModelAnchor]:
    """Read the committed base-model entity registry.

    The registry is corpus-independent and git-tracked (like ``ml/scallop/
    program.scl``), so admission works in CI with no DVC pull and no network.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    models = payload.get("models") or {}
    anchors: dict[str, BaseModelAnchor] = {}
    for entity_id, row in sorted(models.items()):
        anchors[entity_id] = BaseModelAnchor(
            entity_id=entity_id,
            same_as=str(row.get("same_as", "")),
            modality=str(row.get("modality", PROVIDER_MODALITY)),
            license=str(row.get("license", "")),
            license_class=str(row.get("license_class", "")),
            egress=str(row.get("egress", "exportable")),
        )
    return anchors


def resolve_base_model(
    entity_id: str, anchors: Mapping[str, BaseModelAnchor] | None = None
) -> BaseModelAnchor:
    """Resolve a base-model KINP entity id to its anchored Hub coordinate.

    An unknown entity — or one whose anchor is not an ``ext:hf:`` coordinate —
    is rejected: a base with no anchor carries no license and no egress class,
    and KFT §4.2/§4.3 need both. Register it in
    ``ml/configs/kft-base-models.json`` first.
    """
    registry = load_base_models() if anchors is None else anchors
    anchor = registry.get(entity_id)
    if anchor is None:
        raise JobRejected(
            "unknown-base-model",
            f"base_model {entity_id!r} is not a base-model entity pinakes has "
            f"minted; add it (with its ext:hf: anchor, license and egress) to "
            f"configs/kft-base-models.json. Known: {sorted(registry)}",
            base_model=entity_id,
        )
    _require(
        anchor.same_as.startswith(HF_ANCHOR_PREFIX)
        and len(anchor.same_as) > len(HF_ANCHOR_PREFIX),
        "unanchored-base-model",
        f"base_model {entity_id!r} has no {HF_ANCHOR_PREFIX}… external anchor "
        f"(KFT §5.1, FT-G); got {anchor.same_as!r}",
        base_model=entity_id,
    )
    return anchor


# --- the job manifest (KFT §3) -------------------------------------------------


@dataclass(frozen=True)
class FinetuneJob:
    """A parsed, structurally-valid KFT finetune job.

    Mirrors ``koine/schemas/finetune-job.schema.json`` field for field; the
    nested ``dataset``/``compute`` objects are flattened onto this record
    (``knowledge``/``media``/``header``, ``compute_class``/``compute_egress``)
    and ``eval`` is spelled ``eval_scenarios`` so it does not shadow the
    builtin. :meth:`to_dict` restores the wire shape, and a round-trip test
    holds the two in step.
    """

    kft_version: str
    job: str
    base_model: str
    modality: str
    method: str
    knowledge: tuple[str, ...] = ()
    media: tuple[str, ...] = ()
    header: Mapping[str, Any] | None = None
    hyperparams: Mapping[str, Any] = field(default_factory=dict)
    export: tuple[str, ...] = ()
    compute_class: str = ""
    compute_egress: str = DEFAULT_EGRESS
    eval_scenarios: tuple[str, ...] = ()
    seed: int | None = None
    config_hash: str = ""
    signing: Mapping[str, str] | None = None

    @property
    def slug(self) -> str:
        """A filesystem-safe run slug from the activity id's local part.

        ``cuneiform:activity:ft-run/9f2a`` → ``ft-run-9f2a``. Used for the run
        name and the (git-ignored) output dir, so two runs of one job shape do
        not collide on disk.
        """
        local = self.job.split(":", 2)[-1]
        return re.sub(r"[^a-z0-9]+", "-", local.lower()).strip("-") or "ft-run"

    @classmethod
    def from_dict(cls, payload: Mapping[str, object]) -> FinetuneJob:
        """Parse + structurally validate one job payload.

        Unknown keys are rejected at every level the schema declares
        ``additionalProperties: false`` (top level, ``dataset``, ``compute``) —
        a typo'd key is a job that would train on something other than what its
        author wrote.
        """
        _require(
            isinstance(payload, Mapping),
            "malformed-job",
            f"finetune job must be an object, got {type(payload).__name__}",
        )
        unknown = sorted(set(payload) - _JOB_KEYS)
        _require(
            not unknown,
            "malformed-job",
            f"unknown finetune-job keys: {unknown}",
            unknownKeys=unknown,
        )
        for required in ("kft_version", "job", "base_model", "modality", "method"):
            _require(
                isinstance(payload.get(required), str) and bool(payload[required]),
                "malformed-job",
                f"finetune job is missing required string {required!r}",
            )
        for kinp in ("job", "base_model"):
            _require(
                bool(_KINP_ID_RE.match(str(payload[kinp]))),
                "malformed-job",
                f"{kinp}: {payload[kinp]!r} is not a KINP id (namespace:kind:local)",
            )

        dataset = payload.get("dataset")
        if not isinstance(dataset, Mapping):
            raise JobRejected(
                "malformed-job", "finetune job is missing required object 'dataset'"
            )
        unknown = sorted(set(dataset) - _DATASET_KEYS)
        _require(
            not unknown, "malformed-job", f"unknown dataset keys: {unknown}",
            unknownKeys=unknown,
        )
        header = dataset.get("header")
        _require(
            header is None or isinstance(header, Mapping),
            "malformed-job",
            "dataset.header must be a dataset-jsonl-header object",
        )

        compute = payload.get("compute")
        if not isinstance(compute, Mapping):
            raise JobRejected(
                "malformed-job",
                "finetune job is missing required object 'compute' (KFT §4.2)",
            )
        unknown = sorted(set(compute) - _COMPUTE_KEYS)
        _require(
            not unknown, "malformed-job", f"unknown compute keys: {unknown}",
            unknownKeys=unknown,
        )
        compute_class = compute.get("class")
        _require(
            isinstance(compute_class, str) and bool(compute_class),
            "malformed-job",
            "compute.class is required and must be a non-empty string",
        )
        egress = compute.get("egress", DEFAULT_EGRESS)
        _require(
            egress in EGRESS_CLASSES,
            "malformed-job",
            f"compute.egress {egress!r} is not one of {list(EGRESS_CLASSES)}",
        )

        hyperparams = payload.get("hyperparams") or {}
        _require(
            isinstance(hyperparams, Mapping),
            "malformed-job",
            "hyperparams must be an object",
        )
        seed = payload.get("seed")
        _require(
            seed is None or (isinstance(seed, int) and not isinstance(seed, bool)),
            "malformed-job",
            f"seed must be an integer, got {seed!r}",
        )
        signing = payload.get("signing")
        _require(
            signing is None or isinstance(signing, Mapping),
            "malformed-job",
            "signing must be an object with key_id + alg",
        )

        return cls(
            kft_version=str(payload["kft_version"]),
            job=str(payload["job"]),
            base_model=str(payload["base_model"]),
            modality=str(payload["modality"]),
            method=str(payload["method"]),
            knowledge=_kinp_ids(dataset.get("knowledge", ()), "dataset.knowledge"),
            media=_kinp_ids(dataset.get("media", ()), "dataset.media"),
            header=dict(header) if isinstance(header, Mapping) else None,
            hyperparams=dict(hyperparams),
            export=_string_tuple(payload.get("export", ()), "export"),
            compute_class=str(compute_class),
            compute_egress=str(egress),
            eval_scenarios=_kinp_ids(payload.get("eval", ()), "eval"),
            seed=seed,
            config_hash=str(payload.get("config_hash") or ""),
            signing=dict(signing) if isinstance(signing, Mapping) else None,
        )

    @classmethod
    def from_json(cls, path: Path | str) -> FinetuneJob:
        """Load a job manifest from disk."""
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def to_dict(self) -> dict[str, Any]:
        """The wire shape again — the schema's nesting, omitting absent optionals."""
        dataset: dict[str, Any] = {}
        if self.knowledge:
            dataset["knowledge"] = list(self.knowledge)
        if self.media:
            dataset["media"] = list(self.media)
        if self.header is not None:
            dataset["header"] = dict(self.header)
        payload: dict[str, Any] = {
            "kft_version": self.kft_version,
            "job": self.job,
            "base_model": self.base_model,
            "modality": self.modality,
            "method": self.method,
            "dataset": dataset,
            "compute": {"class": self.compute_class, "egress": self.compute_egress},
        }
        if self.hyperparams:
            payload["hyperparams"] = dict(self.hyperparams)
        if self.export:
            payload["export"] = list(self.export)
        if self.eval_scenarios:
            payload["eval"] = list(self.eval_scenarios)
        if self.seed is not None:
            payload["seed"] = self.seed
        if self.config_hash:
            payload["config_hash"] = self.config_hash
        if self.signing is not None:
            payload["signing"] = dict(self.signing)
        return payload


# --- admission checks (KFT §3.1, FT-F) -----------------------------------------


def _parse_version(value: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in value.split("."))
    except ValueError as exc:  # pragma: no cover - message-only branch
        raise JobRejected(
            "unsupported-kft-version",
            f"kft_version {value!r} is not a semver string",
        ) from exc


def check_version(job: FinetuneJob) -> None:
    """Reject a job authored against a KFT this adapter does not implement.

    KFT is pre-1.0, so a minor bump may move the contract: a *newer* minor is
    refused (this provider cannot know what it added) while an older one is
    accepted — the same forward-incompatible/backward-compatible stance the
    dataset ``contractVersion`` checks take.
    """
    ours = _parse_version(KFT_VERSION)
    theirs = _parse_version(job.kft_version)
    _require(
        theirs[:1] == ours[:1] and theirs[:2] <= ours[:2],
        "unsupported-kft-version",
        f"job declares kft_version {job.kft_version!r}; this provider implements "
        f"KFT {KFT_VERSION}",
        kftVersion=job.kft_version,
    )


def check_modality_method(job: FinetuneJob) -> None:
    """The FT-F gate — and the statement of this provider's specialization.

    Three distinct refusals, each with its own code, because they mean different
    things to a router: the pair is *nonsense* (not in the KFT §3.1 table), or
    it is legitimate but belongs to the **general trainer** (a modality/method
    ``ml/`` does not implement). Only the second kind is a routing hint.
    """
    _require(
        job.modality in MODALITIES,
        "unknown-modality",
        f"modality {job.modality!r} is not in the KFT §3.1 vocabulary "
        f"{list(MODALITIES)}",
        modality=job.modality,
    )
    _require(
        job.method in METHODS,
        "unknown-method",
        f"method {job.method!r} is not in the KFT §3 vocabulary {list(METHODS)}",
        method=job.method,
    )
    _require(
        job.method in MODALITY_METHODS[job.modality],
        "incompatible-modality-method",
        f"method {job.method!r} is incompatible with modality {job.modality!r} "
        f"(KFT §3.1, FT-F); {job.modality!r} accepts "
        f"{list(MODALITY_METHODS[job.modality])}",
        modality=job.modality,
        method=job.method,
    )
    _require(
        job.modality == PROVIDER_MODALITY,
        "unsupported-modality",
        f"pinakes is a specialized {PROVIDER_MODALITY} provider and does not run "
        f"{job.modality!r} jobs; route this to {GENERAL_TRAINER}",
        modality=job.modality,
        supportedModality=PROVIDER_MODALITY,
    )
    _require(
        job.method in PROVIDER_METHODS,
        "unsupported-method",
        f"pinakes implements {list(PROVIDER_METHODS)} only (the ml/ QLoRA "
        f"pipeline); {job.method!r} is a valid KFT method — route it to "
        f"{GENERAL_TRAINER}",
        method=job.method,
        supportedMethods=list(PROVIDER_METHODS),
    )


def check_dataset(job: FinetuneJob) -> None:
    """The dataset must be a knowledge-plane corpus, referenced by id (KFT §4.1)."""
    _require(
        bool(job.knowledge or job.media),
        "empty-dataset",
        "dataset must name at least one knowledge pack or media asset (KFT §4.1)",
    )
    _require(
        not job.media,
        "unsupported-dataset-plane",
        f"pinakes trains on the knowledge plane only (KGP packs); this job names "
        f"{len(job.media)} media asset(s), which is a multimodal job — route it "
        f"to {GENERAL_TRAINER}",
        media=list(job.media),
    )
    _require(
        bool(job.knowledge),
        "empty-dataset",
        "dataset.knowledge must name at least one KGP pack (KFT §4.1)",
    )


# --- hyperparameter mapping (KFT §3 -> SlmPilotConfig) --------------------------


def _as_bool(value: object) -> bool:
    _require(
        isinstance(value, bool),
        "invalid-hyperparam",
        f"expected a bool, got {value!r}",
    )
    return bool(value)


def _as_int(value: object) -> int:
    _require(
        isinstance(value, int) and not isinstance(value, bool),
        "invalid-hyperparam",
        f"expected an integer, got {value!r}",
    )
    return int(value)  # type: ignore[arg-type]


def _as_float(value: object) -> float:
    _require(
        isinstance(value, int | float) and not isinstance(value, bool),
        "invalid-hyperparam",
        f"expected a number, got {value!r}",
    )
    return float(value)  # type: ignore[arg-type]


def _as_modules(value: object) -> list[str]:
    return list(_string_tuple(value, "hyperparams.lora.target_modules"))


#: KFT ``hyperparams`` key -> (``SlmPilotConfig`` field, coercion). The KFT
#: spelling (``epochs``/``lr``/``max_seq_len``, §3) is canonical; the config's
#: own field name is accepted too so a pinakes-authored job needs no translation.
HYPERPARAM_MAP: dict[str, tuple[str, Callable[[object], Any]]] = {
    "epochs": ("num_train_epochs", _as_float),
    "num_train_epochs": ("num_train_epochs", _as_float),
    "lr": ("learning_rate", _as_float),
    "learning_rate": ("learning_rate", _as_float),
    "max_seq_len": ("max_seq_length", _as_int),
    "max_seq_length": ("max_seq_length", _as_int),
    "max_new_tokens": ("max_new_tokens", _as_int),
    "batch_size": ("per_device_train_batch_size", _as_int),
    "per_device_train_batch_size": ("per_device_train_batch_size", _as_int),
    "gradient_accumulation_steps": ("gradient_accumulation_steps", _as_int),
    "warmup_ratio": ("warmup_ratio", _as_float),
    "logging_steps": ("logging_steps", _as_int),
    "load_in_4bit": ("load_in_4bit", _as_bool),
}

#: The nested ``hyperparams.lora`` block (KFT §3).
LORA_MAP: dict[str, tuple[str, Callable[[object], Any]]] = {
    "r": ("lora_r", _as_int),
    "alpha": ("lora_alpha", _as_int),
    "dropout": ("lora_dropout", _as_float),
    "target_modules": ("lora_target_modules", _as_modules),
}


def map_hyperparams(
    hyperparams: Mapping[str, Any],
) -> tuple[dict[str, Any], tuple[str, ...]]:
    """Translate KFT hyperparams into ``SlmPilotConfig`` fields.

    Returns the overrides plus the **dotted names of the keys this engine does
    not implement**. KFT §9 makes ``hyperparams`` deliberately permissive
    ("engine adapters own the detail"), so an unimplemented key is not an error
    — but it IS reported, the same way
    :mod:`pinakes_ml.scallop` reports untranslatable rules instead of dropping
    them.
    """
    overrides: dict[str, Any] = {}
    ignored: list[str] = []
    for key, value in sorted(hyperparams.items()):
        if key == "lora":
            if not isinstance(value, Mapping):
                raise JobRejected(
                    "invalid-hyperparam",
                    f"hyperparams.lora must be an object, got {value!r}",
                )
            for lora_key, lora_value in sorted(value.items()):
                mapping = LORA_MAP.get(lora_key)
                if mapping is None:
                    ignored.append(f"lora.{lora_key}")
                    continue
                overrides[mapping[0]] = mapping[1](lora_value)
            continue
        mapping = HYPERPARAM_MAP.get(key)
        if mapping is None:
            ignored.append(key)
            continue
        overrides[mapping[0]] = mapping[1](value)
    return overrides, tuple(ignored)


# --- the reproducibility anchor (KFT §5.2, FT-C) --------------------------------


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def engine_config_hash(config: SlmPilotConfig) -> str:
    """``sha256-…`` of the fully-resolved engine config (KFT §5.2).

    Hashed on the **unresolved** (``ml/``-relative) config so it identifies the
    run's parameters, not the host that ran it — two machines admitting the same
    job agree on this hash. The job's own ``config_hash`` is the submitter's pin
    and is recorded separately; the two are different views by construction.
    """
    return "sha256-" + _sha256(json.dumps(config.to_dict(), sort_keys=True))


@dataclass(frozen=True)
class RunAnchor:
    """What makes the run reproducible when the weights cannot be (FT-C).

    A finetuned model is the fabric's first non-content-addressed generated
    entity: GPU nondeterminism means two identical runs differ byte-wise, so the
    anchor is the **run** — the pinned input ids, the ``seed`` and the
    ``config_hash``. US-2 writes this straight into the model's PROV activity
    record (KFT §5.2).
    """

    kft_version: str
    job: str
    base_model: BaseModelAnchor
    seed: int
    config_hash: str
    engine_config_hash: str
    used: tuple[str, ...] = ()
    export: tuple[str, ...] = ()
    compute_class: str = ""
    compute_egress: str = DEFAULT_EGRESS

    def as_dict(self) -> dict[str, Any]:
        """The anchor as a JSON-serializable block (run-summary camelCase)."""
        return {
            "kftVersion": self.kft_version,
            "job": self.job,
            "baseModel": self.base_model.as_dict(),
            "seed": self.seed,
            "configHash": self.config_hash,
            "engineConfigHash": self.engine_config_hash,
            "used": list(self.used),
            "export": list(self.export),
            "compute": {"class": self.compute_class, "egress": self.compute_egress},
        }


@dataclass(frozen=True)
class AdmittedJob:
    """An accepted job: the pipeline config plus everything provenance needs."""

    job: FinetuneJob
    config: SlmPilotConfig
    anchor: RunAnchor
    #: Hyperparameter keys this engine does not implement — reported, not dropped.
    ignored_hyperparams: tuple[str, ...] = ()

    def resolved(self, ml_root: Path | str = _ML_ROOT) -> AdmittedJob:
        """Absolutize the config's paths, preserving the ``.resolved(base)`` seam.

        Admission produces an ``ml/``-relative config — exactly what a committed
        ``configs/*.json`` holds — and path resolution stays where it already
        lives (:meth:`~pinakes_ml.slm_finetune.SlmPilotConfig.resolved`). The
        anchor is unchanged: :func:`engine_config_hash` is deliberately taken
        before resolution, so it does not move with the checkout.
        """
        return AdmittedJob(
            job=self.job,
            config=self.config.resolved(ml_root),
            anchor=self.anchor,
            ignored_hyperparams=self.ignored_hyperparams,
        )


def admit(
    payload: FinetuneJob | Mapping[str, object],
    *,
    anchors: Mapping[str, BaseModelAnchor] | None = None,
    defaults: SlmPilotConfig | None = None,
    worlds: Sequence[str] = (),
    candidates: Sequence[str] = (),
) -> AdmittedJob:
    """Admit a KFT finetune job → a ``SlmPilotConfig`` + its run anchor.

    Every check runs **before** any compute is committed (KFT §3.1/§4.1): parse,
    version, ``modality × method``, dataset plane, base-model anchor. The first
    failure raises :class:`JobRejected`, whose :attr:`~JobRejected.report` is the
    caller-facing rejection.

    ``worlds``/``candidates`` stay a caller concern: the KGP pack ids in
    ``dataset.knowledge`` are *references* (KFT §4.1), and turning a pack id into
    a local world-export path is the data-plane resolution US-2/US-3 own. Left
    empty, the pipeline rebuilds from the committed fixture worlds — the same
    default ``pinakes-train-slm`` already has.
    """
    job = (
        payload
        if isinstance(payload, FinetuneJob)
        else FinetuneJob.from_dict(payload)
    )
    check_version(job)
    check_modality_method(job)
    check_dataset(job)
    anchor = resolve_base_model(job.base_model, anchors)
    _require(
        anchor.modality == job.modality,
        "base-model-modality-mismatch",
        f"base_model {job.base_model!r} is a {anchor.modality!r} model but the job "
        f"declares modality {job.modality!r} (KFT §3.1)",
        modality=job.modality,
        baseModelModality=anchor.modality,
    )

    base = defaults or SlmPilotConfig()
    overrides, ignored = map_hyperparams(job.hyperparams)
    seed = job.seed if job.seed is not None else base.seed
    config = SlmPilotConfig.from_dict(
        {
            **base.to_dict(),
            "worlds": list(worlds),
            "candidates": list(candidates),
            "base_model": anchor.hf_coordinate,
            "run_name": f"kft-{job.slug}",
            "output_dir": f"artifacts/kft/{job.slug}",
            # QLoRA means 4-bit by default; a job may override it in hyperparams
            # (the local-mps run must, bitsandbytes being CUDA-only).
            "load_in_4bit": job.method == "qlora",
            "seed": seed,
            **overrides,
        }
    )
    return AdmittedJob(
        job=job,
        config=config,
        anchor=RunAnchor(
            kft_version=job.kft_version,
            job=job.job,
            base_model=anchor,
            seed=seed,
            config_hash=job.config_hash,
            engine_config_hash=engine_config_hash(config),
            used=(*job.knowledge, *job.media, anchor.entity_id),
            export=job.export,
            compute_class=job.compute_class,
            compute_egress=job.compute_egress,
        ),
        ignored_hyperparams=ignored,
    )
