import { describe, it, expect } from "vitest";
import {
  extractProvenance,
  hasProvenance,
  classifyProvenance,
  isLowConfidence,
  formatConfidence,
  safeExternalUrl,
  LOW_CONFIDENCE_THRESHOLD,
  type Provenance,
} from "./provenance";

describe("extractProvenance", () => {
  it("normalises the culture-scrape provenance columns", () => {
    expect(
      extractProvenance({
        source: "Cookbook of Valencia",
        source_url: "https://example.org/paella",
        retrieved_at: "2026-01-01",
        confidence: 0.9,
      }),
    ).toEqual({
      source: "Cookbook of Valencia",
      sourceUrl: "https://example.org/paella",
      retrievedAt: "2026-01-01",
      confidence: 0.9,
    });
  });

  it("accepts camelCase aliases and coerces numeric confidence strings", () => {
    expect(
      extractProvenance({ sourceUrl: "https://x.test", confidence: "0.4" }),
    ).toEqual({
      source: null,
      sourceUrl: "https://x.test",
      retrievedAt: null,
      confidence: 0.4,
    });
  });

  it("falls back to source_query when source is absent", () => {
    expect(extractProvenance({ source_query: "Smith 1990" }).source).toBe(
      "Smith 1990",
    );
  });

  it("returns all-null for empty / missing properties", () => {
    const empty: Provenance = {
      source: null,
      sourceUrl: null,
      retrievedAt: null,
      confidence: null,
    };
    expect(extractProvenance({})).toEqual(empty);
    expect(extractProvenance(null)).toEqual(empty);
    expect(extractProvenance(undefined)).toEqual(empty);
  });
});

describe("hasProvenance", () => {
  it("is false only when every field is null", () => {
    expect(hasProvenance(extractProvenance({}))).toBe(false);
    expect(hasProvenance(null)).toBe(false);
    expect(hasProvenance(extractProvenance({ confidence: 0.1 }))).toBe(true);
    expect(hasProvenance(extractProvenance({ source: "x" }))).toBe(true);
  });
});

describe("classifyProvenance — sourced vs derived", () => {
  it("classifies a fact with a citation URL as sourced", () => {
    expect(
      classifyProvenance(extractProvenance({ source_url: "https://x.test" })),
    ).toBe("sourced");
  });

  it("classifies a fact with a non-inference source as sourced", () => {
    expect(
      classifyProvenance(extractProvenance({ source: "Cookbook of Valencia" })),
    ).toBe("sourced");
  });

  it("classifies inference-marker sources as derived", () => {
    for (const source of ["inference", "datalog", "derived", "computed", "correlation"]) {
      expect(
        classifyProvenance(extractProvenance({ source })),
        `source=${source}`,
      ).toBe("derived");
    }
  });

  it("treats a source with no citation and no source as derived", () => {
    expect(classifyProvenance(extractProvenance({}))).toBe("derived");
    expect(classifyProvenance(extractProvenance({ confidence: 0.8 }))).toBe(
      "derived",
    );
    expect(classifyProvenance(null)).toBe("derived");
  });

  it("keeps an inferred edge derived even if it carries a confidence", () => {
    expect(
      classifyProvenance(
        extractProvenance({ source: "Datalog inference", confidence: 0.95 }),
      ),
    ).toBe("derived");
  });
});

describe("isLowConfidence", () => {
  it("flags confidence at or below the threshold", () => {
    expect(isLowConfidence(0.5)).toBe(true);
    expect(isLowConfidence(0.2)).toBe(true);
    expect(isLowConfidence(LOW_CONFIDENCE_THRESHOLD)).toBe(true);
    expect(isLowConfidence(0.51)).toBe(false);
    expect(isLowConfidence(0.9)).toBe(false);
  });

  it("does not flag a missing confidence", () => {
    expect(isLowConfidence(null)).toBe(false);
    expect(isLowConfidence(undefined)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(isLowConfidence(0.7, 0.8)).toBe(true);
    expect(isLowConfidence(0.9, 0.8)).toBe(false);
  });
});

describe("formatConfidence", () => {
  it("renders a rounded percent", () => {
    expect(formatConfidence(0.9)).toBe("90%");
    expect(formatConfidence(0.425)).toBe("43%");
    expect(formatConfidence(1)).toBe("100%");
  });

  it("returns null for a missing/invalid confidence", () => {
    expect(formatConfidence(null)).toBeNull();
    expect(formatConfidence(undefined)).toBeNull();
    expect(formatConfidence(Number.NaN)).toBeNull();
  });
});

describe("safeExternalUrl", () => {
  it("accepts http and https", () => {
    expect(safeExternalUrl("https://example.org/x")).toBe(
      "https://example.org/x",
    );
    expect(safeExternalUrl("http://example.org")).toBe("http://example.org");
    expect(safeExternalUrl("  https://trim.me  ")).toBe("https://trim.me");
  });

  it("rejects unsafe or non-http schemes and relative paths", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,x")).toBeNull();
    expect(safeExternalUrl("/relative/path")).toBeNull();
    expect(safeExternalUrl("ftp://host/x")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});
