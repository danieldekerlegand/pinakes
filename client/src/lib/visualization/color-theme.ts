/**
 * Centralized color theming system for all visualizations.
 *
 * All domain-specific color palettes, interaction state colors, and
 * shared utility colors live here so every visualization draws from
 * a single source of truth.
 */

// ---------------------------------------------------------------------------
// Core palette – the 10 hues shared across categorical visualizations
// ---------------------------------------------------------------------------
export const CORE_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
] as const;

// ---------------------------------------------------------------------------
// Interaction / state colors (selection, highlights, defaults)
// ---------------------------------------------------------------------------
export const INTERACTION_COLORS = {
  selected: '#3b82f6',
  selectedBorder: '#1d4ed8',
  highlighted: '#60a5fa',
  highlightedBorder: '#3b82f6',
  pinned: '#ef4444',
  defaultNodeBorder: '#ffffff',
  defaultLink: '#cbd5e0',
  defaultFallback: '#6b7280',
  flashFill: '#fbbf24',
  flashBorder: '#f59e0b',
} as const;

// ---------------------------------------------------------------------------
// Text colors used within D3/Canvas visualizations
// ---------------------------------------------------------------------------
export const VIS_TEXT_COLORS = {
  dark: '#374151',
  darker: '#1f2937',
  darkest: '#1e293b',
  muted: '#9ca3af',
  axisDomain: '#d1d5db',
  axisTick: '#e5e7eb',
  axisLabel: '#6b7280',
} as const;

// ---------------------------------------------------------------------------
// Node / element colors for Cultural Lineage Explorer
// ---------------------------------------------------------------------------
export const NODE_STATE_COLORS = {
  selectedFill: '#2563eb',
  highlightedFill: '#60a5fa',
  defaultFill: '#cbd5e1',
  selectedStroke: '#1d4ed8',
  highlightedStroke: '#3b82f6',
  defaultStroke: '#94a3b8',
} as const;

// ---------------------------------------------------------------------------
// Language status
// ---------------------------------------------------------------------------
export const STATUS_COLORS: Record<string, string> = {
  living: '#10b981',
  endangered: '#f59e0b',
  extinct: '#6b7280',
  historical: '#8b5cf6',
  constructed: '#3b82f6',
  revived: '#14b8a6',
};

// ---------------------------------------------------------------------------
// Tree hierarchy level colors (background & border)
// ---------------------------------------------------------------------------
export const LEVEL_BG_COLORS = [
  '#dbeafe', // blue-100
  '#d1fae5', // green-100
  '#fed7aa', // orange-100
  '#e5e7eb', // gray-200
] as const;

export const LEVEL_BORDER_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // green-500
  '#f97316', // orange-500
  '#6b7280', // gray-500
] as const;

// ---------------------------------------------------------------------------
// Domain-specific palettes
// ---------------------------------------------------------------------------

export const CONTACT_TYPE_COLORS: Record<string, string> = {
  superstrate: '#ef4444',
  substrate: '#f59e0b',
  adstrate: '#3b82f6',
  creole: '#8b5cf6',
  pidgin: '#ec4899',
  borrowing: '#10b981',
};

export const LANGUAGE_CONTACT_COLORS: Record<string, string> = {
  substrate: '#8b5cf6',
  superstrate: '#ef4444',
  adstrate: '#3b82f6',
  borrowing: '#22c55e',
};

export const RELATIONSHIP_COLORS: Record<string, string> = {
  'split-from': '#3b82f6',
  'evolved-into': '#10b981',
  'gave-rise-to': '#f59e0b',
  'influenced': '#8b5cf6',
  'associated-with': '#ec4899',
  'possibly-associated': '#94a3b8',
  'preceded-by': '#f97316',
};

export const RELIGION_COLORS: Record<string, string> = {
  monotheistic: '#2563eb',
  polytheistic: '#dc2626',
  nontheistic: '#16a34a',
  animistic: '#d97706',
  philosophical: '#7c3aed',
  dualistic: '#0891b2',
};

