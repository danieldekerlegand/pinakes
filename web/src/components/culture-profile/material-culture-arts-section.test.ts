import { describe, it, expect } from "vitest";
import {
  formatYear,
  getCategoryColor,
  CATEGORY_COLORS,
  filterByCategory,
  filterByFamily,
  getUniqueCategories,
  getUniqueFamilies,
} from "./material-culture-arts-utils";

// --- formatYear ---

describe("MaterialCultureArtsSection - formatYear", () => {
  it("formats BCE years", () => {
    expect(formatYear(-2800)).toBe("2800 BCE");
    expect(formatYear(-14000)).toBe("14000 BCE");
  });

  it("formats CE years", () => {
    expect(formatYear(850)).toBe("850 CE");
    expect(formatYear(2000)).toBe("2000 CE");
  });

  it("formats null as present", () => {
    expect(formatYear(null)).toBe("present");
  });

  it("formats year 0 as CE", () => {
    expect(formatYear(0)).toBe("0 CE");
  });
});

// --- getCategoryColor ---

describe("MaterialCultureArtsSection - getCategoryColor", () => {
  it("returns correct color for known categories", () => {
    expect(getCategoryColor("pottery")).toBe("#d97706");
    expect(getCategoryColor("metallurgy")).toBe("#0891b2");
    expect(getCategoryColor("tools")).toBe("#6366f1");
    expect(getCategoryColor("agriculture")).toBe("#16a34a");
    expect(getCategoryColor("textiles")).toBe("#db2777");
  });

  it("is case-insensitive", () => {
    expect(getCategoryColor("Pottery")).toBe("#d97706");
    expect(getCategoryColor("METALLURGY")).toBe("#0891b2");
    expect(getCategoryColor("Tools")).toBe("#6366f1");
  });

  it("returns default color for unknown categories", () => {
    expect(getCategoryColor("unknown")).toBe("#6b7280");
    expect(getCategoryColor("")).toBe("#6b7280");
  });
});

// --- CATEGORY_COLORS ---

