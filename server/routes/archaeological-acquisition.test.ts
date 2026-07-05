import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the Open Context / tDAR acquisition routes (US-007). The
 * network is faked with recorded fixtures (no live fetch) and the
 * ContributionService points at a temp dir. An `onJobSettled` hook lets each
 * test await the background job deterministically.
 */

import { registerArchaeologyAcquisitionRoutes } from "./archaeological-acquisition";
import { ContributionService } from "../services/contribution-service";
import type {
  ArchaeologyAcquisitionResult,
  ArchaeologyDeps,
  OpenContextResponse,
  TdarResponse,
} from "../services/archaeological-site-scraper";

const FIXTURE_DIR = path.join(__dirname, "..", "services", "fixtures", "archaeological");
function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf-8")) as T;
}

const fakeDeps: ArchaeologyDeps = {
  async fetchOpenContext() {
    return loadFixture<OpenContextResponse>("open-context-search");
  },
  async fetchTdar() {
    return loadFixture<TdarResponse>("tdar-search");
  },
};

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

const settlements = new Map<
  string,
  (r: { result: ArchaeologyAcquisitionResult | null; error?: Error }) => void
>();
const pending = new Map<
  string,
  Promise<{ result: ArchaeologyAcquisitionResult | null; error?: Error }>
>();
function awaitJob(jobId: string) {
  let p = pending.get(jobId);
  if (!p) {
    p = new Promise((resolve) => settlements.set(jobId, resolve));
    pending.set(jobId, p);
  }
  return p;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-acq-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerArchaeologyAcquisitionRoutes(app, {
    deps: fakeDeps,
    contributions,
    onJobSettled: (jobId, result, error) => {
      awaitJob(jobId);
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
  const res = await fetch(`${baseUrl}/api/scraping/archaeology`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("GET /api/scraping/archaeology/sources", () => {
  it("lists the two archaeological sources", async () => {
    const res = await fetch(`${baseUrl}/api/scraping/archaeology/sources`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sources: Array<{ id: string }> };
    expect(body.sources.map((s) => s.id).sort()).toEqual(["open-context", "tdar"]);
  });
});

describe("POST /api/scraping/archaeology", () => {
  it("starts a job and queues acquired sites into the review queue", async () => {
    const { status, body } = await post({ source: "tdar", limit: 50 });
    expect(status).toBe(202);
    expect(body.source).toBe("tdar");
    expect(typeof body.jobId).toBe("string");

    const { result, error } = await awaitJob(body.jobId);
    expect(error).toBeUndefined();
    expect(result).not.toBeNull();
    expect(result!.acquired).toBe(2);
    expect(result!.queued).toBe(2);

    const stored = contributions.get(result!.contributionIds[0]);
    expect(stored?.status).toBe("pending");
    expect(stored?.entityType).toBe("archaeological-site");
    expect(stored?.entityData.source).toBe("tdar");
    expect(stored?.entityData.autoDerived).toBe(true);
  });

  it("rejects an unknown source with 400", async () => {
    const { status, body } = await post({ source: "not-a-source" });
    expect(status).toBe(400);
    expect(body.validSources).toContain("open-context");
  });

  it("rejects a non-positive limit with 400", async () => {
    const { status } = await post({ source: "open-context", limit: -5 });
    expect(status).toBe(400);
  });
});
