import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import type { SoundChange } from "../tsv-storage";
import { jobStore } from "./job-store";

export interface SoundChangeScrapingOptions {
  familyIds?: string[];
  jobId?: string;
  progressCallback?: (progress: {
    type: "progress" | "completed" | "error";
    message: string;
    completed?: number;
    total?: number;
  }) => void;
}

export interface SoundChangeScrapingResult {
  totalScraped: number;
  newChanges: number;
  apiCallsUsed: number;
}

interface GeminiSoundChange {
  name: string;
  familyId: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  changeRule: string;
  environment: string;
  dateRange: string;
  examples: Array<{ before: string; after: string; meaning: string }>;
  relatedChangeNames: string[];
}

const LANGUAGE_FAMILY_PROMPTS: Record<string, string> = {
  indo_european: "Indo-European language family (including Germanic, Romance, Slavic, Celtic, Indo-Iranian, Hellenic, Armenian, Albanian, Baltic, Italic, Tocharian, Anatolian branches)",
  sino_tibetan: "Sino-Tibetan language family (including Sinitic/Chinese, Tibeto-Burman branches)",
  afroasiatic: "Afroasiatic language family (including Semitic, Berber, Cushitic, Chadic, Egyptian, Omotic branches)",
  austronesian: "Austronesian language family (including Malayo-Polynesian, Formosan, Oceanic branches)",
  niger_congo: "Niger-Congo language family (including Bantu, Atlantic, Mande branches)",
  uralic: "Uralic language family (including Finno-Ugric, Samoyedic branches)",
  dravidian: "Dravidian language family (including South, Central, Northern Dravidian branches)",
  turkic: "Turkic language family (including Oghuz, Kipchak, Karluk, Siberian branches)",
  austroasiatic: "Austroasiatic language family (including Mon-Khmer, Munda branches)",
  tai_kadai: "Tai-Kadai language family (including Tai, Kam-Sui, Hlai branches)",
  japonic: "Japonic language family (Japanese, Ryukyuan languages)",
  koreanic: "Koreanic language family",
  quechuan: "Quechuan language family",
  uto_aztecan: "Uto-Aztecan language family",
  algonquian: "Algonquian language family",
  mayan: "Mayan language family",
};

const DEFAULT_FAMILIES = [
  "indo_european",
  "sino_tibetan",
  "afroasiatic",
  "austronesian",
  "niger_congo",
  "uralic",
  "dravidian",
  "turkic",
  "austroasiatic",
  "tai_kadai",
  "japonic",
  "koreanic",
];

export class SoundChangeScraper {
  private static isScraping = false;
  private apiCallCount = 0;

