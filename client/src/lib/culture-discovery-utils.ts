import type { CultureProfile } from "@shared/types";

export type CuratedCollection = {
  id: string;
  name: string;
  description: string;
  matches: (profile: CultureProfile) => boolean;
};

export const CURATED_COLLECTIONS: CuratedCollection[] = [
  {
    id: "river-civilizations",
    name: "Ancient River Civilizations",
    description: "Societies that arose along the great rivers of the ancient world.",
    matches: (p) => {
      const riverRegions = new Set([
        "Mesopotamia",
        "Nile Valley",
        "South Asia",
        "East Asia",
      ]);
      const riverIds = new Set([
        "cp-sumerian",
        "cp-akkadian",
        "cp-babylonian",
        "cp-assyrian",
        "cp-ancient-egypt",
        "cp-indus-valley",
        "cp-shang",
        "cp-zhou",
        "cp-han",
      ]);
      return (
        riverIds.has(p.id) ||
        (riverRegions.has(p.region) && p.timePeriodStart <= -500 && p.subsistenceType === "agricultural")
      );
    },
  },
  {
    id: "mesoamerican",
    name: "Mesoamerican Cultures",
    description: "Civilizations of ancient and classical Mesoamerica.",
    matches: (p) => p.region === "Mesoamerica",
  },
  {
    id: "steppe-empires",
    name: "Steppe Empires",
    description: "Nomadic and post-nomadic powers of the Eurasian steppe.",
    matches: (p) => {
      const steppeIds = new Set([
        "cp-scythian",
        "cp-xiongnu",
        "cp-mongol",
        "cp-hun",
        "cp-turkic-khaganate",
        "cp-khazar",
        "cp-kipchak",
        "cp-avar",
      ]);
      if (steppeIds.has(p.id)) return true;
      return p.region === "Central Asia" && p.subsistenceType === "pastoral";
    },
  },
  {
    id: "maritime-cultures",
    name: "Maritime Cultures",
    description: "Seafaring societies built around trade and coastal life.",
    matches: (p) => p.subsistenceType === "maritime",
  },
  {
    id: "great-empires",
    name: "Great Empires",
    description: "States that ruled vast, multi-ethnic territories.",
    matches: (p) => p.socialOrganization === "empire",
  },
  {
    id: "bronze-age",
    name: "Bronze Age Cultures",
    description: "Societies of the metalworking revolution.",
    matches: (p) => p.technologyLevel === "bronze",
  },
];

export function pickCultureOfTheDay(
  profiles: CultureProfile[],
  date: Date = new Date(),
): CultureProfile | null {
  if (profiles.length === 0) return null;
  const epoch = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayIndex = Math.floor(epoch / (24 * 60 * 60 * 1000));
  const sorted = [...profiles].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[dayIndex % sorted.length];
}

export function pickRandomCulture(
  profiles: CultureProfile[],
  excludeIds: string[] = [],
  rng: () => number = Math.random,
): CultureProfile | null {
  const pool = profiles.filter((p) => !excludeIds.includes(p.id));
  const candidates = pool.length > 0 ? pool : profiles;
  if (candidates.length === 0) return null;
  const idx = Math.floor(rng() * candidates.length);
  return candidates[Math.min(idx, candidates.length - 1)];
}

export function filterProfilesBySearch(
  profiles: CultureProfile[],
  query: string,
): CultureProfile[] {
  const q = query.trim().toLowerCase();
  if (!q) return profiles;
  return profiles.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if (p.region.toLowerCase().includes(q)) return true;
    if (p.summaryDescription.toLowerCase().includes(q)) return true;
    if (p.alternateNames.some((n) => n.toLowerCase().includes(q))) return true;
    if (p.notableSettlements.some((s) => s.toLowerCase().includes(q))) return true;
    return false;
  });
}

export function getCollectionProfiles(
  profiles: CultureProfile[],
  collection: CuratedCollection,
  limit = 12,
): CultureProfile[] {
  return profiles.filter(collection.matches).slice(0, limit);
}

const RECENTLY_VIEWED_KEY = "pinakes:recently-viewed-cultures";
const RECENTLY_VIEWED_MAX = 8;

export function loadRecentlyViewed(
  storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null,
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, RECENTLY_VIEWED_MAX);
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(
  cultureId: string,
  existing: string[],
): string[] {
  const deduped = [cultureId, ...existing.filter((id) => id !== cultureId)];
  return deduped.slice(0, RECENTLY_VIEWED_MAX);
}

export function saveRecentlyViewed(
  ids: string[],
  storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" ? window.localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(ids.slice(0, RECENTLY_VIEWED_MAX)));
  } catch {
    // ignore quota errors
  }
}

export function resolveProfilesByIds(
  profiles: CultureProfile[],
  ids: string[],
): CultureProfile[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const result: CultureProfile[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) result.push(p);
  }
  return result;
}

export const RECENTLY_VIEWED_CONFIG = {
  key: RECENTLY_VIEWED_KEY,
  max: RECENTLY_VIEWED_MAX,
};
