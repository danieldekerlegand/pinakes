/**
 * Citation export routes (US-008).
 *
 * `GET /api/citations/:domain/:id?format=bibtex|ris|csljson` downloads an academic
 * citation for one entity, built from its `sources[]` by the pure
 * `services/citation-export.ts`. This module owns only the storage fetch + HTTP wiring:
 * it maps a domain to a fetcher that returns a normalized `CitableEntity`, then streams
 * the rendered citation with an `attachment` Content-Disposition.
 *
 * `GET /api/citations` lists the supported domains + formats (self-documenting).
 *
 * Fetchers are **injectable** so route tests run with in-memory fakes (no storage/fs).
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  CITATION_FORMATS,
  isCitationFormat,
  parseEntitySources,
  renderCitation,
  type CitableEntity,
} from "../services/citation-export";

/** A domain fetcher resolves an id to a normalized citable entity, or `null` if absent. */
export type CitationFetcher = (id: string) => Promise<CitableEntity | null>;

/**
 * The domains that carry citable `sources`. Each fetcher returns a normalized
 * `CitableEntity` (id/name/sources/year/region) — reading flat rows or GeoJSON
 * `properties` as the storage shape requires. `urlPath` is the client route stem used to
 * build the entity's canonical URL in the record entry.
 */
function defaultFetchers(): Record<string, { urlPath: string; fetch: CitationFetcher }> {
  return {
    "culture-profiles": {
      urlPath: "culture-profile",
      fetch: async (id) => {
        const p = await storage.getCultureProfileById(id);
        if (!p) return null;
        return {
          entityType: "culture-profile",
          id: p.id,
          name: p.name,
          sources: parseEntitySources(p.sources),
          year: p.timePeriodStart ?? null,
          region: p.region ?? null,
        };
      },
    },
    civilizations: {
      urlPath: "civilization",
      fetch: async (id) => {
        const all = await storage.getCivilizations();
        const f = all.find((c) => c.properties.civilizationId === id);
        if (!f) return null;
        return {
          entityType: "civilization",
          id: f.properties.civilizationId,
          name: f.properties.name,
          sources: parseEntitySources(f.properties.sources),
          year: f.properties.timePeriod?.start ?? null,
          region: null,
        };
      },
    },
    deities: {
      urlPath: "deity",
      fetch: async (id) => {
        const all = await storage.getDeities();
        const d = all.find((x) => x.id === id);
        if (!d) return null;
        return {
          entityType: "deity",
          id: d.id,
          name: d.name,
          sources: parseEntitySources(d.sources),
          year: d.timeOrigin ?? null,
          region: d.mythology ?? null,
        };
      },
    },
    "archaeological-sites": {
      urlPath: "archaeological-site",
      fetch: async (id) => {
        const all = await storage.getArchaeologicalSites();
        const f = all.find((s) => s.properties.siteId === id);
        if (!f) return null;
        return {
          entityType: "archaeological-site",
          id: f.properties.siteId,
          name: f.properties.name,
          sources: parseEntitySources(f.properties.sources),
          year: f.properties.timePeriod?.start ?? null,
          region: null,
        };
      },
    },
  };
}

/** Build the absolute origin (`https://host`) for the entity's canonical URL. */
function requestOrigin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = req.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

export interface CitationRouteOptions {
  /** Override the per-domain fetchers (tests pass in-memory fakes). */
  fetchers?: Record<string, { urlPath: string; fetch: CitationFetcher }>;
}

export function registerCitationRoutes(app: Express, options: CitationRouteOptions = {}): void {
  const fetchers = options.fetchers ?? defaultFetchers();
  const domains = Object.keys(fetchers);

  /** GET /api/citations — the self-documenting contract (domains + formats). */
  app.get("/api/citations", (_req: Request, res: Response) => {
    res.json({ domains, formats: CITATION_FORMATS });
  });

  /**
   * GET /api/citations/:domain/:id?format= — download the entity's citation.
   * Unknown domain / format → 404 / 400; unknown id → 404. Missing/partial sources
   * still yield a record-level citation (never a 500).
   */
  app.get("/api/citations/:domain/:id", async (req: Request, res: Response) => {
    const { domain, id } = req.params;
    const config = fetchers[domain];
    if (!config) {
      res.status(404).json({ error: "Unknown citation domain", detail: `No citations for ${JSON.stringify(domain)}`, domains });
      return;
    }

    const rawFormat = typeof req.query.format === "string" ? req.query.format : "bibtex";
    if (!isCitationFormat(rawFormat)) {
      res.status(400).json({ error: "Unknown citation format", detail: `Expected one of ${CITATION_FORMATS.join(", ")}`, formats: CITATION_FORMATS });
      return;
    }

    try {
      const entity = await config.fetch(id);
      if (!entity) {
        res.status(404).json({ error: "Not found", detail: `No ${domain} with id ${JSON.stringify(id)}` });
        return;
      }
      const origin = requestOrigin(req);
      const withUrl: CitableEntity = { ...entity, url: origin ? `${origin}/${config.urlPath}/${entity.id}` : entity.url };
      const rendered = renderCitation(withUrl, rawFormat);
      res.setHeader("Content-Type", rendered.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${rendered.filename}"`);
      res.send(rendered.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Unexpected error in citations/${domain}/${id}:`, error);
      res.status(500).json({ error: "citation export failed", detail: message });
    }
  });
}
