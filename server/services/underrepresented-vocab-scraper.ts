import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import type { BaseWord } from "@shared/types";
import { tsvWriter, type CentralWordEntry } from "./tsv-writer";
import { jobStore } from "./job-store";

/**
 * Defines scraping strategies tailored to under-represented language families.
 * Each strategy provides a specialized Gemini prompt and core vocabulary
 * categories most likely to be documented for that family type.
 */
export interface FamilyScrapingStrategy {
  familyType: "isolate" | "small_family" | "endangered" | "extinct" | "unclassified";
  /** Specialized prompt preamble for Gemini */
  promptPreamble: string;
  /** Priority vocabulary categories for this family type */
  priorityCategories: string[];
  /** Max batch size (smaller for rarer languages) */
  batchSize: number;
  /** Delay between batches in ms */
  batchDelayMs: number;
}

export interface UnderrepresentedFamily {
  familyId: string;
  familyName: string;
  languages: Array<{ id: string; name: string; status: string }>;
  strategy: FamilyScrapingStrategy;
}

export interface UnderrepresentedScrapingOptions {
  familyId?: string;
  languageId?: string;
  maxLanguages?: number;
  priorityCategories?: string[];
  progressCallback?: (progress: {
    type: "progress" | "completed" | "error";
    message: string;
    completed?: number;
    total?: number;
  }) => void;
  jobId?: string;
}

export interface UnderrepresentedScrapingResult {
  familiesProcessed: number;
  languagesProcessed: number;
  totalWordsScraped: number;
  totalWordsFailed: number;
  results: Array<{
    languageId: string;
    languageName: string;
    familyId: string;
    wordsScraped: number;
    wordsFailed: number;
  }>;
}

// Core Swadesh-style vocabulary most likely documented for rare languages
const CORE_CONCEPTS: BaseWord[] = [
  { id: "I", word: "I", position: 1 },
  { id: "YOU", word: "you", position: 2 },
  { id: "WE", word: "we", position: 3 },
  { id: "THIS", word: "this", position: 4 },
  { id: "THAT", word: "that", position: 5 },
  { id: "WHO", word: "who", position: 6 },
  { id: "WHAT", word: "what", position: 7 },
  { id: "ONE", word: "one", position: 8 },
  { id: "TWO", word: "two", position: 9 },
  { id: "THREE", word: "three", position: 10 },
  { id: "BIG", word: "big", position: 11 },
  { id: "SMALL", word: "small", position: 12 },
  { id: "WOMAN", word: "woman", position: 13 },
  { id: "MAN", word: "man", position: 14 },
  { id: "PERSON", word: "person", position: 15 },
  { id: "FISH", word: "fish", position: 16 },
  { id: "BIRD", word: "bird", position: 17 },
  { id: "DOG", word: "dog", position: 18 },
  { id: "TREE", word: "tree", position: 19 },
  { id: "WATER", word: "water", position: 20 },
  { id: "FIRE", word: "fire", position: 21 },
  { id: "SUN", word: "sun", position: 22 },
  { id: "MOON", word: "moon", position: 23 },
  { id: "STAR", word: "star", position: 24 },
  { id: "STONE", word: "stone", position: 25 },
  { id: "EARTH", word: "earth", position: 26 },
  { id: "RAIN", word: "rain", position: 27 },
  { id: "WIND", word: "wind", position: 28 },
  { id: "EYE", word: "eye", position: 29 },
  { id: "EAR", word: "ear", position: 30 },
  { id: "NOSE", word: "nose", position: 31 },
  { id: "MOUTH", word: "mouth", position: 32 },
  { id: "TOOTH", word: "tooth", position: 33 },
  { id: "TONGUE", word: "tongue", position: 34 },
  { id: "HAND", word: "hand", position: 35 },
  { id: "FOOT", word: "foot", position: 36 },
  { id: "HEART", word: "heart", position: 37 },
  { id: "BLOOD", word: "blood", position: 38 },
  { id: "BONE", word: "bone", position: 39 },
  { id: "SKIN", word: "skin", position: 40 },
  { id: "HEAD", word: "head", position: 41 },
  { id: "HAIR", word: "hair", position: 42 },
  { id: "EAT", word: "eat", position: 43 },
  { id: "DRINK", word: "drink", position: 44 },
  { id: "SLEEP", word: "sleep", position: 45 },
  { id: "DIE", word: "die", position: 46 },
  { id: "KILL", word: "kill", position: 47 },
  { id: "WALK", word: "walk", position: 48 },
  { id: "COME", word: "come", position: 49 },
  { id: "GIVE", word: "give", position: 50 },
  { id: "SAY", word: "say", position: 51 },
  { id: "SEE", word: "see", position: 52 },
  { id: "HEAR", word: "hear", position: 53 },
  { id: "KNOW", word: "know", position: 54 },
  { id: "NAME", word: "name", position: 55 },
  { id: "MOTHER", word: "mother", position: 56 },
  { id: "FATHER", word: "father", position: 57 },
  { id: "CHILD", word: "child", position: 58 },
  { id: "HOUSE", word: "house", position: 59 },
  { id: "MOUNTAIN", word: "mountain", position: 60 },
  { id: "RIVER", word: "river", position: 61 },
  { id: "SEA", word: "sea", position: 62 },
  { id: "NIGHT", word: "night", position: 63 },
  { id: "DAY", word: "day", position: 64 },
  { id: "HOT", word: "hot", position: 65 },
  { id: "COLD", word: "cold", position: 66 },
  { id: "NEW", word: "new", position: 67 },
  { id: "OLD", word: "old", position: 68 },
  { id: "GOOD", word: "good", position: 69 },
  { id: "BAD", word: "bad", position: 70 },
  { id: "RED", word: "red", position: 71 },
  { id: "BLACK", word: "black", position: 72 },
  { id: "WHITE", word: "white", position: 73 },
  { id: "GREEN", word: "green", position: 74 },
  { id: "YELLOW", word: "yellow", position: 75 },
];

