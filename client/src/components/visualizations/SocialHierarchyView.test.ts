import { describe, it, expect } from "vitest";
import {
  buildHierarchyTiers,
  buildOrgChart,
  buildPatronNetwork,
  classifyRole,
  concentricRadii,
  getClassColor,
  getPopulationPercent,
  pyramidWidths,
  type SocialStructure,
} from "./social-hierarchy-utils";

function mkStructure(overrides: Partial<SocialStructure> & { id: string }): SocialStructure {
  return {
    cultureProfileId: "cp-test",
    structureType: "class_hierarchy",
    name: "Test",
    description: "",
    keyRoles: [],
    inheritancePattern: "",
    decisionMaking: "",
    relatedKinshipSystemId: "",
    timePeriodStart: "",
    timePeriodEnd: "",
    sources: "",
    ...overrides,
  };
}

describe("classifyRole", () => {
  it("classifies rulers", () => {
    expect(classifyRole("Emperor").classKey).toBe("ruler");
    expect(classifyRole("Pharaoh").classKey).toBe("ruler");
    expect(classifyRole("King").classKey).toBe("ruler");
    expect(classifyRole("Chief").classKey).toBe("ruler");
  });

  it("classifies priests", () => {
    expect(classifyRole("High Priest of Amun").classKey).toBe("priest");
    expect(classifyRole("Brahmin").classKey).toBe("priest");
    expect(classifyRole("Pontifex Maximus").classKey).toBe("priest");
  });

  it("classifies warriors", () => {
    expect(classifyRole("Legionary").classKey).toBe("warrior");
    expect(classifyRole("Samurai").classKey).toBe("warrior");
    expect(classifyRole("Centurion").classKey).toBe("warrior");
  });

  it("classifies officials", () => {
    expect(classifyRole("Scribe").classKey).toBe("official");
    expect(classifyRole("Praetor").classKey).toBe("official");
    expect(classifyRole("Vizier").classKey).toBe("noble");
    expect(classifyRole("Consul").classKey).toBe("noble");
  });

  it("classifies merchants and artisans", () => {
    expect(classifyRole("Merchant").classKey).toBe("merchant");
    expect(classifyRole("Artisan").classKey).toBe("artisan");
    expect(classifyRole("Smith").classKey).toBe("artisan");
  });

  it("classifies lower classes", () => {
    expect(classifyRole("Farmer").classKey).toBe("farmer");
    expect(classifyRole("Slave").classKey).toBe("slave");
    expect(classifyRole("Helot").classKey).toBe("farmer");
    expect(classifyRole("Freedman").classKey).toBe("freedman");
  });

  it("falls back to commoner for unknown roles", () => {
    expect(classifyRole("XYZ Unknown").classKey).toBe("commoner");
  });

  it("returns a human-readable label", () => {
    expect(classifyRole("Emperor").label).toBe("Ruler");
    expect(classifyRole("Farmer").label).toBe("Farmers & Commoners");
  });
});

