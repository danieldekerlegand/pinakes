import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

export interface VerbParadigmEntry {
  id: string;
  languageId: string;
  verbConcept: string;
  infinitiveForm: string;
  conjugationTable: Record<string, Record<string, string>>;
  irregular: boolean;
  complexityScore: number;
  notes: string;
  source: string;
}

export interface ScrapingProgress {
  type: "progress" | "completed" | "error";
  message: string;
  completed?: number;
  total?: number;
  currentVerb?: string;
}

export interface VerbParadigmScrapingOptions {
  languageIds: string[];
  verbs?: string[];
  sources?: Array<"unimorph" | "wiktionary">;
  progressCallback?: (progress: ScrapingProgress) => void;
}

// UniMorph feature tag mappings for tense/mood/person/number
const UNIMORPH_PERSON: Record<string, string> = {
  "1": "1", "2": "2", "3": "3",
};

const UNIMORPH_NUMBER: Record<string, string> = {
  SG: "sg", PL: "pl", DU: "du",
};

const UNIMORPH_TENSE: Record<string, string> = {
  PRS: "present",
  PST: "past",
  FUT: "future",
  IPFV: "imperfect",
  PFV: "perfective",
  LGSPEC1: "aorist",
  LGSPEC2: "preterite",
};

const UNIMORPH_MOOD: Record<string, string> = {
  IND: "",
  SBJV: "subjunctive",
  COND: "conditional",
  IMP: "imperative",
};

// ISO 639-1/custom to UniMorph language code mapping
const LANG_TO_UNIMORPH: Record<string, string> = {
  eng: "eng", spa: "spa", fra: "fra", deu: "deu", ita: "ita",
  por: "por", rus: "rus", pol: "pol", ces: "ces", ron: "ron",
  nld: "nld", swe: "swe", fin: "fin", hun: "hun", tur: "tur",
  ell: "ell", bul: "bul", ukr: "ukr", heb: "heb", arb: "ara",
  hin: "hin", lat: "lat", san: "san", lav: "lav", lit: "lit",
  kat: "kat", hye: "hye", eus: "eus", swa: "swa", isl: "isl",
  pes: "fas", tgl: "tgl", msa: "msa",
};

// Wiktionary language code mapping
const LANG_TO_WIKTIONARY: Record<string, string> = {
  eng: "en", spa: "es", fra: "fr", deu: "de", ita: "it",
  por: "pt", rus: "ru", pol: "pl", ces: "cs", ron: "ro",
  nld: "nl", swe: "sv", fin: "fi", hun: "hu", tur: "tr",
  ell: "el", bul: "bg", ukr: "uk", heb: "he", arb: "ar",
  hin: "hi", lat: "la", san: "sa", lav: "lv", lit: "lt",
  kat: "ka", hye: "hy", eus: "eu", swa: "sw", isl: "is",
  pes: "fa", tgl: "tl", msa: "ms", jpn: "ja", kor: "ko",
  cmn: "zh", tha: "th", vie: "vi", amh: "am",
};

// Default verb concepts to scrape (matches existing data pattern)
const DEFAULT_VERBS = [
  { concept: "to eat", hints: { eng: "eat", spa: "comer", fra: "manger", deu: "essen", ita: "mangiare", por: "comer", rus: "есть", tur: "yemek" } },
  { concept: "to drink", hints: { eng: "drink", spa: "beber", fra: "boire", deu: "trinken", ita: "bere", por: "beber", rus: "пить", tur: "içmek" } },
  { concept: "to see", hints: { eng: "see", spa: "ver", fra: "voir", deu: "sehen", ita: "vedere", por: "ver", rus: "видеть", tur: "görmek" } },
  { concept: "to hear", hints: { eng: "hear", spa: "oír", fra: "entendre", deu: "hören", ita: "sentire", por: "ouvir", rus: "слышать", tur: "duymak" } },
  { concept: "to speak", hints: { eng: "speak", spa: "hablar", fra: "parler", deu: "sprechen", ita: "parlare", por: "falar", rus: "говорить", tur: "konuşmak" } },
  { concept: "to know", hints: { eng: "know", spa: "saber", fra: "savoir", deu: "wissen", ita: "sapere", por: "saber", rus: "знать", tur: "bilmek" } },
  { concept: "to come", hints: { eng: "come", spa: "venir", fra: "venir", deu: "kommen", ita: "venire", por: "vir", rus: "приходить", tur: "gelmek" } },
  { concept: "to do", hints: { eng: "do", spa: "hacer", fra: "faire", deu: "machen", ita: "fare", por: "fazer", rus: "делать", tur: "yapmak" } },
  { concept: "to have", hints: { eng: "have", spa: "tener", fra: "avoir", deu: "haben", ita: "avere", por: "ter", rus: "иметь", tur: "sahip olmak" } },
  { concept: "to want", hints: { eng: "want", spa: "querer", fra: "vouloir", deu: "wollen", ita: "volere", por: "querer", rus: "хотеть", tur: "istemek" } },
];

