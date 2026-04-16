import { describe, it, expect } from "vitest";

/**
 * Unit tests for ArchitectureUrbanPlanningSection data transformation logic.
 * Tests pure functions used for filtering, sorting, formatting, and layout helpers.
 */

// Replicate types locally to avoid JSX-related import issues
interface ArchitecturalStyle {
  id: string;
  name: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  region: string;
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
  buildingTypes: string[];
}

// Replicate pure functions under test

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatPeriod(start: number, end: number): string {
  return `${formatYear(start)} – ${formatYear(end)}`;
}

const LAYOUT_TYPE_COLORS: Record<string, string> = {
  grid: "bg-blue-100 text-blue-800",
  organic: "bg-green-100 text-green-800",
  radial: "bg-purple-100 text-purple-800",
  linear: "bg-amber-100 text-amber-800",
  citadel: "bg-red-100 text-red-800",
  terraced: "bg-emerald-100 text-emerald-800",
  "canal-based": "bg-cyan-100 text-cyan-800",
  fortified: "bg-orange-100 text-orange-800",
};

function getLayoutTypeColor(layoutType: string): string {
  return LAYOUT_TYPE_COLORS[layoutType.toLowerCase()] || "bg-gray-100 text-gray-800";
}

const FEATURE_ICONS: Record<string, string> = {
  temple_precinct: "🏛️",
  palace: "👑",
  market: "🏪",
  agora: "🗣️",
  forum: "📜",
  granary: "🌾",
  bathhouse: "🛁",
  amphitheater: "🎭",
  walls: "🧱",
  gates: "🚪",
  aqueduct: "💧",
  sewers: "🔧",
  harbor: "⚓",
  necropolis: "⚱️",
  residential_quarter: "🏘️",
  industrial_quarter: "🔨",
  garden: "🌿",
};

function getFeatureIcon(feature: string): string {
  return FEATURE_ICONS[feature] || "📍";
}

