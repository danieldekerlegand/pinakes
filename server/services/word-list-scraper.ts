import path from "node:path";
import type { BaseWord } from "@contracts/types";
import { tsvWriter, type WordListEntry, type CentralWordEntry } from "./tsv-writer";
import { LinguisticAPIService } from "./linguistic-apis";
import { jobStore } from "./job-store";
import fetch from "node-fetch";

export interface WordScrapingOptions {
  languageId: string;
  languageName: string;
  baseWords: BaseWord[];
  dataSources?: Array<"gemini" | "wiktionary" | "merriam-webster">;
  progressCallback?: (progress: {
    type: "progress" | "completed" | "error";
    message: string;
    completed?: number;
    total?: number;
    currentWord?: string;
  }) => void;
  resumable?: boolean;
  jobId?: string; // Optional database job ID for tracking
}

export interface WordScrapingResult {
  languageId: string;
  totalWords: number;
  scrapedWords: number;
  failedWords: number;
  apiCallsUsed: number;
  outputPath: string;
}

/**
 * Word List Scraper - scrapes translations for a language using various data sources
 * Writes results to per-language TSV files in lexicons/[language-id].tsv
 */
export class WordListScraper {
  private linguisticAPI: LinguisticAPIService;
  private geminiCallCount = 0;

  constructor() {
    this.linguisticAPI = new LinguisticAPIService();
  }

