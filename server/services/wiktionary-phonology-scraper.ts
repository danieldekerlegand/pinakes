import fetch from "node-fetch";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "./job-store";
import type { Language } from "@contracts/types";

/**
 * Maps language names to their Wiktionary language codes and appendix page names.
 * Wiktionary stores phonology data in appendix pages like "Appendix:Spanish_pronunciation".
 */
const LANGUAGE_WIKI_MAP: Record<string, { wikiLang: string; pageName: string }> = {
  eng: { wikiLang: "en", pageName: "English" },
  deu: { wikiLang: "en", pageName: "German" },
  fra: { wikiLang: "en", pageName: "French" },
  spa: { wikiLang: "en", pageName: "Spanish" },
  ita: { wikiLang: "en", pageName: "Italian" },
  por: { wikiLang: "en", pageName: "Portuguese" },
  rus: { wikiLang: "en", pageName: "Russian" },
  jpn: { wikiLang: "en", pageName: "Japanese" },
  zho: { wikiLang: "en", pageName: "Mandarin" },
  kor: { wikiLang: "en", pageName: "Korean" },
  ara: { wikiLang: "en", pageName: "Arabic" },
  hin: { wikiLang: "en", pageName: "Hindi" },
  tur: { wikiLang: "en", pageName: "Turkish" },
  pol: { wikiLang: "en", pageName: "Polish" },
  nld: { wikiLang: "en", pageName: "Dutch" },
  swe: { wikiLang: "en", pageName: "Swedish" },
  nor: { wikiLang: "en", pageName: "Norwegian" },
  dan: { wikiLang: "en", pageName: "Danish" },
  fin: { wikiLang: "en", pageName: "Finnish" },
  hun: { wikiLang: "en", pageName: "Hungarian" },
  ces: { wikiLang: "en", pageName: "Czech" },
  ell: { wikiLang: "en", pageName: "Greek" },
  heb: { wikiLang: "en", pageName: "Hebrew" },
  tha: { wikiLang: "en", pageName: "Thai" },
  vie: { wikiLang: "en", pageName: "Vietnamese" },
  ind: { wikiLang: "en", pageName: "Indonesian" },
  msa: { wikiLang: "en", pageName: "Malay" },
  tgl: { wikiLang: "en", pageName: "Tagalog" },
  swa: { wikiLang: "en", pageName: "Swahili" },
  ukr: { wikiLang: "en", pageName: "Ukrainian" },
  ron: { wikiLang: "en", pageName: "Romanian" },
  cat: { wikiLang: "en", pageName: "Catalan" },
  hrv: { wikiLang: "en", pageName: "Serbo-Croatian" },
  slk: { wikiLang: "en", pageName: "Slovak" },
  bul: { wikiLang: "en", pageName: "Bulgarian" },
  lit: { wikiLang: "en", pageName: "Lithuanian" },
  lav: { wikiLang: "en", pageName: "Latvian" },
  est: { wikiLang: "en", pageName: "Estonian" },
  kat: { wikiLang: "en", pageName: "Georgian" },
  hye: { wikiLang: "en", pageName: "Armenian" },
  urd: { wikiLang: "en", pageName: "Urdu" },
  fas: { wikiLang: "en", pageName: "Persian" },
  ben: { wikiLang: "en", pageName: "Bengali" },
  tam: { wikiLang: "en", pageName: "Tamil" },
  tel: { wikiLang: "en", pageName: "Telugu" },
  mar: { wikiLang: "en", pageName: "Marathi" },
  guj: { wikiLang: "en", pageName: "Gujarati" },
  kan: { wikiLang: "en", pageName: "Kannada" },
  mal: { wikiLang: "en", pageName: "Malayalam" },
  pan: { wikiLang: "en", pageName: "Punjabi" },
};

/** IPA consonant symbols used for identification */
const IPA_CONSONANTS = new Set([
  "p", "b", "t", "d", "ʈ", "ɖ", "c", "ɟ", "k", "ɡ", "q", "ɢ", "ʔ",
  "m", "ɱ", "n", "ɳ", "ɲ", "ŋ", "ɴ",
  "ʙ", "r", "ʀ",
  "ⱱ", "ɾ", "ɽ",
  "ɸ", "β", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "ʂ", "ʐ", "ç", "ʝ",
  "x", "ɣ", "χ", "ʁ", "ħ", "ʕ", "h", "ɦ",
  "ɬ", "ɮ",
  "ʋ", "ɹ", "ɻ", "j", "ɰ", "w",
  "l", "ɭ", "ʎ", "ʟ",
  "tʃ", "dʒ", "ts", "dz", "tɕ", "dʑ", "pf",
]);

