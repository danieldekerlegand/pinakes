import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * `/api/relationships/edge*` is **ported** (pinakes:65 US-2) — this file no
 * longer exercises authoring or dedup, it asserts the hand-over.
 *
 * What used to live here (queueing an edge with `user-authored` provenance and
 * its confirmation summary, the 409 against a corpus edge, the 409 against the
 * just-queued edge, the self-edge and non-canonical-type 400s, the options
 * payload) is now graded on the Python side by
 * `services/api/tests/test_relationship_edge.py`, which drives the same cases
 * against `pinakes.routers.relationships`.
 *
 * The two specs stay here and are unchanged — `services/relationship-edge.test.ts`
 * and `services/canonical-edges.test.ts` are what say the validators and the two
 * corpus edge extractors agree.
 */

import {
  registerRelationshipEdgeRoutes,
  PORTED_ROUTES,
  PORTED_TO,
  PORTED_ERROR,
} from "./relationship-edge";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerRelationshipEdgeRoutes(app);
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

describe("/api/relationships/edge (retired)", () => {
  it("answers 501 on POST /api/relationships/edge, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.edge}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: "sumer",
        targetId: "akkad",
        relationshipType: "influenced-by",
      }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`POST ${PORTED_ROUTES.edge}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 on GET /api/relationships/edge/options, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTES.options}`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`GET ${PORTED_ROUTES.options}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps every path registered, so the harvested baseline is unchanged", async () => {
    // 501, not 404: a 404 would say "gone" and would drop these routes out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    const answers = await Promise.all(
      ([
        ["POST", PORTED_ROUTES.edge],
        ["GET", PORTED_ROUTES.options],
      ] as const).map(([method, path]) =>
        fetch(`${baseUrl}${path}`, { method }).then((res) => res.status),
      ),
    );
    expect(answers).toEqual([501, 501]);
  });

});
