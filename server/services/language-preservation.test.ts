import { describe, it, expect } from "vitest";

import {
  buildFieldUpdateContribution,
  changedFields,
  computePreservationMetrics,
  fieldUpdateSummary,
  normalizeStatus,
  validateFieldUpdate,
  type FieldUpdateInput,
  type PreservationLanguage,
} from "./language-preservation";

describe("normalizeStatus", () => {
  it("maps canonical and messy spellings onto vitality levels + categories", () => {
    expect(normalizeStatus("living")).toMatchObject({ key: "living", category: "living" });
    expect(normalizeStatus("Living")).toMatchObject({ key: "living", category: "living" });
    expect(normalizeStatus("extinct")).toMatchObject({ key: "extinct", category: "extinct" });
    expect(normalizeStatus("Critically Endangered")).toMatchObject({
      key: "critically-endangered",
      category: "endangered",
    });
    expect(normalizeStatus("vulnerable")).toMatchObject({ key: "vulnerable", category: "endangered" });
    expect(normalizeStatus("dormant")).toMatchObject({ key: "dormant", category: "extinct" });
    expect(normalizeStatus("revitalizing")).toMatchObject({ key: "revitalizing", category: "endangered" });
  });

  it("tolerates corpus typos and qualified variants via fallbacks", () => {
    expect(normalizeStatus("definiteley endangered").key).toBe("definitely-endangered");
    expect(normalizeStatus("Severely Endangered").key).toBe("severely-endangered");
    expect(normalizeStatus("moderately endangered").category).toBe("endangered");
  });

  it("classifies blank / missing / unrecognized as unknown (never mis-bucketed as living)", () => {
    expect(normalizeStatus("").category).toBe("unknown");
    expect(normalizeStatus("   ").category).toBe("unknown");
    expect(normalizeStatus(null).category).toBe("unknown");
    expect(normalizeStatus(undefined).category).toBe("unknown");
    expect(normalizeStatus("gibberish").category).toBe("unknown");
  });
});

const LANGS: PreservationLanguage[] = [
  { id: "en", name: "English", region: "Global", status: "living", totalSpeakers: 1_000 },
  { id: "es", name: "Spanish", region: "Global", status: "Living", totalSpeakers: 500 },
  { id: "cy", name: "Welsh", region: "Europe", status: "vulnerable", totalSpeakers: 100 },
  { id: "gd", name: "Scottish Gaelic", region: "Europe", status: "critically endangered", totalSpeakers: 10 },
  { id: "kw", name: "Cornish", region: "Europe", status: "revitalizing", totalSpeakers: 5 },
  { id: "la", name: "Latin", region: "Europe", status: "extinct", totalSpeakers: 0 },
  { id: "xx", name: "Mystery", region: "", status: "", totalSpeakers: null },
];

