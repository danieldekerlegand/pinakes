import { describe, it, expect } from "vitest";

import {
  type CultureNode,
  type NodeFeature,
  type CorridorInput,
  generateAncestorHypotheses,
  predictSiteRegions,
  sampleCorridor,
  nearestKnownKm,
  centroidOf,
  maxSpreadKm,
  sitePredictionsToGeoJSON,
  generateHypotheses,
  HYPOTHESIS_DISCLAIMER,
  DISTINCT_FROM_CURATED,
} from "./hypothesis-generation";

function feat(type: string, key: string, label?: string): NodeFeature {
  return { type, key, label: label ?? key };
}

function node(overrides: Partial<CultureNode> & { id: string }): CultureNode {
  return {
    name: overrides.id,
    domain: "test",
    features: [],
    ...overrides,
  };
}

// Rough anchors, all far apart (>2000 km pairwise).
const IBERIA = { lat: 37, lng: -5 };
const JAVA = { lat: -7, lng: 110 };
const ANDES = { lat: -13, lng: -72 };
const JAPAN = { lat: 36, lng: 138 };

// A pool of common-feature filler nodes so a shared trait reads as rare.
function fillers(n: number, featureKeyName = "common"): CultureNode[] {
  return Array.from({ length: n }, (_, i) =>
    node({
      id: `filler${i}`,
      coordinates: { lat: 10 + i, lng: 20 + i },
      groupIds: [`fill${i}`],
      features: [feat("music-scale", featureKeyName)],
    }),
  );
}

// ============================================================================
// geometry helpers
// ============================================================================

describe("centroidOf / maxSpreadKm", () => {
  it("averages coordinates and finds the widest pairwise distance", () => {
    const c = centroidOf([IBERIA, JAVA]);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo((37 + -7) / 2, 3);
    const spread = maxSpreadKm([IBERIA, JAVA, ANDES]);
    // Iberia↔Java is the widest leg here, > 11,000 km.
    expect(spread).toBeGreaterThan(11000);
  });

  it("returns null for empty / single-point inputs", () => {
    expect(centroidOf([])).toBeNull();
    expect(maxSpreadKm([IBERIA])).toBeNull();
  });
});

// ============================================================================
// common-ancestor hypotheses
// ============================================================================

