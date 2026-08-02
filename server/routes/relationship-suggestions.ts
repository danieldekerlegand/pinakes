/**
 * Authoring-time suggested relationships route (US-010).
 *
 * When a contributor is creating or editing an entity, these endpoints surface
 * the *most likely* relationships to nearby entities — ranked by the existing
 * cross-domain proximity math (`services/relationship-suggestions.ts`, built on
 * `cross-domain-analysis.ts`) plus, optionally, the shared graph. Each
 * suggestion carries a rationale (which of temporal / spatial / linguistic
 * proximity fired) and a confidence, and it is packaged with a ready-to-submit
 * edge payload.
 *
 * These endpoints **never create an edge** — they only rank and return. The
 * contributor confirms a suggestion by POSTing it to `/api/relationships/edge`
 * (US-003), which is where dedup + the review queue live.
 *
 *   GET  /api/relationships/suggestions?entityId=&entityType=&limit=&minConfidence=
 *        — suggestions for an entity already in the corpus.
 *   POST /api/relationships/suggestions  { id, name, entityType, ...draft }
 *        — suggestions for an entity being authored (not yet saved).
 *
 * The entity + existing-edge loaders are injectable so tests run with no fs /
 * storage / network (see `server/routes/relationship-suggestions.test.ts`).
 */

import type { Express } from "express";
import path from "node:path";
import { extractAllCanonicalEdges } from "../services/canonical-edges";
import {
  suggestRelationships,
  type SuggestionEntity,
  type ExistingEdge,
} from "../services/relationship-suggestions";

export interface SuggestionRouteOptions {
  /** Candidate pool (default: all cross-domain entities + languages from storage). */
  loadEntities?: () => Promise<SuggestionEntity[]>;
  /** Relationships already present, for exclusion (default: corpus canonical edges). */
  loadExistingEdges?: () => ExistingEdge[];
  /** Lexicons dir for the default existing-edge loader. */
  lexiconsDir?: string;
}

/** Extract a signed year from a loose date string (`"500 BC"`, `"-500"`, `"1200"`). */
function parseYearish(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = value.match(/-?\d+/);
  if (!match) return null;
  let year = Number(match[0]);
  if (!Number.isFinite(year)) return null;
  if (/\bb\.?c\.?(e)?\b/i.test(value) && year > 0) year = -year;
  return year;
}

/**
 * The default candidate pool: every normalized cross-domain entity
 * (`CrossDomainAnalysis.getAllEntities`) plus the language corpus (so a language
 * being authored can also be resolved and suggested against). Read lazily so a
 * test that injects `loadEntities` never touches storage.
 */
async function defaultLoadEntities(): Promise<SuggestionEntity[]> {
  const [{ CrossDomainAnalysis }, { storage }] = await Promise.all([
    import("../services/cross-domain-analysis"),
    import("../storage"),
  ]);
  const analysis = new CrossDomainAnalysis(storage);
  const unified = await analysis.getAllEntities();

  const entities: SuggestionEntity[] = unified.map((e) => ({
    id: e.id,
    name: e.name,
    entityType: e.entityType,
    languageIds: e.associatedLanguageIds,
    coordinates: e.coordinates ?? null,
    timeStart: e.timeOrigin,
    timeEnd: e.timeEnd,
    region: e.region ?? null,
  }));

  const languages = await storage.getLanguages();
  for (const l of languages) {
    entities.push({
      id: l.id,
      name: l.name,
      entityType: "language",
      // A language is associated with itself — this is what links it to the
      // cuisines/religions/etc. that reference it in `associatedLanguageIds`.
      languageIds: [l.id],
      coordinates: l.coordinates ?? null,
      timeStart: parseYearish(l.timeOrigin),
      timeEnd: parseYearish(l.timeEnd),
      region: l.region ?? null,
    });
  }

  return entities;
}

