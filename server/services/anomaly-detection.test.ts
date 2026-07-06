import { describe, it, expect } from "vitest";

import {
  type CultureNode,
  type NodeFeature,
  computeFeaturePrevalence,
  featureRarity,
  featureKey,
  separation,
  pairAnomaly,
  detectAnomalies,
  haversineKm,
  ANOMALY_DISCLAIMER,
} from "./anomaly-detection";

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

// Rough anchors (lat/lng): Iberia (Bell Beaker origin) vs. central Java.
const IBERIA = { lat: 37, lng: -5 };
const JAVA = { lat: -7, lng: 110 };
const NEAR_IBERIA = { lat: 38, lng: -4 };

describe("haversineKm", () => {
  it("is ~0 for the same point and large across hemispheres", () => {
    expect(haversineKm(IBERIA, IBERIA)).toBeCloseTo(0, 5);
    expect(haversineKm(IBERIA, JAVA)).toBeGreaterThan(11000);
  });
});

describe("computeFeaturePrevalence / featureRarity", () => {
  it("counts each node at most once per feature", () => {
    const nodes = [
      node({ id: "a", features: [feat("music-scale", "raga"), feat("music-scale", "raga")] }),
      node({ id: "b", features: [feat("music-scale", "raga")] }),
      node({ id: "c", features: [feat("music-scale", "pelog")] }),
    ];
    const prev = computeFeaturePrevalence(nodes);
    expect(prev.get(featureKey({ type: "music-scale", key: "raga" }))).toBe(2);
    expect(prev.get(featureKey({ type: "music-scale", key: "pelog" }))).toBe(1);
  });

  it("gives rarer features higher self-information", () => {
    const rare = featureRarity(1, 100);
    const common = featureRarity(50, 100);
    expect(rare).toBeGreaterThan(common);
    expect(rare).toBeLessThanOrEqual(1);
    // A feature carried by every node is uninformative.
    expect(featureRarity(100, 100)).toBe(0);
  });
});

describe("separation", () => {
  it("uses great-circle distance when both have coordinates", () => {
    const sep = separation(
      node({ id: "a", coordinates: IBERIA }),
      node({ id: "b", coordinates: JAVA }),
    );
    expect(sep.km).not.toBeNull();
    expect(sep.km!).toBeGreaterThan(11000);
    expect(sep.distant).toBe(true);
    expect(sep.factor).toBeGreaterThan(0.5);
  });

  it("treats geographically near nodes as not-distant", () => {
    const sep = separation(
      node({ id: "a", coordinates: IBERIA }),
      node({ id: "b", coordinates: NEAR_IBERIA }),
    );
    expect(sep.distant).toBe(false);
  });

  it("falls back to region/group mismatch without coordinates", () => {
    const distant = separation(
      node({ id: "a", region: "Europe", groupIds: ["ie"] }),
      node({ id: "b", region: "Oceania", groupIds: ["austronesian"] }),
    );
    expect(distant.km).toBeNull();
    expect(distant.distant).toBe(true);

    const sameRegion = separation(
      node({ id: "a", region: "Europe" }),
      node({ id: "b", region: "Europe" }),
    );
    expect(sameRegion.distant).toBe(false);
  });
});

