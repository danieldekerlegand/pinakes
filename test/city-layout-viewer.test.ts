import { describe, it, expect } from "vitest";
import { TsvStorage } from "../server/tsv-storage";
import {
  computeSchematic,
  formatFeatureLabel,
  getFeatureColor,
  getFeatureDescription,
  getLayoutDescription,
  FEATURE_COLORS,
  FEATURE_DESCRIPTIONS,
  LAYOUT_TYPE_DESCRIPTIONS,
  type CityLayoutData,
} from "../web/src/components/visualizations/city-layout-utils";

// --- Pure utility function tests ---

describe("CityLayoutViewer - utility helpers", () => {
  describe("formatFeatureLabel", () => {
    it("converts snake_case to title case", () => {
      expect(formatFeatureLabel("temple_precinct")).toBe("Temple Precinct");
      expect(formatFeatureLabel("residential_quarter")).toBe(
        "Residential Quarter",
      );
    });

    it("handles single-word features", () => {
      expect(formatFeatureLabel("palace")).toBe("Palace");
    });
  });

  describe("getFeatureColor", () => {
    it("returns a registered color for known features", () => {
      expect(getFeatureColor("temple_precinct")).toBe(
        FEATURE_COLORS.temple_precinct,
      );
      expect(getFeatureColor("walls")).toBe(FEATURE_COLORS.walls);
    });

    it("falls back to a neutral color for unknown features", () => {
      expect(getFeatureColor("mystery_feature")).toBe("#94a3b8");
    });
  });

  describe("getFeatureDescription", () => {
    it("returns the canonical description for known features", () => {
      expect(getFeatureDescription("palace")).toBe(FEATURE_DESCRIPTIONS.palace);
    });

    it("returns a non-empty fallback for unknown features", () => {
      const desc = getFeatureDescription("unknown_feature");
      expect(desc).toBeTruthy();
      expect(desc.length).toBeGreaterThan(5);
    });
  });

  describe("getLayoutDescription", () => {
    it("returns canonical layout description for known types", () => {
      expect(getLayoutDescription("grid")).toBe(
        LAYOUT_TYPE_DESCRIPTIONS.grid,
      );
      expect(getLayoutDescription("canal-based")).toBe(
        LAYOUT_TYPE_DESCRIPTIONS["canal-based"],
      );
    });

    it("handles case-insensitive lookups", () => {
      expect(getLayoutDescription("GRID")).toBe(
        LAYOUT_TYPE_DESCRIPTIONS.grid,
      );
      expect(getLayoutDescription("Citadel")).toBe(
        LAYOUT_TYPE_DESCRIPTIONS.citadel,
      );
    });

    it("returns a non-empty fallback for unknown layouts", () => {
      expect(getLayoutDescription("teleported").length).toBeGreaterThan(5);
    });
  });
});

// --- Schematic computation ---

