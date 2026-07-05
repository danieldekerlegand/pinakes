import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the US-010 suggestion routes. Both the candidate pool
 * (`loadEntities`) and the existing-edge exclusion set (`loadExistingEdges`) are
 * injected as in-memory fakes, so the endpoints are exercised end-to-end with no
 * storage, no lexicons dir, and no network.
 */

import { registerRelationshipSuggestionRoutes } from "./relationship-suggestions";
import type { SuggestionEntity, ExistingEdge } from "../services/relationship-suggestions";

const entities: SuggestionEntity[] = [
  {
    id: "rome",
    name: "Roman Republic",
    entityType: "civilization",
    languageIds: ["latin"],
    coordinates: { lat: 41.9, lng: 12.5 },
    timeStart: -509,
    timeEnd: 476,
    region: "Mediterranean",
  },
  {
    id: "latin-cuisine",
    name: "Roman Cuisine",
    entityType: "cuisine",
    languageIds: ["latin"],
    coordinates: { lat: 41.0, lng: 12.0 },
    timeStart: -200,
    timeEnd: 500,
    region: "Mediterranean",
  },
  {
    id: "etruria",
    name: "Etruscan Civilization",
    entityType: "civilization",
    languageIds: ["etruscan"],
    coordinates: { lat: 42.5, lng: 11.8 },
    timeStart: -900,
    timeEnd: -27,
    region: "Mediterranean",
  },
];

let existingEdges: ExistingEdge[] = [];

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerRelationshipSuggestionRoutes(app, {
    loadEntities: async () => entities,
    loadExistingEdges: () => existingEdges,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Res = { status: number; body: any };

async function get(query: string): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/relationships/suggestions${query}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function post(body: unknown): Promise<Res> {
  const res = await fetch(`${baseUrl}/api/relationships/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("GET /api/relationships/suggestions", () => {
  it("returns ranked suggestions for a corpus entity", async () => {
    existingEdges = [];
    const { status, body } = await get("?entityId=rome&minConfidence=1");
    expect(status).toBe(200);
    expect(body.source).toEqual({ id: "rome", name: "Roman Republic", entityType: "civilization" });
    expect(body.count).toBe(body.suggestions.length);
    expect(body.suggestions[0].targetId).toBe("latin-cuisine");
    expect(body.suggestions[0].rationale.length).toBeGreaterThan(0);
    expect(body.suggestions[0].edge.sourceId).toBe("rome");
  });

  it("400s without an entityId", async () => {
    const { status } = await get("");
    expect(status).toBe(400);
  });

  it("404s when the entity is not in the pool", async () => {
    const { status } = await get("?entityId=atlantis");
    expect(status).toBe(404);
  });

  it("respects entityType disambiguation", async () => {
    const { status } = await get("?entityId=rome&entityType=language");
    expect(status).toBe(404); // rome is a civilization, not a language
  });

  it("excludes an already-connected pair", async () => {
    existingEdges = [
      { sourceId: "latin-cuisine", targetId: "rome", relationshipType: "influenced-by" },
    ];
    const { body } = await get("?entityId=rome&minConfidence=1");
    expect(body.suggestions.map((s: any) => s.targetId)).not.toContain("latin-cuisine");
    existingEdges = [];
  });

  it("honours the limit", async () => {
    const { body } = await get("?entityId=rome&minConfidence=1&limit=1");
    expect(body.suggestions).toHaveLength(1);
  });
});

describe("POST /api/relationships/suggestions", () => {
  it("suggests relationships for an entity being authored (not yet saved)", async () => {
    existingEdges = [];
    const { status, body } = await post({
      id: "draft-latium",
      name: "Latium",
      entityType: "civilization",
      languageIds: ["latin"],
      coordinates: { lat: 41.5, lng: 12.8 },
      timeStart: -600,
      timeEnd: 300,
      region: "Mediterranean",
      minConfidence: 1,
    });
    expect(status).toBe(200);
    expect(body.source.id).toBe("draft-latium");
    // Shares "latin" + is temporally/spatially close to both Rome and its
    // cuisine ⇒ both surface as high-confidence suggestions, strongest first.
    const ids = body.suggestions.map((s: any) => s.targetId);
    expect(ids).toContain("rome");
    expect(ids).toContain("latin-cuisine");
    expect(ids).not.toContain("draft-latium");
    expect(body.suggestions[0].confidence).toBeGreaterThanOrEqual(body.suggestions[1].confidence);
  });

  it("400s when required identity fields are missing", async () => {
    const { status } = await post({ name: "No Id", entityType: "civilization" });
    expect(status).toBe(400);
  });
});
