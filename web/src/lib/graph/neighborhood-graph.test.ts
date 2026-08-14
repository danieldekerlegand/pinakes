import { describe, it, expect } from "vitest";
import {
  primaryLabel,
  labelColor,
  toNetworkNodes,
  toNetworkEdges,
  toNetworkGraph,
  labelLegend,
  isEmptyNeighborhood,
  neighborhoodViewState,
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
  // The populated graph puts the umbrella `:Entity` on every node and Neo4j
  // gives no order guarantee, so `labels[0]` typed whole neighborhoods as
  // "Entity" at random (pinakes:100 US-2).
  it("skips the umbrella :Entity label whichever position it arrives in", () => {
    expect(
      primaryLabel({
        csid: "cs:x:1",
        labels: ["Entity", "Language"],
        name: "x",
        properties: {},
      }),
    ).toBe("Language");
    expect(
      primaryLabel({
        csid: "cs:x:2",
        labels: ["Language", "Entity"],
        name: "x",
        properties: {},
      }),
    ).toBe("Language");
  });
  it("still reports :Entity when it is the node's only label", () => {
    expect(
      primaryLabel({
        csid: "cs:x:3",
        labels: ["Entity"],
        name: "x",
        properties: {},
      }),
    ).toBe("Entity");
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

describe("neighborhoodViewState", () => {
  const loneRoot: NeighborhoodPayload = {
    depth: 1,
    root: NEIGHBORHOOD.root,
    nodes: [NEIGHBORHOOD.root],
    edges: [],
  };

  it("is 'loading' while the query is in flight (even with stale data)", () => {
    expect(
      neighborhoodViewState({ isLoading: true, isError: false, data: undefined }),
    ).toBe("loading");
    // Loading wins over everything else — we have no fresh answer yet.
    expect(
      neighborhoodViewState({ isLoading: true, isError: true, data: NEIGHBORHOOD }),
    ).toBe("loading");
  });

  it("is 'unavailable' when the graph query errored (e.g. Neo4j 503)", () => {
    expect(
      neighborhoodViewState({ isLoading: false, isError: true, data: undefined }),
    ).toBe("unavailable");
  });

  it("is 'empty' for a resolved node with no neighbours", () => {
    expect(
      neighborhoodViewState({ isLoading: false, isError: false, data: loneRoot }),
    ).toBe("empty");
    // A missing payload (no error, not loading) is also nothing to draw.
    expect(
      neighborhoodViewState({ isLoading: false, isError: false, data: null }),
    ).toBe("empty");
  });

  it("is 'ready' once there is a neighbourhood to render", () => {
    expect(
      neighborhoodViewState({ isLoading: false, isError: false, data: NEIGHBORHOOD }),
    ).toBe("ready");
  });
});
