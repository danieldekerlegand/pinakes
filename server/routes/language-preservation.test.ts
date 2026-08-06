import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * The `/api/languages/*` preservation routes are **ported** (pinakes:80 US-1) —
 * this file no longer exercises the dashboard or the field-update flow, it
 * asserts the hand-over.
 *
 * What used to live here (the aggregation shape, `?watchlistLimit=`, the queued
 * `language` edit with `field-research` provenance, the changelog entry it lands
 * at submission time, the attribution 400 and the unknown-id 404) is now graded
 * on the Python side by `services/api/tests/test_preservation_routes.py`, which
 * drives the same cases against `pinakes.routers.preservation`. The model's own
 * spec — `services/language-preservation.test.ts` — stays here and is
 * unchanged: it is what says the two implementations agree.
 */

import {
  registerLanguagePreservationRoutes,
  PORTED_ROUTES,
  PORTED_TO,
  PORTED_ERROR,
} from "./language-preservation";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerLanguagePreservationRoutes(app);
  // Bind the loopback explicitly — a bare listen(0) binds :: and lets another
  // server claim the same IPv4 port (server/CLAUDE.md).
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("/api/languages preservation routes (retired)", () => {
  it("answers 501 on the dashboard, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.dashboard}`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`GET ${PORTED_ROUTES.dashboard}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 on the field update, without touching a queue", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.fieldUpdate}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        languageId: "cy",
        researcherName: "Dr. Jones",
        status: "endangered",
        sources: [{ title: "2026 Welsh census field notes" }],
      }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.route).toBe(`POST ${PORTED_ROUTES.fieldUpdate}`);
    expect(body.servedBy).toBe(PORTED_TO);
  });

  it("keeps both paths registered, so the harvested baseline is unchanged", async () => {
    // 501, not 404: a 404 would say "gone" and would drop the routes out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    for (const [method, path] of [
      ["GET", PORTED_ROUTES.dashboard],
      ["POST", PORTED_ROUTES.fieldUpdate],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status).toBe(501);
    }
  });
});
