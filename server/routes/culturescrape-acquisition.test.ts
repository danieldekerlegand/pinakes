import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the culture-scrape acquisition routes (US-005). The job
 * runner is faked (recorded records — no Python subprocess, no network) and the
 * ContributionService points at a temp dir. An `onJobSettled` hook lets each
 * test await the background job deterministically.
 */

import { registerCultureScrapeAcquisitionRoutes } from "./culturescrape-acquisition";
import { ContributionService } from "../services/contribution-service";
import type {
  AcquisitionJobResult,
  CultureScrapeJobRunner,
  RawRecord,
} from "../services/culturescrape-acquisition";

function rawRecord(fields: Record<string, string>): RawRecord {
  return {
    fields,
    provenance: {
      source: "wikidata",
      source_url: fields.item ?? "",
      source_query: "SELECT ...",
      retrieved_at: "2026-07-05T00:00:00Z",
      confidence: 1,
      license: null,
    },
  };
}

/** Records keyed by the culture-scrape category id the runner is asked for. */
const RECORDS_BY_CATEGORY: Record<string, RawRecord[]> = {
  "wikidata-civilizations": [
    rawRecord({ item: "http://www.wikidata.org/entity/Q220", itemLabel: "Roman Empire", qid: "Q220" }),
    rawRecord({ itemLabel: "Q999", qid: "Q999" }), // no label → skipped
  ],
};

const fakeRunner: CultureScrapeJobRunner = {
  async runFetch(category) {
    const records = RECORDS_BY_CATEGORY[category.id] ?? [];
    return {
      records,
      report: {
        category_id: category.id,
        adapter: "wikidata-sparql",
        row_count: records.length,
        error_count: 0,
        distinct_sources: ["wikidata"],
      },
    };
  },
};

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

// Resolve a job's settlement by id (registered before the POST fires).
const settlements = new Map<string, (r: { result: AcquisitionJobResult | null; error?: Error }) => void>();
const pending = new Map<string, Promise<{ result: AcquisitionJobResult | null; error?: Error }>>();
function awaitJob(jobId: string) {
  let p = pending.get(jobId);
  if (!p) {
    p = new Promise((resolve) => settlements.set(jobId, resolve));
    pending.set(jobId, p);
  }
  return p;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-acq-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerCultureScrapeAcquisitionRoutes(app, {
    runner: fakeRunner,
    contributions,
    onJobSettled: (jobId, result, error) => {
      awaitJob(jobId); // ensure a deferred exists
      settlements.get(jobId)?.({ result, error });
    },
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

type Res = { status: number; body: any };
async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/scraping/culturescrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("GET /api/scraping/culturescrape/categories", () => {
  it("lists the four acquirable domains", async () => {
    const res = await fetch(`${baseUrl}/api/scraping/culturescrape/categories`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { categories: Array<{ domain: string }> };
    const domains = body.categories.map((c) => c.domain).sort();
    expect(domains).toEqual(["civilizations", "figures", "sites", "trade-goods"]);
  });
});

describe("POST /api/scraping/culturescrape", () => {
  it("starts a job and queues acquired records into the review queue", async () => {
    const { status, body } = await post({ domain: "civilizations", limit: 50 });
    expect(status).toBe(202);
    expect(body.domain).toBe("civilizations");
    expect(typeof body.jobId).toBe("string");

    const { result, error } = await awaitJob(body.jobId);
    expect(error).toBeUndefined();
    expect(result).not.toBeNull();
    expect(result!.acquired).toBe(2);
    expect(result!.queued).toBe(1); // one labeled, one label==QID skipped
    expect(result!.skipped).toBe(1);

    // The queued record is a pending, auto-derived civilization contribution.
    const stored = contributions.get(result!.contributionIds[0]);
    expect(stored?.status).toBe("pending");
    expect(stored?.entityType).toBe("civilization");
    expect(stored?.entityData.source).toBe("culturescrape-wikidata");
    expect(stored?.entityData.autoDerived).toBe(true);
  });

  it("rejects an unknown domain with 400", async () => {
    const { status, body } = await post({ domain: "not-a-domain" });
    expect(status).toBe(400);
    expect(body.validDomains).toContain("civilizations");
  });

  it("rejects a non-positive limit with 400", async () => {
    const { status } = await post({ domain: "sites", limit: -5 });
    expect(status).toBe(400);
  });
});
