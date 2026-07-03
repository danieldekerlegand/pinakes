import { describe, it, expect } from "vitest";
import {
  culturescrapeAdapter,
  periodBand,
  type GraphOverviewResponse,
  type GraphEntityRow,
} from "./culturescrape.adapter";
import { ADAPTERS, VISUALIZATIONS } from "./registry";
import { compatibleVisualizations } from "./compatibility";

/**
 * Adapter tests for the shared culture-scrape graph dataset (US-008). The repo
 * has no jsdom/testing-library, so these exercise the pure unwrap/project/detail
 * functions and the compatibility filtering — the same convention as the other
 * adapter transforms.
 */

// A tiny snapshot: a dish that originates in a region and descends from a
// predecessor dish; the region carries coordinates + a period, the dish a source.
const SNAPSHOT: GraphOverviewResponse = {
  nodes: [
    {
      csid: "cs:dish:paella",
      labels: ["Dish", "CulturalArtifact"],
      name: "Paella",
      properties: {
        time_start: 1800,
        time_end: 1900,
        source: "Cookbook of Valencia",
        source_url: "https://example.org/paella",
        retrieved_at: "2026-01-01",
        confidence: 0.9,
      },
    },
    {
      csid: "cs:region:iberia",
      labels: ["Region"],
      name: "Iberia",
      properties: { lat: 40.2, lon: -3.7, region: "Southern Europe", time_start: -1200 },
    },
    {
      csid: "cs:dish:arroz",
      labels: ["Dish"],
      name: "Arroz",
      properties: {},
    },
  ],
  edges: [
    {
      id: "e1",
      type: "ORIGINATES_IN",
      startCsid: "cs:dish:paella",
      endCsid: "cs:region:iberia",
      weight: 2,
      properties: {},
    },
    {
      id: "e2",
      type: "DESCENDS_FROM",
      startCsid: "cs:dish:paella",
      endCsid: "cs:dish:arroz",
      properties: {},
    },
  ],
};

function rows(): GraphEntityRow[] {
  return culturescrapeAdapter.unwrap(SNAPSHOT);
}

