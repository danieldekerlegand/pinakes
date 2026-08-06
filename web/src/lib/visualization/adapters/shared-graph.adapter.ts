/**
 * The shared Pinakes graph as a UnifiedExplorer dataset (US-008).
 *
 * This file, its export and its dataset id all carried the engine's former name
 * until `tasks/chief/80-cutover.json` US-2 renamed them — the last live use of
 * it anywhere in the repo (docs/UNIFIED-PROJECT-PLAN.md §"Naming" has the
 * record). The `?ds=` links that carried the old id — the e2e specs, any
 * bookmark — say `pinakes-graph` now. The `cs:` csid namespace is a *data*
 * id-space, not a project name, and is deliberately untouched by that rename.
 *
 * Unlike the local TSV datasets, this adapter fetches a `{ nodes, edges }`
 * snapshot from `/api/graph/overview` (the Python service's `routers/graph.py`
 * → Neo4j) and projects the generic graph payload into every explorer
 * dimension:
 *   - relational   — the nodes and edges themselves (`:LABEL`-coloured nodes,
 *                    `:TYPE`-labelled links)
 *   - hierarchical — a containment/descent tree derived from the subset of edge
 *                    types that express parent/child (see {@link CHILD_TO_PARENT})
 *   - temporal     — nodes carrying `time_start`/`time_end`
 *   - spatial      — nodes carrying coordinates
 *   - categorical  — one row per node, faceted by entity type / period / region
 *
 * The node/edge shapes mirror the service's graph projection (re-used from the
 * US-007 neighborhood projection). `detail` surfaces provenance (source,
 * source_url, retrieved_at, confidence) so graph facts stay attributable.
 *
 * Everything here is pure and DOM-free, unit-tested under vitest's node
 * environment (the repo has no jsdom/testing-library).
 */
import type {
  DatasetAdapter,
  DimensionProjections,
  HierarchicalNode,
  ProjectionOptions,
  RelationalLink,
  RelationalNode,
} from "./types";
import {
  primaryLabel,
  type GraphEdgePayload,
  type GraphNodePayload,
} from "@/lib/graph/neighborhood-graph";
import { extractProvenance } from "@/lib/graph/provenance";

/** The `{ nodes, edges }` snapshot returned by `GET /api/graph/overview`. */
export interface GraphOverviewResponse {
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
}

/** One graph node paired with the edges incident to it. The adapter's row type. */
export interface GraphEntityRow {
  node: GraphNodePayload;
  /** edges where this node is an endpoint (deduped when read across rows by id). */
  incidentEdges: GraphEdgePayload[];
}

// ── Edge-type → hierarchy semantics ──────────────────────────────────────────

/** Edge types read as "start is a child of end" (start ⟶ parent=end). */
const CHILD_TO_PARENT = new Set([
  "DESCENDS_FROM",
  "DERIVED_FROM",
  "PART_OF",
  "BELONGS_TO",
  "MEMBER_OF",
  "SUBFAMILY_OF",
  "CONTAINED_IN",
  "CHILD_OF",
]);

/** Edge types read as "start is a parent of end" (parent=start ⟶ end). */
const PARENT_TO_CHILD = new Set([
  "PARENT_OF",
  "ANCESTOR_OF",
  "CONTAINS",
  "HAS_MEMBER",
]);

// ── Property readers (Neo4j props are loosely typed) ─────────────────────────

