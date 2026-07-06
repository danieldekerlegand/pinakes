/**
 * Culture stewardship — "adopt a culture" ownership model (US-012).
 *
 * A steward adopts one or more **cultural domains** (a culture id, a region, or
 * an entity type). Stewards of a contribution's domain carry extra weight in the
 * multi-confirmation flow (`community-verification.ts`): their confirmation
 * lowers the required-reviewer bar, so domain expertise scales data quality.
 *
 * The model rules are **pure** (adopt / release / lookups take `now` as a
 * param); a thin `StewardshipStore` persists them as a single JSON file, mirroring
 * the JSON-on-disk pattern used by `contribution-service.ts` / `collections.ts`.
 */

import fs from "fs";
import path from "path";
import type { Contribution } from "./contribution-service";

// ============================================================================
// Model
// ============================================================================

export interface StewardAdoption {
  /** The steward (an opaque name/id — no auth). */
  steward: string;
  /** Normalized cultural-domain key (see `normalizeDomain`). */
  domain: string;
  adoptedAt: string;
  note?: string;
}

/** Normalize a domain string to a stable key (lowercase kebab). */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Normalize a steward name for identity comparison (trim + lowercase). */
export function stewardKey(steward: string): string {
  return steward.trim().toLowerCase();
}

function sameAdoption(a: StewardAdoption, steward: string, domain: string): boolean {
  return stewardKey(a.steward) === stewardKey(steward) && a.domain === normalizeDomain(domain);
}

export type AdoptResult =
  | { adoptions: StewardAdoption[]; adoption: StewardAdoption; alreadyOwned: false }
  | { adoptions: StewardAdoption[]; adoption: StewardAdoption; alreadyOwned: true };

/**
 * Adopt a domain for a steward. Idempotent: re-adopting an owned domain returns
 * the existing adoption with `alreadyOwned: true` and leaves the list unchanged.
 * Pure.
 */
export function adoptDomain(
  adoptions: StewardAdoption[],
  input: { steward: string; domain: string; now: string; note?: string },
): AdoptResult {
  const domain = normalizeDomain(input.domain);
  const existing = adoptions.find((a) => sameAdoption(a, input.steward, domain));
  if (existing) {
    return { adoptions, adoption: existing, alreadyOwned: true };
  }
  const adoption: StewardAdoption = {
    steward: input.steward.trim(),
    domain,
    adoptedAt: input.now,
    note: input.note,
  };
  return { adoptions: [...adoptions, adoption], adoption, alreadyOwned: false };
}

/** Release a steward's claim on a domain. Pure. Returns whether anything changed. */
export function releaseDomain(
  adoptions: StewardAdoption[],
  steward: string,
  domain: string,
): { adoptions: StewardAdoption[]; released: boolean } {
  const next = adoptions.filter((a) => !sameAdoption(a, steward, domain));
  return { adoptions: next, released: next.length !== adoptions.length };
}

/** Stewards who have adopted the given domain (original casing). */
export function stewardsForDomain(adoptions: StewardAdoption[], domain: string): string[] {
  const key = normalizeDomain(domain);
  return adoptions.filter((a) => a.domain === key).map((a) => a.steward);
}

/** Domains a steward has adopted. */
export function domainsForSteward(adoptions: StewardAdoption[], steward: string): string[] {
  return adoptions.filter((a) => stewardKey(a.steward) === stewardKey(steward)).map((a) => a.domain);
}

/** True when `steward` owns `domain`. Pure. */
export function isStewardOf(
  adoptions: StewardAdoption[],
  steward: string,
  domain: string,
): boolean {
  return adoptions.some((a) => sameAdoption(a, steward, domain));
}

/**
 * Resolve the cultural domain a contribution belongs to, for stewardship
 * matching: an explicit `entityData.culturalDomain`, else the entity name
 * (its own culture, for a civilization/culture add), else the entity type. Pure.
 */
export function resolveContributionDomain(contribution: Contribution): string {
  const data = (contribution.entityData ?? {}) as Record<string, unknown>;
  const explicit = data.culturalDomain ?? data.cultureId ?? data.associatedCultureId;
  if (typeof explicit === "string" && explicit.trim()) return normalizeDomain(explicit);
  if (
    (contribution.entityType === "civilization") &&
    typeof data.name === "string" &&
    data.name.trim()
  ) {
    return normalizeDomain(data.name);
  }
  return normalizeDomain(contribution.entityType);
}

// ============================================================================
// Store
// ============================================================================

/**
 * Persists steward adoptions as a single JSON file (`stewards.json`) under an
 * injectable directory (default `data/stewardship`). Every mutation delegates to
 * the pure model functions above; the store owns only the fs + clock boundary.
 */
export class StewardshipStore {
  private dir: string;
  private file: string;

  constructor(dataDir: string = "data/stewardship") {
    this.dir = path.resolve(dataDir);
    this.file = path.join(this.dir, "stewards.json");
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private read(): StewardAdoption[] {
    if (!fs.existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      return Array.isArray(parsed) ? (parsed as StewardAdoption[]) : [];
    } catch {
      return [];
    }
  }

  private write(adoptions: StewardAdoption[]): void {
    fs.writeFileSync(this.file, JSON.stringify(adoptions, null, 2), "utf-8");
  }

  list(): StewardAdoption[] {
    return this.read();
  }

  listForDomain(domain: string): StewardAdoption[] {
    const key = normalizeDomain(domain);
    return this.read().filter((a) => a.domain === key);
  }

  adopt(input: { steward: string; domain: string; note?: string; now?: string }): AdoptResult {
    const now = input.now ?? new Date().toISOString();
    const result = adoptDomain(this.read(), { ...input, now });
    if (!result.alreadyOwned) this.write(result.adoptions);
    return result;
  }

  release(steward: string, domain: string): boolean {
    const { adoptions, released } = releaseDomain(this.read(), steward, domain);
    if (released) this.write(adoptions);
    return released;
  }

  isSteward(steward: string, domain: string): boolean {
    return isStewardOf(this.read(), steward, domain);
  }
}
