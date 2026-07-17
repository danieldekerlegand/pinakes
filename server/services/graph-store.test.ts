import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the Neo4j data-access layer. The `neo4j-driver` module is
 * mocked wholesale — no live Neo4j — so we can drive the success, empty,
 * timeout and unavailable paths deterministically.
 *
 * We only stub the small slice of the driver graph-store.ts touches:
 *   neo4j.driver() → { session(), verifyConnectivity(), close() }
 *   session.executeRead(fn) → runs fn against a fake tx whose run() returns a
 *   queued QueryResult (or throws a queued error).
 */

// ── Fake driver plumbing ────────────────────────────────────────────────────

interface FakeRecord {
  get(key: string): unknown;
}

function record(map: Record<string, unknown>): FakeRecord {
  return { get: (key: string) => map[key] };
}

/** Build a fake neo4j Node. */
function fakeNode(
  elementId: string,
  labels: string[],
  properties: Record<string, unknown>,
) {
  return { elementId, labels, properties };
}

/** Build a fake neo4j Relationship. */
function fakeRel(
  elementId: string,
  type: string,
  startNodeElementId: string,
  endNodeElementId: string,
  properties: Record<string, unknown> = {},
) {
  return { elementId, type, startNodeElementId, endNodeElementId, properties };
}

// Shared mutable state between the tests and the mocked driver. Declared via
// vi.hoisted so it exists when the hoisted vi.mock factory runs.
const mockState = vi.hoisted(() => ({
  // Queue of QueryResults / errors consumed by tx.run(), in order.
  runQueue: [] as Array<{ records: unknown[] } | Error>,
  verifyBehavior: "ok" as "ok" | "fail",
  sessionCloseSpy: vi.fn(),
  driverCloseSpy: vi.fn(),
  verifySpy: vi.fn(),
}));
const { sessionCloseSpy, driverCloseSpy, verifySpy } = mockState;

vi.mock("neo4j-driver", () => {
  const isIntTag = Symbol("neo4jInt");
  const makeInt = (n: number, safe = true) => ({
    [isIntTag]: true,
    _value: n,
    inSafeRange: () => safe,
    toNumber: () => n,
    toString: () => String(n),
  });
  const fakeSession = {
    executeRead: async (work: (tx: unknown) => unknown) => {
      const tx = {
        run: async () => {
          const next = mockState.runQueue.shift();
          if (next instanceof Error) throw next;
          if (!next) return { records: [] };
          return next;
        },
      };
      return work(tx);
    },
    close: mockState.sessionCloseSpy,
  };
  const driverObj = {
    session: () => fakeSession,
    verifyConnectivity: async (...args: unknown[]) => {
      mockState.verifySpy(...args);
      if (mockState.verifyBehavior === "fail") throw new Error("ServiceUnavailable");
      return { address: "localhost:7687" };
    },
    close: mockState.driverCloseSpy,
  };
  const neo4j = {
    driver: vi.fn(() => driverObj),
    auth: { basic: (u: string, p: string) => ({ scheme: "basic", u, p }) },
    session: { READ: "READ", WRITE: "WRITE" },
    isInt: (v: unknown) =>
      typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[isIntTag] === true,
    int: makeInt,
  };
  return { default: neo4j, ...neo4j };
});

// Import AFTER the mock is registered.
import * as graphStore from "./graph-store";
// Access the mocked int factory for building test fixtures.
import neo4j from "neo4j-driver";

// Re-expose the mocked int factory with the safe-range flag.
function int(n: number, safe = true) {
  return (neo4j.int as unknown as (n: number, safe?: boolean) => unknown)(n, safe);
}

beforeEach(() => {
  mockState.runQueue = [];
  mockState.verifyBehavior = "ok";
  sessionCloseSpy.mockClear();
  driverCloseSpy.mockClear();
  verifySpy.mockClear();
  process.env.NEO4J_URI = "bolt://localhost:7687";
  process.env.NEO4J_USER = "neo4j";
  process.env.NEO4J_PASSWORD = "test";
  // Personal-tier gating defaults OFF (analyzer-bridge US-004); each test opts in.
  delete process.env.PERSONAL_TIER_ENABLED;
});

afterEach(async () => {
  // Reset the module's driver singleton + availability cache between tests.
  await graphStore.closeGraphStore();
});

// ── getNode ─────────────────────────────────────────────────────────────────

