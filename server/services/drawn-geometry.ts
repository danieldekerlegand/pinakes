/**
 * Drawn-geometry authoring service (US-001).
 *
 * Pure helpers that turn a geometry drawn on the map (a GeoJSON Polygon or
 * LineString) into a reviewable contribution. Nothing here touches fs / express
 * / the source-of-truth TSVs — the drawn shape lands in the *contribution queue*
 * (via `ContributionService.submit`) with `provenance source = 'user-drawn'`, so
 * a human reviewer promotes it into `data/source/lexicons/*.tsv` later (US-009).
 *
 * The geometry is stored in the same shape the geometry TSVs use: GeoJSON with
 * standard `[lng, lat]` coordinate order (see `data/source/lexicons/civilization-boundaries
 * .tsv`, `migration-routes.tsv`). `serializeGeometry` produces exactly the JSON
 * string that would sit in a TSV `geometry`/`waypoints` cell.
 */

import type { ContributionEntityType, ContributionSource, Contribution } from "./contribution-service";

// ============================================================================
// Types
// ============================================================================

/** GeoJSON position — `[longitude, latitude]` (optional elevation ignored). */
export type Position = [number, number] | [number, number, number];

export interface DrawnPolygon {
  type: "Polygon";
  /** One or more linear rings; each ring is a closed list of positions. */
  coordinates: Position[][];
}

export interface DrawnLineString {
  type: "LineString";
  coordinates: Position[];
}

export type DrawnGeometry = DrawnPolygon | DrawnLineString;

/**
 * Where a drawn shape is destined once a reviewer promotes it. Polygon targets
 * describe an area; line targets describe a path. This maps 1:1 onto the
 * geometry-bearing TSVs and onto `ContributionEntityType`.
 */
export type DrawnGeometryTarget =
  | "boundary" // civilization-boundaries.tsv (Polygon)
  | "language-range" // language-range-polygons.tsv (Polygon)
  | "trade-route" // trade-routes.tsv (LineString)
  | "migration-route"; // migration-routes.tsv (LineString)

const POLYGON_TARGETS: DrawnGeometryTarget[] = ["boundary", "language-range"];
const LINE_TARGETS: DrawnGeometryTarget[] = ["trade-route", "migration-route"];

export const DRAWN_GEOMETRY_TARGETS: DrawnGeometryTarget[] = [
  ...POLYGON_TARGETS,
  ...LINE_TARGETS,
];

