import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import { storage } from "../storage";
import type { Language } from "@contracts/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1500;

interface EnrichmentResult {
  id: string;
  latitude: number;
  longitude: number;
  timeOrigin: number;
  timeEnd: number | null;
}

class LanguageEnrichmentService {
  private static isScraping = false;

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

  async enrichLanguages(options: {
    languages: Language[];
    fields: ("coordinates" | "temporal")[];
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  }): Promise<{ enriched: number; failed: number }> {
    const { languages, fields, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for enrichment");
    }

    if (LanguageEnrichmentService.isScraping) {
      throw new Error("Language enrichment is already in progress");
    }

    LanguageEnrichmentService.isScraping = true;

    try {
      console.log(`Starting language enrichment for ${languages.length} languages, fields: ${fields.join(", ")}`);

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
        totalWords: languages.length,
        completedWords: 0,
      });

      if (progressCallback) {
        progressCallback("progress", `Starting enrichment for ${languages.length} languages...`);
      }

      // Filter to only languages that need enrichment
      const languagesToEnrich = languages.filter((lang) => {
        const needsCoordinates = fields.includes("coordinates") && !lang.coordinates;
        const needsTemporal =
          fields.includes("temporal") && (!lang.timeOrigin || lang.timeOrigin === "");
        return needsCoordinates || needsTemporal;
      });

      console.log(`${languagesToEnrich.length} languages need enrichment out of ${languages.length} total`);

      if (progressCallback) {
        progressCallback("progress", `${languagesToEnrich.length} languages need enrichment`);
      }

      // Process in batches
      const enrichmentMap = new Map<string, EnrichmentResult>();
      let enrichedCount = 0;
      let failedCount = 0;
      const totalBatches = Math.ceil(languagesToEnrich.length / BATCH_SIZE);

      for (let i = 0; i < languagesToEnrich.length; i += BATCH_SIZE) {
        const batch = languagesToEnrich.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

        if (progressCallback) {
          progressCallback(
            "progress",
            `Processing batch ${batchNumber}/${totalBatches} (${batch.length} languages)...`
          );
        }

        try {
          const results = await this.enrichBatch(batch, fields);

          for (const result of results) {
            enrichmentMap.set(result.id, result);
            enrichedCount++;
          }

          this.updateJobStatus(jobId, {
            completedWords: enrichedCount,
          });
        } catch (error) {
          console.error(`Batch ${batchNumber} failed:`, error);
          failedCount += batch.length;

          if (progressCallback) {
            progressCallback(
              "error",
              `Batch ${batchNumber} failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        // Rate limiting delay between batches
        if (i + BATCH_SIZE < languagesToEnrich.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Merge enriched data back into the full language list
      if (progressCallback) {
        progressCallback("progress", "Merging enriched data and writing to TSV...");
      }

      const allLanguages = await storage.getLanguages();
      const mergedLanguages = allLanguages.map((lang) => {
        const enrichment = enrichmentMap.get(lang.id);
        if (!enrichment) return lang;

        const updated = { ...lang };

        if (fields.includes("coordinates") && !lang.coordinates) {
          updated.coordinates = {
            lat: enrichment.latitude,
            lng: enrichment.longitude,
          };
        }

        if (fields.includes("temporal")) {
          if (!lang.timeOrigin || lang.timeOrigin === "") {
            updated.timeOrigin = String(enrichment.timeOrigin);
          }
          if ((!lang.timeEnd || lang.timeEnd === "") && enrichment.timeEnd !== null) {
            updated.timeEnd = String(enrichment.timeEnd);
          }
        }

        return updated;
      });

      await tsvWriter.writeLanguageTSV(mergedLanguages, "lexicons/languages.tsv");
      storage.invalidateCache("languages");

      this.updateJobStatus(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        completedWords: enrichedCount,
      });

      if (progressCallback) {
        progressCallback(
          "complete",
          `Enrichment complete: ${enrichedCount} enriched, ${failedCount} failed`
        );
      }

      console.log(`Language enrichment complete: ${enrichedCount} enriched, ${failedCount} failed`);

      return { enriched: enrichedCount, failed: failedCount };
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback(
          "error",
          `Enrichment failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      throw error;
    } finally {
      LanguageEnrichmentService.isScraping = false;
    }
  }

  private async enrichBatch(
    batch: Language[],
    fields: ("coordinates" | "temporal")[]
  ): Promise<EnrichmentResult[]> {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              id: { type: SchemaType.STRING },
              latitude: { type: SchemaType.NUMBER },
              longitude: { type: SchemaType.NUMBER },
              timeOrigin: { type: SchemaType.NUMBER },
              timeEnd: { type: SchemaType.NUMBER, nullable: true },
            },
            required: ["id", "latitude", "longitude", "timeOrigin"],
          },
        },
      },
    });

    const languageList = batch
      .map((lang, idx) => {
        const parts = [`${idx + 1}. ${lang.name} (id: ${lang.id}`];
        if (lang.familyId) parts.push(`, family: ${lang.familyId}`);
        parts.push(`, status: ${lang.status})`);
        return parts.join("");
      })
      .join("\n");

    const fieldInstructions: string[] = [];
    if (fields.includes("coordinates")) {
      fieldInstructions.push(
        "- latitude: The latitude of the geographic center where this language is/was primarily spoken (decimal degrees)",
        "- longitude: The longitude of the geographic center"
      );
    }
    if (fields.includes("temporal")) {
      fieldInstructions.push(
        "- timeOrigin: The approximate year this language is first attested or emerged (negative numbers for BCE, e.g., -500 for 500 BCE). For living languages without clear attestation, use a reasonable estimate.",
        "- timeEnd: The year this language ceased to be spoken as a native language, or null if still living"
      );
    }

    const prompt = `You are a professional linguist and geographer. For each of the following languages, provide geographic coordinates and temporal data.

Languages to enrich:
${languageList}

For each language, provide:
${fieldInstructions.join("\n")}

Return JSON array with objects containing: id, latitude, longitude, timeOrigin, timeEnd (null if still living).
Ensure the id field matches exactly the id provided for each language.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const parsed: EnrichmentResult[] = JSON.parse(text);

    // Validate that returned IDs match the batch
    const batchIds = new Set(batch.map((l) => l.id));
    return parsed.filter((r) => batchIds.has(r.id));
  }
}

export const languageEnrichmentService = new LanguageEnrichmentService();
