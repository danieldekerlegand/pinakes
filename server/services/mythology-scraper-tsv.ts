import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import fs from "node:fs";

interface ScrapedDeity {
  id: string;
  name: string;
  nativeName: string;
  pantheon: string;
  domain: string[];
  gender: string;
  syncretismLinks: string[];
  associatedReligionIds: string[];
  associatedLanguageIds: string[];
  timeOrigin: number | null;
  timeEnd: number | null;
  coordinates: { lat: number; lng: number } | null;
  description: string;
  sources: string[];
}

interface ScrapedMythMotif {
  id: string;
  name: string;
  motifType: string;
  atuIndex: string | null;
  description: string;
  examples: Array<{ culture: string; narrative: string }>;
  associatedReligionIds: string[];
  associatedDeityIds: string[];
  geographicDistribution: string[];
  timeDepth: number | null;
  sources: string[];
}

export class MythologyScraperTSV {
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

  async scrapeMythology(options: {
    pantheons?: string[];
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  } = {}): Promise<{ deities: ScrapedDeity[]; motifs: ScrapedMythMotif[] }> {
    const { pantheons, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (MythologyScraperTSV.isScraping) {
      throw new Error("Mythology scraping is already in progress");
    }

    MythologyScraperTSV.isScraping = true;

    try {
      console.log("Starting mythology scraping with Gemini AI...");

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Loading existing deity data...");
      }

      const existingDeityIds = await this.loadExistingDeityIds();

      // Determine which pantheons to scrape
      const targetPantheons = pantheons || [
        "greek", "roman", "norse", "egyptian", "hindu",
        "mesopotamian", "celtic", "japanese", "chinese",
        "aztec", "maya", "yoruba", "slavic", "polynesian",
        "inuit", "zoroastrian", "canaanite", "hittite",
      ];

      this.updateJobStatus(jobId, { totalWords: targetPantheons.length + 1 });

      if (progressCallback) {
        progressCallback("progress", `Scraping deities for ${targetPantheons.length} pantheons...`);
      }

      // Scrape deities for each pantheon
      const allDeities: ScrapedDeity[] = [];
      for (let i = 0; i < targetPantheons.length; i++) {
        const pantheon = targetPantheons[i];

        if (progressCallback) {
          progressCallback("progress", `Scraping ${pantheon} pantheon (${i + 1}/${targetPantheons.length})...`);
        }

        try {
          const deities = await this.scrapeDeitiesForPantheon(pantheon, existingDeityIds);
          allDeities.push(...deities);
          console.log(`  → Scraped ${deities.length} deities for ${pantheon}`);
        } catch (error) {
          console.error(`Failed to scrape ${pantheon} pantheon:`, error);
          if (progressCallback) {
            progressCallback("error", `Failed to scrape ${pantheon}: ${error}`);
          }
        }

        this.updateJobStatus(jobId, { completedWords: i + 1 });
      }

      // Build cross-cultural syncretism links
      if (progressCallback) {
        progressCallback("progress", "Building cross-cultural syncretism links...");
      }
      const linkedDeities = await this.buildSyncretismLinks(allDeities);

      // Scrape myth motifs
      if (progressCallback) {
        progressCallback("progress", "Scraping myth motifs with cross-cultural examples...");
      }
      const motifs = await this.scrapeMythMotifs(linkedDeities);

      this.updateJobStatus(jobId, { completedWords: targetPantheons.length + 1 });

      // Write to TSV files
      if (progressCallback) {
        progressCallback("progress", "Writing to TSV files...");
      }

      await this.writeDeitiesToTsv(linkedDeities);
      await this.writeMotifsToTsv(motifs);

      this.updateJobStatus(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", `Scraping completed: ${linkedDeities.length} deities, ${motifs.length} motifs`);
      }

      console.log(`Mythology scraping completed: ${linkedDeities.length} deities, ${motifs.length} motifs`);
      return { deities: linkedDeities, motifs };
    } catch (error) {
      console.error("Error during mythology scraping:", error);
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
      MythologyScraperTSV.isScraping = false;
    }
  }

