import { describe, it, expect } from "vitest";

/**
 * FT-K multi-provider routing conformance (90-US-4).
 *
 * The claim under test is not "our router works" — the registry is agora's (KFT §8) —
 * but that **Pinakes's published manifest carries enough signal to be routed to
 * correctly**: a specialized SLM rule-authoring / neurosymbolic job lands here, a
 * generic `text-generation` job is left to the general trainer, and a job outside the
 * lugh pipeline's contract is refused at routing with the same code
 * lugh would refuse it with at admission.
 *
 * Pinakes's side of the fixture is the **real, live manifest** (`CAPABILITY_MANIFEST`),
 * so a future widening of `x_specialization` fails here as well as in
 * `assertFinetuneCapability`. agora's side is a hand-written stub — its own manifest
 * belongs to `agora:90-finetune-trainer` and is not built in this repo.
 */
import { CAPABILITY_MANIFEST, type Capability } from "@contracts/capability-manifest";
import {
  DATASET_KIND_DOMAINS,
  jobSignals,
  selectFinetuneProvider,
  specificityOf,
  type ProviderManifest,
} from "./finetune-routing";

const PINAKES: ProviderManifest = CAPABILITY_MANIFEST;

/**
 * A stub of agora's **general** trainer (`agora:90-finetune-trainer`, KFT §9): every
 * modality, every method, both dataset planes, and — crucially — **no**
 * `x_specialization`, which is what "general" means on the wire. Cloned in shape from
 * Pinakes's entry rather than derived from it, so loosening Pinakes's advertisement can
 * never silently loosen the fixture too.
 */
const AGORA_TRAINER: Capability = {
  name: "finetune",
  description:
    "The general KFT trainer — every modality × method, engine ladder " +
    "LLaMA-Factory / Unsloth / Axolotl / diffusers, cloud-capable under the §4.2 egress gate.",
  inputs: [
    { plane: "entity", types: ["model"], shape: "base-model" },
    { plane: "knowledge", dialect: "grounding-only", shape: "training-set" },
    { plane: "media", media_types: ["application/vnd.koine.model+safetensors"], shape: "training-set" },
  ],
  outputs: [
    { plane: "entity", types: ["model"], shape: "finetuned-model" },
    { plane: "media", media_types: ["application/vnd.koine.model+safetensors"], shape: "weights" },
  ],
  cost: { tier: "paid", meter: "gpu-seconds", est_units: 3600 },
  x_grant: "invoke:finetune",
  x_surfaces: [
    {
      method: "POST",
      path: "/mcp",
      implementation: "agora/…/trainer.rs",
      description: "Stub of the general trainer's invoke surface — built in agora, not here.",
    },
  ],
};

const AGORA: ProviderManifest = {
  identity: "agora:agent:trainer",
  capabilities: [AGORA_TRAINER],
};

/** Both providers registered, in the order the registry happens to hold them. */
const REGISTRY = [AGORA, PINAKES];

interface JobOverrides {
  readonly modality?: string;
  readonly method?: string;
  readonly datasetKind?: string | null;
  readonly media?: readonly string[];
}

/** A well-formed KFT job; only the fields routing reads vary. */
function job(over: JobOverrides = {}): Record<string, unknown> {
  const { modality = "text-generation", method = "qlora", datasetKind = "rule-sft", media } = over;
  return {
    kft_version: "0.3.0",
    job: "orchestrator:activity:ft-run/route-1",
    base_model: "pinakes:model:qwen2.5-3b-instruct",
    modality,
    method,
    dataset: {
      knowledge: ["kgp:pack:sha256-7b1e0f3c9a2d4e6f8a0c2e4b6d8f0a2c"],
      ...(media ? { media: [...media] } : {}),
      ...(datasetKind
        ? {
            header: {
              record: "header",
              contractVersion: "0.4.0",
              datasetKind,
              source: "pinakes",
              tier: "synthetic",
              license: "LicenseRef-Insimul-Proprietary",
            },
          }
        : {}),
    },
    compute: { class: "local-mps", egress: "derived" },
    seed: 20260722,
  };
}