export interface DrawnGeometryInput {
  geometry: DrawnGeometry;
  target: DrawnGeometryTarget;
  /** Human-readable label for the drawn feature. */
  name: string;
  /** The existing entity this geometry is associated with (required). */
  associatedEntityId: string;
  /** Start year (negative = BCE). Required — a geometry must be time-anchored. */
  timePeriodStart: number;
  /** End year; if omitted the feature is treated as a point-in-time at start. */
  timePeriodEnd?: number | null;
  timePeriodLabel?: string;
  /** 1–100. Defaults to 60 for hand-drawn geometry. */
  confidence?: number;
  sources?: ContributionSource[];
  description?: string;
  notes?: string;
  contributorName?: string;
  contributorEmail?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Marks the provenance of a drawn contribution's `entityData.source`. */
export const DRAWN_PROVENANCE = "user-drawn" as const;

// ============================================================================
// Geometry validation
// ============================================================================

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** A single `[lng, lat]` position with in-bounds coordinates. */
function isValidPosition(pos: unknown): pos is Position {
  return (
    Array.isArray(pos) &&
    pos.length >= 2 &&
    isFiniteNumber(pos[0]) &&
    isFiniteNumber(pos[1]) &&
    pos[0] >= -180 &&
    pos[0] <= 180 &&
    pos[1] >= -90 &&
    pos[1] <= 90
  );
}

function positionsEqual(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Validate the structural GeoJSON of a drawn geometry. Rules:
 * - Polygon: ≥1 ring, each ring ≥4 positions and closed (first === last).
 * - LineString: ≥2 positions.
 * - Every position must be a finite `[lng, lat]` within world bounds.
 */
export function validateGeometry(geometry: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!geometry || typeof geometry !== "object") {
    return { valid: false, errors: ["geometry is required and must be an object"], warnings };
  }

  const geom = geometry as { type?: unknown; coordinates?: unknown };

  if (geom.type === "Polygon") {
    const rings = geom.coordinates;
    if (!Array.isArray(rings) || rings.length === 0) {
      errors.push("Polygon geometry must have at least one linear ring");
    } else {
      rings.forEach((ring, ri) => {
        if (!Array.isArray(ring) || ring.length < 4) {
          errors.push(`Polygon ring ${ri} must have at least 4 positions (a closed triangle)`);
          return;
        }
        ring.forEach((pos, pi) => {
          if (!isValidPosition(pos)) {
            errors.push(`Polygon ring ${ri} position ${pi} is not a valid [lng, lat] within world bounds`);
          }
        });
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (isValidPosition(first) && isValidPosition(last) && !positionsEqual(first, last)) {
          errors.push(`Polygon ring ${ri} is not closed (first and last positions must match)`);
        }
      });
    }
  } else if (geom.type === "LineString") {
    const coords = geom.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      errors.push("LineString geometry must have at least 2 positions");
    } else {
      coords.forEach((pos, pi) => {
        if (!isValidPosition(pos)) {
          errors.push(`LineString position ${pi} is not a valid [lng, lat] within world bounds`);
        }
      });
    }
  } else {
    errors.push(`Unsupported geometry type: ${String(geom.type)} (expected Polygon or LineString)`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Canonical serialization of a drawn geometry — the exact JSON string that would
 * live in a geometry-bearing TSV cell. Coordinates keep `[lng, lat]` order.
 */
export function serializeGeometry(geometry: DrawnGeometry): string {
  return JSON.stringify(geometry);
}

// ============================================================================
// Input validation
// ============================================================================

function expectedGeometryType(target: DrawnGeometryTarget): "Polygon" | "LineString" {
  return POLYGON_TARGETS.includes(target) ? "Polygon" : "LineString";
}

/**
 * Validate a full drawn-geometry submission: geometry shape, target/geometry
 * agreement, entity association, and a coherent time range.
 */
export function validateDrawnGeometry(input: Partial<DrawnGeometryInput>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.target || !DRAWN_GEOMETRY_TARGETS.includes(input.target)) {
    errors.push(`target must be one of: ${DRAWN_GEOMETRY_TARGETS.join(", ")}`);
  }

  if (!input.name || typeof input.name !== "string" || !input.name.trim()) {
    errors.push("name is required");
  }

  if (!input.associatedEntityId || typeof input.associatedEntityId !== "string" || !input.associatedEntityId.trim()) {
    errors.push("associatedEntityId is required — a drawn geometry must be associated with an entity");
  }

  // Time range: start required; end optional but, when present, must not precede start.
  if (!isFiniteNumber(input.timePeriodStart)) {
    errors.push("timePeriodStart is required and must be a number (negative = BCE)");
  }
  if (input.timePeriodEnd !== undefined && input.timePeriodEnd !== null) {
    if (!isFiniteNumber(input.timePeriodEnd)) {
      errors.push("timePeriodEnd must be a number or null");
    } else if (isFiniteNumber(input.timePeriodStart) && input.timePeriodEnd < input.timePeriodStart) {
      errors.push("timePeriodEnd must not be earlier than timePeriodStart (inverted range)");
    }
  }

  if (input.confidence !== undefined) {
    if (!isFiniteNumber(input.confidence) || input.confidence < 1 || input.confidence > 100) {
      errors.push("confidence must be a number between 1 and 100");
    }
  } else {
    warnings.push("confidence not specified, defaulting to 60");
  }

  // Geometry structural validation.
  const geomResult = validateGeometry(input.geometry);
  errors.push(...geomResult.errors);

  // Target ↔ geometry type agreement (only if both are individually valid).
  if (
    input.target &&
    DRAWN_GEOMETRY_TARGETS.includes(input.target) &&
    geomResult.valid &&
    input.geometry
  ) {
    const expected = expectedGeometryType(input.target);
    if (input.geometry.type !== expected) {
      errors.push(
        `target '${input.target}' expects a ${expected} geometry but received a ${input.geometry.type}`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Mapping to a contribution
// ============================================================================

/**
 * Map a validated drawn geometry onto a `Partial<Contribution>` for the review
 * queue. The geometry is stored under `entityData.geometry` (a GeoJSON object,
 * matching `BoundaryDrawingPanel`) alongside its canonical serialized string,
 * and provenance `source: 'user-drawn'` is recorded on the entity data. For
 * `language-range` the associated entity id is mirrored into `languageId` to
 * satisfy the contribution service's required fields.
 */
export function drawnGeometryToContribution(input: DrawnGeometryInput): Partial<Contribution> {
  const entityType = input.target as ContributionEntityType;
  const confidence = input.confidence ?? 60;

  const entityData: Record<string, unknown> = {
    name: input.name,
    geometry: input.geometry,
    geometrySerialized: serializeGeometry(input.geometry),
    drawingMode: input.geometry.type === "Polygon" ? "polygon" : "polyline",
    source: DRAWN_PROVENANCE,
    associatedEntityId: input.associatedEntityId,
    timePeriodStart: input.timePeriodStart,
    timePeriodEnd: input.timePeriodEnd ?? null,
    timePeriodLabel: input.timePeriodLabel,
  };

  if (input.description) entityData.description = input.description;
  if (entityType === "language-range") {
    entityData.languageId = input.associatedEntityId;
  }

  const sources: ContributionSource[] =
    input.sources && input.sources.length > 0
      ? input.sources
      : [{ title: "User-drawn geometry" }];

  return {
    entityType,
    action: "add",
    entityId: input.associatedEntityId,
    entityData,
    sources,
    confidence,
    notes: input.notes,
    contributorName: input.contributorName,
    contributorEmail: input.contributorEmail,
  };
}