describe("getNode", () => {
  it("projects a node, splitting csid/name and coercing integers", async () => {
    mockState.runQueue = [
      {
        records: [
          record({
            n: fakeNode("el-1", ["Language", "Entity"], {
              csid: "cs:language:sux",
              name: "Sumerian",
              time_start: int(-3100),
              iso639_3: "sux",
            }),
          }),
        ],
      },
    ];
    const node = await graphStore.getNode("cs:language:sux");
    expect(node).toEqual({
      csid: "cs:language:sux",
      labels: ["Language", "Entity"],
      name: "Sumerian",
      properties: { time_start: -3100, iso639_3: "sux" },
    });
  });

  it("preserves out-of-safe-range integers as strings", async () => {
    mockState.runQueue = [
      {
        records: [
          record({
            n: fakeNode("el-2", ["Entity"], {
              csid: "cs:x:big",
              name: "Big",
              huge: int(90071992547409910, false),
            }),
          }),
        ],
      },
    ];
    const node = await graphStore.getNode("cs:x:big");
    // Out-of-range integers are kept as strings rather than lossy numbers.
    expect(typeof node?.properties.huge).toBe("string");
  });

  it("returns null when the node does not exist", async () => {
    mockState.runQueue = [{ records: [] }];
    expect(await graphStore.getNode("cs:missing")).toBeNull();
  });

  it("throws GraphUnavailableError and closes the session when the driver fails", async () => {
    mockState.runQueue = [new Error("ServiceUnavailable: connection refused")];
    await expect(graphStore.getNode("cs:x")).rejects.toBeInstanceOf(
      graphStore.GraphUnavailableError,
    );
    expect(sessionCloseSpy).toHaveBeenCalled();
  });

  it("maps a query timeout to GraphUnavailableError", async () => {
    mockState.runQueue = [new Error("The transaction has been terminated. timeout exceeded")];
    await expect(graphStore.getNode("cs:x")).rejects.toBeInstanceOf(
      graphStore.GraphUnavailableError,
    );
  });
});

// ── getNodesByLabel ──────────────────────────────────────────────────────────

describe("getNodesByLabel", () => {
  it("projects every node carrying a label", async () => {
    mockState.runQueue = [
      {
        records: [
          record({
            n: fakeNode("el-1", ["Language"], { csid: "cs:language:lat", name: "Latin" }),
          }),
          record({
            n: fakeNode("el-2", ["Language"], { csid: "cs:language:grc", name: "Greek" }),
          }),
        ],
      },
    ];
    const nodes = await graphStore.getNodesByLabel("Language");
    expect(nodes.map((n) => n.csid)).toEqual(["cs:language:lat", "cs:language:grc"]);
    expect(nodes[0].name).toBe("Latin");
  });

  it("returns an empty array when no node carries the label", async () => {
    mockState.runQueue = [{ records: [] }];
    expect(await graphStore.getNodesByLabel("Cuisine")).toEqual([]);
  });

  it("rejects an unsafe label without touching the driver", async () => {
    await expect(graphStore.getNodesByLabel("Bad Label; MATCH")).rejects.toBeInstanceOf(
      graphStore.GraphUnavailableError,
    );
    // No query was queued/consumed — the guard runs before any Cypher.
    expect(mockState.runQueue).toEqual([]);
  });
});

// ── getNeighborhood ──────────────────────────────────────────────────────────

describe("getNeighborhood", () => {
  it("clamps depth into the 1..3 range", () => {
    expect(graphStore.clampDepth(0)).toBe(1);
    expect(graphStore.clampDepth(2)).toBe(2);
    expect(graphStore.clampDepth(9)).toBe(3);
    expect(graphStore.clampDepth(Number.NaN)).toBe(1);
    expect(graphStore.clampDepth(2.9)).toBe(2);
  });

  it("assembles root, reachable nodes, and edges scoped to the node set", async () => {
    const focus = fakeNode("f", ["Entity"], { csid: "cs:a", name: "A" });
    const nb = fakeNode("n1", ["Entity"], { csid: "cs:b", name: "B" });
    const outside = "cs:ghost-element";
    mockState.runQueue = [
      {
        records: [
          record({
            focus,
            reachedNodes: [nb],
            pathRels: [
              fakeRel("r1", "CONTEMPORARY_WITH", "f", "n1", { weight: 0.9 }),
              // edge to a node not in the returned set → dropped
              fakeRel("r2", "SAME_REGION", "f", outside, {}),
            ],
          }),
        ],
      },
    ];
    const result = await graphStore.getNeighborhood("cs:a", 2);
    expect(result?.depth).toBe(2);
    expect(result?.root.csid).toBe("cs:a");
    expect(result?.nodes.map((n) => n.csid).sort()).toEqual(["cs:a", "cs:b"]);
    expect(result?.edges).toHaveLength(1);
    expect(result?.edges[0]).toMatchObject({
      type: "CONTEMPORARY_WITH",
      startCsid: "cs:a",
      endCsid: "cs:b",
      weight: 0.9,
    });
  });

  it("returns null when the focus node is missing", async () => {
    mockState.runQueue = [{ records: [] }];
    expect(await graphStore.getNeighborhood("cs:missing", 1)).toBeNull();
  });

  it("falls back to pure Cypher when APOC is unavailable", async () => {
    const focus = fakeNode("f", ["Entity"], { csid: "cs:a", name: "A" });
    mockState.runQueue = [
      new Error("There is no procedure with the name `apoc.coll.flatten`"),
      {
        records: [
          record({ focus, reachedNodes: [], pathRels: [] }),
        ],
      },
    ];
    const result = await graphStore.getNeighborhood("cs:a", 1);
    expect(result?.root.csid).toBe("cs:a");
    expect(result?.edges).toEqual([]);
  });
});

