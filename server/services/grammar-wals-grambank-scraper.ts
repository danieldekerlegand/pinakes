import fs from "node:fs";
import fetch from "node-fetch";
import { jobStore } from "./job-store";

const WALS_BASE_URL =
  "https://raw.githubusercontent.com/cldf-datasets/wals/master/cldf";
const GRAMBANK_BASE_URL =
  "https://raw.githubusercontent.com/grambank/grambank/master/cldf";
const OUTPUT_PATH = "lexicons/grammar-features-wals-grambank.tsv";

const TSV_HEADERS = [
  "id",
  "language_id",
  "source",
  "feature_id",
  "feature_name",
  "feature_area",
  "value_id",
  "value_name",
  "iso639_3",
  "glottocode",
];

// WALS chapter ranges → area names
const WALS_AREA_RANGES: Array<[number, number, string]> = [
  [1, 19, "Phonology"],
  [20, 29, "Morphology"],
  [30, 57, "Nominal Categories"],
  [58, 64, "Verbal Categories"],
  [65, 97, "Word Order"],
  [98, 121, "Simple Clauses"],
  [122, 128, "Complex Sentences"],
  [129, 138, "Lexicon"],
  [139, 144, "Sign Languages"],
];

export interface FeatureRow {
  id: string;
  language_id: string;
  source: "wals" | "grambank";
  feature_id: string;
  feature_name: string;
  feature_area: string;
  value_id: string;
  value_name: string;
  iso639_3: string;
  glottocode: string;
}

interface ScrapingProgress {
  type: "progress" | "completed" | "error";
  message: string;
  completed?: number;
  total?: number;
}

export interface GrammarScrapingOptions {
  sources?: Array<"wals" | "grambank">;
  languageIds?: string[];
  jobId?: string;
  progressCallback?: (progress: ScrapingProgress) => void;
}

export interface GrammarScrapingResult {
  totalFeatures: number;
  walsFeatures: number;
  grambankFeatures: number;
  languagesMatched: number;
  outputPath: string;
}

/** Parse a CSV string handling quoted fields */
export function parseCSV(content: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = content.split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else if (char !== "\r") {
        current += char;
      }
    }
    fields.push(current);
    return fields;
  };

  // Find header line (first non-empty line)
  let headerIdx = 0;
  while (headerIdx < lines.length && !lines[headerIdx].trim()) headerIdx++;
  if (headerIdx >= lines.length) return { headers: [], rows: [] };

  const headers = parseLine(lines[headerIdx]);
  const rows: string[][] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    rows.push(parseLine(lines[i]));
  }

  return { headers, rows };
}

/** Get WALS area name from chapter number */
export function getWalsArea(chapterId: string): string {
  const num = parseInt(chapterId);
  if (isNaN(num)) return "Other";
  for (const [min, max, area] of WALS_AREA_RANGES) {
    if (num >= min && num <= max) return area;
  }
  return "Other";
}

/**
 * Grammar feature scraper that fetches typological data from
 * WALS (World Atlas of Language Structures) and Grambank CLDF datasets.
 */
export class GrammarWalsGrambankScraper {
  private static isScraping = false;

  /** Build mapping from ISO 639-3 / internal IDs to our language IDs */
  private async buildLanguageIdSet(): Promise<Set<string>> {
    const ids = new Set<string>();
    const langFile = "lexicons/languages.tsv";
    if (!fs.existsSync(langFile)) return ids;

    const content = await fs.promises.readFile(langFile, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return ids;

    const headers = lines[0].split("\t");
    const idIdx = headers.indexOf("id");
    const iso1Idx = headers.indexOf("iso639_1");
    const iso2Idx = headers.indexOf("iso639_2");

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      const langId = cols[idIdx];
      if (langId) {
        ids.add(langId);
        if (cols[iso1Idx]) ids.add(cols[iso1Idx]);
        if (cols[iso2Idx]) ids.add(cols[iso2Idx]);
      }
    }
    return ids;
  }

