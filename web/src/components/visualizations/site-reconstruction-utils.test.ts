import { describe, it, expect } from "vitest";
import {
  SiteStructure,
  computeBoxFaces,
  computeSceneBounds,
  detectFindingKinds,
  faceFillColor,
  formatPeriod,
  formatSiteType,
  formatYear,
  generateBlueprint,
  isFaceVisible,
  pointsToSvg,
  projectIso,
  shadeColor,
  siteTypeColor,
  sortFacesForRender,
} from "./site-reconstruction-utils";

describe("projectIso", () => {
  it("projects the origin to (0, 0)", () => {
    const p = projectIso(0, 0, 0, 0, 1);
    expect(p.sx).toBeCloseTo(0, 6);
    expect(p.sy).toBeCloseTo(0, 6);
  });

  it("projects +X axis to lower-right in SVG coords", () => {
    const p = projectIso(1, 0, 0, 0, 1);
    expect(p.sx).toBeGreaterThan(0);
    expect(p.sy).toBeGreaterThan(0);
  });

  it("projects +Y axis to lower-left in SVG coords", () => {
    const p = projectIso(0, 1, 0, 0, 1);
    expect(p.sx).toBeLessThan(0);
    expect(p.sy).toBeGreaterThan(0);
  });

  it("projects +Z axis to straight up in SVG coords (sy negative)", () => {
    const p = projectIso(0, 0, 1, 0, 1);
    expect(p.sx).toBeCloseTo(0, 6);
    expect(p.sy).toBeCloseTo(-1, 6);
  });

  it("scales linearly with the unit multiplier", () => {
    const base = projectIso(1, 1, 0, 0, 1);
    const scaled = projectIso(1, 1, 0, 0, 3);
    expect(scaled.sx).toBeCloseTo(base.sx * 3, 6);
    expect(scaled.sy).toBeCloseTo(base.sy * 3, 6);
  });

  it("treats yaw rotation as pre-projection rotation around +Z", () => {
    // Rotating the point (1, 0, 0) by -90° around +Z gives (0, -1, 0).
    // Projecting the rotated point at yaw 0 should match projecting the
    // original at yaw -90°.
    const rotated = projectIso(0, -1, 0, 0, 1);
    const atYaw = projectIso(1, 0, 0, -90, 1);
    expect(atYaw.sx).toBeCloseTo(rotated.sx, 6);
    expect(atYaw.sy).toBeCloseTo(rotated.sy, 6);
  });

  it("wraps around so that a yaw of 360° matches yaw 0°", () => {
    const a = projectIso(1.5, 0.7, 0.4, 0, 1);
    const b = projectIso(1.5, 0.7, 0.4, 360, 1);
    expect(a.sx).toBeCloseTo(b.sx, 6);
    expect(a.sy).toBeCloseTo(b.sy, 6);
  });
});

describe("isFaceVisible", () => {
  it("always reports the top face visible", () => {
    for (let yaw = -180; yaw <= 180; yaw += 30) {
      expect(isFaceVisible("top", yaw)).toBe(true);
    }
  });

  it("never reports the bottom face visible", () => {
    for (let yaw = -180; yaw <= 180; yaw += 30) {
      expect(isFaceVisible("bottom", yaw)).toBe(false);
    }
  });

  it("reports +X and +Y visible at yaw 0", () => {
    expect(isFaceVisible("+X", 0)).toBe(true);
    expect(isFaceVisible("+Y", 0)).toBe(true);
    expect(isFaceVisible("-X", 0)).toBe(false);
    expect(isFaceVisible("-Y", 0)).toBe(false);
  });

  it("swaps visible vertical faces at yaw 90", () => {
    expect(isFaceVisible("+X", 90)).toBe(true);
    expect(isFaceVisible("+Y", 90)).toBe(false);
    expect(isFaceVisible("-Y", 90)).toBe(true);
  });
});

