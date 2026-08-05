import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of the AI-review routes on this backend (pinakes:60 US-1).
 *
 * All three moved to the Python service, and their behavioural coverage — the
 * field-level projection, the accept/edit/reject decisions, and the promotion
 * into a lexicon TSV — moved with them to
 * `services/api/tests/test_ai_review_routes.py`.
 *
 * What is asserted here is that nothing on this side still writes. This was the
 * one review path that appended to the live corpus, and two implementations
 * each minting ids by de-duping against what they last read is exactly the race
 * worth not having.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerAiReviewRoutes,
} from "./ai-review";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let queueDir: string;
let lexiconsDir: string;
let contributions: ContributionService;

beforeAll(async () => {
  queueDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-queue-"));
  lexiconsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-lexicons-"));
  contributions = new ContributionService(queueDir);
  app = express();
  app.use(express.json());
  registerAiReviewRoutes(app, { contributions, lexiconsDir });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const d of [queueDir, lexiconsDir]) {
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

const RETIRED: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/api/ai-review"],
  ["GET", "/api/ai-review/contrib-1"],
  ["PATCH", "/api/ai-review/contrib-1"],
];

describe("routes ported to the Python service", () => {
  it.each(RETIRED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const { status, body } = await req(method, url, method === "GET" ? undefined : {});
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`${method} ${url.replace("contrib-1", ":id")}`);
  });

  it("keeps both paths registered", () => {
    // Deleting a registration would rewrite the parity baseline the port is
    // graded against — `contracts/parity/openapi.json` is harvested from the
    // Express routing table.
    expect([...PORTED_ROUTES.get]).toEqual(["/api/ai-review", "/api/ai-review/:id"]);
    expect([...PORTED_ROUTES.patch]).toEqual(["/api/ai-review/:id"]);
  });

  it("promotes nothing into the lexicons — the corpus write moved", async () => {
    const { contribution } = contributions.submit({
      entityType: "civilization",
      action: "add",
      sources: [{ title: "AI extraction" }],
      confidence: 70,
      entityData: {
        name: "AItlantis",
        description: "an AI-drafted civ",
        aiGenerated: true,
        source: "text-extractor",
        perFieldConfidence: { name: 0.9 },
      },
    });
    const id = contribution!.id;

    const { status } = await req("PATCH", `/api/ai-review/${id}`, {
      decision: "approved",
      reviewer: "curator",
    });

    expect(status).toBe(501);
    expect(fs.readdirSync(lexiconsDir)).toEqual([]);
    expect(contributions.get(id)!.status).toBe("pending");
  });
});
