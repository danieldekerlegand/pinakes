import { describe, it, expect } from "vitest";

import {
  SUMMARY_CONTRACTS,
  isSummaryDomain,
  paginate,
  summarizeEntity,
  summarizeList,
  summaryContract,
  summaryDomains,
  summaryFields,
  type EntityRecord,
  type SummaryDomain,
} from "./entity-summary";

/**
 * Pure unit tests for the progressive summary/detail contract (US-004). These
 * assert the core property of the feature — every summary is a strict subset of
 * the detail record — plus the projection and pagination mechanics the routes
 * lean on. No Express, no storage: the service is pure over plain records.
 */

// One representative fully-hydrated (detail) record per domain, mirroring the
// real entity shapes in server/tsv-storage.ts. The summary fields must all be
// keys of these records — that is exactly what the "subset" tests below check.
const DETAIL_FIXTURES: Record<SummaryDomain, EntityRecord> = {
  languages: {
    id: "lat",
    name: "Latin",
    nativeName: "Lingua Latina",
    iso639_1: "la",
    iso639_2: "lat",
    familyId: "indo-european",
    region: "Italy",
    status: "historical",
    totalSpeakers: 0,
    classification: "Italic",
    writingSystem: "Latin",
    coordinates: { lat: 41.9, lng: 12.5 },
  },
  religions: {
    id: "rel-1",
    name: "Roman polytheism",
    nativeName: "Religio Romana",
    religionType: "polytheism",
    originRegion: "Italy",
    coordinates: { lat: 41.9, lng: 12.5 },
    timeOrigin: -750,
    timeEnd: 400,
    sacredTexts: ["Sibylline Books"],
    associatedLanguageIds: ["lat"],
    deityPantheon: ["Jupiter", "Juno"],
    ritualPractices: ["augury"],
    description: "The polytheistic religion of ancient Rome.",
    sources: ["scraped"],
  },
  battles: {
    id: "bat-1",
    name: "Battle of Cannae",
    date: "-216",
    coordinates: [41.3, 16.1],
    belligerents: [{ name: "Rome", civilization_id: "rome" }],
    outcome: "Carthaginian victory",
    casualtiesEstimate: "50000",
    significance: "Devastating Roman defeat.",
    associatedLanguageChanges: "",
    warName: "Second Punic War",
  },
  "culture-profiles": {
    id: "cp-1",
    name: "Classical Rome",
    alternateNames: ["Roman"],
    civilizationId: "rome",
    archaeologicalCultureId: null,
    timePeriodStart: -509,
    timePeriodEnd: 476,
    region: "Mediterranean",
    summaryDescription: "The Roman civilization.",
    socialOrganization: "state",
    subsistenceType: "agricultural",
    urbanismLevel: "metropolis",
    populationEstimate: 1000000,
    technologyLevel: "iron",
    associatedLanguageIds: ["lat"],
    sources: ["scraped"],
  },
  cuisines: {
    id: "cui-1",
    name: "Roman cuisine",
    nativeName: "Cibus Romanus",
    region: "Italy",
    coordinates: { lat: 41.9, lng: 12.5 },
    associatedLanguageIds: ["lat"],
    timeOrigin: -509,
    timeEnd: 476,
    description: "Ancient Roman foodways.",
  },
  "trade-goods": {
    id: "tg-1",
    name: "Silk",
    category: "textile",
    originRegion: "China",
    originCoordinates: { lat: 34.3, lng: 108.9 },
    tradeRoutes: ["Silk Road"],
    timePeriod: "Han dynasty",
    economicSignificance: "High",
    associatedLanguages: ["zho"],
  },
  innovations: {
    id: "inv-1",
    name: "Aqueduct",
    category: "engineering",
    cultureProfileIds: ["cp-1"],
    yearInvented: -312,
    regionOfOrigin: "Italy",
    description: "Water-conveyance structure.",
    diffusionPath: [],
    relatedInnovations: [],
    associatedLanguages: ["lat"],
    sources: ["scraped"],
  },
};

describe("summary contract registry", () => {
  it("exposes every declared domain in declaration order", () => {
    expect(summaryDomains()).toEqual(Object.keys(SUMMARY_CONTRACTS));
  });

  it("recognizes known domains and rejects unknown ones", () => {
    expect(isSummaryDomain("religions")).toBe(true);
    expect(isSummaryDomain("nope")).toBe(false);
    expect(isSummaryDomain("")).toBe(false);
  });

  it("every contract leads with id and name and points at a detail endpoint", () => {
    for (const domain of summaryDomains()) {
      const contract = summaryContract(domain);
      expect(contract.fields[0]).toBe("id");
      expect(contract.fields[1]).toBe("name");
      expect(contract.detailEndpoint).toBe(`/api/${domain}/:id`);
      // fields are unique
      expect(new Set(contract.fields).size).toBe(contract.fields.length);
    }
  });

  it("summaryFields returns a fresh, mutation-safe copy", () => {
    const a = summaryFields("religions");
    a.push("mutated");
    expect(summaryFields("religions")).not.toContain("mutated");
  });
});

