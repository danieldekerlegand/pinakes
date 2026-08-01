import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for `GET /api/hypotheses` (US-007). Wired with injectable
 * in-memory loaders (no storage/fs), asserting HTTP status + the generated-lead
 * shape, both hypothesis families, the GeoJSON overlay, and query-param tuning.
 */

import {
  registerHypothesisRoutes,
  waypointsToPoints,
  type NodeLoader,
  type CorridorLoader,
  type KnownSiteLoader,
} from "./hypotheses";
import type { CultureNode, CorridorInput } from "../services/hypothesis-generation";

const IBERIA = { lat: 37, lng: -5 };
const JAVA = { lat: -7, lng: 110 };
const JAPAN = { lat: 36, lng: 138 };

// Three distant, unrelated cultures sharing one rare motif, plus common fillers.
const NODES: CultureNode[] = [
  {
    id: "art:iberia",
    name: "Iberian pottery",
    domain: "art-tradition",
    coordinates: IBERIA,
    groupIds: ["iberian"],
    features: [{ type: "art-motif", key: "step-fret", label: "step-fret motif" }],
    sources: ["Garcia 2011"],
  },
  {
    id: "art:java",
    name: "Javanese batik",
    domain: "art-tradition",
    coordinates: JAVA,
    groupIds: ["javanese"],
    features: [{ type: "art-motif", key: "step-fret", label: "step-fret motif" }],
    sources: ["Tan 2015"],
  },
  {
    id: "art:japan",
    name: "Jomon ware",
    domain: "art-tradition",
    coordinates: JAPAN,
    groupIds: ["japanese"],
    features: [{ type: "art-motif", key: "step-fret", label: "step-fret motif" }],
  },
  ...Array.from({ length: 15 }, (_, i) => ({
    id: `filler${i}`,
    name: `Filler ${i}`,
    domain: "art-tradition",
    coordinates: { lat: 10 + i, lng: 20 + i },
    groupIds: [`fill${i}`],
    features: [{ type: "art-motif", key: "spiral", label: "spiral" }],
  })),
];

const CORRIDORS: CorridorInput[] = [
  {
    id: "silk-road",
    name: "Silk Road",
    peoples: ["Sogdians"],
    points: [
      { lat: 39.9, lng: 116.4 },
      { lat: 43.3, lng: 76.9 },
      { lat: 39.6, lng: 66.9 },
    ],
  },
];

const KNOWN_SITES = [
  { lat: 39.9, lng: 116.4 },
  { lat: 39.6, lng: 66.9 },
];

const loadNodes: NodeLoader = async () => NODES;
const loadCorridors: CorridorLoader = async () => CORRIDORS;
const loadKnownSites: KnownSiteLoader = async () => KNOWN_SITES;

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  registerHypothesisRoutes(app, { loadNodes, loadCorridors, loadKnownSites });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/hypotheses", () => {
  it("returns both hypothesis families, a GeoJSON overlay, and honest framing", async () => {
    const res = await fetch(`${baseUrl}/api/hypotheses`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Common-ancestor cluster over the three distant cultures.
    expect(body.ancestorHypotheses.length).toBe(1);
    const h = body.ancestorHypotheses[0];
    expect(h.kind).toBe("common-ancestor");
    expect(h.members.map((m: { id: string }) => m.id).sort()).toEqual([
      "art:iberia",
      "art:japan",
      "art:java",
    ]);
    expect(h.sharedTraits[0].key).toBe("step-fret");
    expect(h.speculative).toBe(true);
    expect(h.generated).toBe(true);

    // Site predictions along the Silk Road gap.
    expect(body.sitePredictions.length).toBeGreaterThan(0);
    for (const p of body.sitePredictions) {
      expect(p.kind).toBe("site-location");
      expect(p.uncertaintyRadiusKm).toBeGreaterThan(0);
      expect(p.speculative).toBe(true);
    }

    // GeoJSON overlay mirrors the predictions.
    expect(body.geojson.type).toBe("FeatureCollection");
    expect(body.geojson.features.length).toBe(body.sitePredictions.length);

    // Distinct-from-curated + disclaimer notes present.
    expect(typeof body.disclaimer).toBe("string");
    expect(body.distinctFromCurated.toLowerCase()).toContain("urheimat");

    // Honest stats.
    expect(body.stats.nodesConsidered).toBe(NODES.length);
    expect(body.stats.corridorsScanned).toBe(1);
  });

  it("honors the minMembers query param", async () => {
    // Raising minMembers above the cluster size drops the ancestor hypothesis.
    const res = await fetch(`${baseUrl}/api/hypotheses?minMembers=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ancestorHypotheses.length).toBe(0);
  });

  it("honors the minGapKm query param", async () => {
    // A very high gap threshold suppresses site predictions.
    const res = await fetch(`${baseUrl}/api/hypotheses?minGapKm=100000`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sitePredictions.length).toBe(0);
  });

  it("500s when a loader throws", async () => {
    const bad = express();
    registerHypothesisRoutes(bad, {
      loadNodes: async () => {
        throw new Error("boom");
      },
    });
    const s = await new Promise<Server>((resolve) => {
      const srv = bad.listen(0, "127.0.0.1", () => resolve(srv));
    });
    const { port } = s.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/hypotheses`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("hypothesis generation failed");
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});

describe("waypointsToPoints", () => {
  it("parses a GeoJSON LineString [lng,lat] into ordered lat/lng points", () => {
    const pts = waypointsToPoints({
      type: "LineString",
      coordinates: [
        [116.4, 39.9],
        [66.9, 39.6],
      ],
    });
    expect(pts).toEqual([
      { lat: 39.9, lng: 116.4 },
      { lat: 39.6, lng: 66.9 },
    ]);
  });

  it("returns [] for malformed waypoints", () => {
    expect(waypointsToPoints(null)).toEqual([]);
    expect(waypointsToPoints({})).toEqual([]);
    expect(waypointsToPoints({ coordinates: "nope" })).toEqual([]);
  });
});
