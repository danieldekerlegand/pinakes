import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_NAMES,
  DEFAULT_WORLD,
  KINP_ENTITY_TYPES,
  RESOLVER_IDENTITY,
  assertValidCapabilityManifest,
  canonicalEntityTypes,
  capability,
  capabilityManifestFor,
  capabilitySpecialization,
  finetuneCapability,
  isManifestSigned,
  primarySurface,
  producedEntityPort,
  producedKnowledgePorts,
  type CapabilityManifest,
  type CapabilitySpecialization,
  type EntityPort,
  type MediaPort,
} from "./capability-manifest";

/** Deep-clone the live manifest so a test can mutate one field in isolation. */
function cloneManifest(): CapabilityManifest {
  return JSON.parse(JSON.stringify(CAPABILITY_MANIFEST)) as CapabilityManifest;
}

/** Mutable view of the clone (the published type is deeply readonly). */
type Mutable = {
  identity: string;
  produces: { plane: string; types?: string[]; dialect?: string; worlds?: string[] }[];
  capabilities: {
    name: string;
    x_grant: string;
    x_surfaces: { method: string; path: string; implementation: string; description: string }[];
  }[];
  auth: { scheme: string; grants_required: string[] };
};

function mutable(manifest: CapabilityManifest): Mutable {
  return manifest as unknown as Mutable;
}

/** Mutable view of the `finetune` entry (the published type is deeply readonly). */
type FinetuneShape = {
  name: string;
  inputs: { plane: string; types?: string[]; shape?: string }[];
  outputs: { plane: string; types?: string[]; media_types?: string[] }[];
  cost: { tier: string; est_units: number; meter?: string };
  x_specialization?: {
    provider_class: string;
    modality: string;
    methods: string[];
    egress: string;
    domains: string[];
  } & Partial<CapabilitySpecialization>;
};

describe("capability manifest", () => {
  it("is well-formed against KCB §2 (the live manifest validates)", () => {
    expect(() => assertValidCapabilityManifest()).not.toThrow();
  });

  it("publishes the KINP agent identity KCB §6 names for Pinakes", () => {
    expect(CAPABILITY_MANIFEST.identity).toBe(RESOLVER_IDENTITY);
    expect(CAPABILITY_MANIFEST.kcb_version).toBe("0.2.0");
    expect(CAPABILITY_MANIFEST.x_pinakes.identityIri).toBe(
      "https://id.koine.example/agent/pinakes/resolver",
    );
  });

  it("declares the resolve/reconcile/query capabilities with one grant each", () => {
    for (const name of CAPABILITY_NAMES) {
      const cap = capability(name);
      expect(cap, name).toBeDefined();
      expect(cap?.x_grant).toBe(`invoke:${name}`);
      expect(CAPABILITY_MANIFEST.auth.grants_required).toContain(`invoke:${name}`);
    }
    expect(CAPABILITY_MANIFEST.auth.scheme).toBe("capability-token");
  });

  it("produces a grounding-only knowledge port scoped to consensus reality", () => {
    const knowledge = producedKnowledgePorts();
    expect(knowledge.length).toBeGreaterThan(0);
    for (const port of knowledge) {
      expect(port.dialect).toBe("grounding-only");
      expect(port.worlds).toContain(DEFAULT_WORLD);
    }
    // The two producers are the already-built exporters, not new code.
    const producers = knowledge.map((p) => p.x_produced_by);
    expect(producers).toContain("scripts/export-for-engine.ts");
    expect(producers).toContain("scripts/export-entity-grounding.ts");
  });

  it("produces an entity port total over the canonical node types", () => {
    const port = producedEntityPort();
    expect(port).toBeDefined();
    expect([...(port?.types ?? [])].sort()).toEqual([...canonicalEntityTypes()].sort());
  });

  it("wraps already-built surfaces rather than declaring new implementations", () => {
    expect(primarySurface("resolve")).toMatchObject({
      method: "GET",
      path: "/api/graph/resolve",
      implementation: "server/services/graph-resolver.ts",
    });
    // The reconciler is the merged Python one — the manifest points at it, never replaces it.
    expect(primarySurface("reconcile")?.implementation).toBe(
      "engine/src/pinakes_engine/schema/reconcile.py",
    );
    expect(primarySurface("query")?.path).toBe("/api/graph/datalog");
    for (const name of CAPABILITY_NAMES) {
      expect(capability(name)?.x_surfaces.length, name).toBeGreaterThan(0);
    }
  });

  it("is unsigned until an Ed25519 key is provisioned, but carries the KCB §5 shape", () => {
    expect(isManifestSigned()).toBe(false);
    expect(CAPABILITY_MANIFEST.signing.alg).toBe("ed25519");
    expect(CAPABILITY_MANIFEST.signing.key_id).toBeNull();
  });
});

