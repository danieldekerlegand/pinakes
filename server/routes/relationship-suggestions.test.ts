import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * `/api/relationships/suggestions` is **ported** (pinakes:65 US-2) — this file
 * no longer exercises ranking, it asserts the hand-over.
 *
 * What used to live here (ranked suggestions for a corpus entity, the
 * already-connected exclusion, `?limit=`, `entityType` disambiguation, the 400
 * without an id, the 404 for an unknown one, and the draft-entity POST) is now
 * graded on the Python side by
 * `services/api/tests/test_relationship_suggestions.py`, which drives the same
 * cases against `pinakes.routers.relationships`. The ranker's own spec —
 * `services/relationship-suggestions.test.ts` — stays here and is unchanged.
 */

import {
  registerRelationshipSuggestionRoutes,
  PORTED_ROUTE,
  PORTED_TO,
  PORTED_ERROR,
} from "./relationship-suggestions";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerRelationshipSuggestionRoutes(app);
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

describe("/api/relationships/suggestions (retired)", () => {
  it("answers 501 on GET /api/relationships/suggestions, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTE}?entityId=rome&limit=2`);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`GET ${PORTED_ROUTE}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("answers 501 on POST /api/relationships/suggestions, naming the Python module", async () => {
    const res = await fetch(`${baseUrl}${PORTED_ROUTE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "d", name: "Draft", entityType: "civilization" }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.route).toBe(`POST ${PORTED_ROUTE}`);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps every path registered, so the harvested baseline is unchanged", async () => {
    // 501, not 404: a 404 would say "gone" and would drop these routes out of
    // contracts/parity/openapi.json the next time the spec is regenerated.
    const answers = await Promise.all(
      ([
        ["GET", PORTED_ROUTE],
        ["POST", PORTED_ROUTE],
      ] as const).map(([method, path]) =>
        fetch(`${baseUrl}${path}`, { method }).then((res) => res.status),
      ),
    );
    expect(answers).toEqual([501, 501]);
  });

});
