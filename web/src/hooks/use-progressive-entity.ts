/**
 * React Query hooks for progressive summary/detail loading (US-004, tasklist 13).
 *
 * `useEntitySummaries` fetches the lightweight `/api/summaries/:domain` list up
 * front (cheap, renders lists/cards fast). `useEntityDetail` hydrates a single
 * entity's full record from `/api/<domain>/:id` lazily — pass `enabled: false`
 * (e.g. a collapsed card) and it fetches nothing until the row is expanded.
 *
 * Both are thin wrappers over the shared `getQueryFn` (web/src/lib/queryClient.ts):
 * the query keys built in `web/src/lib/progressive-loading.ts` map straight to
 * the fetch URLs, so there is no per-call `queryFn` here.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { STALE_TIMES } from "@/lib/queryClient";
import {
  detailKey,
  summaryListKey,
  type ProgressiveDomain,
  type SummaryListResponse,
  type SummaryQueryOptions,
} from "@/lib/progressive-loading";

export interface UseEntitySummariesOptions extends SummaryQueryOptions {
  /** Gate the summary fetch (default true). */
  enabled?: boolean;
}

/**
 * Fetch a domain's lightweight summary list. Static reference data, so it inherits
 * the long `static` stale time. Returns the full `SummaryListResponse` envelope
 * (summaries + page metadata).
 */
export function useEntitySummaries<TSummary>(
  domain: ProgressiveDomain,
  { enabled = true, ...page }: UseEntitySummariesOptions = {},
): UseQueryResult<SummaryListResponse<TSummary>> {
  return useQuery<SummaryListResponse<TSummary>>({
    queryKey: summaryListKey(domain, page),
    enabled,
    staleTime: STALE_TIMES.static,
  });
}

export interface UseEntityDetailOptions {
  /** Gate the detail fetch — set false while the row is collapsed. */
  enabled?: boolean;
}

/**
 * Lazily hydrate one entity's full record from its detail endpoint. Fetches only
 * when both `id` is set and `enabled` is true, so a collapsed card costs nothing.
 */
export function useEntityDetail<TDetail>(
  domain: ProgressiveDomain,
  id: string | null | undefined,
  { enabled = true }: UseEntityDetailOptions = {},
): UseQueryResult<TDetail> {
  return useQuery<TDetail>({
    queryKey: detailKey(domain, id ?? ""),
    enabled: enabled && !!id,
    staleTime: STALE_TIMES.static,
  });
}
