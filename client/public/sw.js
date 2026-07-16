/*
 * pinakes service worker (US-011).
 *
 * Served verbatim from client/public (it imports nothing). Its routing rules MIRROR
 * client/src/lib/pwa/cache-strategy.ts — that module is the tested source of truth,
 * and cache-strategy.test.ts reads this file to assert the CACHE_VERSION and cache
 * names below stay in sync. Bump CACHE_VERSION there AND here to invalidate caches.
 *
 * Cache-invalidation strategy (see docs/pwa-offline.md):
 *   - `install` precaches the app shell, then skipWaiting().
 *   - `activate` deletes every `pinakes-*` cache not owned by this version and
 *     claims open clients, so a CACHE_VERSION bump wipes stale assets on next load.
 *   - Data (`/api/*`) is network-first, so online users always get fresh data and
 *     offline users fall back to the last successful response.
 */

const CACHE_VERSION = "v1";
const APP_SHELL_CACHE = `pinakes-shell-${CACHE_VERSION}`;
const DATA_CACHE = `pinakes-data-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pinakes-runtime-${CACHE_VERSION}`;
const MANAGED_CACHES = [APP_SHELL_CACHE, DATA_CACHE, RUNTIME_CACHE];

const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
];

const CACHEABLE_CROSS_ORIGIN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "tile.openstreetmap.org",
  "basemaps.cartocdn.com",
  "tiles.stadiamaps.com",
];

function isCacheableCrossOrigin(hostname) {
  return CACHEABLE_CROSS_ORIGIN_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

// Mirror of route() in cache-strategy.ts.
function route(request) {
  if (request.method !== "GET") return { strategy: "network-only", cache: null };

  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/event-stream")) {
    return { strategy: "network-only", cache: null };
  }

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    if (url.pathname.startsWith("/api/")) {
      return { strategy: "network-first", cache: DATA_CACHE };
    }
    if (request.mode === "navigate" || accept.includes("text/html")) {
      return { strategy: "network-first", cache: APP_SHELL_CACHE };
    }
    return { strategy: "cache-first", cache: APP_SHELL_CACHE };
  }

  if (isCacheableCrossOrigin(url.hostname)) {
    return { strategy: "stale-while-revalidate", cache: RUNTIME_CACHE };
  }

  return { strategy: "network-only", cache: null };
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("pinakes-") && !MANAGED_CACHES.includes(name),
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Offline navigation fallback: serve the cached app shell.
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const plan = route(event.request);
  if (plan.strategy === "network-only" || !plan.cache) return;

  if (plan.strategy === "cache-first") {
    event.respondWith(cacheFirst(event.request, plan.cache));
  } else if (plan.strategy === "network-first") {
    event.respondWith(networkFirst(event.request, plan.cache));
  } else if (plan.strategy === "stale-while-revalidate") {
    event.respondWith(staleWhileRevalidate(event.request, plan.cache));
  }
});