  private updateJobStatus(
    jobId: string | undefined,
    updates: {
      status?: string;
      completedWords?: number;
      failedWords?: number;
      totalWords?: number;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
      apiCallsUsed?: number;
      outputPath?: string;
    }
  ): void {
    if (!jobId) return;

    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  async scrapeWordList(options: WordScrapingOptions): Promise<WordScrapingResult> {
    const {
      languageId,
      languageName,
      baseWords,
      dataSources = ["gemini"],
      progressCallback,
      resumable = true,
      jobId,
    } = options;

    const centralWordsPath = "lexicons/words.tsv";
    const outputPath = centralWordsPath; // Now using central file

    // Update job status to running
    this.updateJobStatus(jobId, {
      status: "running",
      startedAt: new Date().toISOString(),
      totalWords: baseWords.length,
    });

    console.log(`Starting word scraping for ${languageName} (${languageId})`);
    console.log(`  Base words: ${baseWords.length}`);
    console.log(`  Data sources: ${dataSources.join(", ")}`);
    console.log(`  Output: ${centralWordsPath}`);

    // Check what's already been scraped (for resumable scraping)
    let alreadyScraped = new Set<string>();
    if (resumable) {
      alreadyScraped = await tsvWriter.getScrapedConceptIdsForLanguage(languageId, centralWordsPath);
      console.log(`  Already scraped: ${alreadyScraped.size} concepts for ${languageId}`);
    }

    // Filter out already scraped words
    const wordsToScrape = resumable
      ? baseWords.filter((w) => !alreadyScraped.has(w.id))
      : baseWords;

    console.log(`  Words to scrape: ${wordsToScrape.length}`);

    if (progressCallback) {
      progressCallback({
        type: "progress",
        message: `Starting to scrape ${wordsToScrape.length} words for ${languageName}...`,
        completed: alreadyScraped.size,
        total: baseWords.length,
      });
    }

    const scrapedEntries: WordListEntry[] = [];
    let failedWords = 0;
    this.geminiCallCount = 0;

    // Scrape words in batches for better performance
    // Gemini Pro has huge context window, so we can do entire language at once
    const batchSize = 2000;
    const useGemini = dataSources.includes("gemini");
    const useWiktionary = dataSources.includes("wiktionary");

    if (useGemini && process.env.GEMINI_API_KEY) {
      // Use Gemini for batch translation
      for (let i = 0; i < wordsToScrape.length; i += batchSize) {
        const batch = wordsToScrape.slice(i, i + batchSize);
        const batchResults = await this.scrapeBatchWithGemini(
          batch,
          languageId,
          languageName
        );

        for (const result of batchResults) {
          if (result) {
            scrapedEntries.push(result);

            if (resumable) {
              // Append to central words.tsv immediately for resumability
              const centralEntry: CentralWordEntry = {
                languageId,
                conceptId: result.conceptId,
                wordForm: result.wordForm,
                ipa: result.ipa,
              };
              await tsvWriter.appendToCentralWordsTSV([centralEntry], centralWordsPath);
            }
          } else {
            failedWords++;
          }
        }

        const completedCount = alreadyScraped.size + scrapedEntries.length;

        // Update job progress in store
        this.updateJobStatus(jobId, {
          completedWords: completedCount,
          failedWords,
        });

        if (progressCallback) {
          progressCallback({
            type: "progress",
            message: `Scraped ${completedCount}/${baseWords.length} words...`,
            completed: completedCount,
            total: baseWords.length,
            currentWord: batch[batch.length - 1]?.word,
          });
        }

        // Rate limiting: wait between batches
        await this.delay(1000);
      }
    } else if (useWiktionary) {
      // Use Wiktionary for individual word lookups
      for (let i = 0; i < wordsToScrape.length; i++) {
        const word = wordsToScrape[i];

        try {
          const result = await this.scrapeWithWiktionary(word, languageId);

          if (result) {
            scrapedEntries.push(result);

            if (resumable) {
              const centralEntry: CentralWordEntry = {
                languageId,
                conceptId: result.conceptId,
                wordForm: result.wordForm,
                ipa: result.ipa,
              };
              await tsvWriter.appendToCentralWordsTSV([centralEntry], centralWordsPath);
            }
          } else {
            failedWords++;
          }
        } catch (error) {
          console.error(`Failed to scrape "${word.word}":`, error);
          failedWords++;
        }

        const completedCount = alreadyScraped.size + scrapedEntries.length;

        // Update job progress every 10 words
        if ((i + 1) % 10 === 0) {
          this.updateJobStatus(jobId, {
            completedWords: completedCount,
            failedWords,
          });
        }

        if (progressCallback && (i + 1) % 10 === 0) {
          progressCallback({
            type: "progress",
            message: `Scraped ${completedCount}/${baseWords.length} words...`,
            completed: completedCount,
            total: baseWords.length,
            currentWord: word.word,
          });
        }

        // Rate limiting
        await this.delay(200);
      }
    } else {
      throw new Error(
        "No valid data source configured. Set GEMINI_API_KEY or enable Wiktionary."
      );
    }

    // If not using resumable mode, write all at once to central file
    if (!resumable && scrapedEntries.length > 0) {
      const centralEntries: CentralWordEntry[] = scrapedEntries.map(entry => ({
        languageId,
        conceptId: entry.conceptId,
        wordForm: entry.wordForm,
        ipa: entry.ipa,
      }));
      await tsvWriter.appendToCentralWordsTSV(centralEntries, centralWordsPath);
    }

    const result: WordScrapingResult = {
      languageId,
      totalWords: baseWords.length,
      scrapedWords: alreadyScraped.size + scrapedEntries.length,
      failedWords,
      apiCallsUsed: this.geminiCallCount,
      outputPath,
    };

    // Update job status to completed
    this.updateJobStatus(jobId, {
      status: "completed",
      completedWords: result.scrapedWords,
      failedWords: result.failedWords,
      completedAt: new Date().toISOString(),
      apiCallsUsed: result.apiCallsUsed,
      outputPath,
    });

    if (progressCallback) {
      progressCallback({
        type: "completed",
        message: `Completed! Scraped ${result.scrapedWords}/${result.totalWords} words`,
        completed: result.scrapedWords,
        total: result.totalWords,
      });
    }

    console.log(`Word scraping completed for ${languageName}`);
    console.log(`  Scraped: ${result.scrapedWords}/${result.totalWords}`);
    console.log(`  Failed: ${result.failedWords}`);
    console.log(`  API calls: ${result.apiCallsUsed}`);

    return result;
  }

  private async scrapeBatchWithGemini(
    words: BaseWord[],
    languageId: string,
    languageName: string
  ): Promise<(WordListEntry | null)[]> {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY not set");
      return words.map(() => null);
    }

    const geminiModel = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
    const apiVersion = geminiModel.startsWith("gemini-3-") ? "v1beta" : "v1";
    const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const wordList = words.map((w) => w.word).join(", ");

    const prompt = `You are a professional translator. Translate the following English words to ${languageName}:

${words.map((w, i) => `${i + 1}. ${w.word}`).join("\n")}

Return JSON ONLY in this structure (no markdown):
{
  "translations": [
    {
      "conceptId": "${words[0]?.id || ""}",
      "english": "word",
      "translation": "translated word",
      "ipa": "IPA pronunciation or null",
      "confidence": 0.95
    }
  ]
}

Guidelines:
- Provide the most common translation for each word
- Include IPA pronunciation if you know it (otherwise null)
- Set confidence from 0.5 to 1.0 based on certainty
- Maintain the same order as the input
- Return valid JSON only`;

    try {
      this.geminiCallCount++;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 32000,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini API error:", errorText);
        return words.map(() => null);
      }

      const data = (await response.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        console.error("No content from Gemini");
        return words.map(() => null);
      }

      const parsed = JSON.parse(rawText);

      if (!parsed || !Array.isArray(parsed.translations)) {
        console.error("Invalid response structure from Gemini");
        return words.map(() => null);
      }

      // Map translations back to words
      const results: (WordListEntry | null)[] = words.map((word, index) => {
        const translation = parsed.translations[index];

        if (!translation || !translation.translation) {
          return null;
        }

        return {
          conceptId: word.id,
          wordForm: translation.translation,
          ipa: translation.ipa || null,
          source: "gemini",
          confidence: translation.confidence || 0.8,
        };
      });

      return results;
    } catch (error) {
      console.error("Failed to scrape batch with Gemini:", error);
      return words.map(() => null);
    }
  }

  private async scrapeWithWiktionary(
    word: BaseWord,
    languageId: string
  ): Promise<WordListEntry | null> {
    try {
      const result = await this.linguisticAPI.getWiktionaryTranslation(
        word.word,
        "en",
        languageId
      );

      if (!result.success || !result.data) {
        return null;
      }

      return {
        conceptId: word.id,
        wordForm: result.data.translation,
        ipa: result.data.phoneticTranscription || null,
        source: "wiktionary",
        confidence: result.data.confidence,
      };
    } catch (error) {
      console.error(`Wiktionary lookup failed for "${word.word}":`, error);
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const wordListScraper = new WordListScraper();