  private async loadExistingDeityIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
      const text = await fs.promises.readFile("lexicons/deities.tsv", "utf-8");
      const lines = text.trim().split("\n");
      for (let i = 1; i < lines.length; i++) {
        const id = lines[i].split("\t")[0];
        if (id) ids.add(id);
      }
    } catch {
      // File may not exist yet
    }
    return ids;
  }

  async scrapeDeitiesForPantheon(
    pantheon: string,
    existingIds: Set<string>
  ): Promise<ScrapedDeity[]> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const excludeNote = existingIds.size > 0
      ? `\nIMPORTANT: We already have these deity IDs, so only include them if you can add NEW information: ${[...existingIds].slice(0, 30).join(", ")}`
      : "";

    const prompt = `You are a comparative mythology scholar. Generate a comprehensive list of deities from the ${pantheon} mythology/religion.${excludeNote}

For each deity provide:
- id: lowercase snake_case identifier (e.g., "zeus", "ra", "odin")
- name: English name
- nativeName: Name in original script/language if available
- domain: Array of domains/aspects (e.g., ["sky", "thunder", "kingship"])
- gender: "male", "female", or "non-binary"
- associatedReligionIds: Array of religion IDs (e.g., ["ancient-greek-religion"])
- associatedLanguageIds: Array of language IDs (e.g., ["ancient-greek"])
- timeOrigin: Approximate year worship began (negative for BCE)
- timeEnd: Approximate year worship ended (negative for BCE, null if still active)
- coordinates: Lat/lng of primary cult center {lat, lng}
- description: One sentence description
- sources: Array of scholarly sources

Include 10-20 major deities for this pantheon. Focus on the most important and well-documented figures.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            deities: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  nativeName: { type: SchemaType.STRING },
                  domain: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  gender: { type: SchemaType.STRING },
                  associatedReligionIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  associatedLanguageIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  timeOrigin: { type: SchemaType.NUMBER, nullable: true },
                  timeEnd: { type: SchemaType.NUMBER, nullable: true },
                  lat: { type: SchemaType.NUMBER, nullable: true },
                  lng: { type: SchemaType.NUMBER, nullable: true },
                  description: { type: SchemaType.STRING },
                  sources: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                },
                required: ["id", "name", "domain", "gender", "description"],
              },
            },
          },
          required: ["deities"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.deities)) {
      throw new Error(`Invalid response structure for ${pantheon} deities`);
    }

    return parsed.deities.map((d: any) => ({
      id: this.slugify(d.id || d.name),
      name: d.name,
      nativeName: d.nativeName || "",
      pantheon,
      domain: Array.isArray(d.domain) ? d.domain : [],
      gender: d.gender || "unknown",
      syncretismLinks: [],
      associatedReligionIds: Array.isArray(d.associatedReligionIds) ? d.associatedReligionIds : [],
      associatedLanguageIds: Array.isArray(d.associatedLanguageIds) ? d.associatedLanguageIds : [],
      timeOrigin: d.timeOrigin ?? null,
      timeEnd: d.timeEnd ?? null,
      coordinates: (d.lat != null && d.lng != null) ? { lat: d.lat, lng: d.lng } : null,
      description: d.description || "",
      sources: Array.isArray(d.sources) ? d.sources : [],
    }));
  }

  async buildSyncretismLinks(deities: ScrapedDeity[]): Promise<ScrapedDeity[]> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    // Build a summary of all deities for the AI to work with
    const deitySummary = deities.map(d =>
      `${d.id} (${d.pantheon}): ${d.name} - ${d.domain.join(", ")}`
    ).join("\n");

    const prompt = `You are a comparative mythology scholar. Given the following list of deities from multiple pantheons, identify cross-cultural equivalents (syncretism links).

DEITY LIST:
${deitySummary}

For each deity that has equivalents in other pantheons, provide the links. A syncretism link means the deities share similar roles, domains, or were historically identified with each other (e.g., Zeus = Jupiter = Indra for sky/thunder gods).

Rules:
- Only link deities with genuine scholarly connections (interpretatio graeca/romana, shared PIE origins, documented syncretism)
- Links must be bidirectional (if A links to B, B must link to A)
- Use the exact deity IDs from the list above
- Focus on well-established connections, not speculative ones`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            links: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  deityId: { type: SchemaType.STRING },
                  equivalents: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                },
                required: ["deityId", "equivalents"],
              },
            },
          },
          required: ["links"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.links)) {
      console.warn("Could not parse syncretism links, returning deities without links");
      return deities;
    }

    // Build a map of deity ID -> syncretism links
    const linkMap = new Map<string, Set<string>>();
    const deityIdSet = new Set(deities.map(d => d.id));

    for (const link of parsed.links) {
      if (!deityIdSet.has(link.deityId)) continue;
      if (!linkMap.has(link.deityId)) linkMap.set(link.deityId, new Set());

      for (const equiv of link.equivalents) {
        if (!deityIdSet.has(equiv)) continue;
        linkMap.get(link.deityId)!.add(equiv);

        // Ensure bidirectional
        if (!linkMap.has(equiv)) linkMap.set(equiv, new Set());
        linkMap.get(equiv)!.add(link.deityId);
      }
    }

    // Apply links to deities
    return deities.map(d => ({
      ...d,
      syncretismLinks: [...(linkMap.get(d.id) || [])],
    }));
  }

  async scrapeMythMotifs(deities: ScrapedDeity[]): Promise<ScrapedMythMotif[]> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const deityIdsByPantheon = new Map<string, string[]>();
    for (const d of deities) {
      if (!deityIdsByPantheon.has(d.pantheon)) deityIdsByPantheon.set(d.pantheon, []);
      deityIdsByPantheon.get(d.pantheon)!.push(d.id);
    }

    const pantheonSummary = [...deityIdsByPantheon.entries()]
      .map(([p, ids]) => `${p}: ${ids.join(", ")}`)
      .join("\n");

    const prompt = `You are a comparative mythology scholar. Generate a comprehensive list of universal myth motifs found across multiple cultures.