const STRATEGY_MAP: Record<FamilyScrapingStrategy["familyType"], FamilyScrapingStrategy> = {
  isolate: {
    familyType: "isolate",
    promptPreamble: `You are a specialist in language isolates and rare languages. The following language has no known relatives and may have very limited documentation. Use your knowledge of linguistic fieldwork publications, grammars, dictionaries, and word lists. If a translation is uncertain, set confidence low. Only provide translations you are reasonably confident about from published linguistic sources.`,
    priorityCategories: ["pronouns", "body_parts", "nature", "kinship", "numerals"],
    batchSize: 25,
    batchDelayMs: 2000,
  },
  small_family: {
    familyType: "small_family",
    promptPreamble: `You are a specialist in under-documented language families. The following language belongs to a small language family with limited documentation. Draw on published grammars, dictionaries, and comparative linguistic studies. Provide translations only when you have reasonable confidence from documented sources.`,
    priorityCategories: ["pronouns", "body_parts", "nature", "kinship", "basic_verbs"],
    batchSize: 40,
    batchDelayMs: 1500,
  },
  endangered: {
    familyType: "endangered",
    promptPreamble: `You are a specialist in endangered and minority languages. The following language is endangered with few remaining speakers. Use your knowledge of language documentation projects, field linguistics publications, and community language resources. Be especially careful about accuracy as this data may be used for language revitalization efforts.`,
    priorityCategories: ["pronouns", "kinship", "body_parts", "nature", "food", "basic_verbs"],
    batchSize: 30,
    batchDelayMs: 1500,
  },
  extinct: {
    familyType: "extinct",
    promptPreamble: `You are a specialist in historical and extinct languages. The following language is no longer spoken. Draw only on published historical linguistic records, deciphered texts, comparative reconstructions, and scholarly publications. Mark confidence as low unless the translation comes from well-attested historical records.`,
    priorityCategories: ["pronouns", "body_parts", "nature", "numerals", "kinship"],
    batchSize: 20,
    batchDelayMs: 2000,
  },
  unclassified: {
    familyType: "unclassified",
    promptPreamble: `You are a specialist in unclassified and poorly documented languages. The following language has uncertain classification. Use only well-documented sources. Set confidence very conservatively.`,
    priorityCategories: ["pronouns", "body_parts", "numerals"],
    batchSize: 20,
    batchDelayMs: 2000,
  },
};

/**
 * Identifies under-represented language families from the families.tsv data.
 * A family is "under-represented" if it is:
 * - A language isolate (single language, no relatives)
 * - A very small family (≤3 languages at top level)
 * - Contains endangered or extinct languages
 */
