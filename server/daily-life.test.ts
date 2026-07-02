import { describe, it, expect, beforeAll } from "vitest";
import { TsvStorage } from "./tsv-storage";
import type { DailyLife } from "./tsv-storage";

describe("Daily Life TSV Loader", () => {
  let storage: TsvStorage;

  beforeAll(() => {
    storage = new TsvStorage();
  });

  it("loads all daily life entries", async () => {
    const entries = await storage.getDailyLife();
    expect(entries.length).toBeGreaterThan(500);
    expect(entries[0]).toHaveProperty("id");
    expect(entries[0]).toHaveProperty("cultureProfileId");
    expect(entries[0]).toHaveProperty("category");
    expect(entries[0]).toHaveProperty("title");
    expect(entries[0]).toHaveProperty("description");
  });

  it("returns correct fields for a known entry", async () => {
    const entry = await storage.getDailyLifeById("dl-001");
    expect(entry).not.toBeNull();
    expect(entry!.cultureProfileId).toBe("cp-sumerian");
    expect(entry!.category).toBe("housing");
    expect(entry!.title).toBeTruthy();
    expect(entry!.description).toBeTruthy();
    expect(entry!.socialClass).toBeTruthy();
    expect(entry!.genderContext).toBeTruthy();
    expect(entry!.ageGroup).toBeTruthy();
    expect(entry!.season).toBeTruthy();
    expect(entry!.timePeriodStart).toBeTruthy();
    expect(entry!.timePeriodEnd).toBeTruthy();
  });

  it("parses sources as JSON array", async () => {
    const entry = await storage.getDailyLifeById("dl-001");
    expect(entry).not.toBeNull();
    expect(Array.isArray(entry!.sources)).toBe(true);
    expect(entry!.sources.length).toBeGreaterThan(0);
  });

  it("covers at least 30 cultures", async () => {
    const entries = await storage.getDailyLife();
    const cultures = new Set(entries.map((e) => e.cultureProfileId));
    expect(cultures.size).toBeGreaterThanOrEqual(30);
  });

  it("covers all 12 categories", async () => {
    const entries = await storage.getDailyLife();
    const categories = new Set(entries.map((e) => e.category));
    expect(categories).toContain("housing");
    expect(categories).toContain("clothing");
    expect(categories).toContain("diet");
    expect(categories).toContain("occupation");
    expect(categories).toContain("social_customs");
    expect(categories).toContain("education");
    expect(categories).toContain("commerce");
    expect(categories).toContain("law");
    expect(categories).toContain("recreation");
    expect(categories).toContain("hygiene");
    expect(categories).toContain("transportation");
    expect(categories).toContain("timekeeping");
  });

  it("filters by culture_profile_id", async () => {
    const entries = await storage.getDailyLife({ cultureProfileId: "cp-roman" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.cultureProfileId === "cp-roman")).toBe(true);
  });

  it("filters by category", async () => {
    const entries = await storage.getDailyLife({ category: "diet" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.category === "diet")).toBe(true);
  });

  it("filters by social_class", async () => {
    const entries = await storage.getDailyLife({ socialClass: "elite" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.socialClass === "elite" || e.socialClass === "all")).toBe(true);
  });

  it("filters by gender_context", async () => {
    const entries = await storage.getDailyLife({ genderContext: "female" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.genderContext === "female" || e.genderContext === "all")).toBe(true);
  });

  it("returns null for non-existent id", async () => {
    const entry = await storage.getDailyLifeById("dl-nonexistent");
    expect(entry).toBeNull();
  });

  it("groups entries by category for a culture", async () => {
    const grouped = await storage.getDailyLifeByCulture("cp-sumerian");
    expect(Object.keys(grouped).length).toBeGreaterThan(0);
    for (const [category, entries] of Object.entries(grouped)) {
      expect(entries.every((e: DailyLife) => e.category === category)).toBe(true);
      expect(entries.every((e: DailyLife) => e.cultureProfileId === "cp-sumerian")).toBe(true);
    }
  });

  it("has valid category values", async () => {
    const validCategories = new Set([
      "housing", "clothing", "diet", "occupation", "social_customs",
      "education", "commerce", "law", "recreation", "hygiene",
      "transportation", "timekeeping",
    ]);
    const entries = await storage.getDailyLife();
    for (const entry of entries) {
      expect(validCategories.has(entry.category)).toBe(true);
    }
  });

  it("has valid social_class values", async () => {
    const validClasses = new Set([
      "elite", "common", "slave", "priestly", "military", "merchant", "all",
    ]);
    const entries = await storage.getDailyLife();
    for (const entry of entries) {
      expect(validClasses.has(entry.socialClass)).toBe(true);
    }
  });
});
