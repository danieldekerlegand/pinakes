/**
 * Canonical per-entity URL resolver routes (US-009).
 *
 * **Ported to Python** (pinakes:63 US-1): both routes are served by
 * `services/api/src/pinakes/routers/entity_resolver.py` over
 * `pinakes.lexicons.{entity,storage}`, against the same corpus. Neither is
 * retired here, and that is not an omission — **both** carry a recorded fixture
 * (`contracts/parity/fixtures/get-entit{ies,y}.json`) that
 * `contracts/parity/parity.test.ts` replays against *this* app, and a baseline
 * that stops reproducing its own recording is no longer a baseline (the same
 * rule that keeps `GET /api/citations` and `GET /api/graph/status` alive here).
 * Serving them twice is safe in a way a second writer would not be: both sides
 * only read `data/source/lexicons/`, and
 * `services/api/tests/test_entity_routes.py` pins them to the same rows.
 *
 * `services/entity-resolver.ts` is likewise **kept as the graded spec** —
 * `entity-resolver.test.ts` is the statement that the two registries agree on
 * the domain list, the `cs:` id format and the citation-domain mapping.
 *
 * `GET /api/entity/:domain/:id` resolves a permanent entity id to its canonical
 * descriptor (name, canonical URL, stable `cs:` id, whether it is citable, a richer
 * view path when one exists). The client landing page at `/entity/:domain/:id`
 * consumes it. `GET /api/entities` lists the supported domains + the route template.
 *
 * This module owns only the storage fetch + HTTP wiring; the id ⇄ path mapping and
 * the descriptor shape are the pure `services/entity-resolver.ts`. Fetchers are
 * **injectable** so route tests run with in-memory fakes (no storage/fs).
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  CANONICAL_PATH_TEMPLATE,
  describeEntity,
  entityDomains,
  ENTITY_DOMAINS,
  isEntityDomain,
  type EntityDomain,
  type EntityRecordLite,
} from "../services/entity-resolver";

/** Resolve an id to a minimal record, or `null` when absent. */
export type EntityFetcher = (id: string) => Promise<EntityRecordLite | null>;

/** Read a field off a loosely-typed record without widening the whole storage type. */
function field(record: unknown, key: string): unknown {
  return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
}
function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Default per-domain fetchers over live storage. Flat domains read fields directly;
 * GeoJSON domains (civilization, archaeological-site) read from `.properties` with a
 * type-specific id key — same normalization boundary as citations/summaries.
 */
function defaultFetchers(): Record<EntityDomain, EntityFetcher> {
  return {
    language: async (id) => {
      const all = await storage.getLanguages();
      const r = all.find((x) => field(x, "id") === id);
      return r ? { id, name: String(field(r, "name") ?? id), region: strOrNull(field(r, "region")) } : null;
    },
    "language-family": async (id) => {
      const all = await storage.getLanguageFamilies();
      const r = all.find((x) => field(x, "id") === id);
      return r ? { id, name: String(field(r, "name") ?? id) } : null;
    },
    civilization: async (id) => {
      const all = await storage.getCivilizations();
      const f = all.find((c) => c.properties.civilizationId === id);
      return f
        ? { id, name: f.properties.name, year: numOrNull(f.properties.timePeriod?.start) }
        : null;
    },
    "culture-profile": async (id) => {
      const p = await storage.getCultureProfileById(id);
      return p
        ? { id: p.id, name: p.name, region: strOrNull(field(p, "region")), year: numOrNull(field(p, "timePeriodStart")) }
        : null;
    },
    "archaeological-site": async (id) => {
      const all = await storage.getArchaeologicalSites();
      const f = all.find((s) => s.properties.siteId === id);
      return f
        ? { id, name: f.properties.name, year: numOrNull(f.properties.timePeriod?.start) }
        : null;
    },
    deity: async (id) => {
      const all = await storage.getDeities();
      const d = all.find((x) => field(x, "id") === id);
      return d
        ? { id, name: String(field(d, "name") ?? id), region: strOrNull(field(d, "mythology")), year: numOrNull(field(d, "timeOrigin")) }
        : null;
    },
    religion: async (id) => {
      const all = await storage.getReligions();
      const r = all.find((x) => field(x, "id") === id);
      return r ? { id, name: String(field(r, "name") ?? id), region: strOrNull(field(r, "region")) } : null;
    },
    cuisine: async (id) => {
      const all = await storage.getCuisines();
      const r = all.find((x) => field(x, "id") === id);
      return r ? { id, name: String(field(r, "name") ?? id), region: strOrNull(field(r, "region")) } : null;
    },
    "trade-good": async (id) => {
      const all = await storage.getTradeGoods();
      const r = all.find((x) => field(x, "id") === id);
      return r ? { id, name: String(field(r, "name") ?? id) } : null;
    },
    "writing-system": async (id) => {
      const r = await storage.getWritingSystemById(id);
      return r ? { id: String(field(r, "id") ?? id), name: String(field(r, "name") ?? id) } : null;
    },
    battle: async (id) => {
      const all = await storage.getBattles();
      const r = all.find((x) => field(x, "id") === id);
      return r ? { id, name: String(field(r, "name") ?? id) } : null;
    },
    "urheimat-hypothesis": async (id) => {
      const r = await storage.getUrheimatHypothesis(id);
      if (!r) return null;
      const name = field(r, "hypothesisName") ?? field(r, "name") ?? id;
      return { id: String(field(r, "id") ?? id), name: String(name), region: strOrNull(field(r, "proposedRegion")) };
    },
  };
}

/** Build the absolute origin (`https://host`) for the entity's canonical URL. */
function requestOrigin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = req.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

export interface EntityResolverRouteOptions {
  /** Override the per-domain fetchers (tests pass in-memory fakes). */
  fetchers?: Partial<Record<EntityDomain, EntityFetcher>>;
}

export function registerEntityResolverRoutes(app: Express, options: EntityResolverRouteOptions = {}): void {
  const fetchers = { ...defaultFetchers(), ...options.fetchers };

  /** GET /api/entities — the self-documenting contract (domains + path template). */
  app.get("/api/entities", (_req: Request, res: Response) => {
    res.json({
      pathTemplate: CANONICAL_PATH_TEMPLATE,
      domains: entityDomains().map((domain) => ({
        domain,
        label: ENTITY_DOMAINS[domain].label,
        entityType: ENTITY_DOMAINS[domain].entityType,
        citable: ENTITY_DOMAINS[domain].citable,
      })),
    });
  });

  /**
   * GET /api/entity/:domain/:id — resolve a permanent entity id to its canonical
   * descriptor. Unknown domain → 404; unknown/renamed id → 404 (graceful, AC3).
   */
  app.get("/api/entity/:domain/:id", async (req: Request, res: Response) => {
    const { domain, id } = req.params;
    if (!isEntityDomain(domain)) {
      res.status(404).json({
        error: "Unknown entity domain",
        detail: `No canonical URLs for ${JSON.stringify(domain)}`,
        domains: entityDomains(),
      });
      return;
    }
    try {
      const record = await fetchers[domain]?.(id);
      if (!record) {
        res.status(404).json({ error: "Not found", detail: `No ${domain} with id ${JSON.stringify(id)}` });
        return;
      }
      res.json(describeEntity(domain, record, requestOrigin(req)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Unexpected error in entity/${domain}/${id}:`, error);
      res.status(500).json({ error: "entity resolution failed", detail: message });
    }
  });
}
