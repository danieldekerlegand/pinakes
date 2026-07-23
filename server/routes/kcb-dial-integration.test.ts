import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * KCB §4 describe→invoke→verify against the LIVE provider (41-US-5). The three
 * transport surfaces stood up by US-1/US-2/US-3 are mounted on ONE Express app — the
 * MCP server (`/mcp`, live handlers), the A2A agent-card (`/.well-known/agent-card.json`),
 * and the signed capability-bus manifest (`/.well-known/kcb-manifest.json`) — so a
 * resolver/console can dial Pinakes as the real authority instead of a stand-in fixture:
 *
 *  1. **describe** — fetch the A2A card + an MCP `list_tools`; both recover the three
 *     KCB §6 capabilities (`resolve`/`reconcile`/`query`).
 *  2. **invoke** — an MCP `CallTool('query', …)` round-trips to the live datalog surface
 *     (`POST /api/graph/datalog`), degrading to a 503-equivalent MCP tool error when the
 *     sidecar is down (rather than a fixture or a crash).
 *  3. **verify** — the served manifest verifies against its published `signing.key_id`
 *     (US-3 `verifyManifestSignature`), so provenance is cryptographically attributable.
 *
 * Registration stays best-effort (KCB §3, ADR-0001): with the registry unreachable the
 * MCP surface, the A2A card, and the signed manifest are all still served directly, and
 * `publishCapabilityManifest` posts an absolutized, signed document a crawler can dial.
 */

import { registerMcpRoutes, MCP_ROUTE_PATH } from "./mcp";
import { registerA2aRoutes, AGENT_CARD_ROUTE_PATH } from "./a2a";
import {
  registerCapabilityBusRoutes,
  MANIFEST_WELL_KNOWN_PATH,
  type CapabilityBusRouteOptions,
} from "./capability-bus";
import { generateSigningKeyPair, verifyManifestSignature } from "../services/manifest-signing";
import { publishCapabilityManifest } from "../services/capability-registry";
import type { CapabilityManifest } from "@shared/capability-manifest";
import type { PublishResult } from "../services/capability-registry";

/** The origin the provider absolutizes its dialable addresses against. */
const ORIGIN = "https://pinakes.example";

/** A signing keypair provisioned once for the whole file (US-3 env-configured signer). */
const SIGNING = generateSigningKeyPair();

