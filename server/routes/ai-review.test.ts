import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the AI-extraction review queue (US-009). The queue and
 * the lexicons target both point at temp dirs, so approving a draft promotes it
 * into an isolated `civilizations.tsv` (never the live corpus).
 */

import { registerAiReviewRoutes } from "./ai-review";
import { ContributionService, type Contribution } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let queueDir: string;
let lexiconsDir: string;
let contributions: ContributionService;

function seedDraft(overrides: Partial<Contribution> = {}): Contribution {
  const { contribution } = contributions.submit({
    entityType: "civilization",
    action: "add",
    sources: [{ title: "AI extraction" }],
    confidence: 70,
    entityData: {
      name: "Roman Empire",
      description: "An ancient empire",
      timePeriodStart: -27,
      source: "ai-extracted",
      aiGenerated: true,
      autoDerived: true,
      relationships: [],
      perFieldConfidence: { name: 0.95, description: 0.3, timePeriodStart: 0.8 },
    },
    ...overrides,
  });
  return contribution!;
}

beforeEach(async () => {
  queueDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-queue-"));
  lexiconsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-lex-"));
  contributions = new ContributionService(queueDir);
  app = express();
  app.use(express.json());
  registerAiReviewRoutes(app, { contributions, lexiconsDir });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(queueDir, { recursive: true, force: true });
  fs.rmSync(lexiconsDir, { recursive: true, force: true });
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

describe("GET /api/ai-review", () => {
  it("lists AI drafts as field-level review views with low-confidence flags", async () => {
    seedDraft();
    // A non-AI human contribution must NOT appear.
    contributions.submit({
      entityType: "civilization",
      action: "add",
      sources: [{ title: "book" }],
      entityData: { name: "Sparta" },
    });

    const { status, body } = await req("GET", "/api/ai-review");
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    const draft = body.drafts[0];
    expect(draft.aiGenerated).toBe(true);
    expect(draft.promotable).toBe(true);
    const desc = draft.fields.find((f: any) => f.field === "description");
    expect(desc.lowConfidence).toBe(true);
  });
});

describe("PATCH /api/ai-review/:id — approve + promote", () => {
  it("promotes an approved draft into data/source/lexicons/*.tsv with reviewer + AI-source provenance", async () => {
    const draft = seedDraft();
    const { status, body } = await req("PATCH", `/api/ai-review/${draft.id}`, {
      decision: "approved",
      reviewer: "alice",
      fields: { description: { decision: "edit", value: "The Roman Empire" } },
    });

    expect(status).toBe(200);
    expect(body.status).toBe("approved");
    expect(body.reviewer).toBe("alice");
    expect(body.promotion.file).toBe("civilizations.tsv");
    expect(body.promotion.targetId).toBe("roman-empire");

    // Persisted transition on the contribution.
    const stored = contributions.get(draft.id)!;
    expect(stored.status).toBe("approved");
    expect(stored.reviewer).toBe("alice");
    expect(stored.fieldReviews?.description).toEqual({ decision: "edit", value: "The Roman Empire" });
    expect(stored.promotion?.targetId).toBe("roman-empire");

    // Actually written to the target TSV with the edited value.
    const civ = fs.readFileSync(path.join(lexiconsDir, "civilizations.tsv"), "utf-8");
    expect(civ).toContain("Roman Empire");
    expect(civ).toContain("The Roman Empire");
    // Provenance ledger records both AI source and reviewer.
    const ledger = fs.readFileSync(path.join(lexiconsDir, "contribution-provenance.tsv"), "utf-8");
    expect(ledger).toContain("ai-extracted");
    expect(ledger).toContain("alice");
  });

  it("rejects the whole approval when a required field is rejected (400)", async () => {
    const draft = seedDraft();
    const { status, body } = await req("PATCH", `/api/ai-review/${draft.id}`, {
      decision: "approved",
      reviewer: "alice",
      fields: { name: { decision: "reject" } },
    });
    expect(status).toBe(400);
    expect(body.errors[0]).toMatch(/name/);
    // Nothing was promoted; the draft stays pending.
    expect(contributions.get(draft.id)!.status).toBe("pending");
    expect(fs.existsSync(path.join(lexiconsDir, "civilizations.tsv"))).toBe(false);
  });

  it("returns 400 when approving a non-promotable entity type", async () => {
    const draft = seedDraft({
      entityType: "historical-figure",
      entityData: {
        name: "Julius Caesar",
        source: "ai-extracted",
        aiGenerated: true,
        perFieldConfidence: { name: 0.9 },
      },
    });
    const { status } = await req("PATCH", `/api/ai-review/${draft.id}`, {
      decision: "approved",
      reviewer: "alice",
    });
    expect(status).toBe(400);
    expect(contributions.get(draft.id)!.status).toBe("pending");
  });
});

describe("PATCH /api/ai-review/:id — reject", () => {
  it("records a rejection without writing TSV", async () => {
    const draft = seedDraft();
    const { status, body } = await req("PATCH", `/api/ai-review/${draft.id}`, {
      decision: "rejected",
      reviewer: "bob",
      note: "duplicate",
    });
    expect(status).toBe(200);
    expect(body.status).toBe("rejected");
    const stored = contributions.get(draft.id)!;
    expect(stored.status).toBe("rejected");
    expect(stored.reviewer).toBe("bob");
    expect(stored.reviewNote).toBe("duplicate");
    expect(fs.existsSync(path.join(lexiconsDir, "civilizations.tsv"))).toBe(false);
  });
});

describe("PATCH /api/ai-review/:id — validation", () => {
  it("400 on a missing/invalid decision", async () => {
    const draft = seedDraft();
    expect((await req("PATCH", `/api/ai-review/${draft.id}`, { reviewer: "a" })).status).toBe(400);
    expect(
      (await req("PATCH", `/api/ai-review/${draft.id}`, { decision: "maybe", reviewer: "a" })).status,
    ).toBe(400);
  });

  it("400 on a missing reviewer", async () => {
    const draft = seedDraft();
    expect((await req("PATCH", `/api/ai-review/${draft.id}`, { decision: "approved" })).status).toBe(
      400,
    );
  });

  it("404 for an unknown / non-AI draft", async () => {
    expect((await req("PATCH", "/api/ai-review/nope", { decision: "rejected", reviewer: "a" })).status).toBe(
      404,
    );
    const human = contributions.submit({
      entityType: "civilization",
      action: "add",
      sources: [{ title: "book" }],
      entityData: { name: "Sparta" },
    }).contribution!;
    expect(
      (await req("PATCH", `/api/ai-review/${human.id}`, { decision: "rejected", reviewer: "a" })).status,
    ).toBe(404);
  });
});
