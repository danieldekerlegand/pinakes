import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { useGraphAvailability } from "@/hooks/use-graph-availability";
import {
  relatedFromNeighborhood,
  type RelatedEntitySuggestion,
} from "@/lib/graph/related-entities";
import type { NeighborhoodPayload } from "@/lib/graph/neighborhood-graph";
import type { GraphEntityRef } from "@/components/graph/ShowInGraphButton";

/**
 * Shared hook powering the generalised "related entities" affordance (US-006).
 *
 * Given any Pinakes entity ref (language, culture/civilization, battle,
 * religion, …) it:
 *   1. resolves the ref to its shared-graph csid via `/api/graph/resolve`
 *      (the alias table — works even while Neo4j itself is offline), then
 *   2. fetches the 1-hop neighborhood via `/api/graph/neighborhood/:csid`, and
 *   3. projects the edges around the focus into ranked, provenance-carrying
 *      {@link RelatedEntitySuggestion}s via the pure `relatedFromNeighborhood`.
 *
 * It degrades gracefully: it only fires when the Neo4j backend is available
 * (`isUnavailable` otherwise), never retries a down graph, and returns an empty
 * list rather than throwing when the entity isn't reconciled or has no relations.
 */
interface ResolvedCsid {
  csid: string;
  confidence: number;
  method: "alias" | "fuzzy";
}

interface ResolveResponse {
  resolved: ResolvedCsid | null;
}

export interface UseRelatedEntitiesOptions {
  /** Cap the number of suggestions returned. */
  limit?: number;
  /** Neighborhood traversal depth (1..3). Defaults to 1 (direct relations). */
  depth?: number;
  /** Master switch — skip all fetching when false. Defaults to true. */
  enabled?: boolean;
}

export interface UseRelatedEntitiesResult {
  /** The ranked related entities (empty until resolved + fetched). */
  related: RelatedEntitySuggestion[];
  /** The resolved shared-graph node, or null when unresolved. */
  resolved: ResolvedCsid | null;
  /** True while resolution or the neighborhood fetch is in flight. */
  isLoading: boolean;
  /** True when the graph errored (kept separate from "no relations"). */
  isError: boolean;
  /** True when the Neo4j backend is offline, so nothing was fetched. */
  isUnavailable: boolean;
}

export function useRelatedEntities(
  entity: GraphEntityRef,
  options: UseRelatedEntitiesOptions = {},
): UseRelatedEntitiesResult {
  const { limit, depth = 1, enabled = true } = options;
  const graph = useGraphAvailability();

  // Resolution rides the alias table (no Neo4j), but the neighborhood needs the
  // graph store — gate the whole flow on the Neo4j backend so we don't render a
  // half-loaded panel while the graph is down.
  const active = enabled && graph.isEnabled("neo4j");

  const resolveQuery = useQuery<ResolveResponse>({
    queryKey: ["/api/graph/resolve", entity],
    enabled: active,
    staleTime: STALE_TIMES.static,
    retry: false,
    throwOnError: false,
  });

  const resolved = resolveQuery.data?.resolved ?? null;
  const csid = resolved?.csid ?? null;

  const neighborhoodQuery = useQuery<NeighborhoodPayload>({
    queryKey: [`/api/graph/neighborhood/${csid ?? ""}`, { depth }],
    enabled: active && !!csid,
    staleTime: STALE_TIMES.static,
    retry: false,
    throwOnError: false,
  });

  const related = useMemo(
    () => relatedFromNeighborhood(neighborhoodQuery.data, { limit }),
    [neighborhoodQuery.data, limit],
  );

  return {
    related,
    resolved,
    isLoading:
      active &&
      (resolveQuery.isLoading ||
        (!!csid && neighborhoodQuery.isLoading)),
    isError: resolveQuery.isError || neighborhoodQuery.isError,
    isUnavailable: !graph.isEnabled("neo4j"),
  };
}