describe("culturescrapeAdapter.unwrap", () => {
  it("returns one row per node, each carrying its incident edges", () => {
    const out = rows();
    expect(out).toHaveLength(3);
    const paella = out.find((r) => r.node.csid === "cs:dish:paella")!;
    // paella is an endpoint of both edges
    expect(paella.incidentEdges.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    const arroz = out.find((r) => r.node.csid === "cs:dish:arroz")!;
    expect(arroz.incidentEdges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("tolerates a malformed / empty response", () => {
    expect(culturescrapeAdapter.unwrap(null)).toEqual([]);
    expect(culturescrapeAdapter.unwrap({})).toEqual([]);
    expect(culturescrapeAdapter.unwrap({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe("culturescrapeAdapter.project — each declared dimension", () => {
  const proj = () => culturescrapeAdapter.project(rows(), {});

  it("declares all five dimensions", () => {
    expect(culturescrapeAdapter.dimensions).toEqual([
      "relational",
      "temporal",
      "spatial",
      "hierarchical",
      "categorical",
    ]);
  });

  it("relational: nodes grouped by :LABEL, links labelled by :TYPE (deduped)", () => {
    const { relational } = proj();
    expect(relational!.nodes).toHaveLength(3);
    const paella = relational!.nodes.find((n) => n.id === "cs:dish:paella")!;
    expect(paella.group).toBe("Dish"); // first :LABEL
    // e1 + e2, each counted once even though incident to two rows
    expect(relational!.links).toHaveLength(2);
    expect(relational!.links.map((l) => l.kind).sort()).toEqual([
      "DESCENDS_FROM",
      "ORIGINATES_IN",
    ]);
    expect(relational!.links.find((l) => l.kind === "ORIGINATES_IN")!.weight).toBe(2);
  });

  it("hierarchical: DESCENDS_FROM makes paella a child of arroz", () => {
    const { hierarchical } = proj();
    const paella = hierarchical!.find((n) => n.id === "cs:dish:paella")!;
    const arroz = hierarchical!.find((n) => n.id === "cs:dish:arroz")!;
    expect(paella.parentId).toBe("cs:dish:arroz");
    expect(paella.depth).toBe(1);
    expect(arroz.parentId).toBeNull();
    expect(arroz.depth).toBe(0);
  });

  it("temporal: only nodes with a start year appear, with their span", () => {
    const { temporal } = proj();
    const ids = temporal!.map((t) => t.id).sort();
    expect(ids).toEqual(["cs:dish:paella", "cs:region:iberia"]); // arroz has no time
    const paella = temporal!.find((t) => t.id === "cs:dish:paella")!;
    expect(paella.startYear).toBe(1800);
    expect(paella.endYear).toBe(1900);
  });

  it("spatial: only nodes with coordinates appear", () => {
    const { spatial } = proj();
    expect(spatial!).toHaveLength(1);
    expect(spatial![0]).toMatchObject({
      id: "cs:region:iberia",
      lat: 40.2,
      lng: -3.7,
      region: "Southern Europe",
    });
  });

  it("categorical: one row per node, faceted by type/period/region", () => {
    const { categorical } = proj();
    expect(categorical!).toHaveLength(3);
    const iberia = categorical!.find((c) => c.id === "cs:region:iberia")!;
    expect(iberia.facets.entityType).toBe("Region");
    expect(iberia.facets.region).toBe("Southern Europe");
    expect(iberia.facets.timePeriod).toBe(periodBand(-1200));
  });
});

describe("culturescrapeAdapter.project — filtering", () => {
  it("filters by the entityType facet", () => {
    const { categorical } = culturescrapeAdapter.project(rows(), {
      facetFilters: { entityType: "Region" },
    });
    expect(categorical!.map((c) => c.id)).toEqual(["cs:region:iberia"]);
  });

  it("filters by search query over name/csid/labels", () => {
    const { categorical } = culturescrapeAdapter.project(rows(), {
      searchQuery: "paella",
    });
    expect(categorical!.map((c) => c.id)).toEqual(["cs:dish:paella"]);
  });

  it("drops links whose endpoints are filtered out", () => {
    const { relational } = culturescrapeAdapter.project(rows(), {
      facetFilters: { entityType: "Region" },
    });
    // Only Iberia survives; neither edge's other endpoint remains.
    expect(relational!.links).toHaveLength(0);
  });
});

describe("culturescrapeAdapter.detail", () => {
  it("surfaces provenance fields", () => {
    const paella = rows().find((r) => r.node.csid === "cs:dish:paella")!;
    const detail = culturescrapeAdapter.detail!(paella);
    expect(detail.title).toBe("Paella");
    const byLabel = Object.fromEntries(detail.fields.map((f) => [f.label, f.value]));
    expect(byLabel["Source"]).toBe("Cookbook of Valencia");
    expect(byLabel["Source URL"]).toBe("https://example.org/paella");
    expect(byLabel["Retrieved at"]).toBe("2026-01-01");
    expect(byLabel["Confidence"]).toBe("0.9");
  });
});

describe("periodBand", () => {
  it("buckets years into 500-year BCE/CE bands", () => {
    expect(periodBand(800)).toBe("500 CE–1000 CE");
    expect(periodBand(-1200)).toBe("1500 BCE–1000 BCE");
    expect(periodBand(null)).toBeNull();
  });
});

describe("registry integration", () => {
  it("is registered so it appears in the dataset picker", () => {
    const registered = ADAPTERS.find((a) => a.id === "culturescrape-graph");
    expect(registered).toBeDefined();
    expect(registered!.endpoint).toBe("/api/graph/overview");
  });

  it("is compatible with every generic visualization (declares all dimensions)", () => {
    const registered = ADAPTERS.find((a) => a.id === "culturescrape-graph")!;
    const compatible = compatibleVisualizations(registered, VISUALIZATIONS);
    expect(compatible.map((v) => v.id).sort()).toEqual(
      VISUALIZATIONS.map((v) => v.id).sort(),
    );
  });
});