describe("computePreservationMetrics", () => {
  const metrics = computePreservationMetrics(LANGS);

  it("counts per coarse category, treating blanks as unknown", () => {
    expect(metrics.total).toBe(7);
    expect(metrics.byCategory).toEqual({ living: 2, endangered: 3, extinct: 1, unknown: 1 });
    expect(metrics.classified).toBe(6);
  });

  it("produces a vitality breakdown ordered by risk with shares", () => {
    const keys = metrics.vitality.map((v) => v.key);
    // living (rank 0) before revitalizing (1) before vulnerable (2) before critically (6) before extinct (9) before unknown (-1 → last).
    expect(keys.indexOf("living")).toBeLessThan(keys.indexOf("vulnerable"));
    expect(keys.indexOf("vulnerable")).toBeLessThan(keys.indexOf("critically-endangered"));
    expect(keys.indexOf("critically-endangered")).toBeLessThan(keys.indexOf("extinct"));
    const living = metrics.vitality.find((v) => v.key === "living");
    expect(living?.count).toBe(2);
    expect(living?.share).toBeCloseTo(2 / 7, 5);
  });

  it("computes endangerment rate over still-spoken languages and speakers-at-risk", () => {
    // endangered 3 / (living 2 + endangered 3) = 0.6
    expect(metrics.endangermentRate).toBeCloseTo(0.6, 5);
    // 100 + 10 + 5 endangered speakers
    expect(metrics.speakersAtRisk).toBe(115);
  });

  it("ranks regions by endangerment rate", () => {
    const europe = metrics.regions.find((r) => r.region === "Europe");
    expect(europe).toMatchObject({ endangered: 3, extinct: 1, living: 0 });
    // Europe (3/3 still-spoken endangered = 1.0) outranks Global (0.0).
    expect(metrics.regions[0].region).toBe("Europe");
    const global = metrics.regions.find((r) => r.region === "Global");
    expect(global?.endangermentRate).toBe(0);
  });

  it("watchlists most-endangered still-spoken languages first, capped by limit", () => {
    const capped = computePreservationMetrics(LANGS, { watchlistLimit: 2 });
    expect(capped.watchlist).toHaveLength(2);
    // Scottish Gaelic (critically, rank 6) ahead of vulnerable/revitalizing.
    expect(capped.watchlist[0].id).toBe("gd");
    // Extinct + unknown languages never appear on the watchlist.
    expect(metrics.watchlist.some((w) => w.id === "la" || w.id === "xx")).toBe(false);
  });

  it("handles an empty corpus without dividing by zero", () => {
    const empty = computePreservationMetrics([]);
    expect(empty.total).toBe(0);
    expect(empty.endangermentRate).toBe(0);
    expect(empty.watchlist).toEqual([]);
  });
});

describe("field-research update workflow", () => {
  const base: FieldUpdateInput = {
    languageId: "cy",
    languageName: "Welsh",
    researcherName: "Dr. Jones",
    status: "endangered",
    sources: [{ title: "2026 field survey", url: "https://example.org/survey" }],
    currentStatus: "vulnerable",
  };

  it("validates required attribution, sources, and at least one change", () => {
    expect(validateFieldUpdate(base).valid).toBe(true);

    expect(validateFieldUpdate({ ...base, researcherName: "" }).errors.join(" ")).toMatch(/researcherName/);
    expect(validateFieldUpdate({ ...base, sources: [] }).errors.join(" ")).toMatch(/source/);
    expect(
      validateFieldUpdate({ languageId: "cy", researcherName: "X", sources: base.sources }).errors.join(" "),
    ).toMatch(/at least one changed field/);
    expect(validateFieldUpdate({ ...base, languageId: "" }).errors.join(" ")).toMatch(/languageId/);
  });

  it("rejects negative speaker counts and out-of-range confidence", () => {
    expect(validateFieldUpdate({ ...base, totalSpeakers: -5 }).valid).toBe(false);
    expect(validateFieldUpdate({ ...base, confidence: 500 }).valid).toBe(false);
  });

  it("warns (but stays valid) on an unrecognized proposed status", () => {
    const result = validateFieldUpdate({ ...base, status: "quite rare" });
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/not a recognized vitality level/);
  });

  it("reports the changed fields in a stable order", () => {
    expect(changedFields(base)).toEqual(["status"]);
    expect(changedFields({ ...base, totalSpeakers: 90, region: "Wales" })).toEqual([
      "status",
      "totalSpeakers",
      "region",
    ]);
  });

  it("builds a language edit contribution with field-research provenance", () => {
    const contribution = buildFieldUpdateContribution(base);
    expect(contribution.entityType).toBe("language");
    expect(contribution.action).toBe("edit");
    expect(contribution.entityId).toBe("cy");
    expect(contribution.contributorName).toBe("Dr. Jones");
    expect(contribution.entityData).toMatchObject({
      name: "Welsh",
      status: "endangered",
      source: "field-research",
      fieldResearch: true,
    });
    // Single-field change → per-field edit metadata.
    expect(contribution.fieldName).toBe("status");
    expect(contribution.currentValue).toBe("vulnerable");
    expect(contribution.suggestedValue).toBe("endangered");
    expect(contribution.confidence).toBe(60);
  });

  it("summarizes a status change for the changelog", () => {
    expect(fieldUpdateSummary(base)).toMatch(/status vulnerable → endangered/);
    expect(fieldUpdateSummary(base)).toMatch(/field research by Dr\. Jones/);
  });
});
