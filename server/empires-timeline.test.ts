import { describe, it, expect, beforeAll } from "vitest";
import { TsvStorage } from "./tsv-storage";
import type { EmpireTimelineEvent } from "./tsv-storage";

describe("Empire Timeline TSV Loader", () => {
  let storage: TsvStorage;

  beforeAll(() => {
    storage = new TsvStorage();
  });

  it("loads all empire timeline events", async () => {
    const events = await storage.getEmpireTimeline();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty("id");
    expect(events[0]).toHaveProperty("empireId");
    expect(events[0]).toHaveProperty("year");
  });

  it("returns correct fields for a known event", async () => {
    const event = await storage.getEmpireTimelineEventById("et-001");
    expect(event).not.toBeNull();
    expect(event!.empireId).toBe("roman-empire");
    expect(event!.empireName).toBe("Roman Empire");
    expect(event!.year).toBe(-27);
    expect(event!.eventType).toBe("founding");
    expect(event!.capital).toBe("Rome");
    expect(event!.ruler).toBe("Augustus");
    expect(event!.associatedLanguageIds).toContain("latin");
  });

  it("parses JSON array fields correctly", async () => {
    const event = await storage.getEmpireTimelineEventById("et-002");
    expect(event).not.toBeNull();
    expect(Array.isArray(event!.vassalStates)).toBe(true);
    expect(event!.vassalStates.length).toBeGreaterThan(0);
    expect(Array.isArray(event!.rivalEmpires)).toBe(true);
    expect(Array.isArray(event!.associatedLanguageIds)).toBe(true);
  });

  it("parses population as number or null", async () => {
    const event = await storage.getEmpireTimelineEventById("et-001");
    expect(typeof event!.populationEstimate).toBe("number");
    expect(event!.populationEstimate).toBe(45000000);
  });

  it("filters by empire_id", async () => {
    const events = await storage.getEmpireTimeline({ empireId: "roman-empire" });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.empireId === "roman-empire")).toBe(true);
  });

  it("filters by event_type", async () => {
    const events = await storage.getEmpireTimeline({ eventType: "founding" });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.eventType === "founding")).toBe(true);
  });

  it("filters by year range", async () => {
    const events = await storage.getEmpireTimeline({ yearStart: 1200, yearEnd: 1500 });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.year >= 1200 && e.year <= 1500)).toBe(true);
  });

  it("returns null for non-existent event", async () => {
    const event = await storage.getEmpireTimelineEventById("nonexistent");
    expect(event).toBeNull();
  });

  it("returns empty array when no events match filter", async () => {
    const events = await storage.getEmpireTimeline({ empireId: "nonexistent-empire" });
    expect(events).toEqual([]);
  });
});
