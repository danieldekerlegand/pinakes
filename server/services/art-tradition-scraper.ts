import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ArtTradition } from "../tsv-storage";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import fs from "node:fs";

export interface StyleEvolution {
  id: string;
  fromTraditionId: string;
  toTraditionId: string;
  transitionType: string; // "direct_evolution" | "influence" | "reaction" | "revival" | "synthesis"
  transitionDate: number;
  description: string;
  keyChanges: string[];
  catalysts: string[];
}

export interface ArtTraditionScrapingOptions {
  categories?: string[];
  regions?: string[];
  clearExisting?: boolean;
  jobId?: string;
  progressCallback?: (type: string, message: string, data?: any) => void;
}

export interface ArtTraditionScrapingResult {
  traditions: ArtTradition[];
  evolutions: StyleEvolution[];
  totalTraditions: number;
  totalEvolutions: number;
}

export class ArtTraditionScraper {
  private static isScraping = false;

  private updateJobStatus(
    jobId: string | undefined,
    updates: Record<string, unknown>
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  async scrapeArtTraditions(
    options: ArtTraditionScrapingOptions = {}
  ): Promise<ArtTraditionScrapingResult> {
    const { categories, regions, clearExisting = false, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (ArtTraditionScraper.isScraping) {
      throw new Error("Art tradition scraping is already in progress");
    }

    ArtTraditionScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, { status: "running", startedAt: new Date().toISOString() });
      progressCallback?.("progress", "Discovering art traditions...");

      // Load existing traditions to avoid duplicates
      const existingIds = clearExisting ? new Set<string>() : this.loadExistingTraditionIds();

      // Step 1: Discover art traditions
      const traditions = await this.discoverArtTraditions(categories, regions, existingIds, progressCallback);
      progressCallback?.("progress", `Discovered ${traditions.length} art traditions`);

      this.updateJobStatus(jobId, { totalWords: traditions.length + 1 });

      // Step 2: Discover style evolutions between traditions
      progressCallback?.("progress", "Discovering style evolution connections...");
      const allTraditionNames = traditions.map(t => ({ id: t.id, name: t.name, stylePeriod: t.stylePeriod, originDate: t.originDate }));
      const evolutions = await this.discoverStyleEvolutions(allTraditionNames, progressCallback);

      this.updateJobStatus(jobId, { completedWords: traditions.length });
      progressCallback?.("progress", `Found ${evolutions.length} style evolution connections`);

      // Step 3: Write to TSV files
      progressCallback?.("progress", "Writing to TSV files...");
      await this.writeArtTraditionsTSV(traditions, clearExisting);
      await this.writeStyleEvolutionsTSV(evolutions, clearExisting);

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: traditions.length + 1,
        completedAt: new Date().toISOString(),
      });
      progressCallback?.("completed", "Art tradition scraping completed!");