/** IPA vowel symbols used for identification */
const IPA_VOWELS = new Set([
  "i", "y", "ɨ", "ʉ", "ɯ", "u",
  "ɪ", "ʏ", "ʊ",
  "e", "ø", "ɘ", "ɵ", "ɤ", "o",
  "ə",
  "ɛ", "œ", "ɜ", "ɞ", "ʌ", "ɔ",
  "æ", "ɐ",
  "a", "ɶ", "ɑ", "ɒ",
]);

export interface WiktionaryPhonologyResult {
  languageId: string;
  languageName: string;
  consonants: string[];
  vowels: string[];
  tones: string[] | null;
  syllableStructure: string;
  stressSystem: string;
  source: string;
}

export interface WiktionaryScrapeOptions {
  languages: Language[];
  jobId?: string;
  progressCallback?: (type: string, message: string, data?: any) => void;
}

/**
 * Scrapes phonological inventory data from Wiktionary appendix pages.
 * Uses the MediaWiki API to fetch page content and parses wikitext
 * to extract consonant/vowel inventories, tones, and syllable structure.
 */
class WiktionaryPhonologyScraper {
  private static isScraping = false;
  private readonly filePath = "data/source/lexicons/phonological-inventories.tsv";
  private readonly headers = [
    "id",
    "language_id",
    "consonants",
    "vowels",
    "tones",
    "phonotactic_patterns",
    "syllable_structure",
    "stress_system",
  ];

  private requestCache = new Map<string, string>();
  private lastRequestTime = 0;
  private readonly minRequestInterval = 1000; // 1 second between requests per Wiktionary policy

