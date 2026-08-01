import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the `/api/summaries/*` routes (US-004). Storage is
 * module-mocked so the routes run against deterministic fixture records (no disk,
 * no TSV parsing). We assert the progressive-loading contract end to end: the
 * list endpoint returns *summary-shaped* rows, the detail endpoint returns the
 * *full* record, and their shapes differ exactly as the contract promises.
 */

const RELIGIONS = [
  {
    id: "rel-1",
    name: "Roman polytheism",
    nativeName: "Religio Romana",
    religionType: "polytheism",
    originRegion: "Italy",
    coordinates: { lat: 41.9, lng: 12.5 },
    timeOrigin: -750,
    timeEnd: 400,
    sacredTexts: ["Sibylline Books"],
    associatedLanguageIds: ["lat"],
    deityPantheon: ["Jupiter", "Juno"],
    ritualPractices: ["augury"],
    description: "The polytheistic religion of ancient Rome.",
    sources: ["scraped"],
  },
  {
    id: "rel-2",
    name: "Greek polytheism",
    nativeName: "Hellenismos",
    religionType: "polytheism",
    originRegion: "Greece",
    coordinates: { lat: 37.9, lng: 23.7 },
    timeOrigin: -900,
    timeEnd: 400,
    sacredTexts: ["Theogony"],
    associatedLanguageIds: ["grc"],
    deityPantheon: ["Zeus", "Hera"],
    ritualPractices: ["sacrifice"],
    description: "The polytheistic religion of ancient Greece.",
    sources: ["scraped"],
  },
];

const mocks = vi.hoisted(() => ({
  getReligions: vi.fn(),
  getLanguages: vi.fn(),
  getBattles: vi.fn(),
  getCultureProfiles: vi.fn(),
  getCuisines: vi.fn(),
  getTradeGoods: vi.fn(),
  getInnovations: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getReligions: mocks.getReligions,
    getLanguages: mocks.getLanguages,
    getBattles: mocks.getBattles,
    getCultureProfiles: mocks.getCultureProfiles,
    getCuisines: mocks.getCuisines,
    getTradeGoods: mocks.getTradeGoods,
    getInnovations: mocks.getInnovations,
  },
}));

import { registerSummaryRoutes } from "./summaries";
import { summaryFields } from "../services/entity-summary";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  mocks.getReligions.mockResolvedValue(RELIGIONS);
  mocks.getLanguages.mockResolvedValue([]);
  mocks.getBattles.mockResolvedValue([]);
  mocks.getCultureProfiles.mockResolvedValue([]);
  mocks.getCuisines.mockResolvedValue([]);
  mocks.getTradeGoods.mockResolvedValue([]);
  mocks.getInnovations.mockResolvedValue([]);

  app = express();
  registerSummaryRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/summaries", () => {
  it("returns the machine-readable contract for every domain", async () => {
    const { status, body } = await get("/api/summaries");
    expect(status).toBe(200);
    const religions = body.domains.find((d: any) => d.domain === "religions");
    expect(religions).toMatchObject({
      domain: "religions",
      detailEndpoint: "/api/religions/:id",
    });
    expect(religions.fields).toEqual(summaryFields("religions"));
    // every contract points at a detail endpoint
    for (const d of body.domains) {
      expect(d.detailEndpoint).toBe(`/api/${d.domain}/:id`);
    }
  });
});

describe("GET /api/summaries/:domain", () => {
  it("returns lightweight summary rows, not the full records", async () => {
    const { status, body } = await get("/api/summaries/religions");
    expect(status).toBe(200);
    expect(body).toMatchObject({ domain: "religions", total: 2, returned: 2, hasMore: false });
    expect(body.summaries).toHaveLength(2);

    const summary = body.summaries[0];
    // summary carries only contract fields …
    expect(Object.keys(summary).every((k) => summaryFields("religions").includes(k))).toBe(true);
    // … and specifically NOT the heavy detail fields
    expect(summary).not.toHaveProperty("description");
    expect(summary).not.toHaveProperty("deityPantheon");
    expect(summary).toMatchObject({ id: "rel-1", name: "Roman polytheism", religionType: "polytheism" });
  });

  it("paginates via offset/limit and reports hasMore", async () => {
    const { body } = await get("/api/summaries/religions?offset=0&limit=1");
    expect(body).toMatchObject({ total: 2, returned: 1, offset: 0, limit: 1, hasMore: true });
    expect(body.summaries[0].id).toBe("rel-1");

    const page2 = await get("/api/summaries/religions?offset=1&limit=1");
    expect(page2.body).toMatchObject({ returned: 1, offset: 1, hasMore: false });
    expect(page2.body.summaries[0].id).toBe("rel-2");
  });

  it("404s an unknown domain and lists valid ones", async () => {
    const { status, body } = await get("/api/summaries/dragons");
    expect(status).toBe(404);
    expect(body.error).toMatch(/Unknown summary domain/);
    expect(body.domains).toContain("religions");
  });
});

describe("GET /api/summaries/:domain/:id (detail-on-demand)", () => {
  it("returns the FULL record — a strict superset of the summary shape", async () => {
    const { status, body } = await get("/api/summaries/religions/rel-1");
    expect(status).toBe(200);
    // detail carries the heavy fields the summary omits
    expect(body).toMatchObject({
      id: "rel-1",
      name: "Roman polytheism",
      description: "The polytheistic religion of ancient Rome.",
      deityPantheon: ["Jupiter", "Juno"],
      sacredTexts: ["Sibylline Books"],
    });
    // and every summary field is present in the detail (subset property)
    for (const field of summaryFields("religions")) {
      expect(body).toHaveProperty(field);
    }
  });

  it("404s an unknown id", async () => {
    const { status, body } = await get("/api/summaries/religions/does-not-exist");
    expect(status).toBe(404);
    expect(body.error).toMatch(/Not found/);
  });

  it("404s an unknown domain", async () => {
    const { status } = await get("/api/summaries/dragons/rel-1");
    expect(status).toBe(404);
  });
});
