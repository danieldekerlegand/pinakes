import { describe, it, expect } from "vitest";
import {
  relatedFromNeighborhood,
  humanizeRelationship,
  relatedEntityHref,
  toRelatedEntity,
  toRelatedEntities,
  type RelatedEntitySuggestion,
} from "./related-entities";
import type {
  NeighborhoodPayload,
  GraphNodePayload,
  GraphEdgePayload,
} from "./neighborhood-graph";

function node(
  csid: string,
  name: string,
  labels: string[] = ["Node"],
  properties: Record<string, unknown> = {},
): GraphNodePayload {
  return { csid, name, labels, properties };
}

function edge(
  id: string,
  type: string,
  startCsid: string,
  endCsid: string,
  weight?: number,
  properties: Record<string, unknown> = {},
): GraphEdgePayload {
  return { id, type, startCsid, endCsid, weight, properties };
}

function neighborhood(
  root: GraphNodePayload,
  nodes: GraphNodePayload[],
  edges: GraphEdgePayload[],
  depth = 1,
): NeighborhoodPayload {
  return { root, nodes: [root, ...nodes], edges, depth };
}

describe("relatedFromNeighborhood", () => {
  it("returns the direct neighbours of the focus node", () => {
    const root = node("cs:language:akk", "Akkadian", ["Language"]);
    const sumerian = node("cs:language:sux", "Sumerian", ["Language"]);
    const babylon = node("cs:culture:bab", "Babylon", ["Culture"]);
    const nb = neighborhood(root, [sumerian, babylon], [
      edge("e1", "CONTEMPORARY_WITH", root.csid, sumerian.csid, 0.8),
      edge("e2", "SPOKEN_IN", root.csid, babylon.csid, 0.5),
    ]);

    const related = relatedFromNeighborhood(nb);
    expect(related.map((r) => r.csid)).toEqual([sumerian.csid, babylon.csid]);
    expect(related[0]).toMatchObject({
      name: "Sumerian",
      type: "Language",
      relationship: "CONTEMPORARY_WITH",
      direction: "outgoing",
      weight: 0.8,
    });
  });

  it("ranks by weight desc, then name, then relationship", () => {
    const root = node("root", "Root");
    const a = node("a", "Zeta");
    const b = node("b", "Alpha");
    const c = node("c", "Beta");
    const nb = neighborhood(root, [a, b, c], [
      edge("e1", "REL", root.csid, a.csid, 0.2),
      edge("e2", "REL", root.csid, b.csid, 0.9),
      edge("e3", "REL", root.csid, c.csid, 0.9),
    ]);
    const related = relatedFromNeighborhood(nb);
    // b and c tie on weight → sorted by name (Alpha before Beta); a last.
    expect(related.map((r) => r.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("captures incoming edges with the correct direction", () => {
    const root = node("root", "Root");
    const other = node("o", "Other");
    const nb = neighborhood(root, [other], [
      edge("e1", "DERIVES_FROM", other.csid, root.csid, 1),
    ]);
    const [rel] = relatedFromNeighborhood(nb);
    expect(rel.direction).toBe("incoming");
    expect(rel.csid).toBe("o");
  });

  it("defaults missing edge weight to 1", () => {
    const root = node("root", "Root");
    const other = node("o", "Other");
    const nb = neighborhood(root, [other], [
      edge("e1", "REL", root.csid, other.csid),
    ]);
    expect(relatedFromNeighborhood(nb)[0].weight).toBe(1);
  });

  it("excludes the focus node, self-loops, and second-hop nodes", () => {
    const root = node("root", "Root");
    const near = node("near", "Near");
    const far = node("far", "Far"); // only connected to `near`, not root
    const nb = neighborhood(root, [near, far], [
      edge("self", "REL", root.csid, root.csid), // self-loop
      edge("e1", "REL", root.csid, near.csid, 0.5),
      edge("e2", "REL", near.csid, far.csid, 0.5), // second hop
    ]);
    const related = relatedFromNeighborhood(nb);
    expect(related.map((r) => r.csid)).toEqual(["near"]);
  });

  it("drops dangling edges whose other endpoint is not a node", () => {
    const root = node("root", "Root");
    const nb = neighborhood(root, [], [
      edge("e1", "REL", root.csid, "ghost", 1),
    ]);
    expect(relatedFromNeighborhood(nb)).toEqual([]);
  });

  it("keeps distinct relationship types to the same node", () => {
    const root = node("root", "Root");
    const other = node("o", "Other");
    const nb = neighborhood(root, [other], [
      edge("e1", "INFLUENCED", root.csid, other.csid, 0.4),
      edge("e2", "CONTEMPORARY_WITH", root.csid, other.csid, 0.6),
    ]);
    const related = relatedFromNeighborhood(nb);
    expect(related).toHaveLength(2);
    expect(related.map((r) => r.relationship)).toEqual([
      "CONTEMPORARY_WITH",
      "INFLUENCED",
    ]);
  });

  it("collapses duplicate (node, relationship) edges to the strongest", () => {
    const root = node("root", "Root");
    const other = node("o", "Other");
    const nb = neighborhood(root, [other], [
      edge("e1", "REL", root.csid, other.csid, 0.3),
      edge("e2", "REL", root.csid, other.csid, 0.9),
    ]);
    const related = relatedFromNeighborhood(nb);
    expect(related).toHaveLength(1);
    expect(related[0].weight).toBe(0.9);
  });

  it("extracts provenance from edge properties", () => {
    const root = node("root", "Root");
    const other = node("o", "Other");
    const nb = neighborhood(root, [other], [
      edge("e1", "REL", root.csid, other.csid, 1, {
        source: "pinakes",
        source_url: "https://example.org/x",
        confidence: 0.42,
      }),
    ]);
    const [rel] = relatedFromNeighborhood(nb);
    expect(rel.provenance).toMatchObject({
      source: "pinakes",
      sourceUrl: "https://example.org/x",
      confidence: 0.42,
    });
  });

  it("falls back to the csid when a related node has no name", () => {
    const root = node("root", "Root");
    const other = node("cs:x:1", "  ", ["Thing"]);
    const nb = neighborhood(root, [other], [
      edge("e1", "REL", root.csid, other.csid, 1),
    ]);
    expect(relatedFromNeighborhood(nb)[0].name).toBe("cs:x:1");
  });

  it("respects the limit option", () => {
    const root = node("root", "Root");
    const nodes = Array.from({ length: 5 }, (_, i) => node(`n${i}`, `N${i}`));
    const edges = nodes.map((n, i) =>
      edge(`e${i}`, "REL", root.csid, n.csid, 1 - i * 0.1),
    );
    const nb = neighborhood(root, nodes, edges);
    expect(relatedFromNeighborhood(nb, { limit: 2 })).toHaveLength(2);
    expect(relatedFromNeighborhood(nb, { limit: 0 })).toHaveLength(0);
  });

  it("returns [] for missing/empty neighborhoods", () => {
    expect(relatedFromNeighborhood(null)).toEqual([]);
    expect(relatedFromNeighborhood(undefined)).toEqual([]);
    const root = node("root", "Root");
    expect(relatedFromNeighborhood(neighborhood(root, [], []))).toEqual([]);
  });
});

describe("humanizeRelationship", () => {
  it("humanizes SCREAMING_SNAKE relationship types", () => {
    expect(humanizeRelationship("CONTEMPORARY_WITH")).toBe("Contemporary with");
    expect(humanizeRelationship("part_of")).toBe("Part of");
    expect(humanizeRelationship("derives-from")).toBe("Derives from");
  });

  it("handles single words and collapses whitespace", () => {
    expect(humanizeRelationship("INFLUENCED")).toBe("Influenced");
    expect(humanizeRelationship("  spoken   in ")).toBe("Spoken in");
    expect(humanizeRelationship("")).toBe("");
  });
});

describe("toRelatedEntity / href", () => {
  const suggestion: RelatedEntitySuggestion = {
    csid: "cs:language:sux",
    name: "Sumerian",
    type: "Language",
    relationship: "CONTEMPORARY_WITH",
    direction: "outgoing",
    weight: 0.8,
    provenance: { source: null, sourceUrl: null, retrievedAt: null, confidence: null },
  };

  it("projects to the lightweight RelatedEntity shape", () => {
    expect(toRelatedEntity(suggestion)).toEqual({
      id: "cs:language:sux",
      label: "Sumerian",
      type: "Language",
      href: "/advanced-tools?graph=cs%3Alanguage%3Asux",
    });
  });

  it("builds an encoded deep link", () => {
    expect(relatedEntityHref("cs:x:1")).toBe("/advanced-tools?graph=cs%3Ax%3A1");
  });

  it("maps a whole list", () => {
    expect(toRelatedEntities([suggestion])).toHaveLength(1);
    expect(toRelatedEntities([])).toEqual([]);
  });
});
