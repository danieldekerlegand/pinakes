import fs from "node:fs";
import path from "node:path";
import type { Language, LanguageFamily } from "@shared/types";

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
   * Generic TSV writer with atomic operation (write to temp file, then rename)
   */
  private async writeTSV(
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
    filePath: string = "lexicons/words.tsv"
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
    filePath: string = "lexicons/words.tsv"
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
}

export const tsvWriter = new TsvWriter();
