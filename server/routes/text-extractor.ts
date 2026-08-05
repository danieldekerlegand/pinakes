/**
 * LLM text-extraction route — **ported away** (pinakes:64 US-1,
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * `POST /api/extract/text` is served by the Python service now
 * (`services/api/src/pinakes/routers/extract.py` over `pinakes.ingest.text_extractor`),
 * against the same contribution queue. The handler here answers **501**.
 *
 * Two things came with the move. The model call is **REST through the engine's
 * polite HTTP client** rather than the `@google/generative-ai` SDK, so it is
 * rate-limited and retried on 429/5xx — this handler's bare `fetch` reported a
 * throttled model to the user as a failed extraction on the first try. And the
 * key rides in an `x-goog-api-key` header rather than anywhere it can be logged.
 *
 * **`server/services/text-extractor.ts` is NOT retired.** It is the graded spec —
 * its unit tests are what say the two implementations normalise one model answer
 * the same way, and `services/api/tests/test_text_extractor.py` reads the *same*
 * recorded fixture (`server/services/fixtures/text-extractor/`). It is also still
 * imported by `server/security/gemini-proxy.test.ts`.
 *
 * The path stays registered rather than being deleted, deliberately: the path set
 * is what `contracts/parity/openapi.json` was harvested from, so removing a
 * registration would rewrite the baseline the port is graded against.
 */

import { type Express, type Request, type Response } from "express";

/** The Python module that now serves this route. */
export const PORTED_TO = "services/api/src/pinakes/routers/extract.py";

/** The route this backend handed over. */
export const PORTED_ROUTES = {
  post: ["/api/extract/text"],
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

export function registerTextExtractorRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
}
