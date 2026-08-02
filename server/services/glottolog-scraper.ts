import fetch from "node-fetch";
import type { Language, LanguageFamily } from "@contracts/types";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import path from "node:path";

const GLOTTOLOG_API_BASE = "https://glottolog.org/resource/languoid/id";
const GLOTTOLOG_FAMILIES_URL = "https://glottolog.org/glottolog/family";

/** Rate limit: wait between requests to be respectful to Glottolog servers */
const REQUEST_DELAY_MS = 300;

/** Maximum depth for recursive tree traversal */
const MAX_DEPTH = 10;

export interface GlottologLanguoid {
  id: string;
  name: string;
  level: "family" | "language" | "dialect";
  iso639_3: string | null;
  glottocode: string;
  latitude: number | null;
  longitude: number | null;
  macroarea: string | null;
  child_family_count: number;
  child_language_count: number;
  child_dialect_count: number;
  children: GlottologChildRef[];
  parent?: { name: string; id: string } | null;
  classification?: { name: string; id: string }[];
}

export interface GlottologChildRef {
  id: string;
  name: string;
  level: "family" | "language" | "dialect";
}

export interface GlottologScrapeOptions {
  maxFamilies?: number;
  familyFilter?: string;
  maxDepth?: number;
  jobId?: string;
  progressCallback?: (type: string, message: string, data?: any) => void;
}

export interface GlottologScrapeResult {
  families: LanguageFamily[];
  languages: Language[];
  totalApiCalls: number;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scraper for Glottolog language family tree data.
 * Fetches comprehensive language classification from glottolog.org API.
 */
export class GlottologScraper {
  private static isScraping = false;
  private apiCalls = 0;

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

