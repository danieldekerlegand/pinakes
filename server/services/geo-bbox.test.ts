import { describe, it, expect } from "vitest";
import {
  parseBbox,
  parseNonNegativeInt,
  geometryBounds,
  bboxIntersects,
  featureIntersectsBbox,
  filterByBbox,
  applyViewport,
  viewportOptionsFromQuery,
  type Bbox,
} from "./geo-bbox";

const VIEWPORT: Bbox = { west: 0, south: 0, east: 10, north: 10 };

const point = (lng: number, lat: number) => ({
  type: "Feature" as const,
  geometry: { type: "Point", coordinates: [lng, lat] },
});

const polygon = (ring: number[][]) => ({
  type: "Feature" as const,
  geometry: { type: "Polygon", coordinates: [ring] },
});

describe("parseBbox", () => {
  it("parses a well-formed west,south,east,north string", () => {
    expect(parseBbox("0,0,10,20")).toEqual({ west: 0, south: 0, east: 10, north: 20 });
  });

  it("normalizes swapped corners", () => {
    expect(parseBbox("10,20,0,0")).toEqual({ west: 0, south: 0, east: 10, north: 20 });
  });

  it("tolerates whitespace and negatives", () => {
    expect(parseBbox(" -5 , -3 , 5 , 3 ")).toEqual({ west: -5, south: -3, east: 5, north: 3 });
  });

  it("returns undefined for malformed / missing input", () => {
    expect(parseBbox(undefined)).toBeUndefined();
    expect(parseBbox("")).toBeUndefined();
    expect(parseBbox("1,2,3")).toBeUndefined();
    expect(parseBbox("a,b,c,d")).toBeUndefined();
    expect(parseBbox("1,2,3,NaN")).toBeUndefined();
  });
});

describe("parseNonNegativeInt", () => {
  it("parses valid non-negative integers", () => {
    expect(parseNonNegativeInt("0")).toBe(0);
    expect(parseNonNegativeInt("42")).toBe(42);
  });
  it("rejects negatives, fractions, and garbage", () => {
    expect(parseNonNegativeInt("-1")).toBeUndefined();
    expect(parseNonNegativeInt("1.5")).toBeUndefined();
    expect(parseNonNegativeInt("x")).toBeUndefined();
    expect(parseNonNegativeInt("")).toBeUndefined();
    expect(parseNonNegativeInt(undefined)).toBeUndefined();
  });
});

