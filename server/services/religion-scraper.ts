import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import fs from "node:fs";

export interface ReligionEntry {
  id: string;
  name: string;
  nativeName: string;
  religionType: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  sacredTexts: string[];
  associatedLanguageIds: string[];
  deityPantheon: string[];
  ritualPractices: string[];
  description: string;
  sources: string[];
}

/**
 * Scraper that uses Gemini AI to generate comprehensive religion and belief system data.
 * Writes results to lexicons/religions.tsv.
 */
export class ReligionScraper {
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
      statusMessage?: string;
    }
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  async scrapeReligions(options: {
    jobId?: string;
    progressCallback?: (type: string, message: string) => void;
  } = {}): Promise<{ religions: ReligionEntry[] }> {
    const { jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (ReligionScraper.isScraping) {
      throw new Error("Religion scraping is already in progress");
    }

    ReligionScraper.isScraping = true;

    try {
      console.log("Starting religion and belief systems scraping with Gemini AI...");

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Loading existing religions...");
      }

      const existingIds = await this.getExistingReligionIds();

      if (progressCallback) {
        progressCallback("progress", `Found ${existingIds.size} existing religions, discovering new ones...`);
      }

      this.updateJobStatus(jobId, { totalWords: 3 });

      // Scrape in batches by category
      const categories = [
        {
          name: "Major world religions and ancient religions",
          prompt: this.buildMajorReligionsPrompt(existingIds),
        },
        {
          name: "Indigenous, tribal, and folk religions",
          prompt: this.buildIndigenousReligionsPrompt(existingIds),
        },
        {
          name: "New religious movements and syncretic traditions",
          prompt: this.buildSyncreticReligionsPrompt(existingIds),
        },
      ];

      const allReligions: ReligionEntry[] = [];

      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];

        if (progressCallback) {
          progressCallback("progress", `Scraping batch ${i + 1}/${categories.length}: ${category.name}...`);
        }

        try {
          const religions = await this.scrapeCategory(category.prompt);
          // Filter out any that already exist
          const newReligions = religions.filter((r) => !existingIds.has(r.id));
          allReligions.push(...newReligions);

          // Track newly added IDs to avoid duplicates across batches
          for (const r of newReligions) {
            existingIds.add(r.id);
          }

          console.log(`  → Scraped ${newReligions.length} new religions from: ${category.name}`);

          this.updateJobStatus(jobId, { completedWords: i + 1 });
        } catch (error) {
          console.error(`Failed to scrape category "${category.name}":`, error);
          if (progressCallback) {
            progressCallback("error", `Failed to scrape ${category.name}: ${error}`);
          }
        }

        // Rate limiting between batches
        if (i < categories.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (progressCallback) {
        progressCallback("progress", "Writing to TSV file...");
      }

      // Read existing data, merge with new, and write
      await this.mergeAndWriteReligions(allReligions);

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: categories.length,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", `Scraping completed! Added ${allReligions.length} new religions.`);
      }

      console.log(`Religion scraping completed: ${allReligions.length} new religions added`);

      return { religions: allReligions };
    } catch (error) {
      console.error("Error during religion scraping:", error);

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
      ReligionScraper.isScraping = false;
    }
  }

  private async getExistingReligionIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const filePath = "lexicons/religions.tsv";

    if (!fs.existsSync(filePath)) {
      return ids;
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length <= 1) return ids;

    const header = lines[0].split("\t");
    const idIdx = header.indexOf("id");
    if (idIdx === -1) return ids;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols[idIdx]) {
        ids.add(cols[idIdx]);
      }
    }

    return ids;
  }

  private buildMajorReligionsPrompt(existingIds: Set<string>): string {
    const excludeList = existingIds.size > 0
      ? `\n\nDO NOT include religions with these IDs (already in database): ${[...existingIds].join(", ")}`
      : "";

    return `You are an expert in comparative religion and religious studies. Generate a comprehensive list of major world religions and significant ancient/historical religions that are NOT already in our database.${excludeList}

Include religions such as:
- Major denominations that are distinct traditions (e.g., Baha'i, Mandaeism, Yazidism, Druze, Cao Dai)
- Ancient religions with significant historical impact (Mesopotamian, Canaanite, Phoenician, Etruscan, Slavic paganism, Baltic paganism)
- Important historical belief systems (Manichaeism, Mithraism, Gnosticism, Catharism)

For each religion provide:
- A unique kebab-case id (e.g., "bahai-faith", "mandaeism")
- The common English name
- The native/original name in appropriate script
- Religion type: monotheistic, polytheistic, nontheistic, animistic, dualistic, henotheistic, pantheistic, philosophical, or syncretic
- Origin region (e.g., "Middle East", "South Asia", "East Asia")
- Coordinates (lat/lng) of the primary origin location
- Time of origin (negative for BCE, positive for CE)
- Time of end (null if still practiced, year if defunct)
- Sacred texts as an array of names
- Associated language IDs (historical languages of the tradition)
- Deity pantheon as an array of major deity names
- Ritual practices as an array
- A one-sentence description
- Sources as an array

Generate 15-25 religions. Be accurate with dates, locations, and names.`;
  }

  private buildIndigenousReligionsPrompt(existingIds: Set<string>): string {
    const excludeList = existingIds.size > 0
      ? `\n\nDO NOT include religions with these IDs (already in database): ${[...existingIds].join(", ")}`
      : "";

    return `You are an expert in comparative religion and indigenous belief systems. Generate a list of indigenous, tribal, and folk religions from around the world.${excludeList}

Include belief systems such as:
- African traditional religions (Vodun/Voodoo, Santeria, Ifá, Akan religion, Dinka religion)
- Native American spiritualities (Lakota, Navajo, Haudenosaunee)
- Polynesian/Pacific religions (Hawaiian, Maori, Samoan)
- Asian folk religions (Chinese folk religion, Korean shamanism/Muism, Vietnamese folk religion, Bon)
- Siberian/Arctic shamanism (Sami, Evenki)
- South American indigenous (Mapuche, Guarani)

For each religion provide the same fields:
- id (kebab-case), name, native_name, religion_type, origin_region
- coordinates (lat/lng), time_origin, time_end
- sacred_texts, associated_language_ids, deity_pantheon, ritual_practices
- description, sources

Generate 15-25 religions. Be respectful and accurate about indigenous traditions.`;
  }

  private buildSyncreticReligionsPrompt(existingIds: Set<string>): string {
    const excludeList = existingIds.size > 0
      ? `\n\nDO NOT include religions with these IDs (already in database): ${[...existingIds].join(", ")}`
      : "";

    return `You are an expert in comparative religion. Generate a list of syncretic religions, new religious movements, and other notable belief systems.${excludeList}

Include:
- Syncretic traditions (Rastafari, Umbanda, Candomblé, Wicca, Thelema)
- New religious movements with significant followings (Scientology, Unification Church, Falun Gong, Ahmadiyya)
- Reform and revival movements that are distinct traditions (Karaite Judaism, Reconstructionist Judaism if distinct enough)
- Esoteric/mystical traditions (Hermeticism, Rosicrucianism, Theosophy, Sufism as distinct tradition)
- Philosophical movements with religious characteristics (Stoicism, Epicureanism, Deism)
- Ancient mystery religions (Eleusinian Mysteries, Orphism, Dionysian Mysteries)

For each provide the same fields:
- id (kebab-case), name, native_name, religion_type, origin_region
- coordinates (lat/lng), time_origin, time_end
- sacred_texts, associated_language_ids, deity_pantheon, ritual_practices
- description, sources

Generate 15-25 entries. Be accurate with dates and classifications.`;
  }

  private async scrapeCategory(prompt: string): Promise<ReligionEntry[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            religions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  nativeName: { type: SchemaType.STRING },
                  religionType: { type: SchemaType.STRING },
                  originRegion: { type: SchemaType.STRING },
                  latitude: { type: SchemaType.NUMBER },
                  longitude: { type: SchemaType.NUMBER },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  timeEnd: { type: SchemaType.NUMBER, nullable: true },
                  sacredTexts: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  associatedLanguageIds: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  deityPantheon: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  ritualPractices: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  description: { type: SchemaType.STRING },
                  sources: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: [
                  "id", "name", "nativeName", "religionType", "originRegion",
                  "latitude", "longitude", "description", "sources",
                ],
              },
            },
          },
          required: ["religions"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.religions)) {
      throw new Error("Invalid response structure from Gemini");
    }

    return parsed.religions.map((r: any) => ({
      id: this.slugify(r.id || r.name),
      name: r.name,
      nativeName: r.nativeName || "",
      religionType: r.religionType || "unknown",
      originRegion: r.originRegion || "",
      coordinates: {
        lat: typeof r.latitude === "number" ? r.latitude : 0,
        lng: typeof r.longitude === "number" ? r.longitude : 0,
      },
      timeOrigin: r.timeOrigin ?? null,
      timeEnd: r.timeEnd ?? null,
      sacredTexts: Array.isArray(r.sacredTexts) ? r.sacredTexts : [],
      associatedLanguageIds: Array.isArray(r.associatedLanguageIds) ? r.associatedLanguageIds : [],
      deityPantheon: Array.isArray(r.deityPantheon) ? r.deityPantheon : [],
      ritualPractices: Array.isArray(r.ritualPractices) ? r.ritualPractices : [],
      description: r.description || "",
      sources: Array.isArray(r.sources) ? r.sources : [],
    }));
  }

  private async mergeAndWriteReligions(newReligions: ReligionEntry[]): Promise<void> {
    const filePath = "lexicons/religions.tsv";

    // Read existing content
    let existingContent = "";
    if (fs.existsSync(filePath)) {
      existingContent = await fs.promises.readFile(filePath, "utf-8");
    }

    const lines = existingContent.trim().split("\n");
    const header = lines.length > 0 ? lines[0] : "";
    const expectedHeader = "id\tname\tnative_name\treligion_type\torigin_region\tcoordinates\ttime_origin\ttime_end\tsacred_texts\tassociated_language_ids\tdeity_pantheon\tritual_practices\tdescription\tsources";

    // Build new rows
    const newRows = newReligions.map((r) => this.religionToTsvRow(r));

    if (!existingContent || lines.length <= 1) {
      // No existing data, write fresh
      const content = [expectedHeader, ...newRows].join("\n") + "\n";
      await this.atomicWrite(filePath, content);
    } else {
      // Append to existing file
      const content = newRows.join("\n") + "\n";
      await fs.promises.appendFile(filePath, content, "utf-8");
    }

    console.log(`Successfully wrote ${newReligions.length} new religions to ${filePath}`);
  }

  private religionToTsvRow(r: ReligionEntry): string {
    return [
      r.id,
      r.name,
      r.nativeName,
      r.religionType,
      r.originRegion,
      JSON.stringify(r.coordinates),
      r.timeOrigin?.toString() ?? "null",
      r.timeEnd?.toString() ?? "null",
      JSON.stringify(r.sacredTexts),
      JSON.stringify(r.associatedLanguageIds),
      JSON.stringify(r.deityPantheon),
      JSON.stringify(r.ritualPractices),
      r.description,
      JSON.stringify(r.sources),
    ].join("\t");
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempFile = `${filePath}.tmp`;
    try {
      await fs.promises.writeFile(tempFile, content, "utf-8");
      await fs.promises.rename(tempFile, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tempFile);
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

export const religionScraper = new ReligionScraper();
