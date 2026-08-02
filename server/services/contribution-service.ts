/**
 * Contribution & Review Service (Phase 5)
 * 
 * Lightweight contribution system for community data submissions.
 * Stores contributions as JSON files in data/runtime/contributions/ directory.
 * No auth required — designed for personal project use with optional moderation.
 */

import fs from "fs";
import path from "path";
import {
  addConfirmation,
  computeConfidence,
  isVerified,
  summarizeVerification,
  DEFAULT_VERIFICATION_CONFIG,
  type Confirmation,
  type VerificationConfig,
  type VerificationState,
} from "./community-verification";

// ============================================================================
// Types
// ============================================================================

export type ContributionStatus = "pending" | "approved" | "rejected";

export type ContributionEntityType =
  | "cuisine"
  | "cuisine-item"
  | "music-tradition"
  | "musical-instrument"
  | "religion"
  | "haplogroup"
  | "civilization"
  | "archaeological-site"
  | "historical-figure"
  | "trade-good"
  | "language-range"
  | "language"
  | "boundary"
  | "trade-route"
  | "migration-route"
  | "timeline-event"
  | "relationship";

export interface ContributionSource {
  title: string;
  url?: string;
  author?: string;
  year?: number;
  license?: string;
}

export interface Contribution {
  id: string;
  entityType: ContributionEntityType;
  action: "add" | "edit" | "flag";
  status: ContributionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewNote?: string;

  // Contributor info (optional, no auth)
  contributorName?: string;
  contributorEmail?: string;

  // Entity data
  entityId?: string; // For edits/flags, the existing entity ID
  entityData: Record<string, unknown>;
  sources: ContributionSource[];
  confidence: number; // 1-100
  notes?: string;

  // Per-field edit support
  fieldName?: string; // Specific field being edited
  currentValue?: string; // Current value of the field
  suggestedValue?: string; // Proposed new value

  // AI-extraction review support (US-009). AI-extracted drafts (US-004/US-008)
  // carry these first-class so the review workflow doesn't have to dig into
  // entityData. `aiGenerated`/`aiSource`/`perFieldConfidence` are hoisted from
  // entityData at submit time; the rest are recorded when a reviewer acts.
  aiGenerated?: boolean;
  aiSource?: string;
  perFieldConfidence?: Record<string, number>;
  reviewer?: string; // Human who reviewed the AI draft
  fieldReviews?: Record<string, { decision: "accept" | "edit" | "reject"; value?: unknown }>;
  promotion?: {
    file: string;
    targetId: string;
    aiSource: string;
    reviewer: string;
    reviewedAt: string;
  };

  // Community verification (US-012). Independent confirmations from distinct
  // reviewers raise `confidence` and, once the threshold is met, verify the
  // contribution (`verified`/`verifiedAt`, status → approved). `baseConfidence`
  // preserves the pre-confirmation confidence so recomputation is idempotent;
  // `stewardAttribution` records which steward(s) of the domain vouched.
  confirmations?: Confirmation[];
  baseConfidence?: number;
  verified?: boolean;
  verifiedAt?: string;
  stewardAttribution?: { steward: string; domain: string }[];
}

export interface ContributionFilters {
  status?: ContributionStatus;
  entityType?: ContributionEntityType;
  action?: "add" | "edit" | "flag";
  limit?: number;
  offset?: number;
}

export interface ContributionStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byEntityType: Record<string, number>;
  byAction: Record<string, number>;
}

// ============================================================================
// Validation
// ============================================================================

