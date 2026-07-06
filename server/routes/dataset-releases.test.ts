import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Integration tests for the versioned public dataset API (US-011). The routes are
 * wired to a temp-dir `ChangelogStore` (so version derivation is deterministic) and
 * a fake DOI minter (so `POST` stamps a DOI without a live Zenodo call).
 */

import { registerDatasetReleaseRoutes } from "./dataset-releases";
import { ChangelogStore } from "../services/changelog";
import type { DoiMinter } from "../services/export-pipeline";

let app: Express;
let server: Server;
let baseUrl: string;
let changelogDir: string;
let changelog: ChangelogStore;

const fakeMinter: DoiMinter = {
  async mint(meta) {
    return { doi: `10.5281/zenodo.${meta.version}`, doiUrl: `https://doi.org/10.5281/zenodo.${meta.version}` };
  },
};

beforeAll(async () => {
  changelogDir = fs.mkdtempSync(path.join(os.tmpdir(), "dataset-release-changelog-"));
  changelog = new ChangelogStore(changelogDir);
  // Seed changelog: 2 additions ⇒ a minor bump from the previous version.
  changelog.record({ domain: "languages", changeType: "added", targetId: "a", summary: "add a", source: "test" });
  changelog.record({ domain: "languages", changeType: "added", targetId: "b", summary: "add b", source: "test" });

  app = express();
  app.use(express.json());
  registerDatasetReleaseRoutes(app, { changelog, doiMinter: fakeMinter });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(changelogDir, { recursive: true, force: true });
});

describe("GET /api/dataset/release", () => {
  it("returns release metadata with version, license, DOI (null), and row counts", async () => {
    const res = await fetch(`${baseUrl}/api/dataset/release`);
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.version).toBe("1.0.0");
    expect(meta.license).toBe("CC-BY-4.0");
    expect(meta.doi).toBeNull(); // GET does not mint
    expect(Array.isArray(meta.datasets)).toBe(true);
    expect(meta.totalRows).toBeGreaterThan(0);
    expect(meta.fileCount).toBeGreaterThan(0);
    // metadata carries no file contents (that is the /full endpoint)
    expect(meta.files).toBeUndefined();
  });

  it("restricts to a subset via ?datasets=", async () => {
    const res = await fetch(`${baseUrl}/api/dataset/release?datasets=languages`);
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.datasets.map((d: { id: string }) => d.id)).toEqual(["languages"]);
  });
});

describe("GET /api/dataset/full", () => {
  it("streams a downloadable JSON bundle with metadata + files", async () => {
    const res = await fetch(`${baseUrl}/api/dataset/full?datasets=languages`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="linguascrape-dataset-v1.0.0.json"');
    const body = await res.json();
    expect(body.metadata.version).toBe("1.0.0");
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files.every((f: { dataset: string }) => f.dataset === "languages")).toBe(true);
    // metadata totals match the bundled files
    const fileRows = body.files.reduce((s: number, f: { rowCount: number }) => s + f.rowCount, 0);
    expect(body.metadata.totalRows).toBe(fileRows);
  });
});

describe("POST /api/dataset/release", () => {
  it("mints a DOI and derives the next version from the changelog (2 adds ⇒ minor)", async () => {
    const res = await fetch(`${baseUrl}/api/dataset/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previousVersion: "1.0.0", datasets: ["languages"] }),
    });
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta.version).toBe("1.1.0"); // minor bump from 1.0.0
    expect(meta.doi).toBe("10.5281/zenodo.1.1.0");
    expect(meta.doiUrl).toBe("https://doi.org/10.5281/zenodo.1.1.0");
  });

  it("honours an explicit version over changelog derivation", async () => {
    const res = await fetch(`${baseUrl}/api/dataset/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "5.0.0", datasets: ["languages"] }),
    });
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta.version).toBe("5.0.0");
    expect(meta.doi).toBe("10.5281/zenodo.5.0.0");
  });
});
