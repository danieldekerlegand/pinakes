import { describe, it, expect } from "vitest";
import {
  primaryLabel,
  labelColor,
  toNetworkNodes,
  toNetworkEdges,
  toNetworkGraph,
  labelLegend,
  isEmptyNeighborhood,
  type NeighborhoodPayload,
} from "./neighborhood-graph";

const NEIGHBORHOOD: NeighborhoodPayload = {
  depth: 1,
  root: {
    csid: "cs:culture:rome",
    labels: ["Culture"],
    name: "Roman",
    properties: { region: "Italy" },
  },
  nodes: [
    {
      csid: "cs:culture:rome",
      labels: ["Culture"],
      name: "Roman",
      properties: { region: "Italy" },
    },
    {
      csid: "cs:language:lat",
      labels: ["Language"],
      name: "Latin",
      properties: { status: "dead" },
    },
    {
      // no name → falls back to csid; no labels → falls back to "Node"
      csid: "cs:place:forum",
      labels: [],
      name: "",
      properties: {},
    },
  ],
  edges: [
    {
      id: "e1",
      type: "SPEAKS",
      startCsid: "cs:culture:rome",
      endCsid: "cs:language:lat",
      weight: 0.9,
      properties: { confidence: 0.9 },
    },
    {
      id: "e2",
      type: "LOCATED_IN",
      startCsid: "cs:culture:rome",
      endCsid: "cs:place:forum",
      properties: {},
    },
    {
      // dangling edge → dropped (endpoint not in node set)
      id: "e3",
      type: "CONTEMPORARY_WITH",
      startCsid: "cs:culture:rome",
      endCsid: "cs:culture:missing",
      properties: {},
    },
  ],
};

describe("primaryLabel", () => {
  it("uses the first label", () => {
    expect(primaryLabel(NEIGHBORHOOD.nodes[1])).toBe("Language");
  });
  it("falls back to 'Node' when there are no labels", () => {
    expect(primaryLabel(NEIGHBORHOOD.nodes[2])).toBe("Node");
  });
});

describe("labelColor", () => {
  it("is deterministic per label", () => {
    expect(labelColor("Culture")).toBe(labelColor("Culture"));
  });
  it("distinguishes different labels", () => {
    expect(labelColor("Culture")).not.toBe(labelColor("Language"));
  });
});

describe("toNetworkNodes", () => {
  it("projects every node, coloured/typed by :LABEL", () => {
    const nodes = toNetworkNodes(NEIGHBORHOOD);
    expect(nodes).toHaveLength(3);
    const latin = nodes.find((n) => n.id === "cs:language:lat");
    expect(latin).toBeDefined();
    expect(latin!.label).toBe("Latin");
    expect(latin!.group).toBe("Language");
    expect(latin!.metadata?.labels).toEqual(["Language"]);
    expect(latin!.metadata?.status).toBe("dead");
  });
  it("falls back to the csid when a node has no name", () => {
    const forum = toNetworkNodes(NEIGHBORHOOD).find(
      (n) => n.id === "cs:place:forum",
    );
    expect(forum!.label).toBe("cs:place:forum");
    expect(forum!.group).toBe("Node");
  });
});

describe("toNetworkEdges", () => {
  it("labels edges by :TYPE and keeps only edges between present nodes", () => {
    const edges = toNetworkEdges(NEIGHBORHOOD);
    expect(edges).toHaveLength(2); // dangling e3 dropped
    expect(edges.map((e) => e.type).sort()).toEqual(["LOCATED_IN", "SPEAKS"]);
    const speaks = edges.find((e) => e.type === "SPEAKS");
    expect(speaks).toMatchObject({
      source: "cs:culture:rome",
      target: "cs:language:lat",
      weight: 0.9,
    });
  });
});

describe("toNetworkGraph", () => {
  it("returns nodes and edges so they appear in the renderer", () => {
    const { nodes, edges } = toNetworkGraph(NEIGHBORHOOD);
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
  });
});

describe("labelLegend", () => {
  it("lists distinct labels with their colours, sorted", () => {
    const legend = labelLegend(NEIGHBORHOOD);
    expect(legend.map((l) => l.label)).toEqual(["Culture", "Language", "Node"]);
    expect(legend[0].color).toBe(labelColor("Culture"));
  });
});

describe("isEmptyNeighborhood", () => {
  it("is empty for null/undefined", () => {
    expect(isEmptyNeighborhood(null)).toBe(true);
    expect(isEmptyNeighborhood(undefined)).toBe(true);
  });
  it("is empty for a lone root with no edges", () => {
    expect(
      isEmptyNeighborhood({
        depth: 1,
        root: NEIGHBORHOOD.root,
        nodes: [NEIGHBORHOOD.root],
        edges: [],
      }),
    ).toBe(true);
  });
  it("is not empty when there are neighbours", () => {
    expect(isEmptyNeighborhood(NEIGHBORHOOD)).toBe(false);
  });
});
