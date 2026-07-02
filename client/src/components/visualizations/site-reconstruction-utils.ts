/**
 * Pure helpers for the 3D reconstruction viewer for archaeological sites.
 *
 * We use a classic painter's-algorithm isometric projection (no three.js
 * dependency) to render simplified architectural massing: a handful of
 * boxes per site chosen from a blueprint template that's driven by the
 * site's declared type and a few keyword hints in its findings.
 */

export type SiteType =
  | "settlement"
  | "burial"
  | "temple"
  | "fortification"
  | "workshop"
  | "ceremonial"
  | "unknown";

export interface SiteStructure {
  /** Stable identifier for React keys */
  id: string;
  /** Descriptive label (e.g., "palace", "wall", "tower", "pyramid") */
  kind: string;
  /** World-space origin (corner with smallest x,y,z) */
  x: number;
  y: number;
  z: number;
  /** World-space size */
  w: number;
  d: number;
  h: number;
  /** Fill color for the top face; sides are derived darker/lighter shades */
  color: string;
}

export interface Point2D {
  sx: number;
  sy: number;
}

export type FaceKey = "top" | "bottom" | "+X" | "-X" | "+Y" | "-Y";

export interface BoxFace {
  /** For React keys */
  id: string;
  /** Which face of the box */
  face: FaceKey;
  /** 4 screen-space polygon corners (CCW) */
  points: Point2D[];
  /** Depth value for painter's-algorithm sort (larger = closer to camera) */
  depth: number;
  /** Base fill color */
  color: string;
  /** Shade modifier ("top" | "left" | "right") used to darken side faces */
  shade: "top" | "left" | "right";
}

const DEG = Math.PI / 180;
const COS30 = Math.cos(30 * DEG);
const SIN30 = Math.sin(30 * DEG);

/**
 * Isometric projection with yaw rotation around the vertical Z axis.
 * Returns SVG-space coordinates (sy points down). Caller adds a center offset.
 */
export function projectIso(
  x: number,
  y: number,
  z: number,
  yawDeg: number,
  unit: number = 1,
): Point2D {
  const theta = yawDeg * DEG;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  const sx = (rx - ry) * COS30 * unit;
  const sy = ((rx + ry) * SIN30 - z) * unit;
  return { sx, sy };
}

/** Returns true if a face is facing the camera at the given yaw. */
export function isFaceVisible(face: FaceKey, yawDeg: number): boolean {
  if (face === "top") return true;
  if (face === "bottom") return false;
  const theta = yawDeg * DEG;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  switch (face) {
    case "+X":
      return c + s > 0;
    case "-X":
      return c + s < 0;
    case "+Y":
      return c - s > 0;
    case "-Y":
      return c - s < 0;
  }
}

const SHADE_BY_FACE: Record<FaceKey, "top" | "left" | "right" | "hidden"> = {
  top: "top",
  bottom: "hidden",
  "+X": "right",
  "-X": "left",
  "+Y": "left",
  "-Y": "right",
};

/**
 * Compute the visible faces of a structure as projected SVG polygons.
 * Returned faces include a depth value for painter's-algorithm sorting.
 */