describe("geometryBounds", () => {
  it("computes point bounds", () => {
    expect(geometryBounds({ type: "Point", coordinates: [3, 4] })).toEqual({
      west: 3,
      south: 4,
      east: 3,
      north: 4,
    });
  });

  it("computes polygon bounds", () => {
    const bounds = geometryBounds({
      type: "Polygon",
      coordinates: [[[1, 2], [5, 2], [5, 8], [1, 8], [1, 2]]],
    });
    expect(bounds).toEqual({ west: 1, south: 2, east: 5, north: 8 });
  });

  it("computes multipolygon bounds", () => {
    const bounds = geometryBounds({
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 0]]],
        [[[8, 8], [9, 8], [9, 9], [8, 8]]],
      ],
    });
    expect(bounds).toEqual({ west: 0, south: 0, east: 9, north: 9 });
  });

  it("descends into GeometryCollection", () => {
    const bounds = geometryBounds({
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [1, 1] },
        { type: "Point", coordinates: [7, 9] },
      ],
    });
    expect(bounds).toEqual({ west: 1, south: 1, east: 7, north: 9 });
  });

  it("returns null for empty / missing geometry", () => {
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("bboxIntersects", () => {
  it("detects overlap and edge-touch (inclusive)", () => {
    expect(bboxIntersects(VIEWPORT, { west: 5, south: 5, east: 15, north: 15 })).toBe(true);
    expect(bboxIntersects(VIEWPORT, { west: 10, south: 10, east: 20, north: 20 })).toBe(true);
  });
  it("detects disjoint", () => {
    expect(bboxIntersects(VIEWPORT, { west: 20, south: 20, east: 30, north: 30 })).toBe(false);
  });
});

describe("featureIntersectsBbox", () => {
  it("keeps a point inside the viewport", () => {
    expect(featureIntersectsBbox(point(5, 5), VIEWPORT)).toBe(true);
  });
  it("drops a point outside the viewport", () => {
    expect(featureIntersectsBbox(point(50, 50), VIEWPORT)).toBe(false);
  });
  it("keeps a large polygon that straddles the viewport even if all vertices are outside", () => {
    const straddling = polygon([[-5, -5], [15, -5], [15, 15], [-5, 15], [-5, -5]]);
    expect(featureIntersectsBbox(straddling, VIEWPORT)).toBe(true);
  });
  it("keeps geometry-less features (never silently dropped)", () => {
    expect(featureIntersectsBbox({ geometry: null }, VIEWPORT)).toBe(true);
  });
});

describe("filterByBbox", () => {
  const features = [point(5, 5), point(50, 50), point(1, 1), point(-30, -30)];

  it("returns only intersecting features", () => {
    const kept = filterByBbox(features, VIEWPORT);
    expect(kept).toHaveLength(2);
    expect(kept).toEqual([point(5, 5), point(1, 1)]);
  });

  it("is a no-op with no bbox", () => {
    expect(filterByBbox(features, undefined)).toHaveLength(4);
  });
});

describe("applyViewport", () => {
  const features = Array.from({ length: 25 }, (_, i) => point(i, i));

  it("returns everything (with counts) when unfiltered/unpaginated", () => {
    const { features: out, meta } = applyViewport(features);
    expect(out).toHaveLength(25);
    expect(meta).toMatchObject({ total: 25, returned: 25, offset: 0, limit: null, hasMore: false, bbox: null });
  });

  it("filters by bbox", () => {
    const { features: out, meta } = applyViewport(features, { bbox: { west: 0, south: 0, east: 4, north: 4 } });
    expect(out).toHaveLength(5); // points (0,0)..(4,4)
    expect(meta.total).toBe(5);
    expect(meta.hasMore).toBe(false);
  });

  it("paginates with limit/offset and reports hasMore", () => {
    const first = applyViewport(features, { limit: 10, offset: 0 });
    expect(first.features).toHaveLength(10);
    expect(first.meta).toMatchObject({ total: 25, returned: 10, offset: 0, limit: 10, hasMore: true });

    const last = applyViewport(features, { limit: 10, offset: 20 });
    expect(last.features).toHaveLength(5);
    expect(last.meta.hasMore).toBe(false);
  });

  it("combines bbox filtering with pagination (pagination applies post-filter)", () => {
    const { features: out, meta } = applyViewport(features, {
      bbox: { west: 0, south: 0, east: 9, north: 9 },
      limit: 3,
      offset: 0,
    });
    expect(meta.total).toBe(10); // points (0,0)..(9,9)
    expect(out).toHaveLength(3);
    expect(meta.hasMore).toBe(true);
  });

  it("supports offset without limit", () => {
    const { features: out, meta } = applyViewport(features, { offset: 23 });
    expect(out).toHaveLength(2);
    expect(meta.hasMore).toBe(false);
    expect(meta.limit).toBeNull();
  });
});

describe("viewportOptionsFromQuery", () => {
  it("builds options from raw string query params", () => {
    const opts = viewportOptionsFromQuery({ bbox: "0,0,10,10", limit: "50", offset: "10" });
    expect(opts.bbox).toEqual(VIEWPORT);
    expect(opts.limit).toBe(50);
    expect(opts.offset).toBe(10);
  });

  it("ignores array/garbage params", () => {
    const opts = viewportOptionsFromQuery({ bbox: ["0,0,10,10"], limit: "x", offset: -1 });
    expect(opts.bbox).toBeUndefined();
    expect(opts.limit).toBeUndefined();
    expect(opts.offset).toBeUndefined();
  });
});
