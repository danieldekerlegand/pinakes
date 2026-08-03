import fs from "node:fs";
import path from "node:path";
import type { Language, LanguageFamily } from "@contracts/types";
import type { TradeGood, TradeRoute } from "../tsv-storage";

export interface WordListEntry {
  conceptId: string;
  wordForm: string;
  ipa: string | null;
  source: string;
  confidence: number;
}

export interface CentralWordEntry {
  languageId: string;
  conceptId: string;
  wordForm: string;
  ipa: string | null;
}

export class TsvWriter {
  /**
   * Write language families to TSV file with atomic operation
   */
  async writeLanguageFamilyTSV(families: LanguageFamily[], filePath: string): Promise<void> {
    const headers = [
      "id",
      "name",
      "parent_id",
      "description",
      "taxonomic_level",
      "region",
      "total_speakers",
      "language_count",
    ];

    const rows = families.map((family) => [
      family.id,
      family.name,
      family.parentId ?? "",
      family.description ?? "",
      family.taxonomicLevel,
      family.region ?? "",
      family.totalSpeakers?.toString() ?? "",
      family.languageCount?.toString() ?? "",
    ]);

    await this.writeTSV(filePath, headers, rows);
  }

  /**
   * Write languages to TSV file with atomic operation
   */
  async writeLanguageTSV(languages: Language[], filePath: string): Promise<void> {
    const headers = [
      "id",
      "name",
      "native_name",
      "iso639_1",
      "iso639_2",
      "family_id",
      "parent_language_id",
      "region",
      "countries",
      "native_speakers",
      "total_speakers",
      "status",
      "time_origin",
      "time_end",
      "classification",
      "writing_system",
      "is_historical_variant",
      "is_dialect",
      "chronological_order",
      "historical_context",
      "latitude",
      "longitude",
    ];

    const rows = languages.map((lang) => [
      lang.id,
      lang.name,
      lang.nativeName ?? "",
      lang.iso639_1 ?? "",
      lang.iso639_2 ?? "",
      lang.familyId,
      lang.parentLanguageId ?? "",
      lang.region ?? "",
      Array.isArray(lang.countries) ? lang.countries.join(";") : "",
      lang.nativeSpeakers?.toString() ?? "",
      lang.totalSpeakers?.toString() ?? "",
      lang.status,
      lang.timeOrigin ?? "",
      lang.timeEnd ?? "",
      lang.classification ?? "",
      lang.writingSystem ?? "",
      lang.isHistoricalVariant ? "true" : "false",
      lang.isDialect ? "true" : "false",
      lang.chronologicalOrder?.toString() ?? "0",
      lang.historicalContext ?? "",
      lang.coordinates?.lat.toString() ?? "",
      lang.coordinates?.lng.toString() ?? "",
    ]);

    await this.writeTSV(filePath, headers, rows);
  }

  /**
   * Write word list (translations) to TSV file for a specific language
   */
  async writeWordListTSV(wordList: WordListEntry[], filePath: string): Promise<void> {
    const headers = ["Concept_ID", "Word_Form", "IPA", "Source", "Confidence"];

    const rows = wordList.map((entry) => [
      entry.conceptId,
      entry.wordForm,
      entry.ipa ?? "",
      entry.source,
      entry.confidence.toString(),
    ]);

    await this.writeTSV(filePath, headers, rows);
  }

  /**
   * Public generic TSV writer - writes headers and rows to a TSV file atomically
   */
  async writeGenericTSV(
    filePath: string,
    headers: string[],
    rows: string[][]
  ): Promise<void> {
    await this.writeTSV(filePath, headers, rows);
  }

  /**
   * Generic TSV writer with atomic operation (write to temp file, then rename)
   */
  async writeTSV(
    filePath: string,
    headers: string[],
    rows: string[][]
  ): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Write to temporary file first (atomic operation)
    const tempFile = `${filePath}.tmp`;