describe("getClassColor", () => {
  it("returns defined colors for known classes", () => {
    expect(getClassColor("ruler")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getClassColor("slave")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns default gray for unknown classes", () => {
    expect(getClassColor("nonexistent")).toBe("#6b7280");
  });
});

describe("getPopulationPercent", () => {
  it("returns 0 when classes are absent", () => {
    expect(getPopulationPercent("ruler", [])).toBe(0);
  });

  it("weights ruler as smaller percentage than farmer", () => {
    const present = ["ruler", "farmer"];
    const rulerPct = getPopulationPercent("ruler", present);
    const farmerPct = getPopulationPercent("farmer", present);
    expect(rulerPct).toBeLessThan(farmerPct);
  });

  it("all present classes sum to approximately 100", () => {
    const present = ["ruler", "noble", "priest", "warrior", "farmer", "slave"];
    const total = present.reduce((sum, c) => sum + getPopulationPercent(c, present), 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });
});

describe("buildHierarchyTiers", () => {
  it("returns empty array for empty input", () => {
    expect(buildHierarchyTiers([])).toEqual([]);
  });

  it("groups Roman roles into ordered tiers", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({
        id: "ss-001",
        structureType: "class_hierarchy",
        keyRoles: ["Patrician", "Equestrian", "Plebeian", "Freedman", "Slave"],
      }),
      mkStructure({
        id: "ss-002",
        structureType: "government",
        keyRoles: ["Consul", "Senator", "Praetor"],
      }),
    ]);

    expect(tiers.length).toBeGreaterThan(0);
    expect(tiers[0].rank).toBe(0);
    const slaveTier = tiers.find((t) => t.classKey === "slave");
    const nobleTier = tiers.find((t) => t.classKey === "noble");
    expect(nobleTier).toBeDefined();
    expect(slaveTier).toBeDefined();
    expect(nobleTier!.rank).toBeLessThan(slaveTier!.rank);
  });

  it("prefers class_hierarchy structures when present", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({
        id: "ss-1",
        structureType: "class_hierarchy",
        keyRoles: ["Emperor", "Slave"],
      }),
      mkStructure({
        id: "ss-2",
        structureType: "family_structure",
        keyRoles: ["Unrelated Role XYZ"],
      }),
    ]);
    const keys = tiers.map((t) => t.classKey);
    expect(keys).toContain("ruler");
    expect(keys).toContain("slave");
    expect(keys).not.toContain("commoner");
  });

  it("assigns each tier a color, population percent, and roles", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({
        id: "ss-1",
        keyRoles: ["King", "Peasant"],
      }),
    ]);
    for (const tier of tiers) {
      expect(tier.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tier.populationPercent).toBeGreaterThanOrEqual(0);
      expect(tier.roles.length).toBeGreaterThan(0);
      expect(tier.label.length).toBeGreaterThan(0);
    }
  });

  it("deduplicates roles across multiple structures", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({ id: "ss-1", keyRoles: ["Senator"] }),
      mkStructure({ id: "ss-2", keyRoles: ["Senator"] }),
    ]);
    const noble = tiers.find((t) => t.classKey === "noble");
    expect(noble!.roles).toHaveLength(1);
  });

  it("ranks are sequential starting at 0", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({ id: "ss-1", keyRoles: ["Emperor", "Senator", "Farmer", "Slave"] }),
    ]);
    tiers.forEach((tier, idx) => {
      expect(tier.rank).toBe(idx);
    });
  });
});

describe("buildOrgChart", () => {
  it("creates nodes and edges from key roles", () => {
    const { nodes, edges } = buildOrgChart(
      mkStructure({
        id: "ss-gov",
        keyRoles: ["Emperor", "Vizier", "Governor", "Scribe"],
      })
    );
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(3);
    expect(edges[0].source).toBe(nodes[0].id);
  });

  it("handles single role structure", () => {
    const { nodes, edges } = buildOrgChart(mkStructure({ id: "s", keyRoles: ["Chief"] }));
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });

  it("handles empty keyRoles", () => {
    const { nodes, edges } = buildOrgChart(mkStructure({ id: "s", keyRoles: [] }));
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe("buildPatronNetwork", () => {
  it("produces one node per tier", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({ id: "ss-1", keyRoles: ["King", "Noble", "Farmer"] }),
    ]);
    const { nodes } = buildPatronNetwork(tiers);
    expect(nodes).toHaveLength(tiers.length);
  });

  it("includes authority edges from top tier to others", () => {
    const tiers = buildHierarchyTiers([
      mkStructure({ id: "ss-1", keyRoles: ["King", "Senator", "Farmer", "Slave"] }),
    ]);
    const { edges } = buildPatronNetwork(tiers);
    const topId = tiers[0].id;
    const topEdges = edges.filter((e) => e.source === topId);
    expect(topEdges.length).toBeGreaterThan(0);
  });

  it("returns empty network when no tiers", () => {
    const { nodes, edges } = buildPatronNetwork([]);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe("pyramidWidths", () => {
  it("returns empty for 0 tiers", () => {
    expect(pyramidWidths(0)).toEqual([]);
  });

  it("returns single full width for 1 tier", () => {
    expect(pyramidWidths(1)).toEqual([100]);
  });

  it("produces increasing widths for multiple tiers", () => {
    const widths = pyramidWidths(5);
    expect(widths).toHaveLength(5);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    expect(widths[widths.length - 1]).toBe(100);
  });

  it("top tier is narrowest", () => {
    const widths = pyramidWidths(4);
    expect(widths[0]).toBeLessThan(widths[3]);
  });
});

describe("concentricRadii", () => {
  it("returns empty for 0 tiers", () => {
    expect(concentricRadii(0)).toEqual([]);
  });

  it("produces increasing radii", () => {
    const radii = concentricRadii(4);
    expect(radii).toHaveLength(4);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
  });

  it("final radius reaches 100", () => {
    expect(concentricRadii(5).at(-1)).toBe(100);
  });
});
