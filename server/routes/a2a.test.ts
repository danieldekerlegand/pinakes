import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { AgentCard } from "@a2a-js/sdk";

import {
  registerA2aRoutes,
  AGENT_CARD_ROUTE_PATH,
  KCB_MANIFEST_EXTENSION_URI,
} from "./a2a";
import { CAPABILITY_MANIFEST } from "@shared/capability-manifest";

/**
 * Integration tests for the A2A agent-card surface (41-US-2). A real Express server
 * serves the card at `/.well-known/agent-card.json`; the test fetches it over the
 * wire and asserts a crawler recovers the three KCB §6 skills AND the full KCB §2
 * manifest from the AgentCard extension — the KCB §4 describe path over A2A.
 */

async function startServer(origin: string | null | undefined) {
  const app: Express = express();
  registerA2aRoutes(app, origin === undefined ? {} : { origin });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("A2A agent-card surface (/.well-known/agent-card.json)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // Serve the as-authored (server-relative) card so assertions are origin-free.
    const started = await startServer(null);
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterAll(() => close());

  async function fetchCard(): Promise<Record<string, unknown>> {
    const res = await fetch(`${baseUrl}${AGENT_CARD_ROUTE_PATH}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  it("is a valid A2A AgentCard advertising the pinakes:agent:resolver identity", async () => {
    const card = await fetchCard();
    // Round-trips cleanly through the official SDK codec (it is a real AgentCard).
    expect(() => AgentCard.fromJSON(card)).not.toThrow();
    expect(card.name).toBe(CAPABILITY_MANIFEST.identity);
    expect(card.name).toBe("pinakes:agent:resolver");
    expect((card.provider as { organization: string }).organization).toBe("Pinakes");
  });

  it("exposes every manifest capability as an A2A skill mirroring the manifest", async () => {
    const card = await fetchCard();
    const skills = card.skills as Array<{ id: string; name: string; description: string; tags: string[] }>;
    expect(skills.map((s) => s.id).sort()).toEqual([
      "finetune",
      "query",
      "reconcile",
      "resolve",
    ]);
    for (const capability of CAPABILITY_MANIFEST.capabilities) {
      const skill = skills.find((s) => s.id === capability.name);
      expect(skill, capability.name).toBeDefined();
      // Descriptions/tags mirror the capability manifest.
      expect(skill?.description).toBe(capability.description);
      expect(skill?.tags).toContain(capability.name);
    }
  });

  it("tags the finetune skill with its FT-K specialization so a crawler can route on the card alone", async () => {
    const card = await fetchCard();
    const skills = card.skills as Array<{ id: string; tags: string[] }>;
    const finetune = skills.find((s) => s.id === "finetune");
    expect(finetune, "finetune skill").toBeDefined();
    // KFT §9/FT-K: the registry prefers the MORE specialized provider, and these are
    // the signals it breaks the tie on — carried as tags, not only in the extension.
    expect(finetune?.tags).toEqual(
      expect.arrayContaining([
        "finetune",
        "specialized",
        "text-generation",
        "local-only",
        "neurosymbolic",
        "media",
      ]),
    );
    // The unspecialized §6 capabilities carry no such marker.
    expect(skills.find((s) => s.id === "resolve")?.tags).not.toContain("specialized");
  });

  it("points its invocation interface at the /mcp surface (US-1)", async () => {
    const card = await fetchCard();
    const interfaces = card.supportedInterfaces as Array<{ url: string; protocolBinding: string }>;
    expect(interfaces[0].url).toBe("/mcp");
    expect(interfaces[0].protocolBinding).toBe("MCP");
  });

  it("carries the full KCB manifest as a card extension (crawler recovers §2)", async () => {
    const card = await fetchCard();
    const capabilities = card.capabilities as { extensions: Array<{ uri: string; params: Record<string, unknown> }> };
    const ext = capabilities.extensions.find((e) => e.uri === KCB_MANIFEST_EXTENSION_URI);
    expect(ext, "KCB manifest extension").toBeDefined();
    const params = ext!.params;
    // The KCB §2 payload rides verbatim in the extension params.
    expect(params.kcb_version).toBe(CAPABILITY_MANIFEST.kcb_version);
    expect(params.mcp).toBe("/mcp");
    expect(params.produces).toEqual(CAPABILITY_MANIFEST.produces);
    expect(params.consumes).toEqual(CAPABILITY_MANIFEST.consumes);
    expect(params.auth).toEqual(CAPABILITY_MANIFEST.auth);
    expect(params.signing).toEqual(CAPABILITY_MANIFEST.signing);
    // The embedded capabilities recover every invocable unit with its surfaces.
    const embedded = params.capabilities as Array<{ name: string; x_surfaces: unknown[] }>;
    expect(embedded.map((c) => c.name).sort()).toEqual([
      "finetune",
      "query",
      "reconcile",
      "resolve",
    ]);
    expect(embedded.every((c) => c.x_surfaces.length > 0)).toBe(true);
  });
});

describe("A2A agent-card absolutization", () => {
  it("absolutizes the invocation url against a configured origin", async () => {
    const started = await startServer("https://pinakes.example/");
    try {
      const res = await fetch(`${started.baseUrl}${AGENT_CARD_ROUTE_PATH}`);
      const card = (await res.json()) as {
        supportedInterfaces: Array<{ url: string }>;
        capabilities: { extensions: Array<{ params: { mcp: string } }> };
      };
      expect(card.supportedInterfaces[0].url).toBe("https://pinakes.example/mcp");
      expect(card.capabilities.extensions[0].params.mcp).toBe("https://pinakes.example/mcp");
    } finally {
      await started.close();
    }
  });
});
