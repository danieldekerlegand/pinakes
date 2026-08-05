import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of the contribution routes on this backend (pinakes:60 US-1).
 *
 * The queue itself — submitting, listing, reviewing, the CSV export — is served
 * by the Python service now, and its behavioural coverage moved with it to
 * `services/api/tests/test_contribution_routes.py`. What this file asserts is
 * the hand-off: the retired paths are still *registered* (the parity baseline
 * was harvested from that set) and answer 501 naming their replacement, and the
 * two routes that did **not** move still answer for real.
 *
 * `GET /api/contributions/stats` is the load-bearing one: its recorded fixture
 * is replayed against this app by `contracts/parity/parity.test.ts`, so a
 * baseline that stopped serving it would stop being a baseline.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerContributionRoutes,
} from "./contributions";
import { ContributionService } from "../services/contribution-service";

let app: Express;
let server: Server;
let baseUrl: string;
let dir: string;
let contributions: ContributionService;

const VALID_BODY = {
  entityType: "civilization",
  action: "add",
  entityData: { name: "Atlantis" },
  sources: [{ title: "Plato, Timaeus" }],
  confidence: 40,
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "contribution-routes-"));
  contributions = new ContributionService(dir);
  app = express();
  app.use(express.json());
  registerContributionRoutes(app, { contributions });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
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

/** Concrete URLs for the retired templates, by the method that was retired. */
const RETIRED: ReadonlyArray<readonly [string, string]> = [
  ["POST", "/api/contributions"],
  ["GET", "/api/contributions"],
  ["GET", "/api/contributions/export"],
  ["GET", "/api/contributions/entity/civilization/minoan"],
  ["GET", "/api/contributions/contrib-1"],
  ["PATCH", "/api/contributions/contrib-1/review"],
];

describe("routes ported to the Python service", () => {
  it.each(RETIRED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const { status, body } = await req(method, url, method === "GET" ? undefined : {});
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps every retired path registered", () => {
    // Deleting a registration would rewrite the parity baseline the port is
    // graded against — `contracts/parity/openapi.json` is harvested from the
    // Express routing table.
    const registered = [
      ...PORTED_ROUTES.post,
      ...PORTED_ROUTES.get,
      ...PORTED_ROUTES.getAfterStats,
      ...PORTED_ROUTES.patch,
    ];
    expect(registered).toContain("/api/contributions/:id/review");
    expect(registered).toContain("/api/contributions/entity/:entityType/:entityId");
    expect(registered).not.toContain("/api/contributions/stats");
  });

  it("never writes to the queue on a retired write", async () => {
    await req("POST", "/api/contributions", VALID_BODY);
    expect(contributions.stats().total).toBe(0);
  });
});

describe("routes still served here", () => {
  it("answers GET /api/contributions/stats for real", async () => {
    // The queue is written through the service directly — the POST route is
    // retired, and this read is what the recorded fixture replays against.
    contributions.submit(VALID_BODY as never);
    const { status, body } = await req("GET", "/api/contributions/stats");
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.pending).toBe(1);
    expect(body.byEntityType.civilization).toBe(1);
    expect(body.byAction.add).toBe(1);
  });

  it("does not read `stats` as a contribution id", async () => {
    // `/:id` is registered after it, exactly as the real handler was.
    const { status } = await req("GET", "/api/contributions/stats");
    expect(status).toBe(200);
  });

  it("publishes an OpenAPI spec documenting write security + read endpoints", async () => {
    // Its own port unit: the spec describes the whole Express surface, most of
    // which is still Express's, so it cannot move until that surface does.
    const { status, body } = await req("GET", "/api/openapi.json");
    expect(status).toBe(200);
    expect(body.openapi).toBe("3.0.3");
    expect(body.paths["/api/contributions"].post.security).toEqual([
      { ApiKeyAuth: [] },
      { BearerAuth: [] },
    ]);
    expect(body.paths["/api/contributions"].get.security).toEqual([]);
    expect(body.components.securitySchemes.ApiKeyAuth.name).toBe("X-API-Key");
  });
});