  /**
   * Fetch a single languoid from the Glottolog API
   */
  async fetchLanguoid(glottocode: string): Promise<GlottologLanguoid | null> {
    const url = `${GLOTTOLOG_API_BASE}/${glottocode}.json`;
    try {
      this.apiCalls++;
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Glottolog API returned ${response.status} for ${glottocode}`);
        return null;
      }
      const data = await response.json() as any;
      return this.parseLanguoidResponse(data, glottocode);
    } catch (error) {
      console.error(`Failed to fetch languoid ${glottocode}:`, error);
      return null;
    }
  }

  private parseLanguoidResponse(data: any, glottocode: string): GlottologLanguoid {
    return {
      id: data.id || glottocode,
      name: data.name || "Unknown",
      level: data.level || "family",
      iso639_3: data.iso639_3 || null,
      glottocode: glottocode,
      latitude: data.latitude != null ? Number(data.latitude) : null,
      longitude: data.longitude != null ? Number(data.longitude) : null,
      macroarea: data.macroarea || null,
      child_family_count: data.child_family_count || 0,
      child_language_count: data.child_language_count || 0,
      child_dialect_count: data.child_dialect_count || 0,
      children: Array.isArray(data.children)
        ? data.children.map((c: any) => ({
            id: c.id,
            name: c.name,
            level: c.level || "family",
          }))
        : [],
      parent: data.parent ? { name: data.parent.name, id: data.parent.id } : null,
      classification: Array.isArray(data.classification)
        ? data.classification.map((c: any) => ({ name: c.name, id: c.id }))
        : undefined,
    };
  }

  /**
   * Scrape the top-level family list from Glottolog.
   * Returns glottocodes for the major language families.
   */
  async scrapeTopLevelFamilies(): Promise<GlottologChildRef[]> {
    const url = `${GLOTTOLOG_FAMILIES_URL}.json`;
    try {
      this.apiCalls++;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Glottolog families API returned ${response.status}`);
      }
      const data = await response.json() as any;
      if (Array.isArray(data)) {
        return data.map((item: any) => ({
          id: item.id || item.glottocode,
          name: item.name,
          level: "family" as const,
        }));
      }
      // If the response is paginated or differently structured
      if (data.entries && Array.isArray(data.entries)) {
        return data.entries.map((item: any) => ({
          id: item.id || item.glottocode,
          name: item.name,
          level: "family" as const,
        }));
      }
      return [];
    } catch (error) {
      console.error("Failed to fetch top-level families:", error);
      throw error;
    }
  }

  /**
   * Recursively scrape a language family tree from Glottolog
   */
  async scrapeFamilyTree(
    glottocode: string,
    parentId: string | null,
    depth: number,
    maxDepth: number,
    progressCallback?: (type: string, message: string, data?: any) => void
  ): Promise<{ families: LanguageFamily[]; languages: Language[] }> {
    if (depth > maxDepth) return { families: [], languages: [] };

    await delay(REQUEST_DELAY_MS);
    const languoid = await this.fetchLanguoid(glottocode);
    if (!languoid) return { families: [], languages: [] };

    const families: LanguageFamily[] = [];
    const languages: Language[] = [];

    if (languoid.level === "language") {
      // This is a leaf language node
      const lang = this.languoidToLanguage(languoid, parentId);
      languages.push(lang);
    } else {
      // This is a family/subfamily node
      const family = this.languoidToFamily(languoid, parentId);
      families.push(family);

      if (progressCallback) {
        progressCallback("progress", `Scraping ${languoid.name} (${languoid.children.length} children)...`);
      }

      // Recursively scrape children
      for (const child of languoid.children) {
        if (child.level === "dialect") continue; // Skip dialects for tree compactness

        const childResult = await this.scrapeFamilyTree(
          child.id,
          family.id,
          depth + 1,
          maxDepth,
          progressCallback
        );
        families.push(...childResult.families);
        languages.push(...childResult.languages);
      }
    }

    return { families, languages };
  }

  private languoidToFamily(languoid: GlottologLanguoid, parentId: string | null): LanguageFamily {
    const id = slugify(languoid.name);
    const taxonomicLevel = this.inferTaxonomicLevel(languoid, parentId);

    return {
      id: parentId ? `${parentId}__${id}` : id,
      name: languoid.name,
      parentId,
      description: `Glottolog classification: ${languoid.glottocode}. ${languoid.macroarea ? `Macroarea: ${languoid.macroarea}.` : ""} Contains ${languoid.child_language_count} languages and ${languoid.child_family_count} subfamilies.`,
      taxonomicLevel,
      region: languoid.macroarea || null,
      totalSpeakers: null,
      languageCount: languoid.child_language_count || null,
      source: "scraped" as const,
    };
  }

  private inferTaxonomicLevel(languoid: GlottologLanguoid, parentId: string | null): string {
    if (!parentId) return "Family";
    // Count depth by number of __ separators in parentId
    const depth = (parentId.match(/__/g) || []).length;
    if (depth === 0) return "Subfamily";
    if (depth === 1) return "Genus";
    return "Subgenus";
  }

  private languoidToLanguage(languoid: GlottologLanguoid, familyId: string | null): Language {
    const id = languoid.iso639_3 || slugify(languoid.name);
    return {
      id,
      name: languoid.name,
      nativeName: null,
      iso639_1: null,
      iso639_2: languoid.iso639_3 || null,
      familyId: familyId || "isolate",
      parentLanguageId: null,
      region: languoid.macroarea || null,
      countries: [],
      nativeSpeakers: null,
      totalSpeakers: null,
      status: "living",
      timeOrigin: null,
      timeEnd: null,
      classification: languoid.classification
        ? languoid.classification.map((c) => c.name).join(" > ")
        : null,
      writingSystem: null,
      isHistoricalVariant: false,
      isDialect: false,
      coordinates:
        languoid.latitude != null && languoid.longitude != null
          ? { lat: languoid.latitude, lng: languoid.longitude }
          : null,
      source: "scraped" as const,
    };
  }

  /**
   * Main entry point: scrape Glottolog for comprehensive language family data
   */
  async scrapeGlottolog(options: GlottologScrapeOptions = {}): Promise<GlottologScrapeResult> {
    const {
      maxFamilies,
      familyFilter,
      maxDepth = MAX_DEPTH,
      jobId,
      progressCallback,
    } = options;

    if (GlottologScraper.isScraping) {
      throw new Error("Glottolog scraping is already in progress");
    }

    GlottologScraper.isScraping = true;
    this.apiCalls = 0;

    try {
      console.log("Starting Glottolog scraping...");

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Fetching top-level language families from Glottolog...");
      }

      // Get top-level families
      let topFamilies = await this.scrapeTopLevelFamilies();

      if (familyFilter) {
        topFamilies = topFamilies.filter(
          (f) =>
            f.id === familyFilter ||
            f.name.toLowerCase().includes(familyFilter.toLowerCase())
        );
      }

      if (maxFamilies && topFamilies.length > maxFamilies) {
        topFamilies = topFamilies.slice(0, maxFamilies);
      }

      if (progressCallback) {
        progressCallback("progress", `Found ${topFamilies.length} top-level families. Starting tree traversal...`);
      }

      this.updateJobStatus(jobId, {
        totalWords: topFamilies.length,
        completedWords: 0,
      });

      const allFamilies: LanguageFamily[] = [];
      const allLanguages: Language[] = [];

      for (let i = 0; i < topFamilies.length; i++) {
        const family = topFamilies[i];

        if (progressCallback) {
          progressCallback(
            "progress",
            `Scraping family ${i + 1}/${topFamilies.length}: ${family.name}...`
          );
        }

        const result = await this.scrapeFamilyTree(
          family.id,
          null,
          0,
          maxDepth,
          progressCallback
        );

        allFamilies.push(...result.families);
        allLanguages.push(...result.languages);

        this.updateJobStatus(jobId, {
          completedWords: i + 1,
          statusMessage: `Scraped ${family.name}: ${result.families.length} nodes, ${result.languages.length} languages`,
        });
      }

      // Write results to TSV files
      const familiesPath = path.resolve("lexicons", "glottolog-families.tsv");
      const languagesPath = path.resolve("lexicons", "glottolog-languages.tsv");

      await tsvWriter.writeLanguageFamilyTSV(allFamilies, familiesPath);
      await tsvWriter.writeLanguageTSV(allLanguages, languagesPath);

      if (progressCallback) {
        progressCallback(
          "complete",
          `Glottolog scraping complete: ${allFamilies.length} family nodes, ${allLanguages.length} languages from ${this.apiCalls} API calls`
        );
      }

      this.updateJobStatus(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        statusMessage: `Completed: ${allFamilies.length} families, ${allLanguages.length} languages`,
      });

      console.log(
        `Glottolog scraping complete: ${allFamilies.length} families, ${allLanguages.length} languages, ${this.apiCalls} API calls`
      );

      return {
        families: allFamilies,
        languages: allLanguages,
        totalApiCalls: this.apiCalls,
      };
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      GlottologScraper.isScraping = false;
    }
  }

  /** Reset the static scraping flag (for testing) */
  static resetScrapingFlag(): void {
    GlottologScraper.isScraping = false;
  }
}

export const glottologScraper = new GlottologScraper();
