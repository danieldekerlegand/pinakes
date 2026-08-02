/**
 * Data versioning & changelog (US-010).
 *
 * A browsable, append-only record of dataset changes — every row added, modified,
 * or removed from `data/source/lexicons/*.tsv` — so provenance is auditable over time. The
 * contribution pipeline logs an entry whenever an approved edit lands (see the
 * `changelog` option on `registerAiReviewRoutes` / `registerContributionRoutes`),
 * and `GET /api/changelog` exposes the log filterable by domain + date.
 *
 * Persistence follows the `contribution-service.ts` / `collections.ts` model — one
 * JSON file per entry under `data/changelog/` — but the record shape, validation,
 * filtering, and stats are **pure** functions (no fs, no clock) taking `id`/`now`
 * as params, so they are unit-tested directly and the store is a thin fs wrapper.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// ============================================================================
// Types
// ============================================================================

/** The kind of change recorded against a dataset row. */
export type ChangeType = "added" | "modified" | "removed";

export const CHANGE_TYPES: readonly ChangeType[] = ["added", "modified", "removed"];

/** Fields accepted when recording a change (the caller supplies these). */
export interface ChangelogEntryInput {
  /** Logical domain the change belongs to, e.g. `"civilization"`, `"language"`. */
  domain: string;
  changeType: ChangeType;
  /** The `data/source/lexicons/*.tsv` file the change targets, when known. */
  targetFile?: string;
  /** The affected row's id, when known. */
  targetId?: string;
  /** Denormalized display name of the affected entity. */
  entityName?: string;
  /** Provenance of the change, e.g. `"ai-review"`, `"contribution"`. */
  source: string;
  /** A source URL backing the change, when one exists. */
  sourceUrl?: string;
  /** The contribution that produced the change, when it came from the queue. */
  contributionId?: string;
  /** Who reviewed/approved the change. */
  reviewer?: string;
  /** For a `modified` change, which fields changed. */
  fields?: string[];
  /** 1..100 confidence carried from the contribution, when available. */
  confidence?: number;
  /** Free-text human-readable summary of the change. */
  summary?: string;
}

/** A persisted changelog entry — an input stamped with an id + timestamp. */
export interface ChangelogEntry extends ChangelogEntryInput {
  id: string;
  /** ISO timestamp the change was recorded. */
  timestamp: string;
}

