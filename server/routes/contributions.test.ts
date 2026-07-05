import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the hardened contribution API (US-011): API-key auth +
 * per-key rate limiting on writes, open reads, and the published OpenAPI spec.
 * The route is wired to a `ContributionService` on a temp dir + a deterministic
 * clock so nothing touches the real queue and rate-limit windows are exact.
 */

import { registerContributionRoutes } from "./contributions";
import { ContributionService } from "../services/contribution-service";
import {
  createContributionWriteGuard,
  RateLimiter,
  type ApiAuthConfig,
} from "../services/api-auth";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;
let clock = 0;

const API_KEY = "test-key-123";

const CONFIG: ApiAuthConfig = {
  keys: [{ key: API_KEY, label: "test" }],
  rateLimit: { max: 3, windowMs: 60_000 },
};

const VALID_BODY = {
  entityType: "civilization",
  action: "add",
  entityData: { name: "Atlantis" },
  sources: [{ title: "Plato, Timaeus" }],
  confidence: 40,
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "contribution-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerContributionRoutes(app, {
    contributions,
    writeGuard: createContributionWriteGuard({
      config: CONFIG,
      limiter: new RateLimiter(CONFIG.rateLimit),
      now: () => clock,
    }),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

type Res = { status: number; body: any; headers: Headers };

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/contributions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function get(path: string): Promise<Res> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

describe("contribution write auth", () => {
  it("rejects an unauthenticated write with 401", async () => {
    const { status } = await post(VALID_BODY);
    expect(status).toBe(401);
  });

  it("rejects an unknown key with 403", async () => {
    const { status } = await post(VALID_BODY, { "x-api-key": "nope" });
    expect(status).toBe(403);
  });

  it("accepts a valid key (X-API-Key) and queues the contribution", async () => {
    clock += 60_000; // fresh rate-limit window
    const { status, body, headers } = await post(VALID_BODY, { "x-api-key": API_KEY });
    expect(status).toBe(201);
    expect(body.contribution.status).toBe("pending");
    expect(headers.get("x-ratelimit-limit")).toBe("3");
    expect(headers.get("x-ratelimit-remaining")).toBe("2");
    // Actually persisted through the service.
    expect(contributions.get(body.contribution.id)).not.toBeNull();
  });

  it("accepts a valid key via Authorization: Bearer", async () => {
    clock += 60_000;
    const { status } = await post(VALID_BODY, { authorization: `Bearer ${API_KEY}` });
    expect(status).toBe(201);
  });

  it("still validates the body after auth passes (400 on bad input)", async () => {
    clock += 60_000;
    const { status, body } = await post(
      { entityType: "civilization", action: "add", entityData: {}, sources: [] },
      { "x-api-key": API_KEY },
    );
    expect(status).toBe(400);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

describe("contribution write rate limiting", () => {
  it("returns 429 once the per-key quota is exhausted, with a Retry-After header", async () => {
    clock += 60_000; // fresh window (max: 3)
    for (let i = 0; i < 3; i++) {
      const { status } = await post(VALID_BODY, { "x-api-key": API_KEY });
      expect(status).toBe(201);
    }
    const blocked = await post(VALID_BODY, { "x-api-key": API_KEY });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");

    // New window → allowed again.
    clock += 60_000;
    const { status } = await post(VALID_BODY, { "x-api-key": API_KEY });
    expect(status).toBe(201);
  });
});

describe("open reads + review auth + openapi", () => {
  it("keeps GET /api/contributions open (no key required)", async () => {
    const { status, body } = await get("/api/contributions");
    expect(status).toBe(200);
    expect(Array.isArray(body.contributions)).toBe(true);
  });

  it("guards PATCH review with auth (401 unauthenticated)", async () => {
    const res = await fetch(`${baseUrl}/api/contributions/whatever/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(401);
  });

  it("publishes an OpenAPI spec documenting write security + read endpoints", async () => {
    const { status, body } = await get("/api/openapi.json");
    expect(status).toBe(200);
    expect(body.openapi).toBe("3.0.3");
    // Write endpoint is secured; read endpoint is open (security: []).
    expect(body.paths["/api/contributions"].post.security).toEqual([
      { ApiKeyAuth: [] },
      { BearerAuth: [] },
    ]);
    expect(body.paths["/api/contributions"].get.security).toEqual([]);
    expect(body.components.securitySchemes.ApiKeyAuth.name).toBe("X-API-Key");
  });
});

describe("auth disabled (no keys configured) is backward-compatible", () => {
  it("allows writes with no key when the config has no keys", async () => {
    const openDir = fs.mkdtempSync(path.join(os.tmpdir(), "contribution-open-"));
    const openApp = express();
    openApp.use(express.json());
    registerContributionRoutes(openApp, {
      contributions: new ContributionService(openDir),
      writeGuard: createContributionWriteGuard({
        config: { keys: [], rateLimit: { max: 100, windowMs: 60_000 } },
        now: () => 0,
      }),
    });
    const openServer = await new Promise<Server>((resolve) => {
      const s = openApp.listen(0, () => resolve(s));
    });
    const { port } = openServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/contributions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    await new Promise<void>((resolve) => openServer.close(() => resolve()));
    fs.rmSync(openDir, { recursive: true, force: true });
  });
});
