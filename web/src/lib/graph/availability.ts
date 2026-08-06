/**
 * Shared-graph availability model (US-005).
 *
 * Pure, framework-free logic that turns a `/api/graph/status` response into the
 * decisions the UI needs: is a given graph feature enabled, and — if not — what
 * explanatory message should the disabled/hidden affordance show. Kept out of the
 * React hook so it is unit-testable in the node test environment and reusable by
 * any consumer (hook, gate component, future graph views).
 */

/** Shape of the `/api/graph/status` response (see services/api/src/pinakes/routers/graph.py). */
export interface GraphStatus {
  /** True when EITHER backend is reachable. */
  available: boolean;
  /** Neo4j driver reachable → node/neighborhood queries work. */
  neo4j: boolean;
  /** FastAPI sidecar reachable → search/metrics/datalog work. */
  sidecar: boolean;
  /** Epoch ms of the probe that produced this verdict (optional on the client). */
  checkedAt?: number;
}

/**
 * Which backend a graph feature depends on:
 * - `neo4j`   — node/neighborhood graph views
 * - `sidecar` — search / metrics / datalog
 * - `any`     — feature works if either backend is up (default)
 */
export type GraphBackend = "neo4j" | "sidecar" | "any";

/** The conservative default before any status has loaded: everything is down. */
export const UNKNOWN_GRAPH_STATUS: GraphStatus = {
  available: false,
  neo4j: false,
  sidecar: false,
};

/**
 * Whether a feature depending on `backend` should be enabled given `status`.
 * A null/undefined status (not yet loaded, or the request failed) is treated as
 * unavailable so features fail closed rather than flashing enabled then breaking.
 */
export function isGraphFeatureEnabled(
  status: GraphStatus | null | undefined,
  backend: GraphBackend = "any",
): boolean {
  if (!status) return false;
  switch (backend) {
    case "neo4j":
      return status.neo4j;
    case "sidecar":
      return status.sidecar;
    case "any":
    default:
      return status.available;
  }
}

/**
 * Human-readable reason a graph feature is unavailable, suitable for a tooltip.
 * Returns `null` when the feature IS available (nothing to explain).
 */
export function graphUnavailableReason(
  status: GraphStatus | null | undefined,
  backend: GraphBackend = "any",
): string | null {
  if (isGraphFeatureEnabled(status, backend)) return null;
  switch (backend) {
    case "neo4j":
      return "Graph database is offline — connections view is unavailable.";
    case "sidecar":
      return "Graph service is offline — search and metrics are unavailable.";
    case "any":
    default:
      return "Shared graph is offline — this feature is unavailable.";
  }
}