Available deity IDs by pantheon:
${pantheonSummary}

For each motif provide:
- id: lowercase hyphen-separated identifier (e.g., "flood-myth", "world-tree")
- name: Display name
- motifType: One of: cosmology, cataclysm, creation, hero, death-rebirth, archetype, fertility, transformation, underworld, celestial, culture-hero, eschatology
- atuIndex: Aarne-Thompson-Uther index if applicable, null otherwise
- description: One-sentence scholarly description
- examples: Array of {culture, narrative} objects showing how this motif appears in different traditions (at least 3 cultures each)
- associatedReligionIds: Array of religion IDs
- associatedDeityIds: Array of deity IDs from the list above that are associated with this motif
- geographicDistribution: Array of regions (e.g., ["Global"], ["Mediterranean", "Near East"])
- timeDepth: Approximate age in years BCE (negative number)
- sources: Array of scholarly sources

Generate 30-40 motifs covering diverse categories. Each motif MUST have cross-cultural examples from at least 3 different traditions.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            motifs: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  name: { type: SchemaType.STRING },
                  motifType: { type: SchemaType.STRING },
                  atuIndex: { type: SchemaType.STRING, nullable: true },
                  description: { type: SchemaType.STRING },
                  examples: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        culture: { type: SchemaType.STRING },
                        narrative: { type: SchemaType.STRING },
                      },
                      required: ["culture", "narrative"],
                    },
                  },
                  associatedReligionIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  associatedDeityIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  geographicDistribution: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  timeDepth: { type: SchemaType.NUMBER, nullable: true },
                  sources: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                },
                required: ["id", "name", "motifType", "description", "examples"],
              },
            },
          },
          required: ["motifs"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.motifs)) {
      throw new Error("Invalid response structure for myth motifs");
    }

    const validDeityIds = new Set(deities.map(d => d.id));

    return parsed.motifs.map((m: any) => ({
      id: this.slugify(m.id || m.name).replace(/_/g, "-"),
      name: m.name,
      motifType: m.motifType || "archetype",
      atuIndex: m.atuIndex || null,
      description: m.description || "",
      examples: Array.isArray(m.examples) ? m.examples : [],
      associatedReligionIds: Array.isArray(m.associatedReligionIds) ? m.associatedReligionIds : [],
      associatedDeityIds: Array.isArray(m.associatedDeityIds)
        ? m.associatedDeityIds.filter((id: string) => validDeityIds.has(id))
        : [],
      geographicDistribution: Array.isArray(m.geographicDistribution) ? m.geographicDistribution : [],
      timeDepth: m.timeDepth ?? null,
      sources: Array.isArray(m.sources) ? m.sources : [],
    }));
  }

  private async writeDeitiesToTsv(deities: ScrapedDeity[]): Promise<void> {
    const headers = [
      "id", "name", "native_name", "pantheon", "domain", "gender",
      "syncretism_links", "associated_religion_ids", "associated_language_ids",
      "time_origin", "time_end", "coordinates", "description", "sources",
    ];

    const rows = deities.map(d => [
      d.id,
      d.name,
      d.nativeName,
      d.pantheon,
      JSON.stringify(d.domain),
      d.gender,
      JSON.stringify(d.syncretismLinks),
      JSON.stringify(d.associatedReligionIds),
      JSON.stringify(d.associatedLanguageIds),
      d.timeOrigin?.toString() ?? "",
      d.timeEnd?.toString() ?? "",
      d.coordinates ? JSON.stringify(d.coordinates) : "",
      d.description,
      JSON.stringify(d.sources),
    ]);

    await tsvWriter.writeTSV("lexicons/deities.tsv", headers, rows);
  }

  private async writeMotifsToTsv(motifs: ScrapedMythMotif[]): Promise<void> {
    const headers = [
      "id", "name", "motif_type", "atu_index", "description", "examples",
      "associated_religion_ids", "associated_deity_ids", "geographic_distribution",
      "time_depth", "sources",
    ];

    const rows = motifs.map(m => [
      m.id,
      m.name,
      m.motifType,
      m.atuIndex ?? "",
      m.description,
      JSON.stringify(m.examples),
      JSON.stringify(m.associatedReligionIds),
      JSON.stringify(m.associatedDeityIds),
      JSON.stringify(m.geographicDistribution),
      m.timeDepth?.toString() ?? "",
      JSON.stringify(m.sources),
    ]);

    await tsvWriter.writeTSV("lexicons/myth-motifs.tsv", headers, rows);
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
}

export const mythologyScraperTSV = new MythologyScraperTSV();
