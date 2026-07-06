import { describe, it, expect } from "vitest";
import {
  validateGeometry,
  serializeGeometry,
  validateDrawnGeometry,
  drawnGeometryToContribution,
  DRAWN_PROVENANCE,
  type DrawnGeometryInput,
  type DrawnPolygon,
  type DrawnLineString,
} from "./drawn-geometry";

// A closed square ring around a point in the Mediterranean, [lng, lat] order.
const SQUARE: DrawnPolygon = {
  type: "Polygon",
  coordinates: [[[0, 40], [2, 40], [2, 42], [0, 42], [0, 40]]],
};

const LINE: DrawnLineString = {
  type: "LineString",
  coordinates: [[108.94, 34.26], [105, 36], [95, 38]],
};

function validInput(overrides: Partial<DrawnGeometryInput> = {}): DrawnGeometryInput {
  return {
    geometry: SQUARE,
    target: "boundary",
    name: "Test boundary",
    associatedEntityId: "roman-empire",
    timePeriodStart: -200,
    timePeriodEnd: 400,
    ...overrides,
  };
}

describe("validateGeometry", () => {
  it("accepts a closed polygon ring within world bounds", () => {
    expect(validateGeometry(SQUARE).valid).toBe(true);
  });

  it("accepts a LineString with >= 2 positions", () => {
    expect(validateGeometry(LINE).valid).toBe(true);
  });

  it("rejects an unclosed polygon ring", () => {
    const open: DrawnPolygon = {
      type: "Polygon",
      coordinates: [[[0, 40], [2, 40], [2, 42], [0, 42]]],
    };
    const result = validateGeometry(open);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /not closed/.test(e))).toBe(true);
  });

  it("rejects a polygon ring with too few positions", () => {
    const tiny: DrawnPolygon = { type: "Polygon", coordinates: [[[0, 40], [1, 41], [0, 40]]] };
    expect(validateGeometry(tiny).valid).toBe(false);
  });

  it("rejects a LineString with a single position", () => {
    const single: DrawnLineString = { type: "LineString", coordinates: [[0, 0]] };
    expect(validateGeometry(single).valid).toBe(false);
  });

  it("rejects out-of-bounds coordinates", () => {
    const bad: DrawnLineString = { type: "LineString", coordinates: [[0, 0], [200, 95]] };
    const result = validateGeometry(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /world bounds/.test(e))).toBe(true);
  });

  it("rejects unsupported geometry types", () => {
    expect(validateGeometry({ type: "Point", coordinates: [0, 0] }).valid).toBe(false);
  });

  it("rejects a non-object geometry", () => {
    expect(validateGeometry(null).valid).toBe(false);
    expect(validateGeometry("nope").valid).toBe(false);
  });
});

describe("serializeGeometry", () => {
  it("produces canonical GeoJSON JSON preserving [lng, lat] order", () => {
    const str = serializeGeometry(SQUARE);
    expect(str).toBe('{"type":"Polygon","coordinates":[[[0,40],[2,40],[2,42],[0,42],[0,40]]]}');
    // Round-trips back to the original geometry.
    expect(JSON.parse(str)).toEqual(SQUARE);
  });

  it("serializes a LineString losslessly", () => {
    expect(JSON.parse(serializeGeometry(LINE))).toEqual(LINE);
  });
});

describe("validateDrawnGeometry", () => {
  it("accepts a well-formed polygon submission", () => {
    const result = validateDrawnGeometry(validInput());
    expect(result.valid).toBe(true);
  });

  it("accepts a well-formed line submission for a route target", () => {
    const result = validateDrawnGeometry(
      validInput({ geometry: LINE, target: "trade-route", associatedEntityId: "tr-001" }),
    );
    expect(result.valid).toBe(true);
  });

  it("requires an associated entity", () => {
    const result = validateDrawnGeometry(validInput({ associatedEntityId: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /associatedEntityId/.test(e))).toBe(true);
  });

  it("requires a name", () => {
    const result = validateDrawnGeometry(validInput({ name: "  " }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /name is required/.test(e))).toBe(true);
  });

  it("requires a start year", () => {
    const result = validateDrawnGeometry(validInput({ timePeriodStart: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /timePeriodStart/.test(e))).toBe(true);
  });

  it("rejects an inverted time range", () => {
    const result = validateDrawnGeometry(validInput({ timePeriodStart: 400, timePeriodEnd: -200 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /inverted range/.test(e))).toBe(true);
  });

  it("allows an omitted end year (point in time)", () => {
    expect(validateDrawnGeometry(validInput({ timePeriodEnd: null })).valid).toBe(true);
  });

  it("rejects a geometry type that does not match the target", () => {
    // A polygon target given a LineString.
    const result = validateDrawnGeometry(validInput({ geometry: LINE }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /expects a Polygon/.test(e))).toBe(true);
  });

  it("rejects an unknown target", () => {
    const result = validateDrawnGeometry(validInput({ target: "banana" as never }));
    expect(result.valid).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    expect(validateDrawnGeometry(validInput({ confidence: 0 })).valid).toBe(false);
    expect(validateDrawnGeometry(validInput({ confidence: 101 })).valid).toBe(false);
  });
});

describe("drawnGeometryToContribution", () => {
  it("marks provenance source='user-drawn' and stores the geometry", () => {
    const contrib = drawnGeometryToContribution(validInput());
    expect(contrib.entityType).toBe("boundary");
    expect(contrib.action).toBe("add");
    expect(contrib.entityData?.source).toBe(DRAWN_PROVENANCE);
    expect(contrib.entityData?.geometry).toEqual(SQUARE);
    expect(contrib.entityData?.geometrySerialized).toBe(serializeGeometry(SQUARE));
    expect(contrib.entityId).toBe("roman-empire");
  });

  it("carries the time range onto the contribution", () => {
    const contrib = drawnGeometryToContribution(validInput());
    expect(contrib.entityData?.timePeriodStart).toBe(-200);
    expect(contrib.entityData?.timePeriodEnd).toBe(400);
  });

  it("defaults a synthetic source and confidence for hand-drawn geometry", () => {
    const contrib = drawnGeometryToContribution(validInput());
    expect(contrib.sources).toEqual([{ title: "User-drawn geometry" }]);
    expect(contrib.confidence).toBe(60);
  });

  it("mirrors the associated entity into languageId for a language-range target", () => {
    const contrib = drawnGeometryToContribution(
      validInput({ target: "language-range", associatedEntityId: "eng" }),
    );
    expect(contrib.entityData?.languageId).toBe("eng");
  });

  it("records the polyline drawing mode for line geometry", () => {
    const contrib = drawnGeometryToContribution(
      validInput({ geometry: LINE, target: "migration-route", associatedEntityId: "out-of-africa" }),
    );
    expect(contrib.entityData?.drawingMode).toBe("polyline");
  });
});
