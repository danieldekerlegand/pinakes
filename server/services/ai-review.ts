/**
 * AI-extraction review workflow (US-009)
 *
 * AI-extracted drafts (from the URL extractor US-004 and the text extractor
 * US-008) are queued as `pending` contributions flagged
 * `entityData.aiGenerated` with a `entityData.perFieldConfidence` map. This
 * module turns those drafts into a **field-level review** model — a human can
 * accept / edit / reject each field before commit, low-confidence fields are
 * flagged — and, on approval, **promotes** the accepted draft into the
 * appropriate `data/source/lexicons/*.tsv` with provenance recording BOTH the AI source and
 * the human reviewer.
 *
 * Everything here is pure over an injectable `lexiconsDir` (+ a `now` clock), so
 * the whole workflow is unit-tested against `fs.mkdtempSync` temp dirs — no live
 * lexicon writes, no wall-clock.
 */

import fs from "fs";
import path from "path";
import type { Contribution, ContributionEntityType } from "./contribution-service";

// ============================================================================
// Field-level review model
// ============================================================================

/** Per-field confidence at/below this (0..1) is highlighted as low-confidence. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Keys in `entityData` that are provenance/metadata, not reviewable content
 * fields. Everything else in `entityData` is projected as a review field.
 */
const METADATA_KEYS = new Set<string>([
  "source",
  "aiGenerated",
  "autoDerived",
  "provenanceKind",
  "wikidataQid",
  "sourceUrl",
  "relationships",
  "perFieldConfidence",
]);

export interface ReviewFieldView {
  field: string;
  value: unknown;
  /** 0..1 per-field confidence, or null when the extractor recorded none. */
  confidence: number | null;
  lowConfidence: boolean;
}

export interface AiDraftView {
  id: string;
  entityType: ContributionEntityType;
  action: Contribution["action"];
  status: Contribution["status"];
  aiGenerated: boolean;
  aiSource: string | null;
  /** 1..100 overall confidence (from the contribution record). */
  overallConfidence: number;
  submittedAt: string;
  reviewedAt?: string;
  reviewer?: string;
  fields: ReviewFieldView[];
  relationships: unknown[];
  promotable: boolean;
  promotion?: PromotionRecord;
}

/** True when a contribution is an AI-extracted draft (US-004 / US-008). */
export function isAiDraft(c: Contribution): boolean {
  const data = c.entityData as Record<string, unknown> | undefined;
  return !!data && data.aiGenerated === true;
}

function perFieldConfidence(c: Contribution): Record<string, number> {
  const raw = (c.entityData as Record<string, unknown>)?.perFieldConfidence;
  return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
}

/**
 * Project an AI draft into a field-level review view. Pure.
 */
export function projectDraft(c: Contribution): AiDraftView {
  const data = (c.entityData ?? {}) as Record<string, unknown>;
  const conf = perFieldConfidence(c);

  const fields: ReviewFieldView[] = Object.keys(data)
    .filter((k) => !METADATA_KEYS.has(k))
    .map((field) => {
      const confidence = typeof conf[field] === "number" ? conf[field] : null;
      return {
        field,
        value: data[field],
        confidence,
        lowConfidence: confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD,
      };
    });

  return {
    id: c.id,
    entityType: c.entityType,
    action: c.action,
    status: c.status,
    aiGenerated: isAiDraft(c),
    aiSource: typeof data.source === "string" ? data.source : null,
    overallConfidence: c.confidence,
    submittedAt: c.submittedAt,
    reviewedAt: c.reviewedAt,
    reviewer: c.reviewer,
    fields,
    relationships: Array.isArray(data.relationships) ? (data.relationships as unknown[]) : [],
    promotable: c.entityType in PROMOTION_TARGETS,
    promotion: c.promotion,
  };
}

// ============================================================================
// Field decisions → accepted entityData
// ============================================================================

export type FieldDecision =
  | { decision: "accept" }
  | { decision: "edit"; value: unknown }
  | { decision: "reject" };

export interface FieldReviewRecord {
  decision: "accept" | "edit" | "reject";
  value?: unknown;
}

export interface AppliedReview {
  /** Content fields after applying the per-field decisions (no metadata). */
  acceptedData: Record<string, unknown>;
  fieldReviews: Record<string, FieldReviewRecord>;
  rejectedFields: string[];
}

/** Minimal required content fields for the promotable entity types. */
const REQUIRED_CONTENT: Partial<Record<ContributionEntityType, string[]>> = {
  civilization: ["name"],
  language: ["name"],
  "archaeological-site": ["name", "coordinates"],
  "trade-good": ["name"],
  "historical-figure": ["name"],
};

