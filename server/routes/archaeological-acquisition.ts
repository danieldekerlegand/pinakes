/**
 * Open Context / tDAR archaeological acquisition routes — **ported away**
 * (pinakes:64 US-2, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * `GET /api/scraping/archaeology/sources` and `POST /api/scraping/archaeology`
 * are served by the Python service now
 * (`services/api/src/pinakes/routers/archaeology.py` over
 * `pinakes.ingest.archaeology`). The handlers here answer **501**.
 *
 * **`server/services/archaeological-site-scraper.ts` is NOT retired**, and only
 * part of it was ported at all. Its Pleiades/UNESCO half belongs to the
 * `ArchaeologicalSiteScraper` class, which no route reaches; what came across is
 * the Open Context / tDAR half below the banner comment in that file, and it is
 * still the graded spec — `services/api/tests/test_archaeology.py` reads the
 * **same** `services/fixtures/archaeological/*.json` recordings, case for case
 * with `archaeological-site-scraper.test.ts`.
 *
 * **One thing did not come across, because its ledger has not yet.** The 202
 * carries a `jobId`, and `jobStore` is per-process — so a job started on the
 * Python service is not visible to `GET /api/scraping-jobs`, which is still
 * Express's (a different port unit). The acquisition itself is unaffected: it
 * writes to `data/runtime/contributions`, which both servers share on disk.
 *
 * The paths stay registered — the parity baseline was harvested from that path
 * set (see `routes/text-extractor.ts`).
 */

import { type Express, type Request, type Response } from "express";

/** The Python module that now serves these routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/archaeology.py";

/** The routes this backend handed over. */
export const PORTED_ROUTES = {
  get: ["/api/scraping/archaeology/sources"],
  post: ["/api/scraping/archaeology"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** A handler for a route this backend no longer owns. 501, not 404 or 503. */
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

export function registerArchaeologyAcquisitionRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
}
