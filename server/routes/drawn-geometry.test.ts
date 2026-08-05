import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * `/api/map/drawn-geometry*` is **ported** (pinakes:65 US-2) — this file no
 * longer exercises the authoring flow, it asserts the hand-over.
 *
 * What used to live here (queueing a polygon and a line with `user-drawn`
 * provenance, the unclosed-ring rejection, the geometry/target mismatch, the
 * inverted range, the targets list) is now graded on the Python side by
 * `services/api/tests/test_drawn_geometry.py`, which drives the same cases
 * against `pinakes.routers.drawn_geometry`. The validator's own spec —
 * `services/drawn-geometry.test.ts` — stays here and is unchanged: it is what
 * says the two implementations agree.
 */

import {
  registerDrawnGeometryRoutes,
  PORTED_ROUTES,
  PORTED_TO,
  PORTED_ERROR,
} from "./drawn-geometry";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerDrawnGeometryRoutes(app);
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

describe("/api/map/drawn-geometry (retired)", () => {
  it("answers 501 on the submit route, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.submit}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 40], [2, 40], [2, 42], [0, 42], [0, 40]]],
        },
        target: "boundary",
        name: "Akkad",
        associatedEntityId: "akkad",
        timePeriodStart: -2334,
      }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`POST ${PORTED_ROUTES.submit}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 on the targets route", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.targets}`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.route).toBe(`GET ${PORTED_ROUTES.targets}`);
    expect(body.servedBy).toBe(PORTED_TO);
  });

  it("keeps both paths registered, so the harvested baseline is unchanged", async () => {
    // 501, not 404: a 404 would say "gone" and would drop the routes out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    for (const [method, path] of [
      ["POST", PORTED_ROUTES.submit],
      ["GET", PORTED_ROUTES.targets],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status).toBe(501);
    }
  });
});
