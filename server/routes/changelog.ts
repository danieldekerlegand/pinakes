/**
 * Data changelog routes (/api/changelog, US-010) — **ported away**
 * (pinakes:61 US-2, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * The browsable audit log is served by the Python service now
 * (`services/api/src/pinakes/routers/changelog.py` over
 * `pinakes.contributions.changelog`), against the same `data/runtime/changelog`
 * directory this backend's `ChangelogStore` writes. Both handlers here are
 * retired: they answer **501** naming the module that replaced them.
 *
 * **`server/services/changelog.ts` is emphatically NOT retired.** The write side
 * of this store is still live on this backend — `registerLanguagePreservationRoutes`
 * records a field update, and `dataset-releases` / `living-dataset` derive the
 * next semver from `changelog.stats()`. The single shared `ChangelogStore`
 * instance in `registerRoutes` therefore keeps being created and passed around;
 * what stopped is only this file's *reading* of it, which is why
 * `registerChangelogRoutes` no longer takes a store.
 *
 * The paths stay *registered* rather than being deleted, and that is deliberate
 * — the path set is what `contracts/parity/openapi.json` was harvested from, so
 * removing a registration would rewrite the very baseline the port is graded
 * against.
 */

import type { Express, Request, Response } from "express";

/** The Python module that now serves these routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/changelog.py";

/** The routes this backend handed over, by method. Both are reads. */
export const PORTED_ROUTES = {
  get: ["/api/changelog", "/api/changelog/stats"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process. A 404 would say "gone", and a 503 would
 * invite a retry that can never succeed.
 */
function portedToPython(route: string) {
  return (_req: Request, res: Response): void => {
    res.status(501).json({
      error: PORTED_ERROR,
      message:
        `${route} has been ported to the Python service and is served there ` +
        `(${PORTED_TO}). The Express handler is retired.`,
      route,
      servedBy: PORTED_TO,
      coverage: "/api/_parity/coverage",
    });
  };
}

export function registerChangelogRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
}
