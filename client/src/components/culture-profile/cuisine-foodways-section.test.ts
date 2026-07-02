import { describe, it, expect } from "vitest";
import {
  type Cuisine,
  type CuisineItem,
  type CookingTechnique,
  type IngredientOrigin,
  type FoodwayEvent,
  formatYear,
  getRegionColor,
  getTechniqueCategoryColor,
  getFoodTypeColor,
  getMechanismColor,
  getMechanismLabel,
  filterItemsByCuisineId,
  filterTechniquesByCuisineId,
  filterIngredientsByCuisineId,
  getUniqueFoodTypes,
  getUniqueTechniqueCategories,
  groupItemsByFoodType,
  groupTechniquesByCategory,
  REGION_COLORS,
  TECHNIQUE_CATEGORY_COLORS,
  FOOD_TYPE_COLORS,
  MECHANISM_COLORS,
} from "./cuisine-foodways-utils";

// Sample test data
const sampleCuisines: Cuisine[] = [
  {
    id: "chinese",
    name: "Chinese",
    nativeName: "中国菜",
    region: "East Asia",
    coordinates: { lat: 35.86, lng: 104.19 },
    associatedLanguageIds: ["chinese", "mandarin", "cantonese"],
    timeOrigin: -2000,
    timeEnd: null,
    description: "One of the world's oldest and most diverse culinary traditions",
  },
  {
    id: "french",
    name: "French",
    nativeName: "Cuisine française",
    region: "Western Europe",
    coordinates: { lat: 46.23, lng: 2.21 },
    associatedLanguageIds: ["french"],
    timeOrigin: 800,
    timeEnd: null,
    description: "Refined European cuisine known for technique and sauces",
  },
];

const sampleItems: CuisineItem[] = [
  { id: "chinese-peking-duck", cuisineId: "chinese", name: "Peking Duck", foodType: "Main Dish", timeOrigin: -500, timeEnd: null },
  { id: "chinese-kung-pao", cuisineId: "chinese", name: "Kung Pao Chicken", foodType: "Stir-Fry", timeOrigin: -500, timeEnd: null },
  { id: "chinese-dim-sum", cuisineId: "chinese", name: "Dim Sum", foodType: "Appetizer", timeOrigin: -500, timeEnd: null },
  { id: "chinese-dumplings", cuisineId: "chinese", name: "Dumplings", foodType: "Dumpling", timeOrigin: -500, timeEnd: null },
  { id: "french-coq-au-vin", cuisineId: "french", name: "Coq au Vin", foodType: "Main Dish", timeOrigin: 1600, timeEnd: null },
  { id: "french-croissant", cuisineId: "french", name: "Croissant", foodType: "Pastry", timeOrigin: 1838, timeEnd: null },
];

const sampleTechniques: CookingTechnique[] = [
  { id: "wok-frying", name: "Wok Stir-Frying", cuisineId: "chinese", category: "heat", coordinates: { lat: 28.0, lng: 113.0 }, timeOrigin: -200, timeEnd: null, description: "High-heat quick cooking in a rounded wok" },
  { id: "steaming-chinese", name: "Steaming", cuisineId: "chinese", category: "heat", coordinates: { lat: 30.0, lng: 114.0 }, timeOrigin: -5000, timeEnd: null, description: "Gentle cooking over boiling water" },
  { id: "sauteing-french", name: "Sautéing", cuisineId: "french", category: "heat", coordinates: { lat: 48.86, lng: 2.35 }, timeOrigin: 800, timeEnd: null, description: "Quick pan-cooking in butter" },
  { id: "confit-french", name: "Confit", cuisineId: "french", category: "preservation", coordinates: { lat: 43.6, lng: 1.44 }, timeOrigin: 1200, timeEnd: null, description: "Slow-cooking and preserving meat in its own fat" },
];

