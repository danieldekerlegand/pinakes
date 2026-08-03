import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_RUBRIC,
  assertValidConfidenceRubric,
  confidenceForClass,
  confidenceCellForClass,
} from "./confidence-rubric";

describe("confidence-rubric", () => {
  it("is well-formed (order covers all classes, monotone non-increasing, priors in [0,1])", () => {
    expect(() => assertValidConfidenceRubric()).not.toThrow();
  });

  it("exposes every ordered class in the classes map", () => {
    for (const name of CONFIDENCE_RUBRIC.order) {
      expect(CONFIDENCE_RUBRIC.classes[name]).toBeDefined();
      expect(CONFIDENCE_RUBRIC.classes[name].rationale.length).toBeGreaterThan(
        0,
      );
    }
  });

  it("returns the prior for a known class and throws on an unknown one", () => {
    expect(confidenceForClass("legacy-curated")).toBe(0.5);
    expect(confidenceForClass("qid-anchored")).toBe(1);
    // @ts-expect-error unknown class is a compile-time error
    expect(() => confidenceForClass("does-not-exist")).toThrow();
  });

  it("scales to a lexicon's 0–100 percentage cleanly", () => {
    expect(confidenceCellForClass("referenced-wikidata", { scale: 100 })).toBe(
      "90",
    );
    expect(confidenceCellForClass("unreferenced-wikidata", { scale: 100 })).toBe(
      "80",
    );
    expect(confidenceCellForClass("unreferenced-wikidata")).toBe("0.8");
  });

  it("preserves the historically-emitted acquire-script confidence values", () => {
    // Grandfathering guarantee (US-001): introducing the rubric must not move any
    // acquired/curated confidence. These pin the class→value contract each script relies on.
    expect(confidenceCellForClass("unreferenced-wikidata")).toBe("0.8"); // food-drink, cultural-domains
    expect(confidenceCellForClass("referenced-wikidata")).toBe("0.9"); // language-status, glottocode
    expect(confidenceCellForClass("curated-verified")).toBe("0.8"); // curate routes / myth-motifs
    expect(confidenceCellForClass("referenced-wikidata", { scale: 100 })).toBe(
      "90",
    ); // archaeological-sites
    expect(
      confidenceCellForClass("unreferenced-wikidata", { scale: 100 }),
    ).toBe("80"); // archaeological-cultures
    expect(confidenceForClass("legacy-curated")).toBe(0.5); // export node/edge default
    expect(confidenceForClass("stub-needs-curation")).toBe(0); // needs-curation stubs
  });

  it("rejects a rubric whose ordering is not monotone by prior", () => {
    expect(() =>
      assertValidConfidenceRubric({
        version: "x",
        title: "x",
        description: "x",
        order: ["a", "b"],
        classes: {
          a: { prior: 0.2, rationale: "low first" },
          b: { prior: 0.9, rationale: "high after — invalid" },
        },
      }),
    ).toThrow(/monoton/i);
  });
});
