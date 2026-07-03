import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  traverseGraph,
  executeTask,
} from "./computation.ts";
import type { GraphTraversalInput } from "./computation.ts";

// A small sample graph used across tests:
//
//   a → b → d
//   a → c → d
//   d → e
//
const SAMPLE_EDGES: [string, string][] = [
  ["a", "b"],
  ["a", "c"],
  ["b", "d"],
  ["c", "d"],
  ["d", "e"],
];

describe("buildAdjacency", () => {
  it("preserves neighbor insertion order for directed edges", () => {
    const adj = buildAdjacency(SAMPLE_EDGES, true);
    expect(adj.get("a")).toEqual(["b", "c"]);
    expect(adj.get("d")).toEqual(["e"]);
  });

  it("registers target-only nodes with an empty neighbor list (directed)", () => {
    const adj = buildAdjacency([["a", "b"]], true);
    expect(adj.get("b")).toEqual([]);
  });

  it("adds reverse edges when undirected", () => {
    const adj = buildAdjacency([["a", "b"]], false);
    expect(adj.get("a")).toEqual(["b"]);
    expect(adj.get("b")).toEqual(["a"]);
  });
});

describe("traverseGraph — BFS", () => {
  const bfs = (over: Partial<GraphTraversalInput> = {}) =>
    traverseGraph({
      edges: SAMPLE_EDGES,
      directed: true,
      source: "a",
      algorithm: "bfs",
      ...over,
    });

  it("visits nodes in breadth-first order", () => {
    expect(bfs().order).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("records shortest hop distances", () => {
    expect(bfs().distances).toEqual({ a: 0, b: 1, c: 1, d: 2, e: 3 });
  });

  it("finds a shortest path to a target", () => {
    const r = bfs({ target: "e" });
    expect(r.reached).toBe(true);
    expect(r.path).toEqual(["a", "b", "d", "e"]);
  });

  it("stops early once the target is dequeued", () => {
    // 'd' is reached before 'e' would be, so 'e' is never visited.
    const r = bfs({ target: "d" });
    expect(r.order).toEqual(["a", "b", "c", "d"]);
    expect(r.order).not.toContain("e");
  });

  it("reports an unreachable target", () => {
    const r = traverseGraph({
      edges: SAMPLE_EDGES,
      directed: true,
      source: "e",
      target: "a",
      algorithm: "bfs",
    });
    expect(r.reached).toBe(false);
    expect(r.path).toBeNull();
  });

  it("honors maxDepth (nodes at the limit are visited but not expanded)", () => {
    const r = bfs({ maxDepth: 1 });
    expect(r.order).toEqual(["a", "b", "c"]);
    expect(r.distances).toEqual({ a: 0, b: 1, c: 1 });
  });

  it("maxDepth 0 visits only the source", () => {
    expect(bfs({ maxDepth: 0 }).order).toEqual(["a"]);
  });

  it("treats an isolated source as visited with no target => reached", () => {
    const r = traverseGraph({
      edges: [],
      directed: true,
      source: "lonely",
      algorithm: "bfs",
    });
    expect(r.order).toEqual(["lonely"]);
    expect(r.reached).toBe(true);
    expect(r.path).toBeNull();
  });

  it("returns a trivial path when source === target", () => {
    const r = bfs({ target: "a" });
    expect(r.reached).toBe(true);
    expect(r.path).toEqual(["a"]);
  });

  it("reaches the whole neighborhood in an undirected graph", () => {
    const r = traverseGraph({
      edges: SAMPLE_EDGES,
      directed: false,
      source: "e",
      algorithm: "bfs",
    });
    expect(new Set(r.order)).toEqual(new Set(["a", "b", "c", "d", "e"]));
    expect(r.distances.e).toBe(0);
    expect(r.distances.a).toBe(3);
  });
});

describe("traverseGraph — DFS", () => {
  const dfs = (over: Partial<GraphTraversalInput> = {}) =>
    traverseGraph({
      edges: SAMPLE_EDGES,
      directed: true,
      source: "a",
      algorithm: "dfs",
      ...over,
    });

  it("visits nodes depth-first following edge order", () => {
    // a → b → d → e, then backtrack to c (already-visited d is skipped)
    expect(dfs().order).toEqual(["a", "b", "d", "e", "c"]);
  });

  it("reaches every node reachable from the source", () => {
    expect(new Set(dfs().order)).toEqual(new Set(["a", "b", "c", "d", "e"]));
  });

  it("builds a path along the DFS tree", () => {
    const r = dfs({ target: "e" });
    expect(r.reached).toBe(true);
    expect(r.path).toEqual(["a", "b", "d", "e"]);
  });

  it("honors maxDepth", () => {
    const r = dfs({ maxDepth: 1 });
    expect(new Set(r.order)).toEqual(new Set(["a", "b", "c"]));
    expect(r.distances).toEqual({ a: 0, b: 1, c: 1 });
  });

  it("reports an unreachable target", () => {
    const r = dfs({ source: "e", target: "a" });
    expect(r.reached).toBe(false);
    expect(r.path).toBeNull();
  });
});

describe("executeTask — graphTraversal", () => {
  it("runs a traversal task through the worker interface", () => {
    const result = executeTask({
      type: "graphTraversal",
      payload: {
        edges: SAMPLE_EDGES,
        directed: true,
        source: "a",
        target: "e",
        algorithm: "bfs",
      },
    }) as ReturnType<typeof traverseGraph>;

    expect(result.path).toEqual(["a", "b", "d", "e"]);
    expect(result.reached).toBe(true);
  });
});
