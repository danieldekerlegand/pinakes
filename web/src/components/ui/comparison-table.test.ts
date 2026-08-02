import { describe, it, expect } from "vitest";

/**
 * Unit tests for ComparisonTable utility logic.
 * Tests the pure functions and data transformation logic used by the component,
 * as well as the data patterns used by comparison components like CuisineComparisonView.
 */

// Replicate the cellValuesMatch function from the component
function cellValuesMatch(values: unknown[]): boolean {
  if (values.length <= 1) return true;
  const stringified = values.map((v) =>
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
  );
  return stringified.every((s) => s === stringified[0]);
}

// Type definitions matching the component
interface ComparisonColumn<T> {
  key: string;
  label: string;
  data: T;
}

interface ComparisonRow<T> {
  key: string;
  label: string;
  getValue: (item: T) => unknown;
  renderCell?: (value: unknown, item: T, columnIndex: number) => unknown;
}

// Helper: build columns from data items
function buildColumns<T>(items: T[], getKey: (item: T) => string, getLabel: (item: T) => string): ComparisonColumn<T>[] {
  return items.map((item) => ({
    key: getKey(item),
    label: getLabel(item),
    data: item,
  }));
}

// Helper: extract cell values for a row across all columns
function extractRowValues<T>(row: ComparisonRow<T>, columns: ComparisonColumn<T>[]): unknown[] {
  return columns.map((col) => row.getValue(col.data));
}

// Sample data types for testing
interface LanguageData {
  id: string;
  name: string;
  family: string;
  speakers: number;
  writingSystem: string;
  wordOrder: string;
  hasGender: boolean;
}

const sampleLanguages: LanguageData[] = [
  {
    id: "es",
    name: "Spanish",
    family: "Indo-European",
    speakers: 500_000_000,
    writingSystem: "Latin",
    wordOrder: "SVO",
    hasGender: true,
  },
  {
    id: "ja",
    name: "Japanese",
    family: "Japonic",
    speakers: 125_000_000,
    writingSystem: "Kanji/Kana",
    wordOrder: "SOV",
    hasGender: false,
  },
  {
    id: "pt",
    name: "Portuguese",
    family: "Indo-European",
    speakers: 250_000_000,
    writingSystem: "Latin",
    wordOrder: "SVO",
    hasGender: true,
  },
];

const sampleRows: ComparisonRow<LanguageData>[] = [
  { key: "family", label: "Language Family", getValue: (l) => l.family },
  { key: "speakers", label: "Speakers", getValue: (l) => l.speakers },
  { key: "writing", label: "Writing System", getValue: (l) => l.writingSystem },
  { key: "wordOrder", label: "Word Order", getValue: (l) => l.wordOrder },
  { key: "gender", label: "Has Grammatical Gender", getValue: (l) => l.hasGender },
];

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

describe("ComparisonTable - cellValuesMatch", () => {
  it("returns true for empty array", () => {
    expect(cellValuesMatch([])).toBe(true);
  });

  it("returns true for single value", () => {
    expect(cellValuesMatch(["hello"])).toBe(true);
  });

  it("returns true when all values are identical strings", () => {
    expect(cellValuesMatch(["SVO", "SVO", "SVO"])).toBe(true);
  });

  it("returns false when string values differ", () => {
    expect(cellValuesMatch(["SVO", "SOV", "SVO"])).toBe(false);
  });

  it("returns true when all values are identical numbers", () => {
    expect(cellValuesMatch([42, 42, 42])).toBe(true);
  });

  it("returns false when number values differ", () => {
    expect(cellValuesMatch([100, 200, 100])).toBe(false);
  });

  it("returns true when all values are identical booleans", () => {
    expect(cellValuesMatch([true, true])).toBe(true);
  });

  it("returns false when boolean values differ", () => {
    expect(cellValuesMatch([true, false])).toBe(false);
  });

  it("treats null and undefined as equivalent empty strings", () => {
    expect(cellValuesMatch([null, undefined, null])).toBe(true);
  });

  it("treats null as different from non-empty string", () => {
    expect(cellValuesMatch([null, "hello"])).toBe(false);
  });

  it("handles object values by JSON stringification", () => {
    expect(cellValuesMatch([{ a: 1 }, { a: 1 }])).toBe(true);
    expect(cellValuesMatch([{ a: 1 }, { a: 2 }])).toBe(false);
  });
});

describe("ComparisonTable - buildColumns", () => {
  it("creates columns from data items", () => {
    const columns = buildColumns(
      sampleLanguages.slice(0, 2),
      (l) => l.id,
      (l) => l.name
    );
    expect(columns).toHaveLength(2);
    expect(columns[0].key).toBe("es");
    expect(columns[0].label).toBe("Spanish");
    expect(columns[0].data).toBe(sampleLanguages[0]);
    expect(columns[1].key).toBe("ja");
    expect(columns[1].label).toBe("Japanese");
  });

  it("returns empty array for empty input", () => {
    const columns = buildColumns([], (l: LanguageData) => l.id, (l) => l.name);
    expect(columns).toHaveLength(0);
  });

  it("preserves data reference in column", () => {
    const columns = buildColumns(sampleLanguages, (l) => l.id, (l) => l.name);
    columns.forEach((col, i) => {
      expect(col.data).toBe(sampleLanguages[i]);
    });
  });
});

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
      expect(links.length).toBe(3);
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