// ── getCorrelations ──────────────────────────────────────────────────────────

describe("getCorrelations", () => {
  it("returns correlated nodes ordered by the driver, with weights", async () => {
    mockState.runQueue = [
      {
        records: [
          record({
            other: fakeNode("o1", ["Entity"], { csid: "cs:b", name: "B" }),
            relType: "CONTEMPORARY_WITH",
            weight: int(3),
          }),
          record({
            other: fakeNode("o2", ["Entity"], { csid: "cs:c", name: "C" }),
            relType: "SAME_REGION",
            weight: null,
          }),
        ],
      },
    ];
    const results = await graphStore.getCorrelations("cs:a");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ relationship: "CONTEMPORARY_WITH", weight: 3 });
    expect(results[0].node.csid).toBe("cs:b");
    expect(results[1].weight).toBeUndefined();
  });

  it("rejects an invalid relationship type before querying", async () => {
    await expect(
      graphStore.getCorrelations("cs:a", "BAD-TYPE; DROP"),
    ).rejects.toBeInstanceOf(graphStore.GraphUnavailableError);
  });

  it("accepts a valid relationship filter", async () => {
    mockState.runQueue = [{ records: [] }];
    await expect(
      graphStore.getCorrelations("cs:a", "CONTEMPORARY_WITH"),
    ).resolves.toEqual([]);
  });
});

// ── findPath ─────────────────────────────────────────────────────────────────

describe("findPath", () => {
  it("clamps path length into the 1..6 range", () => {
    expect(graphStore.clampPathLength(0)).toBe(1);
    expect(graphStore.clampPathLength(4)).toBe(4);
    expect(graphStore.clampPathLength(99)).toBe(6);
    expect(graphStore.clampPathLength(Number.NaN)).toBe(4);
  });

  it("projects the ordered nodes and edges of the shortest path", async () => {
    const spa = fakeNode("n0", ["Language"], { csid: "cs:language:spa", name: "Spanish" });
    const lat = fakeNode("n1", ["Language"], { csid: "cs:language:lat", name: "Latin" });
    const pie = fakeNode("n2", ["Language"], { csid: "cs:language:pie", name: "PIE" });
    mockState.runQueue = [
      {
        records: [
          record({
            pathNodes: [spa, lat, pie],
            pathRels: [
              fakeRel("r0", "DESCENDS_FROM", "n0", "n1", { weight: 0.9 }),
              fakeRel("r1", "DESCENDS_FROM", "n1", "n2", { source: "Comparative method" }),
            ],
          }),
        ],
      },
    ];
    const path = await graphStore.findPath("cs:language:spa", "cs:language:pie");
    expect(path?.from.csid).toBe("cs:language:spa");
    expect(path?.to.csid).toBe("cs:language:pie");
    expect(path?.nodes.map((n) => n.csid)).toEqual([
      "cs:language:spa",
      "cs:language:lat",
      "cs:language:pie",
    ]);
    expect(path?.length).toBe(2);
    expect(path?.edges[0]).toMatchObject({ type: "DESCENDS_FROM", weight: 0.9, startCsid: "cs:language:spa" });
    expect(path?.edges[1].properties).toMatchObject({ source: "Comparative method" });
  });

  it("returns null when there is no connecting path", async () => {
    mockState.runQueue = [{ records: [] }];
    expect(await graphStore.findPath("cs:a", "cs:b")).toBeNull();
  });

  it("throws GraphUnavailableError when the driver fails", async () => {
    mockState.runQueue = [new Error("ServiceUnavailable")];
    await expect(graphStore.findPath("cs:a", "cs:b")).rejects.toBeInstanceOf(
      graphStore.GraphUnavailableError,
    );
  });
});

