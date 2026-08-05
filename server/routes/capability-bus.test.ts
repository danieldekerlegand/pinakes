import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the KCB capability-bus routes. Registration is driven with
 * an injected publisher (no network), so both the registered and the
 * registry-unreachable paths are asserted to serve the same manifest.
 *
 * **Half of this group is ported** (pinakes:65 US-1): `/api/kcb/capabilities` and
 * `/api/kcb/status` answer 501 here and are served by
 * `services/api/src/pinakes/routers/capability_bus.py` — their assertions moved to
 * `services/api/tests/test_capability_bus.py`, where the directory's `specialization`
 * block and the registration record are graded against the same manifest. The two
 * manifest fronts keep answering here, for two different reasons the module
 * docstring spells out (the recorded fixture; the self-sufficiency guard).
 */

import {
  registerCapabilityBusRoutes,
  MANIFEST_WELL_KNOWN_PATH,
  PORTED_ROUTES,
  PORTED_ERROR,
  type CapabilityBusRouteOptions,
} from "./capability-bus";
import type { PublishResult } from "../services/capability-registry";
import { generateSigningKeyPair, verifyManifestSignature } from "../services/manifest-signing";
import type { CapabilityManifest } from "@contracts/capability-manifest";

const REGISTERED: PublishResult = {
  registered: true,
  servingDirectly: true,
  registryUrl: "https://registry.example",
  detail: "Published pinakes:agent:resolver to the KCB registry.",
};

const UNREACHABLE: PublishResult = {
  registered: false,
  servingDirectly: true,
  registryUrl: "https://registry.example",
  detail: "Registry unreachable (fetch failed) — capabilities remain invocable directly.",
};

/** Start a server with the bus routes registered, and return its base URL + teardown. */
async function startServer(options: CapabilityBusRouteOptions) {
  const app: Express = express();
  app.use(express.json());
  registerCapabilityBusRoutes(app, options);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("capability-bus routes (registry reachable)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const started = await startServer({
      origin: "https://pinakes.example",
      publish: async () => REGISTERED,
    });
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterAll(() => close());

  it("serves the KCB §2 manifest at the well-known path", async () => {
    const res = await fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`);
    expect(res.status).toBe(200);
    const manifest = await res.json();
    expect(manifest.identity).toBe("pinakes:agent:resolver");
    expect(manifest.kcb_version).toBe("0.2.0");
    expect(manifest.capabilities.map((c: { name: string }) => c.name)).toEqual([
      "resolve",
      "reconcile",
      "query",
      // The specialized KFT provider (90-US-3) rides on the same document.
      "finetune",
    ]);
  });

  it("serves the same manifest under the API prefix", async () => {
    const [wellKnown, api] = await Promise.all([
      fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`).then((r) => r.json()),
      fetch(`${baseUrl}/api/kcb/manifest`).then((r) => r.json()),
    ]);
    expect(api).toEqual(wellKnown);
  });

  it("declares the grounding-only knowledge port scoped to consensus reality", async () => {
    const manifest = await fetch(`${baseUrl}/api/kcb/manifest`).then((r) => r.json());
    const knowledge = manifest.produces.filter(
      (p: { plane: string }) => p.plane === "knowledge",
    );
    expect(knowledge.length).toBeGreaterThan(0);
    for (const port of knowledge) {
      expect(port.dialect).toBe("grounding-only");
      expect(port.worlds).toContain("pinakes:world:consensus-reality");
    }
  });

  it("absolutizes surfaces against the configured origin so peers can dial directly", async () => {
    const manifest = await fetch(`${baseUrl}/api/kcb/manifest`).then((r) => r.json());
    expect(manifest.endpoints.manifest).toBe(
      "https://pinakes.example/.well-known/kcb-manifest.json",
    );
    // The MCP tools surface + the A2A agent-card are absolutized alongside http/manifest (US-4).
    expect(manifest.endpoints.mcp).toBe("https://pinakes.example/mcp");
    expect(manifest.endpoints.a2a).toBe(
      "https://pinakes.example/.well-known/agent-card.json",
    );
    const resolve = manifest.capabilities.find((c: { name: string }) => c.name === "resolve");
    expect(resolve.x_surfaces[0].url).toBe("https://pinakes.example/api/graph/resolve");
  });

  it("retires the directory and the status route to 501, naming their replacement", async () => {
    for (const route of PORTED_ROUTES) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status, route).toBe(501);
      const body = await res.json();
      expect(body.error).toBe(PORTED_ERROR);
      expect(body.servedBy).toBe("services/api/src/pinakes/routers/capability_bus.py");
      expect(body.route).toBe(`GET ${route}`);
    }
  });
});

