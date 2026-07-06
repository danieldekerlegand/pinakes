import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for `/api/changelog` (US-010). The read routes are wired to a
 * `ChangelogStore` at a temp dir; the same store is shared with the contribution
 * and ai-review routes so their approved-edit writes are visible through the read
 * API — this exercises the "integrate with the contribution pipeline" AC.
 */

import { registerChangelogRoutes } from "./changelog";
import { registerContributionRoutes } from "./contributions";
import { registerAiReviewRoutes } from "./ai-review";
import { ChangelogStore } from "../services/changelog";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let changelogDir: string;
let contribDir: string;
let lexiconsDir: string;
let changelog: ChangelogStore;
let contributions: ContributionService;

beforeAll(async () => {
  changelogDir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-routes-"));
  contribDir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-contrib-"));
  lexiconsDir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-lexicons-"));
  changelog = new ChangelogStore(changelogDir);
  contributions = new ContributionService(contribDir);

  app = express();
  app.use(express.json());
  // Share ONE changelog store across the three route groups.
  registerChangelogRoutes(app, { changelog });
  registerContributionRoutes(app, {
    contributions,
    changelog,
    writeGuard: (_req, _res, next) => next(), // open for the test
  });
  registerAiReviewRoutes(app, { contributions, lexiconsDir, changelog });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const d of [changelogDir, contribDir, lexiconsDir]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

type Res = { status: number; body: any };

async function req(method: string, p: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("GET /api/changelog", () => {
  it("returns an empty log initially", async () => {
    const { status, body } = await req("GET", "/api/changelog");
    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.entries).toEqual([]);
    expect(body.changeTypes).toEqual(["added", "modified", "removed"]);
  });

  it("filters by domain, changeType, source, and date", async () => {
    changelog.record({ domain: "civilization", changeType: "added", source: "ai-review" }, { id: "s1", now: "2026-07-01T00:00:00.000Z" });
    changelog.record({ domain: "language", changeType: "modified", source: "contribution" }, { id: "s2", now: "2026-07-04T00:00:00.000Z" });

    const byDomain = await req("GET", "/api/changelog?domain=civilization");
    expect(byDomain.body.total).toBe(1);
    expect(byDomain.body.entries[0].id).toBe("s1");

    const byType = await req("GET", "/api/changelog?changeType=modified");
    expect(byType.body.total).toBe(1);
    expect(byType.body.entries[0].id).toBe("s2");

    const byDate = await req("GET", "/api/changelog?from=2026-07-03&to=2026-07-05");
    expect(byDate.body.total).toBe(1);
    expect(byDate.body.entries[0].id).toBe("s2");
  });

  it("exposes aggregate stats", async () => {
    const { status, body } = await req("GET", "/api/changelog/stats?source=contribution");
    expect(status).toBe(200);
    expect(body.byDomain.language).toBe(1);
    expect(body.byChangeType.modified).toBe(1);
  });
});

describe("contribution pipeline integration", () => {
  it("logs an approved contribution edit into the changelog", async () => {
    const submit = contributions.submit({
      entityType: "civilization",
      action: "add",
      entityData: { name: "Testtopia" },
      sources: [{ title: "A source", url: "https://example.org/s" }],
      confidence: 70,
    });
    expect(submit.contribution).toBeDefined();
    const id = submit.contribution!.id;

    const review = await req("PATCH", `/api/contributions/${id}/review`, {
      decision: "approved",
      note: "looks good",
    });
    expect(review.status).toBe(200);

    const log = await req("GET", "/api/changelog?source=contribution&domain=civilization");
    const logged = log.body.entries.find((e: any) => e.contributionId === id);
    expect(logged).toBeDefined();
    expect(logged.changeType).toBe("added");
    expect(logged.entityName).toBe("Testtopia");
    expect(logged.sourceUrl).toBe("https://example.org/s");
    expect(logged.confidence).toBe(70);
  });

  it("logs an approved AI-draft promotion into the changelog", async () => {
    const submit = contributions.submit({
      entityType: "civilization",
      action: "add",
      entityData: {
        name: "AItlantis",
        description: "an AI-drafted civ",
        aiGenerated: true,
        source: "text-extractor",
        perFieldConfidence: { name: 0.9, description: 0.8 },
      },
      sources: [{ title: "extracted" }],
      confidence: 60,
    });
    const id = submit.contribution!.id;

    const approve = await req("PATCH", `/api/ai-review/${id}`, {
      decision: "approved",
      reviewer: "curator",
    });
    expect(approve.status).toBe(200);
    expect(approve.body.promotion).toBeDefined();

    const log = await req("GET", `/api/changelog?domain=civilization`);
    const logged = log.body.entries.find((e: any) => e.contributionId === id);
    expect(logged).toBeDefined();
    expect(logged.source).toBe("ai-review");
    expect(logged.changeType).toBe("added");
    expect(logged.reviewer).toBe("curator");
    expect(logged.targetFile).toBe("civilizations.tsv");
    expect(logged.entityName).toBe("AItlantis");
    // The row really landed in the temp lexicon.
    expect(fs.existsSync(path.join(lexiconsDir, "civilizations.tsv"))).toBe(true);
  });
});
