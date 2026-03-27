import fs from "node:fs";
import path from "node:path";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { WritingSystem } from "../tsv-storage";
import { jobStore } from "./job-store";

/**
 * CLDR script metadata entry from Unicode CLDR scriptMetadata.json
 */
interface CldrScriptMetadata {
  rank: number;
  sampleChar: string;
  idUsage: string; // RECOMMENDED, LIMITED_USE, EXCLUSION, UNKNOWN
  rtl: string; // YES, NO
  hasCase: string;
  originCountry: string;
  likelyLanguage: string;
  density: number;
}

/**
 * Enriched script data from Gemini AI
 */
interface EnrichedScript {
  iso15924: string;
  name: string;
  type: string;
  direction: string;
  parentScript: string | null;
  languageCodes: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

const CLDR_SCRIPT_METADATA_URL =
  "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/scriptMetadata.json";
const CLDR_SCRIPT_NAMES_URL =
  "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-localenames-full/main/en/scripts.json";
const CLDR_LIKELY_SUBTAGS_URL =
  "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/likelySubtags.json";

export class WritingSystemScraper {
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

  /**
   * Fetch JSON from a URL
   */
  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Fetch script metadata from Unicode CLDR
   */
  async fetchCldrScriptMetadata(): Promise<Map<string, CldrScriptMetadata>> {
    console.log("Fetching CLDR script metadata...");
    const data = await this.fetchJson<{ scriptMetadata: Record<string, CldrScriptMetadata> }>(
      CLDR_SCRIPT_METADATA_URL
    );

    const scripts = new Map<string, CldrScriptMetadata>();
    for (const [code, meta] of Object.entries(data.scriptMetadata)) {
      scripts.set(code, meta);
    }
    console.log(`Fetched metadata for ${scripts.size} scripts`);
    return scripts;
  }

  /**
   * Fetch English script names from Unicode CLDR
   */
  async fetchCldrScriptNames(): Promise<Map<string, string>> {
    console.log("Fetching CLDR script names...");
    const data = await this.fetchJson<{
      main: { en: { localeDisplayNames: { scripts: Record<string, string> } } };
    }>(CLDR_SCRIPT_NAMES_URL);

    const names = new Map<string, string>();
    for (const [code, name] of Object.entries(data.main.en.localeDisplayNames.scripts)) {
      // Skip variant names like "Arab-alt-variant"
      if (!code.includes("-")) {
        names.set(code, name);
      }
    }
    console.log(`Fetched names for ${names.size} scripts`);
    return names;
  }

  /**
   * Build script-to-languages mapping from CLDR likelySubtags
   */
  async fetchScriptLanguageMap(): Promise<Map<string, string[]>> {
    console.log("Fetching CLDR likely subtags for script-language mapping...");
    const data = await this.fetchJson<{
      supplemental: { likelySubtags: Record<string, string> };
    }>(CLDR_LIKELY_SUBTAGS_URL);

    const scriptLangs = new Map<string, string[]>();
    for (const [langTag, fullTag] of Object.entries(data.supplemental.likelySubtags)) {
      // Parse "aa-Latn-ET" format to extract script
      const parts = fullTag.split("-");
      if (parts.length >= 2) {
        const script = parts.find((p) => p.length === 4 && p[0] === p[0].toUpperCase() && p[1] === p[1].toLowerCase());
        if (script) {
          // Only use simple language codes (no script/region suffixes in the key)
          const baseLang = langTag.split("-")[0];
          if (baseLang.length <= 3) {
            const existing = scriptLangs.get(script) ?? [];
            if (!existing.includes(baseLang)) {
              existing.push(baseLang);
              scriptLangs.set(script, existing);
            }
          }
        }
      }
    }
    console.log(`Built script-language mapping for ${scriptLangs.size} scripts`);
    return scriptLangs;
  }

