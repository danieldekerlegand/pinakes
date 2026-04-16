export interface CityLayoutData {
  id: string;
  settlementName?: string;
  settlementId?: string;
  cultureProfileId?: string;
  layoutType: string;
  keyFeatures: string[];
  streetPattern?: string;
  waterManagement?: string;
  fortificationType?: string;
  estimatedAreaHectares?: number;
  description?: string;
  reconstructionNotes?: string;
  timePeriodLabel?: string;
  timePeriodStart?: number;
  timePeriodEnd?: number;
}

export interface ZoneShape {
  id: string;
  feature: string;
  label: string;
  shape: "rect" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface SchematicDecoration {
  type: "canal" | "aqueduct" | "road";
  points: string;
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
}

export interface SchematicGateMarker {
  x: number;
  y: number;
}

export interface SchematicBoundary {
  shape: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface SchematicGeometry {
  viewBoxWidth: number;
  viewBoxHeight: number;
  boundary?: SchematicBoundary;
  gates?: SchematicGateMarker[];
  decorations: SchematicDecoration[];
  zones: ZoneShape[];
}

export const FEATURE_COLORS: Record<string, string> = {
  temple_precinct: "#b45309",
  palace: "#7c3aed",
  market: "#059669",
  agora: "#0d9488",
  forum: "#15803d",
  granary: "#ca8a04",
  bathhouse: "#0ea5e9",
  amphitheater: "#dc2626",
  walls: "#44403c",
  gates: "#78716c",
  aqueduct: "#38bdf8",
  sewers: "#64748b",
  harbor: "#0284c7",
  necropolis: "#3f3f46",
  residential_quarter: "#fbbf24",
  industrial_quarter: "#c2410c",
  garden: "#16a34a",
  tower: "#525252",
};

export const FEATURE_DESCRIPTIONS: Record<string, string> = {
  temple_precinct:
    "Sacred precinct with temples, shrines, and priestly quarters. The ritual and religious heart of the city.",
  palace:
    "Royal or administrative palace complex housing the ruler, court, and state officials.",
  market:
    "Commercial hub where merchants, craftspeople, and residents traded goods.",
  agora:
    "Central public square for civic assembly, political debate, and commerce.",
  forum:
    "Civic center combining political, legal, religious, and commercial functions.",
  granary:
    "Large-scale grain storage ensuring food security against drought and siege.",
  bathhouse:
    "Public bathing complex with hot and cold rooms, often a social center.",
  amphitheater:
    "Venue for games, theatrical performances, and public spectacles.",
  walls:
    "Defensive fortifications enclosing the urban core against raiders and invaders.",
  gates:
    "Monumental entrances controlling and channeling access through the city walls.",
  aqueduct:
    "Infrastructure conveying fresh water from distant sources into the city.",
  sewers:
    "Underground drainage system removing waste, runoff, and stormwater.",
  harbor:
    "Port facilities supporting maritime or riverine trade and naval vessels.",
  necropolis:
    "Cemetery and funerary complex, traditionally sited outside the city walls.",
  residential_quarter:
    "Residential neighborhoods where the urban population lived and worked.",
  industrial_quarter:
    "Workshops, kilns, tanneries, and production facilities for crafted goods.",
  garden:
    "Cultivated gardens, orchards, or pleasure parks providing food and respite.",
  tower:
    "Defensive or ceremonial tower, often serving as a landmark or watchpoint.",
};

export const LAYOUT_TYPE_DESCRIPTIONS: Record<string, string> = {
  grid: "Orthogonal grid plan with regular rectangular blocks and straight streets.",
  organic: "Irregular organic street pattern shaped by terrain and incremental growth.",
  radial: "Radial plan with streets and zones radiating from a central focus.",
  linear: "Linear plan extended along a single primary axis.",
  citadel: "Citadel-based plan centered on an elevated fortified core.",
  terraced: "Terraced plan built on stepped platforms at different elevations.",
  "canal-based": "Canal-based plan organized around intersecting waterways.",
  fortified: "Fortified plan emphasizing defensive walls, towers, and strongpoints.",
};

const FEATURE_PRIORITY: Record<string, number> = {
  temple_precinct: 1,
  palace: 1,
  forum: 2,
  agora: 2,
  market: 2,
  bathhouse: 3,
  amphitheater: 3,
  granary: 3,
  garden: 4,
  residential_quarter: 4,
  industrial_quarter: 5,
  harbor: 5,
  tower: 6,
  necropolis: 6,
};

export function getFeatureColor(feature: string): string {
  return FEATURE_COLORS[feature] || "#94a3b8";
}

export function getFeatureDescription(feature: string): string {
  return (
    FEATURE_DESCRIPTIONS[feature] ||
    "Urban feature of the city, playing a role in daily life or civic function."
  );
}

export function formatFeatureLabel(feature: string): string {
  return feature
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getLayoutDescription(layoutType: string): string {
  return (
    LAYOUT_TYPE_DESCRIPTIONS[layoutType.toLowerCase()] ||
    "Urban plan with a distinctive spatial organization."
  );
}

function featurePriority(feature: string): number {
  return FEATURE_PRIORITY[feature] ?? 7;
}

function sortByPriority(features: string[]): string[] {
  return [...features].sort((a, b) => featurePriority(a) - featurePriority(b));
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const VIEWBOX_WIDTH = 800;
const VIEWBOX_HEIGHT = 600;
const MARGIN = 40;
const NON_ZONE_FEATURES = new Set(["walls", "gates", "aqueduct", "sewers"]);

function makeZone(
  feature: string,
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
  shape: "rect" | "ellipse" = "rect",
): ZoneShape {
  return {
    id: `zone-${feature}-${index}`,
    feature,
    label: formatFeatureLabel(feature),
    shape,
    x,
    y,
    width,
    height,
    color: getFeatureColor(feature),
  };
}

function placeGrid(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(features.length))));
  const rows = Math.ceil(features.length / cols);
  const cellW = bw / cols;
  const cellH = bh / rows;
  const pad = Math.min(cellW, cellH) * 0.1;
  return features.map((feat, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return makeZone(
      feat,
      i,
      bx + col * cellW + pad,
      by + row * cellH + pad,
      cellW - 2 * pad,
      cellH - 2 * pad,
    );
  });
}

function placeRadial(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const maxR = Math.min(bw, bh) / 2;
  const zones: ZoneShape[] = [];
  const centerSize = maxR * 0.3;
  zones.push(
    makeZone(
      features[0],
      0,
      cx - centerSize,
      cy - centerSize,
      centerSize * 2,
      centerSize * 2,
      "ellipse",
    ),
  );
  const rest = features.slice(1);
  const ringSize = maxR * 0.2;
  rest.forEach((feat, i) => {
    const ring = Math.floor(i / 6);
    const slot = i % 6;
    const angle = (slot * 2 * Math.PI) / 6 - Math.PI / 2;
    const r = maxR * (0.55 + 0.22 * ring);
    const zx = cx + Math.cos(angle) * r - ringSize;
    const zy = cy + Math.sin(angle) * r - ringSize;
    zones.push(
      makeZone(feat, i + 1, zx, zy, ringSize * 2, ringSize * 2, "rect"),
    );
  });
  return zones;
}

function placeCitadel(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const citSize = Math.min(bw, bh) * 0.4;
  const zones: ZoneShape[] = [];
  zones.push(
    makeZone(features[0], 0, cx - citSize / 2, cy - citSize / 2, citSize, citSize),
  );
  const rest = features.slice(1);
  const positions = [
    { x: 0.18, y: 0.18 },
    { x: 0.82, y: 0.18 },
    { x: 0.18, y: 0.82 },
    { x: 0.82, y: 0.82 },
    { x: 0.18, y: 0.5 },
    { x: 0.82, y: 0.5 },
    { x: 0.5, y: 0.18 },
    { x: 0.5, y: 0.82 },
  ];
  const size = Math.min(bw, bh) * 0.18;
  rest.forEach((feat, i) => {
    const pos = positions[i % positions.length];
    zones.push(
      makeZone(
        feat,
        i + 1,
        bx + pos.x * bw - size / 2,
        by + pos.y * bh - size / 2,
        size,
        size,
      ),
    );
  });
  return zones;
}

function placeTerraced(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const tiers = features.length;
  const tierH = bh / tiers;
  return features.map((feat, i) => {
    const inset = (i / Math.max(tiers, 1)) * 0.3 * bw;
    return makeZone(
      feat,
      i,
      bx + inset / 2,
      by + i * tierH + tierH * 0.1,
      bw - inset,
      tierH * 0.8,
    );
  });
}

function placeLinear(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const segW = bw / features.length;
  const pad = Math.min(segW, bh) * 0.08;
  return features.map((feat, i) =>
    makeZone(
      feat,
      i,
      bx + i * segW + pad,
      by + bh * 0.25,
      segW - 2 * pad,
      bh * 0.5,
    ),
  );
}

function placeQuadrants(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const halfW = bw / 2;
  const halfH = bh / 2;
  const pad = 16;
  const quadrants = [
    { x: bx + pad, y: by + pad },
    { x: bx + halfW + pad, y: by + pad },
    { x: bx + pad, y: by + halfH + pad },
    { x: bx + halfW + pad, y: by + halfH + pad },
  ];
  const slotSize = (halfW - pad * 3) / 2;
  return features.map((feat, i) => {
    const q = quadrants[i % quadrants.length];
    const slot = Math.floor(i / quadrants.length);
    const slotCol = slot % 2;
    const slotRow = Math.floor(slot / 2);
    return makeZone(
      feat,
      i,
      q.x + slotCol * (slotSize + pad),
      q.y + slotRow * (slotSize + pad),
      slotSize,
      slotSize,
    );
  });
}

function placeOrganic(
  features: string[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
): ZoneShape[] {
  if (features.length === 0) return [];
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  return features.map((feat, i) => {
    const seed = hashString(feat);
    const angle = (((seed + i * 137) % 360) * Math.PI) / 180;
    const dist = ((seed + i * 53) % 100) / 100;
    const size = Math.min(bw, bh) * (featurePriority(feat) === 1 ? 0.2 : 0.14);
    const zx = cx + Math.cos(angle) * (bw / 2) * dist * 0.65 - size / 2;
    const zy = cy + Math.sin(angle) * (bh / 2) * dist * 0.65 - size / 2;
    const clampedX = Math.max(bx, Math.min(bx + bw - size, zx));
    const clampedY = Math.max(by, Math.min(by + bh - size, zy));
    return makeZone(
      feat,
      i,
      clampedX,
      clampedY,
      size,
      size,
      i % 3 === 0 ? "ellipse" : "rect",
    );
  });
}

export function computeSchematic(layout: CityLayoutData): SchematicGeometry {
  const allFeatures = layout.keyFeatures.filter(Boolean);
  const hasWalls = allFeatures.includes("walls");
  const hasGates = allFeatures.includes("gates");
  const hasAqueduct = allFeatures.includes("aqueduct");
  const zoneFeatures = sortByPriority(
    allFeatures.filter((f) => !NON_ZONE_FEATURES.has(f)),
  );

  const bx = MARGIN;
  const by = MARGIN;
  const bw = VIEWBOX_WIDTH - 2 * MARGIN;
  const bh = VIEWBOX_HEIGHT - 2 * MARGIN;

  const layoutType = layout.layoutType.toLowerCase();
  let zones: ZoneShape[];
  switch (layoutType) {
    case "grid":
    case "fortified":
      zones = placeGrid(zoneFeatures, bx, by, bw, bh);
      break;
    case "radial":
      zones = placeRadial(zoneFeatures, bx, by, bw, bh);
      break;
    case "citadel":
      zones = placeCitadel(zoneFeatures, bx, by, bw, bh);
      break;
    case "terraced":
      zones = placeTerraced(zoneFeatures, bx, by, bw, bh);
      break;
    case "linear":
      zones = placeLinear(zoneFeatures, bx, by, bw, bh);
      break;
    case "canal-based":
      zones = placeQuadrants(zoneFeatures, bx, by, bw, bh);
      break;
    default:
      zones = placeOrganic(zoneFeatures, bx, by, bw, bh);
  }

  const boundary: SchematicBoundary | undefined = hasWalls
    ? {
        shape: "rect",
        x: bx,
        y: by,
        width: bw,
        height: bh,
        label: layout.fortificationType || "City Walls",
      }
    : undefined;

  const gates: SchematicGateMarker[] | undefined = hasGates
    ? [
        { x: bx + bw / 2, y: by },
        { x: bx + bw / 2, y: by + bh },
        { x: bx, y: by + bh / 2 },
        { x: bx + bw, y: by + bh / 2 },
      ]
    : undefined;

  const decorations: SchematicDecoration[] = [];
  if (layoutType === "canal-based") {
    decorations.push({
      type: "canal",
      points: `M ${bx},${by + bh / 2} L ${bx + bw},${by + bh / 2}`,
      stroke: "#38bdf8",
      strokeWidth: 8,
    });
    decorations.push({
      type: "canal",
      points: `M ${bx + bw / 2},${by} L ${bx + bw / 2},${by + bh}`,
      stroke: "#38bdf8",
      strokeWidth: 8,
    });
  }
  if (hasAqueduct) {
    decorations.push({
      type: "aqueduct",
      points: `M ${bx - MARGIN / 2},${by + bh * 0.18} L ${bx + bw},${by + bh * 0.18}`,
      stroke: "#38bdf8",
      strokeWidth: 3,
      dashArray: "10,5",
    });
  }

  return {
    viewBoxWidth: VIEWBOX_WIDTH,
    viewBoxHeight: VIEWBOX_HEIGHT,
    boundary,
    gates,
    decorations,
    zones,
  };
}
