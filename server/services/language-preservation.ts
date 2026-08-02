/**
 * Endangered-language preservation model + field-research workflow (US-010).
 *
 * Two responsibilities, both **pure** (no fs / express / storage / clock — so they
 * unit-test directly on synthetic fixtures):
 *
 *  1. **Status aggregation.** The corpus `status` column on `data/source/lexicons/languages.tsv`
 *     is free-text and messy ("living", "Critically Endangered", "definiteley
 *     endangered", …). `normalizeStatus` maps every observed spelling onto a canonical
 *     UNESCO-style **vitality level**, each carrying a coarse `category`
 *     (living / endangered / extinct / unknown — the AC's living/endangered/extinct
 *     buckets, plus an honest `unknown` for blank rows). `computePreservationMetrics`
 *     rolls a set of languages up into the dashboard payload (per-category + per-vitality
 *     counts, an endangerment rate, speakers-at-risk, per-region breakdown, and a
 *     most-endangered watchlist).
 *
 *  2. **Field-research updates.** A researcher's structured, *attributed*, *sourced*
 *     status/speaker-count update for one language. `validateFieldUpdate` guards it and
 *     `buildFieldUpdateContribution` turns it into a `language` **edit** contribution so
 *     it rides the existing contribution review pipeline (never a live TSV write);
 *     `changedFields` / `fieldUpdateSummary` describe the change for the versioned
 *     changelog. The route (`routes/language-preservation.ts`) owns storage + the
 *     changelog record.
 */

import type { Contribution, ContributionSource } from "./contribution-service";

// ============================================================================
// Vitality model
// ============================================================================

/** Coarse preservation bucket (the AC's living/endangered/extinct + honest unknown). */
export type PreservationCategory = "living" | "endangered" | "extinct" | "unknown";

export const PRESERVATION_CATEGORIES: readonly PreservationCategory[] = [
  "living",
  "endangered",
  "extinct",
  "unknown",
];

/** A canonical vitality level a raw status string is normalized onto. */
export interface VitalityLevel {
  /** Stable kebab key, e.g. `"critically-endangered"`. */
  key: string;
  /** Human-readable display label. */
  label: string;
  category: PreservationCategory;
  /** At-risk ordering: 0 = safe/living … higher = closer to loss. `unknown` = -1. */
  rank: number;
}

/**
 * Ordered vitality ladder (safe → lost). Ranks are contiguous so
 * `sortByRisk` is unambiguous; `revitalizing` sits low on the ladder because an
 * actively-revived language is precarious but recovering, not merely endangered.
 */
export const VITALITY_LEVELS: readonly VitalityLevel[] = [
  { key: "living", label: "Living", category: "living", rank: 0 },
  { key: "revitalizing", label: "Revitalizing", category: "endangered", rank: 1 },
  { key: "vulnerable", label: "Vulnerable", category: "endangered", rank: 2 },
  { key: "endangered", label: "Endangered", category: "endangered", rank: 3 },
  { key: "definitely-endangered", label: "Definitely endangered", category: "endangered", rank: 4 },
  { key: "severely-endangered", label: "Severely endangered", category: "endangered", rank: 5 },
  { key: "critically-endangered", label: "Critically endangered", category: "endangered", rank: 6 },
  { key: "moribund", label: "Moribund", category: "endangered", rank: 7 },
  { key: "dormant", label: "Dormant", category: "extinct", rank: 8 },
  { key: "extinct", label: "Extinct", category: "extinct", rank: 9 },
  { key: "unknown", label: "Unknown", category: "unknown", rank: -1 },
];

const LEVEL_BY_KEY: Record<string, VitalityLevel> = Object.fromEntries(
  VITALITY_LEVELS.map((l) => [l.key, l]),
);

const UNKNOWN_LEVEL = LEVEL_BY_KEY["unknown"];

/**
 * Map of normalized raw status spellings → canonical vitality key. Keys are the
 * lowercased, whitespace-collapsed raw cell; values reference `VITALITY_LEVELS`.
 * Covers the spellings, casings, and known typos seen in `languages.tsv`.
 */
const STATUS_ALIASES: Record<string, string> = {
  living: "living",
  alive: "living",
  safe: "living",
  spoken: "living",
  national: "living",
  official: "living",

  revitalizing: "revitalizing",
  reviving: "revitalizing",
  revived: "revitalizing",
  reawakening: "revitalizing",
  reemerging: "revitalizing",

  vulnerable: "vulnerable",
  threatened: "vulnerable",
  "at risk": "vulnerable",

  endangered: "endangered",
  "definitely endangered": "definitely-endangered",
  // Observed misspellings in the corpus.
  "definiteley endangered": "definitely-endangered",
  "definately endangered": "definitely-endangered",
  "severely endangered": "severely-endangered",
  "critically endangered": "critically-endangered",
  "nearly extinct": "critically-endangered",

  moribund: "moribund",

  dormant: "dormant",
  "sleeping": "dormant",

  extinct: "extinct",
  dead: "extinct",
};