export function identifyUnderrepresentedFamilies(
  familiesData: Array<{ id: string; name: string; parent_id: string; description: string; taxonomic_level: string }>,
  languagesData: Array<{ id: string; name: string; family_id: string; status: string }>
): UnderrepresentedFamily[] {
  // Get top-level families (no parent or self-referencing parent)
  const topFamilies = familiesData.filter(
    (f) => !f.parent_id || f.parent_id === f.id || f.taxonomic_level?.toLowerCase() === "family"
  );

  // Count languages per top-level family
  const familyLanguageCounts = new Map<string, Array<{ id: string; name: string; status: string }>>();

  for (const lang of languagesData) {
    // Find the top-level family for this language
    let familyId = lang.family_id;
    const visited = new Set<string>();

    while (familyId && !visited.has(familyId)) {
      visited.add(familyId);
      const family = familiesData.find((f) => f.id === familyId);
      if (!family) break;

      const parent = familiesData.find((f) => f.id === family.parent_id);
      if (!parent || parent.id === family.id || family.taxonomic_level?.toLowerCase() === "family") {
        familyId = family.id;
        break;
      }
      familyId = family.parent_id;
    }

    if (!familyLanguageCounts.has(familyId)) {
      familyLanguageCounts.set(familyId, []);
    }
    familyLanguageCounts.get(familyId)!.push({
      id: lang.id,
      name: lang.name,
      status: lang.status || "living",
    });
  }

  const results: UnderrepresentedFamily[] = [];

  for (const family of topFamilies) {
    const languages = familyLanguageCounts.get(family.id) || [];
    const desc = (family.description || "").toLowerCase();
    const name = (family.name || "").toLowerCase();

    // Determine if this is under-represented
    const isIsolate = desc.includes("isolate") || languages.length <= 1;
    const isSmallFamily = languages.length >= 2 && languages.length <= 5;
    const hasExtinct = languages.some((l) => l.status === "extinct") || desc.includes("extinct");
    const hasEndangered = languages.some(
      (l) => l.status === "endangered" || l.status === "critically_endangered" || l.status === "moribund"
    );

    if (!isIsolate && !isSmallFamily && !hasExtinct && !hasEndangered) continue;

    // Determine the best strategy
    let strategyType: FamilyScrapingStrategy["familyType"];
    if (hasExtinct && languages.every((l) => l.status === "extinct" || desc.includes("extinct"))) {
      strategyType = "extinct";
    } else if (isIsolate) {
      strategyType = "isolate";
    } else if (hasEndangered) {
      strategyType = "endangered";
    } else if (isSmallFamily) {
      strategyType = "small_family";
    } else {
      strategyType = "unclassified";
    }

    results.push({
      familyId: family.id,
      familyName: family.name,
      languages,
      strategy: STRATEGY_MAP[strategyType],
    });
  }

  return results;
}

/**
 * Scraper specialized for under-represented language families.
 * Uses tailored Gemini prompts with linguistic context and smaller batches
 * to improve accuracy for languages with limited documentation.
 */
export class UnderrepresentedVocabScraper {
  private geminiCallCount = 0;

  /**
   * Scrape vocabulary for under-represented languages.
   */
  async scrape(
    families: UnderrepresentedFamily[],
    options: UnderrepresentedScrapingOptions = {}
  ): Promise<UnderrepresentedScrapingResult> {
    const { maxLanguages, progressCallback, jobId } = options;

    // Filter to specific family/language if requested
    let targetFamilies = families;
    if (options.familyId) {
      targetFamilies = families.filter((f) => f.familyId === options.familyId);
    }

    // Collect all target languages
    let allLanguages: Array<{ id: string; name: string; status: string; familyId: string; strategy: FamilyScrapingStrategy }> = [];
    for (const family of targetFamilies) {
      for (const lang of family.languages) {
        allLanguages.push({ ...lang, familyId: family.familyId, strategy: family.strategy });
      }
    }

    if (options.languageId) {
      allLanguages = allLanguages.filter((l) => l.id === options.languageId);
    }

    if (maxLanguages && allLanguages.length > maxLanguages) {
      allLanguages = allLanguages.slice(0, maxLanguages);
    }

    const totalLanguages = allLanguages.length;
    const centralWordsPath = "lexicons/words.tsv";
    const result: UnderrepresentedScrapingResult = {
      familiesProcessed: new Set(allLanguages.map((l) => l.familyId)).size,
      languagesProcessed: 0,
      totalWordsScraped: 0,
      totalWordsFailed: 0,
      results: [],
    };

    if (jobId) {
      jobStore.updateJob(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
        totalWords: totalLanguages * CORE_CONCEPTS.length,
      });
    }

    for (let i = 0; i < allLanguages.length; i++) {
      const lang = allLanguages[i];

      progressCallback?.({
        type: "progress",
        message: `Scraping ${lang.name} (${i + 1}/${totalLanguages})...`,
        completed: i,
        total: totalLanguages,
      });

      // Check what's already scraped for this language
      const alreadyScraped = await tsvWriter.getScrapedConceptIdsForLanguage(lang.id, centralWordsPath);
      const wordsToScrape = CORE_CONCEPTS.filter((w) => !alreadyScraped.has(w.id));

      if (wordsToScrape.length === 0) {
        result.results.push({
          languageId: lang.id,
          languageName: lang.name,
          familyId: lang.familyId,
          wordsScraped: alreadyScraped.size,
          wordsFailed: 0,
        });
        result.languagesProcessed++;
        continue;
      }

      const langResult = await this.scrapeLanguage(lang.id, lang.name, lang.strategy, wordsToScrape, centralWordsPath);
      result.results.push({
        languageId: lang.id,
        languageName: lang.name,
        familyId: lang.familyId,
        wordsScraped: langResult.scraped,
        wordsFailed: langResult.failed,
      });
      result.totalWordsScraped += langResult.scraped;
      result.totalWordsFailed += langResult.failed;
      result.languagesProcessed++;

      if (jobId) {
        jobStore.updateJob(jobId, {
          completedWords: result.totalWordsScraped,
          failedWords: result.totalWordsFailed,
          statusMessage: `Completed ${lang.name} (${i + 1}/${totalLanguages})`,
        });
      }
    }