      return {
        traditions,
        evolutions,
        totalTraditions: traditions.length,
        totalEvolutions: evolutions.length,
      };
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });
      progressCallback?.("error", `Scraping failed: ${error}`);
      throw error;
    } finally {
      ArtTraditionScraper.isScraping = false;
    }
  }

  private loadExistingTraditionIds(): Set<string> {
    const ids = new Set<string>();
    const filePath = "lexicons/art-traditions.tsv";
    if (!fs.existsSync(filePath)) return ids;

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter(l => l.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols[0]) ids.add(cols[0]);
      }
    } catch {
      // ignore read errors
    }
    return ids;
  }

  async discoverArtTraditions(
    categories: string[] | undefined,
    regions: string[] | undefined,
    existingIds: Set<string>,
    progressCallback?: (type: string, message: string, data?: any) => void
  ): Promise<ArtTradition[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const categoryFilter = categories?.length
      ? `Focus on these categories: ${categories.join(", ")}.`
      : "Include all categories: painting, sculpture, architecture, ceramics, textile, metalwork, calligraphy, printmaking, mosaic, mixed-media.";

    const regionFilter = regions?.length
      ? `Focus on these regions: ${regions.join(", ")}.`
      : "Cover all world regions: Europe, East Asia, South Asia, Southeast Asia, Middle East, Africa, Americas, Oceania.";

    const existingNote = existingIds.size > 0
      ? `\nDo NOT include traditions with these IDs (already scraped): ${Array.from(existingIds).slice(0, 30).join(", ")}`
      : "";

    const prompt = `You are an expert art historian. Generate a comprehensive list of 50 significant art traditions from world history, with style evolution tracking data.

${categoryFilter}
${regionFilter}
${existingNote}

For each tradition, provide:
- name: The tradition's common name (e.g., "Italian Renaissance Painting")
- category: One of: painting, sculpture, architecture, ceramics, textile, metalwork, calligraphy, printmaking, mosaic, mixed-media
- stylePeriod: The art-historical period name (e.g., "Renaissance", "Baroque", "Neolithic")
- originDate: Year the tradition began (negative for BCE, e.g. -3000)
- endDate: Year it ended (0 if still active)
- originLat/originLng: Coordinates of the tradition's geographic origin
- description: A 2-3 sentence description of the tradition
- associatedCivilizations: The primary civilization(s) associated with this tradition
- associatedLanguages: Array of ISO 639 language codes associated with the tradition's culture
- keyFeatures: Array of 3-5 distinctive stylistic features
- notableExamples: Array of 3-5 famous works or sites

Include traditions spanning from prehistoric cave painting to modern movements. Ensure global coverage including non-Western traditions.`;

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
                  name: { type: SchemaType.STRING },
                  category: { type: SchemaType.STRING },
                  stylePeriod: { type: SchemaType.STRING },
                  originDate: { type: SchemaType.NUMBER },
                  endDate: { type: SchemaType.NUMBER },
                  originLat: { type: SchemaType.NUMBER },
                  originLng: { type: SchemaType.NUMBER },
                  description: { type: SchemaType.STRING },
                  associatedCivilizations: { type: SchemaType.STRING },
                  associatedLanguages: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  keyFeatures: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  notableExamples: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: [
                  "name", "category", "stylePeriod", "originDate", "endDate",
                  "originLat", "originLng", "description", "associatedCivilizations",
                  "associatedLanguages", "keyFeatures", "notableExamples",
                ],
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

    if (!parsed?.traditions || !Array.isArray(parsed.traditions)) {
      throw new Error("Invalid response structure from Gemini");
    }

    progressCallback?.("progress", `Gemini returned ${parsed.traditions.length} traditions`);

    return parsed.traditions
      .filter((t: any) => !existingIds.has(this.slugify(t.name)))
      .map((t: any) => ({
        id: this.slugify(t.name),
        name: t.name,
        category: t.category,
        stylePeriod: t.stylePeriod,
        originDate: t.originDate,
        endDate: t.endDate,
        originCoordinates: { lat: t.originLat, lng: t.originLng },
        description: t.description,
        associatedCivilizations: t.associatedCivilizations,
        associatedLanguages: t.associatedLanguages || [],
        keyFeatures: t.keyFeatures || [],
        notableExamples: t.notableExamples || [],
      }));
  }

  async discoverStyleEvolutions(
    traditions: Array<{ id: string; name: string; stylePeriod: string; originDate: number }>,
    progressCallback?: (type: string, message: string, data?: any) => void
  ): Promise<StyleEvolution[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const traditionList = traditions
      .sort((a, b) => a.originDate - b.originDate)
      .map(t => `${t.id}: ${t.name} (${t.stylePeriod}, ${t.originDate})`)
      .join("\n");

    const prompt = `You are an expert art historian specializing in stylistic evolution. Given the following art traditions, identify the evolutionary connections between them.

ART TRADITIONS (id: name (period, origin_date)):
${traditionList}

For each connection, provide:
- fromTraditionId: The ID of the earlier/source tradition (must match an ID above exactly)
- toTraditionId: The ID of the later/derived tradition (must match an ID above exactly)
- transitionType: One of: "direct_evolution" (natural stylistic progression), "influence" (cross-cultural influence), "reaction" (deliberate rejection/contrast), "revival" (later revival of earlier style), "synthesis" (merging of multiple traditions)
- transitionDate: Approximate year the transition/influence began
- description: Brief description of how the evolution/influence occurred
- keyChanges: Array of 2-4 specific stylistic changes that occurred
- catalysts: Array of 1-3 historical events or factors that drove the change

Identify all significant connections. A tradition can have multiple predecessors and successors.`;

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            evolutions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  fromTraditionId: { type: SchemaType.STRING },
                  toTraditionId: { type: SchemaType.STRING },
                  transitionType: { type: SchemaType.STRING },
                  transitionDate: { type: SchemaType.NUMBER },
                  description: { type: SchemaType.STRING },
                  keyChanges: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  catalysts: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: [
                  "fromTraditionId", "toTraditionId", "transitionType",
                  "transitionDate", "description", "keyChanges", "catalysts",
                ],
              },
            },
          },
          required: ["evolutions"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed?.evolutions || !Array.isArray(parsed.evolutions)) {
      throw new Error("Invalid style evolution response from Gemini");
    }

    // Validate that referenced tradition IDs exist
    const validIds = new Set(traditions.map(t => t.id));

    return parsed.evolutions
      .filter((e: any) => validIds.has(e.fromTraditionId) && validIds.has(e.toTraditionId))
      .map((e: any) => ({
        id: `${e.fromTraditionId}__${e.toTraditionId}`,
        fromTraditionId: e.fromTraditionId,
        toTraditionId: e.toTraditionId,
        transitionType: e.transitionType,
        transitionDate: e.transitionDate,
        description: e.description,
        keyChanges: e.keyChanges || [],
        catalysts: e.catalysts || [],
      }));
  }

  private async writeArtTraditionsTSV(traditions: ArtTradition[], clearExisting: boolean): Promise<void> {
    const filePath = "lexicons/art-traditions.tsv";
    const headers = [
      "id", "name", "category", "style_period", "origin_date", "end_date",
      "origin_coordinates", "description", "associated_civilizations",
      "associated_languages", "key_features", "notable_examples",
    ];

    // Load existing rows if not clearing
    let existingRows: string[][] = [];
    if (!clearExisting && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter(l => l.trim());
      // Skip header, keep data rows
      for (let i = 1; i < lines.length; i++) {
        existingRows.push(lines[i].split("\t"));
      }
    }

    const newRows = traditions.map(t => [
      t.id,
      t.name,
      t.category,
      t.stylePeriod,
      t.originDate.toString(),
      t.endDate.toString(),
      JSON.stringify(t.originCoordinates),
      t.description,
      t.associatedCivilizations,
      JSON.stringify(t.associatedLanguages),
      JSON.stringify(t.keyFeatures),
      JSON.stringify(t.notableExamples),
    ]);

    const allRows = [...existingRows, ...newRows];
    await tsvWriter.writeGenericTSV(filePath, headers, allRows);
    console.log(`Wrote ${allRows.length} art traditions to ${filePath}`);
  }

  private async writeStyleEvolutionsTSV(evolutions: StyleEvolution[], clearExisting: boolean): Promise<void> {
    const filePath = "lexicons/art-style-evolutions.tsv";
    const headers = [
      "id", "from_tradition_id", "to_tradition_id", "transition_type",
      "transition_date", "description", "key_changes", "catalysts",
    ];

    let existingRows: string[][] = [];
    if (!clearExisting && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter(l => l.trim());
      for (let i = 1; i < lines.length; i++) {
        existingRows.push(lines[i].split("\t"));
      }
    }

    const newRows = evolutions.map(e => [
      e.id,
      e.fromTraditionId,
      e.toTraditionId,
      e.transitionType,
      e.transitionDate.toString(),
      e.description,
      JSON.stringify(e.keyChanges),
      JSON.stringify(e.catalysts),
    ]);

    const allRows = [...existingRows, ...newRows];
    await tsvWriter.writeGenericTSV(filePath, headers, allRows);
    console.log(`Wrote ${allRows.length} style evolutions to ${filePath}`);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}

export const artTraditionScraper = new ArtTraditionScraper();
