/**
 * Contribution & Review Service (Phase 5)
 * 
 * Lightweight contribution system for community data submissions.
 * Stores contributions as JSON files in data/contributions/ directory.
 * No auth required — designed for personal project use with optional moderation.
 */

import fs from "fs";
import path from "path";

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
  | "language-range";

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
  "language-range": ["languageId", "geometry"],
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

  constructor(dataDir: string = "data/contributions") {
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

    const contribution: Contribution = {
      id: this.generateId(),
      entityType: data.entityType!,
      action: data.action!,
      status: "pending",
      submittedAt: new Date().toISOString(),
      contributorName: data.contributorName,
      contributorEmail: data.contributorEmail,
      entityId: data.entityId,
      entityData: data.entityData!,
      sources: data.sources!,
      confidence: data.confidence ?? 50,
      notes: data.notes,
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
