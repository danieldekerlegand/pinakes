export type ArtifactKind =
  | "material_culture"
  | "art_tradition"
  | "musical_instrument";

export interface ArtifactAnnotation {
  id: string;
  label: string;
  description: string;
  /** Normalized X position in [0, 1] relative to the image. */
  x: number;
  /** Normalized Y position in [0, 1] relative to the image. */
  y: number;
}

export interface ArtifactProvenance {
  discoverySite?: string;
  discoveryCoordinates?: { lat: number; lng: number };
  currentLocation?: string;
  discoveryDate?: string;
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  name: string;
  nativeName?: string;
  category?: string;
  description?: string;
  imageUrl?: string;
  materials?: string[];
  constructionTechnique?: string;
  originDate?: number;
  originRegion?: string;
  originCoordinates?: { lat: number; lng: number };
  culturalSignificance?: string;
  associatedCultureIds?: string[];
  associatedLanguageIds?: string[];
  annotations?: ArtifactAnnotation[];
  provenance?: ArtifactProvenance;
  tags?: string[];
  sources?: string[];
}

export interface MaterialCultureEntry {
  id: string;
  name: string;
  category?: string;
  origin_date?: number | string;
  origin_coordinates?: [number, number] | string;
  description?: string;
  associated_languages?: string | string[];
  significance?: string;
  image_url?: string;
  materials?: string | string[];
  construction_technique?: string;
  discovery_site?: string;
  current_location?: string;
  annotations?: ArtifactAnnotation[];
  tags?: string | string[];
  sources?: string | string[];
}

export interface ArtTraditionEntry {
  id: string;
  name: string;
  category?: string;
  style_period?: string;
  origin_date?: number | string;
  end_date?: number | string;
  origin_coordinates?: { lat: number; lng: number } | string;
  description?: string;
  associated_civilizations?: string | string[];
  associated_languages?: string | string[];
  key_features?: string | string[];
  notable_examples?: string | string[];
  image_url?: string;
  sources?: string | string[];
}

export interface MusicalInstrumentEntry {
  id: string;
  name: string;
  native_name?: string;
  instrument_family?: string;
  origin_region?: string;
  coordinates?: { lat: number; lng: number } | string;
  time_origin?: number | string;
  construction_materials?: string | string[];
  playing_technique?: string;
  associated_tradition_ids?: string | string[];
  associated_language_ids?: string | string[];
  description?: string;
  image_url?: string;
  sources?: string | string[];
}

const CATEGORY_COLORS: Record<string, string> = {
  pottery: "#b45309",
  sculpture: "#7c3aed",
  architecture: "#0891b2",
  painting: "#db2777",
  textiles: "#ca8a04",
  metalwork: "#64748b",
  jewelry: "#d946ef",
  weapon: "#991b1b",
  tool: "#4b5563",
  coin: "#facc15",
  string: "#ea580c",
  percussion: "#dc2626",
  wind: "#0284c7",
  keyboard: "#4338ca",
  other: "#475569",
};

const KIND_LABELS: Record<ArtifactKind, string> = {
  material_culture: "Material Culture",
  art_tradition: "Art Tradition",
  musical_instrument: "Musical Instrument",
};

export function getCategoryColor(category?: string | null): string {
  if (!category) return CATEGORY_COLORS.other;
  const key = category.toLowerCase();
  for (const k of Object.keys(CATEGORY_COLORS)) {
    if (key.includes(k)) return CATEGORY_COLORS[k];
  }
  return CATEGORY_COLORS.other;
}

export function getArtifactKindLabel(kind: ArtifactKind): string {
  return KIND_LABELS[kind] ?? kind;
}

export function formatOriginDate(year?: number | null): string {
  if (year === undefined || year === null || Number.isNaN(year)) return "—";
  if (year < 0) return `${Math.abs(year)} BCE`;
  if (year === 0) return "1 BCE/CE";
  return `${year} CE`;
}

export function clampZoom(scale: number, min: number, max: number): number {
  if (Number.isNaN(scale)) return min;
  return Math.max(min, Math.min(max, scale));
}