describe("capabilityManifestFor", () => {
  it("returns the as-authored manifest for a same-origin consumer", () => {
    expect(capabilityManifestFor(null)).toBe(CAPABILITY_MANIFEST);
    expect(capabilityManifestFor(null).endpoints.manifest).toBe("/.well-known/kcb-manifest.json");
  });

  it("absolutizes endpoints and surfaces so a registry entry is directly dialable", () => {
    const published = capabilityManifestFor("https://pinakes.example/");
    expect(published.endpoints.manifest).toBe(
      "https://pinakes.example/.well-known/kcb-manifest.json",
    );
    expect(published.endpoints.http).toBe("https://pinakes.example/api/kcb");
    expect(published.capabilities[0].x_surfaces[0].url).toBe(
      "https://pinakes.example/api/graph/resolve",
    );
    // Relative paths survive alongside the absolute URL, and the source is untouched.
    expect(published.capabilities[0].x_surfaces[0].path).toBe("/api/graph/resolve");
    expect(CAPABILITY_MANIFEST.endpoints.http).toBe("/api/kcb");
  });

  it("serves and absolutizes the MCP (41-US-1) and A2A (41-US-2) endpoints", () => {
    // The as-authored manifest advertises both fronts as server-relative paths.
    expect(CAPABILITY_MANIFEST.endpoints.mcp).toBe("/mcp");
    expect(CAPABILITY_MANIFEST.endpoints.a2a).toBe("/.well-known/agent-card.json");
    const published = capabilityManifestFor("https://pinakes.example");
    // US-4 absolutizes mcp/a2a alongside http/manifest so a registry entry is dialable.
    expect(published.endpoints.mcp).toBe("https://pinakes.example/mcp");
    expect(published.endpoints.a2a).toBe(
      "https://pinakes.example/.well-known/agent-card.json",
    );
    // The as-authored source is untouched (same-origin clients read relative paths).
    expect(CAPABILITY_MANIFEST.endpoints.mcp).toBe("/mcp");
  });
});

