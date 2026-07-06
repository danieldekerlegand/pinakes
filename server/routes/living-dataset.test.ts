import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Integration tests for the living-dataset workflow (US-011, speculative). The
 * routes are wired to temp-dir stores, a fake culture-scrape runner (no Python /
 * network), and a fake DOI minter (no live Zenodo call). The clock is injected so
 * cadence + schedule assertions are deterministic.
 */

import { registerLivingDatasetRoutes } from "./living-dataset";
import { LivingDatasetStore } from "../services/living-dataset";
import { ContributionService } from "../services/contribution-service";
import { ChangelogStore } from "../services/changelog";
import type {
  AcquisitionCategory,
  CultureScrapeJobRunner,
  FetchOutcome,
} from "../services/culturescrape-acquisition";
import type { DoiMinter } from "../services/export-pipeline";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-06T00:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

/** A runner that returns two labelled records per category (both queueable). */
const fakeRunner: CultureScrapeJobRunner = {
  async runFetch(category: AcquisitionCategory): Promise<FetchOutcome> {
    const coord = category.requireCoordinates ? "Point(12.5 41.9)" : "";
    return {
      records: [
        {
          fields: { itemLabel: `${category.label} One`, qid: "Q1", coord },
          provenance: {
            source: "wikidata",
            source_url: "https://www.wikidata.org/wiki/Q1",
            source_query: "SELECT ...",
            retrieved_at: NOW.toISOString(),
            confidence: 0.8,
            license: "CC0",
          },
        },
        {
          fields: { itemLabel: `${category.label} Two`, qid: "Q2", coord },
          provenance: {
            source: "wikidata",
            source_url: "https://www.wikidata.org/wiki/Q2",
            source_query: "SELECT ...",
            retrieved_at: NOW.toISOString(),
            confidence: 0.8,
            license: "CC0",
          },
        },
      ],
      report: {
        category_id: category.id,
        adapter: "wikidata-sparql",
        row_count: 2,
        error_count: 0,
        distinct_sources: ["wikidata"],
      },
    };
  },
};

const fakeMinter: DoiMinter = {
  async mint(meta) {
    return {
      doi: `10.5281/zenodo.${meta.version}`,
      doiUrl: `https://doi.org/10.5281/zenodo.${meta.version}`,
    };
  },
};

let app: Express;
let server: Server;
let baseUrl: string;
let tmpRoot: string;
let store: LivingDatasetStore;
let contributions: ContributionService;
let changelog: ChangelogStore;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "living-dataset-route-"));
  store = new LivingDatasetStore(path.join(tmpRoot, "state"));
  contributions = new ContributionService(path.join(tmpRoot, "contributions"));
  changelog = new ChangelogStore(path.join(tmpRoot, "changelog"));
  // Seed changelog: 2 additions ⇒ a minor bump when releasing.
  changelog.record({ domain: "languages", changeType: "added", targetId: "a", summary: "add a", source: "test" });
  changelog.record({ domain: "languages", changeType: "added", targetId: "b", summary: "add b", source: "test" });

  // Pre-seed one fresh ingestion so status has a mix of due/not-due domains.
  store.recordIngestion("civilizations", daysAgo(1));

  app = express();
  app.use(express.json());
  registerLivingDatasetRoutes(app, {
    store,
    contributions,
    runner: fakeRunner,
    doiMinter: fakeMinter,
    changelog,
    now: () => NOW,
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/living-dataset/status", () => {
  it("returns freshness, an annual release cadence, and the ingestion schedule", async () => {
    const res = await fetch(`${baseUrl}/api/living-dataset/status`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Freshness (from data-freshness.ts over the live lexicons dir).
    expect(body.freshness.totalDatasets).toBeGreaterThan(0);

    // No release yet ⇒ seed version, cadence due immediately.
    expect(body.currentRelease.released).toBe(false);
    expect(body.currentRelease.version).toBe("1.0.0");
    expect(body.releaseCadence.cadence).toBe("annual");
    expect(body.releaseCadence.dueNow).toBe(true);

    // The pre-seeded fresh domain is not due; the never-ingested ones are.
    const civ = body.ingestion.entries.find((e: { domain: string }) => e.domain === "civilizations");
    expect(civ.dueNow).toBe(false);
    expect(body.ingestion.dueDomains).not.toContain("civilizations");
    expect(body.ingestion.dueDomains).toContain("sites");
    expect(body.ingestion.dueCount).toBe(body.ingestion.dueDomains.length);
  });
});

describe("POST /api/living-dataset/ingest", () => {
  it("runs a scheduled pass over the stale domains, queuing drafts for review", async () => {
    const res = await fetch(`${baseUrl}/api/living-dataset/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // civilizations is fresh ⇒ not run; the other three domains are stale.
    expect(body.requested).not.toContain("civilizations");
    expect(body.requested.length).toBeGreaterThan(0);
    expect(body.errors).toEqual([]);
    // Each stale domain queued its 2 records into the review queue.
    expect(body.totalQueued).toBe(body.ran.length * 2);
    expect(body.ran.every((r: { queued: number }) => r.queued === 2)).toBe(true);

    // Drafts landed as pending contributions (never a live write).
    const pending = contributions.list({ status: "pending", limit: 1000 });
    expect(pending.total).toBe(body.totalQueued);

    // Ingestion timestamps were recorded ⇒ those domains are no longer due.
    const statusRes = await fetch(`${baseUrl}/api/living-dataset/status`);
    const status = await statusRes.json();
    expect(status.ingestion.dueDomains).toEqual([]);
  });

  it("rejects an unknown requested domain with 400", async () => {
    const res = await fetch(`${baseUrl}/api/living-dataset/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domains: ["not-a-domain"] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/living-dataset/release", () => {
  it("mints a DOI'd snapshot, records it, and advances the cadence", async () => {
    const res = await fetch(`${baseUrl}/api/living-dataset/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasets: ["languages"] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    // 2 seeded additions ⇒ minor bump from the 1.0.0 seed version.
    expect(body.release.version).toBe("1.1.0");
    expect(body.release.doi).toBe("10.5281/zenodo.1.1.0");
    expect(body.release.totalRows).toBeGreaterThan(0);
    // The just-minted release resets the annual cadence.
    expect(body.cadence.dueNow).toBe(false);
    expect(body.cadence.daysUntilDue).toBe(365);

    // Now status reflects the recorded release.
    const statusRes = await fetch(`${baseUrl}/api/living-dataset/status`);
    const status = await statusRes.json();
    expect(status.currentRelease.released).toBe(true);
    expect(status.currentRelease.version).toBe("1.1.0");
    expect(status.currentRelease.doi).toBe("10.5281/zenodo.1.1.0");
    expect(status.releaseCadence.dueNow).toBe(false);
    expect(status.releaseHistory.length).toBe(1);
  });
});
