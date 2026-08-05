import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * The `/api/ancestry/*` routes are **ported** (pinakes:65 US-2) — this file no
 * longer exercises the mapping, it asserts the hand-over.
 *
 * What used to live here (the reference haplogroup index, the 400 on a missing
 * or empty id list, the spoke/livedAmong/ate associations and the caveats) is
 * now graded on the Python side by `services/api/tests/test_ancestry.py`, which
 * drives the same cases against `pinakes.routers.ancestry`. The mapper's own
 * spec — `services/ancestry-mapper.test.ts` — stays here and is unchanged: it is
 * what says the two implementations agree.
 *
 * The privacy posture is untouched by the port, because it never lived here:
 * raw-DNA parsing and haplogroup inference are the client's
 * (`web/src/lib/dna/*`), and only non-identifying ids ever reached a server.
 */

import {
  registerAncestryRoutes,
  PORTED_ROUTES,
  PORTED_TO,
  PORTED_ERROR,
} from "./ancestry";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerAncestryRoutes(app);
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

describe("/api/ancestry/* (retired)", () => {
  it("answers 501 on GET /api/ancestry/haplogroups, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.haplogroups}`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`GET ${PORTED_ROUTES.haplogroups}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 on POST /api/ancestry/map, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.map}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ haplogroupIds: ["r1b"] }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`POST ${PORTED_ROUTES.map}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps every path registered, so the harvested baseline is unchanged", async () => {
    // 501, not 404: a 404 would say "gone" and would drop these routes out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    const answers = await Promise.all(
      ([
        ["GET", PORTED_ROUTES.haplogroups],
        ["POST", PORTED_ROUTES.map],
      ] as const).map(([method, path]) =>
        fetch(`${baseUrl}${path}`, { method }).then((res) => res.status),
      ),
    );
    expect(answers).toEqual([501, 501]);
  });

});
