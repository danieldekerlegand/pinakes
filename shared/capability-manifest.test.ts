import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_NAMES,
  DEFAULT_WORLD,
  RESOLVER_IDENTITY,
  assertValidCapabilityManifest,
  canonicalEntityTypes,
  capability,
  capabilityManifestFor,
  isManifestSigned,
  primarySurface,
  producedEntityPort,
  producedKnowledgePorts,
  type CapabilityManifest,
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
    expect(producers).toContain("scripts/export-for-culturescrape.ts");
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
      "packages/culture-scrape/src/culturescrape/schema/reconcile.py",
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

  it("serves the MCP endpoint (41-US-1); a2a stays null until that front lands", () => {
    // The as-authored manifest advertises the /mcp surface as a server-relative path.
    expect(CAPABILITY_MANIFEST.endpoints.mcp).toBe("/mcp");
    const published = capabilityManifestFor("https://pinakes.example");
    expect(published.endpoints.mcp).toBe("/mcp");
    expect(published.endpoints.a2a).toBeNull();
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
});