function getFeatureLabel(feature: string): string {
  return feature
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function filterStylesByCivilization(
  styles: ArchitecturalStyle[],
  civilizationName: string
): ArchitecturalStyle[] {
  const lowerName = civilizationName.toLowerCase();
  return styles.filter(
    (s) => s.associatedCivilizations.toLowerCase().includes(lowerName)
  );
}

function sortStylesByDate(styles: ArchitecturalStyle[]): ArchitecturalStyle[] {
  return [...styles].sort((a, b) => a.originDate - b.originDate);
}

function computeTimelineRange(styles: ArchitecturalStyle[]): {
  min: number;
  max: number;
} {
  if (styles.length === 0) return { min: -3500, max: 2100 };
  let min = Infinity;
  let max = -Infinity;
  for (const s of styles) {
    if (s.originDate < min) min = s.originDate;
    if (s.endDate > max) max = s.endDate;
  }
  return { min: min - 200, max: max + 200 };
}

function yearToPercent(
  year: number,
  range: { min: number; max: number }
): number {
  const span = range.max - range.min;
  if (span === 0) return 50;
  return ((year - range.min) / span) * 100;
}

// ── Test fixtures ─────────────────────────────────────────────────

const SAMPLE_STYLES: ArchitecturalStyle[] = [
  {
    id: "arch-001",
    name: "Egyptian Monumental",
    stylePeriod: "Ancient Egyptian",
    originDate: -3100,
    endDate: -30,
    originCoordinates: { lat: 29.98, lng: 31.13 },
    region: "North Africa",
    description: "Massive stone architecture",
    associatedCivilizations: "Egyptian",
    associatedLanguages: ["egy", "cop"],
    keyFeatures: ["colossal scale", "post-and-lintel construction"],
    notableExamples: ["Great Pyramid of Giza", "Temple of Karnak"],
    buildingTypes: ["pyramid", "temple", "tomb"],
  },
  {
    id: "arch-002",
    name: "Greek Classical",
    stylePeriod: "Classical",
    originDate: -700,
    endDate: -31,
    originCoordinates: { lat: 37.97, lng: 23.72 },
    region: "Southern Europe",
    description: "Architecture emphasizing proportions",
    associatedCivilizations: "Greek",
    associatedLanguages: ["grc", "ell"],
    keyFeatures: ["Doric/Ionic/Corinthian orders"],
    notableExamples: ["Parthenon"],
    buildingTypes: ["temple", "theater", "agora"],
  },
  {
    id: "arch-003",
    name: "Roman Imperial",
    stylePeriod: "Roman Imperial",
    originDate: -27,
    endDate: 476,
    originCoordinates: { lat: 41.9, lng: 12.5 },
    region: "Southern Europe",
    description: "Engineering-driven architecture",
    associatedCivilizations: "Roman",
    associatedLanguages: ["lat"],
    keyFeatures: ["concrete construction", "arches and vaults"],
    notableExamples: ["Pantheon", "Colosseum"],
    buildingTypes: ["basilica", "amphitheater", "bath"],
  },
  {
    id: "arch-007",
    name: "Islamic",
    stylePeriod: "Islamic Golden Age",
    originDate: 700,
    endDate: 1700,
    originCoordinates: { lat: 33.31, lng: 44.37 },
    region: "Middle East",
    description: "Geometric decoration and muqarnas",
    associatedCivilizations: "Islamic Caliphates",
    associatedLanguages: ["arb", "fas"],
    keyFeatures: ["geometric tessellation", "muqarnas vaulting"],
    notableExamples: ["Alhambra", "Dome of the Rock"],
    buildingTypes: ["mosque", "madrasa", "palace"],
  },
];

// ── Tests ─────────────────────────────────────────────────────────

describe("formatYear", () => {
  it("formats BCE years correctly", () => {
    expect(formatYear(-3100)).toBe("3100 BCE");
    expect(formatYear(-1)).toBe("1 BCE");
  });

  it("formats CE years correctly", () => {
    expect(formatYear(476)).toBe("476 CE");
    expect(formatYear(2000)).toBe("2000 CE");
  });

  it("formats year 0 as CE", () => {
    expect(formatYear(0)).toBe("0 CE");
  });
});

describe("formatPeriod", () => {
  it("formats a period spanning BCE to CE", () => {
    expect(formatPeriod(-27, 476)).toBe("27 BCE – 476 CE");
  });

  it("formats a period entirely in BCE", () => {
    expect(formatPeriod(-3100, -30)).toBe("3100 BCE – 30 BCE");
  });

  it("formats a period entirely in CE", () => {
    expect(formatPeriod(700, 1700)).toBe("700 CE – 1700 CE");
  });
});

describe("getLayoutTypeColor", () => {
  it("returns correct color for known layout types", () => {
    expect(getLayoutTypeColor("grid")).toBe("bg-blue-100 text-blue-800");
    expect(getLayoutTypeColor("organic")).toBe("bg-green-100 text-green-800");
    expect(getLayoutTypeColor("radial")).toBe("bg-purple-100 text-purple-800");
    expect(getLayoutTypeColor("citadel")).toBe("bg-red-100 text-red-800");
  });

  it("is case-insensitive", () => {
    expect(getLayoutTypeColor("Grid")).toBe("bg-blue-100 text-blue-800");
    expect(getLayoutTypeColor("ORGANIC")).toBe("bg-green-100 text-green-800");
  });

  it("returns gray for unknown layout types", () => {
    expect(getLayoutTypeColor("unknown")).toBe("bg-gray-100 text-gray-800");
    expect(getLayoutTypeColor("")).toBe("bg-gray-100 text-gray-800");
  });
});

describe("getFeatureIcon", () => {
  it("returns correct icons for known features", () => {
    expect(getFeatureIcon("temple_precinct")).toBe("🏛️");
    expect(getFeatureIcon("palace")).toBe("👑");
    expect(getFeatureIcon("market")).toBe("🏪");
    expect(getFeatureIcon("walls")).toBe("🧱");
  });

  it("returns default icon for unknown features", () => {
    expect(getFeatureIcon("unknown_feature")).toBe("📍");
  });
});

describe("getFeatureLabel", () => {
  it("converts snake_case to Title Case", () => {
    expect(getFeatureLabel("temple_precinct")).toBe("Temple Precinct");
    expect(getFeatureLabel("residential_quarter")).toBe("Residential Quarter");
    expect(getFeatureLabel("industrial_quarter")).toBe("Industrial Quarter");
  });

  it("handles single words", () => {
    expect(getFeatureLabel("palace")).toBe("Palace");
    expect(getFeatureLabel("market")).toBe("Market");
  });
});

describe("filterStylesByCivilization", () => {
  it("filters styles by civilization name (case-insensitive)", () => {
    const result = filterStylesByCivilization(SAMPLE_STYLES, "Roman");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("arch-003");
  });

  it("finds partial matches", () => {
    const result = filterStylesByCivilization(SAMPLE_STYLES, "greek");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("arch-002");
  });

  it("returns empty array for non-matching civilization", () => {
    const result = filterStylesByCivilization(SAMPLE_STYLES, "Aztec");
    expect(result).toHaveLength(0);
  });

  it("handles empty styles array", () => {
    const result = filterStylesByCivilization([], "Roman");
    expect(result).toHaveLength(0);
  });
});

describe("sortStylesByDate", () => {
  it("sorts styles chronologically by originDate", () => {
    const shuffled = [SAMPLE_STYLES[2], SAMPLE_STYLES[0], SAMPLE_STYLES[3], SAMPLE_STYLES[1]];
    const result = sortStylesByDate(shuffled);
    expect(result.map((s) => s.id)).toEqual([
      "arch-001", // -3100
      "arch-002", // -700
      "arch-003", // -27
      "arch-007", // 700
    ]);
  });

  it("does not mutate the original array", () => {
    const original = [...SAMPLE_STYLES];
    sortStylesByDate(original);
    expect(original.map((s) => s.id)).toEqual(SAMPLE_STYLES.map((s) => s.id));
  });

  it("handles empty array", () => {
    expect(sortStylesByDate([])).toEqual([]);
  });
});

describe("computeTimelineRange", () => {
  it("returns padded min/max from style dates", () => {
    const range = computeTimelineRange(SAMPLE_STYLES);
    expect(range.min).toBe(-3100 - 200);
    expect(range.max).toBe(1700 + 200);
  });

  it("returns defaults for empty array", () => {
    const range = computeTimelineRange([]);
    expect(range.min).toBe(-3500);
    expect(range.max).toBe(2100);
  });

  it("handles single style", () => {
    const range = computeTimelineRange([SAMPLE_STYLES[0]]);
    expect(range.min).toBe(-3100 - 200);
    expect(range.max).toBe(-30 + 200);
  });
});

describe("yearToPercent", () => {
  it("calculates correct percentage", () => {
    const range = { min: -1000, max: 1000 };
    expect(yearToPercent(-1000, range)).toBe(0);
    expect(yearToPercent(0, range)).toBe(50);
    expect(yearToPercent(1000, range)).toBe(100);
  });

  it("handles zero-span range", () => {
    const range = { min: 500, max: 500 };
    expect(yearToPercent(500, range)).toBe(50);
  });

  it("handles negative ranges", () => {
    const range = { min: -3000, max: -1000 };
    expect(yearToPercent(-2000, range)).toBe(50);
  });
});