// ── personal-tier gating (analyzer-bridge US-004) ───────────────────────────────

describe("personal-tier gating", () => {
  const asset = () =>
    fakeNode("a1", ["Asset", "Entity"], {
      csid: "cs:asset:aaa",
      name: "beach.jpg",
      source: "analyzer",
    });
  const place = () =>
    fakeNode("p1", ["Place", "Entity"], {
      csid: "cs:place:Q1524",
      name: "Athens",
      source: "pinakes",
    });

  it("does not surface a personal node by direct csid lookup when disabled", async () => {
    mockState.runQueue = [{ records: [record({ n: asset() })] }];
    expect(await graphStore.getNode("cs:asset:aaa")).toBeNull();
  });

  it("surfaces a personal node by csid lookup when the tier is enabled", async () => {
    process.env.PERSONAL_TIER_ENABLED = "true";
    mockState.runQueue = [{ records: [record({ n: asset() })] }];
    const node = await graphStore.getNode("cs:asset:aaa");
    expect(node?.csid).toBe("cs:asset:aaa");
    expect(node?.labels).toContain("Asset");
  });

  it("filters personal nodes out of getNodesByLabel when disabled", async () => {
    mockState.runQueue = [
      { records: [record({ n: place() }), record({ n: asset() })] },
    ];
    const nodes = await graphStore.getNodesByLabel("Entity");
    expect(nodes.map((n) => n.csid)).toEqual(["cs:place:Q1524"]);
  });

  it("drops personal nodes and their edges from the overview when disabled", async () => {
    mockState.runQueue = [
      {
        records: [
          record({
            nodes: [place(), asset()],
            rels: [fakeRel("r1", "DEPICTS", "a1", "p1", { source: "analyzer" })],
          }),
        ],
      },
    ];
    const snapshot = await graphStore.getGraphOverview(10);
    expect(snapshot.nodes.map((n) => n.csid)).toEqual(["cs:place:Q1524"]);
    // The DEPICTS edge touched the dropped asset, so it is pruned too.
    expect(snapshot.edges).toEqual([]);
  });

  it("keeps personal nodes and edges in the overview when enabled", async () => {
    process.env.PERSONAL_TIER_ENABLED = "1";
    mockState.runQueue = [
      {
        records: [
          record({
            nodes: [place(), asset()],
            rels: [fakeRel("r1", "DEPICTS", "a1", "p1", { source: "analyzer" })],
          }),
        ],
      },
    ];
    const snapshot = await graphStore.getGraphOverview(10);
    expect(snapshot.nodes.map((n) => n.csid).sort()).toEqual([
      "cs:asset:aaa",
      "cs:place:Q1524",
    ]);
    expect(snapshot.edges).toHaveLength(1);
  });
});

// ── isAvailable ──────────────────────────────────────────────────────────────

describe("isAvailable", () => {
  it("returns true when connectivity verifies", async () => {
    mockState.verifyBehavior = "ok";
    expect(await graphStore.isAvailable()).toBe(true);
  });

  it("returns false when connectivity fails, without throwing", async () => {
    mockState.verifyBehavior = "fail";
    expect(await graphStore.isAvailable()).toBe(false);
  });

  it("caches the probe result for the TTL window (single verify call)", async () => {
    mockState.verifyBehavior = "ok";
    await graphStore.isAvailable();
    await graphStore.isAvailable();
    await graphStore.isAvailable();
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it("re-probes after the cache is invalidated by a query failure", async () => {
    mockState.verifyBehavior = "ok";
    expect(await graphStore.isAvailable()).toBe(true);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    // A failing query should clear the availability cache.
    mockState.runQueue = [new Error("ServiceUnavailable")];
    await expect(graphStore.getNode("cs:x")).rejects.toBeInstanceOf(
      graphStore.GraphUnavailableError,
    );

    mockState.verifyBehavior = "fail";
    expect(await graphStore.isAvailable()).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(2);
  });
});

// ── closeGraphStore ──────────────────────────────────────────────────────────

describe("closeGraphStore", () => {
  it("closes the underlying driver and is safe to call twice", async () => {
    // Force driver creation.
    mockState.verifyBehavior = "ok";
    await graphStore.isAvailable();
    await graphStore.closeGraphStore();
    expect(driverCloseSpy).toHaveBeenCalledTimes(1);
    // Second call is a no-op (no driver to close).
    await graphStore.closeGraphStore();
    expect(driverCloseSpy).toHaveBeenCalledTimes(1);
  });
});
