/**
 * Endangered-language dashboard + field-research routes (US-010) — **ported to
 * Python** (pinakes:80 US-1, the cutover's eleventh slice).
 *
 * `GET /api/languages/preservation` and `POST /api/languages/field-update` are
 * served by `services/api/src/pinakes/routers/preservation.py` over
 * `pinakes.lexicons.preservation`, against the same corpus, the same
 * contribution queue and the same changelog tree. Both handlers here answer
 * **501** naming their replacement.
 *
 * Neither route carries a recorded parity fixture, so this group handed over
 * cleanly — there is nothing left driving it on this origin.
 *
 * `services/language-preservation.ts` is **not** retired: it is the graded
 * spec, and `services/language-preservation.test.ts` is what says the two
 * implementations agree on the alias table, the watchlist ordering and the
 * shape of the queued contribution.
 *
 * **This was the last `ChangelogStore` *write* on this backend.** The shared
 * store in `registerRoutes` is still built, because `dataset-releases` and
 * `living-dataset` derive their next semver from `changelog.stats()` — so the
 * options bag is kept, and its `changelog` field is now ignored rather than
 * removed, to leave that call site untouched.
 */

import type { Express, Request, Response } from "express";

import type { ContributionService } from "../services/contribution-service";
import type { ChangelogStore } from "../services/changelog";
import type { PreservationLanguage } from "../services/language-preservation";

export type PreservationLanguageLoader = () => Promise<PreservationLanguage[]>;

/** The Python module that owns these routes now. */
export const PORTED_TO = "services/api/src/pinakes/routers/preservation.py";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** The routes this file no longer serves. */
export const PORTED_ROUTES = {
  dashboard: "/api/languages/preservation",
  fieldUpdate: "/api/languages/field-update",
} as const;

export interface PreservationRouteOptions {
  /** Ignored — kept so `registerRoutes`' call site is unchanged. */
  loadLanguages?: PreservationLanguageLoader;
  /** Ignored — the Python service owns the queue write now. */
  contributions?: ContributionService;
  /** Ignored — the Python service owns the changelog write now. */
  changelog?: ChangelogStore;
}

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process.
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

export function registerLanguagePreservationRoutes(
  app: Express,
  _options: PreservationRouteOptions = {},
): void {
  app.get(
    PORTED_ROUTES.dashboard,
    portedToPython(`GET ${PORTED_ROUTES.dashboard}`),
  );
  app.post(
    PORTED_ROUTES.fieldUpdate,
    portedToPython(`POST ${PORTED_ROUTES.fieldUpdate}`),
  );
}