export function computeBoxFaces(
  s: SiteStructure,
  yawDeg: number,
  unit: number = 1,
): BoxFace[] {
  const x0 = s.x;
  const x1 = s.x + s.w;
  const y0 = s.y;
  const y1 = s.y + s.d;
  const z0 = s.z;
  const z1 = s.z + s.h;

  const faceCorners: Record<FaceKey, [number, number, number][]> = {
    top: [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    bottom: [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    "+X": [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    "-X": [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    "+Y": [
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ],
    "-Y": [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
  };

  const theta = yawDeg * DEG;
  const c = Math.cos(theta);
  const sn = Math.sin(theta);

  const faces: BoxFace[] = [];
  (Object.keys(faceCorners) as FaceKey[]).forEach((face) => {
    if (!isFaceVisible(face, yawDeg)) return;
    const corners = faceCorners[face];
    const points = corners.map(([x, y, z]) => projectIso(x, y, z, yawDeg, unit));

    let depth = 0;
    for (const [x, y, z] of corners) {
      const rx = x * c - y * sn;
      const ry = x * sn + y * c;
      depth += rx + ry + z;
    }
    depth /= corners.length;

    const shade = SHADE_BY_FACE[face];
    if (shade === "hidden") return;
    faces.push({
      id: `${s.id}-${face}`,
      face,
      points,
      depth,
      color: s.color,
      shade,
    });
  });
  return faces;
}

/** Sort faces from farthest to nearest (painter's algorithm). */
export function sortFacesForRender(faces: BoxFace[]): BoxFace[] {
  return [...faces].sort((a, b) => a.depth - b.depth);
}

/** Darken or lighten a hex color by a fractional amount in [-1, 1]. */
export function shadeColor(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const adjust = (v: number) => {
    const target = amount < 0 ? 0 : 255;
    const shifted = Math.round(v + (target - v) * Math.abs(amount));
    return Math.max(0, Math.min(255, shifted));
  };
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

/** Apply face-shade to a base color. Top is full; sides are darker. */
export function faceFillColor(
  baseColor: string,
  shade: "top" | "left" | "right",
): string {
  if (shade === "top") return baseColor;
  if (shade === "right") return shadeColor(baseColor, -0.2);
  return shadeColor(baseColor, -0.35);
}

// ── Blueprint generation ─────────────────────────────────────────────

const SITE_COLORS: Record<SiteType, string> = {
  settlement: "#d4a574",
  burial: "#8b7355",
  temple: "#c8a04a",
  fortification: "#7a8a7a",
  workshop: "#b08856",
  ceremonial: "#a07ab4",
  unknown: "#a0a0a0",
};

export function siteTypeColor(siteType: SiteType): string {
  return SITE_COLORS[siteType] ?? SITE_COLORS.unknown;
}

export function formatSiteType(siteType: SiteType): string {
  return siteType.charAt(0).toUpperCase() + siteType.slice(1);
}

const FINDING_HINTS: Record<string, RegExp> = {
  palace: /palace|royal/i,
  pyramid: /pyramid|ziggurat|step[- ]?temple/i,
  temple: /temple|shrine|altar|sanctuary/i,
  wall: /wall|rampart|fortif/i,
  tower: /tower|bastion|keep/i,
  tomb: /tomb|mausoleum|necropolis/i,
  amphitheater: /amphitheater|theater|arena|colosseum/i,
  aqueduct: /aqueduct|cistern|canal/i,
  bath: /bath/i,
  mound: /mound|tumulus|kurgan/i,
  plaza: /plaza|forum|agora|square/i,
  house: /house|dwelling|residence|home/i,
};

/**
 * Return the set of finding-hint kinds that match any of the given findings.
 * Exposed for unit testing.
 */
export function detectFindingKinds(findings: string[]): string[] {
  const joined = findings.join(" | ");
  return Object.entries(FINDING_HINTS)
    .filter(([, rx]) => rx.test(joined))
    .map(([kind]) => kind);
}

/**
 * Generate a deterministic blueprint (a set of structures) for a site
 * based on its type and findings. Returns a list of structures in world
 * coordinates that together visualize the site.
 */
export function generateBlueprint(
  siteType: SiteType,
  findings: string[],
  importance: number,
): SiteStructure[] {
  const baseColor = siteTypeColor(siteType);
  const hints = detectFindingKinds(findings);
  const hintSet = new Set(hints);
  const scale = 0.7 + Math.min(Math.max(importance, 0), 100) / 100; // 0.7..1.7
  const structures: SiteStructure[] = [];

  const add = (
    id: string,
    kind: string,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: string = baseColor,
  ) => {
    structures.push({
      id,
      kind,
      x,
      y,
      z,
      w: w * scale,
      d: d * scale,
      h: h * scale,
      color,
    });
  };

  switch (siteType) {
    case "temple": {
      // Central cella + two flanking wings, on a stepped platform.
      add("platform", "platform", -3, -3, 0, 6, 6, 0.4, shadeColor(baseColor, -0.1));
      add("cella", "cella", -1, -1.2, 0.4, 2, 2.4, 2.6);
      add("wing-l", "wing", -2.6, -0.6, 0.4, 1.2, 1.6, 1.6);
      add("wing-r", "wing", 1.4, -0.6, 0.4, 1.2, 1.6, 1.6);
      if (hintSet.has("pyramid")) {
        add("ziggurat-top", "tower", -0.4, -0.4, 3, 0.8, 0.8, 1.2, shadeColor(baseColor, 0.1));
      }
      break;
    }
    case "burial": {
      if (hintSet.has("pyramid")) {
        for (let i = 0; i < 4; i++) {
          const size = 4 - i * 0.9;
          const off = -size / 2;
          add(`step-${i}`, "pyramid-step", off, off, i * 0.8, size, size, 0.8);
        }
      } else if (hintSet.has("mound")) {
        add("mound", "mound", -2, -2, 0, 4, 4, 1.4);
        add("cap", "mound-cap", -1, -1, 1.4, 2, 2, 0.6);
      } else {
        add("tomb", "tomb", -1.5, -1.5, 0, 3, 3, 1.8);
        add("marker", "marker", -0.3, -0.3, 1.8, 0.6, 0.6, 0.8, shadeColor(baseColor, 0.1));
      }
      break;
    }
    case "fortification": {
      // Curtain walls around a square with 4 corner towers.
      const half = 3;
      const wall = 0.3;
      const wallColor = shadeColor(baseColor, -0.1);
      const towerColor = shadeColor(baseColor, 0.05);
      add("wall-n", "wall", -half, half - wall, 0, 2 * half, wall, 1.6, wallColor);
      add("wall-s", "wall", -half, -half, 0, 2 * half, wall, 1.6, wallColor);
      add("wall-e", "wall", half - wall, -half + wall, 0, wall, 2 * half - 2 * wall, 1.6, wallColor);
      add("wall-w", "wall", -half, -half + wall, 0, wall, 2 * half - 2 * wall, 1.6, wallColor);
      add("tower-nw", "tower", -half - 0.2, half - 0.6, 0, 0.8, 0.8, 2.4, towerColor);
      add("tower-ne", "tower", half - 0.6, half - 0.6, 0, 0.8, 0.8, 2.4, towerColor);
      add("tower-sw", "tower", -half - 0.2, -half - 0.2, 0, 0.8, 0.8, 2.4, towerColor);
      add("tower-se", "tower", half - 0.6, -half - 0.2, 0, 0.8, 0.8, 2.4, towerColor);
      if (hintSet.has("palace")) {
        add("keep", "keep", -1, -1, 0, 2, 2, 2.2, shadeColor(baseColor, 0.1));
      }
      break;
    }
    case "workshop": {
      add("hall", "workshop-hall", -2, -1, 0, 4, 2, 1.4);
      add("kiln-1", "kiln", -1.6, 1.2, 0, 0.8, 0.8, 1, shadeColor(baseColor, -0.1));
      add("kiln-2", "kiln", 0.8, 1.2, 0, 0.8, 0.8, 1, shadeColor(baseColor, -0.1));
      break;
    }
    case "ceremonial": {
      // Central tall feature + ring of low markers.
      add("central", "pillar", -0.6, -0.6, 0, 1.2, 1.2, 3.2);
      const ring = 2.4;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * ring - 0.25;
        const y = Math.sin(a) * ring - 0.25;
        add(`marker-${i}`, "marker", x, y, 0, 0.5, 0.5, 1.2, shadeColor(baseColor, -0.1));
      }
      break;
    }
    case "settlement": {
      // Grid of small rectangular houses on a ground pad. Skip center for a plaza.
      add("ground", "ground", -3.2, -3.2, 0, 6.4, 6.4, 0.1, shadeColor(baseColor, -0.2));
      const cells: Array<[number, number]> = [];
      for (let ix = -2; ix <= 2; ix++) {
        for (let iy = -2; iy <= 2; iy++) {
          if (ix === 0 && iy === 0) continue;
          cells.push([ix, iy]);
        }
      }
      // Deterministic pseudo-variation: height by (ix+iy) parity
      cells.forEach(([ix, iy], idx) => {
        const h = (Math.abs(ix) + Math.abs(iy)) % 2 === 0 ? 1 : 1.5;
        add(`house-${idx}`, "house", ix - 0.4, iy - 0.4, 0.1, 0.8, 0.8, h);
      });
      if (hintSet.has("palace")) {
        add("palace", "palace", -0.8, -0.8, 0.1, 1.6, 1.6, 2.4, shadeColor(baseColor, 0.1));
      }
      break;
    }
    case "unknown":
    default: {
      add("block", "block", -1, -1, 0, 2, 2, 1.4);
      break;
    }
  }

  // Extra hint-driven flourishes that apply across types:
  if (hintSet.has("wall") && siteType !== "fortification") {
    add("fence-s", "wall", -3.2, -3.2, 0, 6.4, 0.15, 0.6, shadeColor(baseColor, -0.2));
  }
  if (hintSet.has("amphitheater")) {
    add("arena-1", "amphitheater", 3.4, -1, 0, 1.8, 2, 0.8, shadeColor(baseColor, -0.05));
    add("arena-2", "amphitheater", 3.6, -0.6, 0.8, 1.4, 1.2, 0.4, shadeColor(baseColor, 0.05));
  }

  return structures;
}

/**
 * Compute a uniform display scale so the blueprint fits inside a target
 * viewport. Returns the fit-unit and the projected bounding box.
 */
export function computeSceneBounds(
  structures: SiteStructure[],
  yawDeg: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (structures.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of structures) {
    const corners: [number, number, number][] = [
      [s.x, s.y, s.z],
      [s.x + s.w, s.y, s.z],
      [s.x, s.y + s.d, s.z],
      [s.x + s.w, s.y + s.d, s.z],
      [s.x, s.y, s.z + s.h],
      [s.x + s.w, s.y, s.z + s.h],
      [s.x, s.y + s.d, s.z + s.h],
      [s.x + s.w, s.y + s.d, s.z + s.h],
    ];
    for (const [x, y, z] of corners) {
      const p = projectIso(x, y, z, yawDeg, 1);
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
    }
  }
  return { minX, maxX, minY, maxY };
}

export function pointsToSvg(points: Point2D[]): string {
  return points.map((p) => `${p.sx.toFixed(2)},${p.sy.toFixed(2)}`).join(" ");
}

export function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function formatPeriod(start: number, end: number | null): string {
  const endStr = end == null ? "present" : formatYear(end);
  return `${formatYear(start)} – ${endStr}`;
}
