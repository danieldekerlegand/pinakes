import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "./job-store";
import type { Language } from "@shared/types";

/**
 * Service for enriching phonological inventories for languages using Google Gemini AI.
 * Writes to lexicons/phonological-inventories.tsv in TSV format with JSON-encoded fields.
 */
class PhonologyEnrichmentService {
  private static isScraping = false;
  private readonly filePath = "lexicons/phonological-inventories.tsv";
  private readonly headers = [
    "id",
    "language_id",
    "consonants",
    "vowels",
    "tones",
    "phonotactic_patterns",
    "syllable_structure",
    "stress_system",
  ];

  private updateJobStatus(
    jobId: string | undefined,
    updates: {
      status?: string;
      completedWords?: number;
      totalWords?: number;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
    }
  ): void {
    if (!jobId) return;

    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  /**
   * Read existing phonological-inventories.tsv and return the set of language IDs
   * that already have an inventory.
   */
  private async getExistingLanguageIds(): Promise<Set<string>> {
    const existingIds = new Set<string>();

    if (!fs.existsSync(this.filePath)) {
      return existingIds;
    }

    try {
      const content = await fs.promises.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");

      if (lines.length === 0) return existingIds;

      const header = lines[0].split("\t");
      const langIdIdx = header.indexOf("language_id");

      if (langIdIdx === -1) {
        console.warn("Could not find language_id column in phonological-inventories.tsv");
        return existingIds;
      }

      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split("\t");
        if (columns[langIdIdx]) {
          existingIds.add(columns[langIdIdx]);
        }
      }

      console.log(`Found ${existingIds.size} existing phonological inventories`);
      return existingIds;
    } catch (error) {
      console.error("Error reading existing phonological inventories:", error);
      return existingIds;
    }
  }

  /**
   * Read the existing TSV file and return all rows (excluding header).
   * Returns an empty array if the file doesn't exist.
   */
  private async readExistingRows(): Promise<string[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    try {
      const content = await fs.promises.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");

      // Skip header, return data rows
      return lines.slice(1);
    } catch (error) {
      console.error("Error reading existing phonological inventories:", error);
      return [];
    }
  }

