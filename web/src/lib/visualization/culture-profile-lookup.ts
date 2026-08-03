import type { CultureProfile } from '@contracts/types';

/**
 * Given a clicked map feature id (a civilization id, archaeological culture id,
 * or culture profile id), return the matching CultureProfile id or null.
 *
 * Supports three lookup paths so any of the existing map layers can surface a
 * culture profile without needing a dedicated culture-profile layer:
 *   1. Direct match on profile.id
 *   2. Match on profile.civilizationId
 *   3. Match on profile.archaeologicalCultureId
 */
export function findCultureProfileIdForFeature(
  featureId: string,
  profiles: readonly CultureProfile[],
): string | null {
  if (!featureId || profiles.length === 0) return null;

  for (const p of profiles) {
    if (p.id === featureId) return p.id;
    if (p.civilizationId === featureId) return p.id;
    if (p.archaeologicalCultureId === featureId) return p.id;
  }
  return null;
}
