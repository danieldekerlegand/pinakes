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
 *
 * Two thirds of this file's surface is still served here; the `/api/stewardship*`
 * third was ported to Python (pinakes:61 US-2) and is asserted as a hand-off at
 * the bottom.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerCommunityVerificationRoutes,
} from "./community-verification";
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
    server = app.listen(0, "127.0.0.1", () => resolve());
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

/**
 * Adopting, listing and releasing moved to the Python service (pinakes:61 US-2)
 * and their behavioural coverage went with them to
 * `services/api/tests/test_stewardship_routes.py`. What is left here is the
 * hand-off — and, more importantly, the reason the *other* half of this file
 * could stay behind: both servers read one `stewards.json`, so the confirm
 * handler above still sees a claim regardless of which server recorded it.
 */
describe("stewardship routes ported to the Python service", () => {
  const RETIRED: ReadonlyArray<readonly [string, string]> = [
    ["GET", "/api/stewardship?domain=roman-empire"],
    ["POST", "/api/stewardship/adopt"],
    ["POST", "/api/stewardship/release"],
  ];

  it.each(RETIRED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const res = await req(method, url, method === "GET" ? undefined : {
      steward: "Alice",
      domain: "Roman Empire",
    });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe(PORTED_ERROR);
    expect(res.body.servedBy).toBe(PORTED_TO);
    expect(res.body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps every retired path registered, and only those three", () => {
    // Deleting a registration would rewrite the parity baseline the port is
    // graded against. Confirm and verification are deliberately absent — they
    // are a different port unit and are still served above.
    const registered = [...PORTED_ROUTES.get, ...PORTED_ROUTES.post];
    expect(registered).toEqual([
      "/api/stewardship",
      "/api/stewardship/adopt",
      "/api/stewardship/release",
    ]);
  });

  it("never writes to the stewardship store on a retired write", async () => {
    await req("POST", "/api/stewardship/adopt", { steward: "Alice", domain: "maya" });
    expect(stewards.list()).toEqual([]);
    expect(fs.readdirSync(stewardDir)).toEqual([]);
  });

  it("still reads a claim the ported routes recorded, for the confirm flow", async () => {
    // Written the way the Python store writes it: one `stewards.json` array,
    // under the same directory. That shared file is what lets the confirm
    // handler stay here while adoption moved.
    fs.writeFileSync(
      path.join(stewardDir, "stewards.json"),
      JSON.stringify([
        { steward: "Expert", domain: "maya", adoptedAt: "2026-07-06T00:00:00.000Z" },
      ]),
      "utf-8",
    );
    const c = seed({ entityData: { name: "Maya" } });
    const res = await req("POST", `/api/contributions/${c.id}/confirm`, { reviewer: "Expert" });
    expect(res.body.confirmedAsSteward).toBe(true);
    expect(res.body.verification.verified).toBe(true);
  });
});
