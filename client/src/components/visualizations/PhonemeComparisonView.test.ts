import { describe, it, expect } from "vitest";

// Test the data transformation logic used by PhonemeComparisonView, HeatmapGrid, and ComparisonTable

const PLACES = [
  "Bilabial", "Labiodental", "Dental", "Alveolar", "Postalveolar",
  "Retroflex", "Palatal", "Velar", "Uvular", "Pharyngeal", "Glottal",
] as const;

const MANNERS = [
  "Plosive", "Nasal", "Trill", "Tap/Flap", "Fricative",
  "Lateral fricative", "Approximant", "Lateral approximant",
] as const;

const IPA_CONSONANT_MAP: Record<string, { place: string; manner: string; voiced: boolean }> = {
  "p": { place: "Bilabial", manner: "Plosive", voiced: false },
  "b": { place: "Bilabial", manner: "Plosive", voiced: true },
  "t": { place: "Alveolar", manner: "Plosive", voiced: false },
  "d": { place: "Alveolar", manner: "Plosive", voiced: true },
  "k": { place: "Velar", manner: "Plosive", voiced: false },
  "g": { place: "Velar", manner: "Plosive", voiced: true },
  "m": { place: "Bilabial", manner: "Nasal", voiced: true },
  "n": { place: "Alveolar", manner: "Nasal", voiced: true },
  "ŋ": { place: "Velar", manner: "Nasal", voiced: true },
  "f": { place: "Labiodental", manner: "Fricative", voiced: false },
  "v": { place: "Labiodental", manner: "Fricative", voiced: true },
  "s": { place: "Alveolar", manner: "Fricative", voiced: false },
  "z": { place: "Alveolar", manner: "Fricative", voiced: true },
  "ʃ": { place: "Postalveolar", manner: "Fricative", voiced: false },
  "h": { place: "Glottal", manner: "Fricative", voiced: false },
  "l": { place: "Alveolar", manner: "Lateral approximant", voiced: true },
  "r": { place: "Alveolar", manner: "Trill", voiced: true },
  "j": { place: "Palatal", manner: "Approximant", voiced: true },
  "w": { place: "Velar", manner: "Approximant", voiced: true },
  "θ": { place: "Dental", manner: "Fricative", voiced: false },
  "ð": { place: "Dental", manner: "Fricative", voiced: true },
};

interface HeatmapCell {
  value: number;
  label: string;
  items: { text: string; colorIndex: number }[];
}

interface PhonologicalInventory {
  languageId: string;
  consonants: string[];
  vowels: string[];
  tones: string[] | null;
  syllableStructure: string;
  stressSystem: string;
}

// Replicate the heatmap data builder
function buildHeatmapData(inventories: PhonologicalInventory[]) {
  const data: Record<string, Record<string, HeatmapCell>> = {};
  for (const manner of MANNERS) {
    data[manner] = {};
    for (const place of PLACES) {
      data[manner][place] = { value: 0, label: "", items: [] };
    }
  }
  inventories.forEach((inv, langIndex) => {
    for (const phoneme of inv.consonants) {
      const info = IPA_CONSONANT_MAP[phoneme];
      if (info && data[info.manner]?.[info.place]) {
        const cell = data[info.manner][info.place];
        cell.items.push({ text: phoneme, colorIndex: langIndex });
        cell.value = cell.items.length;
      }
    }
  });
  return data;
}

// Replicate overlap analysis
function computeOverlap(inventories: PhonologicalInventory[]) {
  if (inventories.length < 2) return null;
  const consonantSets = inventories.map((inv) => new Set(inv.consonants));
  const vowelSets = inventories.map((inv) => new Set(inv.vowels));
  const sharedConsonants = new Set(
    Array.from(consonantSets[0]).filter((p) => consonantSets.every((s) => s.has(p)))
  );
  const sharedVowels = new Set(
    Array.from(vowelSets[0]).filter((p) => vowelSets.every((s) => s.has(p)))
  );
  return { sharedConsonants, sharedVowels };
}

