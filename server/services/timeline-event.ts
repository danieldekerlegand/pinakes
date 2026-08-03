/**
 * Timeline-event authoring service (US-002).
 *
 * Pure helpers that turn an event/period authored on the temporal axis into a
 * reviewable contribution. Nothing here touches fs / express / the
 * source-of-truth TSVs — the authored entry lands in the *contribution queue*
 * (via `ContributionService.submit`) with provenance
 * `entityData.source = 'user-authored'`, so a human reviewer promotes it into
 * `data/source/lexicons/culture-events.tsv` later (US-009).
 *
 * Two entry kinds are supported (matching the acceptance criteria — "events,
 * period markers, and date ranges"):
 *   - `event`  — a point-in-time marker at a single year (`timePeriodStart`).
 *   - `period` — a dated range (`timePeriodStart`..`timePeriodEnd`).
 *
 * `serializeTimelineEvent` produces the record shape a `culture-events.tsv` row
 * uses (`culture_profile_id`, `year`, `lane`, `event_type`, `title`, ...), where
 * `year` is the start year — the promotion target for a reviewer.
 */

import type { ContributionSource, Contribution } from "./contribution-service";

// ============================================================================
// Vocabulary & bounds
// ============================================================================

/**
 * Swim-lane keys — kept in sync with the client timeline
 * (`web/src/components/culture-profile/culture-evolution-timeline-utils.ts`
 * `LANE_ORDER`). Redeclared here so the server has no client import.
 */
export const TIMELINE_LANES = [
  "political",
  "territory",
  "urbanism",
  "technology",
  "religion",
  "language",
  "economy",
] as const;
export type TimelineLane = (typeof TIMELINE_LANES)[number];

/** Event magnitude — drives the marker radius on the client timeline. */
export const TIMELINE_MAGNITUDES = ["major", "moderate", "minor"] as const;
export type TimelineMagnitude = (typeof TIMELINE_MAGNITUDES)[number];

/** A single-year marker vs. a dated range. */
export const TIMELINE_ENTRY_KINDS = ["event", "period"] as const;
export type TimelineEntryKind = (typeof TIMELINE_ENTRY_KINDS)[number];

/**
 * Inclusive year bounds an authored entry must fall within (negative = BCE).
 * Guards against fat-fingered years far outside any plausible historical range.
 */
export const TIMELINE_MIN_YEAR = -50000;
export const TIMELINE_MAX_YEAR = 2100;

/** Marks the provenance of an authored timeline contribution. */
export const TIMELINE_PROVENANCE = "user-authored" as const;

// ============================================================================
// Types
// ============================================================================

export interface TimelineEventInput {
  /** `event` = single year; `period` = start..end range. */
  kind: TimelineEntryKind;
  /** The existing culture/entity this entry is associated with (required). */
  cultureProfileId: string;
  /** Human-readable label for the event/period. */
  title: string;
  lane: TimelineLane;
  /** Free-text classifier (e.g. "founding", "conquest"). Defaults to "event". */
  eventType?: string;
  /** Defaults to "moderate". */
  magnitude?: TimelineMagnitude;
  /** Start year (negative = BCE). Required. */
  timePeriodStart: number;
  /**
   * End year. Required for `period`; must be omitted/null (or equal to start)
   * for `event`. Must not precede the start (inverted range).
   */
  timePeriodEnd?: number | null;
  description?: string;
  confidence?: number;
  sources?: ContributionSource[];
  notes?: string;
  contributorName?: string;
  contributorEmail?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Optional extra bounds (e.g. an associated culture's active period). */
export interface TimelineBounds {
  min: number;
  max: number;
}

// ============================================================================
// Validation
// ============================================================================

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function withinBounds(year: number, bounds?: TimelineBounds): boolean {
  const min = Math.max(TIMELINE_MIN_YEAR, bounds?.min ?? TIMELINE_MIN_YEAR);
  const max = Math.min(TIMELINE_MAX_YEAR, bounds?.max ?? TIMELINE_MAX_YEAR);
  return year >= min && year <= max;
}

/**
 * Validate a timeline-event submission: kind, entity association, lane, and a
 * coherent, in-bounds time range. `bounds` optionally tightens the allowed year
 * window (intersected with the global `[TIMELINE_MIN_YEAR, TIMELINE_MAX_YEAR]`).
 */
export function validateTimelineEvent(
  input: Partial<TimelineEventInput>,
  bounds?: TimelineBounds,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.kind || !TIMELINE_ENTRY_KINDS.includes(input.kind)) {
    errors.push(`kind must be one of: ${TIMELINE_ENTRY_KINDS.join(", ")}`);
  }

  if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
    errors.push("title is required");
  }

  if (
    !input.cultureProfileId ||
    typeof input.cultureProfileId !== "string" ||
    !input.cultureProfileId.trim()
  ) {
    errors.push(
      "cultureProfileId is required — a timeline entry must be associated with an entity",
    );
  }

  if (!input.lane || !TIMELINE_LANES.includes(input.lane)) {
    errors.push(`lane must be one of: ${TIMELINE_LANES.join(", ")}`);
  }

  if (input.magnitude !== undefined && !TIMELINE_MAGNITUDES.includes(input.magnitude)) {
    errors.push(`magnitude must be one of: ${TIMELINE_MAGNITUDES.join(", ")}`);
  }