    if (jobId) {
      jobStore.updateJob(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        completedWords: result.totalWordsScraped,
        failedWords: result.totalWordsFailed,
        apiCallsUsed: this.geminiCallCount,
      });
    }

    progressCallback?.({
      type: "completed",
      message: `Completed: ${result.languagesProcessed} languages, ${result.totalWordsScraped} words scraped`,
      completed: result.languagesProcessed,
      total: totalLanguages,
    });

    return result;
  }

  private async scrapeLanguage(
    languageId: string,
    languageName: string,
    strategy: FamilyScrapingStrategy,
    words: BaseWord[],
    centralWordsPath: string
  ): Promise<{ scraped: number; failed: number }> {
    let scraped = 0;
    let failed = 0;

    for (let i = 0; i < words.length; i += strategy.batchSize) {
      const batch = words.slice(i, i + strategy.batchSize);
      const batchResults = await this.scrapeBatchWithGemini(batch, languageId, languageName, strategy);

      for (const entry of batchResults) {
        if (entry) {
          await tsvWriter.appendToCentralWordsTSV([entry], centralWordsPath);
          scraped++;
        } else {
          failed++;
        }
      }

      if (i + strategy.batchSize < words.length) {
        await delay(strategy.batchDelayMs);
      }
    }

    return { scraped, failed };
  }

  async scrapeBatchWithGemini(
    words: BaseWord[],
    languageId: string,
    languageName: string,
    strategy: FamilyScrapingStrategy
  ): Promise<(CentralWordEntry | null)[]> {
    if (!process.env.GEMINI_API_KEY) {
      return words.map(() => null);
    }

    const geminiModel = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
    const apiVersion = geminiModel.startsWith("gemini-3-") ? "v1beta" : "v1";
    const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const prompt = `${strategy.promptPreamble}

Translate the following English concepts into ${languageName} (language ID: ${languageId}).

${words.map((w, i) => `${i + 1}. ${w.word} (concept: ${w.id})`).join("\n")}

Return JSON ONLY (no markdown):
{
  "translations": [
    {
      "conceptId": "CONCEPT_ID",
      "english": "word",
      "translation": "translated word in ${languageName}",
      "ipa": "IPA pronunciation or null",
      "confidence": 0.0 to 1.0,
      "source_note": "brief note on source (e.g. 'attested in grammar', 'fieldwork data', 'reconstructed')"
    }
  ]
}

Rules:
- Only include translations you are confident about from linguistic sources
- Set confidence: 0.9+ for well-attested forms, 0.7-0.9 for probable, 0.5-0.7 for uncertain
- Omit a word entirely if you have no data (do not guess)
- Include IPA if known from published sources
- Use the native script if the language has one, otherwise use the standard romanization`;

    try {
      this.geminiCallCount++;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 16000,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!response.ok) {
        console.error("Gemini API error:", await response.text());
        return words.map(() => null);
      }

      const data = (await response.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        return words.map(() => null);
      }

      const parsed = JSON.parse(rawText);
      if (!parsed?.translations || !Array.isArray(parsed.translations)) {
        return words.map(() => null);
      }

      // Map by concept ID for flexible ordering (Gemini may skip or reorder)
      const translationMap = new Map<string, any>();
      for (const t of parsed.translations) {
        if (t.conceptId && t.translation && (t.confidence ?? 0) >= 0.5) {
          translationMap.set(t.conceptId, t);
        }
      }

      return words.map((word) => {
        const t = translationMap.get(word.id);
        if (!t) return null;
        return {
          languageId,
          conceptId: word.id,
          wordForm: t.translation,
          ipa: t.ipa || null,
        };
      });
    } catch (error) {
      console.error(`Failed Gemini batch for ${languageName}:`, error);
      return words.map(() => null);
    }
  }

  get apiCallCount(): number {
    return this.geminiCallCount;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const underrepresentedVocabScraper = new UnderrepresentedVocabScraper();
export { CORE_CONCEPTS, STRATEGY_MAP };