describe("computeBoxFaces", () => {
  const unitCube: SiteStructure = {
    id: "cube",
    kind: "block",
    x: 0,
    y: 0,
    z: 0,
    w: 1,
    d: 1,
    h: 1,
    color: "#aabbcc",
  };

  it("returns exactly 3 visible faces for a yaw-0 unit cube (top + 2 sides)", () => {
    const faces = computeBoxFaces(unitCube, 0, 1);
    expect(faces).toHaveLength(3);
    const kinds = faces.map((f) => f.face).sort();
    expect(kinds).toEqual(["+X", "+Y", "top"]);
  });

  it("each visible face has 4 projected corner points", () => {
    const faces = computeBoxFaces(unitCube, 0, 1);
    for (const f of faces) expect(f.points).toHaveLength(4);
  });

  it("the top face of a taller cube sits higher (more negative sy) than a shorter one", () => {
    const tall: SiteStructure = { ...unitCube, id: "tall", h: 3 };
    const short: SiteStructure = { ...unitCube, id: "short", h: 1 };
    const tallTop = computeBoxFaces(tall, 0, 1).find((f) => f.face === "top")!;
    const shortTop = computeBoxFaces(short, 0, 1).find((f) => f.face === "top")!;
    const tallSy = tallTop.points.reduce((a, p) => a + p.sy, 0) / 4;
    const shortSy = shortTop.points.reduce((a, p) => a + p.sy, 0) / 4;
    expect(tallSy).toBeLessThan(shortSy);
  });

  it("assigns appropriate shade category per face", () => {
    const faces = computeBoxFaces(unitCube, 0, 1);
    const byFace = Object.fromEntries(faces.map((f) => [f.face, f.shade]));
    expect(byFace.top).toBe("top");
    expect(byFace["+X"]).toBe("right");
    expect(byFace["+Y"]).toBe("left");
  });
});

