/**
 * Pure transforms from the server's neighborhood payload
 * (`GET /api/graph/neighborhood/:id`) into the shape the generic
 * {@link NetworkGraph} renderer consumes (US-007).
 *
 * The shapes mirror `services/api/src/pinakes/engine/graph.py` (`GraphNode`/`GraphEdge`/
 * `Neighborhood`) so the client stays a thin projection: nodes are coloured and
 * typed by their first `:LABEL`, edges are labelled by their `:TYPE`.
 *
 * Everything here is intentionally pure and DOM-free so it can be unit-tested
 * under vitest's node environment (the repo has no jsdom/testing-library),
 * following the existing transform-test convention (see
 * `musical-tradition-explorer.test.ts`).
 */
import type {
  NetworkGraphNode,
  NetworkGraphEdge,
} from "@/components/visualizations/shared/NetworkGraph";

// ── Server payload shapes (mirror services/api/src/pinakes/engine/graph.py) ────────────

/** A node as returned by the graph API. */
export interface GraphNodePayload {
  csid: string;
  labels: string[];
  name: string;
  properties: Record<string, unknown>;
}

/** A relationship as returned by the graph API. */
export interface GraphEdgePayload {
  id: string;
  type: string;
  startCsid: string;
  endCsid: string;
  weight?: number;
  properties: Record<string, unknown>;
}

/** The neighborhood sub-graph returned by `GET /api/graph/neighborhood/:id`. */
export interface NeighborhoodPayload {
  root: GraphNodePayload;
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
  depth: number;
}

// ── Label → colour ───────────────────────────────────────────────────────────

/** Stable qualitative palette; nodes are grouped/coloured by their first label. */
const LABEL_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
] as const;

const UNLABELLED = "Node";

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/**
 * The umbrella `:LABEL` the canonical export puts on EVERY node, alongside the
 * node's specific one (`docs/canonical-schema.md`; `pinakes_engine neo4j-counts`
 * reports `Entity: 6849` against a total of 6,849). It types nothing on its own.
 */
const UMBRELLA_LABEL = "Entity";

/**
 * The `:LABEL` used to type/colour a node — its most SPECIFIC label, or a
 * fallback.
 *
 * Not simply `labels[0]`: Neo4j does not guarantee an order for a node's labels,
 * so against the populated graph the umbrella `:Entity` comes back first often
 * enough that the legend collapsed to a single "Entity" entry and every node in
 * the neighborhood drew the same colour — nondeterministically, run to run. (It
 * never showed up against the fixtures, which list the specific label first.)
 * Skipping the umbrella makes the typing stable and meaningful; a node labelled
 * ONLY `:Entity` still reports it rather than falling through to `UNLABELLED`.
 *
 * Browser-verified by e2e/graph-ui.spec.ts's populated-graph legend assertion
 * (pinakes:100 US-2).
 */
export function primaryLabel(node: GraphNodePayload): string {
  const labels = node.labels ?? [];
  if (labels.length === 0) return UNLABELLED;
  return labels.find((label) => label !== UMBRELLA_LABEL) ?? labels[0];
}

/** Deterministic colour for a label, so the graph and its legend agree. */
export function labelColor(label: string): string {
  return LABEL_COLORS[hashString(label) % LABEL_COLORS.length];
}

// ── Projections into the NetworkGraph renderer ───────────────────────────────

/** A node's display name, falling back to its csid when it has none. */
function nodeDisplayName(node: GraphNodePayload): string {
  return node.name?.trim() ? node.name : node.csid;
}

/**
 * Project neighborhood nodes into NetworkGraph nodes. `group` is the primary
 * label so the renderer colours by `:LABEL`; the raw labels + properties ride
 * along in `metadata` for tooltips/detail.
 */
export function toNetworkNodes(
  neighborhood: NeighborhoodPayload,
): NetworkGraphNode[] {
  return neighborhood.nodes.map((node) => ({
    id: node.csid,
    label: nodeDisplayName(node),
    name: nodeDisplayName(node),
    group: primaryLabel(node),
    category: primaryLabel(node),
    metadata: { labels: node.labels, ...node.properties },
  }));
}

/**
 * Project neighborhood edges into NetworkGraph edges, labelled by `:TYPE`.
 * Edges whose endpoints are not both present in the node set are dropped so the
 * force simulation never references a missing node.
 */
export function toNetworkEdges(
  neighborhood: NeighborhoodPayload,
): NetworkGraphEdge[] {
  const present = new Set(neighborhood.nodes.map((n) => n.csid));
  return neighborhood.edges
    .filter((e) => present.has(e.startCsid) && present.has(e.endCsid))
    .map((edge) => ({
      source: edge.startCsid,
      target: edge.endCsid,
      type: edge.type,
      weight: edge.weight,
      metadata: edge.properties,
    }));
}

/** Both projections together — the input the NetworkGraph component needs. */
export function toNetworkGraph(neighborhood: NeighborhoodPayload): {
  nodes: NetworkGraphNode[];
  edges: NetworkGraphEdge[];
} {
  return {
    nodes: toNetworkNodes(neighborhood),
    edges: toNetworkEdges(neighborhood),
  };
}

/** Distinct labels present in the neighborhood, each with its legend colour. */
export function labelLegend(
  neighborhood: NeighborhoodPayload,
): { label: string; color: string }[] {
  const seen = new Set<string>();
  const legend: { label: string; color: string }[] = [];
  for (const node of neighborhood.nodes) {
    const label = primaryLabel(node);
    if (!seen.has(label)) {
      seen.add(label);
      legend.push({ label, color: labelColor(label) });
    }
  }
  return legend.sort((a, b) => a.label.localeCompare(b.label));
}

/** True when the neighborhood has no relationships to visualise beyond the root. */
export function isEmptyNeighborhood(
  neighborhood: NeighborhoodPayload | undefined | null,
): boolean {
  if (!neighborhood) return true;
  return neighborhood.nodes.length <= 1 && neighborhood.edges.length === 0;
}

// ── View-state selection ─────────────────────────────────────────────────────

/**
 * Which body {@link GraphNeighborhoodView} renders, in priority order:
 * `"loading"` while the query is in flight, `"unavailable"` when the graph is
 * down (the query errored, e.g. a 503 from Neo4j being offline), `"empty"` when
 * the node exists but has no neighbours to draw, and `"ready"` once there is a
 * graph to render. Kept pure + DOM-free so the state machine is unit-testable
 * from a mocked neighborhood without a jsdom render.
 */
export type NeighborhoodViewState = "loading" | "unavailable" | "empty" | "ready";

/** The async flags {@link neighborhoodViewState} decides from (react-query's). */
export interface NeighborhoodQueryState {
  isLoading: boolean;
  isError: boolean;
  data: NeighborhoodPayload | undefined | null;
}

/**
 * Decide the neighborhood view state from the query flags + payload. Loading
 * wins over everything (we have no data yet), then an error means the graph is
 * unavailable, then a lone/absent root is empty, else it is ready to draw.
 */
export function neighborhoodViewState(
  query: NeighborhoodQueryState,
): NeighborhoodViewState {
  if (query.isLoading) return "loading";
  if (query.isError) return "unavailable";
  if (isEmptyNeighborhood(query.data)) return "empty";
  return "ready";
}
