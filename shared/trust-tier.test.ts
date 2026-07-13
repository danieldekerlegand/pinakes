import { describe, it, expect } from "vitest";
import {
  classifyTrustTier,
  ALL_TRUST_TIERS,
  TRUST_TIER_META,
  trustTierMeta,
  LINGUASCRAPE_SOURCE,
} from "./trust-tier";

describe("classifyTrustTier — parity with Python tiers.classify_tier", () => {
  it("an inferred:<linker> source wins over everything", () => {
    expect(
      classifyTrustTier({
        source: "inferred:named_in",
        wikidataQid: "Q42",
        sourceUrl: "https://example.org",
      }),
    ).toBe("inferred");
    // even mixed with a linguascrape token, inferred takes precedence
    expect(
      classifyTrustTier({ source: "inferred:hub;linguascrape" }),
    ).toBe("inferred");
  });

  it("a linguascrape source is curated even with a QID + citation", () => {
    expect(
      classifyTrustTier({
        source: LINGUASCRAPE_SOURCE,
        wikidataQid: "Q1",
        sourceUrl: "https://example.org",
      }),
    ).toBe("curated");
    // merge-joined multi-source token still resolves curated
    expect(classifyTrustTier({ source: "linguascrape;wikidata" })).toBe(
      "curated",
    );
  });

  it("a node auto-admits only when QID-anchored AND reference-backed", () => {
    expect(
      classifyTrustTier({
        source: "wikidata",
        wikidataQid: "Q7",
        sourceUrl: "https://www.wikidata.org/wiki/Q7",
      }),
    ).toBe("auto-admitted");
  });

  it("a node with a QID but no citation quarantines", () => {
    expect(classifyTrustTier({ source: "wikidata", wikidataQid: "Q7" })).toBe(
      "quarantine",
    );
  });

  it("a node with a citation but no QID quarantines", () => {
    expect(
      classifyTrustTier({ source: "html", sourceUrl: "https://example.org" }),
    ).toBe("quarantine");
  });

  it("an edge auto-admits on a citation alone (no QID column)", () => {
    expect(
      classifyTrustTier({
        source: "wikidata",
        sourceUrl: "https://example.org",
        isEdge: true,
      }),
    ).toBe("auto-admitted");
    expect(classifyTrustTier({ source: "wikidata", isEdge: true })).toBe(
      "quarantine",
    );
  });

  it("blank / whitespace provenance quarantines a node", () => {
    expect(classifyTrustTier({})).toBe("quarantine");
    expect(
      classifyTrustTier({ source: "  ", wikidataQid: "  ", sourceUrl: " " }),
    ).toBe("quarantine");
  });
});

describe("trust tier metadata", () => {
  it("ALL_TRUST_TIERS is ordered most-to-least trusted and matches meta order", () => {
    expect(ALL_TRUST_TIERS).toEqual([
      "curated",
      "auto-admitted",
      "quarantine",
      "inferred",
    ]);
    const orders = ALL_TRUST_TIERS.map((t) => TRUST_TIER_META[t].order);
    expect(orders).toEqual([0, 1, 2, 3]);
  });

  it("every tier has a label + description", () => {
    for (const tier of ALL_TRUST_TIERS) {
      const meta = trustTierMeta(tier);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.tier).toBe(tier);
    }
  });
});
