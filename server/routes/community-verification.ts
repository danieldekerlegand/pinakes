/**
 * Community verification & culture stewardship routes (US-012) — **the
 * stewardship third ported away** (pinakes:61 US-2,
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * Still served here (the multi-confirmation flow, which belongs to the
 * contribution queue's own port unit and has not moved yet):
 *
 * - `POST /api/contributions/:id/confirm` — an independent confirmation from a
 *   distinct reviewer. Raises confidence; N distinct reviewers verify the
 *   contribution (a domain steward lowers the bar). Steward + confidence are
 *   recorded with provenance.
 * - `GET  /api/contributions/:id/verification` — the current verification state.
 *
 * Retired to 501 — served by `services/api/src/pinakes/routers/stewardship.py`
 * over `pinakes.collab.stewardship`:
 *
 * - `GET  /api/stewardship` (optional `?domain=`) — list steward adoptions.
 * - `POST /api/stewardship/adopt` — adopt a cultural domain.
 * - `POST /api/stewardship/release` — release a claim.
 *
 * **The split is only safe because both servers share one `stewards.json`.**
 * The confirm handler below still asks `stewards.isSteward(...)`, reading the
 * very roster the Python service now writes — under `data/runtime/stewardship`,
 * the same directory this `StewardshipStore` points at. A claim adopted over
 * there takes effect here on the next request; that is the whole reason the two
 * halves of this file could be ported at different times.
 *
 * `ContributionService`, the `StewardshipStore`, and the verification config are
 * injectable so route tests point them at temp dirs + a fixed config/clock.
 */

import type { Express, Request, Response } from "express";
import { ContributionService } from "../services/contribution-service";
import { StewardshipStore, resolveContributionDomain } from "../services/stewardship";
import {
  loadVerificationConfig,
  summarizeVerification,
  type VerificationConfig,
} from "../services/community-verification";

/** The Python module that now serves the retired stewardship routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/stewardship.py";

/**
 * The routes this backend handed over, by method.
 *
 * Three of the five this file registers. The other two — confirm and
 * verification — are a *different* port unit (they are about the contribution
 * queue, not about who has claimed what), so they are absent here and still
 * served below.
 */
export const PORTED_ROUTES = {
  get: ["/api/stewardship"],
  post: ["/api/stewardship/adopt", "/api/stewardship/release"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

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

export interface CommunityVerificationRouteOptions {
  contributions?: ContributionService;
  stewards?: StewardshipStore;
  config?: VerificationConfig;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

export function registerCommunityVerificationRoutes(
  app: Express,
  options: CommunityVerificationRouteOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();
  const stewards = options.stewards ?? new StewardshipStore();
  const config = options.config ?? loadVerificationConfig();
  const now = options.now ?? (() => new Date().toISOString());

  /**
   * POST /api/contributions/:id/confirm — body `{ reviewer, note? }`.
   * Records an independent confirmation. 200 with the verification state,
   * 400 (missing reviewer / self-confirm), 404 (unknown), 409 (duplicate).
   */
  app.post("/api/contributions/:id/confirm", (req, res) => {
    const reviewer = typeof req.body?.reviewer === "string" ? req.body.reviewer.trim() : "";
    if (!reviewer) {
      res.status(400).json({ message: "reviewer is required" });
      return;
    }

    const contribution = contributions.get(req.params.id);
    if (!contribution) {
      res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
      return;
    }

    const domain = resolveContributionDomain(contribution);
    const isSteward = stewards.isSteward(reviewer, domain);

    const result = contributions.confirm(req.params.id, {
      reviewer,
      isSteward,
      domain,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
      config,
      now: now(),
    });

    if (!result) {
      res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
      return;
    }

    if (!result.added) {
      const status = result.reason === "self" ? 400 : 409;
      res.status(status).json({
        message:
          result.reason === "self"
            ? "A contributor cannot confirm their own contribution"
            : "This reviewer has already confirmed this contribution",
        reason: result.reason,
        domain,
        verification: result.verification,
      });
      return;
    }

    res.json({
      contribution: result.contribution,
      verification: result.verification,
      domain,
      confirmedAsSteward: isSteward,
    });
  });

  /**
   * GET /api/contributions/:id/verification — current verification state.
   */
  app.get("/api/contributions/:id/verification", (req, res) => {
    const contribution = contributions.get(req.params.id);
    if (!contribution) {
      res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
      return;
    }
    const base = contribution.baseConfidence ?? contribution.confidence;
    const verification = summarizeVerification(base, contribution.confirmations ?? [], config);
    res.json({
      id: contribution.id,
      domain: resolveContributionDomain(contribution),
      status: contribution.status,
      config,
      verification,
      stewardAttribution: contribution.stewardAttribution ?? [],
    });
  });

  // The three `/api/stewardship*` handlers are retired — the roster is adopted
  // and released through the Python service now. The paths stay registered
  // rather than deleted: the path set is what `contracts/parity/openapi.json`
  // was harvested from, so removing a registration would rewrite the very
  // baseline the port is graded against.
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
}