const REQUIRED_FIELDS: Record<ContributionEntityType, string[]> = {
  "cuisine": ["name", "region"],
  "cuisine-item": ["name", "cuisineId"],
  "music-tradition": ["name", "region"],
  "musical-instrument": ["name", "instrumentFamily"],
  "religion": ["name", "religionType"],
  "haplogroup": ["name"],
  "civilization": ["name"],
  "archaeological-site": ["name", "coordinates"],
  "historical-figure": ["name"],
  "trade-good": ["name"],
  "language-range": ["languageId", "geometry"],
  "language": ["name"],
  "boundary": ["name", "geometry"],
  "trade-route": ["name", "geometry"],
  "migration-route": ["name", "geometry"],
  "timeline-event": ["title", "cultureProfileId", "lane"],
  "relationship": ["sourceId", "targetId", "relationshipType"],
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateContribution(data: Partial<Contribution>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.entityType) {
    errors.push("entityType is required");
  } else if (!REQUIRED_FIELDS[data.entityType]) {
    errors.push(`Invalid entityType: ${data.entityType}`);
  }

  if (!data.action || !["add", "edit", "flag"].includes(data.action)) {
    errors.push("action must be 'add', 'edit', or 'flag'");
  }

  if (data.action === "edit" && !data.entityId) {
    errors.push("entityId is required for edit contributions");
  }

  // Per-field edits: if fieldName is provided, suggestedValue is required
  if (data.fieldName && !data.suggestedValue) {
    errors.push("suggestedValue is required when fieldName is specified");
  }

  if (data.action === "flag" && !data.entityId) {
    errors.push("entityId is required for flag contributions");
  }

  if (!data.entityData || typeof data.entityData !== "object") {
    errors.push("entityData is required and must be an object");
  } else if (data.entityType && REQUIRED_FIELDS[data.entityType]) {
    for (const field of REQUIRED_FIELDS[data.entityType]) {
      if (data.action === "flag") continue; // Flags don't need entity fields
      if (!(field in data.entityData) || !data.entityData[field]) {
        errors.push(`entityData.${field} is required for ${data.entityType}`);
      }
    }
  }

  if (!data.sources || !Array.isArray(data.sources) || data.sources.length === 0) {
    if (data.action !== "flag") {
      errors.push("At least one source citation is required");
    }
  } else {
    for (let i = 0; i < data.sources.length; i++) {
      if (!data.sources[i].title) {
        errors.push(`sources[${i}].title is required`);
      }
    }
  }

  if (data.confidence !== undefined) {
    if (typeof data.confidence !== "number" || data.confidence < 1 || data.confidence > 100) {
      errors.push("confidence must be a number between 1 and 100");
    }
  } else {
    warnings.push("confidence not specified, defaulting to 50");
  }

  if (data.contributorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contributorEmail)) {
    warnings.push("contributorEmail format appears invalid");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Service
// ============================================================================

export class ContributionService {
  private contributionsDir: string;
  private contributions: Contribution[] | null = null;

  constructor(dataDir: string = "data/runtime/contributions") {
    this.contributionsDir = path.resolve(dataDir);
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.contributionsDir)) {
      fs.mkdirSync(this.contributionsDir, { recursive: true });
    }
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `contrib-${timestamp}-${random}`;
  }

  private getFilePath(id: string): string {
    return path.join(this.contributionsDir, `${id}.json`);
  }

  private loadAll(): Contribution[] {
    if (this.contributions) return this.contributions;

    const files = fs.readdirSync(this.contributionsDir).filter((f) => f.endsWith(".json"));
    this.contributions = files.map((file) => {
      const content = fs.readFileSync(path.join(this.contributionsDir, file), "utf-8");
      return JSON.parse(content) as Contribution;
    });

    // Sort by submission date, newest first
    this.contributions.sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

    return this.contributions;
  }

  private save(contribution: Contribution): void {
    const filePath = this.getFilePath(contribution.id);
    fs.writeFileSync(filePath, JSON.stringify(contribution, null, 2), "utf-8");
    this.contributions = null; // Invalidate cache
  }

  /**
   * Submit a new contribution
   */
  submit(data: Partial<Contribution>): { contribution?: Contribution; validation: ValidationResult } {
    const validation = validateContribution(data);
    if (!validation.valid) {
      return { validation };
    }

    // Hoist AI-extraction flags out of entityData so the review workflow
    // (US-009) can treat them as first-class without digging into entityData.
    const entityData = data.entityData!;
    const aiGenerated =
      data.aiGenerated ?? entityData.aiGenerated === true ? true : undefined;
    const aiSource =
      data.aiSource ??
      (typeof entityData.source === "string" && aiGenerated
        ? (entityData.source as string)
        : undefined);
    const perFieldConfidence =
      data.perFieldConfidence ??
      (entityData.perFieldConfidence && typeof entityData.perFieldConfidence === "object"
        ? (entityData.perFieldConfidence as Record<string, number>)
        : undefined);

    const contribution: Contribution = {
      id: this.generateId(),
      entityType: data.entityType!,
      action: data.action!,
      status: "pending",
      submittedAt: new Date().toISOString(),
      contributorName: data.contributorName,
      contributorEmail: data.contributorEmail,
      entityId: data.entityId,
      entityData,
      sources: data.sources!,
      confidence: data.confidence ?? 50,
      notes: data.notes,
      fieldName: data.fieldName,
      currentValue: data.currentValue,
      suggestedValue: data.suggestedValue,
      aiGenerated,
      aiSource,
      perFieldConfidence,
    };

    this.save(contribution);
    return { contribution, validation };
  }

  /**
   * Get contributions with optional filtering
   */
  list(filters?: ContributionFilters): { contributions: Contribution[]; total: number } {
    let all = this.loadAll();

    if (filters?.status) {
      all = all.filter((c) => c.status === filters.status);
    }
    if (filters?.entityType) {
      all = all.filter((c) => c.entityType === filters.entityType);
    }
    if (filters?.action) {
      all = all.filter((c) => c.action === filters.action);
    }

    const total = all.length;
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;

    return {
      contributions: all.slice(offset, offset + limit),
      total,
    };
  }

  /**
   * Get a single contribution by ID
   */
  get(id: string): Contribution | null {
    const filePath = this.getFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Contribution;
  }

  /**
   * Review a contribution (approve or reject)
   */
  review(
    id: string,
    decision: "approved" | "rejected",
    note?: string,
  ): Contribution | null {
    const contribution = this.get(id);
    if (!contribution) return null;

    contribution.status = decision;
    contribution.reviewedAt = new Date().toISOString();
    contribution.reviewNote = note;

    this.save(contribution);
    return contribution;
  }

  /**
   * Record the outcome of an AI-draft field-level review (US-009): the human
   * reviewer, their per-field decisions, the final status, and — when approved
   * and promoted — the resulting TSV promotion record. The actual promotion to
   * `lexicons/*.tsv` is done by `ai-review.promoteContribution` (kept out of
   * this service so it stays lexicon-agnostic); pass the record here to persist.
   */
  recordAiReview(
    id: string,
    update: {
      status: "approved" | "rejected";
      reviewer: string;
      fieldReviews?: Contribution["fieldReviews"];
      promotion?: Contribution["promotion"];
      note?: string;
    },
  ): Contribution | null {
    const contribution = this.get(id);
    if (!contribution) return null;

    contribution.status = update.status;
    contribution.reviewer = update.reviewer;
    contribution.reviewedAt = new Date().toISOString();
    if (update.fieldReviews) contribution.fieldReviews = update.fieldReviews;
    if (update.promotion) contribution.promotion = update.promotion;
    if (update.note !== undefined) contribution.reviewNote = update.note;

    this.save(contribution);
    return contribution;
  }

  /**
   * Record an independent confirmation from a distinct reviewer (US-012).
   *
   * Each confirmation raises the contribution's confidence (ramping from the
   * preserved `baseConfidence`) and, once enough distinct reviewers agree, marks
   * the contribution `verified` and approves it. A steward of the contribution's
   * domain lowers the required-reviewer bar; their attribution is recorded with
   * provenance. Dedups repeated confirmations and rejects self-confirmation.
   *
   * Returns `null` for an unknown id; otherwise the updated contribution and its
   * verification state, plus `added:false`/`reason` when the confirmation was a
   * no-op (duplicate reviewer or self-confirmation).
   */
  confirm(
    id: string,
    input: {
      reviewer: string;
      isSteward?: boolean;
      domain?: string;
      note?: string;
      config?: VerificationConfig;
      now?: string;
    },
  ):
    | { contribution: Contribution; verification: VerificationState; added: boolean; reason?: string }
    | null {
    const contribution = this.get(id);
    if (!contribution) return null;

    const config = input.config ?? DEFAULT_VERIFICATION_CONFIG;
    const now = input.now ?? new Date().toISOString();
    const base = contribution.baseConfidence ?? contribution.confidence;
    contribution.baseConfidence = base;
    const existing = contribution.confirmations ?? [];

    // Reject self-confirmation — independence is the point.
    if (
      contribution.contributorName &&
      contribution.contributorName.trim().toLowerCase() === input.reviewer.trim().toLowerCase()
    ) {
      return {
        contribution,
        verification: summarizeVerification(base, existing, config),
        added: false,
        reason: "self",
      };
    }

    const result = addConfirmation(existing, {
      reviewer: input.reviewer.trim(),
      confirmedAt: now,
      isSteward: input.isSteward === true ? true : undefined,
      domain: input.isSteward ? input.domain : undefined,
      note: input.note,
    });

    if (!result.added) {
      return {
        contribution,
        verification: summarizeVerification(base, existing, config),
        added: false,
        reason: result.reason,
      };
    }

    contribution.confirmations = result.confirmations;
    contribution.confidence = computeConfidence(base, result.confirmations, config);

    if (isVerified(result.confirmations, config)) {
      contribution.verified = true;
      if (!contribution.verifiedAt) contribution.verifiedAt = now;
      if (contribution.status === "pending") {
        contribution.status = "approved";
        contribution.reviewedAt = now;
      }
    }

    // Record steward attribution with provenance (each steward's own domain).
    const stewardConfirmations = result.confirmations.filter((c) => c.isSteward);
    if (stewardConfirmations.length > 0) {
      contribution.stewardAttribution = stewardConfirmations.map((c) => ({
        steward: c.reviewer.trim(),
        domain: c.domain ?? input.domain ?? "",
      }));
    }

    this.save(contribution);
    return {
      contribution,
      verification: summarizeVerification(base, result.confirmations, config),
      added: true,
    };
  }

  /**
   * Get contributions for a specific entity
   */
  getByEntity(entityType: string, entityId: string): Contribution[] {
    return this.loadAll().filter(
      (c) => c.entityType === entityType && c.entityId === entityId && c.status === "approved"
    );
  }

  /**
   * Export all contributions as CSV
   */
  exportCsv(): string {
    const all = this.loadAll();
    const headers = [
      "id", "entityType", "action", "status", "submittedAt", "reviewedAt",
      "contributorName", "entityId", "fieldName", "currentValue", "suggestedValue",
      "confidence", "notes", "reviewNote", "sources",
    ];
    const rows = all.map((c) => [
      c.id,
      c.entityType,
      c.action,
      c.status,
      c.submittedAt,
      c.reviewedAt || "",
      c.contributorName || "",
      c.entityId || "",
      c.fieldName || "",
      c.currentValue || "",
      c.suggestedValue || "",
      String(c.confidence),
      c.notes || "",
      c.reviewNote || "",
      c.sources.map((s) => s.title).join("; "),
    ]);
    const escape = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };
    return [
      headers.join(","),
      ...rows.map((row) => row.map(escape).join(",")),
    ].join("\n");
  }

  /**
   * Get summary statistics
   */
  stats(): ContributionStats {
    const all = this.loadAll();

    const byEntityType: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    let pending = 0;
    let approved = 0;
    let rejected = 0;

    for (const c of all) {
      byEntityType[c.entityType] = (byEntityType[c.entityType] ?? 0) + 1;
      byAction[c.action] = (byAction[c.action] ?? 0) + 1;
      if (c.status === "pending") pending++;
      else if (c.status === "approved") approved++;
      else rejected++;
    }

    return {
      total: all.length,
      pending,
      approved,
      rejected,
      byEntityType,
      byAction,
    };
  }
}