export const MYTHOLOGY_COLORS: Record<string, string> = {
  greek: '#3b82f6',
  roman: '#ef4444',
  norse: '#6366f1',
  hindu: '#f59e0b',
  egyptian: '#d97706',
  mesopotamian: '#8b5cf6',
  japanese: '#ec4899',
  aztec: '#10b981',
  slavic: '#06b6d4',
  celtic: '#84cc16',
};

export const HAPLOGROUP_COLORS: Record<string, string> = {
  'Y-DNA': '#16a34a',
  mtDNA: '#9333ea',
};

export const COOKING_TECHNIQUE_COLORS: Record<string, string> = {
  heat: '#ef4444',
  fermentation: '#22c55e',
  preservation: '#3b82f6',
  preparation: '#f97316',
  sauce: '#a855f7',
  dough: '#eab308',
  dairy: '#14b8a6',
  beverage: '#6366f1',
};

export const DANCE_TYPE_COLORS: Record<string, string> = {
  classical: '#7c3aed',
  folk: '#16a34a',
  ceremonial: '#e11d48',
  social: '#f59e0b',
  martial: '#dc2626',
  spiritual: '#0891b2',
  contemporary: '#2563eb',
};

export const KINSHIP_SYSTEM_COLORS: Record<string, string> = {
  Eskimo: '#2563eb',
  Hawaiian: '#dc2626',
  Sudanese: '#16a34a',
  Iroquois: '#d97706',
  Crow: '#7c3aed',
  Omaha: '#0891b2',
  Dravidian: '#db2777',
  Descriptive: '#65a30d',
};

export const KINSHIP_TERM_COLORS: Record<string, string> = {
  mother: '#ec4899',
  father: '#3b82f6',
  sister: '#f472b6',
  brother: '#60a5fa',
  aunt: '#a855f7',
  uncle: '#8b5cf6',
  cousin: '#f59e0b',
};

export const MATERIAL_CULTURE_COLORS: Record<string, string> = {
  pottery: '#d97706',
  metallurgy: '#6b7280',
  tools: '#92400e',
  agriculture: '#16a34a',
  textiles: '#7c3aed',
  architecture: '#dc2626',
  weapons: '#1e293b',
  writing: '#2563eb',
  navigation: '#0891b2',
  printing: '#4f46e5',
  glasswork: '#06b6d4',
  unknown: '#9ca3af',
};

export const ARCHAEOLOGICAL_SITE_COLORS: Record<string, string> = {
  settlement: '#f59e0b',
  burial: '#ef4444',
  temple: '#8b5cf6',
  ceremonial: '#8b5cf6',
  fortification: '#64748b',
  workshop: '#06b6d4',
  unknown: '#9ca3af',
};

export const ARCHAEOLOGICAL_CULTURE_PALETTE = [
  '#d97706', // amber-600
  '#dc2626', // red-600
  '#7c3aed', // violet-600
  '#059669', // emerald-600
  '#2563eb', // blue-600
  '#db2777', // pink-600
  '#ca8a04', // yellow-600
  '#0891b2', // cyan-600
  '#9333ea', // purple-600
  '#ea580c', // orange-600
] as const;

export const CIVILIZATION_PALETTE = [
  '#c084fc', // purple-400
  '#f472b6', // pink-400
  '#fb923c', // orange-400
  '#34d399', // emerald-400
  '#60a5fa', // blue-400
  '#a78bfa', // violet-400
] as const;

export const ROUTE_TYPE_COLORS: Record<string, string> = {
  trade: '#22c55e',
  migration: '#3b82f6',
  conquest: '#ef4444',
  colonization: '#f97316',
  diaspora: '#eab308',
  pilgrimage: '#a855f7',
  communication: '#06b6d4',
  unknown: '#9ca3af',
};

export const FOODWAY_MECHANISM_COLORS: Record<string, string> = {
  trade: '#22c55e',
  colonization: '#ef4444',
  migration: '#3b82f6',
  conquest: '#f97316',
};

export const BATTLE_COLORS = {
  fill: '#ef4444',
  border: '#dc2626',
} as const;

