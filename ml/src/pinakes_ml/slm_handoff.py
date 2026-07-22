"""Insimul handoff bundle + integration contract (slm-pilot US-005).

Phase D's **loop closure**: everything Insimul needs to run the pilot's model,
assembled on this side of the bridge so the Insimul-side change is a wiring PR and
not an archaeology exercise. Nothing here touches an Insimul repo — that is the
story's own constraint, and the reason the deliverable is a *bundle plus a
runbook* rather than a patch.

The bundle is four things, and each exists to answer a question the receiving
engineer will actually ask:

* **the GGUF** (US-004's deliverable) — *what do I load?*
* **the model manifest** (:func:`build_model_manifest`) — *where did it come
  from, and what did it score?* Base model, the training config, the dataset
  hashes + DVC pin, the adherence scores on both stacks, the frozen data-floor
  verdict, and the license position.
* **the prompt contract** (US-004's ``ml/manifests/slm-prompt-contract.json``) —
  *what exact strings do I send?*
* **the frozen eval set** — *how do I check that what I loaded still behaves like
  what you measured?* Re-verification is the point; a bundle whose scores cannot
  be reproduced by its recipient is a claim, not an artifact.

Two things this module deliberately refuses to do. It **states no verdict** about
the model: every score it carries is copied from the US-003/US-004 reports and
rides alongside ``dataFloor.verdict``, which is still ``insufficient-data``. And
it **invents no license position**: :data:`BASE_MODEL_LICENSE` records what
``Qwen/Qwen2.5-3B-Instruct``'s model card actually says — the pilot's baseline is
under the **Qwen Research License (non-commercial)**, not Apache-2.0, which the
skeleton PRD did not know when it picked the model to match Insimul's deployment.
That is a finding for US-006, recorded here where the bundle's consumer will see
it before shipping anything.

Shape, per ``ml/CLAUDE.md``: pure core (the manifest, the license notes, the
generated Insimul settings, the verification, the doc block) with no heavy
imports and no wall-clock, plus a thin CLI (:mod:`pinakes_ml.export_handoff`).
Prose half: ``docs/slm-insimul-runbook.md``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from pinakes_ml.slm_finetune import PIPELINE_VERSION
from pinakes_ml.slm_gguf import CONTRACT_VERSION, DEFAULT_QUANT
from pinakes_ml.slm_pilot import EVAL_SET_FILE, PROTOCOL_VERSION

#: Bumped when the bundle's layout or the manifest's schema changes — a consumer
#: pinned to an older bundle version cannot assume the file list.
BUNDLE_VERSION = "1"

# --- the bundle layout ----------------------------------------------------------
#
# The bundle root IS ``ml/models/slm-pilot`` — the tree US-004's GGUF already
# lands in, under its own DVC pointer (``ml/models.dvc``). Putting the small
# files beside the model rather than in a sibling directory means one `dvc pull`
# hands the recipient a complete, self-describing bundle, and the 1.9 GB binary
# is never copied twice.

MODEL_MANIFEST_FILE = "model-manifest.json"
CONTRACT_FILE = "prompt-contract.json"
LICENSE_FILE = "LICENSE-NOTES.md"
README_FILE = "README.md"

#: The frozen eval set, carried for re-verification (name shared with
#: ``ml/data/slm-pilot/`` so the two copies are obviously the same artifact).
BUNDLE_EVAL_FILE = EVAL_SET_FILE

#: The files the manifest inventories with a hash. The GGUF is absent because its
#: name varies with the run (it is recorded under ``model``), and
#: :data:`MODEL_MANIFEST_FILE` is absent because a manifest cannot contain its own
#: digest — its presence is checked instead. Order is the README's order.
BUNDLE_SIDECAR_FILES: tuple[str, ...] = (
    CONTRACT_FILE,
    BUNDLE_EVAL_FILE,
    LICENSE_FILE,
    README_FILE,
)


# --- license + provenance (recorded, never inferred) ----------------------------

#: What ``Qwen/Qwen2.5-3B-Instruct``'s model card says, verified against the card
#: and the LICENSE file on 2026-07-22. This is the single most consequential fact
#: in the bundle: the pilot's base model was chosen to match Insimul's deployed
#: GGUF, and that model is **not** Apache-2.0 like most of the Qwen2.5 family.
BASE_MODEL_LICENSE: dict[str, Any] = {
    "baseModel": "Qwen/Qwen2.5-3B-Instruct",
    # HF frontmatter: `license: other`, `license_name: qwen-research`.
    "licenseId": "qwen-research",
    "licenseName": "Qwen Research License Agreement",
    "licenseUrl": (
        "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE"
    ),
    "commercialUse": (
        "PROHIBITED without a separate license from Alibaba Cloud — §2(a) grants "
        "the rights 'FOR NON-COMMERCIAL PURPOSES ONLY'; §2(b) says a commercial "
        "user must request a license."
    ),
    "derivativeStatus": (
        "This GGUF is a derivative work: the base weights were LoRA-fine-tuned, "
        "merged and quantized, so the base model's terms flow through to it."
    ),
    "requiredNotice": (
        "Qwen is licensed under the Qwen RESEARCH LICENSE AGREEMENT, Copyright "
        "(c) Alibaba Cloud. All Rights Reserved."
    ),
    "requiredAttribution": (
        "Product documentation must prominently display 'Built with Qwen' or "
        "'Improved using Qwen' (§4(b)); modified files must carry a notice that "
        "they were changed (§3(b)); the agreement must be passed to recipients."
    ),
    "verifiedOn": "2026-07-22",
    # Only a license actually checked is listed. Every other size must be read
    # off its own card before it is treated as an escape hatch.
    "apacheAlternativesChecked": ("Qwen/Qwen2.5-1.5B-Instruct",),
    "note": (
        "Insimul's scripts/setup-local-ai.sh already downloads "
        "Qwen2.5-3B-Instruct-GGUF, so this obligation exists on the Insimul side "
        "today — but shipping a fine-tuned derivative in a commercial product is "
        "a distribution the research license does not cover. Qwen2.5-1.5B-Instruct "
        "IS Apache-2.0 (verified 2026-07-22); the 3B and 72B checkpoints are the "
        "family's bespoke-license exceptions. This is a decision input for US-006, "
        "not a legal opinion."
    ),
}

#: Where the training data came from and what may be done with it — the same
#: invariant ``insimul_datasets`` stamps on every record, restated at the bundle
#: boundary because a bundle is the thing that gets handed to someone else.
DATA_PROVENANCE: dict[str, Any] = {
    "tier": "synthetic",
    "licenseClass": "proprietary",
    "source": (
        "Insimul CanonicalWorldExports + rejection-sampled rule candidates, "
        "converted by pinakes_ml.insimul_datasets (insimul-bridge US-005)."
    ),
    "redistribution": (
        "Insimul-internal only. The rule-SFT corpus and the eval set are "
        "synthetic-tier / proprietary — never an open-data release, and never "
        "committed to git on either side."
    ),
    "syntheticNegatives": (
        "Preference negatives are corruption-sampled and kept only when the "
        "tier-4 validator confirms the corruption introduced a defect the "
        "original did not have; they are not model-generated."
    ),
    "modelOutputs": (
        "No third-party model's outputs were used as training targets: the SFT "
        "targets are Insimul's own validated Prolog rules."
    ),
}


# --- what Insimul's runtime has to change (measured against the checkout) --------

#: Gaps between the measured contract and what ``LocalAIProvider`` sends today,
#: each naming the file that has to change. Read off
#: ``insimul-server/server/services/ai/providers/local/local-ai-provider.ts`` and
#: ``insimul-server/server/config/ai-config.ts`` on 2026-07-22. Data, not prose,
#: so the runbook's claims and the doc block cannot drift apart.
RUNTIME_GAPS: tuple[dict[str, str], ...] = (
    {
        "id": "chat-wrapper-rebuilds-the-prompt",
        "where": "server/services/ai/providers/local/local-ai-provider.ts",
        "symbol": "LocalAIProvider.generate",
        "today": (
            "The system prompt is concatenated onto the user prompt "
            "(`${systemPrompt}\\n\\n${prompt}`) and handed to "
            "LlamaChatSession.prompt(), which re-renders it through "
            "node-llama-cpp's auto-detected chat wrapper."
        ),
        "required": (
            "Send `inferencePromptTemplate` verbatim through a raw-completion "
            "path (node-llama-cpp's LlamaCompletion), or construct the session "
            "with an explicit ChatML wrapper and a real system turn. The "
            "concatenated form is NOT the string the parity check measured."
        ),
    },
    {
        "id": "decoding-defaults-are-not-the-contract",
        "where": "server/services/ai/providers/local/local-ai-provider.ts",
        "symbol": "LocalAIProviderConfig defaults",
        "today": (
            "defaultTemperature 0.7, maxTokens 2048, no top-k and no stop set."
        ),
        "required": (
            "Rule authoring must use the contract's greedy settings "
            "(temperature 0, topK 1, maxNewTokens 96) and its stop triggers. "
            "Every adherence number in this bundle was measured under them."
        ),
    },
    {
        "id": "default-model-name-mismatch",
        "where": "server/config/ai-config.ts",
        "symbol": "getAIConfig().local.modelName",
        "today": (
            "Defaults to 'phi-4-mini-q4', which resolves to "
            "models/phi-4-mini-q4.gguf — a file scripts/setup-local-ai.sh does "
            "not download (it fetches qwen2.5-3b-instruct-q4_k_m.gguf)."
        ),
        "required": (
            "Set LOCAL_MODEL_PATH (absolute) or LOCAL_MODEL_NAME explicitly for "
            "the pilot model. Do not rely on the built-in default."
        ),
    },
    {
        "id": "rule-generation-does-not-route-through-the-provider",
        "where": "server/services/gemini-ai.ts",
        "symbol": "generateRule / generateRulesBatch / generateBulkRules",
        "today": (
            "Rule generation calls Gemini directly rather than resolving a "
            "provider through getAIProvider()."
        ),
        "required": (
            "Route rule authoring through the provider factory (or a dedicated "
            "rule-author provider) so AI_PROVIDER=local reaches it — otherwise "
            "the bundled model is loaded but never asked to author a rule."
        ),
    },
)


# --- the in-game evaluation checklist (data, so it is testable) ------------------

#: The AC's in-game evaluation loop. Kept as data because it is the part a
#: reader will actually execute, and because the harness it leans on
#: (``vespace-rule-generation-e2e``) is real code in the Insimul checkout — a
#: correction to US-001/US-003, which recorded it as absent after looking in
#: ``insimul-platform`` rather than ``insimul-server``.
IN_GAME_CHECKLIST: tuple[dict[str, str], ...] = (
    {
        "step": "Load the bundle",
        "detail": (
            "dvc pull ml/models, copy the GGUF into Insimul's models directory, "
            "set the environment block above, and confirm the startup log "
            "(logAIStatus) names the pilot model and the 4096-token context."
        ),
    },
    {
        "step": "Verify the artifact before trusting a score",
        "detail": (
            "sha256 the GGUF against model-manifest.json → model.sha256. A "
            "re-quantized or re-downloaded file is a different model and none of "
            "the numbers in this bundle describe it."
        ),
    },
    {
        "step": "Reproduce one measured generation",
        "detail": (
            "Take a prompt from rule-eval.jsonl, send it through the wired path, "
            "and check the output is a single clause terminated by a period. If "
            "it is prose, the chat wrapper is still rebuilding the prompt "
            "(gap `chat-wrapper-rebuilds-the-prompt`)."
        ),
    },
    {
        "step": "Generate rules in a test world",
        "detail": (
            "Author N rules per world across several worlds with AI_PROVIDER "
            "routed to the local model, keeping the vocabulary-grounding block "
            "in the user turn (the production arm)."
        ),
    },
    {
        "step": "Run the validator gate",
        "detail": (
            "Score every generation through Insimul's 4-layer validator "
            "(structural → schema/vocabulary → referential → persist). A "
            "generation with no clause-shaped line is a PARSE FAILURE and must "
            "be rejected, never coerced — the tier-4 parser would accept "
            '"I cannot help." as a one-atom clause.'
        ),
    },
    {
        "step": "Compare acceptance rate against Gemini",
        "detail": (
            "Same worlds, same prompts, same grounding block, same session: "
            "accepted / total for the local model vs the Gemini path. The "
            "VESPACE harness (insimul-server/server/__tests__/"
            "vespace-rule-generation-e2e/) already computes reachability and "
            "fireability over generated rules and is the natural place to add "
            "the local-model variant."
        ),
    },
    {
        "step": "Feed the outcome back",
        "detail": (
            "Every accepted/rejected candidate is preference data: the "
            "rule-candidates store (server/db/rule-candidates-store.ts) already "
            "records outcome + sourcePrompt + validator errors, and "
            "dataset-export-service builds rules.jsonl from it. That export is "
            "what lifts pinakes's corpus off the insufficient-data floor."
        ),
    },
)


# --- the generated Insimul settings ---------------------------------------------


def insimul_env_block(
    manifest: Mapping[str, Any], *, models_dir: str = "<insimul>/models"
) -> dict[str, str]:
    """The environment Insimul must set, generated from the bundle's own facts.

    ``ai-config.ts`` has no per-model registry today — the local provider is
    configured entirely from environment variables — so "the ai-config model
    entry" is this block. Values that were *measured* (the context size the
    parity check ran at) come from the manifest rather than being restated.
    """
    model = manifest.get("model") or {}
    runtime = manifest.get("runtime") or {}
    stem = Path(str(model.get("file", ""))).stem
    return {
        "AI_PROVIDER": "local",
        "LOCAL_MODEL_PATH": f"{models_dir}/{model.get('file', '')}",
        "LOCAL_MODEL_NAME": stem,
        "LOCAL_CONTEXT_SIZE": str(runtime.get("contextSize", "")),
        "LOCAL_GPU_LAYERS": str(runtime.get("gpuLayers", "")),
    }


def insimul_generation_settings(contract: Mapping[str, Any]) -> dict[str, Any]:
    """The decoding settings the call site must pass, lifted from the contract.

    Derived, never transcribed: these are the numbers
    :class:`~pinakes_ml.slm_gguf.LlamaCppRuleModel` scored under, so if the
    contract's generation block changes this changes with it.
    """
    generation = dict(contract.get("generation") or {})
    return {
        "temperature": generation.get("temperature"),
        "topK": generation.get("topK"),
        "topP": generation.get("topP"),
        "maxTokens": generation.get("maxNewTokens"),
        "stop": list(generation.get("stop") or ()),
    }


# --- file identity (pure) -------------------------------------------------------


def sha256_bytes(payload: bytes) -> str:
    """sha256 of an in-memory payload — used for files written this run."""
    return hashlib.sha256(payload).hexdigest()


def bundle_entry(root: Path | str, name: str) -> dict[str, Any]:
    """One inventory row: bundle-relative name, size, sha256.

    Names are bundle-relative on purpose. An absolute path records one
    operator's machine, and the recipient's bundle will live somewhere else.
    """
    path = Path(root) / name
    if not path.is_file():
        return {"name": name, "exists": False, "sizeBytes": None, "sha256": ""}
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return {
        "name": name,
        "exists": True,
        "sizeBytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
    }


def bundle_inventory(root: Path | str, names: Sequence[str]) -> list[dict[str, Any]]:
    """The inventory rows for ``names``, in the order given."""
    return [bundle_entry(root, name) for name in names]


# --- the model manifest (pure) --------------------------------------------------


#: Config keys whose values are paths the pipeline resolves to absolutes before
#: recording them. A bundle that ships ``/Users/<someone>/…`` is telling its
#: recipient where a stranger's checkout was.
PATH_CONFIG_KEYS: tuple[str, ...] = ("dvc_file", "eval_manifest")
PATH_LIST_CONFIG_KEYS: tuple[str, ...] = ("worlds", "candidates")


def strip_base(value: str, base: str) -> str:
    """``value`` relative to ``base`` when it is under it, else unchanged."""
    if not base:
        return value
    prefix = base.rstrip("/") + "/"
    return value[len(prefix) :] if value.startswith(prefix) else value


def _config_summary(config: Mapping[str, Any], base: str = "") -> dict[str, Any]:
    """The training config: reproducible fields only, no machine-local paths.

    ``output_dir`` is dropped (where one operator's adapter happened to land);
    the remaining path fields are made relative to the ``ml/`` root, because a
    rerun needs *which* config and *which* manifest, not whose disk.
    """
    summary: dict[str, Any] = {}
    for key, value in sorted(config.items()):
        if key == "output_dir":
            continue
        if key in PATH_CONFIG_KEYS and isinstance(value, str):
            summary[key] = strip_base(value, base)
        elif key in PATH_LIST_CONFIG_KEYS and isinstance(value, list | tuple):
            summary[key] = [
                strip_base(item, base) if isinstance(item, str) else item
                for item in value
            ]
        else:
            summary[key] = value
    return summary


def _sorted_arms(scores: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    """One score column, arms in a stable order (bytes must not depend on dict
    insertion order)."""
    return {arm: dict(row) for arm, row in sorted((scores or {}).items())}


def build_model_manifest(
    parity: Mapping[str, Any],
    *,
    baseline: Mapping[str, Any] | None = None,
    contract: Mapping[str, Any] | None = None,
    inventory: Sequence[Mapping[str, Any]] = (),
    gguf: Mapping[str, Any] | None = None,
    dataset_dvc_md5: str = "",
    context_size: int | None = None,
    gpu_layers: str | int = "auto",
    ml_root: str = "",
) -> dict[str, Any]:
    """The bundle's model manifest — provenance, scores, contract, license.

    Every measured field is **copied** from the US-003 baseline report and the
    US-004 parity report rather than recomputed: this story assembles, it does
    not re-measure. ``dataFloor`` rides along verbatim for the same reason it
    does in every other pilot artifact — the sufficiency verdict is a field, and
    a bundle that carried scores without it would read as a clearance.

    There is deliberately **no ``ml/models`` DVC md5 here**: this manifest lives
    inside that tree, so recording the tree's own hash is circular — writing the
    manifest changes the hash the manifest just claimed. (Same trap
    ``ml/CLAUDE.md`` records for the baselines doc and ``ml/data``.) The
    authoritative pin is the committed ``ml/models.dvc``; ``ml/data``'s md5 is
    recorded because the bundle does *not* live in that tree.
    """
    plan = parity.get("plan") or {}
    artifact = parity.get("artifact") or {}
    dataset = dict(parity.get("dataset") or {})
    scores = parity.get("scores") or {}
    identity = dict(gguf) if gguf is not None else {}
    runtime = parity.get("runtime") or {}
    baseline = baseline or {}
    contract = contract or {}
    return {
        "bundleVersion": BUNDLE_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "contractVersion": contract.get("contractVersion", CONTRACT_VERSION),
        "model": {
            "baseModel": plan.get("baseModel", ""),
            "runName": baseline.get("runName", ""),
            "quant": plan.get("quant", DEFAULT_QUANT),
            "file": Path(str(artifact.get("path", ""))).name,
            "sha256": identity.get("sha256", artifact.get("sha256", "")),
            "sizeBytes": identity.get("sizeBytes", artifact.get("sizeBytes")),
            "adapterSource": parity.get("hfSource", ""),
            "chatTemplateVerified": baseline.get("chatTemplateVerified"),
        },
        "training": {
            "config": _config_summary(baseline.get("config") or {}, ml_root),
            "repeats": baseline.get("repeats"),
            "stub": baseline.get("stub"),
        },
        "dataset": {
            **dataset,
            "evalSetFile": BUNDLE_EVAL_FILE,
            "dataDvcMd5": dataset_dvc_md5,
        },
        "dataFloor": dict(parity.get("dataFloor") or baseline.get("dataFloor") or {}),
        "scores": {
            "hf": _sorted_arms(scores.get("hf")),
            "gguf": _sorted_arms(scores.get("gguf")),
            "quantizationDeltas": dict(parity.get("deltas") or {}),
            "quantizationBudget": dict(parity.get("budget") or {}),
            "groundingAblation": dict(baseline.get("ablation") or {}),
        },
        "promptContract": {
            "file": CONTRACT_FILE,
            "contractVersion": contract.get("contractVersion", CONTRACT_VERSION),
            "systemPrompt": contract.get("systemPrompt", ""),
            "generation": insimul_generation_settings(contract),
            "productionArm": (contract.get("userPrompt") or {}).get("production", ""),
        },
        "runtime": {
            "target": "Insimul LocalAIService (node-llama-cpp)",
            "quant": plan.get("quant", DEFAULT_QUANT),
            "contextSize": context_size
            if context_size is not None
            else runtime.get("nCtx"),
            "gpuLayers": gpu_layers,
            "gaps": [dict(gap) for gap in RUNTIME_GAPS],
        },
        "license": {
            "baseModel": dict(BASE_MODEL_LICENSE),
            "trainingData": dict(DATA_PROVENANCE),
        },
        "files": [dict(entry) for entry in inventory],
    }


# --- verification (pure) --------------------------------------------------------


def verify_bundle(
    manifest: Mapping[str, Any], root: Path | str
) -> tuple[str, ...]:
    """Re-verify a bundle on disk against its manifest; empty tuple = clean.

    The point of shipping the manifest *and* the eval set is that the recipient
    can check both — so the check that proves it works lives here and is what
    ``pinakes-export-handoff --check`` runs.
    """
    problems: list[str] = []
    model = manifest.get("model") or {}
    # The manifest is written last and hashes everything else, so it cannot carry
    # its own digest; its presence is all that can be checked.
    if not (Path(root) / MODEL_MANIFEST_FILE).is_file():
        problems.append(f"missing: {MODEL_MANIFEST_FILE}")
    expected: list[Mapping[str, Any]] = []
    if model.get("file"):
        expected.append(
            {
                "name": model["file"],
                "sha256": model.get("sha256", ""),
                "sizeBytes": model.get("sizeBytes"),
            }
        )
    expected.extend(entry for entry in (manifest.get("files") or ()))
    for entry in expected:
        name = str(entry.get("name", ""))
        actual = bundle_entry(root, name)
        if not actual["exists"]:
            problems.append(f"missing: {name}")
            continue
        if entry.get("sha256") and actual["sha256"] != entry["sha256"]:
            problems.append(
                f"sha256 mismatch: {name} "
                f"({actual['sha256'][:12]}… != {str(entry['sha256'])[:12]}…)"
            )
        elif entry.get("sizeBytes") is not None and (
            actual["sizeBytes"] != entry["sizeBytes"]
        ):
            problems.append(f"size mismatch: {name}")
    return tuple(problems)


# --- the shipped prose (pure) ---------------------------------------------------


def render_license_notes(manifest: Mapping[str, Any]) -> str:
    """``LICENSE-NOTES.md`` — the obligations that travel with the bytes."""
    base = (manifest.get("license") or {}).get("baseModel") or {}
    data = (manifest.get("license") or {}).get("trainingData") or {}
    model = manifest.get("model") or {}
    alternatives = ", ".join(
        f"`{m}`" for m in base.get("apacheAlternativesChecked", ())
    )
    return "\n".join(
        [
            "# License notes — SLM pilot handoff bundle",
            "",
            "Generated by `pinakes-export-handoff` (slm-pilot US-005). This is a "
            "record of what the upstream licenses say, not legal advice.",
            "",
            "## Base model",
            "",
            f"- **Model:** `{base.get('baseModel', '')}`",
            f"- **License:** {base.get('licenseName', '')} "
            f"(`{base.get('licenseId', '')}`) — {base.get('licenseUrl', '')}",
            f"- **Commercial use:** {base.get('commercialUse', '')}",
            f"- **This artifact:** {base.get('derivativeStatus', '')}",
            "",
            "> ⚠️ The pilot's baseline was chosen to match Insimul's already-deployed "
            "GGUF, and **`Qwen2.5-3B-Instruct` is one of the two Qwen2.5 checkpoints "
            "that is not Apache-2.0.** " + str(base.get("note", "")),
            "",
            "### Required notices when this model is distributed",
            "",
            f"- NOTICE file: `{base.get('requiredNotice', '')}`",
            f"- {base.get('requiredAttribution', '')}",
            f"- Apache-2.0 alternatives verified so far: {alternatives or '—'}. "
            "Read every other candidate's own model card before assuming.",
            "",
            "## Training data",
            "",
            f"- **Tier / class:** `{data.get('tier', '')}` / "
            f"`{data.get('licenseClass', '')}`",
            f"- **Source:** {data.get('source', '')}",
            f"- **Redistribution:** {data.get('redistribution', '')}",
            f"- **Synthetic negatives:** {data.get('syntheticNegatives', '')}",
            f"- **Third-party model outputs:** {data.get('modelOutputs', '')}",
            "",
            "## The artifact these terms attach to",
            "",
            f"`{model.get('file', '')}` — "
            f"`sha256 {str(model.get('sha256', ''))[:16]}…`, "
            f"{model.get('quant', '')} quantization of a LoRA fine-tune of "
            f"`{base.get('baseModel', '')}`.",
            "",
        ]
    )


def render_bundle_readme(manifest: Mapping[str, Any]) -> str:
    """``README.md`` — what the recipient reads first, inside the bundle."""
    model = manifest.get("model") or {}
    dataset = manifest.get("dataset") or {}
    floor = (manifest.get("dataFloor") or {}).get("verdict", "")
    size = model.get("sizeBytes")
    lines = [
        "# SLM pilot — Insimul handoff bundle",
        "",
        f"Bundle version `{manifest.get('bundleVersion', '')}`, prompt contract "
        f"`{manifest.get('contractVersion', '')}`, protocol "
        f"`{manifest.get('protocolVersion', '')}`.",
        "",
        f"`{model.get('file', '')}`"
        + (f" — {size / 1e9:.2f} GB" if isinstance(size, int) else "")
        + f", `{model.get('quant', '')}`, a QLoRA fine-tune of "
        f"`{model.get('baseModel', '')}` on Insimul's rule-SFT corpus.",
        "",
    ]
    if floor:
        lines += [
            f"> ⚠️ **`dataFloor.verdict == \"{floor}\"`.** This bundle proves the "
            "pipeline — dataset → fine-tune → adherence eval → GGUF → handoff — "
            "runs end to end and is measured. It does **not** establish that the "
            "model is good enough to author rules in a shipping world. Wire it "
            "up, run the in-game checklist, and read the scores as machinery.",
            "",
        ]
    lines += [
        "## Contents",
        "",
        "| File | What it is |",
        "| --- | --- |",
        f"| `{model.get('file', '')}` | the model Insimul loads |",
        f"| `{MODEL_MANIFEST_FILE}` | provenance, training config, scores, license |",
        f"| `{CONTRACT_FILE}` | the exact strings the runtime must send |",
        f"| `{BUNDLE_EVAL_FILE}` | the frozen eval set, for re-verification |",
        f"| `{LICENSE_FILE}` | Qwen Research License + data provenance |",
        f"| `{README_FILE}` | this file |",
        "",
        "## Re-verify before trusting a number",
        "",
        "```sh",
        f"shasum -a 256 {model.get('file', '')}   # must equal model.sha256",
        "cd <pinakes>/ml && uv run pinakes-export-handoff --check",
        "```",
        "",
        f"The eval set here is `sha256 "
        f"{str(dataset.get('evalSetSha256', ''))[:16]}…` — the same one every "
        "score in the manifest was measured on. A score quoted against a "
        "different eval set is not a comparison point.",
        "",
        "## Wiring it into Insimul",
        "",
        "`docs/slm-insimul-runbook.md` in the pinakes repo — the environment "
        "block, the four runtime gaps that must be closed first, and the in-game "
        "evaluation checklist.",
        "",
    ]
    return "\n".join(lines)


# --- the doc block (pure) -------------------------------------------------------

DOC_MARK_START = "<!-- SLM-HANDOFF:START (generated by pinakes-export-handoff) -->"
DOC_MARK_END = "<!-- SLM-HANDOFF:END -->"


def render_handoff_section(manifest: Mapping[str, Any]) -> str:
    """The ``SLM-HANDOFF`` marked block for ``docs/slm-insimul-runbook.md``.

    Same cooperating-CLIs discipline as the ``SLM-QUANT`` block: the generated
    facts (inventory, hashes, the environment block, the runtime gaps, the
    checklist) live between markers so the surrounding prose can be edited by
    hand without either side clobbering the other.
    """
    model = manifest.get("model") or {}
    dataset = manifest.get("dataset") or {}
    contract = manifest.get("promptContract") or {}
    budget = (manifest.get("scores") or {}).get("quantizationBudget") or {}
    floor = (manifest.get("dataFloor") or {}).get("verdict", "")
    size = model.get("sizeBytes")
    env = insimul_env_block(manifest)
    lines = [
        DOC_MARK_START,
        "",
        "## The bundle (slm-pilot US-005)",
        "",
        "`ml/models/slm-pilot/` — DVC-tracked under its own pointer, the "
        "committed `ml/models.dvc`. `dvc pull ml/models` materialises the whole "
        "bundle. (The manifest records no `ml/models` md5: it lives *in* that "
        "tree, so the hash would be circular.)",
        "",
        "| File | sha256 | size |",
        "| --- | --- | ---: |",
    ]
    rows: list[Mapping[str, Any]] = []
    if model.get("file"):
        rows.append(
            {
                "name": model["file"],
                "sha256": model.get("sha256", ""),
                "sizeBytes": size,
            }
        )
    rows.extend(manifest.get("files") or ())
    for entry in rows:
        entry_size = entry.get("sizeBytes")
        shown = (
            f"{entry_size / 1e9:.2f} GB"
            if isinstance(entry_size, int) and entry_size >= 10**8
            else (f"{entry_size:,} B" if isinstance(entry_size, int) else "—")
        )
        digest = str(entry.get("sha256", ""))
        lines.append(
            f"| `{entry.get('name', '')}` | "
            f"`{digest[:16] + '…' if digest else '—'}` | {shown} |"
        )
    lines += [
        "",
        f"Base model `{model.get('baseModel', '')}`, quant "
        f"`{model.get('quant', '')}`, adapter from "
        f"`{model.get('adapterSource', '') or '—'}`. Eval set `sha256 "
        f"{str(dataset.get('evalSetSha256', ''))[:16]}…`, rule-SFT `sha256 "
        f"{str(dataset.get('ruleSftSha256', ''))[:16]}…`, `ml/data` md5 "
        f"`{dataset.get('dataDvcMd5', '') or '—'}`.",
        "",
    ]
    if floor:
        lines += [
            f"> ⚠️ **`dataFloor.verdict == \"{floor}\"`.** The bundle is the "
            "deliverable; its scores are machinery. Wiring this model into "
            "Insimul is how the pipeline gets exercised, not how the model gets "
            "cleared for authoring rules in a shipping world.",
            "",
        ]
    lines += [
        "## The environment block",
        "",
        "`ai-config.ts` has no per-model registry — `getAIConfig().local` is "
        "built entirely from environment variables, and `modelName` resolves by "
        "the convention `models/<name>.gguf`. So *the model entry* is this:",
        "",
        "```sh",
    ]
    lines += [f"{key}={value}" for key, value in env.items()]
    lines += [
        "```",
        "",
        "`LOCAL_CONTEXT_SIZE` is the context the parity check actually ran at; "
        "`LOCAL_GPU_LAYERS=auto` matches the provider's own default (`-1` → "
        "let node-llama-cpp decide). Generation settings at the call site:",
        "",
        "```json",
        _json_block(contract.get("generation") or {}),
        "```",
        "",
        "## Close these four gaps first",
        "",
        "| Gap | Where | Today | Required |",
        "| --- | --- | --- | --- |",
    ]
    for gap in manifest.get("runtime", {}).get("gaps", ()):
        lines.append(
            f"| `{gap.get('id', '')}` | `{gap.get('where', '')}` · "
            f"`{gap.get('symbol', '')}` | {gap.get('today', '')} | "
            f"{gap.get('required', '')} |"
        )
    lines += [
        "",
        "## In-game evaluation checklist",
        "",
    ]
    for index, item in enumerate(IN_GAME_CHECKLIST, start=1):
        lines.append(f"{index}. **{item['step']}** — {item['detail']}")
    verdict = budget.get("verdict")
    if verdict:
        lines += [
            "",
            f"Quantization budget at handoff: **{verdict}** "
            f"({budget.get('metric', '')} on the `{budget.get('arm', '')}` arm, "
            f"observed {budget.get('observedPp')} pp vs the frozen "
            f"≤ {budget.get('allowedPp')} pp).",
        ]
    lines += [
        "",
        "Regenerate: `cd ml && uv run pinakes-export-handoff` "
        "(`--dry-run` is the model-free smoke, `--check` re-verifies a "
        "materialised bundle against its manifest).",
        "",
        DOC_MARK_END,
    ]
    return "\n".join(lines) + "\n"


def _json_block(payload: Mapping[str, Any]) -> str:
    """A small, sorted JSON literal for the doc block."""
    return json.dumps(payload, indent=2, sort_keys=True)


def extract_marked_section(doc_text: str) -> str | None:
    """The handoff block (incl. markers) currently in the doc, or ``None``."""
    start = doc_text.find(DOC_MARK_START)
    end = doc_text.find(DOC_MARK_END)
    if start == -1 or end == -1 or end < start:
        return None
    return doc_text[start : end + len(DOC_MARK_END)]


def upsert_marked_section(doc_text: str, section: str) -> str:
    """Insert or replace the handoff block. Idempotent; appends when absent."""
    if not section:
        return doc_text
    existing = extract_marked_section(doc_text)
    body = section if section.endswith("\n") else section + "\n"
    if existing is not None:
        replaced = doc_text.replace(existing, body.rstrip("\n"), 1)
        return replaced if replaced.endswith("\n") else replaced + "\n"
    prefix = doc_text if doc_text.endswith("\n") else doc_text + "\n"
    return f"{prefix}\n{body}"


__all__ = [
    "BASE_MODEL_LICENSE",
    "BUNDLE_EVAL_FILE",
    "BUNDLE_SIDECAR_FILES",
    "BUNDLE_VERSION",
    "CONTRACT_FILE",
    "DATA_PROVENANCE",
    "DOC_MARK_END",
    "DOC_MARK_START",
    "IN_GAME_CHECKLIST",
    "LICENSE_FILE",
    "MODEL_MANIFEST_FILE",
    "README_FILE",
    "RUNTIME_GAPS",
    "build_model_manifest",
    "bundle_entry",
    "bundle_inventory",
    "extract_marked_section",
    "insimul_env_block",
    "insimul_generation_settings",
    "render_bundle_readme",
    "render_handoff_section",
    "render_license_notes",
    "sha256_bytes",
    "strip_base",
    "upsert_marked_section",
    "verify_bundle",
]