describe("sortFacesForRender", () => {
  it("sorts ascending by depth (far first)", () => {
    const faces = [
      { id: "a", face: "top" as const, points: [], depth: 5, color: "#fff", shade: "top" as const },
      { id: "b", face: "top" as const, points: [], depth: 1, color: "#fff", shade: "top" as const },
      { id: "c", face: "top" as const, points: [], depth: 3, color: "#fff", shade: "top" as const },
    ];
    const sorted = sortFacesForRender(faces);
    expect(sorted.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const faces = [
      { id: "a", face: "top" as const, points: [], depth: 5, color: "#fff", shade: "top" as const },
      { id: "b", face: "top" as const, points: [], depth: 1, color: "#fff", shade: "top" as const },
    ];
    const before = faces.map((f) => f.id);
    sortFacesForRender(faces);
    expect(faces.map((f) => f.id)).toEqual(before);
  });
});

describe("shadeColor", () => {
  it("returns the original color for amount = 0", () => {
    expect(shadeColor("#808080", 0)).toBe("#808080");
  });

  it("darkens when amount is negative", () => {
    const result = shadeColor("#808080", -0.5);
    const v = parseInt(result.slice(1, 3), 16);
    expect(v).toBeLessThan(0x80);
  });

  it("lightens when amount is positive", () => {
    const result = shadeColor("#808080", 0.5);
    const v = parseInt(result.slice(1, 3), 16);
    expect(v).toBeGreaterThan(0x80);
  });

  it("clamps to valid hex range", () => {
    expect(shadeColor("#000000", -1)).toBe("#000000");
    expect(shadeColor("#ffffff", 1)).toBe("#ffffff");
  });

  it("returns input unchanged for malformed hex", () => {
    expect(shadeColor("not-a-color", -0.2)).toBe("not-a-color");
  });
});

describe("faceFillColor", () => {
  it("returns base color for top face", () => {
    expect(faceFillColor("#808080", "top")).toBe("#808080");
  });

  it("returns a darker color for left and right faces", () => {
    const base = "#aaaaaa";
    const right = faceFillColor(base, "right");
    const left = faceFillColor(base, "left");
    const pick = (c: string) => parseInt(c.slice(1, 3), 16);
    expect(pick(right)).toBeLessThan(pick(base));
    expect(pick(left)).toBeLessThan(pick(right));
  });
});

describe("detectFindingKinds", () => {
  it("detects palace mentions", () => {
    expect(detectFindingKinds(["Royal palace"])).toContain("palace");
  });

  it("detects wall/fortification keywords", () => {
    expect(detectFindingKinds(["Massive ramparts"])).toContain("wall");
    expect(detectFindingKinds(["Fortified walls"])).toContain("wall");
  });

  it("detects multiple kinds at once", () => {
    const kinds = detectFindingKinds([
      "Great pyramid",
      "Altar stones",
      "Defensive walls",
    ]);
    expect(kinds).toContain("pyramid");
    expect(kinds).toContain("temple");
    expect(kinds).toContain("wall");
  });

  it("returns empty array when nothing matches", () => {
    expect(detectFindingKinds(["Clay pottery"])).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(detectFindingKinds(["TEMPLE", "Palace"])).toEqual(
      expect.arrayContaining(["temple", "palace"]),
    );
  });
});

describe("generateBlueprint", () => {
  it("returns at least one structure for every site type", () => {
    const types = [
      "settlement",
      "burial",
      "temple",
      "fortification",
      "workshop",
      "ceremonial",
      "unknown",
    ] as const;
    for (const t of types) {
      expect(generateBlueprint(t, [], 50).length).toBeGreaterThan(0);
    }
  });

  it("produces a stepped pyramid for a burial site with pyramid findings", () => {
    const structures = generateBlueprint("burial", ["Stepped pyramid"], 80);
    const stepCount = structures.filter((s) => s.kind === "pyramid-step").length;
    expect(stepCount).toBeGreaterThanOrEqual(3);
  });

  it("produces walls + corner towers for a fortification", () => {
    const structures = generateBlueprint("fortification", [], 50);
    const walls = structures.filter((s) => s.kind === "wall");
    const towers = structures.filter((s) => s.kind === "tower");
    expect(walls.length).toBeGreaterThanOrEqual(4);
    expect(towers.length).toBeGreaterThanOrEqual(4);
  });

  it("adds a keep to a fortification when findings mention a palace", () => {
    const bare = generateBlueprint("fortification", [], 50);
    const withPalace = generateBlueprint("fortification", ["Royal palace"], 50);
    expect(bare.find((s) => s.kind === "keep")).toBeUndefined();
    expect(withPalace.find((s) => s.kind === "keep")).toBeDefined();
  });

  it("scales structure dimensions with importance", () => {
    const low = generateBlueprint("temple", [], 0);
    const high = generateBlueprint("temple", [], 100);
    const lowCella = low.find((s) => s.kind === "cella")!;
    const highCella = high.find((s) => s.kind === "cella")!;
    expect(highCella.w).toBeGreaterThan(lowCella.w);
    expect(highCella.h).toBeGreaterThan(lowCella.h);
  });

  it("is deterministic for identical inputs", () => {
    const a = generateBlueprint("settlement", ["Market plaza"], 60);
    const b = generateBlueprint("settlement", ["Market plaza"], 60);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("computeSceneBounds", () => {
  it("returns defaults for an empty scene", () => {
    const b = computeSceneBounds([], 0);
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });

  it("covers all structure corners", () => {
    const structures = generateBlueprint("temple", [], 50);
    const b = computeSceneBounds(structures, 0);
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });
});

describe("pointsToSvg", () => {
  it("formats points with two decimal places", () => {
    const s = pointsToSvg([
      { sx: 1.234, sy: 2.5678 },
      { sx: 0, sy: 0 },
    ]);
    expect(s).toBe("1.23,2.57 0.00,0.00");
  });
});

describe("formatYear / formatPeriod", () => {
  it("formats BCE years", () => {
    expect(formatYear(-1500)).toBe("1500 BCE");
  });

  it("formats CE years", () => {
    expect(formatYear(79)).toBe("79 CE");
  });

  it("renders 'present' when end is null", () => {
    expect(formatPeriod(-500, null)).toBe("500 BCE – present");
  });
});

describe("siteTypeColor & formatSiteType", () => {
  it("returns a distinct color for known site types", () => {
    const colors = new Set([
      siteTypeColor("settlement"),
      siteTypeColor("temple"),
      siteTypeColor("burial"),
      siteTypeColor("fortification"),
    ]);
    expect(colors.size).toBe(4);
  });

  it("capitalizes the site type label", () => {
    expect(formatSiteType("temple")).toBe("Temple");
    expect(formatSiteType("fortification")).toBe("Fortification");
  });
});
