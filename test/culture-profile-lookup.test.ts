import { describe, it, expect } from "vitest";
import { findCultureProfileIdForFeature } from "@/lib/visualization/culture-profile-lookup";
import type { CultureProfile } from "@shared/types";

function makeProfile(overrides: Partial<CultureProfile>): CultureProfile {
  return {
    id: "p-1",
    name: "Test",
    alternateNames: [],
    civilizationId: null,
    archaeologicalCultureId: null,
    timePeriodStart: -1000,
    timePeriodEnd: 0,
    region: "Test",
    summaryDescription: "",
    socialOrganization: "state",
    subsistenceType: "agricultural",
    urbanismLevel: "town",
    populationEstimate: null,
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

describe("findCultureProfileIdForFeature", () => {
  const profiles: CultureProfile[] = [
    makeProfile({ id: "roman-culture", civilizationId: "rome", archaeologicalCultureId: null }),
    makeProfile({ id: "yamnaya-culture", civilizationId: null, archaeologicalCultureId: "yamnaya" }),
    makeProfile({ id: "aztec-culture", civilizationId: "aztec-empire", archaeologicalCultureId: null }),
  ];

  it("returns the profile id when the feature id matches a civilizationId", () => {
    expect(findCultureProfileIdForFeature("rome", profiles)).toBe("roman-culture");
    expect(findCultureProfileIdForFeature("aztec-empire", profiles)).toBe("aztec-culture");
  });

  it("returns the profile id when the feature id matches an archaeologicalCultureId", () => {
    expect(findCultureProfileIdForFeature("yamnaya", profiles)).toBe("yamnaya-culture");
  });

  it("returns the profile id when the feature id matches the profile id directly", () => {
    expect(findCultureProfileIdForFeature("roman-culture", profiles)).toBe("roman-culture");
  });

  it("returns null when no profile matches the feature id", () => {
    expect(findCultureProfileIdForFeature("unknown-id", profiles)).toBeNull();
  });

  it("returns null for empty feature id", () => {
    expect(findCultureProfileIdForFeature("", profiles)).toBeNull();
  });

  it("returns null when profiles array is empty", () => {
    expect(findCultureProfileIdForFeature("rome", [])).toBeNull();
  });

  it("does not match when civilizationId/archaeologicalCultureId is null", () => {
    const onlyNullRefs: CultureProfile[] = [
      makeProfile({ id: "orphan", civilizationId: null, archaeologicalCultureId: null }),
    ];
    // "null" as a literal string must not match the null fields
    expect(findCultureProfileIdForFeature("null", onlyNullRefs)).toBeNull();
  });

  it("prefers the first match when multiple profiles could match", () => {
    const overlap: CultureProfile[] = [
      makeProfile({ id: "culture-a", civilizationId: "shared" }),
      makeProfile({ id: "culture-b", civilizationId: "shared" }),
    ];
    expect(findCultureProfileIdForFeature("shared", overlap)).toBe("culture-a");
  });
});
