import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of `POST /api/extract/text` on this backend (pinakes:64 US-1).
 *
 * The extraction, the drafting and the queue write are served by the Python
 * service now, and their behavioural coverage moved with them:
 * `services/api/tests/test_ingest_routes.py` (the route) and
 * `services/api/tests/test_text_extractor.py` (normalisation, graded against the
 * *same* recorded fixture this suite used). What this file asserts is the
 * hand-off — the path is still registered, it answers 501 naming its
 * replacement, and nothing on this side queues a contribution any more.
 *
 * `server/services/text-extractor.ts` is still unit-tested next door: it is the
 * specification the port was read off.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerTextExtractorRoutes,
} from "./text-extractor";
import { ContributionService } from "../services/contribution-service";

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
  registerTextExtractorRoutes(app);
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

describe("POST /api/extract/text — ported to the Python service", () => {
  it("answers 501 naming its replacement", async () => {
    const { status, body } = await post({ text: "The Roman Empire spoke Latin." });
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe("POST /api/extract/text");
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps the path registered", () => {
    // Deleting the registration would rewrite the parity baseline the port is
    // graded against — `contracts/parity/openapi.json` is harvested from the
    // Express routing table.
    expect(PORTED_ROUTES.post).toEqual(["/api/extract/text"]);
  });

  it("queues nothing on this side any more", async () => {
    await post({ text: "The Roman Empire spoke Latin." });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(contributions.list().contributions).toEqual([]);
  });

  it("never returns key material, not even in the refusal", async () => {
    const { body } = await post({ text: "anything" });
    expect(JSON.stringify(body)).not.toMatch(/GEMINI_API_KEY|VITE_GEMINI/i);
  });
});