const sampleIngredients: IngredientOrigin[] = [
  { id: "rice-chinese", name: "Rice", cuisineId: "chinese", originRegion: "East Asia", coordinates: { lat: 30.0, lng: 115.0 }, timeOrigin: -7000, timeEnd: null, nativeName: "稻", description: "Staple grain" },
  { id: "soy-chinese", name: "Soybean", cuisineId: "chinese", originRegion: "East Asia", coordinates: { lat: 40.0, lng: 117.0 }, timeOrigin: -5000, timeEnd: null, nativeName: "大豆", description: "Protein-rich legume" },
  { id: "wheat-french", name: "Wheat", cuisineId: "french", originRegion: "Fertile Crescent", coordinates: { lat: 36.0, lng: 40.0 }, timeOrigin: -8000, timeEnd: null, nativeName: "Blé", description: "Ancient grain" },
];

// ============================================================================
// formatYear tests
// ============================================================================
describe("formatYear", () => {
  it("formats null as Unknown", () => {
    expect(formatYear(null)).toBe("Unknown");
  });

  it("formats negative years as BCE", () => {
    expect(formatYear(-500)).toBe("500 BCE");
    expect(formatYear(-2000)).toBe("2000 BCE");
  });

  it("formats positive years as CE", () => {
    expect(formatYear(800)).toBe("800 CE");
    expect(formatYear(2024)).toBe("2024 CE");
  });

  it("formats year 0 as CE", () => {
    expect(formatYear(0)).toBe("0 CE");
  });
});

// ============================================================================
// Color lookup tests
// ============================================================================
describe("getRegionColor", () => {
  it("returns correct color for known regions", () => {
    expect(getRegionColor("East Asia")).toBe("#ef4444");
    expect(getRegionColor("Western Europe")).toBe("#3b82f6");
    expect(getRegionColor("South Asia")).toBe("#f59e0b");
  });

  it("returns fallback for unknown regions", () => {
    expect(getRegionColor("Antarctica")).toBe("#6b7280");
    expect(getRegionColor("")).toBe("#6b7280");
  });
});

describe("getTechniqueCategoryColor", () => {
  it("returns correct color for known categories", () => {
    expect(getTechniqueCategoryColor("heat")).toBe("#ef4444");
    expect(getTechniqueCategoryColor("fermentation")).toBe("#8b5cf6");
    expect(getTechniqueCategoryColor("preservation")).toBe("#3b82f6");
  });

  it("is case-insensitive", () => {
    expect(getTechniqueCategoryColor("Heat")).toBe("#ef4444");
    expect(getTechniqueCategoryColor("FERMENTATION")).toBe("#8b5cf6");
  });

  it("returns fallback for unknown categories", () => {
    expect(getTechniqueCategoryColor("unknown")).toBe("#6b7280");
  });
});

describe("getFoodTypeColor", () => {
  it("returns correct color for known food types", () => {
    expect(getFoodTypeColor("Main Dish")).toBe("#ef4444");
    expect(getFoodTypeColor("Soup")).toBe("#14b8a6");
    expect(getFoodTypeColor("Dumpling")).toBe("#eab308");
  });

  it("returns fallback for unknown food types", () => {
    expect(getFoodTypeColor("Unknown Type")).toBe("#6b7280");
  });
});

describe("getMechanismColor", () => {
  it("returns correct color for known mechanisms", () => {
    expect(getMechanismColor("colonization")).toBe("#dc2626");
    expect(getMechanismColor("trade")).toBe("#2563eb");
    expect(getMechanismColor("migration")).toBe("#16a34a");
  });

  it("returns fallback for unknown mechanisms", () => {
    expect(getMechanismColor("unknown")).toBe("#6b7280");
  });
});

describe("getMechanismLabel", () => {
  it("returns formatted label for known mechanisms", () => {
    expect(getMechanismLabel("colonization")).toBe("Colonization");
    expect(getMechanismLabel("trade")).toBe("Trade");
    expect(getMechanismLabel("migration")).toBe("Migration");
  });

  it("returns raw value for unknown mechanisms", () => {
    expect(getMechanismLabel("other")).toBe("other");
  });
});

// ============================================================================
// Filter tests
// ============================================================================
describe("filterItemsByCuisineId", () => {
  it("filters items to the specified cuisine", () => {
    const result = filterItemsByCuisineId(sampleItems, "chinese");
    expect(result).toHaveLength(4);
    expect(result.every((i) => i.cuisineId === "chinese")).toBe(true);
  });

  it("returns empty for non-existent cuisine", () => {
    expect(filterItemsByCuisineId(sampleItems, "nonexistent")).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(filterItemsByCuisineId([], "chinese")).toHaveLength(0);
  });
});

