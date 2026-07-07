import { describe, it, expect, vi } from "vitest";

import {
  scoreCorrelations,
  rankCorrelations,
  type DomainEntity,
  type DomainType,
  type RelationshipType,
} from "./cross-domain-correlation";
import {
  correlateViaGraph,
  correlateWithGraphFallback,
  graphNodeToDomainEntity,
  graphDomainLabel,
  isGraphEligible,
  isGraphCorrelationEnabled,
  DOMAIN_LABELS,
} from "./cross-domain-correlation-graph";
import { GraphUnavailableError, type GraphNode } from "./graph-store";

// ── Shared fixture ───────────────────────────────────────────────────────────
// One source of truth: the same DomainEntity records feed BOTH the in-memory
// reference scorer and the graph path (via GraphNodes rebuilt from them). If the
// graph projection reconstructs the entities faithfully, the two paths must
// produce identical ranked results — that is the parity guarantee.

const NOW_YEAR = 2026;

const LANGUAGES: DomainEntity[] = [
  {
    id: "lat",
    name: "Latin",
    domain: "language",
    languageIds: ["lat"],
    region: "Southern Europe",
    coordinates: { lat: 41.9, lng: 12.5 },
    timeStart: -700,
    timeEnd: 600,
  },
  {
    id: "grc",
    name: "Ancient Greek",
    domain: "language",
    languageIds: ["grc"],
    region: "Southern Europe",
    coordinates: { lat: 38.0, lng: 23.7 },
    timeStart: -800,
    timeEnd: 300,
  },
];

const CUISINES: DomainEntity[] = [
  {
    id: "roman",
    name: "Roman Cuisine",
    domain: "cuisine",
    languageIds: ["lat"],
    region: "Southern Europe",
    coordinates: { lat: 41.9, lng: 12.5 },
    timeStart: -500,
    timeEnd: 400,
  },
  {
    id: "greek",
    name: "Greek Cuisine",
    domain: "cuisine",
    languageIds: ["grc"],
    region: "Southern Europe",
    coordinates: { lat: 38.0, lng: 23.7 },
    timeStart: -600,
    timeEnd: 200,
  },
];

/** Rebuild a graph node from a fixture entity (inverse of the projection). */
function toGraphNode(e: DomainEntity): GraphNode {
  const label = DOMAIN_LABELS[e.domain] ?? "Entity";
  return {
    csid: `cs:${e.domain}:${e.id}`,
    labels: [label],
    name: e.name,
    properties: {
      linguascrape_id: e.id,
      associated_language_ids: e.languageIds,
      ...(e.region ? { region: e.region } : {}),
      ...(e.coordinates ? { lat: e.coordinates.lat, lon: e.coordinates.lng } : {}),
      ...(e.timeStart !== null ? { time_start: e.timeStart } : {}),
      ...(e.timeEnd !== null ? { time_end: e.timeEnd } : {}),
    },
  };
}

/** A fake loader that answers each domain's label from the fixture. */
function fakeLoader(): (label: string) => Promise<GraphNode[]> {
  const byLabel = new Map<string, GraphNode[]>([
    [DOMAIN_LABELS.language!, LANGUAGES.map(toGraphNode)],
    [DOMAIN_LABELS.cuisine!, CUISINES.map(toGraphNode)],
  ]);
  return async (label: string) => byLabel.get(label) ?? [];
}

/** The in-memory TS path's output — exactly what queryCorrelation computes. */
function referenceResult(
  domainA: DomainType,
  domainB: DomainType,
  rel: RelationshipType,
  a: DomainEntity[],
  b: DomainEntity[],
) {
  return rankCorrelations(domainA, domainB, rel, scoreCorrelations(rel, a, b, NOW_YEAR));
}

// ── Projection ───────────────────────────────────────────────────────────────

describe("graphNodeToDomainEntity", () => {
  it("projects canonical node props into a DomainEntity", () => {
    const node: GraphNode = {
      csid: "cs:language:lat",
      labels: ["Language"],
      name: "Latin",
      properties: {
        linguascrape_id: "lat",
        associated_language_ids: ["lat"],
        region: "Southern Europe",
        lat: 41.9,
        lon: 12.5,
        time_start: -700,
        time_end: 600,
      },
    };
    expect(graphNodeToDomainEntity(node, "language")).toEqual({
      id: "lat",
      name: "Latin",
      domain: "language",
      languageIds: ["lat"],
      region: "Southern Europe",
      coordinates: { lat: 41.9, lng: 12.5 },
      timeStart: -700,
      timeEnd: 600,
    });
  });

  it("falls back to csid, drops partial coords, and defaults missing props", () => {
    const node: GraphNode = {
      csid: "cs:cuisine:roman",
      labels: ["Cuisine"],
      name: "Roman Cuisine",
      properties: { lat: 41.9 }, // no lon → no coordinates
    };
    expect(graphNodeToDomainEntity(node, "cuisine")).toEqual({
      id: "cs:cuisine:roman",
      name: "Roman Cuisine",
      domain: "cuisine",
      languageIds: [],
      region: null,
      coordinates: null,
      timeStart: null,
      timeEnd: null,
    });
  });
});

