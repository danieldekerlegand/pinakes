import { describe, it, expect } from "vitest";

import {
  ASSET_LABEL,
  PERSONAL_SOURCES,
  filterPersonalNodes,
  isPersonalNode,
  isPersonalTierEnabled,
} from "./personal-tier";

/** A deployment's own personal-tier producer, registered the way `PERSONAL_SOURCES` is. */
const DEPLOYMENT_SOURCES: ReadonlySet<string> = new Set(["my-files"]);

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

  it("flags a node whose source names a registered personal producer", () => {
    expect(
      isPersonalNode(
        { labels: ["Entity"], properties: { source: "my-files" } },
        DEPLOYMENT_SOURCES,
      ),
    ).toBe(true);
    // A merged provenance (pinakes;my-files) is still personal — one matching token.
    expect(
      isPersonalNode(
        { labels: ["Place"], properties: { source: "pinakes;my-files" } },
        DEPLOYMENT_SOURCES,
      ),
    ).toBe(true);
  });

  it("registers no personal producer by default, so only the Asset label gates", () => {
    expect(PERSONAL_SOURCES.size).toBe(0);
    expect(
      isPersonalNode({ labels: ["Entity"], properties: { source: "my-files" } }),
    ).toBe(false);
  });

  it("does not flag a public entity node", () => {
    expect(
      isPersonalNode(
        { labels: ["Place", "Entity"], properties: { source: "pinakes" } },
        DEPLOYMENT_SOURCES,
      ),
    ).toBe(false);
    expect(isPersonalNode({ labels: ["Language"], properties: {} })).toBe(false);
  });
});

describe("filterPersonalNodes", () => {
  const nodes = [
    { labels: ["Place"], properties: { source: "pinakes" } },
    { labels: ["Asset", "Entity"], properties: { source: "my-files" } },
    { labels: ["Language"], properties: { source: "wikidata" } },
  ];

  it("drops personal nodes when the tier is disabled", () => {
    const kept = filterPersonalNodes(nodes, false, DEPLOYMENT_SOURCES);
    expect(kept.map((n) => n.labels[0])).toEqual(["Place", "Language"]);
  });

  it("keeps every node when the tier is enabled", () => {
    expect(filterPersonalNodes(nodes, true, DEPLOYMENT_SOURCES)).toEqual(nodes);
  });
});
