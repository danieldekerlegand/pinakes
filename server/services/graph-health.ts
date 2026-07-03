/**
 * Aggregated graph health service (US-005).
 *
 * A single place that reports the availability of both graph backends — the
 * Neo4j driver layer (graph-store.ts) and the FastAPI sidecar
 * (culturescrape-client.ts) — so the `/api/graph/status` route and any future
 * server consumer read one consistent, cheap verdict instead of probing each
 * backend independently.
 *
 * The verdict is pull-through cached for a short window (GRAPH_HEALTH_TTL_MS,
 * default 5s): a burst of `/status` requests issues at most one round of probes.
 * Each backend's own `isAvailable()` already caches + never throws, so this
 * layer only aggregates and memoises. Nothing here throws — an unreachable
 * backend simply reports `false`, which is the whole point of graceful
 * degradation.
 */
import * as graphStore from "./graph-store";
import * as culturescrape from "./culturescrape-client";

export interface GraphHealth {
  /** True when EITHER backend is reachable (the app can offer some graph feature). */
  available: boolean;
  /** Neo4j driver reachable (node/neighborhood queries). */
  neo4j: boolean;
  /** FastAPI sidecar reachable (search/metrics/datalog). */
  sidecar: boolean;
  /** Epoch ms of the probe that produced this verdict. */
  checkedAt: number;
}

const DEFAULT_TTL_MS = 5000;

function readTtl(): number {
  const raw = Number(process.env.GRAPH_HEALTH_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
}

let cache: GraphHealth | null = null;

/**
 * Report the current health of both graph backends. Returns the cached verdict
 * when it is younger than the TTL; otherwise re-probes both backends in
 * parallel. Pass `force` to bypass the cache (used by tests). Never throws.
 */
export async function getGraphHealth(force = false): Promise<GraphHealth> {
  const now = Date.now();
  if (!force && cache && now - cache.checkedAt < readTtl()) {
    return cache;
  }
  const [neo4j, sidecar] = await Promise.all([
    graphStore.isAvailable().catch(() => false),
    culturescrape.isAvailable().catch(() => false),
  ]);
  cache = { available: neo4j || sidecar, neo4j, sidecar, checkedAt: now };
  return cache;
}

/** Drop the cached verdict so the next `getGraphHealth()` re-probes. For tests. */
export function resetGraphHealthCache(): void {
  cache = null;
}
