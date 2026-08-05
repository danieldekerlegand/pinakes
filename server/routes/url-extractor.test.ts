import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of `POST /api/extract/url` on this backend (pinakes:64 US-1).
 *
 * The URL parsing, the Wikidata resolution and the queue write are served by the
 * Python service now, and their behavioural coverage moved with them:
 * `services/api/tests/test_ingest_routes.py` (the route) and
 * `services/api/tests/test_url_extractor.py` (drafting, graded against the *same*
 * recorded fixtures this suite used). What this file asserts is the hand-off.
 *
 * `server/services/url-extractor.ts` is still unit-tested next door: it is the
 * specification the port was read off.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerUrlExtractorRoutes,
} from "./url-extractor";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "url-extractor-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerUrlExtractorRoutes(app);
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
  const res = await fetch(`${baseUrl}/api/extract/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/extract/url — ported to the Python service", () => {
  it("answers 501 naming its replacement", async () => {
    const { status, body } = await post({ url: "https://www.wikidata.org/wiki/Q2277" });
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe("POST /api/extract/url");
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 for an unusable URL too — the refusal is not this backend's any more", async () => {
    // The 400 for a bad URL is part of the *ported* contract; reproducing it
    // here would be two backends disagreeing about who owns the route.
    expect((await post({ url: "https://example.org/thing" })).status).toBe(501);
    expect((await post({})).status).toBe(501);
  });

  it("keeps the path registered", () => {
    // Deleting the registration would rewrite the parity baseline the port is
    // graded against.
    expect(PORTED_ROUTES.post).toEqual(["/api/extract/url"]);
  });

  it("queues nothing on this side any more", async () => {
    await post({ url: "https://www.wikidata.org/wiki/Q2277" });
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(contributions.list().contributions).toEqual([]);
  });
});