  /**
   * Write the full TSV file atomically (temp file + rename).
   */
  private async writeAtomically(rows: string[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${this.filePath}.tmp`;

    try {
      const headerLine = this.headers.join("\t");
      const tsvContent = [headerLine, ...rows].join("\n") + "\n";

      await fs.promises.writeFile(tempFile, tsvContent, "utf8");
      await fs.promises.rename(tempFile, this.filePath);

      console.log(`Successfully wrote phonological inventories TSV (${rows.length} rows)`);
    } catch (error) {
      try {
        await fs.promises.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(
        `Failed to write phonological inventories TSV: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Convert a batch of Gemini results into TSV row strings.
   */
  private toTsvRows(
    results: Array<{
      languageId: string;
      consonants: string[];
      vowels: string[];
      tones: string[] | null;
      phonotacticPatterns: { onset?: string[]; coda?: string[]; maxSyllable?: string };
      syllableStructure: string;
      stressSystem: string;
    }>
  ): string[] {
    return results.map((r) => {
      const id = `phon_${r.languageId}`;
      const consonants = JSON.stringify(r.consonants);
      const vowels = JSON.stringify(r.vowels);
      const tones = r.tones ? JSON.stringify(r.tones) : "null";
      const phonotacticPatterns = JSON.stringify(r.phonotacticPatterns);

      return [
        id,
        r.languageId,
        consonants,
        vowels,
        tones,
        phonotacticPatterns,
        r.syllableStructure,
        r.stressSystem,
      ].join("\t");
    });
  }

  /**
   * Call Gemini to generate phonological inventories for a batch of languages.
   */
  private async generateBatch(
    languages: Language[]
  ): Promise<
    Array<{
      languageId: string;
      consonants: string[];
      vowels: string[];
      tones: string[] | null;
      phonotacticPatterns: { onset?: string[]; coda?: string[]; maxSyllable?: string };
      syllableStructure: string;
      stressSystem: string;
    }>
  > {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    const languageList = languages
      .map((lang, i) => `${i + 1}. ${lang.name} (id: ${lang.id}, family: ${lang.familyId})`)
      .join("\n");

    const prompt = `You are a professional phonologist. For each of the following languages, provide their phonological inventory.

Languages:
${languageList}

For each language, provide:
- consonants: Array of IPA symbols for all consonant phonemes
- vowels: Array of IPA symbols for all vowel phonemes
- tones: Array of tone categories (e.g., ["high", "low", "rising", "falling"]) or null if not a tonal language
- phonotacticPatterns: Object with onset (array of allowed onset patterns), coda (array of allowed coda patterns), and maxSyllable (e.g., "CCCVCCC")
- syllableStructure: The syllable template (e.g., "(C)(C)V(C)" for English)
- stressSystem: The stress system (e.g., "lexical", "penultimate", "initial", "fixed", "pitch-accent")

Use the language id field as the languageId in your response.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            inventories: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  languageId: { type: SchemaType.STRING },
                  consonants: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  vowels: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  tones: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    nullable: true,
                  },
                  phonotacticPatterns: {
                    type: SchemaType.OBJECT,
                    properties: {
                      onset: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                      },
                      coda: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                      },
                      maxSyllable: { type: SchemaType.STRING },
                    },
                    required: ["onset", "coda", "maxSyllable"],
                  },
                  syllableStructure: { type: SchemaType.STRING },
                  stressSystem: { type: SchemaType.STRING },
                },
                required: [
                  "languageId",
                  "consonants",
                  "vowels",
                  "phonotacticPatterns",
                  "syllableStructure",
                  "stressSystem",
                ],
              },
            },
          },
          required: ["inventories"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.inventories)) {
      throw new Error("Invalid response structure from Gemini");
    }

    return parsed.inventories.map((inv: any) => ({
      languageId: inv.languageId,
      consonants: inv.consonants || [],
      vowels: inv.vowels || [],
      tones: inv.tones || null,
      phonotacticPatterns: inv.phonotacticPatterns || { onset: [], coda: [], maxSyllable: "" },
      syllableStructure: inv.syllableStructure || "",
      stressSystem: inv.stressSystem || "",
    }));
  }

  /**
   * Enrich phonological inventories for languages that don't have one yet.
   * Processes in batches of 10 languages per Gemini call.
   */
  async enrichPhonologies(options: {
    languages: Language[];
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  }): Promise<{ enriched: number; failed: number }> {
    const { languages, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for phonology enrichment");
    }

    if (PhonologyEnrichmentService.isScraping) {
      throw new Error("Phonology enrichment is already in progress");
    }

    PhonologyEnrichmentService.isScraping = true;

    try {
      console.log("Starting phonology enrichment...");

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Reading existing phonological inventories...");
      }

      // Step 1: Read existing language IDs to skip
      const existingIds = await this.getExistingLanguageIds();

      // Step 2: Filter to languages that need enrichment
      const toEnrich = languages.filter((lang) => !existingIds.has(lang.id));

      if (toEnrich.length === 0) {
        console.log("All languages already have phonological inventories");

        if (progressCallback) {
          progressCallback("completed", "All languages already have phonological inventories");
        }

        this.updateJobStatus(jobId, {
          status: "completed",
          completedWords: 0,
          totalWords: 0,
          completedAt: new Date().toISOString(),
        });

        return { enriched: 0, failed: 0 };
      }

      console.log(`${toEnrich.length} languages need phonological inventories (${existingIds.size} already exist)`);

      if (progressCallback) {
        progressCallback(
          "progress",
          `Found ${toEnrich.length} languages needing phonological inventories`
        );
      }

      this.updateJobStatus(jobId, {
        totalWords: toEnrich.length,
      });

      // Step 3: Process in batches of 10
      const batchSize = 10;
      let enriched = 0;
      let failed = 0;

      for (let i = 0; i < toEnrich.length; i += batchSize) {
        const batch = toEnrich.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(toEnrich.length / batchSize);

        console.log(
          `Processing batch ${batchNum}/${totalBatches} (${batch.map((l) => l.name).join(", ")})`
        );

        if (progressCallback) {
          progressCallback(
            "progress",
            `Enriching batch ${batchNum}/${totalBatches}: ${batch.map((l) => l.name).join(", ")}...`
          );
        }

        try {
          const results = await this.generateBatch(batch);
          const newRows = this.toTsvRows(results);

          // Step 5: Read existing file, append new rows, write atomically
          const existingRows = await this.readExistingRows();
          const allRows = [...existingRows, ...newRows];
          await this.writeAtomically(allRows);

          enriched += results.length;

          console.log(`  Batch ${batchNum}: enriched ${results.length} languages`);
        } catch (error) {
          console.error(`Failed to process batch ${batchNum}:`, error);

          if (progressCallback) {
            progressCallback(
              "error",
              `Failed batch ${batchNum}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }

          failed += batch.length;
        }

        this.updateJobStatus(jobId, {
          completedWords: enriched + failed,
        });

        // Delay between batches to avoid rate limiting
        if (i + batchSize < toEnrich.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log(`Phonology enrichment completed: ${enriched} enriched, ${failed} failed`);

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: enriched + failed,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback(
          "completed",
          `Phonology enrichment completed: ${enriched} enriched, ${failed} failed`
        );
      }

      return { enriched, failed };
    } catch (error) {
      console.error("Error during phonology enrichment:", error);

      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("error", `Phonology enrichment failed: ${error}`);
      }

      throw error;
    } finally {
      PhonologyEnrichmentService.isScraping = false;
    }
  }
}

export const phonologyEnrichmentService = new PhonologyEnrichmentService();
