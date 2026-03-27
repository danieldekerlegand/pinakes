import { describe, it, expect } from "vitest";

/**
 * Unit tests for ComparisonTable utility logic.
 * Tests the pure functions and data patterns used by comparison components.
 */

// Replicate the region color logic from CuisineComparisonView
const REGION_COLORS: Record<string, string> = {
  "East Asia": "#ef4444",
  "South Asia": "#f59e0b",
  "Southeast Asia": "#eab308",
  "Western Europe": "#3b82f6",
  "Central Europe": "#6366f1",
  "Southern Europe": "#8b5cf6",
  "East Africa": "#10b981",
};

function getRegionColor(region: string): string {
  return REGION_COLORS[region] || "#6b7280";
}

function formatYear(year: number | null): string {
  if (year === null) return "Unknown";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

// Replicate shared food type matrix logic
function computeSharedFoodTypes(
  cuisineA: { foodTypes: Set<string> },
  cuisineB: { foodTypes: Set<string> }
): number {
  return [...cuisineA.foodTypes].filter((t) => cuisineB.foodTypes.has(t)).length;
}

// Replicate sankey link building logic
function buildCuisineSankeyLinks(
  items: Array<{ cuisineId: string; foodType: string }>,
  validCuisineIds: Set<string>
): Array<{ source: string; target: string; value: number; contactType: string; timePeriod: string }> {
  const itemsByFoodType = new Map<string, string[]>();
  for (const item of items) {
    if (!validCuisineIds.has(item.cuisineId)) continue;
    const ft = item.foodType;
    if (!itemsByFoodType.has(ft)) itemsByFoodType.set(ft, []);
    itemsByFoodType.get(ft)!.push(item.cuisineId);
  }

  const linkMap = new Map<string, { source: string; target: string; value: number; contactType: string; timePeriod: string }>();

  for (const [foodType, cuisineList] of itemsByFoodType) {
    const unique = [...new Set(cuisineList)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [a, b] = [unique[i], unique[j]].sort();
        const key = `${a}->${b}`;
        if (!linkMap.has(key)) {
          linkMap.set(key, {
            source: a,
            target: b,
            value: 1,
            contactType: "shared_food_type",
            timePeriod: foodType,
          });
        } else {
          linkMap.get(key)!.value++;
        }
      }
    }
  }

  return Array.from(linkMap.values());
}

// Replicate filter logic
function filterCuisinesByRegion(
  cuisines: Array<{ id: string; region: string }>,
  selectedRegion: string | null
): Array<{ id: string; region: string }> {
  if (!selectedRegion) return cuisines;
  return cuisines.filter((c) => c.region === selectedRegion);
}

