/**
 * The parity gate (tasks/chief/30-api-shell-parity.json US-1).
 *
 * Replays every recorded fixture against the live Express app and asserts the
 * response still satisfies the recorded shape — so the baseline can never rot
 * silently — and checks the generated spec matches the app's real routing table.
 *
 * The same fixtures grade the Python service as route groups are ported; that
 * side's replay lives in `services/api/tests/`.
 */
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  formatParityResult,
  httpParityFetch,
  loadParityFixtures,
  replayFixture,
  type ParityFixture,
} from "./harness";

const PARITY_DIR = path.resolve(import.meta.dirname);
const FIXTURES_DIR = path.join(PARITY_DIR, "fixtures");

let server: Server;
let baseUrl: string;
const fixtures: ParityFixture[] = loadParityFixtures(FIXTURES_DIR);

beforeAll(async () => {
  const { registerRoutes } = await import("../../server/routes");
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  server = await registerRoutes(app);
  // Bind the loopback explicitly — a bare listen(0) binds :: and lets another
  // server claim the same IPv4 port (server/CLAUDE.md).
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}, 120_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Express parity baseline", () => {
  it("records fixtures for the routes the client depends on", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    // Every fixture names the Express template it exercises — that link is what
    // binds a recorded shape to an operation in openapi.json.
    for (const fixture of fixtures) {
      expect(fixture.request.route, `${fixture.id} has no route template`).toMatch(/^\//);
    }
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    "%s still matches its recorded shape",
    async (_id, fixture) => {
      const result = await replayFixture(fixture, httpParityFetch(baseUrl));
      expect(result.ok, formatParityResult(result)).toBe(true);
    },
    60_000,
  );
});

describe("parity spec", () => {
  it("is in sync with the app's live routing table", async () => {
    const { generateParitySpec, serializeSpec } = await import("../../scripts/gen-parity-spec");
    const fs = await import("node:fs");
    const committed = fs.readFileSync(path.join(PARITY_DIR, "openapi.json"), "utf-8");
    const regenerated = serializeSpec(await generateParitySpec());
    expect(
      regenerated === committed,
      "contracts/parity/openapi.json is stale — run: npx tsx scripts/gen-parity-spec.ts",
    ).toBe(true);
  }, 120_000);
});
