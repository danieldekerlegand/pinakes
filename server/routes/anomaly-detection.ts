/**
 * Anomaly-detection routes (US-006).
 *
 * `GET /api/anomalies` scans the cross-domain corpus for *statistically
 * unexpected* similarities between distant, unrelated cultures — a rare shared
 * musical scale, pottery style, or art motif turning up on opposite sides of the
 * world — and returns them ranked by surprise, each framed as a hypothesis with
 * its supporting evidence + provenance.
 *
 * The scoring lives in the pure `services/anomaly-detection.ts`; this module owns
 * only the storage → `CultureNode` projection + the HTTP wiring. The node loader
 * is **injectable** so route tests run with in-memory fakes (no storage/fs).
 */
import { type Express, type Request, type Response } from "express";

import { storage } from "../storage";
import {
  detectAnomalies,
  type CultureNode,
  type NodeFeature,
  type AnomalyOptions,
} from "../services/anomaly-detection";

export type AnomalyNodeLoader = () => Promise<CultureNode[]>;

/** Normalize a free-text trait value into a stable, case-insensitive match key. */
function normKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function traitFeatures(
  type: string,
  values: string[] | undefined,
): NodeFeature[] {
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
 * Default loader: project the feature-bearing storage domains that carry both
 * coordinates and distinctive trait arrays into `CultureNode`s.
 *
 * - **music-tradition** → scales / rhythmic patterns / instruments
 * - **art-tradition** → key features + category
 * - **material-culture** → category (pottery, metallurgy, …)
 *
 * `groupIds` = associated language ids (the "expected similarity" grouping), so
 * two traditions in the same language community are never flagged as anomalies.
 */
async function loadAnomalyNodes(): Promise<CultureNode[]> {
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

export interface AnomalyRouteOptions {
  /** Override the node loader (tests pass an in-memory fake). */
  loadNodes?: AnomalyNodeLoader;
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

export function registerAnomalyRoutes(
  app: Express,
  options: AnomalyRouteOptions = {},
): void {
  const loadNodes = options.loadNodes ?? loadAnomalyNodes;

  /**
   * GET /api/anomalies?domains=&minSurprise=&limit=
   *   - `domains` (comma-separated) filters which node domains are scanned.
   *   - `minSurprise` (0..1) raises the reporting threshold.
   *   - `limit` caps the number of anomalies returned.
   */
  app.get("/api/anomalies", async (req: Request, res: Response) => {
    try {
      let nodes = await loadNodes();

      const domainsParam = req.query.domains;
      if (typeof domainsParam === "string" && domainsParam.trim()) {
        const wanted = new Set(
          domainsParam
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
        );
        nodes = nodes.filter((n) => wanted.has(n.domain));
      }

      const opts: AnomalyOptions = {};
      const minSurprise = parseUnitFloat(req.query.minSurprise);
      if (minSurprise !== undefined) opts.minSurprise = minSurprise;
      const limit = parsePositiveInt(req.query.limit);
      if (limit !== undefined) opts.limit = limit;

      const result = detectAnomalies(nodes, opts);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Unexpected error in /api/anomalies:", error);
      res.status(500).json({ error: "anomaly detection failed", detail: message });
    }
  });
}
