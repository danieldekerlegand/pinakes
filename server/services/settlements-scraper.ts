import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "./job-store";

export interface Settlement {
  id: string;
  name: string;
  alternateNames: string[];
  latitude: number;
  longitude: number;
  type: string;
  cultureId: string;
  civilizationId: string;
  foundedYear: number | null;
  abandonedYear: number | null;
  peakPopulation: number | null;
  notableFeatures: string[];
  associatedLanguages: string[];
  modernName: string;
  region: string;
}

const SETTLEMENT_HEADERS = [
  "id",
  "name",
  "alternate_names",
  "latitude",
  "longitude",
  "type",
  "culture_id",
  "civilization_id",
  "founded_year",
  "abandoned_year",
  "peak_population",
  "notable_features",
  "associated_languages",
  "modern_name",
  "region",
];

const VALID_TYPES = [
  "city-state",
  "capital",
  "trading-post",
  "religious-center",
  "fortress",
  "port",
  "colony",
];

const REGIONS = [
  "Mesopotamia",
  "Levant",
  "Anatolia",
  "Persia",
  "Egypt",
  "North Africa",
  "East Africa",
  "West Africa",
  "Southern Africa",
  "Central Africa",
  "Mediterranean",
  "Western Europe",
  "Northern Europe",
  "Eastern Europe",
  "Central Europe",
  "British Isles",
  "Iberian Peninsula",
  "South Asia",
  "Southeast Asia",
  "East Asia",
  "Central Asia",
  "Inner Asia",
  "Oceania",
  "Mesoamerica",
  "South America",
  "North America",
  "Caribbean",
  "Arabian Peninsula",
];

export class SettlementsScraper {
  private static isScraping = false;
  private tsvPath: string;

  constructor(tsvPath: string = "data/source/lexicons/settlements.tsv") {
    this.tsvPath = tsvPath;
  }

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

