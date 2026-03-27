import { describe, it, expect, beforeAll } from "vitest";
import { TsvStorage } from "../tsv-storage";
import { CrossDomainTimeline } from "./cross-domain-timeline";
import type { CrossDomainTimelineResult, TimelineDomain } from "./cross-domain-timeline";

describe("CrossDomainTimeline", () => {
  let storage: TsvStorage;
  let timeline: CrossDomainTimeline;

  beforeAll(() => {
    storage = new TsvStorage();
    timeline = new CrossDomainTimeline(storage);
  });

  it("loads events from all domains", async () => {
    const result = await timeline.getTimeline();
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.count).toBe(result.events.length);
    expect(result.domains.length).toBeGreaterThan(0);
    expect(result.temporalRange.min).toBeLessThan(result.temporalRange.max);
  });

  it("every event has required fields", async () => {
    const result = await timeline.getTimeline();
    for (const event of result.events) {
      expect(event.id).toBeTruthy();
      expect(event.name).toBeTruthy();
      expect(event.domain).toBeTruthy();
      expect(typeof event.startYear).toBe("number");
      expect(Array.isArray(event.associatedLanguageIds)).toBe(true);
    }
  });

  it("events are sorted by startYear", async () => {
    const result = await timeline.getTimeline();
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].startYear).toBeGreaterThanOrEqual(
        result.events[i - 1].startYear,
      );
    }
  });

  it("filters by single domain", async () => {
    const result = await timeline.getTimeline({ domains: ["empire"] });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e) => e.domain === "empire")).toBe(true);
  });

  it("filters by multiple domains", async () => {
    const domains: TimelineDomain[] = ["empire", "battle"];
    const result = await timeline.getTimeline({ domains });
    expect(result.events.length).toBeGreaterThan(0);
    expect(
      result.events.every((e) => domains.includes(e.domain)),
    ).toBe(true);
  });

  it("filters by year range", async () => {
    const result = await timeline.getTimeline({
      yearStart: -500,
      yearEnd: 500,
    });
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      // Event must overlap with [-500, 500]
      const end = event.endYear ?? event.startYear;
      expect(end).toBeGreaterThanOrEqual(-500);
      expect(event.startYear).toBeLessThanOrEqual(500);
    }
  });

  it("returns empty when filtering to non-existent domain data range", async () => {
    // Very far future should have no data
    const result = await timeline.getTimeline({ yearStart: 50000 });
    expect(result.events.length).toBe(0);
  });

  it("includes empire events with aggregated spans", async () => {
    const result = await timeline.getTimeline({ domains: ["empire"] });
    // Empire events should be spans (endYear != null for most)
    const spanned = result.events.filter((e) => e.endYear != null);
    expect(spanned.length).toBeGreaterThan(0);
  });

  it("includes battle events as point events", async () => {
    const result = await timeline.getTimeline({ domains: ["battle"] });
    expect(result.events.length).toBeGreaterThan(0);
    // Battles are point events (endYear null)
    const points = result.events.filter((e) => e.endYear == null);
    expect(points.length).toBeGreaterThan(0);
  });

  it("includes civilization events", async () => {
    const result = await timeline.getTimeline({ domains: ["civilization"] });
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("temporal range reflects actual data bounds", async () => {
    const result = await timeline.getTimeline();
    const actualMin = Math.min(...result.events.map((e) => e.startYear));
    const actualMax = Math.max(
      ...result.events.map((e) => e.endYear ?? e.startYear),
    );
    expect(result.temporalRange.min).toBe(actualMin);
    expect(result.temporalRange.max).toBe(actualMax);
  });

  it("domain list in result matches event domains", async () => {
    const result = await timeline.getTimeline();
    const eventDomains = new Set(result.events.map((e) => e.domain));
    expect(new Set(result.domains)).toEqual(eventDomains);
  });
});