/** Collapse a raw status cell to a lookup key (lowercase, single-spaced, trimmed). */
function statusKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Normalize a raw `status` cell to its canonical `VitalityLevel`. Empty / missing /
 * unrecognized cells return the `unknown` level (never throws) so a messy corpus is
 * classified honestly rather than mis-bucketed.
 */
export function normalizeStatus(raw: string | null | undefined): VitalityLevel {
  if (raw === null || raw === undefined) return UNKNOWN_LEVEL;
  const key = statusKey(raw);
  if (!key) return UNKNOWN_LEVEL;
  const mapped = STATUS_ALIASES[key];
  if (mapped && LEVEL_BY_KEY[mapped]) return LEVEL_BY_KEY[mapped];
  // A cell that is already a canonical key (e.g. re-normalized data).
  const canonical = key.replace(/ /g, "-");
  if (LEVEL_BY_KEY[canonical]) return LEVEL_BY_KEY[canonical];
  // Substring fallbacks catch qualified variants ("moderately endangered", …).
  if (key.includes("critically")) return LEVEL_BY_KEY["critically-endangered"];
  if (key.includes("severely")) return LEVEL_BY_KEY["severely-endangered"];
  if (key.includes("definite")) return LEVEL_BY_KEY["definitely-endangered"];
  if (key.includes("vulnerable")) return LEVEL_BY_KEY["vulnerable"];
  if (key.includes("endanger")) return LEVEL_BY_KEY["endangered"];
  if (key.includes("extinct")) return LEVEL_BY_KEY["extinct"];
  if (key.includes("dormant")) return LEVEL_BY_KEY["dormant"];
  if (key.includes("living")) return LEVEL_BY_KEY["living"];
  return UNKNOWN_LEVEL;
}

// ============================================================================
// Aggregation
// ============================================================================

/** The minimal language shape the metrics need (projected from storage). */
export interface PreservationLanguage {
  id: string;
  name: string;
  region?: string | null;
  status?: string | null;
  familyId?: string | null;
  nativeSpeakers?: number | null;
  totalSpeakers?: number | null;
}

export interface VitalityBucket {
  key: string;
  label: string;
  category: PreservationCategory;
  count: number;
  /** Share of the total language set (0..1). */
  share: number;
}

export interface RegionPreservation {
  region: string;
  total: number;
  living: number;
  endangered: number;
  extinct: number;
  unknown: number;
  /** endangered / (living + endangered) within the region, 0..1. */
  endangermentRate: number;
}

export interface WatchlistEntry {
  id: string;
  name: string;
  region: string | null;
  vitalityKey: string;
  vitalityLabel: string;
  category: PreservationCategory;
  totalSpeakers: number | null;
}

export interface PreservationMetrics {
  total: number;
  /** Languages with a recognized (non-unknown) status. */
  classified: number;
  byCategory: Record<PreservationCategory, number>;
  vitality: VitalityBucket[];
  /** endangered / (living + endangered) across the whole set, 0..1. */
  endangermentRate: number;
  /** Total speakers in endangered (still-spoken but at-risk) languages. */
  speakersAtRisk: number;
  regions: RegionPreservation[];
  watchlist: WatchlistEntry[];
  note: string;
}

const AGGREGATION_NOTE =
  "Preservation status is normalized from a free-text corpus field onto a UNESCO-style " +
  "vitality scale; blank/unrecognized entries are counted as 'unknown', not living.";

/** Best available speaker count for a language (total → native → null). */
function speakerCount(lang: PreservationLanguage): number | null {
  if (typeof lang.totalSpeakers === "number" && lang.totalSpeakers >= 0) return lang.totalSpeakers;
  if (typeof lang.nativeSpeakers === "number" && lang.nativeSpeakers >= 0) return lang.nativeSpeakers;
  return null;
}

function emptyCategoryCounts(): Record<PreservationCategory, number> {
  return { living: 0, endangered: 0, extinct: 0, unknown: 0 };
}

/** endangered / (living + endangered): share of *still-spoken* languages at risk. */
function endangermentRate(counts: Record<PreservationCategory, number>): number {
  const stillSpoken = counts.living + counts.endangered;
  if (stillSpoken === 0) return 0;
  return counts.endangered / stillSpoken;
}