describe("assertValidCapabilityManifest", () => {
  it("rejects a foreign identity", () => {
    const m = cloneManifest();
    mutable(m).identity = "analyzer:agent:resolver";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/identity must be/);
  });

  it("rejects an entity port that drops a canonical node type", () => {
    const m = cloneManifest();
    const port = mutable(m).produces.find((p) => p.plane === "entity");
    port!.types = port!.types!.filter((t) => t !== "language");
    expect(() => assertValidCapabilityManifest(m)).toThrow(/missing canonical node type "language"/);
  });

  it("rejects an entity port naming a type the canonical schema does not define", () => {
    const m = cloneManifest();
    mutable(m).produces.find((p) => p.plane === "entity")!.types!.push("dragon");
    expect(() => assertValidCapabilityManifest(m)).toThrow(/unknown type "dragon"/);
  });

  it("rejects a knowledge port above the grounding-only dialect tier", () => {
    const m = cloneManifest();
    mutable(m).produces.find((p) => p.plane === "knowledge")!.dialect = "full-prolog";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/grounding-only/);
  });

  it("rejects a knowledge port scoped to another project's world", () => {
    const m = cloneManifest();
    mutable(m).produces.find((p) => p.plane === "knowledge")!.worlds = [
      "insimul:world:alderforest",
    ];
    expect(() => assertValidCapabilityManifest(m)).toThrow(/foreign world/);
  });

  it("rejects a capability with no built surface behind it", () => {
    const m = cloneManifest();
    mutable(m).capabilities.find((c) => c.name === "reconcile")!.x_surfaces = [];
    expect(() => assertValidCapabilityManifest(m)).toThrow(/declares no built surface/);
  });

  it("rejects a capability whose grant is not declared in auth", () => {
    const m = cloneManifest();
    mutable(m).auth.grants_required = ["invoke:resolve", "invoke:query"];
    expect(() => assertValidCapabilityManifest(m)).toThrow(/missing "invoke:reconcile"/);
  });

  it("rejects dropping one of the three KCB §6 capabilities", () => {
    const m = cloneManifest();
    const mm = mutable(m);
    mm.capabilities = mm.capabilities.filter((c) => c.name !== "query");
    mm.auth.grants_required = mm.auth.grants_required.filter((g) => g !== "invoke:query");
    expect(() => assertValidCapabilityManifest(m)).toThrow(/requires the "query" capability/);
  });

  it("rejects a populated mcp endpoint that is not a server-relative path", () => {
    const m = cloneManifest();
    (m as unknown as { endpoints: { mcp: string } }).endpoints.mcp = "mcp";
    expect(() => assertValidCapabilityManifest(m)).toThrow(
      /endpoints\.mcp must be null or a server-relative path/,
    );
  });

  it("rejects a populated a2a endpoint given as an absolute URL rather than a relative path", () => {
    const m = cloneManifest();
    (m as unknown as { endpoints: { a2a: string } }).endpoints.a2a =
      "https://evil.example/agent-card.json";
    expect(() => assertValidCapabilityManifest(m)).toThrow(
      /endpoints\.a2a must be null or a server-relative path/,
    );
  });

  it("allows a null mcp/a2a endpoint (the front is optional until stood up)", () => {
    const m = cloneManifest();
    const endpoints = (m as unknown as { endpoints: { mcp: string | null; a2a: string | null } })
      .endpoints;
    endpoints.mcp = null;
    endpoints.a2a = null;
    expect(() => assertValidCapabilityManifest(m)).not.toThrow();
  });

  it("rejects a populated signing.key_id that is an empty string", () => {
    const m = cloneManifest();
    (m as unknown as { signing: { key_id: string } }).signing.key_id = "";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/signing\.key_id must be a non-empty string/);
  });

  it("rejects a populated signing.key_id paired with an empty alg", () => {
    const m = cloneManifest();
    const signing = (m as unknown as { signing: { key_id: string; alg: string } }).signing;
    signing.key_id = "ed25519:abcdef0123456789";
    signing.alg = "";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/signing\.alg must be a non-empty string/);
  });

  it("accepts a populated signing.key_id paired with a non-empty alg (a signed manifest)", () => {
    const m = cloneManifest();
    const signing = (m as unknown as { signing: { key_id: string; alg: string } }).signing;
    signing.key_id = "ed25519:abcdef0123456789";
    signing.alg = "ed25519";
    expect(() => assertValidCapabilityManifest(m)).not.toThrow();
  });
});

/**
 * The KFT `finetune` capability (90-US-3). What these pin is not "the JSON has a
 * finetune entry" but that the ADVERTISEMENT matches what lugh's admission gate
 * actually admits — a manifest that quietly widened (a second modality, a `full`/`dpo`
 * method, an `exportable` egress) would make the registry route jobs here that
 * admission then refuses, which is exactly the failure FT-K's tiebreak exists to avoid.
 */
