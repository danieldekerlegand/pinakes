import { describe, it, expect, beforeAll } from "vitest";
import { TsvStorage } from "./tsv-storage";
import type { DailyLifeEntry } from "./tsv-storage";

describe("Daily Life TSV Loader", () => {
  let storage: TsvStorage;

  beforeAll(() => {
    storage = new TsvStorage();
  });

  it("loads all daily life entries", async () => {
    const entries = await storage.getDailyLife();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty("id");
    expect(entries[0]).toHaveProperty("cultureProfileId");
    expect(entries[0]).toHaveProperty("category");
    expect(entries[0]).toHaveProperty("title");
  });

  it("returns correct fields for a known entry", async () => {
    const entry = await storage.getDailyLifeById("dl-001");
    expect(entry).not.toBeNull();
    expect(entry!.cultureProfileId).toBe("sumerian");
    expect(entry!.category).toBe("housing");
    expect(entry!.title).toBe("Mud-brick houses");
    expect(entry!.socialClass).toBe("common");
    expect(entry!.genderContext).toBe("all");
  });

  it("parses time period fields as numbers", async () => {
    const entry = await storage.getDailyLifeById("dl-001");
    expect(entry).not.toBeNull();
    expect(entry!.timePeriodStart).toBe(-3500);
    expect(entry!.timePeriodEnd).toBe(-2000);
  });

  it("filters by culture_profile_id", async () => {
    const entries = await storage.getDailyLife({ cultureProfileId: "roman" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.cultureProfileId === "roman")).toBe(true);
  });

  it("filters by category", async () => {
    const entries = await storage.getDailyLife({ category: "diet" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.category === "diet")).toBe(true);
  });

  it("filters by social_class", async () => {
    const entries = await storage.getDailyLife({ socialClass: "elite" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.socialClass === "elite")).toBe(true);
  });

  it("filters by gender_context", async () => {
    const entries = await storage.getDailyLife({ genderContext: "male" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.genderContext === "male")).toBe(true);
  });

  it("returns null for non-existent entry", async () => {
    const entry = await storage.getDailyLifeById("nonexistent");
    expect(entry).toBeNull();
  });

  it("returns empty array when no entries match filter", async () => {
    const entries = await storage.getDailyLife({ cultureProfileId: "nonexistent-culture" });
    expect(entries).toEqual([]);
  });

  it("groups entries by category for a culture profile", async () => {
    const grouped = await storage.getDailyLifeByCultureProfile("sumerian");
    expect(Object.keys(grouped).length).toBeGreaterThan(0);
    expect(grouped["housing"]).toBeDefined();
    expect(grouped["housing"]!.length).toBeGreaterThan(0);
    expect(grouped["housing"]![0].cultureProfileId).toBe("sumerian");
  });

  it("returns empty object for non-existent culture profile", async () => {
    const grouped = await storage.getDailyLifeByCultureProfile("nonexistent");
    expect(Object.keys(grouped).length).toBe(0);
  });

  it("combines multiple filters", async () => {
    const entries = await storage.getDailyLife({
      cultureProfileId: "sumerian",
      socialClass: "elite",
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.cultureProfileId === "sumerian" && e.socialClass === "elite")).toBe(true);
  });
});
