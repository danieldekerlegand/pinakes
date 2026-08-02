import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Language, LanguageFamily } from "@contracts/types";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";

/**
 * Refactored Language Family Scraper that writes to TSV files instead of database
 * Uses Google Gemini AI to generate comprehensive language family hierarchies
 */
export class LanguageFamilyScraperTSV {
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

  async scrapeLanguageFamilies(
    options: {
      clearExisting?: boolean;
      familyFilter?: string;
      existingFamilies?: LanguageFamily[];
      jobId?: string;
      progressCallback?: (type: string, message: string, data?: any) => void;
    } = {}
  ): Promise<{ families: LanguageFamily[]; languages: Language[] }> {
    const { clearExisting = false, familyFilter, existingFamilies = [], jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    // Check for concurrent scraping
    if (LanguageFamilyScraperTSV.isScraping) {
      throw new Error("Language family scraping is already in progress");
    }

    LanguageFamilyScraperTSV.isScraping = true;

    try {
      console.log("Starting language family scraping with Gemini AI...");

      // Update job status to running
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Discovering language families...");
      }

      // Discover all language families using Gemini
      const families = await this.discoverAllLanguageFamilies(progressCallback, existingFamilies);

      if (progressCallback) {
        progressCallback("progress", `Discovered ${families.length} language families`);
      }

      // For each top-level family, get detailed tree with languages
      const allFamilies: LanguageFamily[] = [];
      const allLanguages: Language[] = [];

      const topLevelFamilies = familyFilter
        ? families.filter(f => f.id === familyFilter)
        : families.filter(f => !f.parentId);

      console.log(`Processing ${topLevelFamilies.length} top-level families...`);

      // Update total count for progress tracking
      this.updateJobStatus(jobId, {
        totalWords: topLevelFamilies.length,
      });

      for (let i = 0; i < topLevelFamilies.length; i++) {
        const family = topLevelFamilies[i];

        if (progressCallback) {
          progressCallback(
            "progress",
            `Scraping family ${i + 1}/${topLevelFamilies.length}: ${family.name}...`
          );
        }

        try {
          const { families: subFamilies, languages } = await this.scrapeFamilyTree(family);
          allFamilies.push(...subFamilies);
          allLanguages.push(...languages);

          console.log(`  → Scraped ${subFamilies.length} subfamilies and ${languages.length} languages for ${family.name}`);

          // Update job progress
          this.updateJobStatus(jobId, {
            completedWords: i + 1,
          });
        } catch (error) {
          console.error(`Failed to scrape family tree for ${family.name}:`, error);
          if (progressCallback) {
            progressCallback("error", `Failed to scrape ${family.name}: ${error}`);
          }
        }
      }

      // Add the top-level families themselves
      allFamilies.push(...families);

      console.log(`Total: ${allFamilies.length} families, ${allLanguages.length} languages`);

      // Write to TSV files
      if (progressCallback) {
        progressCallback("progress", "Writing to TSV files...");
      }

      await tsvWriter.writeLanguageFamilyTSV(allFamilies, "lexicons/families.tsv");
      await tsvWriter.writeLanguageTSV(allLanguages, "lexicons/languages.tsv");

      // Update job status to completed
      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: topLevelFamilies.length,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", "Scraping completed successfully!");
      }

      console.log("Language family scraping completed successfully");

      return { families: allFamilies, languages: allLanguages };
    } catch (error) {
      console.error("Error during language family scraping:", error);

      // Update job status to failed
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
      LanguageFamilyScraperTSV.isScraping = false;
    }
  }

  private async discoverAllLanguageFamilies(
    progressCallback?: (type: string, message: string, data?: any) => void,
    existingFamilies: LanguageFamily[] = []
  ): Promise<LanguageFamily[]> {
    console.log("Discovering all language families using Gemini...");

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    // Build list of existing family names to exclude
    const existingFamilyNames = existingFamilies.map(f => f.name.toLowerCase());

    const excludeNote = existingFamilyNames.length > 0
      ? `\n\nIMPORTANT: DO NOT include the following families that we already have:\n${existingFamilyNames.slice(0, 50).join(", ")}`
      : "";

    const prompt = `You are a professional historical linguist. Generate a list of the 40 most significant language families and language isolates in the world.${excludeNote}

Guidelines:
- Include the MOST IMPORTANT language families by speaker count and historical significance:
  * Indo-European, Sino-Tibetan, Niger-Congo, Afroasiatic, Austronesian, Uralic
  * Dravidian, Altaic, Tai-Kadai, Austroasiatic, Japonic, Koreanic
  * Major American Indigenous families (Uto-Aztecan, Algonquian, Mayan, Quechuan, etc.)
  * Language isolates (Basque, Burushaski, Ainu, etc.)
- Keep descriptions brief (one sentence max)
- Set parentFamily to null for all (we'll get subfamilies later)
- Aim for exactly 40 families to keep response size manageable`;

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              families: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    name: { type: SchemaType.STRING },
                    region: { type: SchemaType.STRING },
                    description: { type: SchemaType.STRING },
                    parentFamily: { type: SchemaType.STRING, nullable: true },
                  },
                  required: ["name", "region", "description"],
                },
              },
            },
            required: ["families"],
          },
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      const parsed = JSON.parse(text);

      if (!parsed || !Array.isArray(parsed.families)) {
        throw new Error("Invalid response structure from Gemini");
      }

      console.log(`Discovered ${parsed.families.length} language families`);

      // Convert to LanguageFamily format
      const families: LanguageFamily[] = parsed.families.map((family: any) => {
        const slugifiedId = this.slugify(family.name);
        return {
          id: slugifiedId,
          name: family.name,
          parentId: null, // Top-level families
          description: family.description || null,
          taxonomicLevel: "family",
          region: family.region || null,
          totalSpeakers: null,
          languageCount: null,
          source: "scraped" as const,
        };
      });

      return families;
    } catch (error) {
      console.error("Failed to discover language families:", error);
      throw error;
    }
  }

  private async scrapeFamilyTree(
    family: LanguageFamily
  ): Promise<{ families: LanguageFamily[]; languages: Language[] }> {
    console.log(`Scraping detailed tree for ${family.name}...`);

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const prompt = `You are a professional historical linguist. Generate a comprehensive hierarchical tree for the ${family.name} language family.

The output will be written to TSV (Tab-Separated Values) files with these formats:

LANGUAGE FAMILIES TSV FORMAT:
id	name	parent_id	description	taxonomic_level	region	total_speakers	language_count

Example rows:
uralic	Uralic		Uralic language family	family	Northern Eurasia	25000000	38
uralic__finnic	Finnic	uralic	Finnic branch of Uralic	subfamily	Northern Europe	7000000	12

LANGUAGES TSV FORMAT:
id	name	native_name	iso639_1	iso639_2	family_id	region	countries	native_speakers	total_speakers	status	writing_system

Example rows:
fin	Finnish	Suomi	fi	fin	uralic__finnic	Northern Europe	Finland	5500000	6000000	living	Latin
ekk	Estonian	Eesti	et	ekk	uralic__finnic	Northern Europe	Estonia	1100000	1200000	living	Latin

Guidelines:
- Include major subfamilies (e.g., for Indo-European: Germanic, Romance, Slavic, Indo-Iranian, etc.)
- Include 20-50 major languages from this family
- Provide accurate ISO 639 codes when available (use ISO 639-2/3 for language IDs)
- Include speaker counts when known
- Set subfamily to null for languages that don't fit in a subfamily
- Use accurate native names for languages`;

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              families: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    name: { type: SchemaType.STRING },
                    taxonomicLevel: { type: SchemaType.STRING },
                    region: { type: SchemaType.STRING },
                    description: { type: SchemaType.STRING },
                  },
                  required: ["name", "region"],
                },
              },
              languages: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    name: { type: SchemaType.STRING },
                    nativeName: { type: SchemaType.STRING, nullable: true },
                    iso639_1: { type: SchemaType.STRING, nullable: true },
                    iso639_2: { type: SchemaType.STRING, nullable: true },
                    subfamily: { type: SchemaType.STRING, nullable: true },
                    region: { type: SchemaType.STRING },
                    countries: {
                      type: SchemaType.ARRAY,
                      items: { type: SchemaType.STRING },
                    },
                    nativeSpeakers: { type: SchemaType.NUMBER, nullable: true },
                    totalSpeakers: { type: SchemaType.NUMBER, nullable: true },
                    status: { type: SchemaType.STRING },
                    writingSystem: { type: SchemaType.STRING, nullable: true },
                  },
                  required: ["name", "region", "status"],
                },
              },
            },
            required: ["families", "languages"],
          },
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      const parsed = JSON.parse(text);

      // Process subfamilies
      const subfamilies: LanguageFamily[] = (parsed.families || []).map((sf: any) => ({
        id: `${family.id}__${this.slugify(sf.name)}`,
        name: sf.name,
        parentId: family.id,
        description: sf.description || null,
        taxonomicLevel: sf.taxonomicLevel || "subfamily",
        region: sf.region || null,
        totalSpeakers: null,
        languageCount: null,
        source: "scraped" as const,
      }));

      // Build subfamily map for language assignment
      const subfamilyMap = new Map<string, string>();
      for (const sf of subfamilies) {
        subfamilyMap.set(this.normalize(sf.name), sf.id);
      }

      // Process languages
      const languages: Language[] = (parsed.languages || []).map((lang: any) => {
        // Determine family ID (subfamily if specified, otherwise top-level family)
        let familyId = family.id;
        if (lang.subfamily) {
          const subfamilyId = subfamilyMap.get(this.normalize(lang.subfamily));
          if (subfamilyId) {
            familyId = subfamilyId;
          }
        }

        const langId = lang.iso639_2 || this.slugify(lang.name);

        return {
          id: langId,
          name: lang.name,
          nativeName: lang.nativeName || null,
          iso639_1: lang.iso639_1 || null,
          iso639_2: lang.iso639_2 || null,
          familyId,
          parentLanguageId: null,
          region: lang.region || null,
          countries: Array.isArray(lang.countries) ? lang.countries : [],
          nativeSpeakers: lang.nativeSpeakers || null,
          totalSpeakers: lang.totalSpeakers || null,
          status: lang.status || "living",
          endangermentStatus: null,
          timeOrigin: null,
          timeEnd: null,
          classification: null,
          writingSystem: lang.writingSystem || null,
          isHistoricalVariant: false,
          isDialect: false,
          chronologicalOrder: 0,
          historicalContext: null,
          coordinates: null,
          source: "scraped" as const,
        };
      });

      return { families: subfamilies, languages };
    } catch (error) {
      console.error(`Failed to scrape family tree for ${family.name}:`, error);
      return { families: [], languages: [] };
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export const languageFamilyScraperTSV = new LanguageFamilyScraperTSV();
