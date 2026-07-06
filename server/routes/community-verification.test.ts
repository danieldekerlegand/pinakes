import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for community verification & culture stewardship (US-012).
 * The contribution queue + stewardship store point at temp dirs, and a fixed
 * verification config drives the multi-confirmation threshold deterministically.
 */

import { registerCommunityVerificationRoutes } from "./community-verification";
import { ContributionService, type Contribution } from "../services/contribution-service";
import { StewardshipStore } from "../services/stewardship";

let app: Express;
let server: Server;
let baseUrl: string;
let queueDir: string;
let stewardDir: string;
let contributions: ContributionService;
let stewards: StewardshipStore;

const CONFIG = { threshold: 3, stewardThreshold: 1 };

function seed(overrides: Partial<Contribution> = {}): Contribution {
  const { contribution } = contributions.submit({
    entityType: "civilization",
    action: "add",
    sources: [{ title: "A book" }],
    confidence: 50,
    entityData: { name: "Maya" },
    ...overrides,
  });
  return contribution!;
}

beforeEach(async () => {
  queueDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-queue-"));
  stewardDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-steward-"));
  contributions = new ContributionService(queueDir);
  stewards = new StewardshipStore(stewardDir);
  app = express();
  app.use(express.json());
  registerCommunityVerificationRoutes(app, {
    contributions,
    stewards,
    config: CONFIG,
    now: () => "2026-07-06T00:00:00.000Z",
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(queueDir, { recursive: true, force: true });
  fs.rmSync(stewardDir, { recursive: true, force: true });
});

type Res = { status: number; body: any };
async function req(method: string, url: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/contributions/:id/confirm — multi-confirmation", () => {
  it("requires a reviewer", async () => {
    const c = seed();
    const res = await req("POST", `/api/contributions/${c.id}/confirm`, {});
    expect(res.status).toBe(400);
  });

  it("404 for an unknown contribution", async () => {
    const res = await req("POST", `/api/contributions/nope/confirm`, { reviewer: "a" });
    expect(res.status).toBe(404);
  });

  it("raises confidence and verifies once N distinct reviewers confirm", async () => {
    const c = seed({ confidence: 50 });

    const r1 = await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "alice" });
    expect(r1.status).toBe(200);
    expect(r1.body.verification.verified).toBe(false);
    expect(r1.body.verification.confidence).toBeGreaterThan(50);
    expect(r1.body.contribution.status).toBe("pending");

    await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "bob" });
    const r3 = await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "carol" });

    expect(r3.body.verification.verified).toBe(true);
    expect(r3.body.verification.distinctReviewers).toBe(3);
    expect(r3.body.contribution.status).toBe("approved");
    expect(r3.body.contribution.verified).toBe(true);
    expect(r3.body.contribution.verifiedAt).toBe("2026-07-06T00:00:00.000Z");
  });

  it("dedups a repeated reviewer (409) and does not advance the count", async () => {
    const c = seed();
    await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "alice" });
    const dup = await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "Alice" });
    expect(dup.status).toBe(409);
    expect(dup.body.verification.distinctReviewers).toBe(1);
  });

  it("rejects self-confirmation (400)", async () => {
    const c = seed({ contributorName: "Dana" });
    const res = await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "dana" });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("self");
  });

  it("a domain steward single-handedly verifies and is attributed with provenance", async () => {
    // A civilization named "Maya" → domain "maya"; steward adopts it.
    stewards.adopt({ steward: "Expert", domain: "maya", now: "2026-07-06T00:00:00.000Z" });
    const c = seed({ entityData: { name: "Maya" } });

    const res = await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "Expert" });
    expect(res.status).toBe(200);
    expect(res.body.confirmedAsSteward).toBe(true);
    expect(res.body.domain).toBe("maya");
    expect(res.body.verification.verified).toBe(true);
    expect(res.body.contribution.status).toBe("approved");
    expect(res.body.contribution.stewardAttribution).toEqual([{ steward: "Expert", domain: "maya" }]);
  });
});

describe("GET /api/contributions/:id/verification", () => {
  it("returns the verification state + domain", async () => {
    const c = seed();
    await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "alice" });
    const res = await req("GET", `/api/contributions/${c.id}/verification`);
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("maya");
    expect(res.body.config).toEqual(CONFIG);
    expect(res.body.verification.distinctReviewers).toBe(1);
  });

  it("404 for an unknown contribution", async () => {
    const res = await req("GET", `/api/contributions/nope/verification`);
    expect(res.status).toBe(404);
  });
});

describe("stewardship (adopt a culture)", () => {
  it("adopts, lists (by domain), and releases", async () => {
    const adopt = await req("POST", "/api/stewardship/adopt", {
      steward: "Alice",
      domain: "Roman Empire",
    });
    expect(adopt.status).toBe(201);
    expect(adopt.body.adoption.domain).toBe("roman-empire");

    const list = await req("GET", "/api/stewardship?domain=roman-empire");
    expect(list.body.total).toBe(1);

    const dup = await req("POST", "/api/stewardship/adopt", { steward: "Alice", domain: "roman-empire" });
    expect(dup.status).toBe(200);
    expect(dup.body.alreadyOwned).toBe(true);

    const rel = await req("POST", "/api/stewardship/release", { steward: "Alice", domain: "roman-empire" });
    expect(rel.body.released).toBe(true);
    const after = await req("GET", "/api/stewardship");
    expect(after.body.total).toBe(0);
  });

  it("400 without steward + domain", async () => {
    const res = await req("POST", "/api/stewardship/adopt", { steward: "Alice" });
    expect(res.status).toBe(400);
  });
});
