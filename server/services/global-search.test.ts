/**
 * Federated global search (US-009): merge, dedup, ranking, and local-only fallback.
 *
 * These tests drive the pure {@link mergeGraphResults} and the dependency-injected
 * {@link federatedSearch} with fixtures — no live storage, no network, no Neo4j.
 */
import { describe, it, expect, vi } from "vitest";
import {
  mergeGraphResults,
  federatedSearch,
  type SearchResult,
  type SearchResponse,
} from "./global-search";
import type { SearchHit, SearchResponse as GraphSearchResponse } from "./culturescrape-client";
import type { GraphResolver, ResolvedCsid, EntityRef } from "./graph-resolver";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function localResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    entityType: "language",
    id: "akk",
    displayName: "Akkadian",
    description: "Akkadian — akk",
    linkPath: "/languages/akk",
    relevance: 0.8,
    source: "local",
    ...overrides,
  };
}

function graphHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    csid: "cs:language:akk",
    name: "Akkadian",
    label: "Language",
    qid: "Q35518",
    field: "name",
    tsv: "/nodes/language.tsv#akk",
    graph: "/graph/cs:language:akk",
    ...overrides,
  };
}

/** A resolver that maps a fixed set of (type,id) refs to csids. */
function stubResolver(map: Record<string, ResolvedCsid | null>): Pick<GraphResolver, "resolve"> {
  return {
    resolve(ref: EntityRef): ResolvedCsid | null {
      return map[`${ref.type}:${ref.id}`] ?? null;
    },
  };
}

const NO_RESOLVE: Pick<GraphResolver, "resolve"> = { resolve: () => null };

// ── mergeGraphResults ──────────────────────────────────────────────────────

describe("mergeGraphResults", () => {
  it("merges local and graph results, tagging each with its source", () => {
    const local = [localResult({ id: "sux", displayName: "Sumerian", relevance: 0.7 })];
    const hits = [graphHit({ csid: "cs:culture:hittite", name: "Hittite", label: "Culture" })];

    const { results, graphCount } = mergeGraphResults(local, hits, NO_RESOLVE, "an");

    expect(graphCount).toBe(1);
    expect(results).toHaveLength(2);
    const sources = results.map((r) => r.source);
    expect(sources).toContain("local");
    expect(sources).toContain("graph");
    const graph = results.find((r) => r.source === "graph")!;
    expect(graph.csid).toBe("cs:culture:hittite");
    expect(graph.entityType).toBe("culture");
    expect(graph.provenance?.source).toBe("culture-scrape graph");
  });

  it("dedups an entity present in both, matched by csid alias (local wins)", () => {
    const local = [localResult()]; // language:akk
    const hits = [
      graphHit(), // cs:language:akk — same entity, must be dropped
      graphHit({ csid: "cs:culture:elam", name: "Elam", label: "Culture" }),
    ];
    const resolver = stubResolver({
      "language:akk": { csid: "cs:language:akk", confidence: 1, method: "alias" },
    });

    const { results, graphCount } = mergeGraphResults(local, hits, resolver, "a");

    expect(graphCount).toBe(1); // only the non-dup graph hit survives
    const csids = results.map((r) => r.csid);
    // the akk csid appears exactly once — carried by the local (winning) result
    expect(csids.filter((c) => c === "cs:language:akk")).toHaveLength(1);
    const akk = results.find((r) => r.csid === "cs:language:akk")!;
    expect(akk.source).toBe("local");
    expect(results.some((r) => r.csid === "cs:culture:elam" && r.source === "graph")).toBe(true);
  });

  it("collapses duplicate csids within the sidecar payload", () => {
    const hits = [graphHit(), graphHit()]; // same csid twice
    const { results, graphCount } = mergeGraphResults([], hits, NO_RESOLVE, "akk");
    expect(graphCount).toBe(1);
    expect(results).toHaveLength(1);
  });

  it("ranks exact-field (csid/QID) graph matches at 1.0 and sorts by relevance", () => {
    const local = [localResult({ relevance: 0.55 })];
    const hits = [graphHit({ csid: "cs:language:xyz", name: "Xyzzy", field: "csid" })];

    const { results } = mergeGraphResults(local, hits, NO_RESOLVE, "akk");

    const exact = results.find((r) => r.source === "graph")!;
    expect(exact.relevance).toBe(1);
    expect(exact.confidence).toBe(1);
    // sorted descending — the exact graph hit outranks the 0.55 local result
    expect(results[0].csid).toBe("cs:language:xyz");
  });

  it("scores a name-only graph match by fuzzy relevance below 1.0", () => {
    const hits = [graphHit({ csid: "cs:language:akk", name: "Akkadian", field: "name" })];
    const { results } = mergeGraphResults([], hits, NO_RESOLVE, "akkadian");
    const hit = results[0];
    expect(hit.relevance).toBeGreaterThan(0);
    expect(hit.relevance).toBeLessThanOrEqual(1);
    expect(hit.confidence).toBe(hit.relevance);
  });
});

// ── federatedSearch (dependency-injected) ─────────────────────────────────────

describe("federatedSearch", () => {
  const localResponse: SearchResponse = {
    results: [localResult()],
    query: "akk",
    totalCount: 1,
  };
  const localSearch = () => Promise.resolve(localResponse);

  it("merges graph hits into the local response", async () => {
    const graphSearch = vi.fn(
      (): Promise<GraphSearchResponse> =>
        Promise.resolve({
          query: "akk",
          results: [graphHit({ csid: "cs:culture:elam", name: "Elam", label: "Culture" })],
        }),
    );

    const res = await federatedSearch("akk", {
      localSearch,
      graphSearch,
      resolver: NO_RESOLVE,
    });

    expect(graphSearch).toHaveBeenCalledWith("akk", expect.any(Number));
    expect(res.results.some((r) => r.source === "graph")).toBe(true);
    expect(res.totalCount).toBe(2); // 1 local + 1 graph
  });

  it("degrades to local-only (no error surfaced) when the graph search throws", async () => {
    const graphSearch = vi.fn(() => Promise.reject(new Error("sidecar down")));

    const res = await federatedSearch("akk", {
      localSearch,
      graphSearch,
      resolver: NO_RESOLVE,
    });

    expect(res.results).toHaveLength(1);
    expect(res.results[0].source).toBe("local");
    expect(res.totalCount).toBe(1);
  });

  it("returns the empty local response without probing the graph for a blank query", async () => {
    const graphSearch = vi.fn();
    const res = await federatedSearch("   ", {
      localSearch: () => Promise.resolve({ results: [], query: "", totalCount: 0 }),
      graphSearch,
      resolver: NO_RESOLVE,
    });
    expect(res.results).toHaveLength(0);
    expect(graphSearch).not.toHaveBeenCalled();
  });
});