describe("capability-bus routes (registry unreachable)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = await startServer({
      origin: "https://pinakes.example",
      publish: async () => UNREACHABLE,
    });
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterAll(async () => {
    await close();
    warn.mockRestore();
  });

  it("still serves the manifest — the registry is a cache, not a dependency", async () => {
    const res = await fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`);
    expect(res.status).toBe(200);
    expect((await res.json()).identity).toBe("pinakes:agent:resolver");
  });

  it("still carries every capability with the endpoints behind it", async () => {
    // The invocation directory moved to the Python service; what this front still
    // owes a consumer that cannot reach the registry is the manifest those
    // surfaces are read off — so assert on the document, not on the directory.
    const manifest = await fetch(`${baseUrl}/api/kcb/manifest`).then((r) => r.json());
    expect(manifest.capabilities).toHaveLength(4);
    for (const cap of manifest.capabilities) {
      expect(cap.x_surfaces.length, cap.name).toBeGreaterThan(0);
    }
  });

  it("warns about the failure without letting it reach the manifest", async () => {
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/unreachable/i);
    const res = await fetch(`${baseUrl}/api/kcb/manifest`);
    expect(res.status).toBe(200);
  });
});

describe("capability-bus routes (no registry configured)", () => {
  it("serves the as-authored, server-relative manifest for a same-origin client", async () => {
    const { baseUrl, close } = await startServer({ origin: null, skipRegistration: true });
    try {
      const manifest = await fetch(`${baseUrl}/api/kcb/manifest`).then((r) => r.json());
      expect(manifest.endpoints.manifest).toBe("/.well-known/kcb-manifest.json");
      expect(manifest.capabilities[0].x_surfaces[0].url).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("falls back to the requesting origin when no public origin is configured", async () => {
    delete process.env.PINAKES_PUBLIC_ORIGIN;
    const { baseUrl, close } = await startServer({ skipRegistration: true });
    try {
      const manifest = await fetch(`${baseUrl}/api/kcb/manifest`).then((r) => r.json());
      expect(manifest.endpoints.manifest).toBe(`${baseUrl}/.well-known/kcb-manifest.json`);
    } finally {
      await close();
    }
  });
});

describe("capability-bus routes (signing configured)", () => {
  const savedKey = process.env.PINAKES_SIGNING_PRIVATE_KEY;
  const savedId = process.env.PINAKES_SIGNING_KEY_ID;
  let publicKeyPem: string;
  let keyId: string;

  beforeAll(() => {
    const pair = generateSigningKeyPair();
    publicKeyPem = pair.publicKeyPem;
    keyId = pair.keyId;
    process.env.PINAKES_SIGNING_PRIVATE_KEY = pair.privateKeyPem;
    delete process.env.PINAKES_SIGNING_KEY_ID;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.PINAKES_SIGNING_PRIVATE_KEY;
    else process.env.PINAKES_SIGNING_PRIVATE_KEY = savedKey;
    if (savedId === undefined) delete process.env.PINAKES_SIGNING_KEY_ID;
    else process.env.PINAKES_SIGNING_KEY_ID = savedId;
  });

  it("serves a signed manifest that verifies, and reports signed:true", async () => {
    const { baseUrl, close } = await startServer({
      origin: "https://pinakes.example",
      skipRegistration: true,
    });
    try {
      const manifest = (await fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`).then((r) =>
        r.json(),
      )) as CapabilityManifest;
      expect(manifest.signing.key_id).toBe(keyId);
      expect(typeof manifest.signing.signature).toBe("string");
      expect(verifyManifestSignature(manifest, publicKeyPem)).toBe(true);
      expect(manifest.x_pinakes.manifestVersion).toBe("0.4.0");
    } finally {
      await close();
    }
  });
});
