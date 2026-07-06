/**
 * Community verification — multi-confirmation threshold logic (US-012).
 *
 * A single reviewer approving a contribution is a weak signal. This module lets
 * **N distinct reviewers** independently *confirm* a contribution; each
 * confirmation raises its confidence, and once enough distinct reviewers agree
 * the contribution is **verified** (it may go live). A steward of the
 * contribution's cultural domain (see `stewardship.ts`) carries extra weight —
 * their confirmation lowers the required-reviewer bar — so data quality scales
 * with domain ownership.
 *
 * Everything here is **pure** (no fs / clock / express): the caller passes the
 * confirmation list, the config, and — for `now`-stamped confirmations — the
 * clock. The persistence + orchestration lives in `ContributionService.confirm`
 * and the route; the *threshold logic* (the part the ACs require tests for)
 * lives here and is unit-tested directly.
 */

// ============================================================================
// Types
// ============================================================================

export interface Confirmation {
  /** The reviewer who confirmed. Deduped case-insensitively / trimmed. */
  reviewer: string;
  confirmedAt: string;
  /** True when the reviewer is a steward of the contribution's domain. */
  isSteward?: boolean;
  /** The domain the steward owns (recorded for provenance/attribution). */
  domain?: string;
  note?: string;
}

export interface VerificationConfig {
  /** Distinct reviewers required to verify when no steward has confirmed. */
  threshold: number;
  /** Distinct reviewers required once a steward of the domain has confirmed. */
  stewardThreshold: number;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  threshold: 3,
  stewardThreshold: 1,
};

/** Confidence a fully-verified contribution ramps toward (< 100 stays honest). */
export const VERIFIED_CONFIDENCE = 99;

export interface VerificationState {
  confirmations: Confirmation[];
  /** Count of distinct reviewers. */
  distinctReviewers: number;
  /** Reviewers required to verify given the current confirmations. */
  required: number;
  verified: boolean;
  /** 1..100 confidence after applying the confirmations to the base. */
  confidence: number;
  /** True when at least one steward of the domain has confirmed. */
  stewardConfirmed: boolean;
  /** Distinct steward reviewers (for attribution). */
  stewards: string[];
}

// ============================================================================
// Pure helpers
// ============================================================================

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Normalized dedup key for a reviewer name. */
export function reviewerKey(reviewer: string): string {
  return reviewer.trim().toLowerCase();
}

/** Load the verification config from the environment (with sane defaults). */
export function loadVerificationConfig(
  env: NodeJS.ProcessEnv = process.env,
): VerificationConfig {
  const parse = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  };
  const threshold = parse(env.VERIFICATION_THRESHOLD, DEFAULT_VERIFICATION_CONFIG.threshold);
  const stewardThreshold = parse(
    env.VERIFICATION_STEWARD_THRESHOLD,
    DEFAULT_VERIFICATION_CONFIG.stewardThreshold,
  );
  // A steward should never need *more* confirmations than a non-steward path.
  return { threshold, stewardThreshold: Math.min(stewardThreshold, threshold) };
}

export type AddConfirmationResult =
  | { confirmations: Confirmation[]; added: true }
  | { confirmations: Confirmation[]; added: false; reason: "duplicate" };

/**
 * Add a confirmation, deduping by reviewer (a reviewer's repeated confirmation
 * is ignored — independence is the whole point). Pure.
 */
export function addConfirmation(
  existing: Confirmation[],
  confirmation: Confirmation,
): AddConfirmationResult {
  const key = reviewerKey(confirmation.reviewer);
  if (existing.some((c) => reviewerKey(c.reviewer) === key)) {
    return { confirmations: existing, added: false, reason: "duplicate" };
  }
  return { confirmations: [...existing, confirmation], added: true };
}

/** Count of distinct reviewers across the confirmations. */
export function distinctReviewers(confirmations: Confirmation[]): number {
  return new Set(confirmations.map((c) => reviewerKey(c.reviewer))).size;
}

/** Distinct steward reviewers (original casing, first-seen order). */
export function stewardReviewers(confirmations: Confirmation[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of confirmations) {
    if (!c.isSteward) continue;
    const key = reviewerKey(c.reviewer);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.reviewer.trim());
  }
  return out;
}

export function hasStewardConfirmation(confirmations: Confirmation[]): boolean {
  return confirmations.some((c) => c.isSteward === true);
}

/**
 * Distinct reviewers required to verify given the current confirmations: the
 * lower steward bar once a domain steward has confirmed, else the full bar.
 */
export function requiredConfirmations(
  confirmations: Confirmation[],
  config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
): number {
  return hasStewardConfirmation(confirmations) ? config.stewardThreshold : config.threshold;
}

/** True when enough distinct reviewers have confirmed to verify. */
export function isVerified(
  confirmations: Confirmation[],
  config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
): boolean {
  return distinctReviewers(confirmations) >= requiredConfirmations(confirmations, config);
}

/**
 * Confidence after applying the confirmations to a base confidence (1..100).
 * Ramps linearly from `base` toward `VERIFIED_CONFIDENCE` with confirmation
 * progress; never lowers the base. Pure.
 */
export function computeConfidence(
  base: number,
  confirmations: Confirmation[],
  config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
): number {
  const b = clamp(Math.round(base), 1, 100);
  const distinct = distinctReviewers(confirmations);
  if (distinct === 0) return b;
  const required = Math.max(1, requiredConfirmations(confirmations, config));
  const progress = Math.min(1, distinct / required);
  const ramped = Math.round(b + (VERIFIED_CONFIDENCE - b) * progress);
  return clamp(Math.max(b, ramped), 1, 100);
}

/**
 * Summarize the full verification state for a base confidence + confirmations.
 * The one call the service / route use to derive everything client-facing.
 */
export function summarizeVerification(
  base: number,
  confirmations: Confirmation[],
  config: VerificationConfig = DEFAULT_VERIFICATION_CONFIG,
): VerificationState {
  return {
    confirmations,
    distinctReviewers: distinctReviewers(confirmations),
    required: requiredConfirmations(confirmations, config),
    verified: isVerified(confirmations, config),
    confidence: computeConfidence(base, confirmations, config),
    stewardConfirmed: hasStewardConfirmation(confirmations),
    stewards: stewardReviewers(confirmations),
  };
}
