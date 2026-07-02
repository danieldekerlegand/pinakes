import { describe, it, expect } from "vitest";
import type { CultureProfile } from "@shared/types";
import {
  CURATED_COLLECTIONS,
  pickCultureOfTheDay,
  pickRandomCulture,
  filterProfilesBySearch,
  getCollectionProfiles,
  loadRecentlyViewed,
  recordRecentlyViewed,
  saveRecentlyViewed,
  resolveProfilesByIds,
  RECENTLY_VIEWED_CONFIG,
} from "./culture-discovery-utils";

function makeProfile(overrides: Partial<CultureProfile> & Pick<CultureProfile, "id" | "name">): CultureProfile {
  return {
    alternateNames: [],
    civilizationId: null,
    archaeologicalCultureId: null,
    timePeriodStart: -1000,
    timePeriodEnd: 500,
    region: "Mediterranean",
    summaryDescription: "A sample culture profile.",
    socialOrganization: "state",
    subsistenceType: "agricultural",
    urbanismLevel: "city-state",
    populationEstimate: 100000,
    technologyLevel: "iron",
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

const sampleProfiles: CultureProfile[] = [
  makeProfile({ id: "cp-sumerian", name: "Sumerian Culture", region: "Mesopotamia", timePeriodStart: -4500, timePeriodEnd: -2000, technologyLevel: "bronze" }),
  makeProfile({ id: "cp-ancient-egypt", name: "Ancient Egyptian Culture", region: "Nile Valley", timePeriodStart: -3100, timePeriodEnd: 30, technologyLevel: "bronze" }),
  makeProfile({ id: "cp-maya", name: "Maya Culture", region: "Mesoamerica", timePeriodStart: -2000, timePeriodEnd: 1500, technologyLevel: "stone" }),
  makeProfile({ id: "cp-aztec", name: "Aztec Culture", region: "Mesoamerica", alternateNames: ["Mexica", "Tenochca"], timePeriodStart: 1300, timePeriodEnd: 1521, notableSettlements: ["Tenochtitlan"], technologyLevel: "stone" }),
  makeProfile({ id: "cp-mongol", name: "Mongol Culture", region: "Central Asia", subsistenceType: "pastoral", socialOrganization: "empire", technologyLevel: "iron" }),
  makeProfile({ id: "cp-phoenician", name: "Phoenician Culture", region: "Eastern Mediterranean", subsistenceType: "maritime", technologyLevel: "iron" }),
  makeProfile({ id: "cp-roman", name: "Roman Culture", region: "Mediterranean", socialOrganization: "empire", technologyLevel: "iron" }),
];

describe("CURATED_COLLECTIONS", () => {
  it("contains the feature-mandated collections", () => {
    const ids = CURATED_COLLECTIONS.map((c) => c.id);
    expect(ids).toContain("river-civilizations");
    expect(ids).toContain("mesoamerican");
    expect(ids).toContain("steppe-empires");
  });

  it("all collections have unique ids and non-empty metadata", () => {
    const ids = CURATED_COLLECTIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CURATED_COLLECTIONS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("mesoamerican collection filters by region", () => {
    const meso = CURATED_COLLECTIONS.find((c) => c.id === "mesoamerican")!;
    const matches = sampleProfiles.filter(meso.matches).map((p) => p.id);
    expect(matches).toEqual(["cp-maya", "cp-aztec"]);
  });

  it("river-civilizations includes classic cradle cultures", () => {
    const rivers = CURATED_COLLECTIONS.find((c) => c.id === "river-civilizations")!;
    const matches = sampleProfiles.filter(rivers.matches).map((p) => p.id);
    expect(matches).toContain("cp-sumerian");
    expect(matches).toContain("cp-ancient-egypt");
  });

  it("steppe-empires includes pastoral Central Asia cultures", () => {
    const steppe = CURATED_COLLECTIONS.find((c) => c.id === "steppe-empires")!;
    const matches = sampleProfiles.filter(steppe.matches).map((p) => p.id);
    expect(matches).toContain("cp-mongol");
  });

  it("maritime-cultures collection filters by subsistence", () => {
    const maritime = CURATED_COLLECTIONS.find((c) => c.id === "maritime-cultures")!;
    const matches = sampleProfiles.filter(maritime.matches).map((p) => p.id);
    expect(matches).toEqual(["cp-phoenician"]);
  });
});

describe("pickCultureOfTheDay", () => {
  it("returns null for empty list", () => {
    expect(pickCultureOfTheDay([])).toBeNull();
  });

  it("is deterministic for the same date", () => {
    const date = new Date(Date.UTC(2026, 3, 16));
    const a = pickCultureOfTheDay(sampleProfiles, date);
    const b = pickCultureOfTheDay(sampleProfiles, date);
    expect(a?.id).toBe(b?.id);
  });

  it("cycles through profiles over consecutive days", () => {
    const day1 = pickCultureOfTheDay(sampleProfiles, new Date(Date.UTC(2026, 0, 1)));
    const day2 = pickCultureOfTheDay(sampleProfiles, new Date(Date.UTC(2026, 0, 2)));
    expect(day1).not.toBeNull();
    expect(day2).not.toBeNull();
    expect(day1?.id).not.toBe(day2?.id);
  });

  it("ignores profile list order", () => {
    const date = new Date(Date.UTC(2026, 3, 16));
    const a = pickCultureOfTheDay(sampleProfiles, date);
    const b = pickCultureOfTheDay([...sampleProfiles].reverse(), date);
    expect(a?.id).toBe(b?.id);
  });
});

describe("pickRandomCulture", () => {
  it("returns null for empty profiles", () => {
    expect(pickRandomCulture([])).toBeNull();
  });

  it("excludes ids in the exclude list when possible", () => {
    const excluded = ["cp-sumerian", "cp-ancient-egypt", "cp-maya"];
    const rng = () => 0;
    const pick = pickRandomCulture(sampleProfiles, excluded, rng);
    expect(excluded).not.toContain(pick?.id);
  });

  it("falls back to the full list when all are excluded", () => {
    const allIds = sampleProfiles.map((p) => p.id);
    const pick = pickRandomCulture(sampleProfiles, allIds, () => 0);
    expect(pick).not.toBeNull();
    expect(allIds).toContain(pick!.id);
  });

  it("uses the injected rng", () => {
    const pick1 = pickRandomCulture(sampleProfiles, [], () => 0);
    const pick2 = pickRandomCulture(sampleProfiles, [], () => 0.9999);
    expect(pick1?.id).toBe(sampleProfiles[0].id);
    expect(pick2?.id).toBe(sampleProfiles[sampleProfiles.length - 1].id);
  });
});

describe("filterProfilesBySearch", () => {
  it("returns all profiles for empty query", () => {
    expect(filterProfilesBySearch(sampleProfiles, "")).toHaveLength(sampleProfiles.length);
    expect(filterProfilesBySearch(sampleProfiles, "   ")).toHaveLength(sampleProfiles.length);
  });

  it("matches by name", () => {
    const result = filterProfilesBySearch(sampleProfiles, "Maya");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cp-maya");
  });

  it("matches by region case-insensitively", () => {
    const result = filterProfilesBySearch(sampleProfiles, "mesoamerica");
    expect(result.map((p) => p.id).sort()).toEqual(["cp-aztec", "cp-maya"]);
  });

  it("matches by alternate names", () => {
    const result = filterProfilesBySearch(sampleProfiles, "Mexica");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cp-aztec");
  });

  it("matches by notable settlements", () => {
    const result = filterProfilesBySearch(sampleProfiles, "tenochtitlan");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cp-aztec");
  });

  it("matches by summary description", () => {
    const profiles = [
      makeProfile({ id: "a", name: "A", summaryDescription: "Known for zzzunique astronomy." }),
      makeProfile({ id: "b", name: "B", summaryDescription: "Known for agriculture." }),
    ];
    const result = filterProfilesBySearch(profiles, "zzzunique");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });
});

describe("getCollectionProfiles", () => {
  it("respects the limit", () => {
    const empire = CURATED_COLLECTIONS.find((c) => c.id === "great-empires")!;
    const result = getCollectionProfiles(sampleProfiles, empire, 1);
    expect(result).toHaveLength(1);
  });

  it("returns only matching profiles", () => {
    const bronze = CURATED_COLLECTIONS.find((c) => c.id === "bronze-age")!;
    const result = getCollectionProfiles(sampleProfiles, bronze);
    expect(result.every((p) => p.technologyLevel === "bronze")).toBe(true);
  });
});

describe("recentlyViewed helpers", () => {
  function makeStorage(): Storage {
    let store: Record<string, string> = {};
    return {
      get length() { return Object.keys(store).length; },
      clear: () => { store = {}; },
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i] ?? null,
    };
  }

  it("recordRecentlyViewed moves repeated ids to the front", () => {
    const history = ["cp-roman", "cp-maya", "cp-aztec"];
    expect(recordRecentlyViewed("cp-maya", history)).toEqual([
      "cp-maya",
      "cp-roman",
      "cp-aztec",
    ]);
  });

  it("recordRecentlyViewed caps at the maximum length", () => {
    const history = Array.from({ length: RECENTLY_VIEWED_CONFIG.max }, (_, i) => `cp-${i}`);
    const result = recordRecentlyViewed("cp-new", history);
    expect(result).toHaveLength(RECENTLY_VIEWED_CONFIG.max);
    expect(result[0]).toBe("cp-new");
    expect(result).not.toContain(`cp-${RECENTLY_VIEWED_CONFIG.max - 1}`);
  });

  it("save + load round-trips through storage", () => {
    const storage = makeStorage();
    saveRecentlyViewed(["cp-a", "cp-b"], storage);
    expect(loadRecentlyViewed(storage)).toEqual(["cp-a", "cp-b"]);
  });

  it("load returns empty array when storage is empty or malformed", () => {
    const storage = makeStorage();
    expect(loadRecentlyViewed(storage)).toEqual([]);
    storage.setItem(RECENTLY_VIEWED_CONFIG.key, "not-json");
    expect(loadRecentlyViewed(storage)).toEqual([]);
    storage.setItem(RECENTLY_VIEWED_CONFIG.key, JSON.stringify({ not: "an array" }));
    expect(loadRecentlyViewed(storage)).toEqual([]);
  });

  it("load returns empty array when storage is null", () => {
    expect(loadRecentlyViewed(null)).toEqual([]);
  });
});

describe("resolveProfilesByIds", () => {
  it("preserves the requested order", () => {
    const result = resolveProfilesByIds(sampleProfiles, ["cp-roman", "cp-sumerian"]);
    expect(result.map((p) => p.id)).toEqual(["cp-roman", "cp-sumerian"]);
  });

  it("skips ids that are not found", () => {
    const result = resolveProfilesByIds(sampleProfiles, ["cp-missing", "cp-roman"]);
    expect(result.map((p) => p.id)).toEqual(["cp-roman"]);
  });
});
