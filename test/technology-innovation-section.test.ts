import { describe, it, expect } from "vitest";
import {
  type Innovation,
  filterInnovationsByCulture,
  formatCategoryLabel,
  formatInnovationYear,
  getUniqueInnovationCategories,
  sortInnovationsByYear,
  INNOVATION_CATEGORY_COLORS,
} from "../web/src/components/culture-profile/technology-innovation-utils";

// The corpus-integration half of this file (a `TsvStorage`-backed "Data Layer"
// suite) retired with the Express backend in tasks/chief/80-cutover.json US-2.
// The corpus is read by the Python service now, and services/api/tests/test_domain_routes.py (innovations)
// asserts the same rows against the live TSVs. What stays here is what this file
// is actually about: the pure client-side helpers.

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
