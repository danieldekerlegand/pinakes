import { describe, it, expect } from "vitest";
import {
  DATASET_REGISTRY,
  VISUALIZATION_OPTIONS,
  getDatasetCategories,
  getCompatibleVisualizations,
  getSuggestedVisualization,
  filterDatasets,
  type DatasetDefinition,
} from "./data-explorer-registry";

describe("DATASET_REGISTRY", () => {
  it("contains all expected categories", () => {
    const categories = getDatasetCategories(DATASET_REGISTRY);
    expect(categories).toContain("Linguistics");
    expect(categories).toContain("Culture");
    expect(categories).toContain("History");
    expect(categories).toContain("Religion");
    expect(categories).toContain("Food");
    expect(categories).toContain("Trade");
  });

  it("has unique dataset IDs", () => {
    const ids = DATASET_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each dataset has at least one compatible visualization", () => {
    for (const ds of DATASET_REGISTRY) {
      expect(ds.compatibleVisualizations.length).toBeGreaterThan(0);
    }
  });

  it("each dataset's default visualization is in its compatible list", () => {
    for (const ds of DATASET_REGISTRY) {
      expect(ds.compatibleVisualizations).toContain(ds.defaultVisualization);
    }
  });

  it("each dataset has an endpoint starting with /api/", () => {
    for (const ds of DATASET_REGISTRY) {
      expect(ds.endpoint).toMatch(/^\/api\//);
    }
  });

  it("each dataset has a .tsv file reference", () => {
    for (const ds of DATASET_REGISTRY) {
      expect(ds.file).toMatch(/\.tsv$/);
    }
  });

  it("each dataset has at least one data shape", () => {
    for (const ds of DATASET_REGISTRY) {
      expect(ds.dataShapes.length).toBeGreaterThan(0);
    }
  });
});

describe("getDatasetCategories", () => {
  it("returns sorted unique categories", () => {
    const categories = getDatasetCategories(DATASET_REGISTRY);
    const sorted = [...categories].sort();
    expect(categories).toEqual(sorted);
  });

  it("returns empty array for empty input", () => {
    expect(getDatasetCategories([])).toEqual([]);
  });

  it("deduplicates categories", () => {
    const datasets: DatasetDefinition[] = [
      { id: "a", name: "A", category: "Cat1", endpoint: "/api/a", file: "a.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },
      { id: "b", name: "B", category: "Cat1", endpoint: "/api/b", file: "b.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },
    ];
    expect(getDatasetCategories(datasets)).toEqual(["Cat1"]);
  });
});

describe("getCompatibleVisualizations", () => {
  it("returns matching visualization options for a dataset", () => {
    const ds = DATASET_REGISTRY.find((d) => d.id === "languages")!;
    const vizOptions = getCompatibleVisualizations(ds);
    const types = vizOptions.map((v) => v.type);
    expect(types).toEqual(expect.arrayContaining(["table", "map"]));
  });

  it("returns only compatible types", () => {
    const ds: DatasetDefinition = {
      id: "test",
      name: "Test",
      category: "Test",
      endpoint: "/api/test",
      file: "test.tsv",
      dataShapes: ["tabular"],
      defaultVisualization: "table",
      compatibleVisualizations: ["table"],
    };
    const vizOptions = getCompatibleVisualizations(ds);
    expect(vizOptions).toHaveLength(1);
    expect(vizOptions[0].type).toBe("table");
  });
});

describe("getSuggestedVisualization", () => {
  it("returns the default visualization option", () => {
    const ds = DATASET_REGISTRY.find((d) => d.id === "language-families")!;
    const suggested = getSuggestedVisualization(ds);
    expect(suggested.type).toBe("tree");
  });

  it("returns timeline for temporal datasets", () => {
    const ds = DATASET_REGISTRY.find((d) => d.id === "civilizations")!;
    const suggested = getSuggestedVisualization(ds);
    expect(suggested.type).toBe("timeline");
  });

  it("returns map for geographic datasets", () => {
    const ds = DATASET_REGISTRY.find((d) => d.id === "battles")!;
    const suggested = getSuggestedVisualization(ds);
    expect(suggested.type).toBe("map");
  });

  it("returns network for relational datasets", () => {
    const ds = DATASET_REGISTRY.find((d) => d.id === "etymology-relations")!;
    const suggested = getSuggestedVisualization(ds);
    expect(suggested.type).toBe("network");
  });
});

describe("filterDatasets", () => {
  it("returns all datasets with no filters", () => {
    const result = filterDatasets(DATASET_REGISTRY, "", null);
    expect(result).toHaveLength(DATASET_REGISTRY.length);
  });

  it("filters by category", () => {
    const result = filterDatasets(DATASET_REGISTRY, "", "Linguistics");
    expect(result.every((d) => d.category === "Linguistics")).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("filters by search query (name)", () => {
    const result = filterDatasets(DATASET_REGISTRY, "battle", null);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("battles");
  });

  it("filters by search query (category)", () => {
    const result = filterDatasets(DATASET_REGISTRY, "food", null);
    expect(result.every((d) => d.category === "Food")).toBe(true);
  });

  it("combines category and search filters", () => {
    const result = filterDatasets(DATASET_REGISTRY, "writing", "Linguistics");
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("writing-systems");
  });

  it("is case-insensitive", () => {
    const result = filterDatasets(DATASET_REGISTRY, "LANGUAGE", null);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", () => {
    const result = filterDatasets(DATASET_REGISTRY, "zzzznonexistent", null);
    expect(result).toHaveLength(0);
  });

  it("handles whitespace-only query as no filter", () => {
    const result = filterDatasets(DATASET_REGISTRY, "   ", null);
    expect(result).toHaveLength(DATASET_REGISTRY.length);
  });
});

describe("VISUALIZATION_OPTIONS", () => {
  it("has all required visualization types", () => {
    const types = VISUALIZATION_OPTIONS.map((v) => v.type);
    expect(types).toContain("table");
    expect(types).toContain("timeline");
    expect(types).toContain("tree");
    expect(types).toContain("network");
    expect(types).toContain("map");
    expect(types).toContain("heatmap");
    expect(types).toContain("sankey");
    expect(types).toContain("chord");
  });

  it("each option has label, iconName, and description", () => {
    for (const opt of VISUALIZATION_OPTIONS) {
      expect(opt.label).toBeTruthy();
      expect(opt.iconName).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });

  it("covers all visualization types referenced in datasets", () => {
    const optionTypes = new Set(VISUALIZATION_OPTIONS.map((v) => v.type));
    for (const ds of DATASET_REGISTRY) {
      expect(optionTypes.has(ds.defaultVisualization)).toBe(true);
      for (const vt of ds.compatibleVisualizations) {
        expect(optionTypes.has(vt)).toBe(true);
      }
    }
  });
});
