import { describe, it, expect } from "vitest";
import {
  validateTimelineEvent,
  serializeTimelineEvent,
  timelineEventToContribution,
  TIMELINE_MIN_YEAR,
  TIMELINE_MAX_YEAR,
  TIMELINE_PROVENANCE,
  type TimelineEventInput,
} from "./timeline-event";

/**
 * Unit tests for the pure timeline-event authoring helpers (US-002): range
 * validation (inverted / out-of-bounds), serialization to the culture-events.tsv
 * row shape, and mapping to a review-queue contribution.
 */

const EVENT: TimelineEventInput = {
  kind: "event",
  cultureProfileId: "cp-sumerian",
  title: "Emergence of Sumerian City-States",
  lane: "political",
  eventType: "founding",
  magnitude: "major",
  timePeriodStart: -4500,
  description: "Independent city-states form in southern Mesopotamia.",
  sources: [{ title: "Kramer, The Sumerians" }],
  confidence: 70,
};

const PERIOD: TimelineEventInput = {
  kind: "period",
  cultureProfileId: "roman-empire",
  title: "Pax Romana",
  lane: "political",
  eventType: "era",
  magnitude: "major",
  timePeriodStart: -27,
  timePeriodEnd: 180,
};

describe("validateTimelineEvent", () => {
  it("accepts a valid point-in-time event", () => {
    const r = validateTimelineEvent(EVENT);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a valid dated period", () => {
    const r = validateTimelineEvent(PERIOD);
    expect(r.valid).toBe(true);
  });

  it("requires an associated entity", () => {
    const r = validateTimelineEvent({ ...EVENT, cultureProfileId: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /cultureProfileId/.test(e))).toBe(true);
  });

  it("requires a title", () => {
    const r = validateTimelineEvent({ ...EVENT, title: "   " });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /title/.test(e))).toBe(true);
  });

  it("rejects an unknown lane", () => {
    const r = validateTimelineEvent({ ...EVENT, lane: "banana" as never });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /lane/.test(e))).toBe(true);
  });

  it("rejects an unknown magnitude", () => {
    const r = validateTimelineEvent({ ...EVENT, magnitude: "huge" as never });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /magnitude/.test(e))).toBe(true);
  });

  it("rejects a missing start year", () => {
    const r = validateTimelineEvent({ ...EVENT, timePeriodStart: undefined as never });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /timePeriodStart is required/.test(e))).toBe(true);
  });

  it("requires an end year for a period", () => {
    const r = validateTimelineEvent({ ...PERIOD, timePeriodEnd: null });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /timePeriodEnd is required/.test(e))).toBe(true);
  });

  it("rejects an inverted period range", () => {
    const r = validateTimelineEvent({ ...PERIOD, timePeriodStart: 180, timePeriodEnd: -27 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /inverted range/.test(e))).toBe(true);
  });

  it("warns when a period collapses to a single year", () => {
    const r = validateTimelineEvent({ ...PERIOD, timePeriodStart: 100, timePeriodEnd: 100 });
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => /point in time/.test(w))).toBe(true);
  });

  it("rejects an event carrying a divergent end year", () => {
    const r = validateTimelineEvent({ ...EVENT, timePeriodEnd: -4000 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /single point in time/.test(e))).toBe(true);
  });

  it("rejects an out-of-bounds start year (too early)", () => {
    const r = validateTimelineEvent({ ...EVENT, timePeriodStart: TIMELINE_MIN_YEAR - 1 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /out of bounds/.test(e))).toBe(true);
  });

  it("rejects an out-of-bounds end year (too late)", () => {
    const r = validateTimelineEvent({
      ...PERIOD,
      timePeriodStart: 1900,
      timePeriodEnd: TIMELINE_MAX_YEAR + 100,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /out of bounds/.test(e))).toBe(true);
  });

  it("honors a tightened bounds window", () => {
    const r = validateTimelineEvent({ ...EVENT, timePeriodStart: -4500 }, { min: -1000, max: 500 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /out of bounds/.test(e))).toBe(true);
  });

  it("warns when confidence is omitted", () => {
    const { confidence, ...rest } = EVENT;
    void confidence;
    const r = validateTimelineEvent(rest);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => /confidence/.test(w))).toBe(true);
  });

  it("rejects out-of-range confidence", () => {
    const r = validateTimelineEvent({ ...EVENT, confidence: 999 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /confidence/.test(e))).toBe(true);
  });
});

describe("serializeTimelineEvent", () => {
  it("produces the culture-events.tsv row shape with year = start", () => {
    const row = serializeTimelineEvent(EVENT);
    expect(row).toEqual({
      culture_profile_id: "cp-sumerian",
      year: -4500,
      lane: "political",
      event_type: "founding",
      title: "Emergence of Sumerian City-States",
      description: "Independent city-states form in southern Mesopotamia.",
      magnitude: "major",
      sources: JSON.stringify(["Kramer, The Sumerians"]),
    });
  });

  it("defaults event_type and magnitude, and empties missing sources/description", () => {
    const row = serializeTimelineEvent({
      kind: "event",
      cultureProfileId: "cp-x",
      title: "X",
      lane: "economy",
      timePeriodStart: 500,
    });
    expect(row.event_type).toBe("event");
    expect(row.magnitude).toBe("moderate");
    expect(row.description).toBe("");
    expect(row.sources).toBe("[]");
  });

  it("uses the start year for a period", () => {
    expect(serializeTimelineEvent(PERIOD).year).toBe(-27);
  });
});

describe("timelineEventToContribution", () => {
  it("maps to a queued contribution with user-authored provenance", () => {
    const c = timelineEventToContribution(EVENT);
    expect(c.entityType).toBe("timeline-event");
    expect(c.action).toBe("add");
    expect(c.entityId).toBe("cp-sumerian");
    expect(c.confidence).toBe(70);
    expect(c.entityData?.source).toBe(TIMELINE_PROVENANCE);
    expect(c.entityData?.timePeriodEnd).toBeNull();
    expect(c.entityData?.serialized).toBeDefined();
  });

  it("carries the full range for a period", () => {
    const c = timelineEventToContribution(PERIOD);
    expect(c.entityData?.timePeriodStart).toBe(-27);
    expect(c.entityData?.timePeriodEnd).toBe(180);
  });

  it("defaults confidence to 60 and supplies a placeholder source", () => {
    const c = timelineEventToContribution({
      kind: "event",
      cultureProfileId: "cp-y",
      title: "Y",
      lane: "religion",
      timePeriodStart: 1200,
    });
    expect(c.confidence).toBe(60);
    expect(c.sources?.[0].title).toMatch(/User-authored/);
  });
});
