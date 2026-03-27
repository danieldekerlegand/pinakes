import fs from "node:fs";
import { jobStore } from "./job-store";

export interface LanguageContactEntry {
  id: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  contactType: string;
  timePeriod: string;
  region: string;
  featuresTransferred: { lexical: string[]; phonological: string[]; grammatical: string[] };
  exampleFeatures: string;
  intensity: string;
}

export interface ContactScrapingOptions {
  contactTypes?: string[];
  regions?: string[];
  targetCount?: number;
  jobId?: string;
  progressCallback?: (type: string, message: string, data?: any) => void;
}

export interface ContactScrapingResult {
  totalExisting: number;
  newEntries: number;
  totalAfter: number;
  contactTypes: Record<string, number>;
}

/**
 * Language Contact Events Scraper
 * Uses Google Gemini AI to generate language contact event data
 * and appends to lexicons/language-contacts.tsv
 */
export class LanguageContactScraper {
  private static isScraping = false;
  private static readonly TSV_PATH = "lexicons/language-contacts.tsv";
  private static readonly BATCH_SIZE = 50;

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
   * Get existing contact event IDs from the TSV file
   */
  getExistingContactIds(): Set<string> {
    const ids = new Set<string>();
    const filePath = LanguageContactScraper.TSV_PATH;

    if (!fs.existsSync(filePath)) return ids;

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const id = lines[i].split("\t")[0];
      if (id) ids.add(id);
    }

