import { describe, it, expect } from "vitest";

import {
  type SitePrediction,
  confidenceTier,
  toUncertaintyCircle,
  buildUncertaintyCircles,
  overlayCenter,
} from "./site-overlay";

function pred(overrides: Partial<SitePrediction> & { id: string }): SitePrediction {
  return {
    center: { lat: 0, lng: 0 },
    uncertaintyRadiusKm: 200,
    confidence: 0.6,
    nearestKnownKm: 500,
    basedOn: { corridorId: "r", corridorName: "Route" },
    rationale: "gap",
    ...overrides,
  };
}

describe("confidenceTier", () => {
  it("buckets confidence into low/medium/high", () => {
    expect(confidenceTier(0.7)).toBe("high");
    expect(confidenceTier(0.5)).toBe("medium");
    expect(confidenceTier(0.2)).toBe("low");
  });
});

describe("toUncertaintyCircle", () => {
  it("uses [lat,lng] order and converts the uncertainty radius to meters", () => {
    const c = toUncertaintyCircle(
      pred({ id: "p", center: { lat: 39.6, lng: 66.9 }, uncertaintyRadiusKm: 250 }),
    );
    expect(c.center).toEqual([39.6, 66.9]);
    expect(c.radiusMeters).toBe(250_000);
  });

  it("encodes uncertainty: a low-confidence lead is fainter and dashed", () => {
    const high = toUncertaintyCircle(pred({ id: "h", confidence: 0.8 }));
    const low = toUncertaintyCircle(pred({ id: "l", confidence: 0.2 }));
    expect(high.tier).toBe("high");
    expect(low.tier).toBe("low");
    expect(low.dashed).toBe(true);
    expect(high.dashed).toBe(false);
    // Higher confidence ⇒ more solid fill.
    expect(high.fillOpacity).toBeGreaterThan(low.fillOpacity);
  });

  it("never produces a negative radius", () => {
    const c = toUncertaintyCircle(pred({ id: "n", uncertaintyRadiusKm: -5 }));
    expect(c.radiusMeters).toBe(0);
  });
});

describe("buildUncertaintyCircles", () => {
  it("draws the largest-uncertainty circle first (smaller ones paint on top)", () => {
    const circles = buildUncertaintyCircles([
      pred({ id: "small", uncertaintyRadiusKm: 100 }),
      pred({ id: "big", uncertaintyRadiusKm: 400 }),
      pred({ id: "mid", uncertaintyRadiusKm: 250 }),
    ]);
    expect(circles.map((c) => c.id)).toEqual(["big", "mid", "small"]);
  });
});

describe("overlayCenter", () => {
  it("averages prediction centers", () => {
    const c = overlayCenter([
      pred({ id: "a", center: { lat: 0, lng: 0 } }),
      pred({ id: "b", center: { lat: 40, lng: 20 } }),
    ]);
    expect(c).toEqual([20, 10]);
  });

  it("falls back when there are no predictions", () => {
    expect(overlayCenter([], [10, 10])).toEqual([10, 10]);
  });
});
