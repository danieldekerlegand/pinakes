import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the `/api/ancestry/*` routes (US-001). Wired with an injectable
 * in-memory data loader (no storage/fs), asserting HTTP status + the mapping shape.
 */

import { registerAncestryRoutes, type AncestryDataLoader } from "./ancestry";
import type { AncestryMapperData } from "../services/genetic-linguistic-correlation";

const DATA: AncestryMapperData = {
  haplogroups: [
    {
      id: "r1b",
      name: "R1b",
      geographicOrigin: "Western Europe",
      timeOrigin: -20000,
      associatedLanguageFamilyIds: ["germanic"],
      associatedCivilizationIds: ["celts"],
    },
  ],
  families: [{ id: "germanic", name: "Germanic", region: "Northern Europe" }],
  languages: [{ id: "old-norse", name: "Old Norse", familyId: "germanic" }],
  civilizations: [{ id: "celts", name: "Celts" }],
  cuisines: [],
};

const loadData: AncestryDataLoader = async () => DATA;

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerAncestryRoutes(app, { loadData });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/ancestry/haplogroups", () => {
  it("lists the reference haplogroups", async () => {
    const res = await fetch(`${baseUrl}/api/ancestry/haplogroups`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.haplogroups.map((h: { id: string }) => h.id)).toEqual(["r1b"]);
  });
});

describe("POST /api/ancestry/map", () => {
  it("maps haplogroup ids to cultural associations with caveats", async () => {
    const res = await fetch(`${baseUrl}/api/ancestry/map`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ haplogroupIds: ["r1b"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchedHaplogroups.map((h: { id: string }) => h.id)).toEqual(["r1b"]);
    expect(body.spoke.map((s: { familyId: string }) => s.familyId)).toEqual(["germanic"]);
    expect(body.livedAmong.map((c: { civilizationId: string }) => c.civilizationId)).toEqual(["celts"]);
    expect(body.caveats.length).toBeGreaterThan(0);
  });

  it("400s on a missing or empty haplogroupIds list", async () => {
    const empty = await fetch(`${baseUrl}/api/ancestry/map`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ haplogroupIds: [] }),
    });
    expect(empty.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/ancestry/map`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
  });
});
