import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "./job-store";

export interface CuisineScrapeResult {
  cuisines: number;
  cuisineItems: number;
  ingredientOrigins: number;
  cookingTechniques: number;
}

interface ScrapedCuisine {
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  associatedLanguages: string[];
  timeOrigin: number | null;
  description: string;
}

interface ScrapedCuisineDetail {
  items: Array<{
    name: string;
    foodType: string;
    timeOrigin: number | null;
  }>;
  ingredients: Array<{
    name: string;
    nativeName: string | null;
    originRegion: string;
    coordinates: { lat: number; lng: number };
    timeOrigin: number | null;
    description: string;
  }>;
  techniques: Array<{
    name: string;
    category: string;
    coordinates: { lat: number; lng: number };
    timeOrigin: number | null;
    description: string;
  }>;
}

export class CuisineScraper {
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

  async scrapeCuisines(options: {
    jobId?: string;
    cuisineFilter?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  } = {}): Promise<CuisineScrapeResult> {
    const { jobId, cuisineFilter, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (CuisineScraper.isScraping) {
      throw new Error("Cuisine scraping is already in progress");
    }

    CuisineScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Discovering world cuisines...");
      }

      // Phase 1: Discover cuisines
      const existingCuisineIds = this.loadExistingCuisineIds();
      const cuisines = await this.discoverCuisines();

      const targetCuisines = cuisineFilter
        ? cuisines.filter(c => this.slugify(c.name) === cuisineFilter)
        : cuisines.filter(c => !existingCuisineIds.has(this.slugify(c.name)));

      if (progressCallback) {
        progressCallback("progress", `Found ${targetCuisines.length} new cuisines to scrape`);
      }

      this.updateJobStatus(jobId, { totalWords: targetCuisines.length });

      // Phase 2: For each cuisine, get detailed items, ingredients, techniques
      const allCuisineRows: string[][] = [];
      const allItemRows: string[][] = [];
      const allIngredientRows: string[][] = [];
      const allTechniqueRows: string[][] = [];

      for (let i = 0; i < targetCuisines.length; i++) {
        const cuisine = targetCuisines[i];
        const cuisineId = this.slugify(cuisine.name);

        if (progressCallback) {
          progressCallback(
            "progress",
            `Scraping ${i + 1}/${targetCuisines.length}: ${cuisine.name}...`
          );
        }

        try {
          const detail = await this.scrapeCuisineDetail(cuisine);

          allCuisineRows.push([
            cuisineId,
            cuisine.name,
            cuisine.nativeName,
            cuisine.region,
            JSON.stringify(cuisine.coordinates),
            JSON.stringify(cuisine.associatedLanguages),
            cuisine.timeOrigin?.toString() ?? "null",
            "null",
            cuisine.description,
          ]);

          for (const item of detail.items) {
            allItemRows.push([
              `${cuisineId}-${this.slugify(item.name)}`,
              cuisineId,
              item.name,
              item.foodType,
              item.timeOrigin?.toString() ?? "null",
              "null",
            ]);
          }

          for (const ing of detail.ingredients) {
            allIngredientRows.push([
              `${this.slugify(ing.name)}-${cuisineId}`,
              ing.name,
              cuisineId,
              ing.originRegion,
              JSON.stringify(ing.coordinates),
              ing.timeOrigin?.toString() ?? "null",
              "null",
              ing.nativeName ?? "",
              ing.description,
            ]);
          }

          for (const tech of detail.techniques) {
            allTechniqueRows.push([
              `${this.slugify(tech.name)}-${cuisineId}`,
              tech.name,
              cuisineId,
              tech.category,
              JSON.stringify(tech.coordinates),
              tech.timeOrigin?.toString() ?? "null",
              "null",
              tech.description,
            ]);
          }

          console.log(
            `  → ${cuisine.name}: ${detail.items.length} items, ${detail.ingredients.length} ingredients, ${detail.techniques.length} techniques`
          );

          this.updateJobStatus(jobId, { completedWords: i + 1 });
        } catch (error) {
          console.error(`Failed to scrape detail for ${cuisine.name}:`, error);
          if (progressCallback) {
            progressCallback("error", `Failed to scrape ${cuisine.name}: ${error}`);
          }
        }
      }

      // Phase 3: Append to TSV files
      if (progressCallback) {
        progressCallback("progress", "Writing to TSV files...");
      }

      await this.appendToTsv("data/source/lexicons/cuisines.tsv", CUISINE_HEADERS, allCuisineRows);
      await this.appendToTsv("data/source/lexicons/cuisine-items.tsv", CUISINE_ITEM_HEADERS, allItemRows);
      await this.appendToTsv("data/source/lexicons/ingredient-origins.tsv", INGREDIENT_HEADERS, allIngredientRows);
      await this.appendToTsv("data/source/lexicons/cooking-techniques.tsv", TECHNIQUE_HEADERS, allTechniqueRows);

      const result: CuisineScrapeResult = {
        cuisines: allCuisineRows.length,
        cuisineItems: allItemRows.length,
        ingredientOrigins: allIngredientRows.length,
        cookingTechniques: allTechniqueRows.length,
      };

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: targetCuisines.length,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", "Cuisine scraping completed!", result);
      }

