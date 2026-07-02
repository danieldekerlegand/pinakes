import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  identifyUnderrepresentedFamilies,
  UnderrepresentedVocabScraper,
  CORE_CONCEPTS,
  STRATEGY_MAP,
} from "./underrepresented-vocab-scraper";

// Mock node-fetch and tsv-writer
vi.mock("node-fetch", () => ({ default: vi.fn() }));
vi.mock("./tsv-writer", () => ({
  tsvWriter: {
    getScrapedConceptIdsForLanguage: vi.fn().mockResolvedValue(new Set()),
    appendToCentralWordsTSV: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./job-store", () => ({
  jobStore: {
    createJob: vi.fn().mockReturnValue({ id: "test-job" }),
    updateJob: vi.fn(),
    getJob: vi.fn(),
  },
}));

describe("identifyUnderrepresentedFamilies", () => {
  const makeFamilies = (
    entries: Array<{ id: string; name: string; parent_id: string; description: string; taxonomic_level: string }>
  ) => entries;

  const makeLanguages = (
    entries: Array<{ id: string; name: string; family_id: string; status: string }>
  ) => entries;

  it("identifies language isolates", () => {
    const families = makeFamilies([
      { id: "basque", name: "Basque", parent_id: "", description: "A language isolate of the Pyrenees", taxonomic_level: "family" },
    ]);
    const languages = makeLanguages([
      { id: "eus", name: "Basque", family_id: "basque", status: "living" },
    ]);

    const result = identifyUnderrepresentedFamilies(families, languages);
    expect(result.length).toBe(1);
    expect(result[0].familyId).toBe("basque");
    expect(result[0].strategy.familyType).toBe("isolate");
  });

  it("identifies small families", () => {
    const families = makeFamilies([
      { id: "yukaghir", name: "Yukaghir", parent_id: "", description: "A small family in Siberia", taxonomic_level: "family" },
    ]);
    const languages = makeLanguages([
      { id: "yux", name: "Southern Yukaghir", family_id: "yukaghir", status: "living" },
      { id: "ykg", name: "Northern Yukaghir", family_id: "yukaghir", status: "living" },
    ]);

    const result = identifyUnderrepresentedFamilies(families, languages);
    expect(result.length).toBe(1);
    expect(result[0].strategy.familyType).toBe("small_family");
    expect(result[0].languages.length).toBe(2);
  });

  it("identifies extinct families", () => {
    const families = makeFamilies([
      { id: "sumerian", name: "Sumerian", parent_id: "", description: "An extinct language isolate of ancient Mesopotamia", taxonomic_level: "family" },
    ]);
    const languages = makeLanguages([
      { id: "sux", name: "Sumerian", family_id: "sumerian", status: "extinct" },
    ]);

    const result = identifyUnderrepresentedFamilies(families, languages);
    expect(result.length).toBe(1);
    expect(result[0].strategy.familyType).toBe("extinct");
  });

  it("identifies endangered languages", () => {
    const families = makeFamilies([
      { id: "ainu", name: "Ainu", parent_id: "", description: "Languages of northern Japan", taxonomic_level: "family" },
    ]);
    const languages = makeLanguages([
      { id: "ain", name: "Ainu", family_id: "ainu", status: "endangered" },
      { id: "ain2", name: "Sakhalin Ainu", family_id: "ainu", status: "extinct" },
    ]);

    const result = identifyUnderrepresentedFamilies(families, languages);
    expect(result.length).toBe(1);
    expect(result[0].strategy.familyType).toBe("endangered");
  });

  it("excludes large well-represented families", () => {
    const families = makeFamilies([
      { id: "indo_european", name: "Indo-European", parent_id: "", description: "A major language family", taxonomic_level: "family" },
    ]);
    const languages = makeLanguages(
      Array.from({ length: 20 }, (_, i) => ({
        id: `lang_${i}`,
        name: `Language ${i}`,
        family_id: "indo_european",
        status: "living",
      }))
    );

    const result = identifyUnderrepresentedFamilies(families, languages);
    expect(result.length).toBe(0);
  });

  it("returns empty for empty input", () => {
    const result = identifyUnderrepresentedFamilies([], []);
    expect(result).toEqual([]);
  });

  it("handles families with no matching languages", () => {
    const families = makeFamilies([
      { id: "mystery", name: "Mystery", parent_id: "", description: "An isolate", taxonomic_level: "family" },
    ]);
    const languages = makeLanguages([]);

    const result = identifyUnderrepresentedFamilies(families, languages);
    // Still identified as isolate (0 languages <= 1)
    expect(result.length).toBe(1);
    expect(result[0].languages.length).toBe(0);
  });
});

describe("CORE_CONCEPTS", () => {
  it("contains Swadesh-style basic vocabulary", () => {
    expect(CORE_CONCEPTS.length).toBe(75);
    const ids = CORE_CONCEPTS.map((c) => c.id);
    expect(ids).toContain("WATER");
    expect(ids).toContain("FIRE");
    expect(ids).toContain("EYE");
    expect(ids).toContain("MOTHER");
    expect(ids).toContain("I");
  });

  it("has unique IDs and positions", () => {
    const ids = new Set(CORE_CONCEPTS.map((c) => c.id));
    expect(ids.size).toBe(CORE_CONCEPTS.length);

    const positions = new Set(CORE_CONCEPTS.map((c) => c.position));
    expect(positions.size).toBe(CORE_CONCEPTS.length);
  });
});

describe("STRATEGY_MAP", () => {
  it("contains all strategy types", () => {
    expect(STRATEGY_MAP).toHaveProperty("isolate");
    expect(STRATEGY_MAP).toHaveProperty("small_family");
    expect(STRATEGY_MAP).toHaveProperty("endangered");
    expect(STRATEGY_MAP).toHaveProperty("extinct");
    expect(STRATEGY_MAP).toHaveProperty("unclassified");
  });

  it("isolate strategy uses smaller batches than small_family", () => {
    expect(STRATEGY_MAP.isolate.batchSize).toBeLessThan(STRATEGY_MAP.small_family.batchSize);
  });

  it("extinct strategy uses smallest batches", () => {
    expect(STRATEGY_MAP.extinct.batchSize).toBeLessThanOrEqual(STRATEGY_MAP.isolate.batchSize);
  });

  it("all strategies have prompt preambles", () => {
    for (const strategy of Object.values(STRATEGY_MAP)) {
      expect(strategy.promptPreamble.length).toBeGreaterThan(50);
      expect(strategy.priorityCategories.length).toBeGreaterThan(0);
    }
  });
});

describe("UnderrepresentedVocabScraper", () => {
  let scraper: UnderrepresentedVocabScraper;

  beforeEach(() => {
    scraper = new UnderrepresentedVocabScraper();
    vi.resetModules();
  });

  it("scrapeBatchWithGemini returns nulls without API key", async () => {
    delete process.env.GEMINI_API_KEY;

    const results = await scraper.scrapeBatchWithGemini(
      CORE_CONCEPTS.slice(0, 3),
      "eus",
      "Basque",
      STRATEGY_MAP.isolate
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r === null)).toBe(true);
  });

  it("scrapeBatchWithGemini parses valid Gemini responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const mockFetch = (await import("node-fetch")).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: [
                      { conceptId: "I", english: "I", translation: "ni", ipa: "/ni/", confidence: 0.95 },
                      { conceptId: "YOU", english: "you", translation: "zu", ipa: "/su/", confidence: 0.9 },
                      { conceptId: "WE", english: "we", translation: "gu", ipa: "/gu/", confidence: 0.85 },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const results = await scraper.scrapeBatchWithGemini(
      CORE_CONCEPTS.slice(0, 3),
      "eus",
      "Basque",
      STRATEGY_MAP.isolate
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      languageId: "eus",
      conceptId: "I",
      wordForm: "ni",
      ipa: "/ni/",
    });
    expect(results[1]?.wordForm).toBe("zu");
    expect(results[2]?.wordForm).toBe("gu");

    delete process.env.GEMINI_API_KEY;
  });

  it("scrapeBatchWithGemini filters low-confidence results", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const mockFetch = (await import("node-fetch")).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: [
                      { conceptId: "I", english: "I", translation: "ni", confidence: 0.95 },
                      { conceptId: "YOU", english: "you", translation: "guess", confidence: 0.3 },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const results = await scraper.scrapeBatchWithGemini(
      CORE_CONCEPTS.slice(0, 2),
      "eus",
      "Basque",
      STRATEGY_MAP.isolate
    );

    expect(results[0]).not.toBeNull();
    expect(results[1]).toBeNull(); // Filtered out due to low confidence
    delete process.env.GEMINI_API_KEY;
  });

  it("scrapeBatchWithGemini handles API errors gracefully", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const mockFetch = (await import("node-fetch")).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Internal Server Error",
    });

    const results = await scraper.scrapeBatchWithGemini(
      CORE_CONCEPTS.slice(0, 3),
      "eus",
      "Basque",
      STRATEGY_MAP.isolate
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r === null)).toBe(true);
    delete process.env.GEMINI_API_KEY;
  });

  it("scrapeBatchWithGemini handles malformed JSON", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const mockFetch = (await import("node-fetch")).default as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "not valid json" }] } }],
      }),
    });

    const results = await scraper.scrapeBatchWithGemini(
      CORE_CONCEPTS.slice(0, 2),
      "eus",
      "Basque",
      STRATEGY_MAP.isolate
    );

    expect(results.every((r) => r === null)).toBe(true);
    delete process.env.GEMINI_API_KEY;
  });

  it("scrape processes multiple families", async () => {
    const families = [
      {
        familyId: "basque",
        familyName: "Basque",
        languages: [{ id: "eus", name: "Basque", status: "living" }],
        strategy: STRATEGY_MAP.isolate,
      },
      {
        familyId: "ainu",
        familyName: "Ainu",
        languages: [{ id: "ain", name: "Ainu", status: "endangered" }],
        strategy: STRATEGY_MAP.endangered,
      },
    ];

    // Mock all words as already scraped so we skip the actual API calls
    const { tsvWriter: mockTsvWriter } = await import("./tsv-writer");
    const mockGetScraped = mockTsvWriter.getScrapedConceptIdsForLanguage as ReturnType<typeof vi.fn>;
    mockGetScraped.mockResolvedValue(new Set(CORE_CONCEPTS.map((c) => c.id)));

    const result = await scraper.scrape(families);

    expect(result.familiesProcessed).toBe(2);
    expect(result.languagesProcessed).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  it("scrape filters by familyId", async () => {
    const families = [
      {
        familyId: "basque",
        familyName: "Basque",
        languages: [{ id: "eus", name: "Basque", status: "living" }],
        strategy: STRATEGY_MAP.isolate,
      },
      {
        familyId: "ainu",
        familyName: "Ainu",
        languages: [{ id: "ain", name: "Ainu", status: "endangered" }],
        strategy: STRATEGY_MAP.endangered,
      },
    ];

    const { tsvWriter: mockTsvWriter } = await import("./tsv-writer");
    const mockGetScraped = mockTsvWriter.getScrapedConceptIdsForLanguage as ReturnType<typeof vi.fn>;
    mockGetScraped.mockResolvedValue(new Set(CORE_CONCEPTS.map((c) => c.id)));

    const result = await scraper.scrape(families, { familyId: "basque" });

    expect(result.familiesProcessed).toBe(1);
    expect(result.languagesProcessed).toBe(1);
    expect(result.results[0].familyId).toBe("basque");
  });

  it("scrape respects maxLanguages", async () => {
    const families = [
      {
        familyId: "test",
        familyName: "Test",
        languages: [
          { id: "l1", name: "Lang 1", status: "living" },
          { id: "l2", name: "Lang 2", status: "living" },
          { id: "l3", name: "Lang 3", status: "living" },
        ],
        strategy: STRATEGY_MAP.small_family,
      },
    ];

    const { tsvWriter: mockTsvWriter } = await import("./tsv-writer");
    const mockGetScraped = mockTsvWriter.getScrapedConceptIdsForLanguage as ReturnType<typeof vi.fn>;
    mockGetScraped.mockResolvedValue(new Set(CORE_CONCEPTS.map((c) => c.id)));

    const result = await scraper.scrape(families, { maxLanguages: 2 });

    expect(result.languagesProcessed).toBe(2);
  });
});
