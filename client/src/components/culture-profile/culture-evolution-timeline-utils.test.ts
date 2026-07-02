import { describe, it, expect } from "vitest";
import {
  type CultureEvent,
  LANE_ORDER,
  formatYear,
  formatYearRange,
  getLaneDefinition,
  getEventRadius,
  groupEventsByLane,
  getUsedLanes,
  getTimeBounds,
  yearToX,
  xToYear,
  getAxisTicks,
  activeEventsAtYear,
  summarizeStateAtYear,
} from "./culture-evolution-timeline-utils";

const sampleEvents: CultureEvent[] = [
  {
    id: "ce-001",
    cultureProfileId: "cp-test",
    year: -500,
    lane: "political",
    eventType: "founding",
    title: "Founding",
    description: "The city is founded.",
    magnitude: "major",
    sources: [],
  },
  {
    id: "ce-002",
    cultureProfileId: "cp-test",
    year: -200,
    lane: "technology",
    eventType: "innovation",
    title: "New tech",
    description: "Iron tools.",
    magnitude: "moderate",
    sources: [],
  },
  {
    id: "ce-003",
    cultureProfileId: "cp-test",
    year: 100,
    lane: "political",
    eventType: "transition",
    title: "Republic falls",
    description: "Empire begins.",
    magnitude: "major",
    sources: [],
  },
  {
    id: "ce-004",
    cultureProfileId: "cp-test",
    year: 300,
    lane: "religion",
    eventType: "reform",
    title: "Conversion",
    description: "State religion adopted.",
    magnitude: "moderate",
    sources: [],
  },
];

describe("formatYear", () => {
  it("formats BCE years", () => {
    expect(formatYear(-500)).toBe("500 BCE");
    expect(formatYear(-1)).toBe("1 BCE");
  });

  it("formats CE years", () => {
    expect(formatYear(100)).toBe("100 CE");
    expect(formatYear(2025)).toBe("2025 CE");
  });

  it("formats year 0 as CE", () => {
    expect(formatYear(0)).toBe("0 CE");
  });
});

describe("formatYearRange", () => {
  it("joins start and end with en dash", () => {
    expect(formatYearRange(-500, 100)).toBe("500 BCE \u2013 100 CE");
  });
});

describe("getLaneDefinition", () => {
  it("returns the matching lane", () => {
    const lane = getLaneDefinition("political");
    expect(lane.key).toBe("political");
    expect(lane.label).toBe("Political");
  });

  it("is case-insensitive", () => {
    expect(getLaneDefinition("RELIGION").key).toBe("religion");
  });

  it("returns a fallback for unknown lanes", () => {
    const lane = getLaneDefinition("unknown-lane");
    expect(lane.color).toBe("#6b7280");
    expect(lane.label).toBe("unknown-lane");
  });
});

describe("getEventRadius", () => {
  it("maps magnitudes to radii", () => {
    expect(getEventRadius("major")).toBe(7);
    expect(getEventRadius("moderate")).toBe(5);
    expect(getEventRadius("minor")).toBe(3);
  });

  it("has a fallback radius", () => {
    expect(getEventRadius("anything-else")).toBe(4);
  });
});

describe("groupEventsByLane", () => {
  it("buckets events by lane", () => {
    const grouped = groupEventsByLane(sampleEvents);
    expect(grouped.get("political")).toHaveLength(2);
    expect(grouped.get("technology")).toHaveLength(1);
    expect(grouped.get("religion")).toHaveLength(1);
    expect(grouped.get("language")).toHaveLength(0);
  });

  it("returns every known lane as a key", () => {
    const grouped = groupEventsByLane([]);
    for (const lane of LANE_ORDER) {
      expect(grouped.has(lane.key)).toBe(true);
    }
  });
});

describe("getUsedLanes", () => {
  it("returns only lanes that have events", () => {
    const used = getUsedLanes(sampleEvents);
    const keys = used.map((l) => l.key);
    expect(keys).toContain("political");
    expect(keys).toContain("technology");
    expect(keys).toContain("religion");
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("territory");
  });

  it("preserves canonical lane order", () => {
    const used = getUsedLanes(sampleEvents).map((l) => l.key);
    const canonical = LANE_ORDER.map((l) => l.key);
    const filtered = canonical.filter((k) => used.includes(k));
    expect(used).toEqual(filtered);
  });
});

describe("getTimeBounds", () => {
  it("expands bounds to include all events", () => {
    const bounds = getTimeBounds(-400, 200, sampleEvents);
    expect(bounds.start).toBeLessThanOrEqual(-500);
    expect(bounds.end).toBeGreaterThanOrEqual(300);
  });

  it("falls back to profile bounds when there are no events", () => {
    const bounds = getTimeBounds(-100, 100, []);
    expect(bounds.start).toBeLessThanOrEqual(-100);
    expect(bounds.end).toBeGreaterThanOrEqual(100);
  });

  it("adds padding around the span", () => {
    const bounds = getTimeBounds(0, 1000, []);
    expect(bounds.start).toBeLessThan(0);
    expect(bounds.end).toBeGreaterThan(1000);
  });
});

describe("yearToX / xToYear", () => {
  const bounds = { start: -500, end: 500 };
  const width = 1000;

  it("maps start to 0 and end to width", () => {
    expect(yearToX(bounds.start, bounds, width)).toBe(0);
    expect(yearToX(bounds.end, bounds, width)).toBe(width);
  });

  it("maps midpoint proportionally", () => {
    expect(yearToX(0, bounds, width)).toBeCloseTo(500, 5);
  });

  it("is invertible with xToYear", () => {
    const year = 200;
    const x = yearToX(year, bounds, width);
    expect(xToYear(x, bounds, width)).toBe(year);
  });

  it("handles zero-width safely", () => {
    expect(xToYear(42, bounds, 0)).toBe(bounds.start);
  });
});

describe("getAxisTicks", () => {
  it("returns ticks within bounds", () => {
    const ticks = getAxisTicks({ start: -500, end: 500 }, 6);
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(-500);
      expect(t).toBeLessThanOrEqual(500);
    }
  });

  it("handles degenerate spans", () => {
    const ticks = getAxisTicks({ start: 100, end: 100 }, 6);
    expect(ticks).toEqual([100]);
  });

  it("produces roughly the requested count", () => {
    const ticks = getAxisTicks({ start: 0, end: 1000 }, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(12);
  });
});

describe("activeEventsAtYear", () => {
  it("returns events within the window", () => {
    const active = activeEventsAtYear(sampleEvents, -180, 50);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("ce-002");
  });

  it("returns empty when nothing is nearby", () => {
    expect(activeEventsAtYear(sampleEvents, 5000, 10)).toHaveLength(0);
  });
});

describe("summarizeStateAtYear", () => {
  it("returns the most recent event per lane up to the given year", () => {
    const state = summarizeStateAtYear(sampleEvents, 250);
    expect(state.political?.id).toBe("ce-003");
    expect(state.technology?.id).toBe("ce-002");
    expect(state.religion).toBeNull();
  });

  it("returns all lanes even when no events match", () => {
    const state = summarizeStateAtYear(sampleEvents, -10000);
    for (const lane of LANE_ORDER) {
      expect(state[lane.key]).toBeNull();
    }
  });

  it("includes events that happen at exactly the query year", () => {
    const state = summarizeStateAtYear(sampleEvents, 300);
    expect(state.religion?.id).toBe("ce-004");
  });
});
