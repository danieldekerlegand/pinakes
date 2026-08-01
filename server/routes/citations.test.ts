import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the `/api/citations/*` routes (US-008). The route is wired
 * with injectable in-memory fetchers (no storage/fs), so we assert HTTP status,
 * download headers, and the rendered citation for a known entity.
 */

import { registerCitationRoutes, type CitationFetcher } from "./citations";
import { type CitableEntity } from "../services/citation-export";

const minoan: CitableEntity = {
  entityType: "culture-profile",
  id: "minoan",
  name: "Minoan Civilization",
  sources: ["Evans 1921", "Archaeological evidence"],
  year: -2000,
  region: "Crete",
};

const fetchProfile: CitationFetcher = async (id) => (id === "minoan" ? minoan : null);

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerCitationRoutes(app, {
    fetchers: { "culture-profiles": { urlPath: "culture-profile", fetch: fetchProfile } },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/citations", () => {
  it("lists the configured domains + formats", async () => {
    const res = await fetch(`${baseUrl}/api/citations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domains).toEqual(["culture-profiles"]);
    expect(body.formats).toEqual(["bibtex", "ris", "csljson"]);
  });
});

describe("GET /api/citations/:domain/:id", () => {
  it("downloads BibTeX by default with an attachment filename", async () => {
    const res = await fetch(`${baseUrl}/api/citations/culture-profiles/minoan`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-bibtex");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="minoan.bib"');
    const text = await res.text();
    expect(text).toContain("@misc{pinakes-culture-profile-minoan,");
    expect(text).toContain("title = {Minoan Civilization}");
    expect(text).toContain("@misc{minoan-evans-1921,");
    // the record entry's url is derived from the request host
    expect(text).toMatch(/url = \{http:\/\/127\.0\.0\.1:\d+\/culture-profile\/minoan\}/);
  });

  it("supports the ris format", async () => {
    const res = await fetch(`${baseUrl}/api/citations/culture-profiles/minoan?format=ris`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="minoan.ris"');
    const text = await res.text();
    expect(text).toContain("TY  - DATA");
  });

  it("supports csljson and returns valid JSON", async () => {
    const res = await fetch(`${baseUrl}/api/citations/culture-profiles/minoan?format=csljson`);
    expect(res.status).toBe(200);
    const items = await res.json();
    expect(items).toHaveLength(3);
    expect(items[0].type).toBe("dataset");
  });

  it("404s an unknown domain", async () => {
    const res = await fetch(`${baseUrl}/api/citations/dragons/smaug`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Unknown citation domain");
  });

  it("404s an unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/citations/culture-profiles/atlantis`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });

  it("400s an unknown format", async () => {
    const res = await fetch(`${baseUrl}/api/citations/culture-profiles/minoan?format=mla`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown citation format");
  });
});
