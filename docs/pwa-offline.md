# PWA & Offline Support (US-011)

pinakes ships as an installable, offline-capable Progressive Web App. The
implementation is dependency-free (no `vite-plugin-pwa`/Workbox): a hand-authored
service worker plus a web app manifest, with all routing/registration decisions
factored into pure, unit-tested TypeScript.

## Pieces

| Concern | File | Notes |
| --- | --- | --- |
| Web app manifest | `client/public/manifest.webmanifest` | name/icons/`display: standalone`; linked from `index.html` |
| App icons | `client/public/icon.svg`, `icon-maskable.svg` | SVG (`sizes: any`); one `purpose: maskable` for adaptive launchers |
| Service worker | `client/public/sw.js` | served verbatim (imports nothing); mirrors the strategy module |
| Cache strategy (source of truth) | `client/src/lib/pwa/cache-strategy.ts` | pure `route()` + cache names + `staleCacheNames()` |
| SW registration | `client/src/lib/pwa/register.ts` | production-only, feature-detected, error-swallowing |
| Connectivity | `client/src/lib/pwa/online-status.ts` + `hooks/use-online-status.tsx` | `navigator.onLine` + `online`/`offline` events |
| Offline indicator | `client/src/components/OfflineIndicator.tsx` | fixed status pill, mounted in `App.tsx` |

`client/public/*` is served at the site root in dev (Vite `publicDir`) and copied to
`dist/public/` by `vite build`, so the manifest, icons, and `sw.js` are available at
`/manifest.webmanifest`, `/icon.svg`, `/sw.js` in both dev and prod.

## Registration

`main.tsx` calls `registerServiceWorker({ isProduction: import.meta.env.PROD })`
after render. **The SW is only registered in production** — in dev it would cache
Vite's HMR/module requests and break hot reload. To manually clear a stuck SW, call
`unregisterServiceWorkers()`.

## Caching strategy

`route(request, { origin })` maps each request to one of four strategies:

| Request | Strategy | Cache |
| --- | --- | --- |
| non-GET / `text/event-stream` | network-only | — |
| same-origin `/api/*` (data) | network-first | `pinakes-data-*` |
| same-origin navigation (HTML) | network-first (falls back to precached `/`) | `pinakes-shell-*` |
| same-origin static asset (hashed JS/CSS/img) | cache-first | `pinakes-shell-*` |
| allow-listed cross-origin (fonts, basemap tiles) | stale-while-revalidate | `pinakes-runtime-*` |
| any other cross-origin | network-only | — |

- **Data is network-first**, so online users always get fresh data and offline users
  fall back to the last successful response. This is why heavy correlation/graph data
  (which change) are never served stale while online.
- **Hashed assets are cache-first** — their filenames are content-addressed at build
  time, so a cached copy is always correct for that filename.
- The `sw.js` mirror of `route()` is kept honest by `cache-strategy.test.ts`, which
  reads `sw.js` from disk and asserts it references `CACHE_VERSION` and every managed
  cache name.

## Cache invalidation

All cache names embed `CACHE_VERSION` (currently `v1`), defined in **both**
`cache-strategy.ts` and `sw.js` (keep them in sync — a test enforces it).

To invalidate every cache (e.g. after a schema/shell change that must not be served
from an old cache):

1. Bump `CACHE_VERSION` in `client/src/lib/pwa/cache-strategy.ts`.
2. Bump the matching `CACHE_VERSION` constant in `client/public/sw.js`.

On the next visit, the new SW's `install` precaches the shell into the new
`…-<version>` caches, and its `activate` handler calls `staleCacheNames()` to delete
every `pinakes-*` cache **not** in `MANAGED_CACHES` — i.e. all the old-version
caches. `skipWaiting()` + `clients.claim()` make the new SW take control immediately.

Because content-hashed asset filenames change per build, individual asset updates do
**not** require a version bump: a new build simply requests new filenames that get
cached fresh, and old ones age out with the next version bump.

## Offline indicator

`useOnlineStatus()` (via `useSyncExternalStore`) tracks `navigator.onLine` and the
`online`/`offline` window events. `<OfflineIndicator />` renders a fixed
"Offline — showing cached data" pill (`role="status"`) only while offline.

## Tests

- `cache-strategy.test.ts` — `route()` decisions, `staleCacheNames()`, and build
  checks that parse `manifest.webmanifest` (valid + icons exist on disk) and read
  `sw.js` (has lifecycle handlers + in-sync version/cache names).
- `register.test.ts` — production gating, feature detection, error swallowing.
- `online-status.test.ts` — connectivity read + event subscription/unsubscription.
