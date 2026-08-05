/**
 * Server-side translation proxy route — **ported away** (pinakes:64 US-1,
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * `POST /api/translate` is served by the Python service now
 * (`services/api/src/pinakes/routers/translate.py` over `pinakes.ingest.translate`).
 * The handler here answers **501**.
 *
 * **The security posture is unchanged and is the whole point of the route**
 * (US-002, docs/SECURITY.md): `GOOGLE_TRANSLATE_API_KEY` is read server-side and
 * the upstream call is made server-side, so the browser never holds the key.
 * That is now true of the *Python* server; `server/security/translate-proxy.test.ts`
 * still guards the invariant that no `web/` source names the key, and it does not
 * care which backend answers. The three status codes the client depends on are
 * reproduced exactly — 400 bad body, **503 when no key is configured** (which is
 * what makes translation an optional enhancement `web/src/lib/scraping.ts` falls
 * through), 502 upstream failure.
 *
 * **`server/services/translate.ts` is NOT retired.** It is the graded spec for
 * the port; `services/api/tests/test_translate.py` is its suite, case for case.
 *
 * The path stays registered — the parity baseline was harvested from that path
 * set (see `routes/text-extractor.ts`).
 */

import { type Express, type Request, type Response } from "express";

/** The Python module that now serves this route. */
export const PORTED_TO = "services/api/src/pinakes/routers/translate.py";

/** The route this backend handed over. */
export const PORTED_ROUTES = {
  post: ["/api/translate"],
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

export function registerTranslateRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
}
