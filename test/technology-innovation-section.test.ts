import { describe, it, expect } from "vitest";
import { TsvStorage } from "../server/tsv-storage";
import {
  type Innovation,
  filterInnovationsByCulture,
  formatCategoryLabel,
  formatInnovationYear,
  getUniqueInnovationCategories,
  sortInnovationsByYear,
  INNOVATION_CATEGORY_COLORS,
} from "../web/src/components/culture-profile/technology-innovation-utils";

const mockInnovations: Innovation[] = [
  {
    id: "inn-a",
    name: "Widget",
    category: "metallurgy",
    cultureProfileIds: ["cp-alpha"],
    yearInvented: -2000,
    regionOfOrigin: "Somewhere",
    description: "A thing",
    diffusionPath: ["cp-alpha", "cp-beta"],
    relatedInnovations: [],
    associatedLanguages: ["lat"],
    sources: ["Author 2020"],
  },
  {
    id: "inn-b",
    name: "Gadget",
    category: "writing",
    cultureProfileIds: ["cp-beta"],
    yearInvented: 500,
    regionOfOrigin: "Elsewhere",
    description: "Another thing",
    diffusionPath: ["cp-beta"],
    relatedInnovations: ["inn-a"],
    associatedLanguages: ["arb"],
    sources: [],
  },
  {
    id: "inn-c",
    name: "Gizmo",
    category: "metallurgy",
    cultureProfileIds: ["cp-alpha", "cp-gamma"],
    yearInvented: null,
    regionOfOrigin: "",
    description: "",
    diffusionPath: [],
    relatedInnovations: [],
    associatedLanguages: [],
    sources: [],
  },
];

describe("Technology & Innovation - Utility Functions", () => {
  describe("formatInnovationYear", () => {
    it("formats negative years as BCE", () => {
      expect(formatInnovationYear(-3000)).toBe("3000 BCE");
    });

    it("formats positive years as CE", () => {
      expect(formatInnovationYear(1500)).toBe("1500 CE");
    });

    it("formats zero as CE", () => {
      expect(formatInnovationYear(0)).toBe("0 CE");
    });

    it("returns 'Unknown' for null", () => {
      expect(formatInnovationYear(null)).toBe("Unknown");
    });
  });

  describe("filterInnovationsByCulture", () => {
    it("returns all innovations when no culture ID provided", () => {
      expect(filterInnovationsByCulture(mockInnovations, undefined)).toHaveLength(3);
    });

    it("filters innovations to those associated with the culture", () => {
      const result = filterInnovationsByCulture(mockInnovations, "cp-alpha");
      expect(result).toHaveLength(2);
      expect(result.map((i) => i.id)).toEqual(["inn-a", "inn-c"]);
    });

    it("returns empty for a culture with no innovations", () => {
      expect(filterInnovationsByCulture(mockInnovations, "cp-unknown")).toHaveLength(0);
    });
  });

  describe("getUniqueInnovationCategories", () => {
    it("returns sorted unique categories", () => {
      expect(getUniqueInnovationCategories(mockInnovations)).toEqual(["metallurgy", "writing"]);
    });

    it("returns empty array for empty input", () => {
      expect(getUniqueInnovationCategories([])).toEqual([]);
    });
  });

  describe("sortInnovationsByYear", () => {
    it("sorts innovations by year ascending", () => {
      const sorted = sortInnovationsByYear(mockInnovations);
      expect(sorted[0].id).toBe("inn-a");
      expect(sorted[1].id).toBe("inn-b");
      expect(sorted[2].id).toBe("inn-c");
    });

    it("places null years at the end", () => {
      const sorted = sortInnovationsByYear(mockInnovations);
      expect(sorted[sorted.length - 1].yearInvented).toBeNull();
    });

    it("does not mutate the input array", () => {
      const input = [...mockInnovations];
      sortInnovationsByYear(input);
      expect(input[0].id).toBe("inn-a");
    });
  });

  describe("formatCategoryLabel", () => {
    it("capitalizes single words", () => {
      expect(formatCategoryLabel("writing")).toBe("Writing");
    });

    it("converts underscores to spaces with title case", () => {
      expect(formatCategoryLabel("water_management")).toBe("Water Management");
    });
  });

  describe("INNOVATION_CATEGORY_COLORS", () => {
    it("defines colors for all expected categories", () => {
      const expected = [
        "writing", "metallurgy", "agriculture", "water_management",
        "transportation", "astronomy", "mathematics", "medicine",
        "military", "construction",
      ];
      for (const cat of expected) {
        expect(INNOVATION_CATEGORY_COLORS[cat]).toBeTruthy();
      }
    });
  });
});

describe("Technology & Innovation - Data Layer", () => {
  const storage = new TsvStorage();

  describe("getInnovations", () => {
    it("loads innovations from TSV", async () => {
      const innovations = await storage.getInnovations();
      expect(innovations.length).toBeGreaterThanOrEqual(15);
    });

    it("returns innovations with required fields", async () => {
      const innovations = await storage.getInnovations();
      for (const i of innovations) {
        expect(i.id).toBeTruthy();
        expect(i.name).toBeTruthy();
        expect(i.category).toBeTruthy();
        expect(Array.isArray(i.cultureProfileIds)).toBe(true);
        expect(Array.isArray(i.diffusionPath)).toBe(true);
        expect(Array.isArray(i.relatedInnovations)).toBe(true);
        expect(Array.isArray(i.associatedLanguages)).toBe(true);
        expect(Array.isArray(i.sources)).toBe(true);
      }
    });

    it("filters by category", async () => {
      const writing = await storage.getInnovations({ category: "writing" });
      expect(writing.length).toBeGreaterThan(0);
      for (const i of writing) {
        expect(i.category).toBe("writing");
      }
    });

    it("filters by culture profile ID", async () => {
      const sumerian = await storage.getInnovations({ cultureProfileId: "cp-sumerian" });
      expect(sumerian.length).toBeGreaterThan(0);
      for (const i of sumerian) {
        expect(i.cultureProfileIds).toContain("cp-sumerian");
      }
    });
  });

  describe("getInnovationById", () => {
    it("returns a specific innovation", async () => {
      const cuneiform = await storage.getInnovationById("inn-001");
      expect(cuneiform).not.toBeNull();
      expect(cuneiform?.name).toBe("Cuneiform Writing");
      expect(cuneiform?.category).toBe("writing");
    });

    it("returns null for unknown id", async () => {
      const result = await storage.getInnovationById("inn-nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("cross-referencing innovations", () => {
    it("related innovations reference valid innovation IDs", async () => {
      const innovations = await storage.getInnovations();
      const ids = new Set(innovations.map((i) => i.id));
      for (const i of innovations) {
        for (const relatedId of i.relatedInnovations) {
          expect(ids.has(relatedId)).toBe(true);
        }
      }
    });

    it("parses year_invented as a number or null", async () => {
      const innovations = await storage.getInnovations();
      for (const i of innovations) {
        if (i.yearInvented !== null) {
          expect(typeof i.yearInvented).toBe("number");
          expect(Number.isNaN(i.yearInvented)).toBe(false);
        }
      }
    });
  });
});
