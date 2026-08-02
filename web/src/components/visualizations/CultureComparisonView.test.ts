import { describe, it, expect } from "vitest";
import type { CultureProfile } from "@contracts/types";
import {
  COMPARISON_DIMENSIONS,
  MAX_COMPARE,
  MIN_COMPARE,
  computeSharedTraits,
  formatPopulation,
  formatTimePeriod,
  formatYear,
  getCategories,
  getDimensionsByCategory,
  rowMatchState,
  searchProfiles,
  sharedArrayOverlap,
} from "./culture-comparison-utils";

function makeProfile(overrides: Partial<CultureProfile> = {}): CultureProfile {
  return {
    id: "cp-test",
    name: "Test Culture",
    alternateNames: [],
    civilizationId: null,
    archaeologicalCultureId: null,
    timePeriodStart: -2000,
    timePeriodEnd: 500,
    region: "Mesopotamia",
    summaryDescription: "A test culture",
    socialOrganization: "state",
    subsistenceType: "agricultural",
    urbanismLevel: "city-state",
    populationEstimate: 100000,
    technologyLevel: "bronze",
    associatedLanguageIds: [],
    associatedReligionIds: [],
    associatedWritingSystemIds: [],
    associatedArtTraditionIds: [],
    associatedMusicTraditionIds: [],
    associatedCuisineId: null,
    associatedArchitecturalStyleIds: [],
    associatedLiteraryTraditionIds: [],
    notableSettlements: [],
    imageGalleryTags: [],
    sources: [],
    ...overrides,
  };
}

describe("constants", () => {
  it("limits comparison to between 2 and 4 cultures", () => {
    expect(MIN_COMPARE).toBe(2);
    expect(MAX_COMPARE).toBe(4);
  });
});

describe("formatYear", () => {
  it("formats BCE years as absolute values", () => {
    expect(formatYear(-3000)).toBe("3000 BCE");
  });

  it("formats CE years with era label", () => {
    expect(formatYear(1500)).toBe("1500 CE");
  });

  it("treats year 0 as CE", () => {
    expect(formatYear(0)).toBe("0 CE");
  });
});

describe("formatTimePeriod", () => {
  it("renders BCE to CE ranges", () => {
    expect(formatTimePeriod(-500, 200)).toBe("500 BCE – 200 CE");
  });

  it("renders BCE to BCE ranges", () => {
    expect(formatTimePeriod(-3000, -1000)).toBe("3000 BCE – 1000 CE".replace("1000 CE", "1000 BCE"));
    // Direct expectation
    expect(formatTimePeriod(-3000, -1000)).toBe("3000 BCE – 1000 BCE");
  });
});

describe("formatPopulation", () => {
  it("returns Unknown for null", () => {
    expect(formatPopulation(null)).toBe("Unknown");
  });

  it("formats millions", () => {
    expect(formatPopulation(5_000_000)).toBe("5M");
    expect(formatPopulation(2_500_000)).toBe("2.5M");
  });

  it("formats thousands", () => {
    expect(formatPopulation(25_000)).toBe("25K");
  });

  it("formats smaller numbers plainly", () => {
    expect(formatPopulation(750)).toBe("750");
  });
});

