import { describe, it, expect } from "vitest";

/**
 * Unit tests for CultureLanguageWritingSection data transformation and display logic.
 * Tests the pure functions and data structures used for language, writing system,
 * literary work, and sample text display.
 */

// Replicate core data types from the component
interface WritingSystem {
  id: string;
  name: string;
  type: string;
  direction: string;
  parentSystemId: string;
  languageIds: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

interface LanguageInfo {
  id: string;
  name: string;
  nativeName?: string | null;
  familyId: string;
  region?: string | null;
  status: string;
  nativeSpeakers?: number | null;
  totalSpeakers?: number | null;
  writingSystem?: string | null;
  classification?: string | null;
  timeOrigin?: string | null;
  timeEnd?: string | null;
}

interface LiteraryWork {
  id: string;
  title: string;
  author: string;
  traditionId: string;
  languageId: string;
  dateComposed: number;
  genre: string;
  form: string;
  description: string;
  significance: string;
  originalScript: string;
}

interface SampleText {
  id: string;
  languageId: string;
  title: string;
  text: string;
  transliteration: string;
  translationEn: string;
  source: string;
  dateComposed: string;
  genre: string;
  script: string;
}

// Replicate helper functions from the component
function formatYear(year: number | string | null): string {
  if (year === null || year === undefined) return "present";
  const num = typeof year === "string" ? parseInt(year, 10) : year;
  if (isNaN(num)) return String(year);
  if (num < 0) return `${Math.abs(num)} BCE`;
  return `${num} CE`;
}

function formatSpeakers(count: number | null | undefined): string {
  if (!count) return "Unknown";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

function getAncestors(
  system: WritingSystem,
  allSystems: WritingSystem[],
): WritingSystem[] {
  const ancestors: WritingSystem[] = [];
  let current = system;
  const visited = new Set<string>();
  while (current.parentSystemId && !visited.has(current.parentSystemId)) {
    visited.add(current.parentSystemId);
    const parent = allSystems.find((s) => s.id === current.parentSystemId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

function filterLanguages(
  allLanguages: LanguageInfo[],
  languageIds: string[],
): LanguageInfo[] {
  return allLanguages.filter((l) => languageIds.includes(l.id));
}

function filterWritingSystems(
  allSystems: WritingSystem[],
  writingSystemIds: string[],
): WritingSystem[] {
  return allSystems.filter((s) => writingSystemIds.includes(s.id));
}

function filterLiteraryWorks(
  allWorks: LiteraryWork[],
  literaryTraditionIds: string[],
  languageIds: string[],
): LiteraryWork[] {
  return allWorks.filter(
    (w) =>
      literaryTraditionIds.includes(w.traditionId) ||
      languageIds.includes(w.languageId),
  );
}

function filterSampleTexts(
  allTexts: SampleText[],
  languageIds: string[],
): SampleText[] {
  return allTexts.filter((t) => languageIds.includes(t.languageId));
}

// Writing system type colors
const WRITING_TYPE_COLORS: Record<string, string> = {
  alphabet: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  abjad: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  abugida: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  syllabary: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  logographic: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  featural: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

const STATUS_COLORS: Record<string, string> = {
  living: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  endangered: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  moribund: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  dead: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

// Test data
const mockLanguages: LanguageInfo[] = [
  {
    id: "grc",
    name: "Ancient Greek",
    nativeName: "Ελληνική",
    familyId: "indo-european",
    region: "Mediterranean",
    status: "dead",
    nativeSpeakers: null,
    totalSpeakers: null,
    writingSystem: "Greek",
    classification: "Indo-European > Hellenic",
    timeOrigin: "-800",
    timeEnd: "300",
  },
  {
    id: "lat",
    name: "Latin",
    nativeName: "Lingua Latina",
    familyId: "indo-european",
    region: "Mediterranean",
    status: "dead",
    nativeSpeakers: null,
    totalSpeakers: null,
    writingSystem: "Latin",
    classification: "Indo-European > Italic > Latino-Faliscan",
    timeOrigin: "-700",
    timeEnd: "600",
  },
  {
    id: "hin",
    name: "Hindi",
    nativeName: "हिन्दी",
    familyId: "indo-european",
    region: "South Asia",
    status: "living",
    nativeSpeakers: 600_000_000,
    totalSpeakers: 1_200_000_000,
    writingSystem: "Devanagari",
    classification: "Indo-European > Indo-Aryan",
    timeOrigin: "1000",
    timeEnd: null,
  },
];

const mockWritingSystems: WritingSystem[] = [
  {
    id: "ws_003",
    name: "Greek",
    type: "alphabet",
    direction: "LTR",
    parentSystemId: "ws_044",
    languageIds: ["grc", "ell"],
    originDate: "-800",
    originRegion: "Greece",
    characterCount: 24,
    sampleCharacters: "Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ",
    unicodeBlock: "Greek and Coptic",
    isActive: true,
  },
  {
    id: "ws_044",
    name: "Phoenician",
    type: "abjad",
    direction: "RTL",
    parentSystemId: "ws_045",
    languageIds: [],
    originDate: "-1050",
    originRegion: "Levant",
    characterCount: 22,
    sampleCharacters: "𐤀 𐤁 𐤂 𐤃 𐤄 𐤅 𐤆 𐤇",
    unicodeBlock: "Phoenician",
    isActive: false,
  },
  {
    id: "ws_045",
    name: "Proto-Sinaitic",
    type: "abjad",
    direction: "varies",
    parentSystemId: "",
    languageIds: [],
    originDate: "-1800",
    originRegion: "Sinai Peninsula",
    characterCount: 23,
    sampleCharacters: "",
    unicodeBlock: "",
    isActive: false,
  },
  {
    id: "ws_006",
    name: "Devanagari",
    type: "abugida",
    direction: "LTR",
    parentSystemId: "ws_042",
    languageIds: ["hin", "san"],
    originDate: "1200",
    originRegion: "India",
    characterCount: 47,
    sampleCharacters: "अ आ इ ई उ ऊ ए ऐ ओ औ क ख",
    unicodeBlock: "Devanagari",
    isActive: true,
  },
];

const mockLiteraryWorks: LiteraryWork[] = [
  {
    id: "lw-003",
    title: "Iliad",
    author: "Homer",
    traditionId: "lit-trad-002",
    languageId: "grc",
    dateComposed: -750,
    genre: "epic",
    form: "verse",
    description:
      "Epic poem set during the Trojan War, focusing on the wrath of Achilles",
    significance: "Foundation of Western literature",
    originalScript: "Greek",
  },
  {
    id: "lw-004",
    title: "Odyssey",
    author: "Homer",
    traditionId: "lit-trad-002",
    languageId: "grc",
    dateComposed: -725,
    genre: "epic",
    form: "verse",
    description:
      "Epic poem following Odysseus's journey home after the Trojan War",
    significance: "Archetypal journey narrative",
    originalScript: "Greek",
  },
  {
    id: "lw-010",
    title: "Aeneid",
    author: "Virgil",
    traditionId: "lit-trad-003",
    languageId: "lat",
    dateComposed: -29,
    genre: "epic",
    form: "verse",
    description:
      "Epic poem telling the story of Aeneas and the founding of Rome",
    significance: "Foundation of Latin literary tradition",
    originalScript: "Latin",
  },
  {
    id: "lw-099",
    title: "Unrelated Work",
    author: "Unknown",
    traditionId: "lit-trad-099",
    languageId: "jpn",
    dateComposed: 1000,
    genre: "novel",
    form: "prose",
    description: "A work in a different language",
    significance: "Should not appear",
    originalScript: "Hiragana",
  },
];

const mockSampleTexts: SampleText[] = [
  {
    id: "st_grc_001",
    languageId: "grc",
    title: "Opening of the Iliad",
    text: "μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος",
    transliteration: "mēnin aeide thea Pēlēïadeō Akhilēos",
    translationEn:
      "Sing, goddess, the anger of Peleus' son Achilles",
    source: "Homer, Iliad",
    dateComposed: "-750",
    genre: "poetry",
    script: "Greek",
  },
  {
    id: "st_jpn_001",
    languageId: "jpn",
    title: "A Japanese text",
    text: "古池や蛙飛び込む水の音",
    transliteration: "furu ike ya kawazu tobikomu mizu no oto",
    translationEn: "An old silent pond... a frog jumps in, splash!",
    source: "Matsuo Basho",
    dateComposed: "1686",
    genre: "poetry",
    script: "Hiragana",
  },
];

describe("formatYear", () => {
  it("formats BCE years correctly", () => {
    expect(formatYear(-750)).toBe("750 BCE");
    expect(formatYear(-1200)).toBe("1200 BCE");
  });

  it("formats CE years correctly", () => {
    expect(formatYear(1200)).toBe("1200 CE");
    expect(formatYear(900)).toBe("900 CE");
  });

  it("handles null as present", () => {
    expect(formatYear(null)).toBe("present");
  });

  it("handles string years", () => {
    expect(formatYear("-800")).toBe("800 BCE");
    expect(formatYear("1200")).toBe("1200 CE");
  });

  it("handles non-numeric strings", () => {
    expect(formatYear("unknown")).toBe("unknown");
  });
});

describe("formatSpeakers", () => {
  it("formats billions", () => {
    expect(formatSpeakers(1_200_000_000)).toBe("1.2B");
  });

  it("formats millions", () => {
    expect(formatSpeakers(600_000_000)).toBe("600.0M");
    expect(formatSpeakers(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatSpeakers(50_000)).toBe("50.0K");
  });

  it("formats small numbers", () => {
    expect(formatSpeakers(500)).toBe("500");
  });

  it("returns Unknown for null/undefined/zero", () => {
    expect(formatSpeakers(null)).toBe("Unknown");
    expect(formatSpeakers(undefined)).toBe("Unknown");
    expect(formatSpeakers(0)).toBe("Unknown");
  });
});

describe("filterLanguages", () => {
  it("filters languages by matching IDs", () => {
    const result = filterLanguages(mockLanguages, ["grc", "lat"]);
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.id)).toEqual(["grc", "lat"]);
  });

  it("returns empty for non-matching IDs", () => {
    const result = filterLanguages(mockLanguages, ["jpn", "cmn"]);
    expect(result).toHaveLength(0);
  });

  it("handles empty ID list", () => {
    const result = filterLanguages(mockLanguages, []);
    expect(result).toHaveLength(0);
  });

  it("handles partial matches", () => {
    const result = filterLanguages(mockLanguages, ["grc", "nonexistent"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Ancient Greek");
  });
});

describe("filterWritingSystems", () => {
  it("filters writing systems by matching IDs", () => {
    const result = filterWritingSystems(mockWritingSystems, [
      "ws_003",
      "ws_006",
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(["Greek", "Devanagari"]);
  });

  it("returns empty for non-matching IDs", () => {
    const result = filterWritingSystems(mockWritingSystems, ["ws_999"]);
    expect(result).toHaveLength(0);
  });
});

describe("filterLiteraryWorks", () => {
  it("filters by literary tradition IDs", () => {
    const result = filterLiteraryWorks(
      mockLiteraryWorks,
      ["lit-trad-002"],
      [],
    );
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.title)).toEqual(["Iliad", "Odyssey"]);
  });

  it("filters by language IDs", () => {
    const result = filterLiteraryWorks(mockLiteraryWorks, [], ["lat"]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Aeneid");
  });

  it("combines tradition and language filters with OR logic", () => {
    const result = filterLiteraryWorks(
      mockLiteraryWorks,
      ["lit-trad-002"],
      ["lat"],
    );
    expect(result).toHaveLength(3);
    expect(result.map((w) => w.title)).toEqual([
      "Iliad",
      "Odyssey",
      "Aeneid",
    ]);
  });

  it("excludes works not matching any filter", () => {
    const result = filterLiteraryWorks(
      mockLiteraryWorks,
      ["lit-trad-002"],
      ["lat"],
    );
    expect(result.find((w) => w.id === "lw-099")).toBeUndefined();
  });
});

describe("filterSampleTexts", () => {
  it("filters sample texts by language IDs", () => {
    const result = filterSampleTexts(mockSampleTexts, ["grc"]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Opening of the Iliad");
  });

  it("returns empty for non-matching language IDs", () => {
    const result = filterSampleTexts(mockSampleTexts, ["lat"]);
    expect(result).toHaveLength(0);
  });
});

describe("getAncestors (writing system lineage)", () => {
  it("returns ancestor chain for a writing system", () => {
    const greek = mockWritingSystems.find((s) => s.id === "ws_003")!;
    const ancestors = getAncestors(greek, mockWritingSystems);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0].name).toBe("Proto-Sinaitic");
    expect(ancestors[1].name).toBe("Phoenician");
  });

  it("returns empty array for root writing systems", () => {
    const protoSinaitic = mockWritingSystems.find(
      (s) => s.id === "ws_045",
    )!;
    const ancestors = getAncestors(protoSinaitic, mockWritingSystems);
    expect(ancestors).toHaveLength(0);
  });

  it("returns empty array when parent is not found", () => {
    const devanagari = mockWritingSystems.find((s) => s.id === "ws_006")!;
    // ws_042 (Brahmi) is not in our mock data
    const ancestors = getAncestors(devanagari, mockWritingSystems);
    expect(ancestors).toHaveLength(0);
  });

  it("handles circular references gracefully", () => {
    const circular: WritingSystem[] = [
      {
        ...mockWritingSystems[0],
        id: "a",
        parentSystemId: "b",
      },
      {
        ...mockWritingSystems[0],
        id: "b",
        parentSystemId: "a",
      },
    ];
    const ancestors = getAncestors(circular[0], circular);
    // Should not infinite loop; visited set prevents it
    // a -> b -> a (stops), so ancestors = [a, b]
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0].id).toBe("a");
    expect(ancestors[1].id).toBe("b");
  });
});

describe("WRITING_TYPE_COLORS", () => {
  it("has colors for all writing system types", () => {
    const types = [
      "alphabet",
      "abjad",
      "abugida",
      "syllabary",
      "logographic",
      "featural",
    ];
    for (const type of types) {
      expect(WRITING_TYPE_COLORS[type]).toBeDefined();
    }
  });
});

describe("STATUS_COLORS", () => {
  it("has colors for all language statuses", () => {
    const statuses = ["living", "endangered", "moribund", "dead"];
    for (const status of statuses) {
      expect(STATUS_COLORS[status]).toBeDefined();
    }
  });
});

describe("data integrity", () => {
  it("literary works have required fields", () => {
    for (const work of mockLiteraryWorks) {
      expect(work.id).toBeTruthy();
      expect(work.title).toBeTruthy();
      expect(work.author).toBeTruthy();
      expect(work.genre).toBeTruthy();
      expect(typeof work.dateComposed).toBe("number");
    }
  });

  it("writing systems have sample characters or are historical", () => {
    for (const system of mockWritingSystems) {
      if (system.isActive) {
        expect(system.sampleCharacters.length).toBeGreaterThan(0);
      }
    }
  });

  it("sample texts have original text and translation", () => {
    for (const text of mockSampleTexts) {
      expect(text.text).toBeTruthy();
      expect(text.translationEn).toBeTruthy();
      expect(text.languageId).toBeTruthy();
    }
  });
});