function defaultLoadExistingEdges(lexiconsDir: string): () => ExistingEdge[] {
  return () => {
    // Defensive: a missing/partial lexicons dir must not 500 the suggestions
    // endpoint (worst case: no exclusions, so nothing is filtered).
    try {
      const { edges } = extractAllCanonicalEdges(lexiconsDir);
      return edges.map((e) => ({
        sourceId: e.startId,
        targetId: e.endId,
        relationshipType: e.edgeName,
      }));
    } catch (error) {
      console.warn("relationship-suggestions: could not load existing edges:", error);
      return [];
    }
  };
}

function readNumberParam(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function registerRelationshipSuggestionRoutes(
  app: Express,
  options: SuggestionRouteOptions = {},
): void {
  const lexiconsDir = options.lexiconsDir ?? path.resolve("data", "source", "lexicons");
  const loadEntities = options.loadEntities ?? defaultLoadEntities;
  const loadExistingEdges =
    options.loadExistingEdges ?? defaultLoadExistingEdges(lexiconsDir);

  /**
   * GET /api/relationships/suggestions — suggestions for an entity already in
   * the corpus, resolved by `entityId` (and optionally `entityType`). Returns
   * 400 without an id, 404 when the entity isn't found.
   */
  app.get("/api/relationships/suggestions", async (req, res) => {
    try {
      const entityId = typeof req.query.entityId === "string" ? req.query.entityId.trim() : "";
      const entityType =
        typeof req.query.entityType === "string" ? req.query.entityType.trim() : "";
      if (!entityId) {
        return res.status(400).json({ message: "entityId is required" });
      }

      const entities = await loadEntities();
      const source = entities.find(
        (e) => e.id === entityId && (!entityType || e.entityType === entityType),
      );
      if (!source) {
        return res.status(404).json({
          message: `No entity found with id "${entityId}"${entityType ? ` and type "${entityType}"` : ""}`,
        });
      }

      const suggestions = suggestRelationships(source, entities, loadExistingEdges(), {
        limit: readNumberParam(req.query.limit),
        minConfidence: readNumberParam(req.query.minConfidence),
      });

      return res.json({
        source: { id: source.id, name: source.name, entityType: source.entityType },
        count: suggestions.length,
        suggestions,
      });
    } catch (error) {
      console.error("Error computing relationship suggestions:", error);
      return res.status(500).json({ message: "Failed to compute relationship suggestions" });
    }
  });

  /**
   * POST /api/relationships/suggestions — suggestions for an entity being
   * authored (not yet in the corpus). Body is a `SuggestionEntity` draft
   * ({ id, name, entityType, ...proximity fields }). Returns 400 without the
   * required identity fields.
   */
  app.post("/api/relationships/suggestions", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<SuggestionEntity> & {
        limit?: number;
        minConfidence?: number;
      };
      if (
        typeof body.id !== "string" ||
        body.id.trim() === "" ||
        typeof body.name !== "string" ||
        body.name.trim() === "" ||
        typeof body.entityType !== "string" ||
        body.entityType.trim() === ""
      ) {
        return res.status(400).json({ message: "id, name, and entityType are required" });
      }

      const source: SuggestionEntity = {
        id: body.id.trim(),
        name: body.name.trim(),
        entityType: body.entityType.trim(),
        languageIds: Array.isArray(body.languageIds) ? body.languageIds : [],
        coordinates: body.coordinates ?? null,
        timeStart: body.timeStart ?? null,
        timeEnd: body.timeEnd ?? null,
        region: body.region ?? null,
      };

      const entities = await loadEntities();
      const suggestions = suggestRelationships(source, entities, loadExistingEdges(), {
        limit: readNumberParam(body.limit),
        minConfidence: readNumberParam(body.minConfidence),
      });

      return res.json({
        source: { id: source.id, name: source.name, entityType: source.entityType },
        count: suggestions.length,
        suggestions,
      });
    } catch (error) {
      console.error("Error computing relationship suggestions:", error);
      return res.status(500).json({ message: "Failed to compute relationship suggestions" });
    }
  });
}