    return ids;
  }

  /**
   * Get the next available contact ID number
   */
  private getNextIdNumber(existingIds: Set<string>): number {
    let maxNum = 0;
    for (const id of existingIds) {
      const match = id.match(/^lc-(\d+)$/);
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    }
    return maxNum + 1;
  }

  /**
   * Main scraping method - enriches language-contacts.tsv with new contact events
   */
  async scrapeLanguageContacts(
    options: ContactScrapingOptions = {}
  ): Promise<ContactScrapingResult> {
    const {
      contactTypes = ["substrate", "superstrate", "adstrate", "creolization", "pidginization"],
      regions,
      targetCount = 300,
      jobId,
      progressCallback,
    } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (LanguageContactScraper.isScraping) {
      throw new Error("Language contact scraping is already in progress");
    }

    LanguageContactScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Reading existing contact events...");
      }

      const existingIds = this.getExistingContactIds();
      const existingCount = existingIds.size;
      const needed = Math.max(0, targetCount - existingCount);

      console.log(`Existing contacts: ${existingCount}, target: ${targetCount}, need: ${needed}`);

      if (needed === 0) {
        if (progressCallback) {
          progressCallback("completed", `Already have ${existingCount} contacts, target is ${targetCount}`);
        }
        this.updateJobStatus(jobId, {
          status: "completed",
          completedAt: new Date().toISOString(),
        });
        return {
          totalExisting: existingCount,
          newEntries: 0,
          totalAfter: existingCount,
          contactTypes: {},
        };
      }

      this.updateJobStatus(jobId, { totalWords: needed });

      let nextId = this.getNextIdNumber(existingIds);
      let totalNew = 0;
      const typeCounts: Record<string, number> = {};

      // Scrape in batches
      const batchCount = Math.ceil(needed / LanguageContactScraper.BATCH_SIZE);

      for (let batch = 0; batch < batchCount; batch++) {
        const remaining = needed - totalNew;
        const batchTarget = Math.min(LanguageContactScraper.BATCH_SIZE, remaining);

        if (progressCallback) {
          progressCallback(
            "progress",
            `Scraping batch ${batch + 1}/${batchCount} (${batchTarget} events)...`,
            { completed: totalNew, total: needed }
          );
        }

        // Rotate through contact types and regions for diversity
        const batchType = contactTypes[batch % contactTypes.length];
        const batchRegion = regions?.[batch % regions.length];

        const entries = await this.scrapeBatchWithGemini(
          batchTarget,
          nextId,
          batchType,
          batchRegion,
          existingIds
        );

        if (entries.length > 0) {
          await this.appendToTsv(entries);

          for (const entry of entries) {
            existingIds.add(entry.id);
            typeCounts[entry.contactType] = (typeCounts[entry.contactType] || 0) + 1;
          }

          nextId += entries.length;
          totalNew += entries.length;
        }

        this.updateJobStatus(jobId, { completedWords: totalNew });

        // Rate limit between batches
        if (batch < batchCount - 1) {
          await this.delay(1500);
        }
      }

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: totalNew,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", `Added ${totalNew} new contact events (total: ${existingCount + totalNew})`);
      }

      console.log(`Language contact scraping completed: ${totalNew} new entries`);

      return {
        totalExisting: existingCount,
        newEntries: totalNew,
        totalAfter: existingCount + totalNew,
        contactTypes: typeCounts,
      };
    } catch (error) {
      console.error("Error during language contact scraping:", error);

      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("error", `Scraping failed: ${error}`);
      }
      throw error;
    } finally {
      LanguageContactScraper.isScraping = false;
    }
  }

  /**
   * Scrape a batch of contact events using Gemini AI
   */
  private async scrapeBatchWithGemini(
    count: number,
    startId: number,
    contactType: string,
    region: string | undefined,
    existingIds: Set<string>
  ): Promise<LanguageContactEntry[]> {
    const geminiModel = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
    const apiVersion = geminiModel.startsWith("gemini-3-") ? "v1beta" : "v1";
    const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const regionConstraint = region ? `Focus on the ${region} region.` : "Cover diverse global regions.";

    const prompt = `You are a professional historical linguist and language contact specialist. Generate ${count} documented language contact events.

Focus on "${contactType}" contact type. ${regionConstraint}

Contact types:
- substrate: influence from a conquered/subordinate language on the dominant language
- superstrate: influence from a socially dominant language on a subordinate language
- adstrate: mutual influence between languages of roughly equal prestige
- creolization: formation of a creole language from pidgin/contact languages
- pidginization: formation of a simplified contact language for trade/communication

Return JSON ONLY in this structure (no markdown):
{
  "contacts": [
    {
      "source_language_id": "ISO 639-2/3 code of donor language",
      "target_language_id": "ISO 639-2/3 code of recipient language",
      "contact_type": "${contactType}",
      "time_period": "start_year-end_year (e.g. 1066-1400 or -500-200 for BCE)",
      "region": "Geographic region",
      "features_transferred": {
        "lexical": ["category of borrowed words"],
        "phonological": ["phonological features transferred"],
        "grammatical": ["grammatical features transferred"]
      },
      "example_features": "Specific examples of transferred features with example words",
      "intensity": "heavy|moderate|light"
    }
  ]
}

Guidelines:
- Use real, historically documented language contact events
- Use correct ISO 639-2/3 language codes (3-letter codes)
- Include diverse time periods from antiquity to modern era
- Include specific examples of borrowed words or features
- features_transferred must have all three keys (lexical, phonological, grammatical) as arrays
- Each array can be empty if that type of transfer didn't occur
- For creolization/pidginization, source is the lexifier and target is the resulting language
- Include contacts from under-represented regions: Southeast Asia, Sub-Saharan Africa, Pacific, Americas
- Ensure variety: don't repeat the same language pairs`;

    try {
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
        return [];
      }

      const data = (await response.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        console.error("No content from Gemini");
        return [];
      }

      const parsed = JSON.parse(rawText);

      if (!parsed || !Array.isArray(parsed.contacts)) {
        console.error("Invalid response structure from Gemini");
        return [];
      }

      // Convert to entries with IDs
      const entries: LanguageContactEntry[] = [];
      let idNum = startId;

      for (const contact of parsed.contacts) {
        if (!contact.source_language_id || !contact.target_language_id) continue;

        const id = `lc-${String(idNum).padStart(3, "0")}`;

        // Skip if somehow already exists
        if (existingIds.has(id)) {
          idNum++;
          continue;
        }

        const features = contact.features_transferred || {};

        entries.push({
          id,
          sourceLanguageId: contact.source_language_id,
          targetLanguageId: contact.target_language_id,
          contactType: contact.contact_type || contactType,
          timePeriod: contact.time_period || "",
          region: contact.region || "",
          featuresTransferred: {
            lexical: Array.isArray(features.lexical) ? features.lexical : [],
            phonological: Array.isArray(features.phonological) ? features.phonological : [],
            grammatical: Array.isArray(features.grammatical) ? features.grammatical : [],
          },
          exampleFeatures: contact.example_features || "",
          intensity: contact.intensity || "moderate",
        });

        idNum++;
      }

      console.log(`  → Generated ${entries.length} contact events for ${contactType}`);
      return entries;
    } catch (error) {
      console.error("Failed to scrape batch with Gemini:", error);
      return [];
    }
  }

  /**
   * Append new contact entries to the TSV file
   */
  private async appendToTsv(entries: LanguageContactEntry[]): Promise<void> {
    const filePath = LanguageContactScraper.TSV_PATH;
    const fileExists = fs.existsSync(filePath);

    if (!fileExists) {
      // Create with header
      const header = "id\tsource_language_id\ttarget_language_id\tcontact_type\ttime_period\tregion\tfeatures_transferred\texample_features\tintensity\n";
      await fs.promises.writeFile(filePath, header, "utf8");
    }

    const rows = entries.map((e) => {
      const features = JSON.stringify(e.featuresTransferred);
      return [
        e.id,
        e.sourceLanguageId,
        e.targetLanguageId,
        e.contactType,
        e.timePeriod,
        e.region,
        features,
        e.exampleFeatures,
        e.intensity,
      ].join("\t");
    });

    const content = rows.join("\n") + "\n";
    await fs.promises.appendFile(filePath, content, "utf8");
    console.log(`Appended ${entries.length} contact entries to ${filePath}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const languageContactScraper = new LanguageContactScraper();
