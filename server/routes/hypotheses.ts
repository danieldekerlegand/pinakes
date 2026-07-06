/**
 * Automated hypothesis & site-location routes (US-007).
 *
 * `GET /api/hypotheses` returns two families of *generated, explicitly-speculative*
 * research leads over the shared corpus:
 *   - **common-ancestor hypotheses** — clusters of ≥3 distant, unrelated cultures
 *     sharing the same rare trait(s) (pottery style, motif, musical scale, …), each
 *     framed as a lead ("cultures A/B/C share X → possible common ancestor"), and
 *   - **undiscovered-site-region predictions** — gaps along documented migration
 *     corridors that run far from any known site/settlement, returned with an
 *     uncertainty radius so the client can draw them as map overlays.
 *
 * The scoring lives in the pure `services/hypothesis-generation.ts`; this module owns
 * only the storage → input projection + HTTP wiring. Every loader is **injectable** so
 * route tests run with in-memory fakes (no storage/fs). These generated leads are
 * DISTINCT from the curated `urheimat-hypotheses` dataset (marked generated+speculative).
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  generateHypotheses,
  sitePredictionsToGeoJSON,
  type CultureNode,
  type NodeFeature,
  type CorridorInput,
  type HypothesisOptions,
} from "../services/hypothesis-generation";

export type NodeLoader = () => Promise<CultureNode[]>;
export type CorridorLoader = () => Promise<CorridorInput[]>;
export type KnownSiteLoader = () => Promise<{ lat: number; lng: number }[]>;

/** Normalize a free-text trait value into a stable, case-insensitive match key. */
function normKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function traitFeatures(type: string, values: string[] | undefined): NodeFeature[] {
  const out: NodeFeature[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const label = (raw ?? "").trim();
    if (!label) continue;
    const key = normKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ type, key, label });
  }
  return out;
}

/**
 * Default node loader: the same feature-bearing, coordinate-carrying domains the
 * anomaly detector uses (music scales/rhythms/instruments, art motifs, material-
 * culture categories incl. pottery). Clusters of distant, unrelated cultures sharing
 * a rare one of these become common-ancestor hypotheses. `groupIds` = associated
 * language ids so a same-lineage cluster is treated as expected, not a lead.
 */
async function loadHypothesisNodes(): Promise<CultureNode[]> {
  const [music, art, material] = await Promise.all([
    storage.getMusicTraditions({}),
    storage.getArtTraditions(),
    storage.getMaterialCultures(),
  ]);

  const nodes: CultureNode[] = [];

  for (const m of music) {
    const features = [
      ...traitFeatures("music-scale", m.scales),
      ...traitFeatures("music-rhythm", m.rhythmicPatterns),
      ...traitFeatures("music-instrument", m.instruments),
    ];
    if (features.length === 0) continue;
    nodes.push({
      id: `music:${m.id}`,
      name: m.name,
      domain: "music-tradition",
      coordinates: m.coordinates ?? null,
      region: m.region ?? null,
      groupIds: m.associatedLanguageIds ?? [],
      features,
      sources: m.sources ?? [],
    });
  }

  for (const a of art) {
    const features = [
      ...traitFeatures("art-feature", a.keyFeatures),
      ...traitFeatures("art-category", a.category ? [a.category] : []),
    ];
    if (features.length === 0) continue;
    nodes.push({
      id: `art:${a.id}`,
      name: a.name,
      domain: "art-tradition",
      coordinates: a.originCoordinates ?? null,
      region: a.associatedCivilizations || null,
      groupIds: a.associatedLanguages ?? [],
      features,
      sources: a.notableExamples ?? [],
    });
  }

  for (const mc of material) {
    const features = traitFeatures(
      "material-category",
      mc.category ? [mc.category] : [],
    );
    if (features.length === 0) continue;
    const coords = mc.originCoordinates;
    nodes.push({
      id: `material:${mc.id}`,
      name: mc.name,
      domain: "material-culture",
      coordinates:
        Array.isArray(coords) && coords.length === 2
          ? { lat: coords[0], lng: coords[1] }
          : null,
      region: null,
      groupIds: mc.associatedLanguages ?? [],
      features,
      sources: [],
    });
  }

  return nodes;
}

