import { describe, it, expect } from "vitest";
import { toggleFacetValue, buildSearchUrl } from "./search-facets";

describe("toggleFacetValue", () => {
  it("adds a value when absent", () => {
    expect(toggleFacetValue([], "language")).toEqual(["language"]);
    expect(toggleFacetValue(["battle"], "language")).toEqual(["battle", "language"]);
  });

  it("removes a value when present", () => {
    expect(toggleFacetValue(["language", "battle"], "language")).toEqual(["battle"]);
  });

  it("does not mutate the input array", () => {
    const active = ["language"];
    toggleFacetValue(active, "battle");
    expect(active).toEqual(["language"]);
  });
});

describe("buildSearchUrl", () => {
  it("encodes the query", () => {
    expect(buildSearchUrl("a b")).toBe("/api/search?q=a+b");
  });

  it("appends types and sources params", () => {
    expect(
      buildSearchUrl("x", { entityTypes: ["language", "battle"], sources: ["graph"] }),
    ).toBe("/api/search?q=x&types=language%2Cbattle&sources=graph");
  });

  it("omits empty facet dimensions", () => {
    expect(buildSearchUrl("x", { entityTypes: [] })).toBe("/api/search?q=x");
  });
});