export class VerbParadigmScraper {
  private unimorphCache = new Map<string, UniMorphEntry[]>();
  private lastRequestTime = 0;
  private minRequestInterval = 500; // ms between requests

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise((resolve) => setTimeout(resolve, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Scrape verb paradigms for the given languages and verbs.
   * Returns new entries not already in the TSV.
   */
  async scrapeVerbParadigms(options: VerbParadigmScrapingOptions): Promise<VerbParadigmEntry[]> {
    const { languageIds, progressCallback } = options;
    const verbs = options.verbs
      ? options.verbs.map((v) => DEFAULT_VERBS.find((d) => d.concept === v) ?? { concept: v, hints: {} })
      : DEFAULT_VERBS;
    const sources = options.sources ?? ["unimorph", "wiktionary"];

    const existingIds = this.loadExistingParadigmKeys();
    const results: VerbParadigmEntry[] = [];
    const totalTasks = languageIds.length * verbs.length;
    let completed = 0;

    for (const langId of languageIds) {
      for (const verb of verbs) {
        const key = `${langId}:${verb.concept}`;
        if (existingIds.has(key)) {
          completed++;
          continue;
        }

        progressCallback?.({
          type: "progress",
          message: `Scraping ${verb.concept} for ${langId}`,
          completed,
          total: totalTasks,
          currentVerb: verb.concept,
        });

        let entry: VerbParadigmEntry | null = null;

        // Try each source in order
        for (const source of sources) {
          if (source === "unimorph") {
            entry = await this.scrapeFromUniMorph(langId, verb.concept, verb.hints[langId]);
          } else if (source === "wiktionary") {
            const infinitive = verb.hints[langId];
            if (infinitive) {
              entry = await this.scrapeFromWiktionary(langId, verb.concept, infinitive);
            }
          }
          if (entry) break;
        }

        if (entry) {
          results.push(entry);
        }

        completed++;
      }
    }

    progressCallback?.({
      type: "completed",
      message: `Scraped ${results.length} new verb paradigms`,
      completed: totalTasks,
      total: totalTasks,
    });

    return results;
  }

  /**
   * Fetch and parse UniMorph data for a language.
   * UniMorph stores inflection tables as TSV: lemma\tform\tfeatures
   */
  async scrapeFromUniMorph(
    langId: string,
    verbConcept: string,
    infinitive?: string,
  ): Promise<VerbParadigmEntry | null> {
    if (!infinitive) return null;

    const umLang = LANG_TO_UNIMORPH[langId];
    if (!umLang) return null;

    try {
      const entries = await this.fetchUniMorphData(umLang);
      if (entries.length === 0) return null;

      // Find entries matching the infinitive lemma
      const verbEntries = entries.filter(
        (e) => e.lemma.toLowerCase() === infinitive.toLowerCase() && e.features.includes("V"),
      );

      if (verbEntries.length === 0) return null;

      const conjugationTable = this.buildConjugationTable(verbEntries);
      if (Object.keys(conjugationTable).length === 0) return null;

      const totalForms = Object.values(conjugationTable).reduce(
        (sum, tense) => sum + Object.keys(tense).length, 0,
      );

      const isIrregular = this.detectIrregularity(infinitive, verbEntries);

      return {
        id: "", // assigned during write
        languageId: langId,
        verbConcept,
        infinitiveForm: infinitive,
        conjugationTable,
        irregular: isIrregular,
        complexityScore: Math.min(30, totalForms),
        notes: `Source: UniMorph (${verbEntries.length} forms)`,
        source: "unimorph",
      };
    } catch (error) {
      console.error(`UniMorph error for ${langId}/${infinitive}:`, error);
      return null;
    }
  }

  /**
   * Scrape verb conjugation from Wiktionary API.
   * Parses the wikitext for conjugation templates.
   */
  async scrapeFromWiktionary(
    langId: string,
    verbConcept: string,
    infinitive: string,
  ): Promise<VerbParadigmEntry | null> {
    const wikiLang = LANG_TO_WIKTIONARY[langId];
    if (!wikiLang) return null;

    try {
      await this.rateLimit();

      // Query the Wiktionary API for the verb page
      const url = `https://en.wiktionary.org/w/api.php?${new URLSearchParams({
        action: "query",
        format: "json",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: infinitive,
        origin: "*",
      })}`;

      const response = await fetch(url);
      if (!response.ok) return null;

      const data = (await response.json()) as any;
      const pages = data.query?.pages;
      if (!pages) return null;

      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];
      if (page.missing !== undefined) return null;

      const content = page.revisions?.[0]?.slots?.main?.["*"];
      if (!content) return null;

      const conjugationTable = this.parseWiktionaryConjugation(content, wikiLang);
      if (!conjugationTable || Object.keys(conjugationTable).length === 0) return null;

      const totalForms = Object.values(conjugationTable).reduce(
        (sum, tense) => sum + Object.keys(tense).length, 0,
      );

      return {
        id: "",
        languageId: langId,
        verbConcept,
        infinitiveForm: infinitive,
        conjugationTable,
        irregular: false, // hard to detect from wikitext alone
        complexityScore: Math.min(30, totalForms),
        notes: `Source: Wiktionary (en.wiktionary.org)`,
        source: "wiktionary",
      };
    } catch (error) {
      console.error(`Wiktionary error for ${langId}/${infinitive}:`, error);
      return null;
    }
  }

  /**
   * Write new paradigm entries to verb-paradigms.tsv, appending to existing data.
   */
  async writeParadigms(entries: VerbParadigmEntry[], tsvPath = "lexicons/verb-paradigms.tsv"): Promise<number> {
    if (entries.length === 0) return 0;

    const existingContent = fs.existsSync(tsvPath)
      ? fs.readFileSync(tsvPath, "utf8")
      : "";

    const existingLines = existingContent.split("\n").filter((l) => l.trim());
    const hasHeader = existingLines.length > 0;

    // Find next ID number
    let maxId = 0;
    for (const line of existingLines.slice(1)) {
      const id = line.split("\t")[0];
      const match = id?.match(/^vp(\d+)$/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1], 10));
      }
    }

    const newLines: string[] = [];
    if (!hasHeader) {
      newLines.push("id\tlanguage_id\tverb_concept\tinfinitive_form\tconjugation_table\tirregular\tcomplexity_score\tnotes");
    }

    for (const entry of entries) {
      maxId++;
      const id = `vp${String(maxId).padStart(3, "0")}`;
      const row = [
        id,
        entry.languageId,
        entry.verbConcept,
        entry.infinitiveForm,
        JSON.stringify(entry.conjugationTable),
        entry.irregular ? "true" : "false",
        entry.complexityScore.toString(),
        entry.notes,
      ].join("\t");
      newLines.push(row);
    }

    const appendContent = newLines.join("\n") + "\n";
    if (hasHeader) {
      fs.appendFileSync(tsvPath, appendContent, "utf8");
    } else {
      fs.writeFileSync(tsvPath, appendContent, "utf8");
    }

    console.log(`Wrote ${entries.length} verb paradigm entries to ${tsvPath}`);
    return entries.length;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private loadExistingParadigmKeys(): Set<string> {
    const keys = new Set<string>();
    const tsvPath = "lexicons/verb-paradigms.tsv";

    if (!fs.existsSync(tsvPath)) return keys;

    const content = fs.readFileSync(tsvPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length <= 1) return keys;

    const header = lines[0].split("\t");
    const langIdx = header.indexOf("language_id");
    const conceptIdx = header.indexOf("verb_concept");

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (langIdx >= 0 && conceptIdx >= 0) {
        keys.add(`${cols[langIdx]}:${cols[conceptIdx]}`);
      }
    }

    return keys;
  }

  private async fetchUniMorphData(umLang: string): Promise<UniMorphEntry[]> {
    if (this.unimorphCache.has(umLang)) {
      return this.unimorphCache.get(umLang)!;
    }

    await this.rateLimit();

    // UniMorph data is hosted on GitHub
    const url = `https://raw.githubusercontent.com/unimorph/${umLang}/master/${umLang}`;
    const response = await fetch(url);

    if (!response.ok) {
      this.unimorphCache.set(umLang, []);
      return [];
    }

    const text = await response.text();
    const entries: UniMorphEntry[] = [];

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length >= 3) {
        entries.push({
          lemma: parts[0],
          form: parts[1],
          features: parts[2],
        });
      }
    }

    this.unimorphCache.set(umLang, entries);
    return entries;
  }

  private buildConjugationTable(
    entries: UniMorphEntry[],
  ): Record<string, Record<string, string>> {
    const table: Record<string, Record<string, string>> = {};

    for (const entry of entries) {
      const tags = entry.features.split(";");

      let tense = "";
      let mood = "";
      let person = "";
      let number = "";
      let gender = "";

      for (const tag of tags) {
        if (UNIMORPH_TENSE[tag]) tense = UNIMORPH_TENSE[tag];
        if (UNIMORPH_MOOD[tag] !== undefined) mood = UNIMORPH_MOOD[tag];
        if (UNIMORPH_PERSON[tag]) person = UNIMORPH_PERSON[tag];
        if (UNIMORPH_NUMBER[tag]) number = UNIMORPH_NUMBER[tag];
        if (tag === "MASC") gender = "m";
        if (tag === "FEM") gender = "f";
        if (tag === "NEUT") gender = "n";
      }

      if (!tense && !mood) continue;

      // Build tense key: "present", "subjunctive_present", etc.
      const tenseKey = mood ? (tense ? `${mood}_${tense}` : mood) : (tense || "other");

      // Build person key: "1sg", "3pl", "masculine", etc.
      let personKey = "";
      if (person && number) {
        personKey = `${person}${number}`;
        if (gender) personKey += `_${gender}`;
      } else if (gender) {
        personKey = gender === "m" ? "masculine" : gender === "f" ? "feminine" : "neuter";
        if (number) personKey = `${personKey}_${number}`;
      }

      if (!personKey) continue;

      if (!table[tenseKey]) table[tenseKey] = {};
      table[tenseKey][personKey] = entry.form;
    }

    return table;
  }

  private detectIrregularity(infinitive: string, entries: UniMorphEntry[]): boolean {
    // Simple heuristic: if the stems vary significantly, the verb is likely irregular
    const stems = new Set<string>();
    const baseLen = Math.max(2, Math.floor(infinitive.length * 0.5));
    const expectedStem = infinitive.substring(0, baseLen).toLowerCase();

    for (const entry of entries) {
      const formStem = entry.form.substring(0, baseLen).toLowerCase();
      stems.add(formStem);
    }

    // If more than 2 distinct stem patterns, likely irregular
    return stems.size > 2 || !stems.has(expectedStem);
  }

  /**
   * Parse Wiktionary wikitext to extract conjugation forms.
   * Looks for conjugation templates and inflection lines.
   */
  parseWiktionaryConjugation(
    wikitext: string,
    langCode: string,
  ): Record<string, Record<string, string>> | null {
    const table: Record<string, Record<string, string>> = {};

    // Find the language section
    const langSectionPatterns = [
      new RegExp(`==${this.getWiktionaryLangName(langCode)}==`, "i"),
      new RegExp(`==\\s*${this.getWiktionaryLangName(langCode)}\\s*==`, "i"),
    ];

    let sectionStart = -1;
    for (const pattern of langSectionPatterns) {
      const match = wikitext.match(pattern);
      if (match?.index !== undefined) {
        sectionStart = match.index;
        break;
      }
    }
    if (sectionStart === -1) return null;

    // Get the section text (until the next ==Language== header)
    const rest = wikitext.substring(sectionStart);
    const nextLangMatch = rest.substring(3).match(/\n==[^=]/);
    const sectionText = nextLangMatch?.index
      ? rest.substring(0, nextLangMatch.index + 3)
      : rest;

    // Look for conjugation/inflection section
    const conjSection = sectionText.match(/====?\s*Conjugation\s*====?([\s\S]*?)(?=\n===?\s|\n==\s|$)/i);
    if (!conjSection) return null;

    const conjText = conjSection[1];

    // Extract forms from template parameters like |pres_1sg=hablo
    // Allow [[link|display]] by matching wikilinks first, then other non-newline chars
    const paramPattern = /\|([a-z0-9_]+)\s*=\s*((?:\[\[[^\]]*\]\]|[^\n|{}])+)/g;
    let match: RegExpExecArray | null;

    while ((match = paramPattern.exec(conjText)) !== null) {
      const param = match[1].trim();
      const value = match[2].trim().replace(/\[\[([^\]|]*?)(?:\|([^\]]*?))?\]\]/g, (_m, _link, display) => display || _link);

      if (!value || value === "-" || value === "—") continue;

      const parsed = this.parseWiktionaryParam(param);
      if (parsed) {
        if (!table[parsed.tense]) table[parsed.tense] = {};
        table[parsed.tense][parsed.person] = value;
      }
    }

    return Object.keys(table).length > 0 ? table : null;
  }

  private parseWiktionaryParam(param: string): { tense: string; person: string } | null {
    // Common Wiktionary conjugation parameter patterns
    const patterns: Array<{ regex: RegExp; tense: string; personGroup: number }> = [
      { regex: /^pres_(ind_)?(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "present", personGroup: 2 },
      { regex: /^past_(ind_)?(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "past", personGroup: 2 },
      { regex: /^pret_(ind_)?(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "preterite", personGroup: 2 },
      { regex: /^imperf_(ind_)?(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "imperfect", personGroup: 2 },
      { regex: /^fut_(ind_)?(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "future", personGroup: 2 },
      { regex: /^cond_(ind_)?(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "conditional", personGroup: 2 },
      { regex: /^subj_pres_(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "subjunctive_present", personGroup: 1 },
      { regex: /^subj_past_(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "subjunctive_past", personGroup: 1 },
      { regex: /^imp_(\d[a-z]{1,2}(?:_[a-z])?)$/, tense: "imperative", personGroup: 1 },
    ];

    for (const { regex, tense, personGroup } of patterns) {
      const m = param.match(regex);
      if (m) {
        return { tense, person: m[personGroup] };
      }
    }

    return null;
  }

  private getWiktionaryLangName(code: string): string {
    const names: Record<string, string> = {
      en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
      pt: "Portuguese", ru: "Russian", pl: "Polish", cs: "Czech", ro: "Romanian",
      nl: "Dutch", sv: "Swedish", fi: "Finnish", hu: "Hungarian", tr: "Turkish",
      el: "Greek", bg: "Bulgarian", uk: "Ukrainian", he: "Hebrew", ar: "Arabic",
      hi: "Hindi", la: "Latin", sa: "Sanskrit", lv: "Latvian", lt: "Lithuanian",
      ka: "Georgian", hy: "Armenian", eu: "Basque", sw: "Swahili", is: "Icelandic",
      fa: "Persian", tl: "Tagalog", ms: "Malay", ja: "Japanese", ko: "Korean",
      zh: "Chinese", th: "Thai", vi: "Vietnamese", am: "Amharic",
    };
    return names[code] || code;
  }
}

interface UniMorphEntry {
  lemma: string;
  form: string;
  features: string;
}

export const verbParadigmScraper = new VerbParadigmScraper();
