import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for `POST /api/extract/text` (US-008). The LLM is served from
 * a recorded fixture (no live model call) and the `ContributionService` points at
 * a temp dir so drafts land in an isolated review queue.
 */

import { registerTextExtractorRoutes } from "./text-extractor";
import { ContributionService } from "../services/contribution-service";
import type { RawTextExtraction, TextExtractorDeps } from "../services/text-extractor";

const FIXTURES = path.join(__dirname, "..", "services", "fixtures", "text-extractor");

function loadRaw(file: string): RawTextExtraction {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf-8")) as RawTextExtraction;
}

const fixtureDeps: TextExtractorDeps = {
  async extract() {
    return loadRaw("roman-empire-paragraph.json");
  },
};

/** Deps whose extract throws (non-TextExtractionError) to exercise the 502 path. */
const explodingDeps: TextExtractorDeps = {
  async extract() {
    throw new Error("boom (simulated model failure)");
  },
};

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "text-extractor-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerTextExtractorRoutes(app, { contributions, deps: fixtureDeps });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

type Res = { status: number; body: any };
async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/extract/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/extract/text", () => {
  it("extracts entities and queues one AI-flagged contribution each", async () => {
    const { status, body } = await post({ text: "The Roman Empire spoke Latin; Pompeii was buried." });
    expect(status).toBe(201);
    expect(body.result.entities).toHaveLength(3);
    expect(body.contributions).toHaveLength(3);
    for (const c of body.contributions) {
      expect(c.status).toBe("pending");
      expect(c.entityData.source).toBe("ai-extracted");
      expect(c.entityData.aiGenerated).toBe(true);
    }
    // Actually persisted to the temp-dir queue.
    const stored = contributions.get(body.contributions[0].id);
    expect(stored?.entityData.source).toBe("ai-extracted");
  });

  it("resolves entity types (site with coords → archaeological-site)", async () => {
    const { body } = await post({ text: "Rome and Pompeii." });
    const types = body.contributions.map((c: any) => c.entityType);
    expect(types).toEqual(["civilization", "language", "archaeological-site"]);
  });

  it("rejects empty/missing text with 400", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ text: "   " })).status).toBe(400);
  });
});

describe("POST /api/extract/text model failures", () => {
  let app2: Express;
  let server2: Server;
  let base2: string;

  beforeAll(async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "text-extractor-502-"));
    app2 = express();
    app2.use(express.json());
    registerTextExtractorRoutes(app2, {
      contributions: new ContributionService(dir2),
      deps: explodingDeps,
    });
    await new Promise<void>((resolve) => {
      server2 = app2.listen(0, "127.0.0.1", () => resolve());
    });
    base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it("maps a model failure to 502", async () => {
    const res = await fetch(`${base2}/api/extract/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "anything" }),
    });
    expect(res.status).toBe(502);
  });
});
