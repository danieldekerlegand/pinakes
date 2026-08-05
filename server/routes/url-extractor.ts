/**
 * URL-paste extractor route — **ported away** (pinakes:64 US-1,
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * `POST /api/extract/url` is served by the Python service now
 * (`services/api/src/pinakes/routers/extract.py` over `pinakes.ingest.url_extractor`),
 * against the same contribution queue. The handler here answers **501**.
 *
 * The single-entity resolution strategy is unchanged — Wikidata's
 * `Special:EntityData/<QID>.json`, never a TS or Python SPARQL client, with the
 * same statement → field vocabulary as pinakes-engine's hydration profile. What
 * changed is the transport: the two REST calls go through the engine's polite
 * `HttpClient`, so a pasted URL is now rate-limited per host, retried on 429/5xx,
 * identified by a real User-Agent, and **cached** — the same article resolved
 * twice no longer costs Wikidata two requests.
 *
 * **`server/services/url-extractor.ts` is NOT retired.** It is the graded spec,
 * and `services/api/tests/test_url_extractor.py` is graded against the *same*
 * recorded fixtures (`server/services/fixtures/url-extractor/`).
 *
 * The path stays registered — the parity baseline was harvested from that path
 * set (see `routes/text-extractor.ts` for the longer version of this note).
 */

import { type Express, type Request, type Response } from "express";

/** The Python module that now serves this route. */
export const PORTED_TO = "services/api/src/pinakes/routers/extract.py";

/** The route this backend handed over. */
export const PORTED_ROUTES = {
  post: ["/api/extract/url"],
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

export function registerUrlExtractorRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
}