    try {
      // Create TSV content
      const headerLine = headers.join("\t");
      const dataLines = rows.map((row) => row.join("\t"));
      const tsvContent = [headerLine, ...dataLines].join("\n") + "\n";

      // Write to temp file
      await fs.promises.writeFile(tempFile, tsvContent, "utf8");

      // Atomically rename temp file to final file
      await fs.promises.rename(tempFile, filePath);

      console.log(`Successfully wrote TSV file: ${filePath} (${rows.length} rows)`);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.promises.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(
        `Failed to write TSV file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Append word entries to an existing word list TSV file
   * Useful for resumable scraping
   */
  async appendWordListTSV(
    wordList: WordListEntry[],
    filePath: string
  ): Promise<void> {
    // Check if file exists
    const fileExists = fs.existsSync(filePath);

    if (!fileExists) {
      // If file doesn't exist, create it with headers
      await this.writeWordListTSV(wordList, filePath);
      return;
    }

    // Append to existing file
    const rows = wordList.map((entry) =>
      [
        entry.conceptId,
        entry.wordForm,
        entry.ipa ?? "",
        entry.source,
        entry.confidence.toString(),
      ].join("\t")
    );

    const content = rows.join("\n") + "\n";

    await fs.promises.appendFile(filePath, content, "utf8");
    console.log(`Appended ${wordList.length} rows to ${filePath}`);
  }

  /**
   * Read existing word list TSV to get already scraped concept IDs
   * Useful for resuming interrupted scraping jobs
   */
  async getScrapedConceptIds(filePath: string): Promise<Set<string>> {
    const scrapedIds = new Set<string>();

    if (!fs.existsSync(filePath)) {
      return scrapedIds;
    }

    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");

      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split("\t");
        if (columns.length > 0 && columns[0]) {
          scrapedIds.add(columns[0]);
        }
      }

      console.log(`Found ${scrapedIds.size} already scraped concepts in ${filePath}`);
      return scrapedIds;
    } catch (error) {
      console.error(`Error reading scraped concept IDs from ${filePath}:`, error);
      return scrapedIds;
    }
  }

  /**
   * Append word entries to the central words.tsv file
   * This follows the NorthEuraLex format with Language_ID, Concept_ID, Word_Form, IPA columns
   */
  async appendToCentralWordsTSV(
    entries: CentralWordEntry[],
    filePath: string = "data/source/lexicons/words.tsv"
  ): Promise<void> {
    const fileExists = fs.existsSync(filePath);

    if (!fileExists) {
      throw new Error(`Central words.tsv file does not exist at ${filePath}`);
    }

    // Append entries in the format: Language_ID, Glottocode, Concept_ID, Word_Form, rawIPA, IPA, ASJP, List, Dolgo, Next_Step
    // We'll populate the essential columns and leave others empty
    const rows = entries.map((entry) =>
      [
        entry.languageId,
        "", // Glottocode - leave empty for scraped entries
        entry.conceptId,
        entry.wordForm,
        entry.ipa ?? "", // rawIPA
        entry.ipa ?? "", // IPA
        "", // ASJP - leave empty
        "", // List - leave empty
        "", // Dolgo - leave empty
        "scraped", // Next_Step - mark as scraped
      ].join("\t")
    );

    const content = rows.join("\n") + "\n";

    await fs.promises.appendFile(filePath, content, "utf8");
    console.log(`Appended ${entries.length} word entries to central ${filePath}`);
  }

  /**
   * Get already scraped concept IDs for a specific language from central words.tsv
   */
  async getScrapedConceptIdsForLanguage(
    languageId: string,
    filePath: string = "data/source/lexicons/words.tsv"
  ): Promise<Set<string>> {
    const scrapedIds = new Set<string>();

    if (!fs.existsSync(filePath)) {
      return scrapedIds;
    }

    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");

      // Parse header to find column indices
      if (lines.length === 0) return scrapedIds;
      
      const header = lines[0].split("\t");
      const langIdIdx = header.indexOf("Language_ID");
      const conceptIdIdx = header.indexOf("Concept_ID");

      if (langIdIdx === -1 || conceptIdIdx === -1) {
        console.warn("Could not find Language_ID or Concept_ID columns in words.tsv");
        return scrapedIds;
      }

      // Skip header and find matching language entries
      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split("\t");
        if (columns[langIdIdx] === languageId && columns[conceptIdIdx]) {
          scrapedIds.add(columns[conceptIdIdx]);
        }
      }

      console.log(`Found ${scrapedIds.size} already scraped concepts for ${languageId} in ${filePath}`);
      return scrapedIds;
    } catch (error) {
      console.error(`Error reading scraped concept IDs from ${filePath}:`, error);
      return scrapedIds;
    }
  }
  async writeTradeGoodsTSV(goods: TradeGood[], filePath: string): Promise<void> {
    const headers = [
      "id", "name", "category", "origin_region", "origin_coordinates",
      "trade_routes", "time_period", "economic_significance", "associated_languages",
    ];

    const rows = goods.map((good) => [
      good.id,
      good.name,
      good.category,
      good.originRegion,
      JSON.stringify(good.originCoordinates),
      JSON.stringify(good.tradeRoutes),
      good.timePeriod,
      good.economicSignificance,
      JSON.stringify(good.associatedLanguages),
    ]);

    await this.writeTSV(filePath, headers, rows);
  }

  async writeTradeRoutesTSV(routes: TradeRoute[], filePath: string): Promise<void> {
    const headers = [
      "id", "name", "route_type", "waypoints", "start_date", "end_date",
      "traded_goods", "key_cities", "controlling_powers", "associated_languages",
      "description", "economic_impact",
    ];

    const rows = routes.map((route) => [
      route.id,
      route.name,
      route.routeType,
      JSON.stringify(route.waypoints),
      route.startDate,
      route.endDate,
      JSON.stringify(route.tradedGoods),
      JSON.stringify(route.keyCities),
      JSON.stringify(route.controllingPowers),
      JSON.stringify(route.associatedLanguages),
      route.description,
      route.economicImpact,
    ]);

    await this.writeTSV(filePath, headers, rows);
  }

  /**
   * Write music traditions to TSV file with atomic operation
   */
  async writeMusicTraditionsTSV(
    traditions: Array<{
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
    }>,
    filePath: string
  ): Promise<void> {
    const headers = [
      "id", "name", "native_name", "region", "coordinates",
      "time_origin", "time_end", "associated_language_ids", "instruments",
      "scales", "rhythmic_patterns", "related_traditions", "description", "sources",
    ];

    const rows = traditions.map((t) => [
      t.id,
      t.name,
      t.nativeName,
      t.region,
      JSON.stringify(t.coordinates),
      t.timeOrigin?.toString() ?? "null",
      t.timeEnd?.toString() ?? "null",
      JSON.stringify(t.associatedLanguageIds),
      JSON.stringify(t.instruments),
      JSON.stringify(t.scales),
      JSON.stringify(t.rhythmicPatterns),
      JSON.stringify(t.relatedTraditions),
      t.description,
      JSON.stringify(t.sources),
    ]);

    await this.writeTSV(filePath, headers, rows);
  }

  /**
   * Write musical instruments to TSV file with atomic operation
   */
  async writeMusicalInstrumentsTSV(
    instruments: Array<{
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
    }>,
    filePath: string
  ): Promise<void> {
    const headers = [
      "id", "name", "native_name", "instrument_family", "origin_region",
      "coordinates", "time_origin", "construction_materials", "playing_technique",
      "associated_tradition_ids", "associated_language_ids", "description", "sources",
    ];

    const rows = instruments.map((i) => [
      i.id,
      i.name,
      i.nativeName,
      i.instrumentFamily,
      i.originRegion,
      JSON.stringify(i.coordinates),
      i.timeOrigin?.toString() ?? "null",
      JSON.stringify(i.constructionMaterials),
      i.playingTechnique,
      JSON.stringify(i.associatedTraditionIds),
      JSON.stringify(i.associatedLanguageIds),
      i.description,
      JSON.stringify(i.sources),
    ]);

    await this.writeTSV(filePath, headers, rows);
  }
}

export const tsvWriter = new TsvWriter();
