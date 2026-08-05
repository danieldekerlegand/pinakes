import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the `/api/languages/*` preservation routes (US-010). Wired with
 * an injectable in-memory language loader + temp-dir ContributionService/ChangelogStore
 * (no live storage / lexicons), asserting HTTP status, the dashboard shape, and that a
 * field update both queues a contribution and lands a changelog entry.
 */

import { registerLanguagePreservationRoutes } from "./language-preservation";
import { ContributionService } from "../services/contribution-service";
import { ChangelogStore } from "../services/changelog";
import type { PreservationLanguage } from "../services/language-preservation";

const LANGS: PreservationLanguage[] = [
  { id: "en", name: "English", region: "Global", status: "living", totalSpeakers: 1_000 },
  { id: "cy", name: "Welsh", region: "Europe", status: "vulnerable", totalSpeakers: 100 },
  { id: "gd", name: "Scottish Gaelic", region: "Europe", status: "critically endangered", totalSpeakers: 10 },
  { id: "la", name: "Latin", region: "Europe", status: "extinct", totalSpeakers: 0 },
];

let app: Express;
let server: Server;
let baseUrl: string;
let tmpDir: string;
let contributions: ContributionService;
let changelog: ChangelogStore;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lang-preservation-"));
  contributions = new ContributionService(path.join(tmpDir, "contributions"));
  changelog = new ChangelogStore(path.join(tmpDir, "changelog"));

  app = express();
  app.use(express.json());
  registerLanguagePreservationRoutes(app, {
    loadLanguages: async () => LANGS,
    contributions,
    changelog,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/languages/preservation", () => {
  it("returns the preservation dashboard aggregation", async () => {
    const res = await fetch(`${baseUrl}/api/languages/preservation`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(4);
    expect(body.byCategory).toEqual({ living: 1, endangered: 2, extinct: 1, unknown: 0 });
    expect(body.endangermentRate).toBeCloseTo(2 / 3, 5);
    expect(body.speakersAtRisk).toBe(110);
    expect(body.watchlist[0].id).toBe("gd"); // most endangered still-spoken language first
  });

  it("honours the watchlistLimit query param", async () => {
    const res = await fetch(`${baseUrl}/api/languages/preservation?watchlistLimit=1`);
    const body = await res.json();
    expect(body.watchlist).toHaveLength(1);
  });
});

describe("POST /api/languages/field-update", () => {
  it("queues a language edit contribution and records a changelog entry", async () => {
    const res = await fetch(`${baseUrl}/api/languages/field-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        languageId: "cy",
        researcherName: "Dr. Jones",
        status: "endangered",
        totalSpeakers: 90,
        sources: [{ title: "2026 Welsh census field notes", url: "https://example.org/cy" }],
        confidence: 70,
        notes: "Speaker base declining in the north.",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    // Contribution landed in the review queue as an attributed language edit.
    expect(body.contribution.entityType).toBe("language");
    expect(body.contribution.action).toBe("edit");
    expect(body.contribution.entityId).toBe("cy");
    expect(body.contribution.status).toBe("pending");
    expect(body.contribution.contributorName).toBe("Dr. Jones");
    expect(body.changedFields).toEqual(["status", "totalSpeakers"]);
    expect(body.changelogEntryId).toBeTruthy();

    const queued = contributions.get(body.contribution.id);
    expect(queued?.entityData.source).toBe("field-research");

    // The status change is versioned in the shared changelog (AC3). Asserted
    // against the store rather than through `GET /api/changelog`, which was
    // ported to the Python service (pinakes:61 US-2) and answers 501 here — the
    // *write* is what this route owns, and it is the same store either reader
    // lists.
    const { entries } = changelog.list({ domain: "language" });
    const entry = entries.find((e) => e.contributionId === body.contribution.id);
    expect(entry).toBeTruthy();
    expect(entry.source).toBe("field-research");
    expect(entry.reviewer).toBe("Dr. Jones");
    expect(entry.fields).toContain("status");
  });

  it("400s on a missing researcher (attribution required)", async () => {
    const res = await fetch(`${baseUrl}/api/languages/field-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        languageId: "cy",
        status: "endangered",
        sources: [{ title: "x" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown language id", async () => {
    const res = await fetch(`${baseUrl}/api/languages/field-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        languageId: "nonexistent",
        researcherName: "Dr. Jones",
        status: "endangered",
        sources: [{ title: "x" }],
      }),
    });
    expect(res.status).toBe(404);
  });
});
