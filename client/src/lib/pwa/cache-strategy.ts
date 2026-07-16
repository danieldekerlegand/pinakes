// PWA cache strategy (US-011) — the SINGLE source of truth for how the service
// worker routes requests. Pure + node-testable (no `self`/`caches`/DOM), so the
// routing decisions can be asserted in vitest. `client/public/sw.js` mirrors these
// rules at runtime and imports NOTHING (it is served verbatim), so keep the two in
// sync — the build-check test (cache-strategy.test.ts) reads sw.js and asserts it
// references CACHE_VERSION and every managed cache name below.

// Bump CACHE_VERSION to invalidate ALL caches: the SW `activate` handler deletes
// every `pinakes-*` cache not in MANAGED_CACHES (see staleCacheNames), so a
// version bump forces a clean re-precache of the app shell. See docs/pwa-offline.md.
export const CACHE_VERSION = "v1";

export const APP_SHELL_CACHE = `pinakes-shell-${CACHE_VERSION}`;
export const DATA_CACHE = `pinakes-data-${CACHE_VERSION}`;
export const RUNTIME_CACHE = `pinakes-runtime-${CACHE_VERSION}`;

/** Caches this SW version owns; anything else `pinakes-*` is stale. */
export const MANAGED_CACHES = [APP_SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE] as const;

/**
 * App-shell URLs precached on `install` so the app boots offline. Hashed JS/CSS
 * assets are cached at runtime (cache-first) since their names are build-time only.
 */
export const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
] as const;

/**
 * Cross-origin hosts whose GETs we cache opportunistically (fonts + basemap tiles)
 * so a previously-viewed map/typography survives offline. Matched by hostname suffix.
 */
export const CACHEABLE_CROSS_ORIGIN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "tile.openstreetmap.org",
  "basemaps.cartocdn.com",
  "tiles.stadiamaps.com",
] as const;

export type CacheStrategy =
  | "cache-first"
  | "network-first"
  | "stale-while-revalidate"
  | "network-only";

export interface RequestLike {
  url: string;
  method?: string;
  /** Fetch request mode; "navigate" marks a top-level page load. */
  mode?: string;
  /** Subset of request headers we care about (e.g. accept). */
  headers?: { accept?: string | null } | null;
}

export interface RouteContext {
  /** Origin the SW is serving (e.g. "https://example.com"). */
  origin: string;
}

export interface RoutePlan {
  strategy: CacheStrategy;
  /** Cache to read/write, or null for network-only. */
  cache: string | null;
}

const NETWORK_ONLY: RoutePlan = { strategy: "network-only", cache: null };

function accept(req: RequestLike): string {
  return req.headers?.accept ?? "";
}

function isNavigation(req: RequestLike): boolean {
  return req.mode === "navigate" || accept(req).includes("text/html");
}

/** Server-Sent-Events / streaming responses must never be cached or intercepted. */
function isStreaming(req: RequestLike): boolean {
  return accept(req).includes("text/event-stream");
}

function isCacheableCrossOrigin(hostname: string): boolean {
  return CACHEABLE_CROSS_ORIGIN_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

/**
 * Decide how to serve a request. Pure — pass the SW origin explicitly.
 *
 * - non-GET / SSE                     → network-only (never cached)
 * - same-origin `/api/*` (data)       → network-first (fresh online, cached offline)
 * - same-origin navigation (HTML)     → network-first, fall back to precached shell
 * - same-origin static asset          → cache-first (hashed/immutable at runtime)
 * - allow-listed cross-origin GET     → stale-while-revalidate (fonts + tiles)
 * - anything else cross-origin        → network-only
 */
export function route(req: RequestLike, ctx: RouteContext): RoutePlan {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" || isStreaming(req)) return NETWORK_ONLY;

  let url: URL;
  try {
    url = new URL(req.url, ctx.origin);
  } catch {
    return NETWORK_ONLY;
  }

  const sameOrigin = url.origin === ctx.origin;

  if (sameOrigin) {
    if (url.pathname.startsWith("/api/")) {
      return { strategy: "network-first", cache: DATA_CACHE };
    }
    if (isNavigation(req)) {
      return { strategy: "network-first", cache: APP_SHELL_CACHE };
    }
    return { strategy: "cache-first", cache: APP_SHELL_CACHE };
  }

  if (isCacheableCrossOrigin(url.hostname)) {
    return { strategy: "stale-while-revalidate", cache: RUNTIME_CACHE };
  }

  return NETWORK_ONLY;
}

/**
 * Given the cache names currently present, return the `pinakes-*` caches that
 * are no longer owned by this SW version (deleted on `activate` for invalidation).
 */
export function staleCacheNames(existing: readonly string[]): string[] {
  const managed = new Set<string>(MANAGED_CACHES);
  return existing.filter(
    (name) => name.startsWith("pinakes-") && !managed.has(name),
  );
}