export interface ChangelogFilters {
  domain?: string;
  changeType?: ChangeType;
  source?: string;
  contributionId?: string;
  /** Inclusive lower date bound (ISO datetime or `YYYY-MM-DD`). */
  from?: string;
  /** Inclusive upper date bound (ISO datetime or `YYYY-MM-DD` → end of day). */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ChangelogStats {
  total: number;
  byDomain: Record<string, number>;
  byChangeType: Record<ChangeType, number>;
  bySource: Record<string, number>;
  /** ISO timestamp of the earliest entry, or null when empty. */
  firstAt: string | null;
  /** ISO timestamp of the latest entry, or null when empty. */
  lastAt: string | null;
}

export interface ChangelogValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// Pure helpers (no fs, no clock)
// ============================================================================

function isChangeType(v: unknown): v is ChangeType {
  return typeof v === "string" && (CHANGE_TYPES as readonly string[]).includes(v);
}

/** Validate a changelog input. Returns error strings (empty = valid). */
export function validateChangelogInput(input: Partial<ChangelogEntryInput>): ChangelogValidationResult {
  const errors: string[] = [];
  if (!input.domain || typeof input.domain !== "string" || !input.domain.trim()) {
    errors.push("domain is required");
  }
  if (!isChangeType(input.changeType)) {
    errors.push(`changeType must be one of: ${CHANGE_TYPES.join(", ")}`);
  }
  if (!input.source || typeof input.source !== "string" || !input.source.trim()) {
    errors.push("source is required");
  }
  if (
    input.confidence !== undefined &&
    (typeof input.confidence !== "number" || input.confidence < 1 || input.confidence > 100)
  ) {
    errors.push("confidence must be a number between 1 and 100");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Build a normalized `ChangelogEntry` from an input, an id, and a timestamp. Pure
 * — trims strings and drops empty optional fields so the persisted shape is tidy.
 */
export function makeChangelogEntry(
  input: ChangelogEntryInput,
  id: string,
  timestamp: string,
): ChangelogEntry {
  const entry: ChangelogEntry = {
    id,
    timestamp,
    domain: input.domain.trim(),
    changeType: input.changeType,
    source: input.source.trim(),
  };
  const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  if (str(input.targetFile)) entry.targetFile = input.targetFile!.trim();
  if (str(input.targetId)) entry.targetId = input.targetId!.trim();
  if (str(input.entityName)) entry.entityName = input.entityName!.trim();
  if (str(input.sourceUrl)) entry.sourceUrl = input.sourceUrl!.trim();
  if (str(input.contributionId)) entry.contributionId = input.contributionId!.trim();
  if (str(input.reviewer)) entry.reviewer = input.reviewer!.trim();
  if (str(input.summary)) entry.summary = input.summary!.trim();
  if (Array.isArray(input.fields) && input.fields.length > 0) {
    entry.fields = input.fields.filter((f) => typeof f === "string" && f.trim()).map((f) => f.trim());
    if (entry.fields.length === 0) delete entry.fields;
  }
  if (typeof input.confidence === "number") entry.confidence = input.confidence;
  return entry;
}

/** Parse a date-range bound to a millisecond value; `to` bounds are end-of-day. */
function boundMs(bound: string | undefined, kind: "from" | "to"): number | null {
  if (!bound) return null;
  const trimmed = bound.trim();
  if (!trimmed) return null;
  // A date-only `to` is inclusive of the whole day.
  if (kind === "to" && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}T23:59:59.999Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

/** True when `timestamp` falls within the (inclusive) `[from, to]` range. */
export function withinDateRange(timestamp: string, from?: string, to?: string): boolean {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return false;
  const fromMs = boundMs(from, "from");
  const toMs = boundMs(to, "to");
  if (fromMs !== null && t < fromMs) return false;
  if (toMs !== null && t > toMs) return false;
  return true;
}

/** Newest-first by timestamp (id as a stable tiebreaker). Returns a new array. */
export function sortChangelogNewestFirst(entries: ChangelogEntry[]): ChangelogEntry[] {
  return [...entries].sort((a, b) => {
    const diff = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });
}

/**
 * Filter + sort (newest-first) a changelog. Pagination (`limit`/`offset`) is NOT
 * applied here — see `paginateChangelog` — so callers can compute stats/total over
 * the full filtered set before slicing.
 */
export function filterChangelog(entries: ChangelogEntry[], filters: ChangelogFilters = {}): ChangelogEntry[] {
  const matched = entries.filter((e) => {
    if (filters.domain && e.domain !== filters.domain) return false;
    if (filters.changeType && e.changeType !== filters.changeType) return false;
    if (filters.source && e.source !== filters.source) return false;
    if (filters.contributionId && e.contributionId !== filters.contributionId) return false;
    if ((filters.from || filters.to) && !withinDateRange(e.timestamp, filters.from, filters.to)) {
      return false;
    }
    return true;
  });
  return sortChangelogNewestFirst(matched);
}

/** Apply `offset`/`limit` to an already-filtered list (default limit 50). */
export function paginateChangelog(entries: ChangelogEntry[], filters: ChangelogFilters = {}): ChangelogEntry[] {
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = filters.limit ?? 50;
  if (limit < 0) return entries.slice(offset);
  return entries.slice(offset, offset + limit);
}

/** Aggregate counts + date bounds over a set of entries. Pure. */
export function computeChangelogStats(entries: ChangelogEntry[]): ChangelogStats {
  const byDomain: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byChangeType: Record<ChangeType, number> = { added: 0, modified: 0, removed: 0 };
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  for (const e of entries) {
    byDomain[e.domain] = (byDomain[e.domain] ?? 0) + 1;
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    byChangeType[e.changeType] = (byChangeType[e.changeType] ?? 0) + 1;
    if (firstAt === null || Date.parse(e.timestamp) < Date.parse(firstAt)) firstAt = e.timestamp;
    if (lastAt === null || Date.parse(e.timestamp) > Date.parse(lastAt)) lastAt = e.timestamp;
  }

  return { total: entries.length, byDomain, byChangeType, bySource, firstAt, lastAt };
}

// ============================================================================
// Store (fs boundary)
// ============================================================================

/**
 * JSON-per-entry changelog store under an injectable dir (default
 * `data/changelog`). Every write goes through the pure helpers above; the store
 * only owns id/clock generation and the filesystem.
 */
export class ChangelogStore {
  private dir: string;
  private cache: ChangelogEntry[] | null = null;

  constructor(dir: string = "data/runtime/changelog") {
    this.dir = path.resolve(dir);
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString("hex");
    return `change-${timestamp}-${random}`;
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private loadAll(): ChangelogEntry[] {
    if (this.cache) return this.cache;
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    this.cache = files
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")) as ChangelogEntry);
    return this.cache;
  }

  /**
   * Record a change. Validates, stamps an id + timestamp, persists a JSON file,
   * and returns the entry. Throws `Error` with the validation messages on a bad
   * input. `id`/`now` are injectable for deterministic tests.
   */
  record(input: ChangelogEntryInput, opts: { id?: string; now?: string } = {}): ChangelogEntry {
    const validation = validateChangelogInput(input);
    if (!validation.valid) {
      throw new Error(`Invalid changelog entry: ${validation.errors.join("; ")}`);
    }
    const id = opts.id ?? this.generateId();
    const timestamp = opts.now ?? new Date().toISOString();
    const entry = makeChangelogEntry(input, id, timestamp);
    fs.writeFileSync(this.filePath(id), JSON.stringify(entry, null, 2), "utf-8");
    this.cache = null; // invalidate
    return entry;
  }

  /** All entries, newest-first (unfiltered). */
  all(): ChangelogEntry[] {
    return sortChangelogNewestFirst(this.loadAll());
  }

  /** Filtered + paginated list plus the pre-pagination total. */
  list(filters: ChangelogFilters = {}): { entries: ChangelogEntry[]; total: number } {
    const filtered = filterChangelog(this.loadAll(), filters);
    return { entries: paginateChangelog(filtered, filters), total: filtered.length };
  }

  /** Stats over the filtered set (ignores pagination). */
  stats(filters: ChangelogFilters = {}): ChangelogStats {
    return computeChangelogStats(filterChangelog(this.loadAll(), filters));
  }
}
