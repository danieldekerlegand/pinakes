import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * `GET /api/anomalies` is **ported** (pinakes:62 US-1) — this file no longer
 * exercises the scan, it asserts the hand-over.
 *
 * What used to live here (ranking, provenance merging, `?domains=` filtering,
 * `minSurprise`/`limit`) is now graded on the Python side by
 * `services/api/tests/test_anomaly_detection.py`, which drives the same cases
 * against `pinakes.routers.anomalies`. The scoring engine's own spec —
 * `services/anomaly-detection.test.ts` — stays here and is unchanged: it is what
 * says the two implementations agree.
 */

import { registerAnomalyRoutes, PORTED_ROUTE, PORTED_TO, PORTED_ERROR } from "./anomaly-detection";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerAnomalyRoutes(app);
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

describe("GET /api/anomalies (retired)", () => {
  it("answers 501 naming the Python module that serves it", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTE}`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`GET ${PORTED_ROUTE}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps the path registered, so the harvested baseline is unchanged", async () => {
    // 501, not 404: a 404 would say "gone" and would drop the route out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    const res = await fetch(`${baseUrl}${PORTED_ROUTE}?domains=music-tradition&limit=1`);
    expect(res.status).toBe(501);
  });
});