describe("ComparisonTable - extractRowValues", () => {
  const columns = buildColumns(sampleLanguages, (l) => l.id, (l) => l.name);

  it("extracts values for a row across all columns", () => {
    const familyRow = sampleRows[0];
    const values = extractRowValues(familyRow, columns);
    expect(values).toEqual(["Indo-European", "Japonic", "Indo-European"]);
  });

  it("extracts numeric values", () => {
    const speakersRow = sampleRows[1];
    const values = extractRowValues(speakersRow, columns);
    expect(values).toEqual([500_000_000, 125_000_000, 250_000_000]);
  });

  it("extracts boolean values", () => {
    const genderRow = sampleRows[4];
    const values = extractRowValues(genderRow, columns);
    expect(values).toEqual([true, false, true]);
  });
});

describe("ComparisonTable - difference detection", () => {
  const columns = buildColumns(sampleLanguages, (l) => l.id, (l) => l.name);

  it("detects matching values across columns (family: Spanish vs Portuguese)", () => {
    const twoColumns = [columns[0], columns[2]]; // Spanish and Portuguese
    const familyValues = extractRowValues(sampleRows[0], twoColumns);
    expect(cellValuesMatch(familyValues)).toBe(true);
  });

  it("detects differing values across columns (family: Spanish vs Japanese)", () => {
    const twoColumns = [columns[0], columns[1]]; // Spanish and Japanese
    const familyValues = extractRowValues(sampleRows[0], twoColumns);
    expect(cellValuesMatch(familyValues)).toBe(false);
  });

  it("detects matching writing systems (Spanish and Portuguese both use Latin)", () => {
    const twoColumns = [columns[0], columns[2]];
    const writingValues = extractRowValues(sampleRows[2], twoColumns);
    expect(cellValuesMatch(writingValues)).toBe(true);
  });

  it("detects differing writing systems (Spanish vs Japanese)", () => {
    const twoColumns = [columns[0], columns[1]];
    const writingValues = extractRowValues(sampleRows[2], twoColumns);
    expect(cellValuesMatch(writingValues)).toBe(false);
  });

  it("correctly identifies all-same vs mixed across all three", () => {
    // Word order: SVO, SOV, SVO - not all same
    const wordOrderValues = extractRowValues(sampleRows[3], columns);
    expect(cellValuesMatch(wordOrderValues)).toBe(false);

    // Speakers: all different
    const speakerValues = extractRowValues(sampleRows[1], columns);
    expect(cellValuesMatch(speakerValues)).toBe(false);
  });
});

describe("ComparisonTable - edge cases", () => {
  it("handles single column comparison", () => {
    const singleCol = buildColumns([sampleLanguages[0]], (l) => l.id, (l) => l.name);
    const values = extractRowValues(sampleRows[0], singleCol);
    expect(values).toEqual(["Indo-European"]);
    expect(cellValuesMatch(values)).toBe(true);
  });

  it("handles rows with null/undefined values", () => {
    const dataWithNulls = [
      { id: "a", name: "A", value: "hello" as string | null },
      { id: "b", name: "B", value: null as string | null },
    ];
    const cols = buildColumns(dataWithNulls, (d) => d.id, (d) => d.name);
    const row: ComparisonRow<typeof dataWithNulls[0]> = {
      key: "value",
      label: "Value",
      getValue: (d) => d.value,
    };
    const values = extractRowValues(row, cols);
    expect(values).toEqual(["hello", null]);
    expect(cellValuesMatch(values)).toBe(false);
  });

  it("handles custom renderCell function", () => {
    const row: ComparisonRow<LanguageData> = {
      key: "speakers_formatted",
      label: "Speakers (formatted)",
      getValue: (l) => l.speakers,
      renderCell: (value) => `${(value as number / 1_000_000).toFixed(0)}M`,
    };
    const cols = buildColumns(sampleLanguages.slice(0, 2), (l) => l.id, (l) => l.name);
    const rawValues = extractRowValues(row, cols);
    const rendered = cols.map((col, i) => row.renderCell!(rawValues[i], col.data, i));
    expect(rendered).toEqual(["500M", "125M"]);
  });

  it("handles many columns", () => {
    const manyItems = Array.from({ length: 20 }, (_, i) => ({
      id: `lang-${i}`,
      name: `Language ${i}`,
      family: i % 2 === 0 ? "FamilyA" : "FamilyB",
      speakers: i * 1000,
      writingSystem: "Latin",
      wordOrder: "SVO",
      hasGender: i % 2 === 0,
    }));
    const cols = buildColumns(manyItems, (l) => l.id, (l) => l.name);
    expect(cols).toHaveLength(20);

    // Writing system is same for all
    const writingRow: ComparisonRow<typeof manyItems[0]> = {
      key: "writing",
      label: "Writing",
      getValue: (l) => l.writingSystem,
    };
    const values = extractRowValues(writingRow, cols);
    expect(cellValuesMatch(values)).toBe(true);

    // Family alternates, so not all same
    const familyRow: ComparisonRow<typeof manyItems[0]> = {
      key: "family",
      label: "Family",
      getValue: (l) => l.family,
    };
    const familyValues = extractRowValues(familyRow, cols);
    expect(cellValuesMatch(familyValues)).toBe(false);
  });
});
