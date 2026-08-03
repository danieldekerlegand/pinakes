/**
 * First-party `/api/analytics/*` routes (US-001, tasklist 13 platform-infra).
 *
 * These route **heavy tabular / aggregate** work through the runtime DuckDB
 * analytical index (server/services/analytical-index.ts) instead of re-parsing
 * TSVs and looping in JS. Graph / correlation queries continue to go through
 * `/api/graph/*` (Neo4j); the index is a derived, read-only mirror of the
 * source-of-truth `data/source/lexicons/*.tsv` (docs/analytical-index.md).
 *
 * Handlers never crash the process: a bad table/column maps to 404, and an
 * unexpected index failure maps to 500 with a structured body.
 */
import { type Express, type Request, type Response } from "express";

import { getAnalyticalIndex } from "../services/analytical-index";

function handleError(res: Response, context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  // A missing table/column is a client error, not a server fault.
  if (/^No (indexed table|column)/.test(message)) {
    res.status(404).json({ error: `${context} not found`, detail: message });
    return;
  }
  console.error(`Unexpected error in ${context}:`, error);
  res.status(500).json({ error: `${context} failed`, detail: message });
}

export function registerAnalyticsRoutes(app: Express): void {
  /**
   * GET /api/analytics/tables — list indexed tables with columns + row counts,
   * so clients can discover what is faceted/aggregatable.
   */
  app.get("/api/analytics/tables", async (_req: Request, res: Response) => {
    try {
      const index = await getAnalyticalIndex();
      res.json({ tables: await index.describe() });
    } catch (error) {
      handleError(res, "analytics tables", error);
    }
  });

  /**
   * GET /api/analytics/facets/:table/:column — facet counts (distinct values +
   * row counts) for one column, ordered by count desc. This is the aggregate the
   * faceted-search work (US-005) routes through the index.
   */
  app.get(
    "/api/analytics/facets/:table/:column",
    async (req: Request, res: Response) => {
      try {
        const index = await getAnalyticalIndex();
        const { table, column } = req.params;
        const facets = await index.facetCounts(table, column);
        res.json({ table, column, facets });
      } catch (error) {
        handleError(res, "analytics facets", error);
      }
    },
  );
}
