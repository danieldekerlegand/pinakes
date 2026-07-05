/**
 * Client-side facet helpers for the global search dialog (US-005).
 *
 * These are the **pure** pieces of faceted search — toggling an active-filter
 * list and building the `/api/search` URL with facet params — so they can be
 * unit-tested (client tests run in a `node` env with no DOM; component `.tsx`
 * changes stay typecheck-only). The server computes the facet *counts* and
 * applies the filtering; see `server/services/global-search.ts`.
 */

/** One facet bucket returned by the server: a value and its unfiltered count. */
export interface FacetCount {
  value: string;
  count: number;
}

/** Facet breakdowns returned on a {@link SearchResponse}. */
export interface SearchFacets {
  entityType: FacetCount[];
  source: FacetCount[];
}

/** The facet filters a user has toggled on. */
export interface SearchFilters {
  entityTypes?: string[];
  sources?: string[];
}

/**
 * Toggle `value` in an active-filter list: add it if absent, remove it if
 * present. Returns a new array (never mutates), so it is safe as a React state
 * updater.
 */
export function toggleFacetValue(active: string[], value: string): string[] {
  return active.includes(value)
    ? active.filter((v) => v !== value)
    : [...active, value];
}

/**
 * Build the `/api/search` request URL for a query plus any active facet filters.
 * `types`/`sources` are comma-separated; the server parses them with
 * `parseSearchFilters`. Omits a dimension entirely when it is empty.
 */
export function buildSearchUrl(query: string, filters: SearchFilters = {}): string {
  const params = new URLSearchParams({ q: query });
  if (filters.entityTypes?.length) params.set("types", filters.entityTypes.join(","));
  if (filters.sources?.length) params.set("sources", filters.sources.join(","));
  return `/api/search?${params.toString()}`;
}
