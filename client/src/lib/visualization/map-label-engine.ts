/**
 * Map label engine: collision detection, priority ranking, zoom-level
 * filtering, font sizing, and curved-path generation for region labels.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LabelType = 'region' | 'settlement' | 'route';

export type SettlementRank = 'capital' | 'major' | 'minor';

export interface MapLabel {
  id: string;
  text: string;
  type: LabelType;
  lat: number;
  lng: number;
  priority: number; // higher = more important, rendered first
  minZoom: number; // minimum zoom level at which to show
  maxZoom?: number; // optional upper bound
  /** For region labels: ordered [lng, lat] points defining the curve */
  curvePath?: [number, number][];
  /** Settlement rank for priority derivation */
  settlementRank?: SettlementRank;
  /** Source layer id this label belongs to */
  layerId: string;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibleLabel extends MapLabel {
  screenX: number;
  screenY: number;
  fontSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Priority weights by label type */
export const LABEL_PRIORITY: Record<LabelType, number> = {
  region: 50,
  settlement: 70,
  route: 30,
};

/** Extra priority boost by settlement rank */
export const SETTLEMENT_RANK_BOOST: Record<SettlementRank, number> = {
  capital: 30,
  major: 15,
  minor: 0,
};

/** Zoom thresholds: labels appear at these zoom levels and above */
export const ZOOM_THRESHOLDS: Record<LabelType, number> = {
  region: 3,
  settlement: 5,
  route: 4,
};

/** Settlement rank zoom thresholds */
export const SETTLEMENT_ZOOM: Record<SettlementRank, number> = {
  capital: 4,
  major: 6,
  minor: 8,
};

/** Base font sizes per type (at zoom = reference zoom) */
const BASE_FONT_SIZE: Record<LabelType, number> = {
  region: 14,
  settlement: 12,
  route: 11,
};

const REFERENCE_ZOOM = 5;
const FONT_SCALE_FACTOR = 0.15; // how much font grows per zoom level
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

// Collision detection padding in screen pixels
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * Compute a label's priority from its type and optional attributes.
 * Higher values = higher priority = rendered first and survives collision.
 */
export function computePriority(
  type: LabelType,
  rank?: SettlementRank,
  importance?: number,
): number {
  let p = LABEL_PRIORITY[type];
  if (rank) p += SETTLEMENT_RANK_BOOST[rank];
  if (importance != null) p += importance * 0.2; // importance is 1–100
  return p;
}

// ---------------------------------------------------------------------------
// Zoom-dependent visibility
// ---------------------------------------------------------------------------

export function isVisibleAtZoom(label: MapLabel, zoom: number): boolean {
  if (zoom < label.minZoom) return false;
  if (label.maxZoom != null && zoom > label.maxZoom) return false;
  return true;
}

/**
 * Return the minimum zoom for a label based on its type and rank.
 */
export function minZoomForLabel(type: LabelType, rank?: SettlementRank): number {
  if (type === 'settlement' && rank) {
    return SETTLEMENT_ZOOM[rank];
  }
  return ZOOM_THRESHOLDS[type];
}

// ---------------------------------------------------------------------------
// Font scaling
// ---------------------------------------------------------------------------

export function fontSizeAtZoom(type: LabelType, zoom: number): number {
  const base = BASE_FONT_SIZE[type];
  const scaled = base + (zoom - REFERENCE_ZOOM) * FONT_SCALE_FACTOR * base;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(scaled)));
}

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

function labelBounds(label: VisibleLabel): ScreenRect {
  // Approximate text width: fontSize * 0.6 per character
  const charWidth = label.fontSize * 0.6;
  const width = label.text.length * charWidth + LABEL_PADDING_X * 2;
  const height = label.fontSize + LABEL_PADDING_Y * 2;
  return {
    x: label.screenX - width / 2,
    y: label.screenY - height / 2,
    width,
    height,
  };
}

