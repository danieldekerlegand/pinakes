/**
 * Client-side progressive summary/detail loading (US-004, tasklist 13).
 *
 * Pairs with the server `/api/summaries/*` routes: fetch **lightweight** summary
 * rows first (fast list/card render), then hydrate a single entity's **full**
 * record on demand from its detail endpoint. This module holds the *pure* pieces
 * — query-key builders + a summary→detail merge — so they are unit-testable in
 * the node vitest env; the React hooks that consume them live in
 * `web/src/hooks/use-progressive-entity.ts`.
 *
 * Query keys follow the app convention (web/src/lib/queryClient.ts): string
 * parts join into the URL path, so `['/api/summaries', domain]` fetches
 * `/api/summaries/<domain>` and an object part becomes `?query=params`.
 */

/** A summary domain served by `/api/summaries/*` (mirror of the server contract). */
export type ProgressiveDomain =
  | "languages"
  | "religions"
  | "battles"
  | "culture-profiles"
  | "cuisines"
  | "trade-goods"
  | "innovations";

/** The `/api/summaries/:domain` list response body (mirror of `SummaryListResult`). */
export interface SummaryListResponse<TSummary> {
  domain: ProgressiveDomain;
  fields: string[];
  detailEndpoint: string;
  summaries: TSummary[];
  total: number;
  returned: number;
  offset: number;
  limit: number | null;
  hasMore: boolean;
}

/** Optional pagination for a summary list request. */
export interface SummaryQueryOptions {
  offset?: number;
  limit?: number;
}

/**
 * Build the React Query key (and thus URL) for a domain's summary list. Numeric
 * `offset`/`limit` become query params via the shared `getQueryFn`. Omitting them
 * yields `['/api/summaries', domain]` → the whole (server-bounded) list.
 */
export function summaryListKey(
  domain: ProgressiveDomain,
  opts: SummaryQueryOptions = {},
): (string | Record<string, number>)[] {
  const params: Record<string, number> = {};
  if (opts.offset !== undefined) params.offset = opts.offset;
  if (opts.limit !== undefined) params.limit = opts.limit;
  const key: (string | Record<string, number>)[] = ["/api/summaries", domain];
  if (Object.keys(params).length > 0) key.push(params);
  return key;
}

/**
 * Build the React Query key (and thus URL) for a single entity's full record.
 * Uses the entity's canonical detail endpoint `/api/<domain>/<id>` so it shares
 * the cache with any existing per-entity detail query.
 */
export function detailKey(domain: ProgressiveDomain, id: string): string[] {
  return [`/api/${domain}`, id];
}

/**
 * Merge a summary and its (possibly still-loading) detail into one record for
 * rendering. Detail fields win where present; while detail is `undefined` the
 * summary alone drives the collapsed view. Because the summary is a strict
 * subset of the detail, this is always lossless — no summary field is dropped.
 */
export function mergeSummaryDetail<TSummary extends object, TDetail extends object>(
  summary: TSummary,
  detail: TDetail | undefined | null,
): TSummary & Partial<TDetail> {
  if (!detail) return { ...summary };
  return { ...summary, ...detail };
}
