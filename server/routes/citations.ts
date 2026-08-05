/**
 * Citation export routes (US-008) — **mostly ported away**
 * (pinakes:61 US-2, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * `GET /api/citations/:domain/:id` — the download itself — is served by the
 * Python service now (`services/api/src/pinakes/routers/citations.py` over
 * `pinakes.collab.{citations,citable}`), reading the same
 * `data/source/lexicons/*.tsv` corpus the fetchers below read. That handler is
 * retired here: it answers **501** naming its replacement.
 *
 * **`GET /api/citations` keeps answering.** Its recording
 * (`contracts/parity/fixtures/get-citations-index.json`) is replayed against
 * *this* app by `contracts/parity/parity.test.ts`, and a baseline that stops
 * reproducing its own fixture is no longer a baseline. It is also the one
 * response in this group that is a constant — the domain list and the format
 * list, nothing fetched — so serving it twice cannot drift in the way a second
 * copy of the corpus reader would have.
 *
 * `server/services/citation-export.ts` is **kept**: it is the specification the
 * port was read off, and its unit tests are the statement that the two agree on
 * every rendered byte (`services/api/tests/test_citation_export.py` is that same
 * suite, case for case). The fetchers below are kept for the same reason — they
 * are what `pinakes.collab.citable` was written against, and they still supply
 * this file's domain list.
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  CITATION_FORMATS,
  parseEntitySources,
  type CitableEntity,
} from "../services/citation-export";

/** A domain fetcher resolves an id to a normalized citable entity, or `null` if absent. */
export type CitationFetcher = (id: string) => Promise<CitableEntity | null>;

/**
 * The domains that carry citable `sources`. Each fetcher returns a normalized
 * `CitableEntity` (id/name/sources/year/region) — reading flat rows or GeoJSON
 * `properties` as the storage shape requires. `urlPath` is the client route stem used to
 * build the entity's canonical URL in the record entry.
 *
 * Nothing calls these any more; the Python side reads the same four TSVs. They
 * are the graded spec for `pinakes.collab.citable` — in particular the two
 * shapes that are easy to lose in a port: a civilization's year falls back to
 * its boundary row and then to **0** rather than to nothing, and an
 * archaeological site with no parseable `coordinates` is filtered out of the
 * layer entirely and so has no citation at all.
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

export interface CitationRouteOptions {
  /** Override the per-domain fetchers (tests pass in-memory fakes). */
  fetchers?: Record<string, { urlPath: string; fetch: CitationFetcher }>;
}

/** The Python module that now serves the retired route. */
export const PORTED_TO = "services/api/src/pinakes/routers/citations.py";

/**
 * The routes this backend handed over, by method.
 *
 * `/api/citations` is absent because it is still served below — see the module
 * docstring for why that one recording has to keep being reproducible here.
 */
export const PORTED_ROUTES = {
  get: ["/api/citations/:domain/:id"],
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

export function registerCitationRoutes(app: Express, options: CitationRouteOptions = {}): void {
  const fetchers = options.fetchers ?? defaultFetchers();
  const domains = Object.keys(fetchers);

  /**
   * GET /api/citations — the self-documenting contract (domains + formats).
   * Still served here; the Python service serves the same document.
   */
  app.get("/api/citations", (_req: Request, res: Response) => {
    res.json({ domains, formats: CITATION_FORMATS });
  });

  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
}