  // Start year: required, finite, in-bounds.
  if (!isFiniteNumber(input.timePeriodStart)) {
    errors.push("timePeriodStart is required and must be a number (negative = BCE)");
  } else if (!withinBounds(input.timePeriodStart, bounds)) {
    errors.push(
      `timePeriodStart ${input.timePeriodStart} is out of bounds (allowed ${Math.max(
        TIMELINE_MIN_YEAR,
        bounds?.min ?? TIMELINE_MIN_YEAR,
      )}..${Math.min(TIMELINE_MAX_YEAR, bounds?.max ?? TIMELINE_MAX_YEAR)})`,
    );
  }

  // End year depends on kind.
  const hasEnd = input.timePeriodEnd !== undefined && input.timePeriodEnd !== null;
  if (input.kind === "period") {
    if (!hasEnd) {
      errors.push("timePeriodEnd is required for a period entry");
    } else if (!isFiniteNumber(input.timePeriodEnd)) {
      errors.push("timePeriodEnd must be a number");
    } else {
      if (!withinBounds(input.timePeriodEnd, bounds)) {
        errors.push(
          `timePeriodEnd ${input.timePeriodEnd} is out of bounds (allowed ${Math.max(
            TIMELINE_MIN_YEAR,
            bounds?.min ?? TIMELINE_MIN_YEAR,
          )}..${Math.min(TIMELINE_MAX_YEAR, bounds?.max ?? TIMELINE_MAX_YEAR)})`,
        );
      }
      if (isFiniteNumber(input.timePeriodStart) && input.timePeriodEnd < input.timePeriodStart) {
        errors.push("timePeriodEnd must not be earlier than timePeriodStart (inverted range)");
      } else if (
        isFiniteNumber(input.timePeriodStart) &&
        input.timePeriodEnd === input.timePeriodStart
      ) {
        warnings.push("timePeriodEnd equals timePeriodStart; consider kind 'event' for a point in time");
      }
    }
  } else if (input.kind === "event" && hasEnd) {
    if (isFiniteNumber(input.timePeriodEnd) && input.timePeriodEnd !== input.timePeriodStart) {
      errors.push(
        "an event is a single point in time; use kind 'period' for a range (timePeriodEnd must match timePeriodStart)",
      );
    }
  }

  if (input.confidence !== undefined) {
    if (!isFiniteNumber(input.confidence) || input.confidence < 1 || input.confidence > 100) {
      errors.push("confidence must be a number between 1 and 100");
    }
  } else {
    warnings.push("confidence not specified, defaulting to 60");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * The canonical `culture-events.tsv` row shape for a timeline entry. `year` is
 * the start year (the single-year column that TSV uses); the full range is kept
 * on the contribution's `entityData` for a reviewer.
 */
export interface SerializedTimelineEvent {
  culture_profile_id: string;
  year: number;
  lane: TimelineLane;
  event_type: string;
  title: string;
  description: string;
  magnitude: TimelineMagnitude;
  sources: string;
}

/**
 * Serialize a timeline entry into the `culture-events.tsv` row shape (with the
 * `sources` cell as the JSON-string-of-titles the loader `JSON.parse`s).
 */
export function serializeTimelineEvent(input: TimelineEventInput): SerializedTimelineEvent {
  const sourceTitles = (input.sources ?? []).map((s) => s.title);
  return {
    culture_profile_id: input.cultureProfileId,
    year: input.timePeriodStart,
    lane: input.lane,
    event_type: input.eventType?.trim() || "event",
    title: input.title,
    description: input.description ?? "",
    magnitude: input.magnitude ?? "moderate",
    sources: JSON.stringify(sourceTitles),
  };
}

// ============================================================================
// Mapping to a contribution
// ============================================================================

/**
 * Map a validated timeline entry onto a `Partial<Contribution>` for the review
 * queue. The full range + provenance live on `entityData`; the serialized
 * `culture-events.tsv` row is mirrored under `entityData.serialized` so a
 * reviewer can promote it verbatim.
 */
export function timelineEventToContribution(input: TimelineEventInput): Partial<Contribution> {
  const confidence = input.confidence ?? 60;
  const isPeriod = input.kind === "period";
  const timePeriodEnd = isPeriod ? (input.timePeriodEnd ?? null) : null;

  const entityData: Record<string, unknown> = {
    kind: input.kind,
    cultureProfileId: input.cultureProfileId,
    title: input.title,
    lane: input.lane,
    eventType: input.eventType?.trim() || "event",
    magnitude: input.magnitude ?? "moderate",
    timePeriodStart: input.timePeriodStart,
    timePeriodEnd,
    description: input.description ?? "",
    source: TIMELINE_PROVENANCE,
    serialized: serializeTimelineEvent(input),
  };

  const sources: ContributionSource[] =
    input.sources && input.sources.length > 0
      ? input.sources
      : [{ title: "User-authored timeline entry" }];

  return {
    entityType: "timeline-event",
    action: "add",
    entityId: input.cultureProfileId,
    entityData,
    sources,
    confidence,
    notes: input.notes,
    contributorName: input.contributorName,
    contributorEmail: input.contributorEmail,
  };
}
