import { describe, it, expect } from "vitest";
import { makeColorScale, encodeFeatureValue, formatFeatureValue } from "./shared/heatmap-utils";

describe("encodeFeatureValue", () => {
  it("normalizes noun class count (number) to 0-1 range", () => {
    expect(encodeFeatureValue("nounClassCount", 0)).toBe(0);
    expect(encodeFeatureValue("nounClassCount", 10)).toBe(0.5);
    expect(encodeFeatureValue("nounClassCount", 20)).toBe(1);
    // Caps at 1
    expect(encodeFeatureValue("nounClassCount", 40)).toBe(1);
  });

  it("encodes array features by length", () => {
    expect(encodeFeatureValue("caseSystem", ["nom", "acc"])).toBe(0.2);
    expect(encodeFeatureValue("genderSystem", ["m", "f", "n"])).toBe(0.3);
    expect(encodeFeatureValue("tenseAspectMood", [])).toBe(0);
  });

  it("caps array encoding at 1", () => {
    const longArray = Array.from({ length: 15 }, (_, i) => `val${i}`);
    expect(encodeFeatureValue("verbValencyChanges", longArray)).toBe(1);
  });

  it("encodes canonical string features by index", () => {
    expect(encodeFeatureValue("wordOrder", "SVO")).toBe(1 / 8);
    expect(encodeFeatureValue("wordOrder", "SOV")).toBe(2 / 8);
    expect(encodeFeatureValue("wordOrder", "free")).toBe(1);
  });

  it("encodes morphological type", () => {
    expect(encodeFeatureValue("morphologicalType", "isolating")).toBe(1 / 4);
    expect(encodeFeatureValue("morphologicalType", "polysynthetic")).toBe(1);
  });

  it("encodes ergativity", () => {
    expect(encodeFeatureValue("ergativity", "nominative-accusative")).toBe(1 / 4);
    expect(encodeFeatureValue("ergativity", "none")).toBe(1);
  });

  it("returns 0.5 for unknown string values", () => {
    expect(encodeFeatureValue("agreementSystem", "subject-verb")).toBe(0.5);
  });

  it("returns 0 for empty string", () => {
    expect(encodeFeatureValue("evidentiality", "")).toBe(0);
  });
});

describe("formatFeatureValue", () => {
  it("formats numbers", () => {
    expect(formatFeatureValue("nounClassCount", 5)).toBe("5");
  });

  it("formats arrays as comma-separated", () => {
    expect(formatFeatureValue("caseSystem", ["nom", "acc"])).toBe("nom, acc");
  });

  it("formats strings as-is", () => {
    expect(formatFeatureValue("wordOrder", "SVO")).toBe("SVO");
  });

  it("returns N/A for empty string", () => {
    expect(formatFeatureValue("evidentiality", "")).toBe("N/A");
  });
});

describe("makeColorScale", () => {
  it("returns the color for the matching threshold", () => {
    const scale = makeColorScale([
      { at: 0, color: "low" },
      { at: 0.5, color: "mid" },
      { at: 1, color: "high" },
    ]);
    expect(scale(0)).toBe("low");
    expect(scale(0.3)).toBe("low");
    expect(scale(0.5)).toBe("mid");
    expect(scale(0.75)).toBe("mid");
    expect(scale(1)).toBe("high");
  });

  it("returns first color for values below all thresholds", () => {
    const scale = makeColorScale([
      { at: 0.2, color: "a" },
      { at: 0.8, color: "b" },
    ]);
    expect(scale(0)).toBe("a");
    expect(scale(0.1)).toBe("a");
  });

  it("handles unsorted input", () => {
    const scale = makeColorScale([
      { at: 0.8, color: "high" },
      { at: 0, color: "low" },
      { at: 0.4, color: "mid" },
    ]);
    expect(scale(0.5)).toBe("mid");
    expect(scale(0.9)).toBe("high");
  });
});