describe("CityLayoutViewer - computeSchematic", () => {
  const baseLayout: CityLayoutData = {
    id: "cl-test-001",
    layoutType: "grid",
    keyFeatures: ["temple_precinct", "palace", "market", "residential_quarter"],
  };

  it("produces a zone for each non-infrastructure feature", () => {
    const geo = computeSchematic(baseLayout);
    expect(geo.zones).toHaveLength(4);
    expect(geo.zones.map((z) => z.feature).sort()).toEqual(
      ["market", "palace", "residential_quarter", "temple_precinct"].sort(),
    );
  });

  it("excludes walls, gates, aqueduct, and sewers from zones", () => {
    const geo = computeSchematic({
      ...baseLayout,
      keyFeatures: [
        "temple_precinct",
        "palace",
        "walls",
        "gates",
        "aqueduct",
        "sewers",
      ],
    });
    const features = geo.zones.map((z) => z.feature);
    expect(features).not.toContain("walls");
    expect(features).not.toContain("gates");
    expect(features).not.toContain("aqueduct");
    expect(features).not.toContain("sewers");
    expect(features).toContain("temple_precinct");
    expect(features).toContain("palace");
  });

  it("renders a rectangular boundary when walls are present", () => {
    const geo = computeSchematic({
      ...baseLayout,
      keyFeatures: [...baseLayout.keyFeatures, "walls"],
      fortificationType: "stone curtain wall",
    });
    expect(geo.boundary).toBeDefined();
    expect(geo.boundary?.shape).toBe("rect");
    expect(geo.boundary?.label).toBe("stone curtain wall");
  });

  it("uses a default label when walls have no fortification type", () => {
    const geo = computeSchematic({
      ...baseLayout,
      keyFeatures: [...baseLayout.keyFeatures, "walls"],
    });
    expect(geo.boundary?.label).toBe("City Walls");
  });

  it("omits the boundary when no walls are declared", () => {
    const geo = computeSchematic(baseLayout);
    expect(geo.boundary).toBeUndefined();
  });

  it("places four gate markers along the boundary when gates are present", () => {
    const geo = computeSchematic({
      ...baseLayout,
      keyFeatures: [...baseLayout.keyFeatures, "walls", "gates"],
    });
    expect(geo.gates).toBeDefined();
    expect(geo.gates!.length).toBe(4);
  });

  it("produces canal decorations for canal-based layouts", () => {
    const geo = computeSchematic({
      ...baseLayout,
      layoutType: "canal-based",
    });
    const canals = geo.decorations.filter((d) => d.type === "canal");
    expect(canals.length).toBeGreaterThanOrEqual(2);
  });

  it("produces an aqueduct decoration when the aqueduct feature is present", () => {
    const geo = computeSchematic({
      ...baseLayout,
      keyFeatures: [...baseLayout.keyFeatures, "aqueduct"],
    });
    expect(geo.decorations.some((d) => d.type === "aqueduct")).toBe(true);
  });

  it("keeps every zone within the declared viewBox bounds", () => {
    const geo = computeSchematic({
      ...baseLayout,
      keyFeatures: [
        "temple_precinct",
        "palace",
        "market",
        "granary",
        "residential_quarter",
        "industrial_quarter",
        "garden",
        "necropolis",
        "walls",
      ],
    });
    for (const zone of geo.zones) {
      expect(zone.x).toBeGreaterThanOrEqual(0);
      expect(zone.y).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.width).toBeLessThanOrEqual(geo.viewBoxWidth);
      expect(zone.y + zone.height).toBeLessThanOrEqual(geo.viewBoxHeight);
    }
  });

  it("populates every zone with a color, label and stable id", () => {
    const geo = computeSchematic(baseLayout);
    const ids = new Set<string>();
    for (const zone of geo.zones) {
      expect(zone.color).toMatch(/^#/);
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.id.length).toBeGreaterThan(0);
      ids.add(zone.id);
    }
    expect(ids.size).toBe(geo.zones.length);
  });

  it.each([
    "grid",
    "organic",
    "radial",
    "linear",
    "citadel",
    "terraced",
    "canal-based",
    "fortified",
  ])("produces zones for %s layouts", (layoutType) => {
    const geo = computeSchematic({ ...baseLayout, layoutType });
    expect(geo.zones).toHaveLength(4);
  });

  it("falls back to organic placement for unknown layout types", () => {
    const geo = computeSchematic({ ...baseLayout, layoutType: "martian-futurist" });
    expect(geo.zones).toHaveLength(4);
  });

  it("returns an empty schematic for layouts with no features", () => {
    const geo = computeSchematic({ ...baseLayout, keyFeatures: [] });
    expect(geo.zones).toHaveLength(0);
    expect(geo.boundary).toBeUndefined();
    expect(geo.gates).toBeUndefined();
  });

  it("is deterministic across repeated calls with the same input", () => {
    const first = computeSchematic(baseLayout);
    const second = computeSchematic(baseLayout);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });

  it("prioritises the highest-priority feature at the radial center", () => {
    const geo = computeSchematic({
      ...baseLayout,
      layoutType: "radial",
      keyFeatures: ["residential_quarter", "temple_precinct", "market"],
    });
    expect(geo.zones[0].feature).toBe("temple_precinct");
    expect(geo.zones[0].shape).toBe("ellipse");
  });

  it("prioritises palace or temple at the citadel center", () => {
    const geo = computeSchematic({
      ...baseLayout,
      layoutType: "citadel",
      keyFeatures: ["residential_quarter", "palace", "granary"],
    });
    expect(["palace", "temple_precinct"]).toContain(geo.zones[0].feature);
  });
});

// --- Data layer integration: ensure real TSV data renders cleanly ---

describe("CityLayoutViewer - against real city-layouts.tsv", () => {
  const storage = new TsvStorage();

  it("computes a valid schematic for every city layout in the TSV", async () => {
    const layouts = await storage.getCityLayouts();
    expect(layouts.length).toBeGreaterThan(0);
    for (const layout of layouts) {
      const data: CityLayoutData = {
        id: layout.id,
        layoutType: layout.layoutType,
        keyFeatures: layout.keyFeatures,
        fortificationType: layout.fortificationType,
        description: layout.description,
        reconstructionNotes: layout.reconstructionNotes,
      };
      const geo = computeSchematic(data);
      expect(geo.viewBoxWidth).toBeGreaterThan(0);
      expect(geo.viewBoxHeight).toBeGreaterThan(0);
      // Every zone inside the viewbox
      for (const zone of geo.zones) {
        expect(zone.x).toBeGreaterThanOrEqual(0);
        expect(zone.y).toBeGreaterThanOrEqual(0);
        expect(zone.x + zone.width).toBeLessThanOrEqual(geo.viewBoxWidth);
        expect(zone.y + zone.height).toBeLessThanOrEqual(geo.viewBoxHeight);
      }
    }
  });

  it("produces gate markers only when the walled city also declares gates", async () => {
    const layouts = await storage.getCityLayouts();
    for (const layout of layouts) {
      const data: CityLayoutData = {
        id: layout.id,
        layoutType: layout.layoutType,
        keyFeatures: layout.keyFeatures,
        fortificationType: layout.fortificationType,
      };
      const geo = computeSchematic(data);
      if (!layout.keyFeatures.includes("gates")) {
        expect(geo.gates).toBeUndefined();
      }
    }
  });
});