  private updateJobStatus(
    jobId: string | undefined,
    updates: Record<string, unknown>,
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  async scrapeSoundChanges(
    options: SoundChangeScrapingOptions = {},
  ): Promise<SoundChangeScrapingResult> {
    const { familyIds, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (SoundChangeScraper.isScraping) {
      throw new Error("Sound change scraping is already in progress");
    }

    SoundChangeScraper.isScraping = true;
    this.apiCallCount = 0;

    try {
      const families = familyIds ?? DEFAULT_FAMILIES;
      const existingChanges = this.loadExistingSoundChanges();
      const existingNames = new Set(existingChanges.map((c) => c.name.toLowerCase()));
      const nextId = this.getNextId(existingChanges);

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
        totalWords: families.length,
      });

      progressCallback?.({
        type: "progress",
        message: `Scraping sound changes for ${families.length} language families...`,
        total: families.length,
      });

      const allNewChanges: SoundChange[] = [];
      let currentId = nextId;

      for (let i = 0; i < families.length; i++) {
        const familyKey = families[i];
        const familyLabel = LANGUAGE_FAMILY_PROMPTS[familyKey] ?? familyKey;

        progressCallback?.({
          type: "progress",
          message: `Scraping ${familyLabel} (${i + 1}/${families.length})...`,
          completed: i,
          total: families.length,
        });

        try {
          const scraped = await this.scrapeFamilySoundChanges(familyKey, familyLabel, existingNames);

          for (const raw of scraped) {
            const id = `sc${String(currentId).padStart(3, "0")}`;
            currentId++;

            allNewChanges.push({
              id,
              name: raw.name,
              familyId: raw.familyId,
              sourceLanguageId: raw.sourceLanguageId,
              targetLanguageId: raw.targetLanguageId,
              changeRule: raw.changeRule,
              environment: raw.environment,
              dateRange: raw.dateRange,
              examples: raw.examples,
              relatedChanges: raw.relatedChangeNames,
            });

            existingNames.add(raw.name.toLowerCase());
          }

          console.log(`  → Scraped ${scraped.length} new sound changes for ${familyKey}`);

          this.updateJobStatus(jobId, { completedWords: i + 1 });

          // Rate limit between API calls
          if (i < families.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Failed to scrape sound changes for ${familyKey}:`, error);
          progressCallback?.({
            type: "error",
            message: `Failed to scrape ${familyKey}: ${error}`,
          });
        }
      }

      // Append new changes to existing TSV
      if (allNewChanges.length > 0) {
        this.appendSoundChangesToTSV(allNewChanges);
      }

      // Resolve related change references (convert names to IDs)
      this.resolveRelatedChanges(existingChanges, allNewChanges);

      this.updateJobStatus(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        completedWords: families.length,
        apiCallsUsed: this.apiCallCount,
      });

      progressCallback?.({
        type: "completed",
        message: `Scraped ${allNewChanges.length} new sound changes across ${families.length} families`,
        completed: families.length,
        total: families.length,
      });

      return {
        totalScraped: allNewChanges.length + existingChanges.length,
        newChanges: allNewChanges.length,
        apiCallsUsed: this.apiCallCount,
      };
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });

      progressCallback?.({
        type: "error",
        message: `Scraping failed: ${error}`,
      });

      throw error;
    } finally {
      SoundChangeScraper.isScraping = false;
    }
  }

  private async scrapeFamilySoundChanges(
    familyKey: string,
    familyLabel: string,
    existingNames: Set<string>,
  ): Promise<GeminiSoundChange[]> {
    const excludeList = existingNames.size > 0
      ? `\n\nDo NOT include these sound changes that we already have:\n${Array.from(existingNames).slice(0, 100).join(", ")}`
      : "";

    const prompt = `You are a professional historical linguist. Generate a comprehensive list of well-documented sound changes (phonological shifts) for the ${familyLabel}.${excludeList}

Guidelines:
- Include 10-20 of the most important and well-documented sound changes
- Each sound change should have a clear phonological rule using IPA notation (e.g., "p → f", "k → tʃ / _i")
- Use ISO 639-2/3 codes for source and target languages where possible (e.g., "lat" for Latin, "fra" for French, "eng" for English, "san" for Sanskrit)
- For proto-languages, use conventional abbreviations (e.g., "pie" for Proto-Indo-European)
- The familyId should use the format: "${familyKey}" or "${familyKey}__branch" (e.g., "indo_european__germanic")
- Provide 3-4 concrete examples per change with before/after word forms and meanings
- dateRange should be approximate century ranges (e.g., "-500 to -100" for 500-100 BCE, "1400 to 1700" for CE dates)
- environment describes the phonological context (e.g., "word-initial", "intervocalic", "before front vowels")
- relatedChangeNames should list names of related sound changes in the same chain or system
- Focus on changes that are academically well-established and widely cited`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            soundChanges: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  familyId: { type: SchemaType.STRING },
                  sourceLanguageId: { type: SchemaType.STRING },
                  targetLanguageId: { type: SchemaType.STRING },
                  changeRule: { type: SchemaType.STRING },
                  environment: { type: SchemaType.STRING },
                  dateRange: { type: SchemaType.STRING },
                  examples: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        before: { type: SchemaType.STRING },
                        after: { type: SchemaType.STRING },
                        meaning: { type: SchemaType.STRING },
                      },
                      required: ["before", "after", "meaning"],
                    },
                  },
                  relatedChangeNames: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: [
                  "name", "familyId", "sourceLanguageId", "targetLanguageId",
                  "changeRule", "environment", "dateRange", "examples", "relatedChangeNames",
                ],
              },
            },
          },
          required: ["soundChanges"],
        },
      },
    });

    this.apiCallCount++;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as { soundChanges: GeminiSoundChange[] };

    // Filter out duplicates
    return parsed.soundChanges.filter(
      (sc) => !existingNames.has(sc.name.toLowerCase()),
    );
  }

  private loadExistingSoundChanges(): SoundChange[] {
    const filePath = "data/source/lexicons/sound-changes.tsv";
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    if (lines.length <= 1) return [];

    const header = lines[0].split("\t");
    const idx = (name: string) => header.indexOf(name);

    return lines.slice(1).map((line) => {
      const cols = line.split("\t");
      return {
        id: cols[idx("id")] || "",
        name: cols[idx("name")] || "",
        familyId: cols[idx("family_id")] || "",
        sourceLanguageId: cols[idx("source_language_id")] || "",
        targetLanguageId: cols[idx("target_language_id")] || "",
        changeRule: cols[idx("change_rule")] || "",
        environment: cols[idx("environment")] || "",
        dateRange: cols[idx("date_range")] || "",
        examples: (() => {
          try { return JSON.parse(cols[idx("examples")] || "[]"); } catch { return []; }
        })(),
        relatedChanges: (() => {
          try { return JSON.parse(cols[idx("related_changes")] || "[]"); } catch { return []; }
        })(),
      };
    });
  }

  private getNextId(existing: SoundChange[]): number {
    let maxId = 0;
    for (const sc of existing) {
      const num = parseInt(sc.id.replace("sc", ""), 10);
      if (!isNaN(num) && num > maxId) maxId = num;
    }
    return maxId + 1;
  }

  private appendSoundChangesToTSV(changes: SoundChange[]): void {
    const filePath = "data/source/lexicons/sound-changes.tsv";
    const fileExists = fs.existsSync(filePath);

    if (!fileExists) {
      const headers = [
        "id", "name", "family_id", "source_language_id", "target_language_id",
        "change_rule", "environment", "date_range", "examples", "related_changes",
      ];
      fs.writeFileSync(filePath, headers.join("\t") + "\n", "utf8");
    }

    const rows = changes.map((sc) =>
      [
        sc.id,
        sc.name,
        sc.familyId,
        sc.sourceLanguageId,
        sc.targetLanguageId,
        sc.changeRule,
        sc.environment,
        sc.dateRange,
        JSON.stringify(sc.examples),
        JSON.stringify(sc.relatedChanges),
      ].join("\t"),
    );

    fs.appendFileSync(filePath, rows.join("\n") + "\n", "utf8");
    console.log(`Appended ${changes.length} sound changes to ${filePath}`);
  }

  private resolveRelatedChanges(
    existing: SoundChange[],
    newChanges: SoundChange[],
  ): void {
    const allChanges = [...existing, ...newChanges];
    const nameToId = new Map<string, string>();
    for (const sc of allChanges) {
      nameToId.set(sc.name.toLowerCase(), sc.id);
    }

    // Update relatedChanges from names to IDs where possible
    for (const sc of newChanges) {
      sc.relatedChanges = sc.relatedChanges
        .map((name) => nameToId.get(name.toLowerCase()) ?? name)
        .filter((ref) => ref !== sc.id);
    }
  }
}

export const soundChangeScraper = new SoundChangeScraper();