  async scrapeSettlements(options: {
    region?: string;
    count?: number;
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: unknown) => void;
  } = {}): Promise<{ settlements: Settlement[]; added: number }> {
    const { region, count = 50, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (SettlementsScraper.isScraping) {
      throw new Error("Settlement scraping is already in progress");
    }

    SettlementsScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Loading existing settlements...");
      }

      const existingIds = this.getExistingIds();
      console.log(`Found ${existingIds.size} existing settlements`);

      const regionsToScrape = region ? [region] : REGIONS;
      const perRegion = Math.ceil(count / regionsToScrape.length);

      this.updateJobStatus(jobId, { totalWords: regionsToScrape.length });

      const allSettlements: Settlement[] = [];

      for (let i = 0; i < regionsToScrape.length; i++) {
        const r = regionsToScrape[i];

        if (progressCallback) {
          progressCallback(
            "progress",
            `Scraping region ${i + 1}/${regionsToScrape.length}: ${r}...`
          );
        }

        try {
          const settlements = await this.scrapeRegion(r, perRegion, existingIds);
          allSettlements.push(...settlements);

          for (const s of settlements) {
            existingIds.add(s.id);
          }

          console.log(`  → Scraped ${settlements.length} settlements for ${r}`);
          this.updateJobStatus(jobId, { completedWords: i + 1 });
        } catch (error) {
          console.error(`Failed to scrape settlements for ${r}:`, error);
          if (progressCallback) {
            progressCallback("error", `Failed to scrape ${r}: ${error}`);
          }
        }
      }

      if (allSettlements.length > 0) {
        if (progressCallback) {
          progressCallback("progress", `Appending ${allSettlements.length} settlements to TSV...`);
        }
        this.appendSettlements(allSettlements);
      }

      this.updateJobStatus(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", `Scraping completed: ${allSettlements.length} new settlements`);
      }

      return { settlements: allSettlements, added: allSettlements.length };
    } catch (error) {
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
      SettlementsScraper.isScraping = false;
    }
  }

  private async scrapeRegion(
    region: string,
    count: number,
    existingIds: Set<string>
  ): Promise<Settlement[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const existingList = [...existingIds].slice(0, 100).join(", ");

    const prompt = `You are a professional historian and archaeologist. Generate ${count} historically significant settlements from the ${region} region.

Each settlement must have:
- A unique kebab-case id (e.g., "ur", "rome", "tenochtitlan")
- The historical name
- Alternate names (other historical or modern names)
- Accurate latitude and longitude coordinates
- Type: one of city-state, capital, trading-post, religious-center, fortress, port, colony
- Founded year (negative for BCE, e.g., -753 for 753 BCE)
- Abandoned year (null if still inhabited)
- Peak historical population estimate
- Notable features (buildings, monuments, artifacts)
- Associated languages (ISO 639 codes when available)
- Modern name (if different from historical name)

IMPORTANT: Do NOT include settlements with these IDs (already exist): ${existingList}

Focus on historically significant settlements with archaeological evidence. Include a mix of types (capitals, ports, trading posts, religious centers, fortresses, city-states, colonies).`;

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            settlements: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  alternateNames: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  latitude: { type: SchemaType.NUMBER },
                  longitude: { type: SchemaType.NUMBER },
                  type: { type: SchemaType.STRING },
                  cultureId: { type: SchemaType.STRING, nullable: true },
                  civilizationId: { type: SchemaType.STRING, nullable: true },
                  foundedYear: { type: SchemaType.NUMBER, nullable: true },
                  abandonedYear: { type: SchemaType.NUMBER, nullable: true },
                  peakPopulation: { type: SchemaType.NUMBER, nullable: true },
                  notableFeatures: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  associatedLanguages: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  modernName: { type: SchemaType.STRING, nullable: true },
                },
                required: ["id", "name", "latitude", "longitude", "type"],
              },
            },
          },
          required: ["settlements"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.settlements)) {
      throw new Error("Invalid response structure from Gemini");
    }

    return parsed.settlements
      .filter((s: any) => !existingIds.has(this.slugify(s.id)))
      .map((s: any) => ({
        id: this.slugify(s.id),
        name: s.name,
        alternateNames: Array.isArray(s.alternateNames) ? s.alternateNames : [],
        latitude: s.latitude,
        longitude: s.longitude,
        type: VALID_TYPES.includes(s.type) ? s.type : "capital",
        cultureId: s.cultureId || "",
        civilizationId: s.civilizationId || "",
        foundedYear: s.foundedYear ?? null,
        abandonedYear: s.abandonedYear ?? null,
        peakPopulation: s.peakPopulation ?? null,
        notableFeatures: Array.isArray(s.notableFeatures) ? s.notableFeatures : [],
        associatedLanguages: Array.isArray(s.associatedLanguages) ? s.associatedLanguages : [],
        modernName: s.modernName || "",
        region,
      }));
  }

  getExistingIds(): Set<string> {
    const ids = new Set<string>();
    if (!fs.existsSync(this.tsvPath)) return ids;

    const content = fs.readFileSync(this.tsvPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols[0]) ids.add(cols[0]);
    }
    return ids;
  }

  appendSettlements(settlements: Settlement[]): void {
    const fileExists = fs.existsSync(this.tsvPath);

    const rows = settlements.map((s) =>
      [
        s.id,
        s.name,
        JSON.stringify(s.alternateNames),
        s.latitude.toString(),
        s.longitude.toString(),
        s.type,
        s.cultureId,
        s.civilizationId,
        s.foundedYear?.toString() ?? "",
        s.abandonedYear?.toString() ?? "",
        s.peakPopulation?.toString() ?? "",
        JSON.stringify(s.notableFeatures),
        JSON.stringify(s.associatedLanguages),
        s.modernName,
        s.region,
      ].join("\t")
    );

    if (!fileExists) {
      const header = SETTLEMENT_HEADERS.join("\t");
      const content = [header, ...rows].join("\n") + "\n";
      const dir = path.dirname(this.tsvPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.tsvPath, content, "utf-8");
    } else {
      const content = rows.join("\n") + "\n";
      fs.appendFileSync(this.tsvPath, content, "utf-8");
    }

    console.log(`Appended ${settlements.length} settlements to ${this.tsvPath}`);
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

export const settlementsScraper = new SettlementsScraper();