function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Given a list of candidate labels (already sorted by priority descending),
 * greedily select non-overlapping labels.
 */
export function resolveCollisions(labels: VisibleLabel[]): VisibleLabel[] {
  const placed: { label: VisibleLabel; rect: ScreenRect }[] = [];

  for (const label of labels) {
    const rect = labelBounds(label);
    const overlaps = placed.some((p) => rectsOverlap(rect, p.rect));
    if (!overlaps) {
      placed.push({ label, rect });
    }
  }

  return placed.map((p) => p.label);
}

// ---------------------------------------------------------------------------
// Curved path generation for region labels
// ---------------------------------------------------------------------------

/**
 * Given the exterior ring of a polygon (in [lng, lat] form),
 * produce a smooth arc through the centroid that follows the
 * general orientation of the region for use as a text path.
 *
 * Returns an SVG path `d` attribute string.
 */
export function curvedPathForRegion(ring: [number, number][]): string {
  if (ring.length < 3) return '';

  // Compute centroid
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;

  // Find the principal axis by computing the point furthest from centroid
  let maxDist = 0;
  let farIdx = 0;
  for (let i = 0; i < ring.length; i++) {
    const dx = ring[i][0] - cx;
    const dy = ring[i][1] - cy;
    const d = dx * dx + dy * dy;
    if (d > maxDist) {
      maxDist = d;
      farIdx = i;
    }
  }

  const halfLen = Math.sqrt(maxDist) * 0.6;
  const angle = Math.atan2(ring[farIdx][1] - cy, ring[farIdx][0] - cx);

  // Build a 3-point quadratic curve along the principal axis
  const x1 = cx - halfLen * Math.cos(angle);
  const y1 = cy - halfLen * Math.sin(angle);
  const x2 = cx + halfLen * Math.cos(angle);
  const y2 = cy + halfLen * Math.sin(angle);

  // Slight perpendicular offset for curvature
  const perpX = -Math.sin(angle) * halfLen * 0.15;
  const perpY = Math.cos(angle) * halfLen * 0.15;

  // Ensure left-to-right text direction
  if (x1 > x2) {
    return `M ${x2} ${y2} Q ${cx + perpX} ${cy + perpY} ${x1} ${y1}`;
  }
  return `M ${x1} ${y1} Q ${cx + perpX} ${cy + perpY} ${x2} ${y2}`;
}

/**
 * Compute the centroid of a polygon ring ([lng, lat] pairs).
 */
export function polygonCentroid(ring: [number, number][]): [number, number] {
  if (ring.length === 0) return [0, 0];
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return [cx, cy];
}

// ---------------------------------------------------------------------------
// Pipeline: full label placement pass
// ---------------------------------------------------------------------------

export interface LatLngToScreen {
  (lat: number, lng: number): { x: number; y: number } | null;
}

/**
 * Run the full label placement pipeline:
 * 1. Filter by zoom
 * 2. Filter by enabled label layers
 * 3. Project to screen coordinates
 * 4. Compute font sizes
 * 5. Sort by priority descending
 * 6. Resolve collisions
 */
export function placeLabels(
  labels: MapLabel[],
  zoom: number,
  enabledLabelLayers: Set<string>,
  project: LatLngToScreen,
): VisibleLabel[] {
  // Step 1 & 2: filter
  const candidates = labels.filter(
    (l) => isVisibleAtZoom(l, zoom) && enabledLabelLayers.has(l.layerId),
  );

  // Step 3 & 4: project + font size
  const projected: VisibleLabel[] = [];
  for (const label of candidates) {
    const pt = project(label.lat, label.lng);
    if (!pt) continue;
    projected.push({
      ...label,
      screenX: pt.x,
      screenY: pt.y,
      fontSize: fontSizeAtZoom(label.type, zoom),
    });
  }

  // Step 5: sort by priority descending
  projected.sort((a, b) => b.priority - a.priority);

  // Step 6: collision resolution
  return resolveCollisions(projected);
}
