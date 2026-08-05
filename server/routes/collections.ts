/**
 * First-party `/api/collections/*` routes (US-007) — **ported away**
 * (pinakes:61 US-1, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * Collaborative collections are served by the Python service now
 * (`services/api/src/pinakes/routers/collections.py` over
 * `pinakes.collab.collections`), against the same `data/runtime/collections`
 * directory this file's `CollectionStore` wrote. Every handler here is retired:
 * they answer **501** naming the module that replaced them, so a caller still on
 * this origin is told where the route went rather than being served a second,
 * drifting copy of someone's curated set.
 *
 * The paths stay *registered* rather than being deleted, and that is deliberate
 * — the path set is what `contracts/parity/openapi.json` was harvested from, so
 * removing a registration would rewrite the very baseline the port is graded
 * against.
 *
 * `server/services/collections.ts` is **kept**: it is the specification the port
 * was read off, and its unit tests are the statement that the two agree on the
 * record shape. Nothing in `server/` calls it any more.
 */
import { type Express, type Request, type Response } from "express";

/** The Python module that now serves these routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/collections.py";

/**
 * The routes this backend handed over, by method.
 *
 * `/api/collections/shared/:token` keeps its place ahead of `/:id` even though
 * every handler is now the same stub. The ordering is part of the contract the
 * port reproduces (Starlette matches first-registered just as Express does), and
 * a reader comparing the two files should see the same shape on both sides.
 */
export const PORTED_ROUTES = {
  get: [
    "/api/collections",
    "/api/collections/shared/:token",
    "/api/collections/:id",
  ],
  post: ["/api/collections", "/api/collections/:id/items"],
  patch: ["/api/collections/:id"],
  delete: ["/api/collections/:id", "/api/collections/:id/items/:stableId"],
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

export function registerCollectionRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
  for (const route of PORTED_ROUTES.patch) {
    app.patch(route, portedToPython(`PATCH ${route}`));
  }
  for (const route of PORTED_ROUTES.delete) {
    app.delete(route, portedToPython(`DELETE ${route}`));
  }
}