export const GENETIC_CORRELATION_COLORS = {
  divergence: '#ef4444',
  strong: '#22c55e',
  moderate: '#eab308',
  weak: '#f97316',
  yChromosome: '#16a34a',
  mtDNA: '#9333ea',
} as const;

export const BOUNDARY_DRAWING_COLORS = {
  shape: '#3b82f6',
  shapeFill: '#3b82f680',
  vertexSelected: '#ef4444',
} as const;

// ---------------------------------------------------------------------------
// Region palettes (shared across cuisine, architecture, music, ingredients)
// ---------------------------------------------------------------------------

export const REGION_COLORS: Record<string, string> = {
  'East Asia': '#ef4444',
  'South Asia': '#f97316',
  'Southeast Asia': '#eab308',
  'Middle East': '#84cc16',
  'East Africa': '#22c55e',
  'Southern Europe': '#14b8a6',
  'Western Europe': '#3b82f6',
  'Central Europe': '#6366f1',
  'Eastern Europe': '#8b5cf6',
  'Northern Europe': '#3b82f6',
  'North Africa': '#f59e0b',
  'West Africa': '#22c55e',
  'Central Africa': '#65a30d',
  'South America': '#f43f5e',
  'Central America': '#14b8a6',
  'North America': '#ec4899',
  Caucasus: '#a855f7',
  'Central Asia': '#a855f7',
  Mediterranean: '#14b8a6',
  Mesoamerica: '#ec4899',
  Andes: '#f43f5e',
  'Fertile Crescent': '#84cc16',
  Africa: '#22c55e',
  'North Atlantic': '#6366f1',
  Japan: '#ef4444',
  Greece: '#14b8a6',
  Iran: '#84cc16',
  'Southern China': '#ef4444',
  Oceania: '#0284c7',
};

export const MUSIC_REGION_COLORS: Record<string, string> = {
  'East Asia': '#c026d3',
  'South Asia': '#e11d48',
  'Southeast Asia': '#f59e0b',
  'Middle East': '#0891b2',
  'West Africa': '#16a34a',
  'Central Africa': '#65a30d',
  'Southern Europe': '#2563eb',
  'Western Europe': '#7c3aed',
  'North America': '#dc2626',
  'South America': '#ea580c',
  'Central Asia': '#0d9488',
  Caucasus: '#9333ea',
  Oceania: '#0284c7',
};

export const ARCHITECTURE_REGION_COLORS: Record<string, string> = {
  'North Africa': '#f59e0b',
  'Southern Europe': '#3b82f6',
  'Eastern Europe': '#8b5cf6',
  'Western Europe': '#6366f1',
  'Middle East': '#10b981',
  'South Asia': '#f97316',
  'East Asia': '#ef4444',
  'Southeast Asia': '#eab308',
  'Central America': '#14b8a6',
  'South America': '#ec4899',
  'West Africa': '#22c55e',
  'North America': '#a855f7',
};

// ---------------------------------------------------------------------------
// Slider / UI control colors
// ---------------------------------------------------------------------------
export const SLIDER_COLORS = {
  track: '#3b82f6',
  rail: '#e5e7eb',
} as const;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Convert a hex color to rgba with the given opacity */
export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Deterministic hash-based index into a palette */
export function hashIndex(key: string, paletteLength: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % paletteLength;
}

/** Get a color from a palette by hashing a string key */
export function paletteColor(key: string, palette: readonly string[]): string {
  return palette[hashIndex(key, palette.length)];
}

/** Look up a domain color with a fallback */
export function domainColor(
  map: Record<string, string>,
  key: string,
  fallback: string = INTERACTION_COLORS.defaultFallback,
): string {
  return map[key] ?? fallback;
}

/** Get a correlation strength color */
export function correlationColor(score: number, isDivergence: boolean): string {
  if (isDivergence) return GENETIC_CORRELATION_COLORS.divergence;
  if (score >= 0.7) return GENETIC_CORRELATION_COLORS.strong;
  if (score >= 0.4) return GENETIC_CORRELATION_COLORS.moderate;
  return GENETIC_CORRELATION_COLORS.weak;
}
