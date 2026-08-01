import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for `GET /api/anomalies` (US-006). Wired with an injectable
 * in-memory node loader (no storage/fs), asserting HTTP status + the anomaly
 * shape, ranking, and query-param filtering.
 */

import { registerAnomalyRoutes, type AnomalyNodeLoader } from "./anomaly-detection";
import type { CultureNode } from "../services/anomaly-detection";

const IBERIA = { lat: 37, lng: -5 };
const JAVA = { lat: -7, lng: 110 };

const NODES: CultureNode[] = [
  {
    id: "music:iberian",
    name: "Iberian folk",
    domain: "music-tradition",
    coordinates: IBERIA,
    groupIds: ["es"],
    features: [{ type: "music-scale", key: "slendro", label: "slendro" }],
    sources: ["Smith 1990"],
  },
  {
    id: "music:javanese",
    name: "Javanese gamelan",
    domain: "music-tradition",
    coordinates: JAVA,
    groupIds: ["jv"],
    features: [{ type: "music-scale", key: "slendro", label: "slendro" }],
    sources: ["Jones 2001"],
  },
  // Filler nodes make "slendro" rare relative to the common "pentatonic".
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `music:filler${i}`,
    name: `Filler ${i}`,
    domain: "music-tradition",
    coordinates: { lat: 10 + i, lng: 20 + i },
    groupIds: [`fill${i}`],
    features: [{ type: "music-scale", key: "pentatonic", label: "pentatonic" }],
  })),
  // A distant art pair sharing a rare feature — different domain.
  {
    id: "art:andes",
    name: "Andean textiles",
    domain: "art-tradition",
    coordinates: { lat: -13, lng: -72 },
    groupIds: ["quechua"],
    features: [{ type: "art-feature", key: "step-fret", label: "step-fret motif" }],
  },
  {
    id: "art:aegean",
    name: "Aegean pottery",
    domain: "art-tradition",
    coordinates: { lat: 37, lng: 25 },
    groupIds: ["greek"],
    features: [{ type: "art-feature", key: "step-fret", label: "step-fret motif" }],
  },
];

const loadNodes: AnomalyNodeLoader = async () => NODES;

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerAnomalyRoutes(app, { loadNodes });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/anomalies", () => {
  it("returns ranked, hypothesis-framed anomalies with evidence + provenance", async () => {
    const res = await fetch(`${baseUrl}/api/anomalies`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.disclaimer).toMatch(/Hypotheses only/i);
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(body.anomalies.length).toBeGreaterThanOrEqual(2);

    const top = body.anomalies[0];
    expect(top.speculative).toBe(true);
    expect(top.surpriseScore).toBeGreaterThan(0);
    expect(top.sharedFeatures.length).toBeGreaterThan(0);
    expect(top.hypothesis).toMatch(/lead|hint/i);
    // Anomalies are sorted by surprise descending.
    const scores = body.anomalies.map((a: { surpriseScore: number }) => a.surpriseScore);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));

    // The Iberian/Javanese slendro pair is present with merged provenance.
    const slendro = body.anomalies.find(
      (a: { sharedFeatures: { key: string }[] }) =>
        a.sharedFeatures.some((f) => f.key === "slendro"),
    );
    expect(slendro).toBeTruthy();
    expect(slendro.provenance).toEqual(
      expect.arrayContaining(["Smith 1990", "Jones 2001"]),
    );
  });

  it("filters by domain via ?domains=", async () => {
    const res = await fetch(`${baseUrl}/api/anomalies?domains=art-tradition`);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const a of body.anomalies) {
      expect(a.entityA.domain).toBe("art-tradition");
      expect(a.entityB.domain).toBe("art-tradition");
    }
    expect(body.stats.nodesConsidered).toBe(2);
  });

  it("respects minSurprise and limit query params", async () => {
    const capped = await fetch(`${baseUrl}/api/anomalies?limit=1`);
    const cappedBody = await capped.json();
    expect(cappedBody.anomalies.length).toBe(1);

    const strict = await fetch(`${baseUrl}/api/anomalies?minSurprise=1`);
    const strictBody = await strict.json();
    expect(strictBody.anomalies).toHaveLength(0);
  });
});
