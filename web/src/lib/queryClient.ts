import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL from queryKey: string parts form the path, object parts become query params
    const pathParts: string[] = [];
    const params = new URLSearchParams();
    for (const part of queryKey) {
      if (typeof part === 'string') {
        pathParts.push(part);
      } else if (part && typeof part === 'object') {
        for (const [key, value] of Object.entries(part as Record<string, unknown>)) {
          if (value !== undefined && value !== null) {
            params.set(key, String(value));
          }
        }
      }
    }
    const url = pathParts.join("/") + (params.toString() ? `?${params.toString()}` : '');

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Stale time configuration by data domain
// Static reference data (languages, families) rarely changes - long stale time
// Dynamic/derived data (search, comparisons) should be fresher
export const STALE_TIMES = {
  static: 1000 * 60 * 30,     // 30 minutes for languages, families, base words
  derived: 1000 * 60 * 10,    // 10 minutes for comparisons, computed data
  search: 1000 * 60 * 5,      // 5 minutes for search results
  realtime: 1000 * 60 * 2,    // 2 minutes for scraping jobs, stats
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: STALE_TIMES.static,
      gcTime: 1000 * 60 * 60,  // Keep unused data in cache for 1 hour
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
