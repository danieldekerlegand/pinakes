/**
 * DNA-to-culture ancestry mapping routes (US-001).
 *
 * `POST /api/ancestry/map` takes the Y-DNA haplogroup ids a user's raw-DNA file was
 * reduced to **in the browser** (only the haplogroup ids — never the raw genotypes —
 * are sent) and returns the languages/cultures/cuisines that ancestry is associated
 * with, plus clear caveats. `GET /api/ancestry/haplogroups` lists the reference
 * haplogroups the mapper knows about.
 *
 * The privacy guarantee lives in the client (parsing + haplogroup inference happen in
 * `web/src/lib/dna/*`); this route only enriches non-identifying haplogroup ids from
 * the public reference corpus. The mapping itself is the pure
 * `mapHaplogroupsToAncestry` in `services/genetic-linguistic-correlation.ts`; this
 * module owns only the storage load + HTTP wiring, and the data loader is **injectable**
 * so route tests run with in-memory fakes (no storage/fs).
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  mapHaplogroupsToAncestry,
  type AncestryMapperData,
} from "../services/genetic-linguistic-correlation";

export type AncestryDataLoader = () => Promise<AncestryMapperData>;

/** Default loader: assemble the mapper's minimal data shape from live TSV storage. */
async function loadAncestryData(): Promise<AncestryMapperData> {
  const [haplogroups, families, languages, civFeatures, cuisines] = await Promise.all([
    storage.getHaplogroups(),
    storage.getLanguageFamilies(),
    storage.getLanguages(),
    storage.getCivilizations(),
    storage.getCuisines(),
  ]);

  return {
    haplogroups: haplogroups.map((h) => ({
      id: h.id,
      name: h.name,
      geographicOrigin: h.geographicOrigin,
      timeOrigin: h.timeOrigin,
      associatedLanguageFamilyIds: h.associatedLanguageFamilyIds,
      associatedCivilizationIds: h.associatedCivilizationIds,
    })),
    families: families.map((f) => ({ id: f.id, name: f.name, region: f.region ?? null })),
    languages: languages.map((l) => ({ id: l.id, name: l.name, familyId: l.familyId })),
    civilizations: civFeatures.map((c) => ({
      id: c.properties.civilizationId,
      name: c.properties.name,
    })),
    cuisines: cuisines.map((c) => ({
      id: c.id,
      name: c.name,
      region: c.region,
      associatedLanguageIds: c.associatedLanguageIds,
    })),
  };
}

export interface AncestryRouteOptions {
  /** Override the data loader (tests pass an in-memory fake). */
  loadData?: AncestryDataLoader;
}

export function registerAncestryRoutes(app: Express, options: AncestryRouteOptions = {}): void {
  const loadData = options.loadData ?? loadAncestryData;

  /** GET /api/ancestry/haplogroups — reference haplogroups the mapper recognizes. */
  app.get("/api/ancestry/haplogroups", async (_req: Request, res: Response) => {
    try {
      const data = await loadData();
      res.json({
        haplogroups: data.haplogroups.map((h) => ({
          id: h.id,
          name: h.name,
          geographicOrigin: h.geographicOrigin,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: "failed to load haplogroups", detail: message });
    }
  });

  /**
   * POST /api/ancestry/map — map inferred haplogroup ids to cultural associations.
   * Body: `{ haplogroupIds: string[] }`. 400 when the list is missing/empty.
   */
  app.post("/api/ancestry/map", async (req: Request, res: Response) => {
    const raw = (req.body ?? {}) as { haplogroupIds?: unknown };
    if (!Array.isArray(raw.haplogroupIds) || raw.haplogroupIds.length === 0) {
      res.status(400).json({ error: "haplogroupIds must be a non-empty array of strings" });
      return;
    }
    const haplogroupIds = raw.haplogroupIds.filter((x): x is string => typeof x === "string");
    if (haplogroupIds.length === 0) {
      res.status(400).json({ error: "haplogroupIds must contain at least one string id" });
      return;
    }
    try {
      const data = await loadData();
      res.json(mapHaplogroupsToAncestry(haplogroupIds, data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Unexpected error in /api/ancestry/map:", error);
      res.status(500).json({ error: "ancestry mapping failed", detail: message });
    }
  });
}