describe("pairAnomaly", () => {
  const total = 100;
  const prev = new Map<string, number>([
    [featureKey({ type: "music-scale", key: "slendro" }), 2], // rare
    [featureKey({ type: "music-scale", key: "pentatonic" }), 90], // common
    [featureKey({ type: "material-category", key: "pottery" }), 100], // universal
  ]);

  it("flags a rare shared trait across great distance as high surprise", () => {
    const a = node({ id: "a", name: "Iberian", coordinates: IBERIA, features: [feat("music-scale", "slendro", "slendro scale")] });
    const b = node({ id: "b", name: "Javanese", coordinates: JAVA, features: [feat("music-scale", "slendro", "slendro scale")] });
    const anomaly = pairAnomaly(a, b, prev, total);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.surpriseScore).toBeGreaterThan(0.4);
    expect(anomaly!.sharedFeatures).toHaveLength(1);
    expect(anomaly!.sharedFeatures[0].key).toBe("slendro");
    expect(anomaly!.speculative).toBe(true);
    expect(anomaly!.hypothesis).toContain("Iberian");
    expect(anomaly!.hypothesis).toContain("Javanese");
  });

  it("returns null when nodes share a language/lineage group (expected)", () => {
    const a = node({ id: "a", coordinates: IBERIA, groupIds: ["ie"], features: [feat("music-scale", "slendro")] });
    const b = node({ id: "b", coordinates: JAVA, groupIds: ["ie"], features: [feat("music-scale", "slendro")] });
    expect(pairAnomaly(a, b, prev, total)).toBeNull();
  });

  it("returns null for a nearby (expected) similarity", () => {
    const a = node({ id: "a", coordinates: IBERIA, features: [feat("music-scale", "slendro")] });
    const b = node({ id: "b", coordinates: NEAR_IBERIA, features: [feat("music-scale", "slendro")] });
    expect(pairAnomaly(a, b, prev, total)).toBeNull();
  });

  it("ignores universal features (no surprise) and returns null when only those are shared", () => {
    const a = node({ id: "a", coordinates: IBERIA, features: [feat("material-category", "pottery")] });
    const b = node({ id: "b", coordinates: JAVA, features: [feat("material-category", "pottery")] });
    expect(pairAnomaly(a, b, prev, total)).toBeNull();
  });

  it("surfaces provenance from both nodes and raises confidence with citations", () => {
    const a = node({ id: "a", coordinates: IBERIA, sources: ["Smith 1990"], features: [feat("music-scale", "slendro")] });
    const b = node({ id: "b", coordinates: JAVA, sources: ["Jones 2001", "Smith 1990"], features: [feat("music-scale", "slendro")] });
    const anomaly = pairAnomaly(a, b, prev, total)!;
    expect(anomaly.provenance).toEqual(["Smith 1990", "Jones 2001"]); // deduped, order-preserving
    expect(anomaly.confidence).toBeGreaterThan(0.5);
  });

  it("respects the minSurprise threshold", () => {
    const a = node({ id: "a", coordinates: IBERIA, features: [feat("music-scale", "slendro")] });
    const b = node({ id: "b", coordinates: JAVA, features: [feat("music-scale", "slendro")] });
    expect(pairAnomaly(a, b, prev, total, { minSurprise: 0.99 })).toBeNull();
  });
});

describe("detectAnomalies", () => {
  it("ranks by surprise, excludes expected pairs, and caps to limit", () => {
    // slendro is rare (2/N); pentatonic is common. Many filler nodes make the
    // corpus large enough that rarity separates the two shared-trait pairs.
    const fillers: CultureNode[] = [];
    for (let i = 0; i < 20; i++) {
      fillers.push(
        node({
          id: `f${i}`,
          coordinates: { lat: 10 + i, lng: 10 + i },
          features: [feat("music-scale", "pentatonic")],
        }),
      );
    }
    const rareA = node({ id: "rareA", name: "Iberian", coordinates: IBERIA, features: [feat("music-scale", "slendro", "slendro")] });
    const rareB = node({ id: "rareB", name: "Javanese", coordinates: JAVA, features: [feat("music-scale", "slendro", "slendro")] });
    // Expected pair — same group — must be excluded even though distant + shared.
    const expA = node({ id: "expA", coordinates: IBERIA, groupIds: ["fam"], features: [feat("music-scale", "gamut", "gamut")] });
    const expB = node({ id: "expB", coordinates: JAVA, groupIds: ["fam"], features: [feat("music-scale", "gamut", "gamut")] });

    const result = detectAnomalies([...fillers, rareA, rareB, expA, expB], { limit: 5 });

    expect(result.disclaimer).toBe(ANOMALY_DISCLAIMER);
    expect(result.stats.nodesConsidered).toBe(24);
    // The rare cross-hemisphere pair is the top anomaly.
    expect(result.anomalies[0].sharedFeatures[0].key).toBe("slendro");
    // The same-group pair is never reported.
    const ids = result.anomalies.flatMap((a) => [a.entityA.id, a.entityB.id]);
    expect(ids).not.toContain("expA");
    expect(ids).not.toContain("expB");
    expect(result.anomalies.length).toBeLessThanOrEqual(5);
  });

  it("returns no anomalies for an all-similar, co-located corpus", () => {
    const nodes = [0, 1, 2].map((i) =>
      node({
        id: `n${i}`,
        coordinates: { lat: 40 + i * 0.1, lng: 0 },
        features: [feat("music-scale", "pentatonic")],
      }),
    );
    const result = detectAnomalies(nodes);
    expect(result.anomalies).toHaveLength(0);
  });
});