function propStr(
  props: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function propNum(
  props: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function displayName(node: GraphNodePayload): string {
  return node.name?.trim() ? node.name : node.csid;
}

function regionOf(node: GraphNodePayload): string | null {
  return propStr(node.properties, ["region", "origin_region", "location"]);
}

function startYearOf(node: GraphNodePayload): number | null {
  return propNum(node.properties, ["time_start", "start_year", "year_start"]);
}

function endYearOf(node: GraphNodePayload): number | null {
  return propNum(node.properties, ["time_end", "end_year", "year_end"]);
}

function coordsOf(node: GraphNodePayload): { lat: number; lng: number } | null {
  const lat = propNum(node.properties, ["lat", "latitude"]);
  const lng = propNum(node.properties, ["lon", "lng", "longitude"]);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

/** A coarse 500-year band label used as the "time period" facet. */
export function periodBand(year: number | null): string | null {
  if (year === null || !Number.isFinite(year)) return null;
  const band = 500;
  const lo = Math.floor(year / band) * band;
  const hi = lo + band;
  const fmt = (y: number) => (y < 0 ? `${-y} BCE` : `${y} CE`);
  return `${fmt(lo)}–${fmt(hi)}`;
}

// ── Row assembly ─────────────────────────────────────────────────────────────

/** Group edges by each endpoint csid so a node can carry its incident edges. */
function indexIncidentEdges(
  edges: GraphEdgePayload[],
): Map<string, GraphEdgePayload[]> {
  const byEndpoint = new Map<string, GraphEdgePayload[]>();
  const push = (csid: string, edge: GraphEdgePayload) => {
    const list = byEndpoint.get(csid);
    if (list) list.push(edge);
    else byEndpoint.set(csid, [edge]);
  };
  for (const edge of edges) {
    push(edge.startCsid, edge);
    if (edge.endCsid !== edge.startCsid) push(edge.endCsid, edge);
  }
  return byEndpoint;
}

function matchesQuery(row: GraphEntityRow, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  const n = row.node;
  return (
    displayName(n).toLowerCase().includes(ql) ||
    n.csid.toLowerCase().includes(ql) ||
    n.labels.some((l) => l.toLowerCase().includes(ql))
  );
}

function project(
  rows: GraphEntityRow[],
  opts: ProjectionOptions,
): DimensionProjections {
  const facets = opts.facetFilters ?? {};
  const filtered = rows.filter((row) => {
    if (facets.entityType && primaryLabel(row.node) !== facets.entityType) {
      return false;
    }
    if (
      facets.timePeriod &&
      periodBand(startYearOf(row.node)) !== facets.timePeriod
    ) {
      return false;
    }
    if (facets.region && regionOf(row.node) !== facets.region) return false;
    if (!matchesQuery(row, opts.searchQuery ?? "")) return false;
    return true;
  });

  const filteredIds = new Set(filtered.map((r) => r.node.csid));

  // Relational: nodes coloured by :LABEL, links from every incident edge whose
  // endpoints both survive filtering (deduped by edge id across rows).
  const relationalNodes: RelationalNode[] = filtered.map((row) => ({
    id: row.node.csid,
    label: displayName(row.node),
    group: primaryLabel(row.node),
    magnitude: row.incidentEdges.length,
    payload: row,
  }));

  const seenEdge = new Set<string>();
  const relationalLinks: RelationalLink[] = [];
  const parentByChild = new Map<string, string>();
  for (const row of filtered) {
    for (const edge of row.incidentEdges) {
      if (!filteredIds.has(edge.startCsid) || !filteredIds.has(edge.endCsid)) {
        continue;
      }
      if (!seenEdge.has(edge.id)) {
        seenEdge.add(edge.id);
        relationalLinks.push({
          source: edge.startCsid,
          target: edge.endCsid,
          kind: edge.type,
          weight: edge.weight,
          payload: edge,
        });
      }
      // Hierarchy: only the first parent found for a child wins (stable).
      const type = edge.type.toUpperCase();
      if (CHILD_TO_PARENT.has(type) && !parentByChild.has(edge.startCsid)) {
        parentByChild.set(edge.startCsid, edge.endCsid);
      } else if (PARENT_TO_CHILD.has(type) && !parentByChild.has(edge.endCsid)) {
        parentByChild.set(edge.endCsid, edge.startCsid);
      }
    }
  }

  // Hierarchical: containment/descent forest. Nodes with no parent edge are
  // roots at depth 0; depth is a cycle-safe memoised walk up the parent chain.
  const depthCache = new Map<string, number>();
  const computeDepth = (id: string, visiting: Set<string>): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    const parent = parentByChild.get(id);
    if (!parent || !filteredIds.has(parent)) {
      depthCache.set(id, 0);
      return 0;
    }
    visiting.add(id);
    const d = computeDepth(parent, visiting) + 1;
    visiting.delete(id);
    depthCache.set(id, d);
    return d;
  };

  const hierarchical: HierarchicalNode[] = filtered.map((row) => {
    const parent = parentByChild.get(row.node.csid);
    return {
      id: row.node.csid,
      label: displayName(row.node),
      parentId: parent && filteredIds.has(parent) ? parent : null,
      depth: computeDepth(row.node.csid, new Set()),
      payload: row,
    };
  });

  // Temporal: nodes with a parseable start year.
  const temporal = filtered.flatMap((row) => {
    const start = startYearOf(row.node);
    if (start === null) return [];
    return [
      {
        id: row.node.csid,
        label: displayName(row.node),
        startYear: start,
        endYear: endYearOf(row.node),
        group: primaryLabel(row.node),
        payload: row,
      },
    ];
  });

  // Spatial: nodes with coordinates.
  const spatial = filtered.flatMap((row) => {
    const coords = coordsOf(row.node);
    if (!coords) return [];
    return [
      {
        id: row.node.csid,
        label: displayName(row.node),
        lat: coords.lat,
        lng: coords.lng,
        region: regionOf(row.node) ?? undefined,
        startYear: startYearOf(row.node) ?? undefined,
        endYear: endYearOf(row.node),
        payload: row,
      },
    ];
  });

  const categorical = filtered.map((row) => ({
    id: row.node.csid,
    label: displayName(row.node),
    facets: {
      entityType: primaryLabel(row.node),
      timePeriod: periodBand(startYearOf(row.node)),
      region: regionOf(row.node),
      connections: row.incidentEdges.length,
    },
    payload: row,
  }));

  return {
    relational: { nodes: relationalNodes, links: relationalLinks },
    hierarchical,
    temporal,
    spatial,
    categorical,
  };
}

export const sharedGraphAdapter: DatasetAdapter<GraphEntityRow> = {
  id: "pinakes-graph",
  name: "Shared Culture Graph",
  category: "Shared Graph",
  endpoint: "/api/graph/overview",
  unwrap: (resp) => {
    const data = resp as Partial<GraphOverviewResponse> | null | undefined;
    const nodes = Array.isArray(data?.nodes) ? data!.nodes : [];
    const edges = Array.isArray(data?.edges) ? data!.edges : [];
    const byEndpoint = indexIncidentEdges(edges);
    return nodes.map((node) => ({
      node,
      incidentEdges: byEndpoint.get(node.csid) ?? [],
    }));
  },
  dimensions: ["relational", "temporal", "spatial", "hierarchical", "categorical"],
  filterableFacets: [
    { key: "entityType", label: "Entity Type" },
    { key: "timePeriod", label: "Time Period" },
    { key: "region", label: "Region" },
  ],
  project,
  detail: (row) => {
    const start = startYearOf(row.node);
    const end = endYearOf(row.node);
    return {
      title: displayName(row.node),
      subtitle: `${primaryLabel(row.node)} · ${row.node.csid}`,
      fields: [
        { label: "Entity types", value: row.node.labels },
        {
          label: "Period",
          value:
            start === null ? null : `${start} – ${end ?? "?"}`,
        },
        { label: "Region", value: regionOf(row.node) },
        { label: "Connections", value: row.incidentEdges.length },
      ],
      // Where this fact came from, so it can be trusted/cited (US-010).
      provenance: extractProvenance(row.node.properties),
    };
  },
};
