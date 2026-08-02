/**
 * Pure helpers for rendering US-007 undiscovered-site-region predictions as map
 * overlays *with uncertainty*.
 *
 * Each prediction is a center + an `uncertaintyRadiusKm`; on the map it becomes a
 * translucent circle whose RADIUS is the uncertainty region and whose STYLING
 * (fill opacity, stroke, dashing) encodes how confident the prediction is — a
 * low-confidence lead is drawn fainter and dashed so it clearly reads as a guess.
 *
 * Kept free of React/Leaflet imports so it is unit-testable in the node test env
 * (the repo has no jsdom); the `.tsx` page consumes these specs and hands them to
 * react-leaflet `<Circle>` elements.
 */

/** Minimal shape of a site prediction returned by `GET /api/hypotheses`. */
export interface SitePrediction {
  id: string;
  center: { lat: number; lng: number };
  uncertaintyRadiusKm: number;
  confidence: number;
  nearestKnownKm: number;
  basedOn: { corridorId: string; corridorName: string };
  rationale: string;
}

export type ConfidenceTier = "low" | "medium" | "high";

/** A ready-to-render Leaflet circle overlay spec. */
export interface UncertaintyCircle {
  id: string;
  /** Leaflet order is [lat, lng]. */
  center: [number, number];
  /** Circle radius in METERS (Leaflet `<Circle radius>` unit). */
  radiusMeters: number;
  /** Stroke + fill color, by confidence tier. */
  color: string;
  /** Fill opacity — higher confidence ⇒ more solid. */
  fillOpacity: number;
  /** Stroke weight. */
  weight: number;
  /** Dashed stroke marks a low-confidence (more uncertain) region. */
  dashed: boolean;
  tier: ConfidenceTier;
  confidence: number;
  uncertaintyRadiusKm: number;
  corridorName: string;
  rationale: string;
}

const TIER_COLORS: Record<ConfidenceTier, string> = {
  high: "#7c3aed", // violet-600 — a stronger lead
  medium: "#a855f7", // purple-500
  low: "#c4b5fd", // violet-300 — a faint guess
};

/** Bucket a 0..1 confidence into a display tier. */
export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.6) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Build one circle overlay spec from a prediction. */
export function toUncertaintyCircle(p: SitePrediction): UncertaintyCircle {
  const tier = confidenceTier(p.confidence);
  return {
    id: p.id,
    center: [p.center.lat, p.center.lng],
    radiusMeters: Math.max(0, p.uncertaintyRadiusKm) * 1000,
    color: TIER_COLORS[tier],
    // Map confidence (0..~0.85) onto a readable 0.08..0.3 fill range.
    fillOpacity: clamp(0.08 + p.confidence * 0.3, 0.08, 0.32),
    weight: tier === "high" ? 2 : 1,
    dashed: tier === "low",
    tier,
    confidence: p.confidence,
    uncertaintyRadiusKm: p.uncertaintyRadiusKm,
    corridorName: p.basedOn.corridorName,
    rationale: p.rationale,
  };
}

/**
 * Build overlay specs for a list of predictions, drawn largest-uncertainty-first
 * so smaller, more precise circles paint on TOP and stay clickable.
 */
export function buildUncertaintyCircles(
  predictions: SitePrediction[],
): UncertaintyCircle[] {
  return predictions
    .map(toUncertaintyCircle)
    .sort((a, b) => b.radiusMeters - a.radiusMeters);
}

/** A rough [lat, lng] center for the map view = mean of prediction centers. */
export function overlayCenter(
  predictions: SitePrediction[],
  fallback: [number, number] = [20, 20],
): [number, number] {
  if (predictions.length === 0) return fallback;
  let lat = 0;
  let lng = 0;
  for (const p of predictions) {
    lat += p.center.lat;
    lng += p.center.lng;
  }
  return [lat / predictions.length, lng / predictions.length];
}