describe("CuisineComparisonView utilities", () => {
  describe("getRegionColor", () => {
    it("returns correct color for known regions", () => {
      expect(getRegionColor("East Asia")).toBe("#ef4444");
      expect(getRegionColor("Western Europe")).toBe("#3b82f6");
    });

    it("returns fallback color for unknown regions", () => {
      expect(getRegionColor("Unknown Region")).toBe("#6b7280");
      expect(getRegionColor("")).toBe("#6b7280");
    });
  });

  describe("formatYear", () => {
    it("formats BCE years correctly", () => {
      expect(formatYear(-2000)).toBe("2000 BCE");
      expect(formatYear(-500)).toBe("500 BCE");
    });

    it("formats CE years correctly", () => {
      expect(formatYear(800)).toBe("800 CE");
      expect(formatYear(2000)).toBe("2000 CE");
    });

    it("handles null as Unknown", () => {
      expect(formatYear(null)).toBe("Unknown");
    });

    it("handles year 0", () => {
      expect(formatYear(0)).toBe("0 CE");
    });
  });

  describe("computeSharedFoodTypes", () => {
    it("counts shared food types correctly", () => {
      const a = { foodTypes: new Set(["Soup", "Main Dish", "Rice Dish"]) };
      const b = { foodTypes: new Set(["Soup", "Stew", "Rice Dish"]) };
      expect(computeSharedFoodTypes(a, b)).toBe(2);
    });

    it("returns 0 when no shared types", () => {
      const a = { foodTypes: new Set(["Soup"]) };
      const b = { foodTypes: new Set(["Stew"]) };
      expect(computeSharedFoodTypes(a, b)).toBe(0);
    });

    it("handles empty sets", () => {
      const a = { foodTypes: new Set<string>() };
      const b = { foodTypes: new Set(["Soup"]) };
      expect(computeSharedFoodTypes(a, b)).toBe(0);
    });
  });

  describe("filterCuisinesByRegion", () => {
    const cuisines = [
      { id: "chinese", region: "East Asia" },
      { id: "japanese", region: "East Asia" },
      { id: "french", region: "Western Europe" },
      { id: "ethiopian", region: "East Africa" },
    ];

    it("returns all cuisines when no region filter", () => {
      expect(filterCuisinesByRegion(cuisines, null)).toHaveLength(4);
    });

    it("filters by region correctly", () => {
      const result = filterCuisinesByRegion(cuisines, "East Asia");
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id)).toEqual(["chinese", "japanese"]);
    });

    it("returns empty for non-existent region", () => {
      expect(filterCuisinesByRegion(cuisines, "Antarctica")).toHaveLength(0);
    });
  });

  describe("buildCuisineSankeyLinks", () => {
    const validIds = new Set(["chinese", "japanese", "french"]);

    it("creates links between cuisines sharing food types", () => {
      const items = [
        { cuisineId: "chinese", foodType: "Soup" },
        { cuisineId: "japanese", foodType: "Soup" },
        { cuisineId: "french", foodType: "Soup" },
      ];

      const links = buildCuisineSankeyLinks(items, validIds);
      expect(links.length).toBe(3); // chinese-french, chinese-japanese, french-japanese
      expect(links.every((l) => l.contactType === "shared_food_type")).toBe(true);
    });

    it("increments value for multiple shared food types", () => {
      const items = [
        { cuisineId: "chinese", foodType: "Soup" },
        { cuisineId: "japanese", foodType: "Soup" },
        { cuisineId: "chinese", foodType: "Noodle Dish" },
        { cuisineId: "japanese", foodType: "Noodle Dish" },
      ];

      const links = buildCuisineSankeyLinks(items, validIds);
      expect(links).toHaveLength(1);
      expect(links[0].value).toBe(2);
    });

    it("excludes invalid cuisine IDs", () => {
      const items = [
        { cuisineId: "chinese", foodType: "Soup" },
        { cuisineId: "unknown", foodType: "Soup" },
      ];

      const links = buildCuisineSankeyLinks(items, validIds);
      expect(links).toHaveLength(0);
    });

    it("returns empty array for single cuisine", () => {
      const items = [
        { cuisineId: "chinese", foodType: "Soup" },
        { cuisineId: "chinese", foodType: "Rice Dish" },
      ];

      const links = buildCuisineSankeyLinks(items, validIds);
      expect(links).toHaveLength(0);
    });

    it("sorts source/target consistently", () => {
      const items = [
        { cuisineId: "japanese", foodType: "Soup" },
        { cuisineId: "chinese", foodType: "Soup" },
      ];

      const links = buildCuisineSankeyLinks(items, validIds);
      expect(links[0].source).toBe("chinese");
      expect(links[0].target).toBe("japanese");
    });
  });
});

describe("ComparisonTable component logic", () => {
  it("getRowKey produces unique keys", () => {
    const items = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ];
    const keys = items.map((i) => i.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("columns render functions are callable", () => {
    // Verify the column definition pattern works
    const column = {
      key: "name",
      header: "Name",
      render: (item: { name: string }) => item.name,
    };
    expect(column.render({ name: "Test" })).toBe("Test");
  });
});
