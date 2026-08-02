import { describe, it, expect } from "vitest";
import {
  formatTimePeriod,
  moveCard,
  reorderCards,
  getVariantClasses,
  validateCardData,
  normalizeTags,
  type CultureDataCardData,
} from "../web/src/components/shared/culture-data-card-utils";

describe("CultureDataCard utils - formatTimePeriod", () => {
  it("returns empty string when both start and end are null/undefined", () => {
    expect(formatTimePeriod(null, null)).toBe("");
    expect(formatTimePeriod(undefined, undefined)).toBe("");
    expect(formatTimePeriod("", "")).toBe("");
  });

  it("formats negative numeric years as BCE", () => {
    expect(formatTimePeriod(-3000, -1500)).toBe("3000 BCE – 1500 BCE");
  });

  it("formats positive numeric years as CE", () => {
    expect(formatTimePeriod(100, 500)).toBe("100 CE – 500 CE");
  });

  it("formats numeric string years", () => {
    expect(formatTimePeriod("-2000", "500")).toBe("2000 BCE – 500 CE");
  });

  it("preserves the literal 'present' token", () => {
    expect(formatTimePeriod(-500, "present")).toBe("500 BCE – present");
  });

  it("returns single side when only one bound is provided", () => {
    expect(formatTimePeriod(-100, null)).toBe("100 BCE");
    expect(formatTimePeriod(null, 1500)).toBe("1500 CE");
  });

  it("passes through non-numeric strings unchanged", () => {
    expect(formatTimePeriod("Late Bronze Age", null)).toBe("Late Bronze Age");
  });
});

describe("CultureDataCard utils - moveCard", () => {
  const cards = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ];

  it("moves item from earlier index to later index", () => {
    const result = moveCard(cards, 0, 2);
    expect(result.map((c) => c.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves item from later index to earlier index", () => {
    const result = moveCard(cards, 3, 1);
    expect(result.map((c) => c.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns a copy when indices are equal", () => {
    const result = moveCard(cards, 1, 1);
    expect(result).not.toBe(cards);
    expect(result.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns a copy for out-of-range indices", () => {
    expect(moveCard(cards, -1, 2).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(moveCard(cards, 0, 10).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const original = cards.slice();
    moveCard(cards, 0, 2);
    expect(cards).toEqual(original);
  });
});

describe("CultureDataCard utils - reorderCards", () => {
  const cards = [
    { id: "language" },
    { id: "religion" },
    { id: "economy" },
    { id: "military" },
  ];

  it("reorders by id from earlier to later", () => {
    const result = reorderCards(cards, "language", "economy");
    expect(result.map((c) => c.id)).toEqual(["religion", "economy", "language", "military"]);
  });

  it("reorders by id from later to earlier", () => {
    const result = reorderCards(cards, "military", "religion");
    expect(result.map((c) => c.id)).toEqual(["language", "military", "religion", "economy"]);
  });

  it("returns a copy when from and to are the same", () => {
    const result = reorderCards(cards, "religion", "religion");
    expect(result).not.toBe(cards);
    expect(result.map((c) => c.id)).toEqual(["language", "religion", "economy", "military"]);
  });

  it("returns a copy when ids are not found", () => {
    const result = reorderCards(cards, "missing", "religion");
    expect(result.map((c) => c.id)).toEqual(["language", "religion", "economy", "military"]);
  });
});

describe("CultureDataCard utils - getVariantClasses", () => {
  it("returns compact class set", () => {
    const c = getVariantClasses("compact");
    expect(c.root).toContain("flex");
    expect(c.title).toContain("truncate");
    expect(c.image).toContain("h-8");
  });

  it("returns standard class set", () => {
    const c = getVariantClasses("standard");
    expect(c.root).toContain("flex-col");
    expect(c.image).toContain("h-32");
  });

  it("returns detailed class set", () => {
    const c = getVariantClasses("detailed");
    expect(c.root).toContain("p-5");
    expect(c.image).toContain("h-48");
  });

  it("each variant produces distinct root classes", () => {
    const compact = getVariantClasses("compact").root;
    const standard = getVariantClasses("standard").root;
    const detailed = getVariantClasses("detailed").root;
    expect(new Set([compact, standard, detailed]).size).toBe(3);
  });
});

describe("CultureDataCard utils - validateCardData", () => {
  it("accepts a valid card", () => {
    const data: CultureDataCardData = {
      id: "card-1",
      title: "Cuneiform",
      description: "First writing system",
    };
    expect(validateCardData(data)).toEqual([]);
  });

  it("flags missing id", () => {
    const errors = validateCardData({ title: "x" });
    expect(errors.some((e) => e.field === "id")).toBe(true);
  });

  it("flags missing title", () => {
    const errors = validateCardData({ id: "x" });
    expect(errors.some((e) => e.field === "title")).toBe(true);
  });

  it("flags empty string id and title", () => {
    const errors = validateCardData({ id: "  ", title: "" });
    expect(errors.some((e) => e.field === "id")).toBe(true);
    expect(errors.some((e) => e.field === "title")).toBe(true);
  });

  it("flags image with missing url", () => {
    const errors = validateCardData({
      id: "x",
      title: "y",
      image: { url: "" },
    });
    expect(errors.some((e) => e.field === "image.url")).toBe(true);
  });

  it("accepts card without optional fields", () => {
    expect(validateCardData({ id: "a", title: "b" })).toEqual([]);
  });
});

describe("CultureDataCard utils - normalizeTags", () => {
  it("returns empty array when no tags provided", () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });

  it("trims whitespace", () => {
    expect(normalizeTags(["  bronze  ", "iron"])).toEqual(["bronze", "iron"]);
  });

  it("removes empty strings", () => {
    expect(normalizeTags(["", "   ", "gold"])).toEqual(["gold"]);
  });

  it("deduplicates case-insensitively while preserving first occurrence casing", () => {
    expect(normalizeTags(["Bronze", "bronze", "IRON"])).toEqual(["Bronze", "IRON"]);
  });
});
