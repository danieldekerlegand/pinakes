import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";

export interface ScrapedMusicTradition {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  instruments: string[];
  scales: string[];
  rhythmicPatterns: string[];
  relatedTraditions: string[];
  description: string;
  sources: string[];
}

export interface ScrapedMusicalInstrument {
  id: string;
  name: string;
  nativeName: string;
  instrumentFamily: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  constructionMaterials: string[];
  playingTechnique: string;
  associatedTraditionIds: string[];
  associatedLanguageIds: string[];
  description: string;
  sources: string[];
}

export class MusicScraper {
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

  async scrapeMusicTraditionsAndInstruments(options: {
    existingTraditionIds?: string[];
    existingInstrumentIds?: string[];
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  } = {}): Promise<{
    traditions: ScrapedMusicTradition[];
    instruments: ScrapedMusicalInstrument[];
  }> {
    const { existingTraditionIds = [], existingInstrumentIds = [], jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (MusicScraper.isScraping) {
      throw new Error("Music scraping is already in progress");
    }

    MusicScraper.isScraping = true;

    try {
      console.log("Starting music traditions and instruments scraping...");

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Discovering music traditions...");
      }

      // Step 1: Scrape music traditions
      const traditions = await this.scrapeTraditions(existingTraditionIds, progressCallback);

      this.updateJobStatus(jobId, {
        completedWords: 1,
        totalWords: 3,
      });

      if (progressCallback) {
        progressCallback("progress", `Discovered ${traditions.length} traditions. Scraping instruments...`);
      }

      // Step 2: Scrape instruments
      const instruments = await this.scrapeInstruments(existingInstrumentIds, traditions, progressCallback);

      this.updateJobStatus(jobId, {
        completedWords: 2,
        totalWords: 3,
      });

      if (progressCallback) {
        progressCallback("progress", `Scraped ${instruments.length} instruments. Writing TSV files...`);
      }

      // Step 3: Write to TSV files
      await tsvWriter.writeMusicTraditionsTSV(traditions, "lexicons/music-traditions.tsv");
      await tsvWriter.writeMusicalInstrumentsTSV(instruments, "lexicons/musical-instruments.tsv");

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: 3,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", `Scraping completed: ${traditions.length} traditions, ${instruments.length} instruments`);
      }

      console.log(`Music scraping completed: ${traditions.length} traditions, ${instruments.length} instruments`);

      return { traditions, instruments };
    } catch (error) {
      console.error("Error during music scraping:", error);

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
      MusicScraper.isScraping = false;
    }
  }

  private async scrapeTraditions(
    existingIds: string[],
    progressCallback?: (type: string, message: string, data?: any) => void
  ): Promise<ScrapedMusicTradition[]> {
    console.log("Scraping music traditions with Gemini...");

    const excludeNote = existingIds.length > 0
      ? `\n\nIMPORTANT: We already have the following tradition IDs. You may include updated versions of these, but prioritize adding NEW traditions we don't have yet:\n${existingIds.join(", ")}`
      : "";

    const prompt = `You are an ethnomusicologist. Generate a comprehensive list of 40-60 music traditions from around the world.${excludeNote}

Guidelines:
- Cover ALL major world regions: South Asia, East Asia, Southeast Asia, Central Asia, Middle East, North Africa, West Africa, East Africa, Southern Africa, Western Europe, Eastern Europe, Caucasus, North America, Central America, South America, Oceania, Arctic
- Include ancient, medieval, and modern traditions
- Include both court/classical and folk/indigenous traditions
- Use lowercase-hyphenated IDs (e.g., "indian-classical", "west-african-griot")
- Provide accurate coordinates for the tradition's origin
- Use negative numbers for BCE dates in time_origin
- Set time_end to null for living traditions, or a year for historical ones
- associated_language_ids should use lowercase IDs matching common language identifiers
- instruments should be lowercase-hyphenated instrument IDs
- scales and rhythmic_patterns should be descriptive identifiers
- related_traditions should reference other tradition IDs from this list
- Keep descriptions to one sentence
- sources should reference the type of evidence (e.g., "Ethnomusicological research", "Archaeological evidence")`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            traditions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  nativeName: { type: SchemaType.STRING },
                  region: { type: SchemaType.STRING },
                  lat: { type: SchemaType.NUMBER },
                  lng: { type: SchemaType.NUMBER },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  timeEnd: { type: SchemaType.NUMBER, nullable: true },
                  associatedLanguageIds: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  instruments: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  scales: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  rhythmicPatterns: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  relatedTraditions: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  description: { type: SchemaType.STRING },
                  sources: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: ["id", "name", "nativeName", "region", "lat", "lng", "description"],
              },
            },
          },
          required: ["traditions"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.traditions)) {
      throw new Error("Invalid response structure from Gemini for music traditions");
    }

    console.log(`Discovered ${parsed.traditions.length} music traditions`);

    if (progressCallback) {
      progressCallback("progress", `Parsed ${parsed.traditions.length} music traditions from Gemini`);
    }

    return parsed.traditions.map((t: any) => ({
      id: t.id,
      name: t.name,
      nativeName: t.nativeName || "",
      region: t.region,
      coordinates: { lat: t.lat, lng: t.lng },
      timeOrigin: t.timeOrigin ?? null,
      timeEnd: t.timeEnd ?? null,
      associatedLanguageIds: t.associatedLanguageIds || [],
      instruments: t.instruments || [],
      scales: t.scales || [],
      rhythmicPatterns: t.rhythmicPatterns || [],
      relatedTraditions: t.relatedTraditions || [],
      description: t.description,
      sources: t.sources || ["Ethnomusicological research"],
    }));
  }

  private async scrapeInstruments(
    existingIds: string[],
    traditions: ScrapedMusicTradition[],
    progressCallback?: (type: string, message: string, data?: any) => void
  ): Promise<ScrapedMusicalInstrument[]> {
    console.log("Scraping musical instruments with Gemini...");

    // Collect all instrument IDs referenced by traditions
    const referencedInstruments = new Set<string>();
    for (const t of traditions) {
      for (const i of t.instruments) {
        referencedInstruments.add(i);
      }
    }

    const excludeNote = existingIds.length > 0
      ? `\n\nWe already have these instrument IDs. Include updated versions if needed, but prioritize NEW instruments:\n${existingIds.join(", ")}`
      : "";

    const traditionsContext = traditions.slice(0, 30).map(t =>
      `${t.id}: ${t.name} (${t.region}) - instruments: ${t.instruments.join(", ")}`
    ).join("\n");

    const prompt = `You are an ethnomusicologist. Generate a comprehensive list of 60-100 musical instruments from around the world.${excludeNote}

These instruments should cover the traditions listed below, plus additional notable instruments:
${traditionsContext}

Guidelines:
- Cover ALL major instrument families: string (plucked, bowed, struck), wind (blown, free-reed), percussion (membranophones, idiophones), electronic
- Cover ALL world regions
- Use lowercase-hyphenated IDs (e.g., "sitar", "djembe", "uilleann-pipes")
- instrument_family should be one of: string, wind, percussion, keyboard, electronic, voice
- playing_technique should be a short descriptor (e.g., "plucked", "bowed", "hand-struck", "blown")
- construction_materials should list primary materials
- associated_tradition_ids should reference tradition IDs
- associated_language_ids should use lowercase language identifiers
- Provide accurate coordinates for each instrument's origin
- Use negative numbers for BCE dates
- Keep descriptions to one sentence`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            instruments: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  nativeName: { type: SchemaType.STRING },
                  instrumentFamily: { type: SchemaType.STRING },
                  originRegion: { type: SchemaType.STRING },
                  lat: { type: SchemaType.NUMBER },
                  lng: { type: SchemaType.NUMBER },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  constructionMaterials: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  playingTechnique: { type: SchemaType.STRING },
                  associatedTraditionIds: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  associatedLanguageIds: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  description: { type: SchemaType.STRING },
                  sources: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: ["id", "name", "nativeName", "instrumentFamily", "originRegion", "lat", "lng", "description"],
              },
            },
          },
          required: ["instruments"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.instruments)) {
      throw new Error("Invalid response structure from Gemini for musical instruments");
    }

    console.log(`Discovered ${parsed.instruments.length} musical instruments`);

    if (progressCallback) {
      progressCallback("progress", `Parsed ${parsed.instruments.length} instruments from Gemini`);
    }

    return parsed.instruments.map((i: any) => ({
      id: i.id,
      name: i.name,
      nativeName: i.nativeName || "",
      instrumentFamily: i.instrumentFamily || "",
      originRegion: i.originRegion || "",
      coordinates: { lat: i.lat, lng: i.lng },
      timeOrigin: i.timeOrigin ?? null,
      constructionMaterials: i.constructionMaterials || [],
      playingTechnique: i.playingTechnique || "",
      associatedTraditionIds: i.associatedTraditionIds || [],
      associatedLanguageIds: i.associatedLanguageIds || [],
      description: i.description,
      sources: i.sources || ["Ethnomusicological research"],
    }));
  }
}

export const musicScraper = new MusicScraper();