// Replicate ComparisonTable row builder
function buildComparisonRows(inventories: PhonologicalInventory[]) {
  return [
    {
      label: "Total Consonants",
      values: Object.fromEntries(inventories.map((inv) => [inv.languageId, inv.consonants.length])),
    },
    {
      label: "Total Vowels",
      values: Object.fromEntries(inventories.map((inv) => [inv.languageId, inv.vowels.length])),
    },
    {
      label: "Has Tones",
      values: Object.fromEntries(
        inventories.map((inv) => [inv.languageId, inv.tones ? `Yes (${inv.tones.length})` : "No"])
      ),
    },
    {
      label: "Syllable Structure",
      values: Object.fromEntries(inventories.map((inv) => [inv.languageId, inv.syllableStructure])),
    },
    {
      label: "Stress System",
      values: Object.fromEntries(inventories.map((inv) => [inv.languageId, inv.stressSystem])),
    },
  ];
}

const english: PhonologicalInventory = {
  languageId: "eng",
  consonants: ["p", "b", "t", "d", "k", "g", "m", "n", "ŋ", "f", "v", "θ", "ð", "s", "z", "ʃ", "h", "l", "r", "j", "w"],
  vowels: ["i", "ɪ", "e", "ɛ", "æ", "ɑ", "ɔ", "o", "ʊ", "u", "ʌ", "ə"],
  tones: null,
  syllableStructure: "(C)(C)(C)V(C)(C)(C)(C)",
  stressSystem: "variable",
};

const german: PhonologicalInventory = {
  languageId: "deu",
  consonants: ["p", "b", "t", "d", "k", "g", "m", "n", "ŋ", "f", "v", "s", "z", "ʃ", "h", "l", "r", "j"],
  vowels: ["i", "ɪ", "e", "ɛ", "a", "o", "ɔ", "u", "ʊ", "ə"],
  tones: null,
  syllableStructure: "(C)(C)(C)V(C)(C)(C)(C)",
  stressSystem: "variable",
};

const mandarin: PhonologicalInventory = {
  languageId: "cmn",
  consonants: ["p", "b", "t", "d", "k", "g", "m", "n", "ŋ", "f", "s", "ʃ", "h", "l", "r"],
  vowels: ["i", "u", "a", "o", "ə", "ɛ"],
  tones: ["1", "2", "3", "4"],
  syllableStructure: "(C)V(N)",
  stressSystem: "tonal",
};

describe("HeatmapGrid data builder", () => {
  it("maps consonants to correct IPA chart positions", () => {
    const data = buildHeatmapData([english]);
    // 'p' should be in Bilabial/Plosive
    expect(data["Plosive"]["Bilabial"].items).toContainEqual({ text: "p", colorIndex: 0 });
    // 's' should be in Alveolar/Fricative
    expect(data["Fricative"]["Alveolar"].items).toContainEqual({ text: "s", colorIndex: 0 });
    // 'ŋ' should be in Velar/Nasal
    expect(data["Nasal"]["Velar"].items).toContainEqual({ text: "ŋ", colorIndex: 0 });
  });

  it("assigns correct color indices for multiple languages", () => {
    const data = buildHeatmapData([english, german]);
    const bilabialPlosives = data["Plosive"]["Bilabial"].items;
    // Both languages have 'p'
    const pItems = bilabialPlosives.filter((i) => i.text === "p");
    expect(pItems).toHaveLength(2);
    expect(pItems[0].colorIndex).toBe(0); // English
    expect(pItems[1].colorIndex).toBe(1); // German
  });

  it("tracks cell value as item count", () => {
    const data = buildHeatmapData([english, german]);
    // Bilabial Plosive has p and b from both languages = 4 items
    expect(data["Plosive"]["Bilabial"].value).toBe(4);
  });

  it("leaves empty cells with zero value", () => {
    const data = buildHeatmapData([english]);
    // No Retroflex phonemes in English
    expect(data["Plosive"]["Retroflex"].value).toBe(0);
    expect(data["Plosive"]["Retroflex"].items).toHaveLength(0);
  });

  it("initializes all manner/place combinations", () => {
    const data = buildHeatmapData([]);
    for (const manner of MANNERS) {
      for (const place of PLACES) {
        expect(data[manner][place]).toBeDefined();
        expect(data[manner][place].items).toEqual([]);
      }
    }
  });
});