describe("MaterialCultureArtsSection - CATEGORY_COLORS", () => {
  it("has entries for all expected material culture categories", () => {
    expect(CATEGORY_COLORS).toHaveProperty("pottery");
    expect(CATEGORY_COLORS).toHaveProperty("metallurgy");
    expect(CATEGORY_COLORS).toHaveProperty("tools");
    expect(CATEGORY_COLORS).toHaveProperty("agriculture");
    expect(CATEGORY_COLORS).toHaveProperty("textiles");
    expect(CATEGORY_COLORS).toHaveProperty("architecture");
  });

  it("has entries for art tradition categories", () => {
    expect(CATEGORY_COLORS).toHaveProperty("sculpture");
    expect(CATEGORY_COLORS).toHaveProperty("painting");
    expect(CATEGORY_COLORS).toHaveProperty("calligraphy");
  });

  it("has entries for instrument families", () => {
    expect(CATEGORY_COLORS).toHaveProperty("string");
    expect(CATEGORY_COLORS).toHaveProperty("percussion");
    expect(CATEGORY_COLORS).toHaveProperty("wind");
  });

  it("all values are valid hex colors", () => {
    for (const color of Object.values(CATEGORY_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// --- Sample data ---

interface MaterialCultureItem {
  id: string;
  name: string;
  category: string;
  originDate: number;
  originCoordinates: [number, number];
  spreadData: { date: number; coordinates: [number, number]; associatedCivilization: string }[];
  description: string;
  associatedLanguages: string[];
  significance: string;
}

const SAMPLE_MATERIAL: MaterialCultureItem[] = [
  {
    id: "mc_001",
    name: "Bell Beaker pottery",
    category: "pottery",
    originDate: -2800,
    originCoordinates: [37.0, -5.0],
    spreadData: [
      { date: -2500, coordinates: [48.8, 2.3], associatedCivilization: "Western European Neolithic" },
    ],
    description: "Distinctive bell-shaped drinking vessels",
    associatedLanguages: ["pre-Celtic", "Basque"],
    significance: "Major archaeological horizon marker",
  },
  {
    id: "mc_006",
    name: "Iron smelting",
    category: "metallurgy",
    originDate: -1800,
    originCoordinates: [36.0, 36.0],
    spreadData: [
      { date: -1200, coordinates: [40.0, 32.0], associatedCivilization: "Hittite Empire" },
    ],
    description: "Development of iron smelting technology",
    associatedLanguages: ["Hittite", "Akkadian"],
    significance: "Transformed warfare and agriculture",
  },
  {
    id: "mc_010",
    name: "Wheel invention",
    category: "tools",
    originDate: -3500,
    originCoordinates: [33.0, 44.0],
    spreadData: [],
    description: "Invention of the wheel",
    associatedLanguages: ["Sumerian"],
    significance: "Fundamental invention",
  },
  {
    id: "mc_028",
    name: "Silk production",
    category: "textiles",
    originDate: -3500,
    originCoordinates: [30.0, 120.0],
    spreadData: [],
    description: "Sericulture",
    associatedLanguages: ["Old Chinese"],
    significance: "Drove the Silk Road",
  },
];

interface ArtTraditionItem {
  id: string;
  name: string;
  category: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
}

const SAMPLE_ART: ArtTraditionItem[] = [
  {
    id: "art-001",
    name: "Egyptian Monumental",
    category: "architecture",
    stylePeriod: "Ancient Egyptian",
    originDate: -3100,
    endDate: -30,
    originCoordinates: { lat: 29.98, lng: 31.13 },
    description: "Massive stone architecture",
    associatedCivilizations: "Egyptian",
    associatedLanguages: ["egy", "cop"],
    keyFeatures: ["colossal scale", "hieroglyphic decoration"],
    notableExamples: ["Great Pyramid of Giza"],
  },
  {
    id: "art-002",
    name: "Greek Classical",
    category: "sculpture",
    stylePeriod: "Classical",
    originDate: -500,
    endDate: -323,
    originCoordinates: { lat: 37.97, lng: 23.72 },
    description: "Idealized naturalistic sculpture",
    associatedCivilizations: "Greek",
    associatedLanguages: ["grc", "ell"],
    keyFeatures: ["contrapposto pose", "marble medium"],
    notableExamples: ["Parthenon Marbles", "Venus de Milo"],
  },
];

interface InstrumentItem {
  id: string;
  name: string;
  nativeName: string;
  instrumentFamily: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  constructionMaterials: string[];
  playingTechnique: string;
  associatedTraditionIds: string[];
  associatedLanguageIds: string[];
  description: string;
}

const SAMPLE_INSTRUMENTS: InstrumentItem[] = [
  {
    id: "sitar",
    name: "Sitar",
    nativeName: "सितार",
    instrumentFamily: "string",
    originRegion: "South Asia",
    coordinates: { lat: 28.61, lng: 77.21 },
    timeOrigin: 1700,
    constructionMaterials: ["gourd", "teak", "steel-strings"],
    playingTechnique: "plucked",
    associatedTraditionIds: ["indian-classical"],
    associatedLanguageIds: ["hindi", "urdu"],
    description: "Long-necked lute with sympathetic strings",
  },
  {
    id: "tabla",
    name: "Tabla",
    nativeName: "तबला",
    instrumentFamily: "percussion",
    originRegion: "South Asia",
    coordinates: { lat: 28.61, lng: 77.21 },
    timeOrigin: 1700,
    constructionMaterials: ["wood", "goat-skin"],
    playingTechnique: "hand-struck",
    associatedTraditionIds: ["indian-classical"],
    associatedLanguageIds: ["hindi", "urdu"],
    description: "Pair of hand drums",
  },
  {
    id: "ney",
    name: "Ney",
    nativeName: "ناي",
    instrumentFamily: "wind",
    originRegion: "Middle East",
    coordinates: { lat: 33.31, lng: 44.37 },
    timeOrigin: -3000,
    constructionMaterials: ["reed"],
    playingTechnique: "blown",
    associatedTraditionIds: ["arabic-maqam", "persian-classical"],
    associatedLanguageIds: ["arabic", "persian"],
    description: "End-blown reed flute",
  },
];

// --- filterByCategory ---

describe("MaterialCultureArtsSection - filterByCategory", () => {
  it("returns all items when category is 'all'", () => {
    const result = filterByCategory(SAMPLE_MATERIAL, "all");
    expect(result).toHaveLength(4);
  });

  it("filters by category", () => {
    const result = filterByCategory(SAMPLE_MATERIAL, "pottery");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("mc_001");
  });

  it("returns empty for non-matching category", () => {
    const result = filterByCategory(SAMPLE_MATERIAL, "weapons");
    expect(result).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = filterByCategory([], "all");
    expect(result).toHaveLength(0);
  });
});

// --- filterByCategory (art traditions) ---

describe("MaterialCultureArtsSection - filterByCategory art traditions", () => {
  it("returns all items when category is 'all'", () => {
    const result = filterByCategory(SAMPLE_ART, "all");
    expect(result).toHaveLength(2);
  });

  it("filters by category", () => {
    const result = filterByCategory(SAMPLE_ART, "sculpture");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("art-002");
  });

  it("returns empty for non-matching category", () => {
    const result = filterByCategory(SAMPLE_ART, "painting");
    expect(result).toHaveLength(0);
  });
});

// --- filterByFamily ---

describe("MaterialCultureArtsSection - filterByFamily", () => {
  it("returns all items when family is 'all'", () => {
    const result = filterByFamily(SAMPLE_INSTRUMENTS, "all");
    expect(result).toHaveLength(3);
  });

  it("filters by instrument family", () => {
    const result = filterByFamily(SAMPLE_INSTRUMENTS, "string");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("sitar");
  });

  it("filters percussion instruments", () => {
    const result = filterByFamily(SAMPLE_INSTRUMENTS, "percussion");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("tabla");
  });

  it("filters wind instruments", () => {
    const result = filterByFamily(SAMPLE_INSTRUMENTS, "wind");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ney");
  });

  it("returns empty for non-matching family", () => {
    const result = filterByFamily(SAMPLE_INSTRUMENTS, "keyboard");
    expect(result).toHaveLength(0);
  });
});

// --- getUniqueCategories ---

describe("MaterialCultureArtsSection - getUniqueCategories", () => {
  it("extracts unique categories sorted alphabetically", () => {
    const result = getUniqueCategories(SAMPLE_MATERIAL);
    expect(result).toEqual(["metallurgy", "pottery", "textiles", "tools"]);
  });

  it("handles duplicates", () => {
    const items = [
      { category: "pottery" },
      { category: "pottery" },
      { category: "tools" },
    ];
    expect(getUniqueCategories(items)).toEqual(["pottery", "tools"]);
  });

  it("returns empty for empty input", () => {
    expect(getUniqueCategories([])).toEqual([]);
  });
});

// --- getUniqueFamilies ---

describe("MaterialCultureArtsSection - getUniqueFamilies", () => {
  it("extracts unique instrument families sorted", () => {
    const result = getUniqueFamilies(SAMPLE_INSTRUMENTS);
    expect(result).toEqual(["percussion", "string", "wind"]);
  });

  it("handles empty input", () => {
    expect(getUniqueFamilies([])).toEqual([]);
  });

  it("deduplicates families", () => {
    const instruments = [
      { ...SAMPLE_INSTRUMENTS[0] },
      { ...SAMPLE_INSTRUMENTS[0], id: "sitar2" },
    ];
    expect(getUniqueFamilies(instruments)).toEqual(["string"]);
  });
});
