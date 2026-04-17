import { describe, it, expect } from "vitest";

/**
 * Unit tests for the section's site-matching logic.
 * Functions are replicated locally (matching the existing test pattern
 * in this directory) so tests can run without crossing into modules
 * that transitively pull in React / JSX.
 */

interface RawSiteProperties {
  siteId: string;
  name: string;
  siteType: string;
  timePeriod: { start: number; end: number | null; label: string };
  associatedLanguageIds: string[];
  associatedCultureIds: string[];
  excavationStatus: string;
  findings: string[];
  importance: number;
  confidence: number;
  description?: string;
}

interface RawSiteFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: RawSiteProperties;
}

interface CultureSiteFilterOpts {
  languageIds?: string[];
  notableSettlements?: string[];
  timePeriodStart?: number;
  timePeriodEnd?: number;
}

function filterSitesForCulture(
  sites: RawSiteFeature[],
  opts: CultureSiteFilterOpts,
): RawSiteFeature[] {
  const langSet = new Set((opts.languageIds ?? []).map((l) => l.toLowerCase()));
  const settlementSet = new Set(
    (opts.notableSettlements ?? []).map((n) => n.trim().toLowerCase()),
  );
  const hasAnyMatcher = langSet.size > 0 || settlementSet.size > 0;

  return sites.filter((site) => {
    const props = site.properties;
    let matches = !hasAnyMatcher;
    if (settlementSet.has(props.name.trim().toLowerCase())) matches = true;
    if (!matches) {
      for (const lang of props.associatedLanguageIds) {
        if (langSet.has(lang.toLowerCase())) {
          matches = true;
          break;
        }
      }
    }
    if (!matches) return false;

    if (
      opts.timePeriodStart !== undefined &&
      opts.timePeriodEnd !== undefined
    ) {
      const sStart = props.timePeriod.start;
      const sEnd = props.timePeriod.end ?? new Date().getFullYear();
      if (sEnd < opts.timePeriodStart || sStart > opts.timePeriodEnd) {
        return false;
      }
    }
    return true;
  });
}

function rankSites(sites: RawSiteFeature[]): RawSiteFeature[] {
  return [...sites].sort((a, b) => {
    const ai = a.properties.importance ?? 0;
    const bi = b.properties.importance ?? 0;
    if (ai !== bi) return bi - ai;
    return a.properties.name.localeCompare(b.properties.name);
  });
}

function toReconstruction(site: RawSiteFeature) {
  const p = site.properties;
  return {
    id: p.siteId,
    name: p.name,
    siteType: p.siteType,
    timePeriodStart: p.timePeriod.start,
    timePeriodEnd: p.timePeriod.end,
    timePeriodLabel: p.timePeriod.label,
    findings: p.findings,
    importance: p.importance,
    confidence: p.confidence,
    description: p.description ?? "",
    excavationStatus: p.excavationStatus,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────

function makeSite(overrides: Partial<RawSiteProperties> & Pick<RawSiteProperties, "siteId" | "name">): RawSiteFeature {
  return {
    type: "Feature",
    id: overrides.siteId,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      siteType: "settlement",
      timePeriod: { start: -500, end: 100, label: "" },
      associatedLanguageIds: [],
      associatedCultureIds: [],
      excavationStatus: "partial",
      findings: [],
      importance: 50,
      confidence: 80,
      description: "",
      ...overrides,
    } as RawSiteProperties,
  };
}

const POMPEII = makeSite({
  siteId: "pompeii",
  name: "Pompeii",
  siteType: "settlement",
  associatedLanguageIds: ["lat"],
  timePeriod: { start: -600, end: 79, label: "Roman" },
  importance: 95,
});
const KARNAK = makeSite({
  siteId: "karnak",
  name: "Karnak",
  siteType: "temple",
  associatedLanguageIds: ["egy"],
  timePeriod: { start: -2000, end: -30, label: "Egyptian" },
  importance: 90,
});
const OUT_OF_RANGE = makeSite({
  siteId: "modern",
  name: "Modern Site",
  associatedLanguageIds: ["lat"],
  timePeriod: { start: 1800, end: 1900, label: "Modern" },
  importance: 20,
});

// ── Tests ────────────────────────────────────────────────────────────

describe("filterSitesForCulture", () => {
  it("matches by language overlap", () => {
    const result = filterSitesForCulture([POMPEII, KARNAK], { languageIds: ["lat"] });
    expect(result.map((s) => s.properties.siteId)).toEqual(["pompeii"]);
  });

  it("matches by settlement name case-insensitively", () => {
    const result = filterSitesForCulture([POMPEII, KARNAK], {
      notableSettlements: ["pompeii"],
    });
    expect(result.map((s) => s.properties.siteId)).toEqual(["pompeii"]);
  });

  it("matches either by name or language", () => {
    const result = filterSitesForCulture([POMPEII, KARNAK], {
      languageIds: ["grc"],
      notableSettlements: ["Karnak"],
    });
    expect(result.map((s) => s.properties.siteId)).toEqual(["karnak"]);
  });

  it("returns everything when no matchers are provided", () => {
    const result = filterSitesForCulture([POMPEII, KARNAK], {});
    expect(result).toHaveLength(2);
  });

  it("filters out sites outside the culture's time range", () => {
    const result = filterSitesForCulture([POMPEII, OUT_OF_RANGE], {
      languageIds: ["lat"],
      timePeriodStart: -700,
      timePeriodEnd: 500,
    });
    expect(result.map((s) => s.properties.siteId)).toEqual(["pompeii"]);
  });

  it("handles null time-period end as 'to present'", () => {
    const live = makeSite({
      siteId: "live",
      name: "Living Site",
      associatedLanguageIds: ["lat"],
      timePeriod: { start: 0, end: null, label: "" },
    });
    const result = filterSitesForCulture([live], {
      languageIds: ["lat"],
      timePeriodStart: 500,
      timePeriodEnd: 1000,
    });
    expect(result).toHaveLength(1);
  });
});

describe("rankSites", () => {
  it("sorts by descending importance, then by name", () => {
    const low = makeSite({
      siteId: "low-b",
      name: "Beta",
      importance: 40,
    });
    const low2 = makeSite({
      siteId: "low-a",
      name: "Alpha",
      importance: 40,
    });
    const sorted = rankSites([low, KARNAK, low2, POMPEII]);
    expect(sorted.map((s) => s.properties.siteId)).toEqual([
      "pompeii", // 95
      "karnak", // 90
      "low-a", // 40 Alpha
      "low-b", // 40 Beta
    ]);
  });

  it("does not mutate the input", () => {
    const input = [KARNAK, POMPEII];
    const before = input.map((s) => s.properties.siteId);
    rankSites(input);
    expect(input.map((s) => s.properties.siteId)).toEqual(before);
  });
});

describe("toReconstruction", () => {
  it("projects a site feature onto the viewer's reconstruction shape", () => {
    const r = toReconstruction(POMPEII);
    expect(r).toMatchObject({
      id: "pompeii",
      name: "Pompeii",
      siteType: "settlement",
      timePeriodStart: -600,
      timePeriodEnd: 79,
      importance: 95,
      confidence: 80,
    });
  });

  it("defaults missing description to an empty string", () => {
    const noDesc = makeSite({
      siteId: "x",
      name: "X",
      description: undefined,
    });
    expect(toReconstruction(noDesc).description).toBe("");
  });
});