function parseList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? "" : String(item).trim()))
      .filter(Boolean);
  }
  const s = String(value).trim();
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (item == null ? "" : String(item).trim()))
          .filter(Boolean);
      }
    } catch {
      // fall through to delimiter splitting
    }
  }
  return s
    .split(/[|,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCoordinates(
  value: unknown,
): { lat: number; lng: number } | undefined {
  if (!value) return undefined;
  if (Array.isArray(value) && value.length === 2) {
    const [lat, lng] = value as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return undefined;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const lat = typeof obj.lat === "number" ? obj.lat : Number(obj.lat);
    const lng = typeof obj.lng === "number" ? obj.lng : Number(obj.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return undefined;
  }
  const s = String(value).trim();
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s);
    return parseCoordinates(parsed);
  } catch {
    const match = s.match(/-?\d+(?:\.\d+)?/g);
    if (match && match.length >= 2) {
      const lat = Number(match[0]);
      const lng = Number(match[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeMaterialCulture(
  entry: MaterialCultureEntry,
): Artifact {
  return {
    id: entry.id,
    kind: "material_culture",
    name: entry.name,
    category: entry.category,
    description: entry.description,
    imageUrl: entry.image_url,
    materials: parseList(entry.materials),
    constructionTechnique: entry.construction_technique,
    originDate: parseNumber(entry.origin_date),
    originCoordinates: parseCoordinates(entry.origin_coordinates),
    culturalSignificance: entry.significance,
    associatedLanguageIds: parseList(entry.associated_languages),
    annotations: entry.annotations ?? [],
    provenance: {
      discoverySite: entry.discovery_site,
      currentLocation: entry.current_location,
      discoveryCoordinates: parseCoordinates(entry.origin_coordinates),
    },
    tags: parseList(entry.tags),
    sources: parseList(entry.sources),
  };
}

export function normalizeArtTradition(entry: ArtTraditionEntry): Artifact {
  return {
    id: entry.id,
    kind: "art_tradition",
    name: entry.name,
    category: entry.category,
    description: entry.description,
    imageUrl: entry.image_url,
    materials: parseList(entry.key_features),
    originDate: parseNumber(entry.origin_date),
    originCoordinates: parseCoordinates(entry.origin_coordinates),
    culturalSignificance: entry.style_period
      ? `Style period: ${entry.style_period}`
      : undefined,
    associatedCultureIds: parseList(entry.associated_civilizations),
    associatedLanguageIds: parseList(entry.associated_languages),
    tags: parseList(entry.notable_examples),
    sources: parseList(entry.sources),
  };
}

export function normalizeMusicalInstrument(
  entry: MusicalInstrumentEntry,
): Artifact {
  return {
    id: entry.id,
    kind: "musical_instrument",
    name: entry.name,
    nativeName: entry.native_name,
    category: entry.instrument_family,
    description: entry.description,
    imageUrl: entry.image_url,
    materials: parseList(entry.construction_materials),
    constructionTechnique: entry.playing_technique,
    originDate: parseNumber(entry.time_origin),
    originRegion: entry.origin_region,
    originCoordinates: parseCoordinates(entry.coordinates),
    associatedCultureIds: parseList(entry.associated_tradition_ids),
    associatedLanguageIds: parseList(entry.associated_language_ids),
    sources: parseList(entry.sources),
  };
}

export interface ComparableOptions {
  limit?: number;
  /** Prefer artifacts from other cultures / traditions. */
  crossCultural?: boolean;
}

/**
 * Score artifacts against a reference for comparability. Higher score = more similar.
 * Preference is given to matching category and overlapping materials, with a bonus
 * for temporal proximity. When crossCultural=true, same-culture matches are demoted.
 */
export function scoreComparable(
  reference: Artifact,
  candidate: Artifact,
  crossCultural = false,
): number {
  if (candidate.id === reference.id) return -Infinity;
  let score = 0;
  if (
    reference.category &&
    candidate.category &&
    reference.category.toLowerCase() === candidate.category.toLowerCase()
  ) {
    score += 3;
  } else if (reference.kind === candidate.kind) {
    score += 1;
  }

  const refMaterials = new Set(
    (reference.materials ?? []).map((m) => m.toLowerCase()),
  );
  const candMaterials = (candidate.materials ?? []).map((m) => m.toLowerCase());
  const sharedMaterials = candMaterials.filter((m) => refMaterials.has(m));
  score += sharedMaterials.length * 0.5;

  if (
    typeof reference.originDate === "number" &&
    typeof candidate.originDate === "number"
  ) {
    const delta = Math.abs(reference.originDate - candidate.originDate);
    score += Math.max(0, 2 - delta / 1000);
  }

  const refCultures = new Set(reference.associatedCultureIds ?? []);
  const sharedCultures = (candidate.associatedCultureIds ?? []).filter((c) =>
    refCultures.has(c),
  ).length;
  if (crossCultural) {
    score -= sharedCultures * 1.5;
  } else {
    score += sharedCultures * 0.25;
  }

  return score;
}

export function findComparableArtifacts(
  reference: Artifact,
  pool: Artifact[],
  options: ComparableOptions = {},
): Artifact[] {
  const { limit = 4, crossCultural = false } = options;
  const scored = pool
    .filter((a) => a.id !== reference.id)
    .map((a) => ({ artifact: a, score: scoreComparable(reference, a, crossCultural) }))
    .filter((entry) => entry.score > -Infinity)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.artifact);
}

export function describeProvenance(artifact: Artifact): string {
  const parts: string[] = [];
  const p = artifact.provenance;
  if (p?.discoverySite) parts.push(`Discovered at ${p.discoverySite}`);
  if (p?.currentLocation) parts.push(`Housed at ${p.currentLocation}`);
  if (p?.discoveryDate) parts.push(`Recorded ${p.discoveryDate}`);
  if (artifact.originRegion && !p?.discoverySite) {
    parts.push(`Origin region: ${artifact.originRegion}`);
  }
  return parts.join(" · ");
}