describe("the specialized KFT finetune capability", () => {
  /** Mutable view of the finetune entry on a clone. */
  function finetuneOf(m: CapabilityManifest) {
    return (m as unknown as { capabilities: FinetuneShape[] }).capabilities.find(
      (c) => c.name === "finetune",
    )!;
  }

  it("is advertised alongside the three KCB §6 capabilities, with its own grant", () => {
    const cap = finetuneCapability();
    expect(cap).toBeDefined();
    expect(cap?.x_grant).toBe("invoke:finetune");
    expect(CAPABILITY_MANIFEST.auth.grants_required).toContain("invoke:finetune");
    // KCB §6 does not *require* it — KFT is multi-provider, so it is additive.
    expect(CAPABILITY_NAMES).not.toContain("finetune" as never);
  });

  it("declares the KFT §2 cross-plane ports: base model in, model + weights out", () => {
    const cap = finetuneCapability()!;
    expect(cap.inputs.map((p) => p.plane)).toEqual(["entity", "knowledge"]);
    expect(cap.outputs.map((p) => p.plane)).toEqual(["entity", "media"]);
    // The base/finetuned model is a KINP `model` entity, not a canonical csid type.
    const base = cap.inputs.find((p) => p.plane === "entity") as EntityPort;
    expect(base.types).toEqual(["model"]);
    expect(base.shape).toBe("base-model");
    expect(KINP_ENTITY_TYPES).toContain("model");
    // The weights port is the only media port Pinakes publishes (KFT §5.3).
    const weights = cap.outputs.find((p) => p.plane === "media") as MediaPort;
    expect(weights.media_types).toEqual([
      "application/vnd.koine.model+safetensors",
      "application/vnd.koine.model+gguf",
    ]);
    // Cost is metered for KCB spend gating before the (expensive) invoke.
    expect(cap.cost).toMatchObject({ tier: "paid", meter: "gpu-seconds" });
    expect(cap.cost.est_units).toBeGreaterThan(0);
  });

  it("carries the FT-K specialization marker the registry breaks a tie on", () => {
    const spec = capabilitySpecialization("finetune")!;
    expect(spec.provider_class).toBe("specialized");
    expect(spec.modality).toBe("text-generation");
    expect([...spec.methods].sort()).toEqual(["lora", "qlora", "sft"]);
    // The provider's whole specialization: it never leaves the tier (KFT §4.2).
    expect(spec.egress).toBe("local-only");
    expect(spec.domains).toContain("neurosymbolic");
    // …and it names the general sibling a non-matching job belongs to.
    expect(spec.general_provider).toContain("agora");
    // The trainer lives in the private lugh repo now (90-extract-lugh), so the pointer
    // is repo-qualified rather than a path in this checkout.
    expect(spec.admission).toBe("lugh:pinakes-train-slm");
    // The three §6 capabilities are unspecialized — the marker is what distinguishes.
    for (const name of CAPABILITY_NAMES) expect(capabilitySpecialization(name)).toBeUndefined();
  });

  it("wraps the already-built lugh trainer rather than declaring new training code", () => {
    const implementations = finetuneCapability()!.x_surfaces.map((s) => s.implementation);
    expect(implementations).toContain("lugh:pinakes-train-slm");
    expect(implementations).toContain("server/services/finetune-provider.ts");
  });

  it("rejects a finetune capability with no specialization marker", () => {
    const m = cloneManifest();
    delete finetuneOf(m).x_specialization;
    expect(() => assertValidCapabilityManifest(m)).toThrow(/must declare x_specialization/);
  });

  it("rejects advertising Pinakes as the general trainer (that is agora's leg)", () => {
    const m = cloneManifest();
    finetuneOf(m).x_specialization!.provider_class = "general";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/must be a "specialized" provider/);
  });

  it("rejects an exportable egress — the §4.2 gate would never grant it", () => {
    const m = cloneManifest();
    finetuneOf(m).x_specialization!.egress = "exportable";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/must advertise egress "local-only"/);
  });

  it("rejects a modality or method outside the KFT vocabulary", () => {
    const bad = cloneManifest();
    finetuneOf(bad).x_specialization!.modality = "text-to-song";
    expect(() => assertValidCapabilityManifest(bad)).toThrow(/unknown KFT §3.1 modality/);

    const badMethod = cloneManifest();
    finetuneOf(badMethod).x_specialization!.methods = ["sft", "distill"];
    expect(() => assertValidCapabilityManifest(badMethod)).toThrow(/unknown KFT §3 method/);
  });

  it("rejects a weights port naming a media type koine's registry does not define", () => {
    const m = cloneManifest();
    const weights = finetuneOf(m).outputs.find((p) => p.plane === "media")!;
    weights.media_types = ["application/x-pickle"];
    expect(() => assertValidCapabilityManifest(m)).toThrow(/non-KMI media type/);
  });

  it("rejects a finetune capability that lost its model or weights port", () => {
    const noBase = cloneManifest();
    finetuneOf(noBase).inputs = finetuneOf(noBase).inputs.filter((p) => p.plane !== "entity");
    expect(() => assertValidCapabilityManifest(noBase)).toThrow(/base-model entity input port/);

    const noWeights = cloneManifest();
    finetuneOf(noWeights).outputs = finetuneOf(noWeights).outputs.filter(
      (p) => p.plane !== "media",
    );
    expect(() => assertValidCapabilityManifest(noWeights)).toThrow(/weights media output port/);
  });

  it("rejects a cost that is not metered in gpu-seconds (KFT §2 spend gating)", () => {
    const m = cloneManifest();
    finetuneOf(m).cost.meter = "requests";
    expect(() => assertValidCapabilityManifest(m)).toThrow(/must meter cost in "gpu-seconds"/);
  });
});