/**
 * Roll a set of languages up into the endangered-language dashboard payload. Pure —
 * pass `opts.watchlistLimit` (default 25) to bound the watchlist.
 */
export function computePreservationMetrics(
  languages: PreservationLanguage[],
  opts: { watchlistLimit?: number } = {},
): PreservationMetrics {
  const watchlistLimit = opts.watchlistLimit ?? 25;
  const total = languages.length;

  const byCategory = emptyCategoryCounts();
  const vitalityCounts: Record<string, number> = {};
  const regionCounts = new Map<string, Record<PreservationCategory, number>>();
  let speakersAtRisk = 0;
  const endangeredLangs: WatchlistEntry[] = [];

  for (const lang of languages) {
    const level = normalizeStatus(lang.status);
    byCategory[level.category] += 1;
    vitalityCounts[level.key] = (vitalityCounts[level.key] ?? 0) + 1;

    const region = (lang.region ?? "").trim() || "Unknown region";
    let rc = regionCounts.get(region);
    if (!rc) {
      rc = emptyCategoryCounts();
      regionCounts.set(region, rc);
    }
    rc[level.category] += 1;

    if (level.category === "endangered") {
      const speakers = speakerCount(lang);
      if (speakers !== null) speakersAtRisk += speakers;
      endangeredLangs.push({
        id: lang.id,
        name: lang.name,
        region: (lang.region ?? "").trim() || null,
        vitalityKey: level.key,
        vitalityLabel: level.label,
        category: level.category,
        totalSpeakers: speakers,
      });
    }
  }

  // Vitality breakdown, ordered by the risk ladder, only levels that appear.
  const vitality: VitalityBucket[] = VITALITY_LEVELS.filter((l) => (vitalityCounts[l.key] ?? 0) > 0)
    .map((l) => ({
      key: l.key,
      label: l.label,
      category: l.category,
      count: vitalityCounts[l.key],
      share: total > 0 ? vitalityCounts[l.key] / total : 0,
    }));

  // Regional preservation, most-endangered regions first.
  const regions: RegionPreservation[] = Array.from(regionCounts.entries())
    .map(([region, c]) => ({
      region,
      total: c.living + c.endangered + c.extinct + c.unknown,
      living: c.living,
      endangered: c.endangered,
      extinct: c.extinct,
      unknown: c.unknown,
      endangermentRate: endangermentRate(c),
    }))
    .sort((a, b) => b.endangermentRate - a.endangermentRate || b.total - a.total || a.region.localeCompare(b.region));

  // Watchlist: most-endangered still-spoken languages (highest risk, fewest speakers).
  const watchlist = [...endangeredLangs]
    .sort((a, b) => {
      const rankDiff = (LEVEL_BY_KEY[b.vitalityKey]?.rank ?? 0) - (LEVEL_BY_KEY[a.vitalityKey]?.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      const aSpk = a.totalSpeakers ?? Number.POSITIVE_INFINITY;
      const bSpk = b.totalSpeakers ?? Number.POSITIVE_INFINITY;
      if (aSpk !== bSpk) return aSpk - bSpk;
      return a.name.localeCompare(b.name);
    })
    .slice(0, watchlistLimit);

  return {
    total,
    classified: total - byCategory.unknown,
    byCategory,
    vitality,
    endangermentRate: endangermentRate(byCategory),
    speakersAtRisk,
    regions,
    watchlist,
    note: AGGREGATION_NOTE,
  };
}

// ============================================================================
// Field-research update workflow
// ============================================================================

/** A structured, attributed field-research update for one language. */
export interface FieldUpdateInput {
  languageId: string;
  /** Denormalized display name (the route fills this from storage when omitted). */
  languageName?: string;
  /** REQUIRED: attribution — who is submitting this field observation. */
  researcherName: string;
  researcherEmail?: string;
  /** Proposed new preservation status (raw string; validated as recognizable). */
  status?: string;
  nativeSpeakers?: number;
  totalSpeakers?: number;
  region?: string;
  notes?: string;
  /** REQUIRED: at least one source backing the field observation. */
  sources: ContributionSource[];
  /** 1..100; defaults to 60 (field observations are corroboration, not certainty). */
  confidence?: number;
  /** Prior status, for provenance (the route fills this from storage). */
  currentStatus?: string;
}

/** The updatable fields, checked to decide whether an update carries any change. */
const UPDATABLE_FIELDS = ["status", "nativeSpeakers", "totalSpeakers", "region"] as const;

export interface FieldUpdateValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** The fields an update actually proposes to change (in `UPDATABLE_FIELDS` order). */
export function changedFields(input: Partial<FieldUpdateInput>): string[] {
  const changed: string[] = [];
  for (const field of UPDATABLE_FIELDS) {
    const value = input[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      changed.push(field);
    }
  }
  return changed;
}

/** Validate a field-research update. Attribution + a source + one real change required. */
export function validateFieldUpdate(input: Partial<FieldUpdateInput>): FieldUpdateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.languageId || typeof input.languageId !== "string" || !input.languageId.trim()) {
    errors.push("languageId is required");
  }
  if (!input.researcherName || typeof input.researcherName !== "string" || !input.researcherName.trim()) {
    errors.push("researcherName is required (field updates must be attributed)");
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    errors.push("at least one source is required (field updates must be sourced)");
  } else if (!input.sources.some((s) => s && typeof s.title === "string" && s.title.trim())) {
    errors.push("at least one source must have a title");
  }

  const changes = changedFields(input);
  if (changes.length === 0) {
    errors.push("provide at least one changed field (status, nativeSpeakers, totalSpeakers, or region)");
  }

  if (input.status !== undefined && input.status !== null && String(input.status).trim()) {
    if (normalizeStatus(input.status).category === "unknown") {
      warnings.push(`status '${input.status}' is not a recognized vitality level and will be recorded as-is`);
    }
  }
  for (const numField of ["nativeSpeakers", "totalSpeakers"] as const) {
    const value = input[numField];
    if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      errors.push(`${numField} must be a non-negative number`);
    }
  }
  if (
    input.confidence !== undefined &&
    (typeof input.confidence !== "number" || input.confidence < 1 || input.confidence > 100)
  ) {
    errors.push("confidence must be a number between 1 and 100");
  }
  if (input.researcherEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.researcherEmail)) {
    warnings.push("researcherEmail format appears invalid");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** A one-line human summary of a field update, for the changelog `summary`. */
export function fieldUpdateSummary(input: FieldUpdateInput): string {
  const parts: string[] = [];
  if (changedFields(input).includes("status")) {
    const from = input.currentStatus?.trim();
    parts.push(from ? `status ${from} → ${input.status}` : `status → ${input.status}`);
  }
  if (input.totalSpeakers !== undefined) parts.push(`total speakers → ${input.totalSpeakers}`);
  if (input.nativeSpeakers !== undefined) parts.push(`native speakers → ${input.nativeSpeakers}`);
  if (input.region !== undefined && String(input.region).trim()) parts.push(`region → ${input.region}`);
  const base = parts.length > 0 ? parts.join("; ") : "field-research update";
  return `${base} (field research by ${input.researcherName})`;
}

/**
 * Turn a validated field update into a `language` **edit** contribution so it rides
 * the existing contribution review pipeline (never a live TSV write). Provenance is
 * stamped `source: 'field-research'` + `fieldResearch: true`; the changed status/speaker
 * fields land in `entityData`. When exactly one field changed we also fill the per-field
 * `fieldName`/`currentValue`/`suggestedValue` triple the review UI uses.
 */
export function buildFieldUpdateContribution(input: FieldUpdateInput): Partial<Contribution> {
  const name = (input.languageName ?? input.languageId).trim();
  const entityData: Record<string, unknown> = {
    name,
    source: "field-research",
    fieldResearch: true,
  };
  if (input.status !== undefined && String(input.status).trim()) entityData.status = String(input.status).trim();
  if (input.nativeSpeakers !== undefined) entityData.nativeSpeakers = input.nativeSpeakers;
  if (input.totalSpeakers !== undefined) entityData.totalSpeakers = input.totalSpeakers;
  if (input.region !== undefined && String(input.region).trim()) entityData.region = String(input.region).trim();

  const changes = changedFields(input);
  const contribution: Partial<Contribution> = {
    entityType: "language",
    action: "edit",
    entityId: input.languageId.trim(),
    contributorName: input.researcherName.trim(),
    contributorEmail: input.researcherEmail?.trim() || undefined,
    entityData,
    sources: input.sources,
    confidence: input.confidence ?? 60,
    notes: input.notes?.trim() || undefined,
  };

  // Per-field edit metadata when a single field changed (the review UI's shape).
  if (changes.length === 1) {
    const field = changes[0];
    contribution.fieldName = field;
    if (field === "status") {
      contribution.currentValue = input.currentStatus?.trim() || undefined;
      contribution.suggestedValue = String(input.status).trim();
    } else {
      contribution.suggestedValue = String((input as unknown as Record<string, unknown>)[field]);
    }
  }

  return contribution;
}
