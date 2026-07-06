/**
 * Community verification & culture stewardship routes (US-012).
 *
 * - `POST /api/contributions/:id/confirm` — an independent confirmation from a
 *   distinct reviewer. Raises confidence; N distinct reviewers verify the
 *   contribution (a domain steward lowers the bar). Steward + confidence are
 *   recorded with provenance.
 * - `GET  /api/contributions/:id/verification` — the current verification state.
 * - `GET  /api/stewardship` (optional `?domain=`) — list steward adoptions.
 * - `POST /api/stewardship/adopt` — adopt a cultural domain.
 * - `POST /api/stewardship/release` — release a claim.
 *
 * `ContributionService`, the `StewardshipStore`, and the verification config are
 * injectable so route tests point them at temp dirs + a fixed config/clock.
 */

import type { Express } from "express";
import { ContributionService } from "../services/contribution-service";
import { StewardshipStore, resolveContributionDomain } from "../services/stewardship";
import {
  loadVerificationConfig,
  summarizeVerification,
  type VerificationConfig,
} from "../services/community-verification";

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

  /**
   * GET /api/stewardship — list steward adoptions (optional `?domain=`).
   */
  app.get("/api/stewardship", (req, res) => {
    const domain = req.query.domain as string | undefined;
    const adoptions = domain ? stewards.listForDomain(domain) : stewards.list();
    res.json({ adoptions, total: adoptions.length });
  });

  /**
   * POST /api/stewardship/adopt — body `{ steward, domain, note? }`. 201.
   */
  app.post("/api/stewardship/adopt", (req, res) => {
    const steward = typeof req.body?.steward === "string" ? req.body.steward.trim() : "";
    const domain = typeof req.body?.domain === "string" ? req.body.domain.trim() : "";
    if (!steward || !domain) {
      res.status(400).json({ message: "steward and domain are required" });
      return;
    }
    const result = stewards.adopt({
      steward,
      domain,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
      now: now(),
    });
    res.status(result.alreadyOwned ? 200 : 201).json({
      adoption: result.adoption,
      alreadyOwned: result.alreadyOwned,
    });
  });

  /**
   * POST /api/stewardship/release — body `{ steward, domain }`.
   */
  app.post("/api/stewardship/release", (req, res) => {
    const steward = typeof req.body?.steward === "string" ? req.body.steward.trim() : "";
    const domain = typeof req.body?.domain === "string" ? req.body.domain.trim() : "";
    if (!steward || !domain) {
      res.status(400).json({ message: "steward and domain are required" });
      return;
    }
    const released = stewards.release(steward, domain);
    res.json({ released });
  });
}
