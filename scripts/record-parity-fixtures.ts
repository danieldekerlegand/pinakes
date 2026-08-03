/**
 * Record the parity **fixtures** — the response shapes the React client depends on
 * (tasks/chief/30-api-shell-parity.json US-1).
 *
 * Reads the curated request catalog (`contracts/parity/requests.json`), replays it
 * against the real Express app on an ephemeral port, and writes one fixture per
 * request to `contracts/parity/fixtures/`. `contracts/parity/parity.test.ts`
 * replays those fixtures back at the app; the Python service
 * (`services/api`) is graded against the same files as routes are ported.
 *
 * Fixtures record a **shape**, never values (see `contracts/parity/shape.ts`) — the
 * corpus grows, ids churn, counts drift. The committed `sample` is truncated
 * documentation for a porter and is never asserted on. Nothing here is
 * wall-clock-stamped, so re-recording an unchanged API is a no-op diff.
 *
 * Every catalog entry must be **side-effect free**: reads, or writes that are
 * rejected before they touch a store (the 400-contract entries). Never record a
 * request that mutates the corpus or the contribution queue.
 *
 * Usage:
 *   npx tsx scripts/record-parity-fixtures.ts              # record the whole catalog
 *   npx tsx scripts/record-parity-fixtures.ts --only <id>  # re-record one entry
 */
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";

import { httpParityFetch, type ParityRequest, type ParityFixture } from "@contracts/parity/harness";
import { describeShape, truncateSample } from "@contracts/parity/shape";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PARITY_DIR = path.join(REPO_ROOT, "contracts", "parity");
const REQUESTS_PATH = path.join(PARITY_DIR, "requests.json");
const FIXTURES_DIR = path.join(PARITY_DIR, "fixtures");

export function loadRequestCatalog(requestsPath = REQUESTS_PATH): ParityRequest[] {
  const raw = JSON.parse(fs.readFileSync(requestsPath, "utf-8")) as { requests: ParityRequest[] };
  return raw.requests;
}

/** Turn one recorded response into a committable fixture. */
export function toFixture(request: ParityRequest, response: {
  status: number;
  contentType: string | null;
  body: unknown;
}): ParityFixture {
  const { id, description, ...requestShape } = request;
  return {
    id,
    description,
    request: requestShape,
    response: {
      status: response.status,
      contentType: response.contentType?.split(";")[0] ?? null,
      shape: describeShape(response.body),
      sample: truncateSample(response.body),
    },
  };
}

/**
 * Boot the app on `127.0.0.1:0`. Binding the loopback explicitly (never a bare
 * `listen(0)`) is the house rule — see `server/CLAUDE.md`.
 */
async function startApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const { registerRoutes } = await import("../server/routes");
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
  const catalog = loadRequestCatalog().filter((entry) => !only || entry.id === only);
  if (catalog.length === 0) {
    throw new Error(only ? `no catalog entry with id "${only}"` : "empty request catalog");
  }

  const { baseUrl, close } = await startApp();
  const fetchImpl = httpParityFetch(baseUrl);
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  let failures = 0;
  try {
    for (const request of catalog) {
      const response = await fetchImpl(request);
      const expected = request.expectStatus ?? 200;
      if (response.status !== expected) {
        failures += 1;
        console.error(
          `✗ ${request.id}: ${request.method} ${request.path} → ${response.status} (expected ${expected})` +
            `\n    ${JSON.stringify(response.body).slice(0, 300)}`,
        );
        continue;
      }
      const fixture = toFixture(request, response);
      fs.writeFileSync(
        path.join(FIXTURES_DIR, `${request.id}.json`),
        `${JSON.stringify(fixture, null, 2)}\n`,
      );
      console.log(`✓ ${request.id}: ${request.method} ${request.path} → ${response.status}`);
    }
  } finally {
    await close();
  }

  if (failures > 0) {
    throw new Error(`${failures} catalog request(s) did not answer with the expected status`);
  }
  console.log(`recorded ${catalog.length} fixture(s) into ${path.relative(REPO_ROOT, FIXTURES_DIR)}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  void main().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
