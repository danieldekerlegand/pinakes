/**
 * Open Context / tDAR archaeological acquisition routes — **ported away**
 * (pinakes:64 US-2, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * `GET /api/scraping/archaeology/sources` and `POST /api/scraping/archaeology`
 * are served by the Python service now
 * (`services/api/src/pinakes/routers/archaeology.py` over
 * `pinakes.ingest.archaeology`). The handlers here answer **501**.
 *
 * **`server/services/archaeological-site-scraper.ts` is gone** — pinakes:70 US-1
 * deleted it along with the other twenty-six scraper/enrichment modules
 * (`engine/src/pinakes_engine/acquire/migration.py` is the retirement table).
 * When this file was written it was still the graded spec, because only its
 * Open Context / tDAR half had been ported; the grading now rests on
 * `services/api/tests/test_archaeology.py` alone, which still reads the same
 * `services/fixtures/archaeological/*.json` recordings the TypeScript suite did.
 * The Pleiades/UNESCO half that no route reached is the engine's
 * `PleiadesDumpAdapter` plus the `archaeological-sites` category.
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