// ── Parity: graph path === in-memory path on the shared fixture ──────────────

describe("correlateViaGraph parity with the in-memory path", () => {
  const relationshipTypes: RelationshipType[] = [
    "co-occurrence",
    "temporal-correlation",
    "geographic-overlap",
  ];

  for (const rel of relationshipTypes) {
    it(`matches the TS result for ${rel}`, async () => {
      const graph = await correlateViaGraph("language", "cuisine", rel, {
        loadNodesByLabel: fakeLoader(),
        nowYear: NOW_YEAR,
      });
      const reference = referenceResult("language", "cuisine", rel, LANGUAGES, CUISINES);
      expect(graph).toEqual(reference);
      // Sanity: the fixture actually produces correlations (not a trivial empty match).
      expect(graph.correlations.length).toBeGreaterThan(0);
    });
  }

  it("loads each domain from its canonical :LABEL", async () => {
    const loader = vi.fn(fakeLoader());
    await correlateViaGraph("language", "cuisine", "co-occurrence", {
      loadNodesByLabel: loader,
      nowYear: NOW_YEAR,
    });
    expect(loader).toHaveBeenCalledWith("Language");
    expect(loader).toHaveBeenCalledWith("Cuisine");
  });

  it("throws GraphUnavailableError for a domain with no graph label", async () => {
    await expect(
      correlateViaGraph("music", "cuisine", "co-occurrence", {
        loadNodesByLabel: fakeLoader(),
      }),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
  });
});

// ── Feature flag + fallback ──────────────────────────────────────────────────

describe("correlateWithGraphFallback", () => {
  const fallback = () =>
    Promise.resolve(referenceResult("language", "cuisine", "co-occurrence", LANGUAGES, CUISINES));

  it("uses the in-memory path when the flag is disabled", async () => {
    const loader = vi.fn(fakeLoader());
    const { source, result } = await correlateWithGraphFallback(
      "language",
      "cuisine",
      "co-occurrence",
      fallback,
      { loadNodesByLabel: loader, nowYear: NOW_YEAR },
      {} as NodeJS.ProcessEnv, // no CORRELATION_GRAPH_ENABLED
    );
    expect(source).toBe("memory");
    expect(loader).not.toHaveBeenCalled();
    expect(result).toEqual(await fallback());
  });

  it("uses the in-memory path when a domain is not graph-eligible", async () => {
    const loader = vi.fn(fakeLoader());
    const { source } = await correlateWithGraphFallback(
      "haplogroup",
      "cuisine",
      "co-occurrence",
      fallback,
      { loadNodesByLabel: loader, nowYear: NOW_YEAR },
      { CORRELATION_GRAPH_ENABLED: "true" } as unknown as NodeJS.ProcessEnv,
    );
    expect(source).toBe("memory");
    expect(loader).not.toHaveBeenCalled();
  });

  it("serves from the graph when enabled + eligible, and it matches the fallback", async () => {
    const { source, result } = await correlateWithGraphFallback(
      "language",
      "cuisine",
      "co-occurrence",
      fallback,
      { loadNodesByLabel: fakeLoader(), nowYear: NOW_YEAR },
      { CORRELATION_GRAPH_ENABLED: "1" } as unknown as NodeJS.ProcessEnv,
    );
    expect(source).toBe("graph");
    expect(result).toEqual(await fallback());
  });

  it("degrades to the in-memory path when the graph is unavailable", async () => {
    const { source, result } = await correlateWithGraphFallback(
      "language",
      "cuisine",
      "co-occurrence",
      fallback,
      {
        loadNodesByLabel: () =>
          Promise.reject(new GraphUnavailableError("Neo4j down")),
        nowYear: NOW_YEAR,
      },
      { CORRELATION_GRAPH_ENABLED: "yes" } as unknown as NodeJS.ProcessEnv,
    );
    expect(source).toBe("memory");
    expect(result).toEqual(await fallback());
  });

  it("propagates a non-GraphUnavailable error rather than masking it", async () => {
    await expect(
      correlateWithGraphFallback(
        "language",
        "cuisine",
        "co-occurrence",
        fallback,
        { loadNodesByLabel: () => Promise.reject(new Error("boom")) },
        { CORRELATION_GRAPH_ENABLED: "on" } as unknown as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow("boom");
  });
});

// ── Small helpers ────────────────────────────────────────────────────────────

describe("domain/label + flag helpers", () => {
  it("maps graph-eligible domains to canonical labels", () => {
    expect(graphDomainLabel("civilization")).toBe("Culture");
    expect(graphDomainLabel("music")).toBeNull();
    expect(isGraphEligible("language", "religion")).toBe(true);
    expect(isGraphEligible("language", "music")).toBe(false);
  });

  it("reads the feature flag from env (off by default)", () => {
    expect(isGraphCorrelationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isGraphCorrelationEnabled({ CORRELATION_GRAPH_ENABLED: "false" } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isGraphCorrelationEnabled({ CORRELATION_GRAPH_ENABLED: "true" } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
