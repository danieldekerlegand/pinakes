/**
 * First-party `/api/summaries/*` routes (US-004, tasklist 13 platform-infra).
 *
 * Progressive summary/detail loading: these endpoints return **lightweight**
 * per-domain records (the summary contract in server/services/entity-summary.ts),
 * so a client can render lists/cards fast and hydrate a single entity's full
 * record on demand from the existing `/api/<domain>/:id` detail endpoints — or,
 * for a uniform namespace, from `/api/summaries/:domain/:id` (same underlying
 * data, no projection).
 *
 * The projection + pagination is pure (entity-summary.ts); this module only maps
 * a domain to its storage fetcher, parses `offset`/`limit`, and formats errors.
 * Graph/correlation queries still go through `/api/graph/*`; heavy tabular
 * aggregates through `/api/analytics/*`; this is the read-light list path.
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  isSummaryDomain,
  summarizeList,
  summaryContract,
  summaryDomains,
  type EntityRecord,
  type SummaryDomain,
} from "../services/entity-summary";

/**
 * Domain → storage fetcher. Each returns the full, flat record array for that
 * domain (the same records the legacy list endpoints return). Kept here (not in
 * the pure summary service) because it is the one place that touches storage.
 */
const DOMAIN_FETCHERS: Record<SummaryDomain, () => Promise<EntityRecord[]>> = {
  languages: async () => (await storage.getLanguages()) as unknown as EntityRecord[],
  religions: async () => (await storage.getReligions()) as unknown as EntityRecord[],
  battles: async () => (await storage.getBattles()) as unknown as EntityRecord[],
  "culture-profiles": async () =>
    (await storage.getCultureProfiles()) as unknown as EntityRecord[],
  cuisines: async () => (await storage.getCuisines()) as unknown as EntityRecord[],
  "trade-goods": async () => (await storage.getTradeGoods()) as unknown as EntityRecord[],
  innovations: async () => (await storage.getInnovations()) as unknown as EntityRecord[],
};

/** Parse a query-string integer; undefined when absent or not a finite number. */
function parseIntParam(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function registerSummaryRoutes(app: Express): void {
  /**
   * GET /api/summaries — the machine-readable contract: every domain, its
   * summary fields, and where to hydrate detail. Self-documenting so clients can
   * discover the progressive-loading surface.
   */
  app.get("/api/summaries", (_req: Request, res: Response) => {
    res.json({
      domains: summaryDomains().map((domain) => ({
        domain,
        ...summaryContract(domain),
      })),
    });
  });

  /**
   * GET /api/summaries/:domain — a bounded, paginated page of lightweight
   * summary records for one domain. Query: `offset` (default 0), `limit`
   * (default: whole remainder). Unknown domain → 404.
   */
  app.get("/api/summaries/:domain", async (req: Request, res: Response) => {
    const { domain } = req.params;
    if (!isSummaryDomain(domain)) {
      res.status(404).json({
        error: "Unknown summary domain",
        detail: `No summary contract for ${JSON.stringify(domain)}`,
        domains: summaryDomains(),
      });
      return;
    }
    try {
      const records = await DOMAIN_FETCHERS[domain]();
      const result = summarizeList(domain, records, {
        offset: parseIntParam(req.query.offset),
        limit: parseIntParam(req.query.limit),
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Unexpected error in summaries/${domain}:`, error);
      res.status(500).json({ error: "summary listing failed", detail: message });
    }
  });

  /**
   * GET /api/summaries/:domain/:id — detail-on-demand: the full, unprojected
   * record for one entity, in the uniform summaries namespace. Unknown domain →
   * 404; unknown id → 404.
   */
  app.get("/api/summaries/:domain/:id", async (req: Request, res: Response) => {
    const { domain, id } = req.params;
    if (!isSummaryDomain(domain)) {
      res.status(404).json({
        error: "Unknown summary domain",
        detail: `No summary contract for ${JSON.stringify(domain)}`,
        domains: summaryDomains(),
      });
      return;
    }
    try {
      const records = await DOMAIN_FETCHERS[domain]();
      const record = records.find((r) => r.id === id);
      if (!record) {
        res.status(404).json({ error: "Not found", detail: `No ${domain} with id ${JSON.stringify(id)}` });
        return;
      }
      res.json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Unexpected error in summaries/${domain}/${id}:`, error);
      res.status(500).json({ error: "detail lookup failed", detail: message });
    }
  });
}