describe("generateAncestorHypotheses", () => {
  it("clusters ≥3 distant, unrelated cultures sharing a rare trait", () => {
    const rare = "step-fret";
    const nodes = [
      node({
        id: "a",
        name: "Andean textiles",
        coordinates: ANDES,
        groupIds: ["quechua"],
        features: [feat("art-motif", rare, "step-fret motif")],
        sources: ["Reindel 2009"],
      }),
      node({
        id: "b",
        name: "Iberian pottery",
        coordinates: IBERIA,
        groupIds: ["iberian"],
        features: [feat("art-motif", rare, "step-fret motif")],
        sources: ["Garcia 2011"],
      }),
      node({
        id: "c",
        name: "Javanese batik",
        coordinates: JAVA,
        groupIds: ["javanese"],
        features: [feat("art-motif", rare, "step-fret motif")],
      }),
      ...fillers(20),
    ];

    const hyps = generateAncestorHypotheses(nodes);
    expect(hyps.length).toBe(1);
    const h = hyps[0];
    expect(h.kind).toBe("common-ancestor");
    expect(h.members.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(h.sharedTraits[0].key).toBe(rare);
    expect(h.speculative).toBe(true);
    expect(h.generated).toBe(true);
    expect(h.spreadKm).toBeGreaterThan(2000);
    expect(h.centroid).not.toBeNull();
    // Provenance is the union of members' sources.
    expect(h.provenance).toEqual(
      expect.arrayContaining(["Reindel 2009", "Garcia 2011"]),
    );
    // Framed as a lead, not a conclusion.
    expect(h.hypothesis.toLowerCase()).toContain("lead");
  });

  it("does NOT flag same-lineage clusters (expected similarity)", () => {
    const rare = "kurgan-burial";
    const nodes = [
      node({ id: "a", coordinates: IBERIA, groupIds: ["indo-european"], features: [feat("rite", rare)] }),
      node({ id: "b", coordinates: JAVA, groupIds: ["indo-european"], features: [feat("rite", rare)] }),
      node({ id: "c", coordinates: ANDES, groupIds: ["indo-european"], features: [feat("rite", rare)] }),
      ...fillers(20),
    ];
    expect(generateAncestorHypotheses(nodes)).toEqual([]);
  });

  it("does NOT flag a cluster below the member threshold", () => {
    const rare = "rare-x";
    const nodes = [
      node({ id: "a", coordinates: IBERIA, groupIds: ["x"], features: [feat("t", rare)] }),
      node({ id: "b", coordinates: JAVA, groupIds: ["y"], features: [feat("t", rare)] }),
      ...fillers(20),
    ];
    // Only 2 carriers, default minMembers = 3.
    expect(generateAncestorHypotheses(nodes)).toEqual([]);
    // Lowering the threshold surfaces the pair.
    expect(generateAncestorHypotheses(nodes, { minMembers: 2 }).length).toBe(1);
  });

  it("does NOT flag nearby cultures (spread below minSpreadKm)", () => {
    const rare = "rare-y";
    const near1 = { lat: 40, lng: 10 };
    const near2 = { lat: 40.2, lng: 10.1 };
    const near3 = { lat: 40.1, lng: 10.3 };
    const nodes = [
      node({ id: "a", coordinates: near1, groupIds: ["a"], features: [feat("t", rare)] }),
      node({ id: "b", coordinates: near2, groupIds: ["b"], features: [feat("t", rare)] }),
      node({ id: "c", coordinates: near3, groupIds: ["c"], features: [feat("t", rare)] }),
      ...fillers(20),
    ];
    expect(generateAncestorHypotheses(nodes)).toEqual([]);
  });

  it("skips a trait that is not rare (carried by many nodes)", () => {
    // "common" is shared by all fillers → low rarity → below default minRarity.
    const nodes = [
      node({ id: "a", coordinates: IBERIA, groupIds: ["a"], features: [feat("music-scale", "common")] }),
      node({ id: "b", coordinates: JAVA, groupIds: ["b"], features: [feat("music-scale", "common")] }),
      node({ id: "c", coordinates: ANDES, groupIds: ["c"], features: [feat("music-scale", "common")] }),
      ...fillers(4),
    ];
    expect(generateAncestorHypotheses(nodes)).toEqual([]);
  });

  it("gathers corroborating shared traits and scores multi-trait clusters higher", () => {
    // A/B/C share BOTH a pottery style and a haplogroup marker → "pottery + haplogroup".
    const potteryA = feat("material-category", "cord-marked", "cord-marked pottery");
    const haplo = feat("haplogroup-marker", "r1b", "Y-DNA R1b");
    const nodes = [
      node({ id: "a", coordinates: IBERIA, groupIds: ["a"], features: [potteryA, haplo], sources: ["s1"] }),
      node({ id: "b", coordinates: JAVA, groupIds: ["b"], features: [potteryA, haplo], sources: ["s2"] }),
      node({ id: "c", coordinates: ANDES, groupIds: ["c"], features: [potteryA, haplo], sources: ["s3"] }),
      // A distant single-trait cluster for contrast.
      node({ id: "d", coordinates: IBERIA, groupIds: ["d"], features: [feat("art-motif", "spiral", "spiral")] }),
      node({ id: "e", coordinates: JAVA, groupIds: ["e"], features: [feat("art-motif", "spiral", "spiral")] }),
      node({ id: "f", coordinates: ANDES, groupIds: ["f"], features: [feat("art-motif", "spiral", "spiral")] }),
      ...fillers(20),
    ];
    const hyps = generateAncestorHypotheses(nodes);
    const multi = hyps.find((h) => h.members.map((m) => m.id).join("") === "abc");
    const single = hyps.find((h) => h.members.map((m) => m.id).join("") === "def");
    expect(multi).toBeDefined();
    expect(single).toBeDefined();
    // The two-trait cluster carries both traits as evidence...
    expect(multi!.sharedTraits.map((t) => t.key).sort()).toEqual(["cord-marked", "r1b"]);
    // ...and is ranked ahead of the single-trait cluster (higher confidence).
    expect(multi!.confidence).toBeGreaterThan(single!.confidence);
    expect(hyps[0]).toBe(multi);
  });

  it("dedups clusters that share the same member set across anchoring traits", () => {
    const t1 = feat("t", "rare1");
    const t2 = feat("t", "rare2");
    const nodes = [
      node({ id: "a", coordinates: IBERIA, groupIds: ["a"], features: [t1, t2] }),
      node({ id: "b", coordinates: JAVA, groupIds: ["b"], features: [t1, t2] }),
      node({ id: "c", coordinates: ANDES, groupIds: ["c"], features: [t1, t2] }),
      ...fillers(20),
    ];
    const hyps = generateAncestorHypotheses(nodes);
    // Both rare1 and rare2 anchor the SAME {a,b,c} set → one hypothesis, two traits.
    expect(hyps.length).toBe(1);
    expect(hyps[0].sharedTraits.length).toBe(2);
  });
});

// ============================================================================
// site-location prediction
// ============================================================================

describe("sampleCorridor / nearestKnownKm", () => {
  it("adds a midpoint between each leg", () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
    ];
    const sampled = sampleCorridor(pts);
    expect(sampled).toEqual([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 5 },
      { lat: 0, lng: 10 },
    ]);
  });

  it("returns the distance to the closest known site", () => {
    const d = nearestKnownKm({ lat: 0, lng: 0 }, [
      { lat: 0, lng: 10 },
      { lat: 0, lng: 1 },
    ]);
    // ~111 km to the point 1° east.
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it("returns Infinity when there are no known sites", () => {
    expect(nearestKnownKm({ lat: 0, lng: 0 }, [])).toBe(Infinity);
  });
});

