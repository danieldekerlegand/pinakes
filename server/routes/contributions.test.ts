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
 * one route that did **not** move still answers for real.
 *
 * `GET /api/contributions/stats` is the load-bearing one: its recorded fixture
 * is replayed against this app by `contracts/parity/parity.test.ts`, so a
 * baseline that stopped serving it would stop being a baseline.
 *
 * `GET /api/openapi.json` was retired in pinakes:80 US-1 — the last route of the
 * cutover. `buildOpenApiSpec` is still exercised below, because the *document*
 * is not retired: it is the graded spec for `pinakes.openapi_spec`.
 */

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  PORTED_TO_OPENAPI,
  registerContributionRoutes,
} from "./contributions";
import { ContributionService } from "../services/contribution-service";
import { buildOpenApiSpec } from "../services/openapi-spec";

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
  ["GET", "/api/openapi.json"],
];

describe("routes ported to the Python service", () => {
  it.each(RETIRED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const { status, body } = await req(method, url, method === "GET" ? undefined : {});
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    // Two replacements: the queue's own module, and — for the last route of
    // the whole cutover — the one that publishes the spec document.
    expect(body.servedBy).toBe(
      url === "/api/openapi.json" ? PORTED_TO_OPENAPI : PORTED_TO,
    );
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
    expect(registered).toContain("/api/openapi.json");
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

  it("still builds the OpenAPI spec, which is now what grades the port", () => {
    // The *route* is retired (pinakes:80 US-1) and the document is not:
    // `buildOpenApiSpec` is the graded spec for `pinakes.openapi_spec`, and
    // `openapi-spec.test.ts` pins it byte-equal to `docs/openapi.json` — the
    // same snapshot `services/api/tests/test_openapi_document.py` asserts
    // against, which is what makes the two backends publish one document.
    const spec = buildOpenApiSpec() as any;
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.paths["/api/contributions"].post.security).toEqual([
      { ApiKeyAuth: [] },
      { BearerAuth: [] },
    ]);
    expect(spec.paths["/api/contributions"].get.security).toEqual([]);
    expect(spec.components.securitySchemes.ApiKeyAuth.name).toBe("X-API-Key");
  });
});