describe("summary is a strict subset of detail (the core progressive-loading property)", () => {
  it("every summary field is a key of the detail record for that domain", () => {
    for (const domain of summaryDomains()) {
      const detail = DETAIL_FIXTURES[domain];
      for (const field of summaryFields(domain)) {
        expect(Object.prototype.hasOwnProperty.call(detail, field)).toBe(true);
      }
    }
  });

  it("summarizeEntity yields fewer-or-equal keys than the detail record, all shared", () => {
    for (const domain of summaryDomains()) {
      const detail = DETAIL_FIXTURES[domain];
      const summary = summarizeEntity(domain, detail);
      const summaryKeys = Object.keys(summary);
      const detailKeys = Object.keys(detail);
      expect(summaryKeys.length).toBeLessThanOrEqual(detailKeys.length);
      for (const key of summaryKeys) {
        expect(detailKeys).toContain(key);
        expect(summary[key]).toEqual(detail[key]);
      }
    }
  });

  it("drops summary fields absent from the record (never emits undefined keys)", () => {
    const partial: EntityRecord = { id: "x", name: "X" }; // missing nativeName, religionType, …
    const summary = summarizeEntity("religions", partial);
    expect(summary).toEqual({ id: "x", name: "X" });
    expect(Object.prototype.hasOwnProperty.call(summary, "nativeName")).toBe(false);
  });

  it("preserves contract field order", () => {
    const summary = summarizeEntity("battles", DETAIL_FIXTURES.battles);
    expect(Object.keys(summary)).toEqual(["id", "name", "date", "warName", "outcome"]);
  });

  it("does not pull heavy detail fields into the summary", () => {
    const summary = summarizeEntity("religions", DETAIL_FIXTURES.religions);
    expect(summary).not.toHaveProperty("description");
    expect(summary).not.toHaveProperty("deityPantheon");
    expect(summary).not.toHaveProperty("sacredTexts");
    expect(summary).not.toHaveProperty("ritualPractices");
  });
});

describe("paginate", () => {
  const items = [0, 1, 2, 3, 4];

  it("returns the whole array with no options", () => {
    expect(paginate(items)).toEqual({
      items,
      total: 5,
      returned: 5,
      offset: 0,
      limit: null,
      hasMore: false,
    });
  });

  it("applies offset and limit and reports hasMore", () => {
    const page = paginate(items, { offset: 1, limit: 2 });
    expect(page.items).toEqual([1, 2]);
    expect(page).toMatchObject({ total: 5, returned: 2, offset: 1, limit: 2, hasMore: true });
  });

  it("last page has hasMore=false", () => {
    const page = paginate(items, { offset: 3, limit: 2 });
    expect(page.items).toEqual([3, 4]);
    expect(page.hasMore).toBe(false);
  });

  it("clamps out-of-range offset to total", () => {
    const page = paginate(items, { offset: 99, limit: 2 });
    expect(page.items).toEqual([]);
    expect(page).toMatchObject({ offset: 5, returned: 0, hasMore: false });
  });

  it("treats NaN/negative offset as 0 and NaN limit as unbounded", () => {
    expect(paginate(items, { offset: Number.NaN }).items).toEqual(items);
    expect(paginate(items, { offset: -5, limit: 2 }).items).toEqual([0, 1]);
    expect(paginate(items, { limit: Number.NaN }).items).toEqual(items);
  });

  it("limit 0 returns an empty page but reports hasMore", () => {
    const page = paginate(items, { limit: 0 });
    expect(page.items).toEqual([]);
    expect(page).toMatchObject({ returned: 0, limit: 0, hasMore: true });
  });

  it("handles an empty input", () => {
    expect(paginate([], { offset: 2, limit: 3 })).toMatchObject({
      total: 0,
      returned: 0,
      offset: 0,
      hasMore: false,
    });
  });
});

describe("summarizeList", () => {
  const records: EntityRecord[] = [
    DETAIL_FIXTURES.religions,
    { ...DETAIL_FIXTURES.religions, id: "rel-2", name: "Greek polytheism" },
    { ...DETAIL_FIXTURES.religions, id: "rel-3", name: "Egyptian polytheism" },
  ];

  it("projects each record and carries the contract + page metadata", () => {
    const result = summarizeList("religions", records, { offset: 1, limit: 1 });
    expect(result.domain).toBe("religions");
    expect(result.fields).toEqual(summaryFields("religions"));
    expect(result.detailEndpoint).toBe("/api/religions/:id");
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]).toMatchObject({ id: "rel-2", name: "Greek polytheism" });
    expect(result).toMatchObject({ total: 3, returned: 1, offset: 1, limit: 1, hasMore: true });
  });

  it("each summary contains only summary fields (no detail leakage)", () => {
    const result = summarizeList("religions", records);
    for (const summary of result.summaries) {
      expect(Object.keys(summary).every((k) => result.fields.includes(k))).toBe(true);
      expect(summary).not.toHaveProperty("description");
    }
  });
});
