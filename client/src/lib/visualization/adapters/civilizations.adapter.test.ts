import { describe, it, expect } from "vitest";
import { civilizationsAdapter } from "./civilizations.adapter";
import { ADAPTERS, VISUALIZATIONS } from "./registry";
import { compatibleVisualizations } from "./compatibility";

/**
 * Adapter tests for the civilizations dataset (data-population pilot US-005).
 * The repo has no jsdom/testing-library, so these exercise the pure
 * unwrap/project/detail functions — the same convention as the other adapter
 * transforms. The key thing under test is that the Wikidata-acquired write-back
 * rows surface with provenance and that boundary-less civs don't pollute the
 * spatial projection.
 */

// A tiny FeatureCollection mirroring `/api/map/civilizations`: one curated civ
// with a real boundary + sources, one Wikidata-acquired civ with a placeholder
// geometry + provenance columns.
const RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature" as const,
      id: "minoan",
      geometry: {
        type: "Polygon" as const,
        coordinates: [[[24, 35], [26, 35], [26, 36], [24, 36], [24, 35]]],
      },
      properties: {
        civilizationId: "minoan",
        name: "Minoan",
        timePeriod: { start: -3000, end: -1100, label: "Bronze Age" },
        associatedLanguageIds: ["eteocretan"],
        writingSystems: ["linear-a"],
        politicalStructure: "Palace economy",
        capital: "Knossos",
        sources: ["Evans 1921"],
      },
    },
    {
      type: "Feature" as const,
      id: "ancient-crete",
      // Placeholder geometry stamped by the loader for a boundary-less civ.
      geometry: {
        type: "Polygon" as const,
        coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
      },
      properties: {
        civilizationId: "ancient-crete",
        name: "Ancient Crete",
        timePeriod: { start: 0, end: null, label: "" },
        associatedLanguageIds: [],
        writingSystems: [],
        sources: ["Wikidata"],
        wikidataQid: "Q4752820",
        sourceUrl: "http://www.wikidata.org/entity/Q4752820",
        retrievedAt: "2026-07-08T04:56:01.068765+00:00",
        confidence: 1.0,
      },
    },
  ],
};

function rows() {
  return civilizationsAdapter.unwrap(RESPONSE);
}

describe("civilizationsAdapter", () => {
  it("unwraps the FeatureCollection into feature rows", () => {
    expect(rows()).toHaveLength(2);
  });

  it("projects every civ into categorical + temporal", () => {
    const p = civilizationsAdapter.project(rows(), {});
    expect(p.categorical).toHaveLength(2);
    expect(p.temporal).toHaveLength(2);
    // The acquired row is tagged as Wikidata-sourced in the categorical facet.
    const acquired = p.categorical?.find((r) => r.id === "ancient-crete");
    expect(acquired?.facets.sourced).toBe("Wikidata");
  });

  it("excludes placeholder-geometry civs from the spatial projection", () => {
    const p = civilizationsAdapter.project(rows(), {});
    // Only the boundary-bearing Minoan civ has a real centroid.
    expect(p.spatial).toHaveLength(1);
    expect(p.spatial?.[0].id).toBe("minoan");
    // Mean of the 5 ring vertices (incl. the duplicated closing point).
    expect(p.spatial?.[0].lat).toBeCloseTo(35.4, 1);
    expect(p.spatial?.[0].lng).toBeCloseTo(24.8, 1);
  });

  it("filters by search query and political-structure facet", () => {
    expect(civilizationsAdapter.project(rows(), { searchQuery: "crete" })
      .categorical).toHaveLength(1);
    expect(
      civilizationsAdapter.project(rows(), {
        facetFilters: { politicalStructure: "Palace economy" },
      }).categorical,
    ).toHaveLength(1);
  });

  it("surfaces Wikidata provenance in the acquired civ's detail", () => {
    const acquired = rows().find(
      (f) => f.properties.civilizationId === "ancient-crete",
    )!;
    const d = civilizationsAdapter.detail!(acquired);
    expect(d.title).toBe("Ancient Crete");
    expect(d.provenance).toEqual({
      source: "Wikidata",
      sourceUrl: "http://www.wikidata.org/entity/Q4752820",
      retrievedAt: "2026-07-08T04:56:01.068765+00:00",
      confidence: 1.0,
    });
    expect(d.fields.find((f) => f.label === "Wikidata")?.value).toBe("Q4752820");
  });

  it("falls back to bibliographic sources for a curated civ", () => {
    const minoan = rows().find(
      (f) => f.properties.civilizationId === "minoan",
    )!;
    const d = civilizationsAdapter.detail!(minoan);
    expect(d.provenance?.source).toBe("Evans 1921");
    expect(d.provenance?.sourceUrl).toBeNull();
  });

  it("is registered and renders through the categorical/temporal/spatial visualizations", () => {
    const entry = ADAPTERS.find((a) => a.id === "civilizations");
    expect(entry).toBeDefined();
    const vizIds = compatibleVisualizations(entry!, VISUALIZATIONS).map(
      (v) => v.id,
    );
    expect(vizIds).toContain("explorer"); // Table (categorical)
    expect(vizIds).toContain("timeline"); // temporal
    expect(vizIds).toContain("map"); // spatial
  });
});