  /**
   * Use Gemini AI to enrich script data with details not available in CLDR
   * (type classification, origin dates, parent scripts, Unicode blocks, etc.)
   */
  private async enrichScriptsWithGemini(
    scripts: Array<{ code: string; name: string; rtl: boolean; sampleChar: string; originCountry: string }>,
    progressCallback?: (type: string, message: string) => void
  ): Promise<EnrichedScript[]> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for enrichment");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const allEnriched: EnrichedScript[] = [];
    const batchSize = 20;

    for (let i = 0; i < scripts.length; i += batchSize) {
      const batch = scripts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(scripts.length / batchSize);

      if (progressCallback) {
        progressCallback("progress", `Enriching batch ${batchNum}/${totalBatches} with Gemini AI...`);
      }

      const scriptList = batch
        .map((s) => `- ${s.code}: ${s.name} (sample: ${s.sampleChar || "N/A"}, origin country: ${s.originCountry})`)
        .join("\n");

      const prompt = `You are a writing systems expert. For each script below, provide detailed metadata.

Scripts to classify:
${scriptList}

For each script, provide:
- type: one of "alphabet", "abjad", "abugida", "syllabary", "logographic", "featural", "semisyllabary"
- direction: "LTR", "RTL", or "TTB"
- parentScript: the ISO 15924 code of the parent/ancestor script (null if none known)
- languageCodes: array of ISO 639-2/3 language codes that primarily use this script (top 5-10)
- originDate: approximate year of origin (negative for BCE, e.g. "-800" for 800 BCE)
- originRegion: geographic region of origin
- characterCount: approximate number of characters/glyphs in the script
- sampleCharacters: 8-12 representative characters separated by spaces
- unicodeBlock: primary Unicode block name
- isActive: whether the script is still actively used for everyday writing today`;

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              scripts: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    iso15924: { type: SchemaType.STRING },
                    name: { type: SchemaType.STRING },
                    type: { type: SchemaType.STRING },
                    direction: { type: SchemaType.STRING },
                    parentScript: { type: SchemaType.STRING, nullable: true },
                    languageCodes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                    originDate: { type: SchemaType.STRING },
                    originRegion: { type: SchemaType.STRING },
                    characterCount: { type: SchemaType.NUMBER },
                    sampleCharacters: { type: SchemaType.STRING },
                    unicodeBlock: { type: SchemaType.STRING },
                    isActive: { type: SchemaType.BOOLEAN },
                  },
                  required: [
                    "iso15924", "name", "type", "direction", "languageCodes",
                    "originDate", "originRegion", "characterCount", "sampleCharacters",
                    "unicodeBlock", "isActive",
                  ],
                },
              },
            },
            required: ["scripts"],
          },
        },
      });

      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);

        if (parsed?.scripts && Array.isArray(parsed.scripts)) {
          allEnriched.push(...parsed.scripts);
        }
      } catch (error) {
        console.error(`Failed to enrich batch ${batchNum}:`, error);
        if (progressCallback) {
          progressCallback("error", `Failed to enrich batch ${batchNum}: ${error}`);
        }
      }
    }

    return allEnriched;
  }

  /**
   * Load existing writing systems from TSV
   */
  private loadExistingWritingSystems(filePath: string): WritingSystem[] {
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length <= 1) return [];

    const header = lines[0].split("\t");
    const idx = (name: string) => header.indexOf(name);

    return lines.slice(1).map((line) => {
      const cols = line.split("\t");
      let langIds: string[] = [];
      const langIdsRaw = cols[idx("language_ids")] || "";
      if (langIdsRaw) {
        try { langIds = JSON.parse(langIdsRaw); } catch { langIds = []; }
      }

      return {
        id: cols[idx("id")] || "",
        name: cols[idx("name")] || "",
        type: cols[idx("type")] || "",
        direction: cols[idx("direction")] || "",
        parentSystemId: cols[idx("parent_system_id")] || "",
        languageIds: langIds,
        originDate: cols[idx("origin_date")] || "",
        originRegion: cols[idx("origin_region")] || "",
        characterCount: parseInt(cols[idx("character_count")] || "0", 10) || 0,
        sampleCharacters: cols[idx("sample_characters")] || "",
        unicodeBlock: cols[idx("unicode_block")] || "",
        isActive: cols[idx("is_active")] === "true",
      };
    });
  }

  /**
   * Write writing systems to TSV
   */
  private async writeWritingSystemsTsv(systems: WritingSystem[], filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const headers = [
      "id", "name", "type", "direction", "parent_system_id", "language_ids",
      "origin_date", "origin_region", "character_count", "sample_characters",
      "unicode_block", "is_active",
    ];

    const rows = systems.map((ws) =>
      [
        ws.id,
        ws.name,
        ws.type,
        ws.direction,
        ws.parentSystemId || "null",
        JSON.stringify(ws.languageIds),
        ws.originDate,
        ws.originRegion,
        ws.characterCount.toString(),
        ws.sampleCharacters,
        ws.unicodeBlock || "null",
        ws.isActive ? "true" : "false",
      ].join("\t")
    );

    const content = [headers.join("\t"), ...rows].join("\n") + "\n";

    const tempFile = `${filePath}.tmp`;
    try {
      await fs.promises.writeFile(tempFile, content, "utf8");
      await fs.promises.rename(tempFile, filePath);
      console.log(`Wrote ${systems.length} writing systems to ${filePath}`);
    } catch (error) {
      try { await fs.promises.unlink(tempFile); } catch {}
      throw error;
    }
  }

  /**
   * Generate a writing system ID from ISO 15924 code
   */
  private makeId(existingIds: Set<string>, nextNum: { value: number }): string {
    let id: string;
    do {
      id = `ws_${String(nextNum.value).padStart(3, "0")}`;
      nextNum.value++;
    } while (existingIds.has(id));
    existingIds.add(id);
    return id;
  }

  /**
   * Main scrape method: fetches CLDR data, enriches with Gemini, merges with existing
   */
  async scrapeWritingSystems(options: {
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
    outputPath?: string;
  } = {}): Promise<WritingSystem[]> {
    const { jobId, progressCallback, outputPath = "lexicons/writing-systems.tsv" } = options;

    if (WritingSystemScraper.isScraping) {
      throw new Error("Writing system scraping is already in progress");
    }
    WritingSystemScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, { status: "running", startedAt: new Date().toISOString() });

      if (progressCallback) progressCallback("progress", "Fetching Unicode CLDR data...");

      // Step 1: Fetch CLDR data in parallel
      const [scriptMetadata, scriptNames, scriptLangMap] = await Promise.all([
        this.fetchCldrScriptMetadata(),
        this.fetchCldrScriptNames(),
        this.fetchScriptLanguageMap(),
      ]);

      if (progressCallback) progressCallback("progress", `Fetched CLDR data for ${scriptMetadata.size} scripts`);

      // Step 2: Filter to meaningful scripts (exclude rank 33 unknowns without sample chars)
      const significantScripts: Array<{
        code: string;
        name: string;
        rtl: boolean;
        sampleChar: string;
        originCountry: string;
        idUsage: string;
        languages: string[];
      }> = [];

      for (const [code, meta] of scriptMetadata) {
        const name = scriptNames.get(code);
        if (!name) continue;
        // Skip codes that are just numbers (e.g., Qaaa-Qabx private use)
        if (/^Q[a-z]{3}$/.test(code)) continue;
        // Skip Zinh, Zyyy, Zzzz (inherited, common, unknown)
        if (["Zinh", "Zyyy", "Zzzz"].includes(code)) continue;

        significantScripts.push({
          code,
          name,
          rtl: meta.rtl === "YES",
          sampleChar: meta.sampleChar || "",
          originCountry: meta.originCountry || "",
          idUsage: meta.idUsage,
          languages: scriptLangMap.get(code) ?? [],
        });
      }

      console.log(`Found ${significantScripts.length} significant scripts to process`);
      this.updateJobStatus(jobId, { totalWords: significantScripts.length });

      // Step 3: Load existing data
      const existing = this.loadExistingWritingSystems(outputPath);
      const existingByName = new Map(existing.map((ws) => [ws.name.toLowerCase(), ws]));

      if (progressCallback) {
        progressCallback("progress", `Enriching ${significantScripts.length} scripts with Gemini AI...`);
      }

      // Step 4: Enrich with Gemini AI
      const enriched = await this.enrichScriptsWithGemini(significantScripts, progressCallback);

      // Step 5: Build enriched lookup by ISO code
      const enrichedByCode = new Map(enriched.map((e) => [e.iso15924, e]));

      // Step 6: Merge - keep existing entries, add new ones
      const existingIds = new Set(existing.map((ws) => ws.id));
      const maxExistingNum = existing.reduce((max, ws) => {
        const num = parseInt(ws.id.replace("ws_", ""), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const nextNum = { value: maxExistingNum + 1 };

      // Build parent script code -> id mapping for linking
      const codeToId = new Map<string, string>();
      for (const ws of existing) {
        // Try to match existing systems to ISO codes via name
        for (const [code, name] of scriptNames) {
          if (name.toLowerCase() === ws.name.toLowerCase()) {
            codeToId.set(code, ws.id);
          }
        }
      }

      const merged: WritingSystem[] = [...existing];
      let addedCount = 0;

      for (const script of significantScripts) {
        const enrichedData = enrichedByCode.get(script.code);
        const displayName = enrichedData?.name ?? script.name;

        // Skip if we already have this script
        if (existingByName.has(displayName.toLowerCase())) {
          // Update code->id mapping for this existing entry
          const existingWs = existingByName.get(displayName.toLowerCase())!;
          codeToId.set(script.code, existingWs.id);
          continue;
        }

        const id = this.makeId(existingIds, nextNum);
        codeToId.set(script.code, id);

        // Merge CLDR data with Gemini enrichment
        const langIds = enrichedData?.languageCodes?.length
          ? enrichedData.languageCodes
          : script.languages;

        const ws: WritingSystem = {
          id,
          name: displayName,
          type: enrichedData?.type ?? "alphabet",
          direction: enrichedData?.direction ?? (script.rtl ? "RTL" : "LTR"),
          parentSystemId: "",
          languageIds: langIds,
          originDate: enrichedData?.originDate ?? "",
          originRegion: enrichedData?.originRegion ?? script.originCountry,
          characterCount: enrichedData?.characterCount ?? 0,
          sampleCharacters: enrichedData?.sampleCharacters ?? script.sampleChar,
          unicodeBlock: enrichedData?.unicodeBlock ?? "",
          isActive: enrichedData?.isActive ?? script.idUsage === "RECOMMENDED",
        };

        merged.push(ws);
        addedCount++;
      }

      // Step 7: Resolve parent script references
      for (const ws of merged) {
        if (ws.parentSystemId) continue; // Already has parent
        // Find enriched data for this system
        for (const [code, wsId] of codeToId) {
          if (wsId === ws.id) {
            const enrichedData = enrichedByCode.get(code);
            if (enrichedData?.parentScript) {
              const parentId = codeToId.get(enrichedData.parentScript);
              if (parentId) {
                ws.parentSystemId = parentId;
              }
            }
            break;
          }
        }
      }

      if (progressCallback) {
        progressCallback("progress", `Writing ${merged.length} writing systems to TSV...`);
      }

      // Step 8: Write merged data
      await this.writeWritingSystemsTsv(merged, outputPath);

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: significantScripts.length,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback(
          "completed",
          `Scraping complete: ${addedCount} new scripts added, ${merged.length} total`
        );
      }

      console.log(`Writing system scraping complete: ${addedCount} added, ${merged.length} total`);
      return merged;
    } catch (error) {
      console.error("Writing system scraping failed:", error);
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
      WritingSystemScraper.isScraping = false;
    }
  }
}

export const writingSystemScraper = new WritingSystemScraper();