  /**
   * Fetch a Wiktionary page via the MediaWiki API with rate limiting and caching.
   */
  async fetchWiktionaryPage(pageName: string, wikiLang = "en"): Promise<string | null> {
    const cacheKey = `${wikiLang}:${pageName}`;
    if (this.requestCache.has(cacheKey)) {
      return this.requestCache.get(cacheKey)!;
    }

    // Rate limiting
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise((resolve) => setTimeout(resolve, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();

    const url = `https://${wikiLang}.wiktionary.org/w/api.php`;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      titles: pageName,
      origin: "*",
    });

    try {
      const response = await fetch(`${url}?${params}`);
      if (!response.ok) {
        console.warn(`Wiktionary API returned ${response.status} for ${pageName}`);
        return null;
      }

      const data = (await response.json()) as any;
      const pages = data.query?.pages;
      if (!pages) return null;

      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];

      if (page.missing !== undefined) {
        return null;
      }

      const content = page.revisions?.[0]?.slots?.main?.["*"] ?? null;
      if (content) {
        this.requestCache.set(cacheKey, content);
      }
      return content;
    } catch (error) {
      console.error(`Failed to fetch Wiktionary page ${pageName}:`, error);
      return null;
    }
  }

  /**
   * Extract IPA symbols from wikitext content.
   * Looks for IPA templates and plain IPA notation.
   */
  extractIPASymbols(content: string): string[] {
    const symbols: Set<string> = new Set();

    // Match {{IPA|...}} templates
    const ipaTemplateRegex = /\{\{IPA\|[^|]*\|([^}]+)\}\}/g;
    let match;
    while ((match = ipaTemplateRegex.exec(content)) !== null) {
      this.parseIPAString(match[1], symbols);
    }

    // Match /.../ IPA transcriptions
    const slashRegex = /\/([^/]{1,80})\/(?!\w)/g;
    while ((match = slashRegex.exec(content)) !== null) {
      this.parseIPAString(match[1], symbols);
    }

    // Match [...] phonetic transcriptions
    const bracketRegex = /\[([^\]]{1,80})\]/g;
    while ((match = bracketRegex.exec(content)) !== null) {
      const text = match[1];
      // Filter out non-IPA bracket content (wiki markup, references, categories, etc.)
      // Real IPA transcriptions contain IPA-specific characters (not just basic ASCII)
      if (!/[=|{}#A-Z ]/.test(text) && /[ɐ-ʯːˈˌ̤̰̃ʰ]/.test(text)) {
        this.parseIPAString(text, symbols);
      }
    }

    return Array.from(symbols);
  }

  /**
   * Parse an IPA string and add individual symbols to the set.
   */
  private parseIPAString(ipa: string, symbols: Set<string>): void {
    // Common IPA digraphs/affricates to check first
    const digraphs = ["tʃ", "dʒ", "ts", "dz", "tɕ", "dʑ", "pf", "iː", "eː", "aː", "oː", "uː", "yː", "øː", "ɛː", "ɔː", "ɜː", "ɑː"];

    let remaining = ipa.replace(/[ˈˌ.ː‿]/g, (m) => m === "ː" ? "ː" : ""); // Keep length mark, remove stress marks

    for (const digraph of digraphs) {
      if (remaining.includes(digraph)) {
        symbols.add(digraph);
        remaining = remaining.split(digraph).join(" ");
      }
    }

    // Process remaining characters
    for (const char of remaining) {
      if (char.trim() && IPA_CONSONANTS.has(char) || IPA_VOWELS.has(char)) {
        symbols.add(char);
      }
    }
  }

  /**
   * Classify extracted IPA symbols into consonants and vowels.
   */
  classifySymbols(symbols: string[]): { consonants: string[]; vowels: string[] } {
    const consonants: string[] = [];
    const vowels: string[] = [];

    for (const symbol of symbols) {
      // Check digraphs first
      if (IPA_CONSONANTS.has(symbol)) {
        consonants.push(symbol);
      } else if (IPA_VOWELS.has(symbol)) {
        vowels.push(symbol);
      } else if (symbol.endsWith("ː")) {
        // Long vowel
        const base = symbol.replace("ː", "");
        if (IPA_VOWELS.has(base)) {
          vowels.push(symbol);
        }
      } else if (symbol.includes("̃") || symbol.includes("̤") || symbol.includes("̰")) {
        // Nasalized or modified vowel
        const base = symbol[0];
        if (IPA_VOWELS.has(base)) {
          vowels.push(symbol);
        }
      }
    }

    return { consonants, vowels };
  }

  /**
   * Detect tone information from wikitext.
   */
  detectTones(content: string): string[] | null {
    const tonePatterns = [
      /tones?\s*[:=]\s*([^\n]+)/i,
      /tonal\s+system\s*[:=]?\s*([^\n]+)/i,
      /(\d+)\s+tones/i,
    ];

    for (const pattern of tonePatterns) {
      const match = content.match(pattern);
      if (match) {
        const toneText = match[1].toLowerCase();
        const tones: string[] = [];

        if (toneText.includes("high")) tones.push("high");
        if (toneText.includes("mid")) tones.push("mid");
        if (toneText.includes("low")) tones.push("low");
        if (toneText.includes("rising")) tones.push("rising");
        if (toneText.includes("falling")) tones.push("falling");
        if (toneText.includes("level")) tones.push("level");

        if (tones.length > 0) return tones;

        // Try to parse numbered tones (e.g., "6 tones")
        const numMatch = toneText.match(/(\d+)/);
        if (numMatch) {
          const count = parseInt(numMatch[1]);
          if (count >= 2 && count <= 9) {
            return Array.from({ length: count }, (_, i) => `tone${i + 1}`);
          }
        }
      }
    }

    // Check for known tonal language markers, but skip negations
    const tonalKeywords = ["tone", "tonal", "toneme", "pitch accent"];
    const negationPatterns = [/\bno\b.{0,20}\btone/i, /\bnon[- ]?tonal/i, /\bnot\b.{0,20}\btonal/i, /\bwithout\b.{0,20}\btone/i, /\blacks?\b.{0,20}\btone/i];
    const lowerContent = content.toLowerCase();

    // If there's a clear negation, this is not a tonal language
    for (const negPat of negationPatterns) {
      if (negPat.test(content)) {
        return null;
      }
    }

    for (const keyword of tonalKeywords) {
      if (lowerContent.includes(keyword)) {
        return ["unspecified"];
      }
    }

    return null;
  }

  /**
   * Extract syllable structure information from wikitext.
   */
  detectSyllableStructure(content: string): string {
    // Look for explicit syllable structure patterns
    const patterns = [
      /syllable\s+structure\s*[:=]?\s*\(?([CV()]+)\)?/i,
      /phonotactics?[^.]*\(?([CV()]+)\)?/i,
      /\(C\)(?:\(C\))*V(?:\(C\))*/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const structure = match[1] || match[0];
        if (/^[CV()]+$/.test(structure)) {
          return structure;
        }
      }
    }

    return "";
  }

  /**
   * Extract stress system information from wikitext.
   */
  detectStressSystem(content: string): string {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes("fixed stress") || lowerContent.includes("stress is fixed")) {
      if (lowerContent.includes("initial") || lowerContent.includes("first syllable")) {
        return "fixed, initial";
      }
      if (lowerContent.includes("penultimate") || lowerContent.includes("second-to-last")) {
        return "fixed, penultimate";
      }
      if (lowerContent.includes("final") || lowerContent.includes("last syllable")) {
        return "fixed, final";
      }
      return "fixed";
    }

    if (lowerContent.includes("lexical stress") || lowerContent.includes("free stress")) {
      return "variable, lexical";
    }

    if (lowerContent.includes("pitch accent") || lowerContent.includes("pitch-accent")) {
      return "pitch-accent";
    }

    if (lowerContent.includes("stress")) {
      if (lowerContent.includes("initial")) return "initial";
      if (lowerContent.includes("penultimate")) return "penultimate";
      if (lowerContent.includes("final")) return "final";
      if (lowerContent.includes("variable") || lowerContent.includes("free")) return "variable, lexical";
    }

    return "";
  }

  /**
   * Scrape phonological inventory for a single language from Wiktionary.
   */
  async scrapeLanguagePhonology(language: Language): Promise<WiktionaryPhonologyResult | null> {
    const langMapping = LANGUAGE_WIKI_MAP[language.id];
    const langName = langMapping?.pageName || language.name;
    const wikiLang = langMapping?.wikiLang || "en";

    // Try multiple page name patterns
    const pageNames = [
      `Appendix:${langName}_pronunciation`,
      `Appendix:${langName}_phonology`,
      `${langName}`,
    ];

    let content: string | null = null;
    let sourcePage = "";

    for (const pageName of pageNames) {
      content = await this.fetchWiktionaryPage(pageName, wikiLang);
      if (content) {
        sourcePage = pageName;
        break;
      }
    }

    if (!content) {
      return null;
    }

    const symbols = this.extractIPASymbols(content);
    const { consonants, vowels } = this.classifySymbols(symbols);

    // Require a minimum number of phonemes to consider the data valid
    if (consonants.length < 3 && vowels.length < 2) {
      return null;
    }

    const tones = this.detectTones(content);
    const syllableStructure = this.detectSyllableStructure(content);
    const stressSystem = this.detectStressSystem(content);

    return {
      languageId: language.id,
      languageName: language.name,
      consonants,
      vowels,
      tones,
      syllableStructure,
      stressSystem,
      source: `Wiktionary:${sourcePage}`,
    };
  }

  /**
   * Read existing phonological inventory language IDs from TSV.
   */
  private async getExistingLanguageIds(): Promise<Set<string>> {
    const existingIds = new Set<string>();

    if (!fs.existsSync(this.filePath)) {
      return existingIds;
    }

    try {
      const content = await fs.promises.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");

      if (lines.length === 0) return existingIds;

      const header = lines[0].split("\t");
      const langIdIdx = header.indexOf("language_id");
      if (langIdIdx === -1) return existingIds;

      for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split("\t");
        if (columns[langIdIdx]) {
          existingIds.add(columns[langIdIdx]);
        }
      }

      return existingIds;
    } catch {
      return existingIds;
    }
  }

  /**
   * Read existing TSV rows (excluding header).
   */
  private async readExistingRows(): Promise<string[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    try {
      const content = await fs.promises.readFile(this.filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      return lines.slice(1);
    } catch {
      return [];
    }
  }

  /**
   * Write the full TSV file atomically.
   */
  private async writeAtomically(rows: string[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${this.filePath}.tmp`;

    try {
      const headerLine = this.headers.join("\t");
      const tsvContent = [headerLine, ...rows].join("\n") + "\n";
      await fs.promises.writeFile(tempFile, tsvContent, "utf8");
      await fs.promises.rename(tempFile, this.filePath);
    } catch (error) {
      try { await fs.promises.unlink(tempFile); } catch { /* ignore */ }
      throw error;
    }
  }

  /**
   * Convert a scrape result to a TSV row string.
   */
  private toTsvRow(result: WiktionaryPhonologyResult): string {
    const id = `phon_wikt_${result.languageId}`;
    return [
      id,
      result.languageId,
      JSON.stringify(result.consonants),
      JSON.stringify(result.vowels),
      result.tones ? JSON.stringify(result.tones) : "null",
      JSON.stringify({ source: result.source }),
      result.syllableStructure,
      result.stressSystem,
    ].join("\t");
  }

  /**
   * Scrape phonological inventories for multiple languages from Wiktionary.
   * Skips languages that already have inventories in the TSV file.
   */
  async scrapePhonologies(options: WiktionaryScrapeOptions): Promise<{ scraped: number; failed: number; skipped: number }> {
    const { languages, jobId, progressCallback } = options;

    if (WiktionaryPhonologyScraper.isScraping) {
      throw new Error("Wiktionary phonology scraping is already in progress");
    }

    WiktionaryPhonologyScraper.isScraping = true;

    try {
      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "running",
          startedAt: new Date().toISOString(),
        });
      }

      progressCallback?.("progress", "Reading existing phonological inventories...");

      const existingIds = await this.getExistingLanguageIds();
      const toScrape = languages.filter((lang) => !existingIds.has(lang.id));

      if (toScrape.length === 0) {
        progressCallback?.("completed", "All languages already have phonological inventories");
        if (jobId) {
          jobStore.updateJob(jobId, {
            status: "completed",
            completedWords: 0,
            completedAt: new Date().toISOString(),
          });
        }
        return { scraped: 0, failed: 0, skipped: languages.length };
      }

      console.log(`Scraping phonological inventories for ${toScrape.length} languages from Wiktionary`);
      progressCallback?.("progress", `Found ${toScrape.length} languages to scrape`);

      if (jobId) {
        jobStore.updateJob(jobId, { totalWords: toScrape.length });
      }

      let scraped = 0;
      let failed = 0;

      for (let i = 0; i < toScrape.length; i++) {
        const lang = toScrape[i];
        progressCallback?.("progress", `Scraping ${lang.name} (${i + 1}/${toScrape.length})...`);

        try {
          const result = await this.scrapeLanguagePhonology(lang);

          if (result) {
            const newRow = this.toTsvRow(result);
            const existingRows = await this.readExistingRows();
            await this.writeAtomically([...existingRows, newRow]);
            scraped++;
            console.log(`  Scraped phonology for ${lang.name}: ${result.consonants.length} consonants, ${result.vowels.length} vowels`);
          } else {
            failed++;
            console.log(`  No phonological data found for ${lang.name} on Wiktionary`);
          }
        } catch (error) {
          failed++;
          console.error(`  Error scraping ${lang.name}:`, error);
          progressCallback?.("error", `Failed to scrape ${lang.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }

        if (jobId) {
          jobStore.updateJob(jobId, { completedWords: scraped + failed });
        }
      }

      const skipped = languages.length - toScrape.length;

      console.log(`Wiktionary phonology scraping completed: ${scraped} scraped, ${failed} failed, ${skipped} skipped`);
      progressCallback?.("completed", `Scraping completed: ${scraped} scraped, ${failed} failed, ${skipped} skipped`);

      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "completed",
          completedWords: scraped + failed,
          completedAt: new Date().toISOString(),
        });
      }

      return { scraped, failed, skipped };
    } catch (error) {
      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          completedAt: new Date().toISOString(),
        });
      }
      throw error;
    } finally {
      WiktionaryPhonologyScraper.isScraping = false;
    }
  }
}

export const wiktionaryPhonologyScraper = new WiktionaryPhonologyScraper();