describe("filterTechniquesByCuisineId", () => {
  it("filters techniques to the specified cuisine", () => {
    const result = filterTechniquesByCuisineId(sampleTechniques, "french");
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.cuisineId === "french")).toBe(true);
  });

  it("returns empty for non-existent cuisine", () => {
    expect(filterTechniquesByCuisineId(sampleTechniques, "nonexistent")).toHaveLength(0);
  });
});

describe("filterIngredientsByCuisineId", () => {
  it("filters ingredients to the specified cuisine", () => {
    const result = filterIngredientsByCuisineId(sampleIngredients, "chinese");
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.cuisineId === "chinese")).toBe(true);
  });

  it("returns empty for non-existent cuisine", () => {
    expect(filterIngredientsByCuisineId(sampleIngredients, "nonexistent")).toHaveLength(0);
  });
});

// ============================================================================
// Unique value extraction tests
// ============================================================================
describe("getUniqueFoodTypes", () => {
  it("extracts unique sorted food types", () => {
    const result = getUniqueFoodTypes(sampleItems);
    expect(result).toEqual(["Appetizer", "Dumpling", "Main Dish", "Pastry", "Stir-Fry"]);
  });

  it("handles empty input", () => {
    expect(getUniqueFoodTypes([])).toEqual([]);
  });

  it("deduplicates food types", () => {
    const items: CuisineItem[] = [
      { id: "a", cuisineId: "x", name: "A", foodType: "Soup", timeOrigin: null, timeEnd: null },
      { id: "b", cuisineId: "x", name: "B", foodType: "Soup", timeOrigin: null, timeEnd: null },
    ];
    expect(getUniqueFoodTypes(items)).toEqual(["Soup"]);
  });
});

describe("getUniqueTechniqueCategories", () => {
  it("extracts unique sorted categories", () => {
    const result = getUniqueTechniqueCategories(sampleTechniques);
    expect(result).toEqual(["heat", "preservation"]);
  });

  it("handles empty input", () => {
    expect(getUniqueTechniqueCategories([])).toEqual([]);
  });
});

// ============================================================================
// Grouping tests
// ============================================================================
describe("groupItemsByFoodType", () => {
  it("groups items by food type", () => {
    const result = groupItemsByFoodType(sampleItems);
    expect(result.size).toBe(5);
    expect(result.get("Main Dish")).toHaveLength(2);
    expect(result.get("Stir-Fry")).toHaveLength(1);
    expect(result.get("Dumpling")).toHaveLength(1);
    expect(result.get("Appetizer")).toHaveLength(1);
    expect(result.get("Pastry")).toHaveLength(1);
  });

  it("handles empty input", () => {
    const result = groupItemsByFoodType([]);
    expect(result.size).toBe(0);
  });

  it("preserves item data in groups", () => {
    const result = groupItemsByFoodType(sampleItems);
    const mainDishes = result.get("Main Dish")!;
    expect(mainDishes[0].name).toBe("Peking Duck");
    expect(mainDishes[1].name).toBe("Coq au Vin");
  });
});

describe("groupTechniquesByCategory", () => {
  it("groups techniques by category", () => {
    const result = groupTechniquesByCategory(sampleTechniques);
    expect(result.size).toBe(2);
    expect(result.get("heat")).toHaveLength(3);
    expect(result.get("preservation")).toHaveLength(1);
  });

  it("handles empty input", () => {
    const result = groupTechniquesByCategory([]);
    expect(result.size).toBe(0);
  });
});

// ============================================================================
// Color constant validation
// ============================================================================
describe("color constants", () => {
  it("REGION_COLORS has valid hex colors", () => {
    for (const [, color] of Object.entries(REGION_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("TECHNIQUE_CATEGORY_COLORS has valid hex colors", () => {
    for (const [, color] of Object.entries(TECHNIQUE_CATEGORY_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("FOOD_TYPE_COLORS has valid hex colors", () => {
    for (const [, color] of Object.entries(FOOD_TYPE_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("MECHANISM_COLORS has valid hex colors", () => {
    for (const [, color] of Object.entries(MECHANISM_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
