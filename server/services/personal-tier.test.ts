import { describe, it, expect } from "vitest";

import {
  ASSET_LABEL,
  PERSONAL_SOURCE,
  filterPersonalNodes,
  isPersonalNode,
  isPersonalTierEnabled,
} from "./personal-tier";

describe("isPersonalTierEnabled", () => {
  it("is off by default (undefined / blank / falsey env)", () => {
    expect(isPersonalTierEnabled({})).toBe(false);
    expect(isPersonalTierEnabled({ PERSONAL_TIER_ENABLED: "" })).toBe(false);
    expect(isPersonalTierEnabled({ PERSONAL_TIER_ENABLED: "false" })).toBe(false);
    expect(isPersonalTierEnabled({ PERSONAL_TIER_ENABLED: "0" })).toBe(false);
    expect(isPersonalTierEnabled({ PERSONAL_TIER_ENABLED: "off" })).toBe(false);
  });

  it("is on for the accepted truthy tokens", () => {
    for (const raw of ["true", "1", "yes", "on", "TRUE", " On "]) {
      expect(isPersonalTierEnabled({ PERSONAL_TIER_ENABLED: raw })).toBe(true);
    }
  });
});

describe("isPersonalNode", () => {
  it("flags a node carrying the Asset label", () => {
    expect(
      isPersonalNode({ labels: [ASSET_LABEL, "Entity"], properties: {} }),
    ).toBe(true);
  });

  it("flags a node with a source=analyzer provenance token", () => {
    expect(
      isPersonalNode({ labels: ["Entity"], properties: { source: PERSONAL_SOURCE } }),
    ).toBe(true);
    // A merged provenance (pinakes;analyzer) is still personal — one analyzer token.
    expect(
      isPersonalNode({ labels: ["Place"], properties: { source: "pinakes;analyzer" } }),
    ).toBe(true);
  });

  it("does not flag a public entity node", () => {
    expect(
      isPersonalNode({
        labels: ["Place", "Entity"],
        properties: { source: "pinakes" },
      }),
    ).toBe(false);
    expect(isPersonalNode({ labels: ["Language"], properties: {} })).toBe(false);
  });
});

describe("filterPersonalNodes", () => {
  const nodes = [
    { labels: ["Place"], properties: { source: "pinakes" } },
    { labels: ["Asset", "Entity"], properties: { source: "analyzer" } },
    { labels: ["Language"], properties: { source: "wikidata" } },
  ];

  it("drops personal nodes when the tier is disabled", () => {
    const kept = filterPersonalNodes(nodes, false);
    expect(kept.map((n) => n.labels[0])).toEqual(["Place", "Language"]);
  });

  it("keeps every node when the tier is enabled", () => {
    expect(filterPersonalNodes(nodes, true)).toEqual(nodes);
  });
});
