import { describe, it, expect } from "vitest";

import {
  summaryListKey,
  detailKey,
  mergeSummaryDetail,
} from "./progressive-loading";

/**
 * Pure unit tests for the client progressive summary/detail helpers (US-004).
 * These assert the query keys map to the right URLs (per the shared getQueryFn
 * URL-building convention) and that summary→detail merging is lossless.
 */

describe("summaryListKey", () => {
  it("builds a bare list key when no pagination is given", () => {
    expect(summaryListKey("religions")).toEqual(["/api/summaries", "religions"]);
  });

  it("appends offset/limit as an object part (→ query params)", () => {
    expect(summaryListKey("battles", { offset: 10, limit: 5 })).toEqual([
      "/api/summaries",
      "battles",
      { offset: 10, limit: 5 },
    ]);
  });

  it("includes only the provided pagination fields", () => {
    expect(summaryListKey("languages", { limit: 20 })).toEqual([
      "/api/summaries",
      "languages",
      { limit: 20 },
    ]);
    // offset:0 is a real value, not omitted
    expect(summaryListKey("languages", { offset: 0 })).toEqual([
      "/api/summaries",
      "languages",
      { offset: 0 },
    ]);
  });
});

describe("detailKey", () => {
  it("points at the canonical per-entity detail endpoint", () => {
    expect(detailKey("religions", "rel-1")).toEqual(["/api/religions", "rel-1"]);
    expect(detailKey("culture-profiles", "cp-1")).toEqual(["/api/culture-profiles", "cp-1"]);
  });
});

describe("mergeSummaryDetail", () => {
  const summary = { id: "rel-1", name: "Roman polytheism", religionType: "polytheism" };

  it("returns a summary copy while detail is absent", () => {
    const merged = mergeSummaryDetail(summary, undefined);
    expect(merged).toEqual(summary);
    expect(merged).not.toBe(summary); // fresh object
  });

  it("overlays detail fields, preserving every summary field (lossless)", () => {
    const detail = {
      id: "rel-1",
      name: "Roman polytheism",
      religionType: "polytheism",
      description: "The polytheistic religion of ancient Rome.",
      deityPantheon: ["Jupiter"],
    };
    const merged = mergeSummaryDetail(summary, detail);
    expect(merged).toMatchObject(summary); // no summary field lost
    expect(merged.description).toBe(detail.description);
    expect(merged.deityPantheon).toEqual(["Jupiter"]);
  });

  it("treats null detail like absent detail", () => {
    expect(mergeSummaryDetail(summary, null)).toEqual(summary);
  });
});