/** Parse a GeoJSON LineString waypoints object into ordered lat/lng points. */
export function waypointsToPoints(
  waypoints: unknown,
): { lat: number; lng: number }[] {
  if (!waypoints || typeof waypoints !== "object") return [];
  const coords = (waypoints as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coords)) return [];
  const out: { lat: number; lng: number }[] = [];
  for (const pair of coords) {
    if (
      Array.isArray(pair) &&
      pair.length >= 2 &&
      typeof pair[0] === "number" &&
      typeof pair[1] === "number"
    ) {
      // GeoJSON is [lng, lat].
      out.push({ lat: pair[1], lng: pair[0] });
    }
  }
  return out;
}

/** Default corridor loader: migration routes → ordered lat/lng waypoint lists. */
async function loadCorridors(): Promise<CorridorInput[]> {
  const routes = await storage.getMigrationRoutes();
  const out: CorridorInput[] = [];
  for (const r of routes) {
    const points = waypointsToPoints(r.waypoints);
    if (points.length < 2) continue;
    out.push({
      id: r.id,
      name: r.name,
      points,
      peoples: r.peoples ?? [],
    });
  }
  return out;
}

/** Default known-site loader: archaeological sites + settlements coordinates. */
async function loadKnownSites(): Promise<{ lat: number; lng: number }[]> {
  const [sites, settlements] = await Promise.all([
    storage.getArchaeologicalSites(),
    storage.getSettlements(),
  ]);

  const out: { lat: number; lng: number }[] = [];
  for (const s of sites) {
    const c = s.geometry?.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      out.push({ lat: c[1], lng: c[0] }); // GeoJSON [lng,lat]
    }
  }
  for (const st of settlements) {
    if (typeof st.latitude === "number" && typeof st.longitude === "number") {
      out.push({ lat: st.latitude, lng: st.longitude });
    }
  }
  return out;
}

export interface HypothesisRouteOptions {
  loadNodes?: NodeLoader;
  loadCorridors?: CorridorLoader;
  loadKnownSites?: KnownSiteLoader;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseUnitFloat(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

function parseNonNegFloat(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function registerHypothesisRoutes(
  app: Express,
  options: HypothesisRouteOptions = {},
): void {
  const loadNodes = options.loadNodes ?? loadHypothesisNodes;
  const loadCorridorsFn = options.loadCorridors ?? loadCorridors;
  const loadKnownSitesFn = options.loadKnownSites ?? loadKnownSites;

  /**
   * GET /api/hypotheses?minMembers=&minRarity=&minGapKm=&limit=
   *   - `minMembers` (int ≥ 2) minimum cultures in an ancestor cluster.
   *   - `minRarity` (0..1) rarity floor for an anchoring shared trait.
   *   - `minGapKm` (km ≥ 0) how far a corridor point must be from a known site to
   *     become a predicted region.
   *   - `limit` caps BOTH ancestor hypotheses and site predictions.
   */
  app.get("/api/hypotheses", async (req: Request, res: Response) => {
    try {
      const [nodes, corridors, knownSites] = await Promise.all([
        loadNodes(),
        loadCorridorsFn(),
        loadKnownSitesFn(),
      ]);

      const opts: HypothesisOptions = {};
      const minMembers = parsePositiveInt(req.query.minMembers);
      if (minMembers !== undefined && minMembers >= 2) opts.minMembers = minMembers;
      const minRarity = parseUnitFloat(req.query.minRarity);
      if (minRarity !== undefined) opts.minRarity = minRarity;
      const minGapKm = parseNonNegFloat(req.query.minGapKm);
      if (minGapKm !== undefined) opts.minGapKm = minGapKm;
      const limit = parsePositiveInt(req.query.limit);
      if (limit !== undefined) {
        opts.maxAncestorHypotheses = limit;
        opts.maxSitePredictions = limit;
      }

      const result = generateHypotheses({ nodes, corridors, knownSites }, opts);
      res.json({
        ...result,
        geojson: sitePredictionsToGeoJSON(result.sitePredictions),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Unexpected error in /api/hypotheses:", error);
      res
        .status(500)
        .json({ error: "hypothesis generation failed", detail: message });
    }
  });
}