describe("jobSignals", () => {
  it("reads the specialization signal off the dataset header, not off a job field", () => {
    // KFT 0.3.0's job schema is additionalProperties:false and has no `domain` field —
    // the koine dataset-jsonl-header's `datasetKind` is what the emitters already stamp.
    const signals = jobSignals(job({ datasetKind: "rule-sft" }));
    expect(signals.modality).toBe("text-generation");
    expect(signals.method).toBe("qlora");
    expect(signals.datasetKind).toBe("rule-sft");
    expect(signals.source).toBe("pinakes");
    expect(signals.domains).toEqual(["slm-rule-authoring"]);
  });

  it("resolves every mapped dataset kind to a domain Pinakes actually advertises", () => {
    const advertised = new Set(
      CAPABILITY_MANIFEST.capabilities.find((c) => c.name === "finetune")?.x_specialization
        ?.domains ?? [],
    );
    expect(advertised.size).toBeGreaterThan(0);
    for (const domains of Object.values(DATASET_KIND_DOMAINS)) {
      for (const domain of domains) expect(advertised.has(domain)).toBe(true);
    }
  });

  it("carries NO signal for an unmapped kind or a header-less job", () => {
    expect(jobSignals(job({ datasetKind: "generations" })).domains).toEqual([]);
    expect(jobSignals(job({ datasetKind: null })).domains).toEqual([]);
    expect(jobSignals(job({ datasetKind: null })).datasetKind).toBeNull();
  });

  it("counts the media assets that make a job multimodal", () => {
    expect(jobSignals(job({ media: ["analyzer:asset:blake3-a1b2"] })).mediaCount).toBe(1);
    expect(jobSignals(job()).mediaCount).toBe(0);
  });

  it("does not throw on a job it cannot read — admission owns rejection, not routing", () => {
    expect(jobSignals(null).modality).toBe("");
    expect(jobSignals({ dataset: "nonsense" }).mediaCount).toBe(0);
  });
});

describe("specificityOf", () => {
  it("scores the live Pinakes advertisement on all four narrowing dimensions", () => {
    const spec = CAPABILITY_MANIFEST.capabilities.find((c) => c.name === "finetune")
      ?.x_specialization;
    expect(spec?.provider_class).toBe("specialized");
    expect(specificityOf(spec)).toBe(4);
  });

  it("scores a general provider 0 — declaring no narrowing is what general means", () => {
    expect(specificityOf(undefined)).toBe(0);
    expect(specificityOf(AGORA_TRAINER.x_specialization)).toBe(0);
  });
});

describe("selectFinetuneProvider — the FT-K tiebreak (KFT §8/§9)", () => {
  it("prefers the MORE SPECIALIZED provider for an SLM rule-authoring job", () => {
    const decision = selectFinetuneProvider({ job: job({ datasetKind: "rule-sft" }) }, REGISTRY);
    expect(decision.outcome).toBe("routed");
    expect(decision.provider).toBe("pinakes:agent:resolver");
    expect(decision.reason).toContain("more specialized");
    // agora is not rejected — it would happily run it; it is simply the weaker match.
    expect(decision.rejected).toEqual([]);
    expect(decision.candidates.map((c) => c.identity)).toEqual([
      "pinakes:agent:resolver",
      "agora:agent:trainer",
    ]);
    expect(decision.candidates[0].rank).toBe("specialized");
    expect(decision.candidates[0].matchedDomains).toEqual(["slm-rule-authoring"]);
    expect(decision.candidates[1].rank).toBe("general");
  });

  it("prefers Pinakes for a neurosymbolic job too", () => {
    const decision = selectFinetuneProvider({ job: job({ datasetKind: "lore-qa" }) }, REGISTRY);
    expect(decision.provider).toBe("pinakes:agent:resolver");
    expect(decision.candidates[0].matchedDomains).toEqual(["neurosymbolic"]);
  });

  it("leaves a generic text-generation job with NO specialization signal to the general trainer", () => {
    const decision = selectFinetuneProvider({ job: job({ datasetKind: null }) }, REGISTRY);
    expect(decision.outcome).toBe("routed");
    expect(decision.provider).toBe("agora:agent:trainer");
    // Pinakes is cheaper (1800 vs 3600 gpu-seconds) and still does not win: an unsignalled
    // job ranks a narrow provider `fallback`, below general, before cost is ever consulted.
    const pinakes = decision.candidates.find((c) => c.identity === "pinakes:agent:resolver");
    expect(pinakes?.rank).toBe("fallback");
    expect(pinakes?.cost).toBeLessThan(3600);
  });

  it("honours an explicit target — a job MAY name Pinakes even with no domain signal", () => {
    const decision = selectFinetuneProvider(
      { job: job({ datasetKind: null }), target: "pinakes:agent:resolver" },
      REGISTRY,
    );
    expect(decision.outcome).toBe("routed");
    expect(decision.provider).toBe("pinakes:agent:resolver");
    expect(decision.reason).toContain("explicitly");
    // The distinction that makes this correct: `fallback` is a *preference*, not a
    // refusal — lugh admits a knowledge-plane text-generation qlora job either way.
    expect(decision.rejected).toEqual([]);
  });

  it("refuses an explicit target that the provider's own contract would refuse", () => {
    const decision = selectFinetuneProvider(
      { job: job({ modality: "text-to-image", method: "lora" }), target: "pinakes:agent:resolver" },
      REGISTRY,
    );
    expect(decision.outcome).toBe("unroutable");
    expect(decision.provider).toBeNull();
    expect(decision.reason).toContain("would refuse");
  });

  it("reports an explicit target that is not registered at all", () => {
    const decision = selectFinetuneProvider({ job: job(), target: "composer:agent:trainer" }, REGISTRY);
    expect(decision.outcome).toBe("unroutable");
    expect(decision.reason).toContain("no such provider is registered");
  });

  it("surfaces an unbroken tie instead of resolving it silently (FT-K)", () => {
    const twin: ProviderManifest = { identity: "agora:agent:trainer-eu", capabilities: [AGORA_TRAINER] };
    const decision = selectFinetuneProvider({ job: job({ datasetKind: null }) }, [AGORA, twin]);
    expect(decision.outcome).toBe("tie");
    expect(decision.provider).toBeNull();
    expect(decision.reason).toContain("agora:agent:trainer and agora:agent:trainer-eu");
  });

  it("breaks a same-rank tie on lower cost (KCB §3) before surfacing it", () => {
    const dearer: ProviderManifest = {
      identity: "agora:agent:trainer-eu",
      capabilities: [{ ...AGORA_TRAINER, cost: { ...AGORA_TRAINER.cost, est_units: 7200 } }],
    };
    const decision = selectFinetuneProvider({ job: job({ datasetKind: null }) }, [dearer, AGORA]);
    expect(decision.outcome).toBe("routed");
    expect(decision.provider).toBe("agora:agent:trainer");
    expect(decision.reason).toContain("cheapest");
  });

  it("routes to Pinakes as an explained fallback when no general trainer is registered", () => {
    const decision = selectFinetuneProvider({ job: job({ datasetKind: null }) }, [PINAKES]);
    expect(decision.outcome).toBe("routed");
    expect(decision.provider).toBe("pinakes:agent:resolver");
    expect(decision.candidates[0].rank).toBe("fallback");
    expect(decision.reason).toContain("general trainer is not registered");
  });
});