export class AiReviewError extends Error {}

/**
 * Apply per-field accept/edit/reject decisions to an AI draft. Fields with no
 * explicit decision default to `accept`. Returns the accepted content fields
 * (metadata stripped) plus the recorded decisions. Pure.
 *
 * Throws `AiReviewError` if a decision names a field that isn't in the draft.
 */
export function applyFieldReviews(
  c: Contribution,
  decisions: Record<string, FieldDecision> = {},
): AppliedReview {
  const view = projectDraft(c);
  const known = new Set(view.fields.map((f) => f.field));

  for (const field of Object.keys(decisions)) {
    if (!known.has(field)) {
      throw new AiReviewError(`Unknown field '${field}' for contribution ${c.id}`);
    }
  }

  const acceptedData: Record<string, unknown> = {};
  const fieldReviews: Record<string, FieldReviewRecord> = {};
  const rejectedFields: string[] = [];

  for (const f of view.fields) {
    const decision = decisions[f.field] ?? { decision: "accept" as const };
    if (decision.decision === "reject") {
      fieldReviews[f.field] = { decision: "reject" };
      rejectedFields.push(f.field);
      continue;
    }
    if (decision.decision === "edit") {
      acceptedData[f.field] = decision.value;
      fieldReviews[f.field] = { decision: "edit", value: decision.value };
      continue;
    }
    acceptedData[f.field] = f.value;
    fieldReviews[f.field] = { decision: "accept" };
  }

  return { acceptedData, fieldReviews, rejectedFields };
}

/**
 * Validate that the accepted content satisfies the target entity type's
 * required fields (e.g. a reviewer can't reject `name`). Returns error strings.
 */
export function validateAcceptedDraft(
  entityType: ContributionEntityType,
  acceptedData: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const required = REQUIRED_CONTENT[entityType] ?? ["name"];
  for (const field of required) {
    if (!(field in acceptedData) || acceptedData[field] === undefined || acceptedData[field] === "") {
      errors.push(`Required field '${field}' was rejected or is empty`);
    }
  }
  return errors;
}

// ============================================================================
// Promotion to data/source/lexicons/*.tsv
// ============================================================================

export interface PromotionRecord {
  file: string;
  targetId: string;
  aiSource: string;
  reviewer: string;
  reviewedAt: string;
}

interface PromotionTarget {
  file: string;
  header: string[];
  /** Map accepted content fields → header-column cells (strings). */
  map: (data: Record<string, unknown>, overallConfidence: number) => Record<string, string>;
}

function coordCell(value: unknown): string {
  if (value && typeof value === "object") {
    const c = value as { lat?: unknown; lng?: unknown };
    if (typeof c.lat === "number" && typeof c.lng === "number") {
      return JSON.stringify({ lat: c.lat, lng: c.lng });
    }
  }
  return "";
}