describe("predictSiteRegions", () => {
  const corridor: CorridorInput = {
    id: "silk-road",
    name: "Silk Road",
    peoples: ["Sogdians"],
    // A long empty stretch across central Asia.
    points: [
      { lat: 39.9, lng: 116.4 }, // Beijing
      { lat: 43.3, lng: 76.9 }, // Almaty
      { lat: 41.3, lng: 69.2 }, // Tashkent
      { lat: 39.6, lng: 66.9 }, // Samarkand
    ],
  };

  it("flags corridor gaps far from any known site as predicted regions", () => {
    // Known sites only near the endpoints → the middle legs are gaps.
    const known = [
      { lat: 39.9, lng: 116.4 },
      { lat: 39.6, lng: 66.9 },
    ];
    const preds = predictSiteRegions([corridor], known, { minGapKm: 300 });
    expect(preds.length).toBeGreaterThan(0);
    const p = preds[0];
    expect(p.kind).toBe("site-location");
    expect(p.speculative).toBe(true);
    expect(p.generated).toBe(true);
    expect(p.basedOn.corridorId).toBe("silk-road");
    expect(p.nearestKnownKm).toBeGreaterThanOrEqual(300);
    expect(p.uncertaintyRadiusKm).toBeGreaterThan(0);
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(0.85);
    // Bigger gap ⇒ bigger uncertainty; ranked gap-first.
    expect(preds[0].nearestKnownKm).toBeGreaterThanOrEqual(
      preds[preds.length - 1].nearestKnownKm,
    );
  });

  it("predicts nothing when every sampled corridor point is near a known site", () => {
    // A known site on every sampled point (waypoints AND leg midpoints) → no gaps.
    const preds = predictSiteRegions([corridor], sampleCorridor(corridor.points), {
      minGapKm: 300,
    });
    expect(preds).toEqual([]);
  });

  it("clamps the uncertainty radius to maxUncertaintyKm", () => {
    const preds = predictSiteRegions([corridor], [], {
      minGapKm: 100,
      maxUncertaintyKm: 150,
    });
    expect(preds.length).toBeGreaterThan(0);
    for (const p of preds) {
      expect(p.uncertaintyRadiusKm).toBeLessThanOrEqual(150);
    }
  });
});

describe("sitePredictionsToGeoJSON", () => {
  it("projects predictions into a FeatureCollection with [lng,lat] + uncertainty", () => {
    const preds = predictSiteRegions(
      [
        {
          id: "r",
          name: "Route",
          points: [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 40 },
          ],
        },
      ],
      [],
      { minGapKm: 100 },
    );
    const fc = sitePredictionsToGeoJSON(preds);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.length).toBe(preds.length);
    const f = fc.features[0];
    expect(f.geometry.type).toBe("Point");
    // GeoJSON order is [lng, lat].
    expect(f.geometry.coordinates[0]).toBe(preds[0].center.lng);
    expect(f.geometry.coordinates[1]).toBe(preds[0].center.lat);
    expect(f.properties.uncertaintyRadiusKm).toBe(preds[0].uncertaintyRadiusKm);
    expect(f.properties.speculative).toBe(true);
  });
});

// ============================================================================
// orchestrator
// ============================================================================

describe("generateHypotheses", () => {
  it("returns both families, honest stats, and the distinctness/disclaimer notes", () => {
    const nodes = [
      node({ id: "a", coordinates: IBERIA, groupIds: ["a"], features: [feat("t", "rare")] }),
      node({ id: "b", coordinates: JAVA, groupIds: ["b"], features: [feat("t", "rare")] }),
      node({ id: "c", coordinates: JAPAN, groupIds: ["c"], features: [feat("t", "rare")] }),
      ...fillers(20),
    ];
    const corridors: CorridorInput[] = [
      { id: "r", name: "Route", points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 40 }] },
    ];
    const result = generateHypotheses({ nodes, corridors, knownSites: [] });

    expect(result.ancestorHypotheses.length).toBe(1);
    expect(result.sitePredictions.length).toBeGreaterThan(0);
    expect(result.stats.clustersFound).toBe(1);
    expect(result.stats.corridorsScanned).toBe(1);
    expect(result.stats.nodesConsidered).toBe(nodes.length);
    expect(result.disclaimer).toBe(HYPOTHESIS_DISCLAIMER);
    expect(result.distinctFromCurated).toBe(DISTINCT_FROM_CURATED);
    // Every item is explicitly labeled speculative + generated.
    for (const h of result.ancestorHypotheses) {
      expect(h.speculative).toBe(true);
      expect(h.generated).toBe(true);
    }
    for (const p of result.sitePredictions) {
      expect(p.speculative).toBe(true);
      expect(p.generated).toBe(true);
    }
  });
});