describe("ComparisonTable data builder", () => {
  it("builds correct row values for single language", () => {
    const rows = buildComparisonRows([english]);
    expect(rows[0].values["eng"]).toBe(21); // consonant count
    expect(rows[1].values["eng"]).toBe(12); // vowel count
    expect(rows[2].values["eng"]).toBe("No"); // tones
    expect(rows[3].values["eng"]).toBe("(C)(C)(C)V(C)(C)(C)(C)");
    expect(rows[4].values["eng"]).toBe("variable");
  });

  it("handles tonal languages correctly", () => {
    const rows = buildComparisonRows([mandarin]);
    expect(rows[2].values["cmn"]).toBe("Yes (4)");
  });

  it("includes all languages in each row", () => {
    const rows = buildComparisonRows([english, german, mandarin]);
    for (const row of rows) {
      expect(Object.keys(row.values)).toEqual(["eng", "deu", "cmn"]);
    }
  });

  it("produces exactly 5 feature rows", () => {
    const rows = buildComparisonRows([english]);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.label)).toEqual([
      "Total Consonants",
      "Total Vowels",
      "Has Tones",
      "Syllable Structure",
      "Stress System",
    ]);
  });
});

describe("Overlap analysis", () => {
  it("returns null for fewer than 2 languages", () => {
    expect(computeOverlap([english])).toBeNull();
    expect(computeOverlap([])).toBeNull();
  });

  it("finds shared consonants between English and German", () => {
    const result = computeOverlap([english, german]);
    expect(result).not.toBeNull();
    // Both have p, b, t, d, k, g, m, n, ŋ, f, v, s, z, ʃ, h, l, r, j
    expect(result!.sharedConsonants.has("p")).toBe(true);
    expect(result!.sharedConsonants.has("m")).toBe(true);
    expect(result!.sharedConsonants.has("s")).toBe(true);
    // English has θ and ð, German does not
    expect(result!.sharedConsonants.has("θ")).toBe(false);
    expect(result!.sharedConsonants.has("ð")).toBe(false);
  });

  it("finds shared vowels between English and German", () => {
    const result = computeOverlap([english, german]);
    expect(result).not.toBeNull();
    // Both have i, ɪ, e, ɛ, o, ɔ, ʊ, ə
    expect(result!.sharedVowels.has("i")).toBe(true);
    expect(result!.sharedVowels.has("ə")).toBe(true);
    // English has æ, German does not
    expect(result!.sharedVowels.has("æ")).toBe(false);
  });

  it("reduces shared set with 3 languages", () => {
    const twoLang = computeOverlap([english, german]);
    const threeLang = computeOverlap([english, german, mandarin]);
    expect(threeLang).not.toBeNull();
    // Adding Mandarin (fewer consonants) should reduce or keep shared set
    expect(threeLang!.sharedConsonants.size).toBeLessThanOrEqual(
      twoLang!.sharedConsonants.size
    );
  });

  it("correctly identifies Mandarin lacks English-only consonants", () => {
    const result = computeOverlap([english, mandarin]);
    expect(result).not.toBeNull();
    // Mandarin doesn't have θ, ð, v, z, j, w
    expect(result!.sharedConsonants.has("θ")).toBe(false);
    expect(result!.sharedConsonants.has("v")).toBe(false);
    // Both have p, t, k, m, n, f, s, h, l, r
    expect(result!.sharedConsonants.has("p")).toBe(true);
    expect(result!.sharedConsonants.has("f")).toBe(true);
  });
});

describe("HeatmapGrid highlight cells", () => {
  it("identifies cells containing shared phonemes", () => {
    const inventories = [english, german];
    const data = buildHeatmapData(inventories);
    const overlap = computeOverlap(inventories)!;

    const highlightedCells = new Set<string>();
    for (const manner of MANNERS) {
      for (const place of PLACES) {
        const cell = data[manner]?.[place];
        if (cell && cell.items.some((item) => overlap.sharedConsonants.has(item.text))) {
          highlightedCells.add(`${manner}|${place}`);
        }
      }
    }

    // Bilabial Plosive should be highlighted (p and b are shared)
    expect(highlightedCells.has("Plosive|Bilabial")).toBe(true);
    // Alveolar Fricative should be highlighted (s and z are shared)
    expect(highlightedCells.has("Fricative|Alveolar")).toBe(true);
    // Dental Fricative should NOT be highlighted (θ/ð are English-only)
    expect(highlightedCells.has("Fricative|Dental")).toBe(false);
  });
});