function timePeriodRange(data: Record<string, unknown>): string {
  const start = data.timePeriodStart;
  const end = data.timePeriodEnd;
  if (start === undefined && end === undefined) return "";
  return `${start ?? ""} to ${end ?? ""}`.trim();
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

const PROMOTION_TARGETS: Partial<Record<ContributionEntityType, PromotionTarget>> = {
  civilization: {
    file: "civilizations.tsv",
    header: [
      "id", "name", "native_name", "time_period_start", "time_period_end",
      "time_period_label", "associated_language_ids", "writing_systems",
      "political_structure", "capital", "population", "haplogroup_ids",
      "cuisine_id", "sources", "description",
    ],
    map: (data) => ({
      name: str(data.name),
      time_period_start: str(data.timePeriodStart),
      time_period_end: str(data.timePeriodEnd),
      description: str(data.description),
    }),
  },
  language: {
    file: "languages.tsv",
    header: [
      "id", "name", "native_name", "iso639_1", "iso639_2", "family_id",
      "parent_language_id", "region", "countries", "native_speakers",
      "total_speakers", "status", "time_origin", "time_end", "classification",
      "writing_system", "is_historical_variant", "is_dialect",
      "chronological_order", "historical_context", "latitude", "longitude",
    ],
    map: (data) => {
      const cell: Record<string, string> = {
        name: str(data.name),
        historical_context: str(data.description),
        time_origin: str(data.timePeriodStart),
        time_end: str(data.timePeriodEnd),
      };
      const coord = data.coordinates as { lat?: unknown; lng?: unknown } | undefined;
      if (coord && typeof coord.lat === "number" && typeof coord.lng === "number") {
        cell.latitude = String(coord.lat);
        cell.longitude = String(coord.lng);
      }
      return cell;
    },
  },
  "archaeological-site": {
    file: "archaeological-sites.tsv",
    header: [
      "id", "name", "coordinates", "site_type", "time_period_start",
      "time_period_end", "time_period_label", "associated_language_ids",
      "associated_culture_ids", "associated_civilization_ids",
      "excavation_status", "findings", "importance", "confidence", "sources",
      "description",
    ],
    map: (data, overallConfidence) => ({
      name: str(data.name),
      coordinates: coordCell(data.coordinates),
      time_period_start: str(data.timePeriodStart),
      time_period_end: str(data.timePeriodEnd),
      confidence: String(overallConfidence),
      description: str(data.description),
    }),
  },
  "trade-good": {
    file: "trade-goods.tsv",
    header: [
      "id", "name", "category", "origin_region", "origin_coordinates",
      "trade_routes", "time_period", "economic_significance",
      "associated_languages",
    ],
    map: (data) => ({
      name: str(data.name),
      origin_coordinates: coordCell(data.coordinates),
      time_period: timePeriodRange(data),
      economic_significance: str(data.description),
    }),
  },
};

const PROVENANCE_LEDGER = "contribution-provenance.tsv";
const PROVENANCE_HEADER = [
  "contribution_id", "entity_type", "target_file", "target_id",
  "ai_source", "reviewer", "reviewed_at", "confidence",
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-") || "entity";
}

function readExistingIds(filePath: string): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(filePath)) return ids;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    ids.add(lines[i].split("\t")[0]);
  }
  return ids;
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Append a row (aligned to `header`) to a TSV, creating the file with its header
 * when absent. Preserves a trailing newline.
 */
function appendRow(filePath: string, header: string[], cells: Record<string, string>): void {
  const row = header.map((col) => (cells[col] ?? "").replace(/[\t\n\r]/g, " ")).join("\t");
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${header.join("\t")}\n${row}\n`, "utf-8");
    return;
  }
  const existing = fs.readFileSync(filePath, "utf-8");
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(filePath, `${sep}${row}\n`, "utf-8");
}

/**
 * Promote an accepted AI draft into the appropriate `data/source/lexicons/*.tsv` and record
 * provenance (AI source + human reviewer) in a companion ledger. Returns the
 * promotion record. Throws `AiReviewError` for a non-promotable entity type or
 * when a required field is missing.
 */
export function promoteContribution(params: {
  contributionId: string;
  entityType: ContributionEntityType;
  acceptedData: Record<string, unknown>;
  reviewer: string;
  aiSource: string;
  overallConfidence: number;
  lexiconsDir: string;
  now: string;
}): PromotionRecord {
  const target = PROMOTION_TARGETS[params.entityType];
  if (!target) {
    throw new AiReviewError(`No TSV promotion target for entity type '${params.entityType}'`);
  }

  const errors = validateAcceptedDraft(params.entityType, params.acceptedData);
  if (errors.length > 0) {
    throw new AiReviewError(errors.join("; "));
  }

  const filePath = path.join(params.lexiconsDir, target.file);
  const existingIds = readExistingIds(filePath);
  const name = str(params.acceptedData.name);
  const targetId = uniqueId(slugify(name), existingIds);

  const cells = target.map(params.acceptedData, params.overallConfidence);
  cells.id = targetId;
  // Provenance inline where the file has a `sources` column (string array shape).
  if (target.header.includes("sources")) {
    cells.sources = JSON.stringify([
      `AI-extracted via ${params.aiSource}; reviewed by ${params.reviewer}`,
    ]);
  }

  appendRow(filePath, target.header, cells);

  // Structured provenance ledger — uniform regardless of the target's columns.
  appendRow(path.join(params.lexiconsDir, PROVENANCE_LEDGER), PROVENANCE_HEADER, {
    contribution_id: params.contributionId,
    entity_type: params.entityType,
    target_file: target.file,
    target_id: targetId,
    ai_source: params.aiSource,
    reviewer: params.reviewer,
    reviewed_at: params.now,
    confidence: String(params.overallConfidence),
  });

  return {
    file: target.file,
    targetId,
    aiSource: params.aiSource,
    reviewer: params.reviewer,
    reviewedAt: params.now,
  };
}

export function isPromotable(entityType: ContributionEntityType): boolean {
  return entityType in PROMOTION_TARGETS;
}
