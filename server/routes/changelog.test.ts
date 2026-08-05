import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * What is left of `/api/changelog` on this backend (pinakes:61 US-2).
 *
 * The read API — filtering, pagination, stats — is served by the Python service
 * now, and its behavioural coverage moved with it to
 * `services/api/tests/test_changelog_routes.py`. What this file asserts is the
 * hand-off: the two retired paths are still *registered* (the parity baseline
 * was harvested from that path set) and answer 501 naming their replacement.
 *
 * The **write** side of this store did not move and is not retired: field
 * updates record here, and the release pipelines derive their semver from
 * `changelog.stats()`. So this file also pins the thing that would otherwise be
 * easy to break by accident — that an entry written on this side is still
 * written into the same directory the ported reader lists, which is what makes
 * the two halves one changelog rather than two.
 */

import { PORTED_ERROR, PORTED_ROUTES, PORTED_TO, registerChangelogRoutes } from "./changelog";
import { ChangelogStore } from "../services/changelog";

let app: Express;
let server: Server;
let baseUrl: string;
let changelogDir: string;
let changelog: ChangelogStore;

beforeAll(async () => {
  changelogDir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-routes-"));
  changelog = new ChangelogStore(changelogDir);

  app = express();
  app.use(express.json());
  registerChangelogRoutes(app);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(changelogDir, { recursive: true, force: true });
});

type Res = { status: number; body: any };

async function req(method: string, p: string): Promise<Res> {
  const res = await fetch(`${baseUrl}${p}`, { method });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Concrete URLs for the retired templates, with a query string on the list. */
const RETIRED: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/api/changelog?domain=civilization&limit=5"],
  ["GET", "/api/changelog/stats?source=contribution"],
];

describe("routes ported to the Python service", () => {
  it.each(RETIRED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const { status, body } = await req(method, url);
    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.coverage).toBe("/api/_parity/coverage");
  });

  it("keeps both retired paths registered", () => {
    // Deleting a registration would rewrite the parity baseline the port is
    // graded against — `contracts/parity/openapi.json` is harvested from the
    // Express routing table.
    expect(PORTED_ROUTES.get).toEqual(["/api/changelog", "/api/changelog/stats"]);
  });

  it("does not answer the read API from a store it was handed", async () => {
    // The signature no longer takes one, so this is really a statement that the
    // 501 is unconditional: seeding the shared store changes nothing here.
    changelog.record(
      { domain: "civilization", changeType: "added", source: "contribution" },
      { id: "seeded", now: "2026-07-01T00:00:00.000Z" },
    );
    expect((await req("GET", "/api/changelog")).status).toBe(501);
  });
});

describe("the write side that did NOT move", () => {
  it("still writes an entry the ported reader will list", () => {
    // One JSON file per entry, in the directory `pinakes.contributions.changelog`
    // reads. This is the half of the pipeline still living on this backend
    // (field updates, release semver), and the file shape is the contract
    // between the two.
    changelog.record(
      {
        domain: "language",
        changeType: "modified",
        source: "field-research",
        reviewer: "Dr Researcher",
      },
      { id: "field-1", now: "2026-07-02T00:00:00.000Z" },
    );
    const written = JSON.parse(
      fs.readFileSync(path.join(changelogDir, "field-1.json"), "utf-8"),
    );
    expect(written).toEqual({
      id: "field-1",
      timestamp: "2026-07-02T00:00:00.000Z",
      domain: "language",
      changeType: "modified",
      source: "field-research",
      reviewer: "Dr Researcher",
    });
  });
});