  /** Fetch and parse a CSV file from a URL */
  private async fetchCSV(
    url: string
  ): Promise<{ headers: string[]; rows: string[][] }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`
      );
    }
    const content = await response.text();
    return parseCSV(content);
  }

  /** Read existing feature IDs to support resumability */
  private readExistingFeatureKeys(): Set<string> {
    const keys = new Set<string>();
    if (!fs.existsSync(OUTPUT_PATH)) return keys;

    const content = fs.readFileSync(OUTPUT_PATH, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    // Skip header; key = source + ":" + language_id + ":" + feature_id
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols.length >= 4) {
        keys.add(`${cols[2]}:${cols[1]}:${cols[3]}`);
      }
    }
    return keys;
  }

  /** Fetch WALS data */
  async fetchWalsData(
    languageFilter: Set<string> | null,
    progressCallback?: (p: ScrapingProgress) => void
  ): Promise<FeatureRow[]> {
    progressCallback?.({
      type: "progress",
      message: "Fetching WALS languages...",
    });

    // Fetch language mapping: WALS ID → ISO/Glottocode
    const langData = await this.fetchCSV(`${WALS_BASE_URL}/languages.csv`);
    const langHeaders = langData.headers;
    const lIdIdx = langHeaders.indexOf("ID");
    const lIsoIdx = langHeaders.indexOf("ISO639P3code");
    const lGlottoIdx = langHeaders.indexOf("Glottocode");

    const walsLangMap = new Map<
      string,
      { iso: string; glottocode: string }
    >();
    for (const row of langData.rows) {
      const walsId = row[lIdIdx];
      if (walsId)
        walsLangMap.set(walsId, {
          iso: row[lIsoIdx] || "",
          glottocode: row[lGlottoIdx] || "",
        });
    }

    progressCallback?.({
      type: "progress",
      message: `Loaded ${walsLangMap.size} WALS languages`,
    });

    // Fetch parameters (feature definitions)
    const paramData = await this.fetchCSV(`${WALS_BASE_URL}/parameters.csv`);
    const pIdIdx = paramData.headers.indexOf("ID");
    const pNameIdx = paramData.headers.indexOf("Name");
    const pChapterIdx = paramData.headers.indexOf("Chapter_ID");

    const paramMap = new Map<string, { name: string; chapter: string }>();
    for (const row of paramData.rows) {
      paramMap.set(row[pIdIdx], {
        name: row[pNameIdx] || "",
        chapter: row[pChapterIdx] || "",
      });
    }

    // Fetch codes (value labels)
    const codeMap = new Map<string, string>();
    try {
      const codeData = await this.fetchCSV(`${WALS_BASE_URL}/codes.csv`);
      const cIdIdx = codeData.headers.indexOf("ID");
      const cNameIdx = codeData.headers.indexOf("Name");
      for (const row of codeData.rows) {
        codeMap.set(row[cIdIdx], row[cNameIdx] || "");
      }
    } catch {
      // codes.csv may not be available, fall back to raw values
    }

    progressCallback?.({
      type: "progress",
      message: "Fetching WALS values...",
    });

    // Fetch values
    const valData = await this.fetchCSV(`${WALS_BASE_URL}/values.csv`);
    const vIdIdx = valData.headers.indexOf("ID");
    const vLangIdx = valData.headers.indexOf("Language_ID");
    const vParamIdx = valData.headers.indexOf("Parameter_ID");
    const vValueIdx = valData.headers.indexOf("Value");
    const vCodeIdx = valData.headers.indexOf("Code_ID");

    const features: FeatureRow[] = [];
    let counter = 0;

    for (const row of valData.rows) {
      const walsLangId = row[vLangIdx];
      const langInfo = walsLangMap.get(walsLangId);
      if (!langInfo) continue;

      const iso = langInfo.iso;
      // Filter by our known languages if filter provided
      if (
        languageFilter &&
        !languageFilter.has(iso) &&
        !languageFilter.has(walsLangId)
      )
        continue;

      const paramId = row[vParamIdx];
      const param = paramMap.get(paramId);
      const codeId = row[vCodeIdx] || "";
      const valueName = codeMap.get(codeId) || row[vValueIdx] || "";
      const area = getWalsArea(param?.chapter || "");

      counter++;
      features.push({
        id: `wgf_w${counter}`,
        language_id: iso || walsLangId,
        source: "wals",
        feature_id: paramId,
        feature_name: param?.name || paramId,
        feature_area: area,
        value_id: codeId,
        value_name: valueName,
        iso639_3: iso,
        glottocode: langInfo.glottocode,
      });
    }

    progressCallback?.({
      type: "progress",
      message: `Processed ${features.length} WALS features`,
    });

    return features;
  }

  /** Fetch Grambank data */
  async fetchGrambankData(
    languageFilter: Set<string> | null,
    progressCallback?: (p: ScrapingProgress) => void
  ): Promise<FeatureRow[]> {
    progressCallback?.({
      type: "progress",
      message: "Fetching Grambank languages...",
    });

    // Fetch language mapping: Glottocode → ISO
    const langData = await this.fetchCSV(
      `${GRAMBANK_BASE_URL}/languages.csv`
    );
    const lIdIdx = langData.headers.indexOf("ID");
    const lIsoIdx = langData.headers.indexOf("ISO639P3code");

    const gbLangMap = new Map<string, { iso: string }>();
    for (const row of langData.rows) {
      const glottocode = row[lIdIdx];
      if (glottocode)
        gbLangMap.set(glottocode, { iso: row[lIsoIdx] || "" });
    }

    progressCallback?.({
      type: "progress",
      message: `Loaded ${gbLangMap.size} Grambank languages`,
    });

    // Fetch parameters
    const paramData = await this.fetchCSV(
      `${GRAMBANK_BASE_URL}/parameters.csv`
    );
    const pIdIdx = paramData.headers.indexOf("ID");
    const pNameIdx = paramData.headers.indexOf("Name");

    const paramMap = new Map<string, string>();
    for (const row of paramData.rows) {
      paramMap.set(row[pIdIdx], row[pNameIdx] || "");
    }

    // Fetch codes (value labels)
    const codeMap = new Map<string, string>();
    try {
      const codeData = await this.fetchCSV(`${GRAMBANK_BASE_URL}/codes.csv`);
      const cIdIdx = codeData.headers.indexOf("ID");
      const cDescIdx = codeData.headers.indexOf("Description");
      const cNameIdx = codeData.headers.indexOf("Name");
      for (const row of codeData.rows) {
        codeMap.set(row[cIdIdx], row[cDescIdx] || row[cNameIdx] || "");
      }
    } catch {
      // Fall back to raw values
    }

    progressCallback?.({
      type: "progress",
      message: "Fetching Grambank values (this may take a moment)...",
    });

    // Fetch values
    const valData = await this.fetchCSV(`${GRAMBANK_BASE_URL}/values.csv`);
    const vLangIdx = valData.headers.indexOf("Language_ID");
    const vParamIdx = valData.headers.indexOf("Parameter_ID");
    const vValueIdx = valData.headers.indexOf("Value");
    const vCodeIdx = valData.headers.indexOf("Code_ID");

    const features: FeatureRow[] = [];
    let counter = 0;

    for (const row of valData.rows) {
      const glottocode = row[vLangIdx];
      const langInfo = gbLangMap.get(glottocode);
      if (!langInfo) continue;

      const iso = langInfo.iso;
      if (languageFilter && !languageFilter.has(iso) && !languageFilter.has(glottocode))
        continue;

      const paramId = row[vParamIdx];
      const codeId = row[vCodeIdx] || "";
      const valueName = codeMap.get(codeId) || row[vValueIdx] || "";

      counter++;
      features.push({
        id: `wgf_g${counter}`,
        language_id: iso || glottocode,
        source: "grambank",
        feature_id: paramId,
        feature_name: paramMap.get(paramId) || paramId,
        feature_area: "Grammar",
        value_id: codeId,
        value_name: valueName,
        iso639_3: iso,
        glottocode: glottocode,
      });
    }

    progressCallback?.({
      type: "progress",
      message: `Processed ${features.length} Grambank features`,
    });

    return features;
  }

  /** Write features to TSV with atomic write */
  async writeFeatures(features: FeatureRow[]): Promise<void> {
    const headerLine = TSV_HEADERS.join("\t");
    const dataLines = features.map((f) =>
      [
        f.id,
        f.language_id,
        f.source,
        f.feature_id,
        f.feature_name,
        f.feature_area,
        f.value_id,
        f.value_name,
        f.iso639_3,
        f.glottocode,
      ].join("\t")
    );

    const content = [headerLine, ...dataLines].join("\n") + "\n";
    const tempFile = `${OUTPUT_PATH}.tmp`;

    try {
      await fs.promises.writeFile(tempFile, content, "utf8");
      await fs.promises.rename(tempFile, OUTPUT_PATH);
      console.log(
        `Wrote ${features.length} grammar features to ${OUTPUT_PATH}`
      );
    } catch (error) {
      try {
        await fs.promises.unlink(tempFile);
      } catch {
        // ignore cleanup error
      }
      throw error;
    }
  }

  /** Main scrape method */
  async scrape(
    options: GrammarScrapingOptions = {}
  ): Promise<GrammarScrapingResult> {
    const {
      sources = ["wals", "grambank"],
      languageIds,
      jobId,
      progressCallback,
    } = options;

    if (GrammarWalsGrambankScraper.isScraping) {
      throw new Error(
        "A grammar WALS/Grambank scraping job is already in progress"
      );
    }

    GrammarWalsGrambankScraper.isScraping = true;

    if (jobId) {
      jobStore.updateJob(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });
    }

    try {
      // Build language filter from our known languages
      let languageFilter: Set<string> | null = null;
      if (languageIds && languageIds.length > 0) {
        languageFilter = new Set(languageIds);
      } else {
        // Use our known language IDs as filter
        languageFilter = await this.buildLanguageIdSet();
      }

      // Read existing data for resumability
      const existingKeys = this.readExistingFeatureKeys();
      const allFeatures: FeatureRow[] = [];
      let walsCount = 0;
      let grambankCount = 0;

      // Fetch WALS data
      if (sources.includes("wals")) {
        progressCallback?.({
          type: "progress",
          message: "Starting WALS data fetch...",
        });
        try {
          const walsFeatures = await this.fetchWalsData(
            languageFilter,
            progressCallback
          );
          // Filter out already-existing entries
          const newWals = walsFeatures.filter(
            (f) =>
              !existingKeys.has(`${f.source}:${f.language_id}:${f.feature_id}`)
          );
          allFeatures.push(...newWals);
          walsCount = newWals.length;
          progressCallback?.({
            type: "progress",
            message: `WALS: ${newWals.length} new features (${walsFeatures.length - newWals.length} already existed)`,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Unknown error";
          progressCallback?.({
            type: "error",
            message: `WALS fetch failed: ${msg}`,
          });
          console.error("WALS fetch error:", msg);
        }
      }

      // Fetch Grambank data
      if (sources.includes("grambank")) {
        progressCallback?.({
          type: "progress",
          message: "Starting Grambank data fetch...",
        });
        try {
          const grambankFeatures = await this.fetchGrambankData(
            languageFilter,
            progressCallback
          );
          const newGrambank = grambankFeatures.filter(
            (f) =>
              !existingKeys.has(`${f.source}:${f.language_id}:${f.feature_id}`)
          );
          allFeatures.push(...newGrambank);
          grambankCount = newGrambank.length;
          progressCallback?.({
            type: "progress",
            message: `Grambank: ${newGrambank.length} new features (${grambankFeatures.length - newGrambank.length} already existed)`,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Unknown error";
          progressCallback?.({
            type: "error",
            message: `Grambank fetch failed: ${msg}`,
          });
          console.error("Grambank fetch error:", msg);
        }
      }

      // If we have existing data, merge with new
      if (existingKeys.size > 0 && allFeatures.length > 0) {
        // Read existing rows and append new ones
        const existingContent = fs.readFileSync(OUTPUT_PATH, "utf8");
        const existingLines = existingContent.split("\n").filter((l) => l.trim());
        const existingDataLines = existingLines.slice(1); // Skip header

        // Re-number new features starting after existing count
        let nextId = existingDataLines.length;
        for (const f of allFeatures) {
          nextId++;
          f.id = `wgf_${f.source === "wals" ? "w" : "g"}${nextId}`;
        }

        // Parse existing features
        const existingFeatures: FeatureRow[] = existingDataLines.map((line) => {
          const cols = line.split("\t");
          return {
            id: cols[0],
            language_id: cols[1],
            source: cols[2] as "wals" | "grambank",
            feature_id: cols[3],
            feature_name: cols[4],
            feature_area: cols[5],
            value_id: cols[6],
            value_name: cols[7],
            iso639_3: cols[8],
            glottocode: cols[9],
          };
        });

        await this.writeFeatures([...existingFeatures, ...allFeatures]);
      } else if (allFeatures.length > 0) {
        await this.writeFeatures(allFeatures);
      }

      const languagesMatched = new Set(
        allFeatures.map((f) => f.language_id)
      ).size;

      const result: GrammarScrapingResult = {
        totalFeatures: allFeatures.length,
        walsFeatures: walsCount,
        grambankFeatures: grambankCount,
        languagesMatched,
        outputPath: OUTPUT_PATH,
      };

      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "completed",
          completedAt: new Date().toISOString(),
        });
      }

      progressCallback?.({
        type: "completed",
        message: `Scraped ${allFeatures.length} grammar features for ${languagesMatched} languages`,
      });

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "failed",
          errorMessage: msg,
          completedAt: new Date().toISOString(),
        });
      }
      progressCallback?.({
        type: "error",
        message: `Scraping failed: ${msg}`,
      });
      throw error;
    } finally {
      GrammarWalsGrambankScraper.isScraping = false;
    }
  }
}

export const grammarWalsGrambankScraper = new GrammarWalsGrambankScraper();