describe("COMPARISON_DIMENSIONS", () => {
  it("covers all required socio-cultural dimensions", () => {
    const keys = COMPARISON_DIMENSIONS.map((d) => d.key);
    expect(keys).toContain("socialOrganization");
    expect(keys).toContain("technologyLevel");
    expect(keys).toContain("urbanismLevel");
    expect(keys).toContain("languages");
    expect(keys).toContain("writingSystems");
    expect(keys).toContain("religions");
    expect(keys).toContain("architecture");
    expect(keys).toContain("cuisine");
    expect(keys).toContain("artTraditions");
  });

  it("each dimension produces a string from a profile", () => {
    const profile = makeProfile({
      associatedLanguageIds: ["sumerian"],
      associatedReligionIds: ["rel-mesopotamian"],
    });
    for (const dim of COMPARISON_DIMENSIONS) {
      const value = dim.getValue(profile);
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("returns em dash for empty array fields", () => {
    const profile = makeProfile();
    const langDim = COMPARISON_DIMENSIONS.find((d) => d.key === "languages")!;
    expect(langDim.getValue(profile)).toBe("—");
  });

  it("labels enum values human-readable", () => {
    const profile = makeProfile({ socialOrganization: "empire" });
    const dim = COMPARISON_DIMENSIONS.find(
      (d) => d.key === "socialOrganization"
    )!;
    expect(dim.getValue(profile)).toBe("Empire");
  });
});

describe("getCategories", () => {
  it("returns unique category names in order", () => {
    const cats = getCategories();
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toContain("Society");
    expect(cats).toContain("Language & Writing");
  });
});

describe("getDimensionsByCategory", () => {
  it("returns only dimensions matching the category", () => {
    const society = getDimensionsByCategory("Society");
    expect(society.length).toBeGreaterThan(0);
    expect(society.every((d) => d.category === "Society")).toBe(true);
  });

  it("returns empty for unknown categories", () => {
    expect(getDimensionsByCategory("Nonexistent")).toEqual([]);
  });
});

describe("rowMatchState", () => {
  it("all-match when all values equal", () => {
    expect(rowMatchState(["a", "a", "a"])).toBe("all-match");
  });

  it("single value is all-match", () => {
    expect(rowMatchState(["only"])).toBe("all-match");
  });

  it("empty is all-match", () => {
    expect(rowMatchState([])).toBe("all-match");
  });

  it("all-differ when every value unique", () => {
    expect(rowMatchState(["a", "b", "c"])).toBe("all-differ");
  });

  it("partial when some overlap", () => {
    expect(rowMatchState(["a", "b", "a"])).toBe("partial");
  });
});

describe("sharedArrayOverlap", () => {
  it("returns intersection in order of first array", () => {
    expect(sharedArrayOverlap(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });

  it("returns empty for no overlap", () => {
    expect(sharedArrayOverlap(["a"], ["b"])).toEqual([]);
  });

  it("handles empty inputs", () => {
    expect(sharedArrayOverlap([], ["a"])).toEqual([]);
    expect(sharedArrayOverlap(["a"], [])).toEqual([]);
  });
});

describe("computeSharedTraits", () => {
  it("returns empty object when fewer than 2 profiles", () => {
    expect(computeSharedTraits([])).toEqual({});
    expect(computeSharedTraits([makeProfile()])).toEqual({});
  });

  it("intersects languages across profiles", () => {
    const p1 = makeProfile({
      id: "a",
      associatedLanguageIds: ["sumerian", "akkadian"],
    });
    const p2 = makeProfile({
      id: "b",
      associatedLanguageIds: ["akkadian", "hittite"],
    });
    const shared = computeSharedTraits([p1, p2]);
    expect(shared.languages).toEqual(["akkadian"]);
  });

  it("intersects religions across profiles", () => {
    const p1 = makeProfile({ id: "a", associatedReligionIds: ["r1", "r2"] });
    const p2 = makeProfile({ id: "b", associatedReligionIds: ["r2", "r3"] });
    const p3 = makeProfile({ id: "c", associatedReligionIds: ["r2"] });
    const shared = computeSharedTraits([p1, p2, p3]);
    expect(shared.religions).toEqual(["r2"]);
  });

  it("returns empty arrays when no overlap", () => {
    const p1 = makeProfile({ id: "a", associatedLanguageIds: ["x"] });
    const p2 = makeProfile({ id: "b", associatedLanguageIds: ["y"] });
    const shared = computeSharedTraits([p1, p2]);
    expect(shared.languages).toEqual([]);
  });

  it("covers all major trait dimensions", () => {
    const p1 = makeProfile({ id: "a" });
    const p2 = makeProfile({ id: "b" });
    const shared = computeSharedTraits([p1, p2]);
    expect(Object.keys(shared).sort()).toEqual(
      [
        "architecturalStyles",
        "artTraditions",
        "languages",
        "literaryTraditions",
        "musicTraditions",
        "religions",
        "writingSystems",
      ].sort()
    );
  });
});

describe("searchProfiles", () => {
  const sample = [
    makeProfile({ id: "cp-sumerian", name: "Sumerian", region: "Mesopotamia" }),
    makeProfile({
      id: "cp-egyptian",
      name: "Ancient Egyptian",
      region: "Nile Valley",
      alternateNames: ["Kemet"],
    }),
    makeProfile({ id: "cp-maya", name: "Maya", region: "Mesoamerica" }),
  ];

  it("returns all profiles when query is empty", () => {
    expect(searchProfiles(sample, "")).toHaveLength(3);
    expect(searchProfiles(sample, "   ")).toHaveLength(3);
  });

  it("matches by name case-insensitively", () => {
    const results = searchProfiles(sample, "maya");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("cp-maya");
  });

  it("matches by region", () => {
    const results = searchProfiles(sample, "Nile");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("cp-egyptian");
  });

  it("matches by alternate name", () => {
    const results = searchProfiles(sample, "kemet");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("cp-egyptian");
  });

  it("returns empty when no matches", () => {
    expect(searchProfiles(sample, "xyz")).toHaveLength(0);
  });
});