/** Env we mutate so the provider is deterministically signed + the sidecar reads "down". */
const ENV_KEYS = [
  "PINAKES_SIGNING_PRIVATE_KEY",
  "PINAKES_SIGNING_KEY_ID",
  "PINAKES_PUBLIC_ORIGIN",
  "KCB_REGISTRY_URL",
  "CULTURESCRAPE_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

/** Stand up the whole live provider (MCP + A2A + capability bus) on one Express app. */
async function startProvider(bus: CapabilityBusRouteOptions = {}) {
  const app: Express = express();
  app.use(express.json());
  // The live provider — real MCP handlers (no injected fakes): this is US-5's whole point.
  registerMcpRoutes(app);
  registerA2aRoutes(app, { origin: ORIGIN });
  registerCapabilityBusRoutes(app, { origin: ORIGIN, skipRegistration: true, ...bus });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Connect an official MCP client to the provider's `/mcp` surface. */
async function connectMcp(baseUrl: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}${MCP_ROUTE_PATH}`));
  const client = new Client({ name: "pinakes-dial-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

/** Decode a tool result's first text-content block as JSON. */
function decode(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === "text")?.text ?? "null";
  return JSON.parse(text);
}

describe("dial Pinakes as the real authority (describe → invoke → verify)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Configure the env-based signer (US-3) so the served/published manifest is signed…
    process.env.PINAKES_SIGNING_PRIVATE_KEY = SIGNING.privateKeyPem;
    // …and pin the sidecar "down" so the live `query` tool degrades deterministically to a
    // 503-equivalent MCP error (no localhost:8800 dependency in CI).
    process.env.CULTURESCRAPE_ENABLED = "false";
    const started = await startProvider();
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterAll(async () => {
    await close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("describe: the A2A card and MCP list_tools both recover the three KCB §6 capabilities", async () => {
    // A2A describe front.
    const card = (await fetch(`${baseUrl}${AGENT_CARD_ROUTE_PATH}`).then((r) => r.json())) as {
      name: string;
      skills: Array<{ id: string }>;
    };
    expect(card.name).toBe("pinakes:agent:resolver");
    expect(card.skills.map((s) => s.id).sort()).toEqual(["query", "reconcile", "resolve"]);

    // MCP describe front — same three capabilities, over the wire, from the live server.
    const client = await connectMcp(baseUrl);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["query", "reconcile", "resolve"]);
    } finally {
      await client.close();
    }
  });

  it("invoke: an MCP CallTool('query') round-trips to the live datalog surface, degrading to a 503-equivalent error when the sidecar is down", async () => {
    const client = await connectMcp(baseUrl);
    try {
      const result = await client.callTool({
        name: "query",
        arguments: { goal: "main :- true." },
      });
      // The live handler forwarded to POST /api/graph/datalog (culturescrape.datalog); with
      // the sidecar down it surfaces as an MCP tool error, never a crash or a fixture.
      expect(result.isError).toBe(true);
      const body = decode(result as never) as { error: string };
      expect(body.error).toMatch(/unavailable/i);
    } finally {
      await client.close();
    }
  });

  it("verify: the served manifest verifies against its published signing.key_id (KCB §5)", async () => {
    const manifest = (await fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`).then((r) =>
      r.json(),
    )) as CapabilityManifest;

    // Provenance is dialable: key_id populated, signature present, verifies with the pubkey.
    expect(manifest.signing.key_id).toBe(SIGNING.keyId);
    expect(typeof manifest.signing.signature).toBe("string");
    expect(verifyManifestSignature(manifest, SIGNING.publicKeyPem)).toBe(true);

    // A tampered manifest fails verification — a consumer can trust provenance before trusting the authority.
    const tampered: CapabilityManifest = { ...manifest, identity: "pinakes:agent:impostor" };
    expect(verifyManifestSignature(tampered, SIGNING.publicKeyPem)).toBe(false);
  });

  it("verify: the served manifest exposes non-null mcp/a2a endpoints a dialer can reach", async () => {
    const manifest = (await fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`).then((r) =>
      r.json(),
    )) as CapabilityManifest;
    expect(manifest.endpoints.mcp).toBe(`${ORIGIN}/mcp`);
    expect(manifest.endpoints.a2a).toBe(`${ORIGIN}/.well-known/agent-card.json`);
  });
});

describe("a registry crawler pulls a fully-populated, signed manifest (KCB §2/§3)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PINAKES_SIGNING_PRIVATE_KEY = SIGNING.privateKeyPem;
  });
  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("publishCapabilityManifest posts the absolutized, signed document — mcp/a2a/key_id all non-null", async () => {
    let posted: CapabilityManifest | null = null;
    const result = await publishCapabilityManifest({
      registryUrl: "https://registry.example",
      origin: ORIGIN,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        posted = JSON.parse(String(init.body)) as CapabilityManifest;
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    expect(result.registered).toBe(true);

    // The exact gap the purpose names is closed: every front + the signature are populated.
    expect(posted!.endpoints.mcp).toBe(`${ORIGIN}/mcp`);
    expect(posted!.endpoints.a2a).toBe(`${ORIGIN}/.well-known/agent-card.json`);
    expect(posted!.signing.key_id).toBe(SIGNING.keyId);
    expect(verifyManifestSignature(posted!, SIGNING.publicKeyPem)).toBe(true);
  });
});

describe("registration stays best-effort — the surfaces are served with the registry unreachable (KCB §3, ADR-0001)", () => {
  const UNREACHABLE: PublishResult = {
    registered: false,
    servingDirectly: true,
    registryUrl: "https://registry.example",
    detail: "Registry unreachable (fetch failed) — capabilities remain invocable directly.",
  };

  const saved: Record<string, string | undefined> = {};
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PINAKES_SIGNING_PRIVATE_KEY = SIGNING.privateKeyPem;
    process.env.CULTURESCRAPE_ENABLED = "false";
    // The registry push resolves to "unreachable" — it must NOT gate serving any surface.
    const started = await startProvider({ publish: async () => UNREACHABLE, skipRegistration: false });
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterAll(async () => {
    await close();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("still serves the MCP surface, the A2A card, and the signed manifest, and reports servingDirectly", async () => {
    // A2A card + MCP tools are still describable.
    const card = (await fetch(`${baseUrl}${AGENT_CARD_ROUTE_PATH}`).then((r) => r.json())) as {
      skills: Array<{ id: string }>;
    };
    expect(card.skills.map((s) => s.id).sort()).toEqual(["query", "reconcile", "resolve"]);

    const client = await connectMcp(baseUrl);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(3);
    } finally {
      await client.close();
    }

    // The signed manifest is still served and still verifies.
    const manifest = (await fetch(`${baseUrl}${MANIFEST_WELL_KNOWN_PATH}`).then((r) =>
      r.json(),
    )) as CapabilityManifest;
    expect(verifyManifestSignature(manifest, SIGNING.publicKeyPem)).toBe(true);

    // …and status reports the capabilities are up regardless of the registry outcome.
    const status = (await fetch(`${baseUrl}/api/kcb/status`).then((r) => r.json())) as {
      signed: boolean;
      registry: PublishResult;
    };
    expect(status.registry.registered).toBe(false);
    expect(status.registry.servingDirectly).toBe(true);
    expect(status.signed).toBe(true);
  });
});