      console.log(
        `Cuisine scraping complete: ${result.cuisines} cuisines, ${result.cuisineItems} items, ${result.ingredientOrigins} ingredients, ${result.cookingTechniques} techniques`
      );

      return result;
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
      CuisineScraper.isScraping = false;
    }
  }

  async discoverCuisines(): Promise<ScrapedCuisine[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            cuisines: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  nativeName: { type: SchemaType.STRING },
                  region: { type: SchemaType.STRING },
                  lat: { type: SchemaType.NUMBER },
                  lng: { type: SchemaType.NUMBER },
                  associatedLanguages: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  description: { type: SchemaType.STRING },
                },
                required: ["name", "nativeName", "region", "lat", "lng", "associatedLanguages", "description"],
              },
            },
          },
          required: ["cuisines"],
        },
      },
    });

    const prompt = `You are a culinary historian and food anthropologist. Generate a comprehensive list of 40 major world cuisines.

Guidelines:
- Include cuisines from every inhabited continent
- Cover well-known cuisines (French, Chinese, Indian, Japanese, Italian, Mexican, Thai) AND lesser-known ones (Georgian, Peruvian, Ethiopian, Lebanese, Moroccan, Vietnamese, Korean, Indonesian, Nigerian, etc.)
- Provide the native name in the cuisine's own script/language
- Provide accurate geographic coordinates for the cuisine's cultural center
- Include associated language IDs (lowercase, matching ISO 639 codes where possible)
- timeOrigin should be an approximate year (negative for BCE) when the cuisine tradition is considered to have begun
- Keep descriptions to one sentence focusing on what makes the cuisine distinctive`;

    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    if (!parsed || !Array.isArray(parsed.cuisines)) {
      throw new Error("Invalid response structure from Gemini");
    }

    return parsed.cuisines.map((c: any) => ({
      name: c.name,
      nativeName: c.nativeName,
      region: c.region,
      coordinates: { lat: c.lat, lng: c.lng },
      associatedLanguages: c.associatedLanguages,
      timeOrigin: c.timeOrigin ?? null,
      description: c.description,
    }));
  }

  async scrapeCuisineDetail(cuisine: ScrapedCuisine): Promise<ScrapedCuisineDetail> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            items: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  foodType: { type: SchemaType.STRING },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                },
                required: ["name", "foodType"],
              },
            },
            ingredients: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  nativeName: { type: SchemaType.STRING, nullable: true },
                  originRegion: { type: SchemaType.STRING },
                  lat: { type: SchemaType.NUMBER },
                  lng: { type: SchemaType.NUMBER },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  description: { type: SchemaType.STRING },
                },
                required: ["name", "originRegion", "lat", "lng", "description"],
              },
            },
            techniques: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  category: { type: SchemaType.STRING },
                  lat: { type: SchemaType.NUMBER },
                  lng: { type: SchemaType.NUMBER },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  description: { type: SchemaType.STRING },
                },
                required: ["name", "category", "lat", "lng", "description"],
              },
            },
          },
          required: ["items", "ingredients", "techniques"],
        },
      },
    });

    const prompt = `You are a culinary historian specializing in ${cuisine.name} cuisine (${cuisine.region}).

Generate detailed food culture data for ${cuisine.name} cuisine:

1. DISHES (15-25 items): Include the most iconic and representative dishes.
   - foodType should be one of: Main Dish, Appetizer, Soup, Stew, Salad, Dessert, Bread, Rice Dish, Noodle Dish, Street Food, Beverage, Condiment, Side Dish, Stir-Fry, Dumpling, Grilled, Fermented
   - timeOrigin: approximate year the dish originated (negative for BCE), or null if unknown

2. KEY INGREDIENTS (8-15 items): Core ingredients that define this cuisine.
   - Include the native name in the cuisine's language
   - originRegion: where the ingredient was first domesticated/used
   - coordinates: lat/lng of the ingredient's origin area
   - timeOrigin: approximate year of first use (negative for BCE)

3. COOKING TECHNIQUES (5-10 items): Distinctive cooking methods.
   - category should be one of: heat, fermentation, preservation, preparation, smoking, drying, grinding
   - coordinates: lat/lng of where this technique originated
   - timeOrigin: approximate year the technique developed (negative for BCE)`;

    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    return {
      items: (parsed.items || []).map((item: any) => ({
        name: item.name,
        foodType: item.foodType,
        timeOrigin: item.timeOrigin ?? null,
      })),
      ingredients: (parsed.ingredients || []).map((ing: any) => ({
        name: ing.name,
        nativeName: ing.nativeName ?? null,
        originRegion: ing.originRegion,
        coordinates: { lat: ing.lat, lng: ing.lng },
        timeOrigin: ing.timeOrigin ?? null,
        description: ing.description,
      })),
      techniques: (parsed.techniques || []).map((tech: any) => ({
        name: tech.name,
        category: tech.category,
        coordinates: { lat: tech.lat, lng: tech.lng },
        timeOrigin: tech.timeOrigin ?? null,
        description: tech.description,
      })),
    };
  }

  private loadExistingCuisineIds(): Set<string> {
    const filePath = "data/source/lexicons/cuisines.tsv";
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.trim().split("\n");
      if (lines.length <= 1) return new Set();
      return new Set(lines.slice(1).map(line => line.split("\t")[0]));
    } catch {
      return new Set();
    }
  }

  private async appendToTsv(
    filePath: string,
    headers: string[],
    rows: string[][]
  ): Promise<void> {
    if (rows.length === 0) return;

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${filePath}.tmp`;

    try {
      let existingContent = "";
      try {
        existingContent = await fs.promises.readFile(filePath, "utf8");
      } catch {
        // File doesn't exist yet
      }

      let content: string;
      if (existingContent.trim()) {
        // Append to existing file
        const newLines = rows.map(row => row.join("\t")).join("\n");
        content = existingContent.trimEnd() + "\n" + newLines + "\n";
      } else {
        // New file with headers
        const headerLine = headers.join("\t");
        const dataLines = rows.map(row => row.join("\t"));
        content = [headerLine, ...dataLines].join("\n") + "\n";
      }

      await fs.promises.writeFile(tempFile, content, "utf8");
      await fs.promises.rename(tempFile, filePath);

      console.log(`Appended ${rows.length} rows to ${filePath}`);
    } catch (error) {
      try {
        await fs.promises.unlink(tempFile);
      } catch {}
      throw error;
    }
  }

  slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

const CUISINE_HEADERS = [
  "id", "name", "native_name", "region", "coordinates",
  "associated_language_ids", "time_origin", "time_end", "description",
];

const CUISINE_ITEM_HEADERS = [
  "id", "cuisine_id", "name", "food_type", "time_origin", "time_end",
];

const INGREDIENT_HEADERS = [
  "id", "name", "cuisine_id", "origin_region", "coordinates",
  "time_origin", "time_end", "native_name", "description",
];

const TECHNIQUE_HEADERS = [
  "id", "name", "cuisine_id", "category", "coordinates",
  "time_origin", "time_end", "description",
];

export const cuisineScraper = new CuisineScraper();