describe("selectFinetuneProvider — routing refusals mirror lugh admission", () => {
  // Each code below is one lugh emits, so a job the registry
  // declines to send here is declined for the reason admission would have given.
  it("refuses a non-text-generation job with `unsupported-modality`", () => {
    const decision = selectFinetuneProvider(
      { job: job({ modality: "text-to-image", method: "lora" }) },
      REGISTRY,
    );
    expect(decision.provider).toBe("agora:agent:trainer");
    expect(decision.rejected).toEqual([
      expect.objectContaining({ identity: "pinakes:agent:resolver", code: "unsupported-modality" }),
    ]);
  });

  it("refuses a method the lugh pipeline does not implement with `unsupported-method`", () => {
    const decision = selectFinetuneProvider({ job: job({ method: "dpo" }) }, REGISTRY);
    expect(decision.provider).toBe("agora:agent:trainer");
    expect(decision.rejected[0]).toMatchObject({
      identity: "pinakes:agent:resolver",
      code: "unsupported-method",
    });
  });

  it("refuses a multimodal dataset with `unsupported-dataset-plane`", () => {
    // Pinakes's capability declares entity + knowledge input ports and no media port;
    // agora's stub declares one, which is the whole difference.
    const decision = selectFinetuneProvider(
      { job: job({ media: ["analyzer:asset:blake3-a1b2"] }) },
      REGISTRY,
    );
    expect(decision.provider).toBe("agora:agent:trainer");
    expect(decision.rejected[0]).toMatchObject({
      identity: "pinakes:agent:resolver",
      code: "unsupported-dataset-plane",
    });
  });

  it("is unroutable when every registered provider would refuse", () => {
    const decision = selectFinetuneProvider(
      { job: job({ modality: "text-to-video", method: "full" }) },
      [PINAKES],
    );
    expect(decision.outcome).toBe("unroutable");
    expect(decision.provider).toBeNull();
    expect(decision.reason).toContain("would refuse it");
  });

  it("ignores a manifest with no finetune capability at all", () => {
    const resolverOnly: ProviderManifest = {
      identity: "orchestrator:agent:console",
      capabilities: CAPABILITY_MANIFEST.capabilities.filter((c) => c.name !== "finetune"),
    };
    const decision = selectFinetuneProvider({ job: job() }, [resolverOnly, PINAKES]);
    expect(decision.provider).toBe("pinakes:agent:resolver");
    expect(decision.rejected[0]).toMatchObject({
      identity: "orchestrator:agent:console",
      code: "no-finetune-capability",
    });
  });
});
