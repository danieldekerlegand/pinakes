import { useQuery } from "@tanstack/react-query";
import {
  isGraphFeatureEnabled,
  graphUnavailableReason,
  UNKNOWN_GRAPH_STATUS,
  type GraphStatus,
  type GraphBackend,
} from "@/lib/graph/availability";
import { STALE_TIMES } from "@/lib/queryClient";

/**
 * Polls `/api/graph/status` and exposes shared-graph availability to components
 * (US-005). The `/status` route always answers 200 and never depends on the
 * graph itself, so a healthy server returns a verdict even when both backends
 * are down; if the whole server is unreachable the query fails and we fall back
 * to "everything down" (fail closed) rather than throwing.
 *
 * `retry: false` keeps a down graph from spamming retries/console errors, and a
 * modest `refetchInterval` lets the UI recover automatically when the graph
 * comes back without a page reload.
 */
const STATUS_POLL_MS = 30_000;

export interface GraphAvailability extends GraphStatus {
  /** True while the very first status probe is in flight. */
  isLoading: boolean;
  /** Convenience: is a feature on `backend` enabled right now? */
  isEnabled: (backend?: GraphBackend) => boolean;
  /** Convenience: tooltip reason a feature is unavailable, or null if enabled. */
  unavailableReason: (backend?: GraphBackend) => string | null;
}

export function useGraphAvailability(): GraphAvailability {
  const { data, isLoading } = useQuery<GraphStatus>({
    queryKey: ["/api/graph/status"],
    refetchInterval: STATUS_POLL_MS,
    staleTime: STALE_TIMES.realtime,
    retry: false,
    // A network failure to the origin means we can't know the graph is up →
    // fail closed instead of surfacing an error to graph-dependent UI.
    throwOnError: false,
  });

  const status = data ?? UNKNOWN_GRAPH_STATUS;

  return {
    ...status,
    isLoading,
    isEnabled: (backend: GraphBackend = "any") =>
      isGraphFeatureEnabled(status, backend),
    unavailableReason: (backend: GraphBackend = "any") =>
      graphUnavailableReason(status, backend),
  };
}
