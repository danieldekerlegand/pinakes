import fs from "node:fs";
import path from "node:path";

import type {
  BaseWord,
  Language,
  LanguageFamily,
  LanguageFamilyWithChildren,
  LanguageWithStats,
} from "@shared/types";
import type {
  LanguageRangeFeature,
  ArchaeologicalSiteFeature,
  CivilizationFeature,
  HistoricalRouteFeature,
  MaterialCultureDistribution,
} from "../client/src/lib/visualization/geospatial-types";

// Phonological inventory types
export interface PhonologicalInventory {
  id: string;
  languageId: string;
  consonants: string[];
  vowels: string[];
  tones: string[] | null;
  phonotacticPatterns: Record<string, unknown>;
  syllableStructure: string;
  stressSystem: string;
}

// Grammar features types
export interface GrammarFeatures {
  id: string;
  languageId: string;
  wordOrder: string;
  morphologicalType: string;
  caseSystem: string[];
  genderSystem: string[];
  numberSystem: string[];
  tenseAspectMood: string[];
  agreementSystem: string;
  negationStrategy: string;
  questionFormation: string;
  relativeClauseStrategy: string;
  nounClassCount: number;
  verbValencyChanges: string[];
  evidentiality: string;
  ergativity: string;
}

// Religion types
export interface Religion {
  id: string;
  name: string;
  nativeName: string;
  religionType: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  sacredTexts: string[];
  associatedLanguageIds: string[];
  deityPantheon: string[];
  ritualPractices: string[];
  description: string;
  sources: string[];
}

// Music types
export interface MusicTradition {
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
}

export interface MusicalInstrument {
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
}

// Haplogroup types
export interface Haplogroup {
  id: string;
  name: string;
  parentId: string | null;
  haplogroupType: string;
  description: string;
  associatedLanguageFamilyIds: string[];
  associatedCivilizationIds: string[];
  geographicOrigin: string;
  timeOrigin: number | null;
  sources: string[];
}

// Cuisine types
export interface Cuisine {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  associatedLanguageIds: string[];
  timeOrigin: number | null;
  timeEnd: number | null;
  description: string;
}

export interface CuisineItem {
  id: string;
  cuisineId: string;
  name: string;
  foodType: string;
  timeOrigin: number | null;
  timeEnd: number | null;
}

export type TsvStorageConfig = {
  conceptDataPath: string;
  languageDataPath: string;
  formsDataPath?: string;
  scrapedDir?: string; // Directory containing scraped TSV files
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");
  const rows = lines.map((l) => l.split("\t"));
  return { header, rows };
}

function getIdx(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`Missing column '${name}' in TSV header`);
  return idx;
}

export class TsvStorage {
  private config: TsvStorageConfig;

  private cachedFamilies: LanguageFamily[] | null = null;
  private cachedFamilyTree: LanguageFamilyWithChildren[] | null = null;
  private cachedLanguages: Language[] | null = null;
  private cachedBaseWords: BaseWord[] | null = null;
  private cachedForms: Map<string, Map<string, { form: string; ipa: string | null }>> | null = null; // conceptId -> languageId -> {form, ipa}

  // Geospatial data caches
  private cachedLanguageRanges: LanguageRangeFeature[] | null = null;
  private cachedArchaeologicalSites: ArchaeologicalSiteFeature[] | null = null;
  private cachedCivilizations: CivilizationFeature[] | null = null;
  private cachedHistoricalRoutes: HistoricalRouteFeature[] | null = null;
  private cachedMaterialCultureDistributions: MaterialCultureDistribution[] | null = null;

  // Haplogroup data cache
  private cachedHaplogroups: Haplogroup[] | null = null;

  // Music data caches
  private cachedMusicTraditions: MusicTradition[] | null = null;
  private cachedMusicalInstruments: MusicalInstrument[] | null = null;

  // Religion data cache
  private cachedReligions: Religion[] | null = null;

  // Phonological inventory data cache
  private cachedPhonologicalInventories: PhonologicalInventory[] | null = null;

  // Grammar features data cache
  private cachedGrammarFeatures: GrammarFeatures[] | null = null;

  // Cuisine data caches
  private cachedCuisines: Cuisine[] | null = null;
  private cachedCuisineItems: CuisineItem[] | null = null;

  constructor(config?: Partial<TsvStorageConfig>) {
    this.config = {
      conceptDataPath: "lexicons/words-base.tsv",
      languageDataPath: "lexicons/languages.tsv",
      formsDataPath: "lexicons/words.tsv",
      scrapedDir: "lexicons",
      ...config,
    };
  }

  private readFileOrThrow(relOrAbsPath: string): string {
    const candidates: string[] = [];
    if (path.isAbsolute(relOrAbsPath)) {
      candidates.push(relOrAbsPath);
    } else {
      const cwd = process.cwd();
      candidates.push(path.resolve(cwd, relOrAbsPath));

      const base = path.basename(relOrAbsPath);
      if (base !== relOrAbsPath) {
        candidates.push(path.resolve(cwd, base));
      }
      candidates.push(path.resolve(cwd, "lexicons", base));
    }

    const existing = candidates.find((p) => fs.existsSync(p));
    if (!existing) {
      throw new Error(`TSV not found. Tried: ${candidates.join(", ")}`);
    }
    return fs.readFileSync(existing, "utf8");
  }

  private readFileIfExists(relOrAbsPath: string): string | null {
    try {
      return this.readFileOrThrow(relOrAbsPath);
    } catch {
      return null;
    }
  }

  private loadScrapedFamilies(): LanguageFamily[] {
    const familiesPath = "lexicons/families.tsv";
    const text = this.readFileIfExists(familiesPath);
    if (!text) return [];

    try {
      const { header, rows } = parseTsv(text);

      const idxId = getIdx(header, "id");
      const idxName = getIdx(header, "name");
      const idxParentId = header.indexOf("parent_id");
      const idxDescription = header.indexOf("description");
      const idxTaxonomicLevel = getIdx(header, "taxonomic_level");
      const idxRegion = header.indexOf("region");
      const idxTotalSpeakers = header.indexOf("total_speakers");
      const idxLanguageCount = header.indexOf("language_count");

      const families: LanguageFamily[] = [];

      for (const r of rows) {
        const id = r[idxId] ?? "";
        const name = r[idxName] ?? "";
        if (!id || !name) continue;

        families.push({
          id,
          name,
          parentId: idxParentId >= 0 ? (r[idxParentId] || null) : null,
          description: idxDescription >= 0 ? (r[idxDescription] || null) : null,
          taxonomicLevel: r[idxTaxonomicLevel] ?? "family",
          region: idxRegion >= 0 ? (r[idxRegion] || null) : null,
          totalSpeakers: idxTotalSpeakers >= 0 ? (Number(r[idxTotalSpeakers]) || null) : null,
          languageCount: idxLanguageCount >= 0 ? (Number(r[idxLanguageCount]) || null) : null,
          source: "scraped",
        });
      }

      return families;
    } catch (error) {
      console.warn("Failed to load scraped families:", error);
      return [];
    }
  }

  private loadScrapedLanguages(): Language[] {
    const languagesPath = "lexicons/languages.tsv";
    const text = this.readFileIfExists(languagesPath);
    if (!text) return [];

    try {
      const { header, rows } = parseTsv(text);

      const idxId = getIdx(header, "id");
      const idxName = getIdx(header, "name");
      const idxNativeName = header.indexOf("native_name");
      const idxIso639_1 = header.indexOf("iso639_1");
      const idxIso639_2 = header.indexOf("iso639_2");
      const idxFamilyId = getIdx(header, "family_id");
      const idxParentLanguageId = header.indexOf("parent_language_id");
      const idxRegion = header.indexOf("region");
      const idxCountries = header.indexOf("countries");
      const idxNativeSpeakers = header.indexOf("native_speakers");
      const idxTotalSpeakers = header.indexOf("total_speakers");
      const idxStatus = getIdx(header, "status");
      const idxTimeOrigin = header.indexOf("time_origin");
      const idxTimeEnd = header.indexOf("time_end");
      const idxClassification = header.indexOf("classification");
      const idxWritingSystem = header.indexOf("writing_system");
      const idxIsHistoricalVariant = header.indexOf("is_historical_variant");
      const idxIsDialect = header.indexOf("is_dialect");
      const idxChronologicalOrder = header.indexOf("chronological_order");
      const idxHistoricalContext = header.indexOf("historical_context");
      const idxLatitude = header.indexOf("latitude");
      const idxLongitude = header.indexOf("longitude");

      const languages: Language[] = [];

      for (const r of rows) {
        const id = r[idxId] ?? "";
        const name = r[idxName] ?? "";
        const familyId = r[idxFamilyId] ?? "";
        if (!id || !name || !familyId) continue;

        const lat = idxLatitude >= 0 ? Number(r[idxLatitude]) : NaN;
        const lng = idxLongitude >= 0 ? Number(r[idxLongitude]) : NaN;

        languages.push({
          id,
          name,
          nativeName: idxNativeName >= 0 ? (r[idxNativeName] || null) : null,
          iso639_1: idxIso639_1 >= 0 ? (r[idxIso639_1] || null) : null,
          iso639_2: idxIso639_2 >= 0 ? (r[idxIso639_2] || null) : null,
          familyId,
          parentLanguageId: idxParentLanguageId >= 0 ? (r[idxParentLanguageId] || null) : null,
          region: idxRegion >= 0 ? (r[idxRegion] || null) : null,
          countries: idxCountries >= 0 && r[idxCountries] ? r[idxCountries].split(";") : [],
          nativeSpeakers: idxNativeSpeakers >= 0 ? (Number(r[idxNativeSpeakers]) || null) : null,
          totalSpeakers: idxTotalSpeakers >= 0 ? (Number(r[idxTotalSpeakers]) || null) : null,
          status: r[idxStatus] ?? "living",
          timeOrigin: idxTimeOrigin >= 0 ? (r[idxTimeOrigin] || null) : null,
          timeEnd: idxTimeEnd >= 0 ? (r[idxTimeEnd] || null) : null,
          classification: idxClassification >= 0 ? (r[idxClassification] || null) : null,
          writingSystem: idxWritingSystem >= 0 ? (r[idxWritingSystem] || null) : null,
          isHistoricalVariant: idxIsHistoricalVariant >= 0 ? r[idxIsHistoricalVariant] === "true" : false,
          isDialect: idxIsDialect >= 0 ? r[idxIsDialect] === "true" : false,
          chronologicalOrder: idxChronologicalOrder >= 0 ? (Number(r[idxChronologicalOrder]) || 0) : 0,
          historicalContext: idxHistoricalContext >= 0 ? (r[idxHistoricalContext] || null) : null,
          coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
          source: "scraped",
        });
      }

      return languages;
    } catch (error) {
      console.warn("Failed to load scraped languages:", error);
      return [];
    }
  }

  private loadLanguagesAndFamilies(): void {
    if (this.cachedLanguages && this.cachedFamilies && this.cachedFamilyTree) return;

    // Load families from the unified families.tsv
    const familiesArr = this.loadScrapedFamilies();
    
    // Load languages from the unified languages.tsv
    const languagesArr = this.loadScrapedLanguages();

    // Recalculate language counts for all families based on merged data
    console.log(`[TsvStorage] Recalculating language counts for ${familiesArr.length} families and ${languagesArr.length} languages`);

    // Store direct language counts in a separate map
    const directCounts = new Map<string, number>();

    // Count direct child languages for each family
    for (const lang of languagesArr) {
      const count = directCounts.get(lang.familyId) ?? 0;
      directCounts.set(lang.familyId, count + 1);
    }

    console.log(`[TsvStorage] ${directCounts.size} families have direct child languages`);

    // Recursively calculate total counts including descendants
    const calculateTotalLanguageCount = (familyId: string): number => {
      // Start with direct children languages
      let total = directCounts.get(familyId) ?? 0;

      // Add counts from all child families
      const childFamilies = familiesArr.filter(f => f.parentId === familyId);
      for (const child of childFamilies) {
        total += calculateTotalLanguageCount(child.id);
      }

      return total;
    };

    // Update each family's language count to include descendants
    for (const family of familiesArr) {
      family.languageCount = calculateTotalLanguageCount(family.id);
    }

    // Log some examples for debugging
    const sinoTibetan = familiesArr.find(f => f.id === 'sino_tibetan');
    const mande = familiesArr.find(f => f.id === 'mande');
    console.log(`[TsvStorage] Example counts - Sino-Tibetan: ${sinoTibetan?.languageCount}, Mande: ${mande?.languageCount}`);

    const nonZero = familiesArr.filter(f => (f.languageCount ?? 0) > 0).length;
    console.log(`[TsvStorage] ${nonZero} families have non-zero language counts`);

    const buildTree = (parentId: string | null): LanguageFamilyWithChildren[] => {
      const nodes = familiesArr
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((family) => {
          const children = buildTree(family.id);
          const langs = languagesArr
            .filter((l) => l.familyId === family.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((l) => ({ ...l, historicalVariants: [], dialects: [] }));

          return {
            ...family,
            children,
            languages: langs,
          };
        });

      return nodes;
    };

    this.cachedFamilies = familiesArr;
    this.cachedLanguages = languagesArr;
    this.cachedFamilyTree = buildTree(null);
  }

  private loadBaseWords(): void {
    if (this.cachedBaseWords) return;

    const text = this.readFileOrThrow(this.config.conceptDataPath);
    const { header, rows } = parseTsv(text);

    const idxNum = getIdx(header, "number");
    const idxId = getIdx(header, "id_nelex");
    const idxGloss = getIdx(header, "gloss_en");

    const words: BaseWord[] = [];

    for (const r of rows) {
      const num = Number((r[idxNum] ?? "").replace(",", "."));
      const id = (r[idxId] ?? "").trim();
      const gloss = (r[idxGloss] ?? "").trim();
      if (!id || !gloss || !Number.isFinite(num)) continue;

      words.push({
        id,
        word: gloss,
        position: num,
        category: null,
        frequency: null,
        difficulty: null,
        pos: null,
        notes: null,
        definition: null,
      });
    }

    this.cachedBaseWords = words.sort((a, b) => a.position - b.position);
  }

  private loadScrapedForms(): Map<string, Map<string, { form: string; ipa: string | null }>> {
    const scrapedForms = new Map<string, Map<string, { form: string; ipa: string | null }>>();

    const scrapedDir = path.resolve(process.cwd(), "lexicons");
    if (!fs.existsSync(scrapedDir)) return scrapedForms;

    try {
      const files = fs.readdirSync(scrapedDir);
      const tsvFiles = files.filter(f => 
        f.endsWith('.tsv') && 
        f !== 'families.tsv' && 
        f !== 'languages.tsv' && 
        f !== 'words.tsv' && 
        f !== 'words-base.tsv'
      );

      for (const file of tsvFiles) {
        const languageId = file.replace('.tsv', '');
        const filePath = path.join(scrapedDir, file);

        try {
          const text = fs.readFileSync(filePath, 'utf8');
          const { header, rows } = parseTsv(text);

          const idxConceptId = getIdx(header, "Concept_ID");
          const idxWordForm = getIdx(header, "Word_Form");
          const idxIPA = header.indexOf("IPA");

          for (const r of rows) {
            const conceptId = (r[idxConceptId] ?? "").trim();
            const wordForm = (r[idxWordForm] ?? "").trim();
            const ipa = idxIPA >= 0 ? ((r[idxIPA] ?? "").trim() || null) : null;

            if (!conceptId || !wordForm) continue;

            if (!scrapedForms.has(conceptId)) {
              scrapedForms.set(conceptId, new Map());
            }

            scrapedForms.get(conceptId)!.set(languageId, { form: wordForm, ipa });
          }
        } catch (error) {
          console.warn(`Failed to load scraped forms for ${languageId}:`, error);
        }
      }
    } catch (error) {
      console.warn("Failed to read scraped directory:", error);
    }

    return scrapedForms;
  }

  private loadForms(): void {
    if (this.cachedForms) return;

    const forms = new Map<string, Map<string, { form: string; ipa: string | null }>>();

    // Load NorthEuraLex forms
    if (this.config.formsDataPath) {
      try {
        const text = this.readFileOrThrow(this.config.formsDataPath);
        const { header, rows } = parseTsv(text);

        const idxLanguageId = getIdx(header, "Language_ID");
        const idxConceptId = getIdx(header, "Concept_ID");
        const idxWordForm = getIdx(header, "Word_Form");
        const idxIPA = getIdx(header, "IPA");

        for (const r of rows) {
          const langId = (r[idxLanguageId] ?? "").trim();
          const conceptId = (r[idxConceptId] ?? "").trim();
          const wordForm = (r[idxWordForm] ?? "").trim();
          const ipa = (r[idxIPA] ?? "").trim() || null;

          if (!langId || !conceptId || !wordForm) continue;

          if (!forms.has(conceptId)) {
            forms.set(conceptId, new Map());
          }

          forms.get(conceptId)!.set(langId, { form: wordForm, ipa });
        }
      } catch (error) {
        console.warn("Forms data not available, word comparisons will be limited:", error);
      }
    }

    // Load and merge scraped forms
    const scrapedForms = this.loadScrapedForms();
    Array.from(scrapedForms.entries()).forEach(([conceptId, langMap]) => {
      if (!forms.has(conceptId)) {
        forms.set(conceptId, new Map());
      }
      const conceptForms = forms.get(conceptId)!;
      Array.from(langMap.entries()).forEach(([langId, formData]) => {
        conceptForms.set(langId, formData);
      });
    });

    this.cachedForms = forms;
  }

  async getLanguageFamilies(): Promise<LanguageFamily[]> {
    this.loadLanguagesAndFamilies();
    return this.cachedFamilies ?? [];
  }

  async getLanguageFamilyTree(): Promise<LanguageFamilyWithChildren[]> {
    this.loadLanguagesAndFamilies();
    return this.cachedFamilyTree ?? [];
  }

  async getLanguages(): Promise<Language[]> {
    this.loadLanguagesAndFamilies();
    return this.cachedLanguages ?? [];
  }

  async getLanguage(id: string): Promise<LanguageWithStats | undefined> {
    this.loadLanguagesAndFamilies();
    const lang = (this.cachedLanguages ?? []).find((l) => l.id === id);
    if (!lang) return undefined;

    return {
      ...lang,
      completionPercentage: 0,
      historicalVariants: [],
      dialects: [],
    };
  }

  async getBaseWords(): Promise<BaseWord[]> {
    this.loadBaseWords();
    return this.cachedBaseWords ?? [];
  }

  async getLanguageStats(): Promise<{
    totalLanguages: number;
    historicalVariants: number;
    dialects: number;
    wordListsScraped: number;
    baseWords: number;
    scrapingQueue: number;
    totalFamilies?: number;
    totalSubfamilies?: number;
    languagesWithCoordinates?: number;
  }> {
    this.loadLanguagesAndFamilies();
    this.loadBaseWords();

    const families = this.cachedFamilies ?? [];
    const languages = this.cachedLanguages ?? [];

    const topLevelFamilies = families.filter(f => f.parentId === null);
    const subfamilies = families.filter(f => f.parentId !== null);
    const languagesWithCoords = languages.filter(l => l.coordinates !== null);

    return {
      totalLanguages: languages.length,
      historicalVariants: languages.filter(l => l.isHistoricalVariant).length,
      dialects: languages.filter(l => l.isDialect).length,
      wordListsScraped: 0,
      baseWords: (this.cachedBaseWords ?? []).length,
      scrapingQueue: 0,
      totalFamilies: topLevelFamilies.length,
      totalSubfamilies: subfamilies.length,
      languagesWithCoordinates: languagesWithCoords.length,
    };
  }

  async getWordComparisons(languageIds: string[]): Promise<Array<{
    baseWord: string;
    conceptId: string;
    translations: Record<string, { form: string; ipa: string | null }>;
  }>> {
    this.loadBaseWords();
    this.loadForms();

    const baseWords = this.cachedBaseWords ?? [];
    const forms = this.cachedForms ?? new Map();

    const comparisons = [];

    for (const word of baseWords) {
      const conceptForms = forms.get(word.id);
      if (!conceptForms) continue;

      const translations: Record<string, { form: string; ipa: string | null }> = {};
      let hasAnyTranslation = false;

      for (const langId of languageIds) {
        const formData = conceptForms.get(langId);
        if (formData) {
          translations[langId] = formData;
          hasAnyTranslation = true;
        }
      }

      // Only include words that have at least one translation in the selected languages
      if (hasAnyTranslation) {
        comparisons.push({
          baseWord: word.word,
          conceptId: word.id,
          translations,
        });
      }
    }

    return comparisons;
  }

  async getLanguageWordList(languageId: string): Promise<Array<{
    baseWord: string;
    conceptId: string;
    translation: string | null;
    ipa: string | null;
  }>> {
    this.loadBaseWords();
    this.loadForms();

    const baseWords = this.cachedBaseWords ?? [];
    const forms = this.cachedForms ?? new Map();

    const wordList = [];

    for (const word of baseWords) {
      const conceptForms = forms.get(word.id);
      const formData = conceptForms?.get(languageId);

      wordList.push({
        baseWord: word.word,
        conceptId: word.id,
        translation: formData?.form ?? null,
        ipa: formData?.ipa ?? null,
      });
    }

    return wordList;
  }

  // ============================================================================
  // Geospatial Data Methods
  // ============================================================================

  // --- Private loaders for geospatial data ---

  private loadLanguageRanges(): void {
    if (this.cachedLanguageRanges) return;

    const text = this.readFileIfExists("lexicons/language-ranges.tsv");
    if (!text) { this.cachedLanguageRanges = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const langIdIdx = getIdx(header, "language_id");
    const famIdIdx = getIdx(header, "family_id");
    const geoIdx = getIdx(header, "geometry");
    const typeIdx = getIdx(header, "range_type");
    const startIdx = header.indexOf("time_period_start");
    const endIdx = header.indexOf("time_period_end");
    const labelIdx = header.indexOf("time_period_label");
    const confIdx = header.indexOf("confidence");
    const srcIdx = header.indexOf("sources");
    const notesIdx = header.indexOf("notes");

    this.cachedLanguageRanges = rows
      .filter((row) => row[geoIdx] && row[geoIdx].trim())
      .map((row) => {
        let geometry;
        try { geometry = JSON.parse(row[geoIdx]); } catch { return null; }

        const tStart = startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
          ? parseInt(row[startIdx], 10) : 0;
        const tEnd = endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
          ? parseInt(row[endIdx], 10) : null;
        let sources: string[] = [];
        if (srcIdx >= 0 && row[srcIdx]) { try { sources = JSON.parse(row[srcIdx]); } catch {} }

        return {
          type: "Feature" as const,
          id: row[idIdx],
          geometry,
          properties: {
            languageId: row[langIdIdx],
            languageName: row[langIdIdx], // Will be enriched later
            familyId: row[famIdIdx],
            familyName: row[famIdIdx],
            rangeType: (row[typeIdx] || "historical") as any,
            timePeriod: {
              start: tStart,
              end: tEnd,
              label: labelIdx >= 0 ? row[labelIdx] || "" : "",
            },
            confidence: confIdx >= 0 ? parseInt(row[confIdx] || "50", 10) : 50,
            sources,
          },
        } as LanguageRangeFeature;
      })
      .filter((f): f is LanguageRangeFeature => f !== null);
  }

  private loadArchaeologicalSites(): void {
    if (this.cachedArchaeologicalSites) return;

    const text = this.readFileIfExists("lexicons/archaeological-sites.tsv");
    if (!text) { this.cachedArchaeologicalSites = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const coordsIdx = getIdx(header, "coordinates");
    const typeIdx = getIdx(header, "site_type");
    const startIdx = header.indexOf("time_period_start");
    const endIdx = header.indexOf("time_period_end");
    const labelIdx = header.indexOf("time_period_label");
    const langIdx = header.indexOf("associated_language_ids");
    const cultureIdx = header.indexOf("associated_culture_ids");
    const excIdx = header.indexOf("excavation_status");
    const findIdx = header.indexOf("findings");
    const impIdx = header.indexOf("importance");
    const confIdx = header.indexOf("confidence");
    const srcIdx = header.indexOf("sources");
    const descIdx = header.indexOf("description");

    this.cachedArchaeologicalSites = rows
      .filter((row) => row[coordsIdx] && row[coordsIdx].trim())
      .map((row) => {
        let coords: { lat: number; lng: number };
        try { coords = JSON.parse(row[coordsIdx]); } catch { return null; }

        const tStart = startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
          ? parseInt(row[startIdx], 10) : 0;
        const tEnd = endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
          ? parseInt(row[endIdx], 10) : null;

        const parseArr = (idx: number): string[] => {
          if (idx < 0 || !row[idx]) return [];
          try { return JSON.parse(row[idx]); } catch { return []; }
        };

        return {
          type: "Feature" as const,
          id: row[idIdx],
          geometry: {
            type: "Point" as const,
            coordinates: [coords.lng, coords.lat],
          },
          properties: {
            siteId: row[idIdx],
            name: row[nameIdx],
            siteType: (row[typeIdx] || "unknown") as any,
            timePeriod: {
              start: tStart,
              end: tEnd,
              label: labelIdx >= 0 ? row[labelIdx] || "" : "",
            },
            associatedLanguageIds: parseArr(langIdx),
            associatedCultureIds: parseArr(cultureIdx),
            excavationStatus: (excIdx >= 0 ? row[excIdx] || "unknown" : "unknown") as any,
            findings: parseArr(findIdx),
            importance: impIdx >= 0 ? parseInt(row[impIdx] || "50", 10) : 50,
            confidence: confIdx >= 0 ? parseInt(row[confIdx] || "50", 10) : 50,
            sources: parseArr(srcIdx),
            description: descIdx >= 0 ? row[descIdx] || "" : "",
          },
        } as ArchaeologicalSiteFeature;
      })
      .filter((f): f is ArchaeologicalSiteFeature => f !== null);
  }

  private loadCivilizations(): void {
    if (this.cachedCivilizations) return;

    // Load civilizations metadata
    const civText = this.readFileIfExists("lexicons/civilizations.tsv");
    const boundText = this.readFileIfExists("lexicons/civilization-boundaries.tsv");
    if (!civText && !boundText) { this.cachedCivilizations = []; return; }

    // Parse boundaries first (they have geometry)
    const boundaries = new Map<string, { geometry: any; start: number; end: number | null; label: string }>();
    if (boundText) {
      const { header, rows } = parseTsv(boundText);
      const civIdIdx = getIdx(header, "civilization_id");
      const geoIdx = getIdx(header, "geometry");
      const startIdx = header.indexOf("time_period_start");
      const endIdx = header.indexOf("time_period_end");
      const labelIdx = header.indexOf("time_period_label");

      for (const row of rows) {
        if (!row[geoIdx]) continue;
        try {
          boundaries.set(row[civIdIdx], {
            geometry: JSON.parse(row[geoIdx]),
            start: startIdx >= 0 && row[startIdx] && row[startIdx] !== "null" ? parseInt(row[startIdx], 10) : 0,
            end: endIdx >= 0 && row[endIdx] && row[endIdx] !== "null" ? parseInt(row[endIdx], 10) : null,
            label: labelIdx >= 0 ? row[labelIdx] || "" : "",
          });
        } catch {}
      }
    }

    // Parse civilizations metadata
    if (!civText) { this.cachedCivilizations = []; return; }
    const { header, rows } = parseTsv(civText);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const nativeIdx = header.indexOf("native_name");
    const startIdx = header.indexOf("time_period_start");
    const endIdx = header.indexOf("time_period_end");
    const labelIdx = header.indexOf("time_period_label");
    const langIdx = header.indexOf("associated_language_ids");
    const writIdx = header.indexOf("writing_systems");
    const polIdx = header.indexOf("political_structure");
    const capIdx = header.indexOf("capital");
    const popIdx = header.indexOf("population");
    const srcIdx = header.indexOf("sources");

    const parseArr = (r: string[], idx: number): string[] => {
      if (idx < 0 || !r[idx]) return [];
      try { return JSON.parse(r[idx]); } catch { return []; }
    };

    this.cachedCivilizations = rows
      .map((row) => {
        const civId = row[idIdx];
        const boundary = boundaries.get(civId);

        // Use boundary geometry if available, otherwise create a placeholder
        const geometry = boundary?.geometry ?? {
          type: "Polygon" as const,
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        };

        const tStart = startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
          ? parseInt(row[startIdx], 10) : (boundary?.start ?? 0);
        const tEnd = endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
          ? parseInt(row[endIdx], 10) : (boundary?.end ?? null);

        return {
          type: "Feature" as const,
          id: civId,
          geometry,
          properties: {
            civilizationId: civId,
            name: row[nameIdx],
            nativeName: nativeIdx >= 0 ? row[nativeIdx] || undefined : undefined,
            timePeriod: {
              start: tStart,
              end: tEnd,
              label: labelIdx >= 0 ? row[labelIdx] || "" : (boundary?.label ?? ""),
            },
            associatedLanguageIds: parseArr(row, langIdx),
            writingSystems: parseArr(row, writIdx),
            politicalStructure: polIdx >= 0 ? row[polIdx] || undefined : undefined,
            capital: capIdx >= 0 ? row[capIdx] || undefined : undefined,
            population: popIdx >= 0 && row[popIdx] ? parseInt(row[popIdx], 10) : undefined,
            sources: parseArr(row, srcIdx),
          },
        } as CivilizationFeature;
      });
  }

  // --- Helper for temporal filtering ---
  private filterByTime<T extends { properties: { timePeriod: { start: number; end: number | null } } }>(
    features: T[],
    timeStart?: number,
    timeEnd?: number,
  ): T[] {
    if (timeStart === undefined && timeEnd === undefined) return features;
    return features.filter((f) => {
      const s = f.properties.timePeriod.start;
      const e = f.properties.timePeriod.end ?? Infinity;
      if (timeStart !== undefined && e < timeStart) return false;
      if (timeEnd !== undefined && s > timeEnd) return false;
      return true;
    });
  }

  /**
   * Get language ranges (GeoJSON polygons) with optional filtering
   */
  async getLanguageRanges(filters?: {
    timeStart?: number;
    timeEnd?: number;
    bbox?: string;
    familyIds?: string[];
  }): Promise<LanguageRangeFeature[]> {
    this.loadLanguageRanges();
    let features = this.cachedLanguageRanges ?? [];

    features = this.filterByTime(features, filters?.timeStart, filters?.timeEnd);

    if (filters?.familyIds && filters.familyIds.length > 0) {
      const famSet = new Set(filters.familyIds);
      features = features.filter((f) => famSet.has(f.properties.familyId));
    }

    return features;
  }

  /**
   * Get archaeological sites with optional filtering
   */
  async getArchaeologicalSites(filters?: {
    timeStart?: number;
    timeEnd?: number;
    bbox?: string;
    siteTypes?: string[];
  }): Promise<ArchaeologicalSiteFeature[]> {
    this.loadArchaeologicalSites();
    let features = this.cachedArchaeologicalSites ?? [];

    features = this.filterByTime(features, filters?.timeStart, filters?.timeEnd);

    if (filters?.siteTypes && filters.siteTypes.length > 0) {
      const typeSet = new Set(filters.siteTypes);
      features = features.filter((f) => typeSet.has(f.properties.siteType));
    }

    return features;
  }

  /**
   * Get civilizations with boundaries
   */
  async getCivilizations(filters?: {
    timeStart?: number;
    timeEnd?: number;
    bbox?: string;
  }): Promise<CivilizationFeature[]> {
    this.loadCivilizations();
    let features = this.cachedCivilizations ?? [];
    features = this.filterByTime(features, filters?.timeStart, filters?.timeEnd);
    return features;
  }

  /**
   * Get historical routes (trade, migration, etc.)
   * Note: Returns empty until lexicons/historical-routes.tsv is populated
   */
  async getHistoricalRoutes(filters?: {
    timeStart?: number;
    timeEnd?: number;
    bbox?: string;
    routeTypes?: string[];
  }): Promise<HistoricalRouteFeature[]> {
    // No TSV data yet for routes
    return [];
  }

  /**
   * Get material culture distributions for heatmap
   * Note: Returns empty until lexicons/material-cultures.tsv is populated
   */
  async getMaterialCultureDistributions(filters?: {
    timeStart?: number;
    timeEnd?: number;
    bbox?: string;
    cultureTypes?: string[];
  }): Promise<MaterialCultureDistribution[]> {
    // No TSV data yet for material cultures
    return [];
  }

  // ============================================================================
  // Haplogroup Data Methods
  // ============================================================================

  /**
   * Load haplogroups from TSV file
   */
  private loadHaplogroups(): void {
    if (this.cachedHaplogroups) return;

    const text = this.readFileIfExists("lexicons/haplogroups.tsv");
    if (!text) { this.cachedHaplogroups = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const parentIdx = header.indexOf("parent_id");
    const typeIdx = header.indexOf("haplogroup_type");
    const descIdx = header.indexOf("description");
    const langIdx = header.indexOf("associated_language_family_ids");
    const civIdx = header.indexOf("associated_civilization_ids");
    const geoIdx = header.indexOf("geographic_origin");
    const timeIdx = header.indexOf("time_origin");
    const srcIdx = header.indexOf("sources");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedHaplogroups = rows.map((row) => ({
      id: row[idIdx],
      name: row[nameIdx],
      parentId: parentIdx >= 0 && row[parentIdx] && row[parentIdx] !== "null"
        ? row[parentIdx] : null,
      haplogroupType: typeIdx >= 0 ? row[typeIdx] || "Y-chromosome" : "Y-chromosome",
      description: descIdx >= 0 ? row[descIdx] || "" : "",
      associatedLanguageFamilyIds: parseArr(langIdx, row),
      associatedCivilizationIds: parseArr(civIdx, row),
      geographicOrigin: geoIdx >= 0 ? row[geoIdx] || "" : "",
      timeOrigin: timeIdx >= 0 && row[timeIdx] && row[timeIdx] !== "null"
        ? parseInt(row[timeIdx], 10) : null,
      sources: parseArr(srcIdx, row),
    }));
  }

  /**
   * Get all haplogroups with optional filtering
   */
  async getHaplogroups(filters?: {
    parentId?: string;
    languageFamilyId?: string;
    olderThan?: number;
  }): Promise<Haplogroup[]> {
    this.loadHaplogroups();
    let haplogroups = this.cachedHaplogroups ?? [];

    if (filters?.parentId !== undefined) {
      haplogroups = haplogroups.filter((h) =>
        filters.parentId === "null" ? h.parentId === null : h.parentId === filters.parentId
      );
    }

    if (filters?.languageFamilyId) {
      haplogroups = haplogroups.filter((h) =>
        h.associatedLanguageFamilyIds.includes(filters.languageFamilyId!)
      );
    }

    if (filters?.olderThan !== undefined) {
      haplogroups = haplogroups.filter((h) =>
        h.timeOrigin !== null && h.timeOrigin <= filters.olderThan!
      );
    }

    return haplogroups;
  }

  /**
   * Get a single haplogroup by ID with its children
   */
  async getHaplogroupWithChildren(
    haplogroupId: string,
  ): Promise<{ haplogroup: Haplogroup; children: Haplogroup[] } | null> {
    this.loadHaplogroups();
    const all = this.cachedHaplogroups ?? [];

    const haplogroup = all.find((h) => h.id === haplogroupId);
    if (!haplogroup) return null;

    const children = all.filter((h) => h.parentId === haplogroupId);
    return { haplogroup, children };
  }

  /**
   * Get the full haplogroup tree (all haplogroups organized by parent)
   */
  async getHaplogroupTree(): Promise<Haplogroup[]> {
    this.loadHaplogroups();
    return this.cachedHaplogroups ?? [];
  }

  // ============================================================================
  // Music Data Methods
  // ============================================================================

  /**
   * Load music traditions from TSV file
   */
  private loadMusicTraditions(): void {
    if (this.cachedMusicTraditions) return;

    const text = this.readFileIfExists("lexicons/music-traditions.tsv");
    if (!text) { this.cachedMusicTraditions = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const nativeIdx = header.indexOf("native_name");
    const regionIdx = header.indexOf("region");
    const coordsIdx = header.indexOf("coordinates");
    const startIdx = header.indexOf("time_origin");
    const endIdx = header.indexOf("time_end");
    const langIdx = header.indexOf("associated_language_ids");
    const instrIdx = header.indexOf("instruments");
    const scaleIdx = header.indexOf("scales");
    const rhythmIdx = header.indexOf("rhythmic_patterns");
    const relIdx = header.indexOf("related_traditions");
    const descIdx = header.indexOf("description");
    const srcIdx = header.indexOf("sources");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedMusicTraditions = rows.map((row) => {
      let coords = { lat: 0, lng: 0 };
      if (coordsIdx >= 0 && row[coordsIdx]) {
        try { coords = JSON.parse(row[coordsIdx]); } catch {}
      }

      return {
        id: row[idIdx],
        name: row[nameIdx],
        nativeName: nativeIdx >= 0 ? row[nativeIdx] || "" : "",
        region: regionIdx >= 0 ? row[regionIdx] || "" : "",
        coordinates: coords,
        timeOrigin: startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
          ? parseInt(row[startIdx], 10) : null,
        timeEnd: endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
          ? parseInt(row[endIdx], 10) : null,
        associatedLanguageIds: parseArr(langIdx, row),
        instruments: parseArr(instrIdx, row),
        scales: parseArr(scaleIdx, row),
        rhythmicPatterns: parseArr(rhythmIdx, row),
        relatedTraditions: parseArr(relIdx, row),
        description: descIdx >= 0 ? row[descIdx] || "" : "",
        sources: parseArr(srcIdx, row),
      };
    });
  }

  /**
   * Load musical instruments from TSV file
   */
  private loadMusicalInstruments(): void {
    if (this.cachedMusicalInstruments) return;

    const text = this.readFileIfExists("lexicons/musical-instruments.tsv");
    if (!text) { this.cachedMusicalInstruments = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const nativeIdx = header.indexOf("native_name");
    const famIdx = header.indexOf("instrument_family");
    const regionIdx = header.indexOf("origin_region");
    const coordsIdx = header.indexOf("coordinates");
    const timeIdx = header.indexOf("time_origin");
    const matIdx = header.indexOf("construction_materials");
    const techIdx = header.indexOf("playing_technique");
    const tradIdx = header.indexOf("associated_tradition_ids");
    const langIdx = header.indexOf("associated_language_ids");
    const descIdx = header.indexOf("description");
    const srcIdx = header.indexOf("sources");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedMusicalInstruments = rows.map((row) => {
      let coords = { lat: 0, lng: 0 };
      if (coordsIdx >= 0 && row[coordsIdx]) {
        try { coords = JSON.parse(row[coordsIdx]); } catch {}
      }

      return {
        id: row[idIdx],
        name: row[nameIdx],
        nativeName: nativeIdx >= 0 ? row[nativeIdx] || "" : "",
        instrumentFamily: famIdx >= 0 ? row[famIdx] || "" : "",
        originRegion: regionIdx >= 0 ? row[regionIdx] || "" : "",
        coordinates: coords,
        timeOrigin: timeIdx >= 0 && row[timeIdx] && row[timeIdx] !== "null"
          ? parseInt(row[timeIdx], 10) : null,
        constructionMaterials: parseArr(matIdx, row),
        playingTechnique: techIdx >= 0 ? row[techIdx] || "" : "",
        associatedTraditionIds: parseArr(tradIdx, row),
        associatedLanguageIds: parseArr(langIdx, row),
        description: descIdx >= 0 ? row[descIdx] || "" : "",
        sources: parseArr(srcIdx, row),
      };
    });
  }

  /**
   * Get music traditions with optional filtering
   */
  async getMusicTraditions(filters?: {
    year?: number;
    region?: string;
    languageId?: string;
  }): Promise<MusicTradition[]> {
    this.loadMusicTraditions();
    let traditions = this.cachedMusicTraditions ?? [];

    if (filters?.year !== undefined) {
      traditions = traditions.filter((t) => {
        const start = t.timeOrigin ?? -Infinity;
        const end = t.timeEnd ?? Infinity;
        return filters.year! >= start && filters.year! <= end;
      });
    }

    if (filters?.region) {
      traditions = traditions.filter((t) =>
        t.region.toLowerCase().includes(filters.region!.toLowerCase())
      );
    }

    if (filters?.languageId) {
      traditions = traditions.filter((t) =>
        t.associatedLanguageIds.includes(filters.languageId!)
      );
    }

    return traditions;
  }

  /**
   * Get a single music tradition by ID
   */
  async getMusicTraditionWithInstruments(
    traditionId: string,
  ): Promise<{ tradition: MusicTradition; instruments: MusicalInstrument[] } | null> {
    this.loadMusicTraditions();
    this.loadMusicalInstruments();

    const tradition = (this.cachedMusicTraditions ?? []).find((t) => t.id === traditionId);
    if (!tradition) return null;

    const instruments = (this.cachedMusicalInstruments ?? []).filter(
      (i) => i.associatedTraditionIds.includes(traditionId)
    );

    return { tradition, instruments };
  }

  /**
   * Get musical instruments with optional filtering
   */
  async getMusicalInstruments(filters?: {
    family?: string;
    traditionId?: string;
    olderThan?: number;
  }): Promise<MusicalInstrument[]> {
    this.loadMusicalInstruments();
    let instruments = this.cachedMusicalInstruments ?? [];

    if (filters?.family) {
      instruments = instruments.filter((i) =>
        i.instrumentFamily.toLowerCase() === filters.family!.toLowerCase()
      );
    }

    if (filters?.traditionId) {
      instruments = instruments.filter((i) =>
        i.associatedTraditionIds.includes(filters.traditionId!)
      );
    }

    if (filters?.olderThan !== undefined) {
      instruments = instruments.filter((i) =>
        i.timeOrigin !== null && i.timeOrigin <= filters.olderThan!
      );
    }

    return instruments;
  }

  // ============================================================================
  // Religion Data Methods
  // ============================================================================

  /**
   * Load religions from TSV file
   */
  private loadReligions(): void {
    if (this.cachedReligions) return;

    const text = this.readFileIfExists("lexicons/religions.tsv");
    if (!text) { this.cachedReligions = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const nativeIdx = header.indexOf("native_name");
    const typeIdx = header.indexOf("religion_type");
    const regionIdx = header.indexOf("origin_region");
    const coordsIdx = header.indexOf("coordinates");
    const startIdx = header.indexOf("time_origin");
    const endIdx = header.indexOf("time_end");
    const textsIdx = header.indexOf("sacred_texts");
    const langIdx = header.indexOf("associated_language_ids");
    const deityIdx = header.indexOf("deity_pantheon");
    const ritualIdx = header.indexOf("ritual_practices");
    const descIdx = header.indexOf("description");
    const srcIdx = header.indexOf("sources");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedReligions = rows.map((row) => {
      let coords = { lat: 0, lng: 0 };
      if (coordsIdx >= 0 && row[coordsIdx]) {
        try { coords = JSON.parse(row[coordsIdx]); } catch {}
      }

      return {
        id: row[idIdx],
        name: row[nameIdx],
        nativeName: nativeIdx >= 0 ? row[nativeIdx] || "" : "",
        religionType: typeIdx >= 0 ? row[typeIdx] || "" : "",
        originRegion: regionIdx >= 0 ? row[regionIdx] || "" : "",
        coordinates: coords,
        timeOrigin: startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
          ? parseInt(row[startIdx], 10) : null,
        timeEnd: endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
          ? parseInt(row[endIdx], 10) : null,
        sacredTexts: parseArr(textsIdx, row),
        associatedLanguageIds: parseArr(langIdx, row),
        deityPantheon: parseArr(deityIdx, row),
        ritualPractices: parseArr(ritualIdx, row),
        description: descIdx >= 0 ? row[descIdx] || "" : "",
        sources: parseArr(srcIdx, row),
      };
    });
  }

  /**
   * Get religions with optional filtering
   */
  async getReligions(filters?: {
    year?: number;
    region?: string;
    religionType?: string;
    languageId?: string;
  }): Promise<Religion[]> {
    this.loadReligions();
    let religions = this.cachedReligions ?? [];

    if (filters?.year !== undefined) {
      religions = religions.filter((r) => {
        const start = r.timeOrigin ?? -Infinity;
        const end = r.timeEnd ?? Infinity;
        return filters.year! >= start && filters.year! <= end;
      });
    }

    if (filters?.region) {
      religions = religions.filter((r) =>
        r.originRegion.toLowerCase().includes(filters.region!.toLowerCase())
      );
    }

    if (filters?.religionType) {
      religions = religions.filter((r) =>
        r.religionType === filters.religionType
      );
    }

    if (filters?.languageId) {
      religions = religions.filter((r) =>
        r.associatedLanguageIds.includes(filters.languageId!)
      );
    }

    return religions;
  }

  /**
   * Get a single religion by ID
   */
  async getReligion(religionId: string): Promise<Religion | null> {
    this.loadReligions();
    return (this.cachedReligions ?? []).find((r) => r.id === religionId) ?? null;
  }

  // ============================================================================
  // Cuisine Data Methods
  // ============================================================================

  /**
   * Load cuisines from TSV file
   */
  private loadCuisines(): void {
    if (this.cachedCuisines) return;

    const text = this.readFileIfExists("lexicons/cuisines.tsv");
    if (!text) {
      this.cachedCuisines = [];
      return;
    }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const nativeNameIdx = header.indexOf("native_name");
    const regionIdx = header.indexOf("region");
    const coordsIdx = header.indexOf("coordinates");
    const langIdsIdx = header.indexOf("associated_language_ids");
    const timeOriginIdx = header.indexOf("time_origin");
    const timeEndIdx = header.indexOf("time_end");
    const descIdx = header.indexOf("description");

    this.cachedCuisines = rows.map((row) => {
      let coords = { lat: 0, lng: 0 };
      if (coordsIdx >= 0 && row[coordsIdx]) {
        try {
          coords = JSON.parse(row[coordsIdx]);
        } catch {}
      }

      let langIds: string[] = [];
      if (langIdsIdx >= 0 && row[langIdsIdx]) {
        try {
          langIds = JSON.parse(row[langIdsIdx]);
        } catch {}
      }

      return {
        id: row[idIdx],
        name: row[nameIdx],
        nativeName: nativeNameIdx >= 0 ? row[nativeNameIdx] || "" : "",
        region: regionIdx >= 0 ? row[regionIdx] || "" : "",
        coordinates: coords,
        associatedLanguageIds: langIds,
        timeOrigin: timeOriginIdx >= 0 && row[timeOriginIdx] && row[timeOriginIdx] !== "null"
          ? parseInt(row[timeOriginIdx], 10)
          : null,
        timeEnd: timeEndIdx >= 0 && row[timeEndIdx] && row[timeEndIdx] !== "null"
          ? parseInt(row[timeEndIdx], 10)
          : null,
        description: descIdx >= 0 ? row[descIdx] || "" : "",
      };
    });
  }

  /**
   * Load cuisine items from TSV file
   */
  private loadCuisineItems(): void {
    if (this.cachedCuisineItems) return;

    const text = this.readFileIfExists("lexicons/cuisine-items.tsv");
    if (!text) {
      this.cachedCuisineItems = [];
      return;
    }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const cuisineIdIdx = getIdx(header, "cuisine_id");
    const nameIdx = getIdx(header, "name");
    const foodTypeIdx = header.indexOf("food_type");
    const timeOriginIdx = header.indexOf("time_origin");
    const timeEndIdx = header.indexOf("time_end");

    this.cachedCuisineItems = rows.map((row) => ({
      id: row[idIdx],
      cuisineId: row[cuisineIdIdx],
      name: row[nameIdx],
      foodType: foodTypeIdx >= 0 ? row[foodTypeIdx] || "" : "",
      timeOrigin: timeOriginIdx >= 0 && row[timeOriginIdx] && row[timeOriginIdx] !== "null"
        ? parseInt(row[timeOriginIdx], 10)
        : null,
      timeEnd: timeEndIdx >= 0 && row[timeEndIdx] && row[timeEndIdx] !== "null"
        ? parseInt(row[timeEndIdx], 10)
        : null,
    }));
  }

  /**
   * Get all cuisines with optional temporal filtering
   */
  async getCuisines(filters?: {
    year?: number;
    region?: string;
  }): Promise<Cuisine[]> {
    this.loadCuisines();
    let cuisines = this.cachedCuisines ?? [];

    if (filters?.year !== undefined) {
      cuisines = cuisines.filter((c) => {
        const start = c.timeOrigin ?? -Infinity;
        const end = c.timeEnd ?? Infinity;
        return filters.year! >= start && filters.year! <= end;
      });
    }

    if (filters?.region) {
      cuisines = cuisines.filter((c) =>
        c.region.toLowerCase().includes(filters.region!.toLowerCase())
      );
    }

    return cuisines;
  }

  /**
   * Get cuisine items with optional temporal filtering
   */
  async getCuisineItems(filters?: {
    cuisineId?: string;
    year?: number;
    foodType?: string;
  }): Promise<CuisineItem[]> {
    this.loadCuisineItems();
    let items = this.cachedCuisineItems ?? [];

    if (filters?.cuisineId) {
      items = items.filter((i) => i.cuisineId === filters.cuisineId);
    }

    if (filters?.year !== undefined) {
      items = items.filter((i) => {
        const start = i.timeOrigin ?? -Infinity;
        const end = i.timeEnd ?? Infinity;
        return filters.year! >= start && filters.year! <= end;
      });
    }

    if (filters?.foodType) {
      items = items.filter((i) =>
        i.foodType.toLowerCase().includes(filters.foodType!.toLowerCase())
      );
    }

    return items;
  }

  /**
   * Get a single cuisine by ID with its items
   */
  async getCuisineWithItems(
    cuisineId: string,
    year?: number
  ): Promise<{ cuisine: Cuisine; items: CuisineItem[] } | null> {
    this.loadCuisines();
    this.loadCuisineItems();

    const cuisine = (this.cachedCuisines ?? []).find((c) => c.id === cuisineId);
    if (!cuisine) return null;

    let items = (this.cachedCuisineItems ?? []).filter(
      (i) => i.cuisineId === cuisineId
    );

    if (year !== undefined) {
      items = items.filter((i) => {
        const start = i.timeOrigin ?? -Infinity;
        const end = i.timeEnd ?? Infinity;
        return year >= start && year <= end;
      });
    }

    return { cuisine, items };
  }

  // ============================================================================
  // Phonological Inventory Data Methods
  // ============================================================================

  /**
   * Load phonological inventories from TSV file
   */
  private loadPhonologicalInventories(): void {
    if (this.cachedPhonologicalInventories) return;

    const text = this.readFileIfExists("lexicons/phonological-inventories.tsv");
    if (!text) { this.cachedPhonologicalInventories = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const langIdx = getIdx(header, "language_id");
    const consIdx = header.indexOf("consonants");
    const vowIdx = header.indexOf("vowels");
    const toneIdx = header.indexOf("tones");
    const patIdx = header.indexOf("phonotactic_patterns");
    const syllIdx = header.indexOf("syllable_structure");
    const stressIdx = header.indexOf("stress_system");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    const parseObj = (idx: number, row: string[]): Record<string, unknown> => {
      if (idx < 0 || !row[idx]) return {};
      try { return JSON.parse(row[idx]); } catch { return {}; }
    };

    this.cachedPhonologicalInventories = rows.map((row) => ({
      id: row[idIdx],
      languageId: row[langIdx],
      consonants: parseArr(consIdx, row),
      vowels: parseArr(vowIdx, row),
      tones: toneIdx >= 0 && row[toneIdx] && row[toneIdx] !== "null"
        ? ((): string[] | null => { try { return JSON.parse(row[toneIdx]); } catch { return null; } })()
        : null,
      phonotacticPatterns: parseObj(patIdx, row),
      syllableStructure: syllIdx >= 0 ? row[syllIdx] || "" : "",
      stressSystem: stressIdx >= 0 ? row[stressIdx] || "" : "",
    }));
  }

  /**
   * Get all phonological inventories with optional language_id filter
   */
  async getPhonologicalInventories(languageId?: string): Promise<PhonologicalInventory[]> {
    this.loadPhonologicalInventories();
    let inventories = this.cachedPhonologicalInventories ?? [];

    if (languageId) {
      inventories = inventories.filter((inv) => inv.languageId === languageId);
    }

    return inventories;
  }

  /**
   * Get a single phonological inventory by ID
   */
  async getPhonologicalInventory(id: string): Promise<PhonologicalInventory | null> {
    this.loadPhonologicalInventories();
    return (this.cachedPhonologicalInventories ?? []).find((inv) => inv.id === id) ?? null;
  }

  /**
   * Get the phonological inventory for a specific language
   */
  async getPhonologicalInventoryByLanguage(languageId: string): Promise<PhonologicalInventory | null> {
    this.loadPhonologicalInventories();
    return (this.cachedPhonologicalInventories ?? []).find((inv) => inv.languageId === languageId) ?? null;
  }

  // ============================================================================
  // Grammar Features Data Methods
  // ============================================================================

  /**
   * Load grammar features from TSV file
   */
  private loadGrammarFeatures(): void {
    if (this.cachedGrammarFeatures) return;

    const text = this.readFileIfExists("lexicons/grammar-features.tsv");
    if (!text) { this.cachedGrammarFeatures = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const langIdx = getIdx(header, "language_id");
    const wordOrderIdx = header.indexOf("word_order");
    const morphIdx = header.indexOf("morphological_type");
    const caseIdx = header.indexOf("case_system");
    const genderIdx = header.indexOf("gender_system");
    const numberIdx = header.indexOf("number_system");
    const tamIdx = header.indexOf("tense_aspect_mood");
    const agreementIdx = header.indexOf("agreement_system");
    const negationIdx = header.indexOf("negation_strategy");
    const questionIdx = header.indexOf("question_formation");
    const relClauseIdx = header.indexOf("relative_clause_strategy");
    const nounClassIdx = header.indexOf("noun_class_count");
    const valencyIdx = header.indexOf("verb_valency_changes");
    const evidentialityIdx = header.indexOf("evidentiality");
    const ergativityIdx = header.indexOf("ergativity");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedGrammarFeatures = rows.map((row) => ({
      id: row[idIdx],
      languageId: row[langIdx],
      wordOrder: wordOrderIdx >= 0 ? row[wordOrderIdx] || "" : "",
      morphologicalType: morphIdx >= 0 ? row[morphIdx] || "" : "",
      caseSystem: parseArr(caseIdx, row),
      genderSystem: parseArr(genderIdx, row),
      numberSystem: parseArr(numberIdx, row),
      tenseAspectMood: parseArr(tamIdx, row),
      agreementSystem: agreementIdx >= 0 ? row[agreementIdx] || "" : "",
      negationStrategy: negationIdx >= 0 ? row[negationIdx] || "" : "",
      questionFormation: questionIdx >= 0 ? row[questionIdx] || "" : "",
      relativeClauseStrategy: relClauseIdx >= 0 ? row[relClauseIdx] || "" : "",
      nounClassCount: nounClassIdx >= 0 ? parseInt(row[nounClassIdx] || "0", 10) || 0 : 0,
      verbValencyChanges: parseArr(valencyIdx, row),
      evidentiality: evidentialityIdx >= 0 ? row[evidentialityIdx] || "" : "",
      ergativity: ergativityIdx >= 0 ? row[ergativityIdx] || "" : "",
    }));
  }

  /**
   * Get all grammar features with optional filters
   */
  async getGrammarFeatures(languageId?: string, wordOrder?: string, morphologicalType?: string): Promise<GrammarFeatures[]> {
    this.loadGrammarFeatures();
    let features = this.cachedGrammarFeatures ?? [];

    if (languageId) {
      features = features.filter((f) => f.languageId === languageId);
    }
    if (wordOrder) {
      features = features.filter((f) => f.wordOrder === wordOrder);
    }
    if (morphologicalType) {
      features = features.filter((f) => f.morphologicalType === morphologicalType);
    }

    return features;
  }

  /**
   * Get a single grammar features entry by ID
   */
  async getGrammarFeaturesById(id: string): Promise<GrammarFeatures | null> {
    this.loadGrammarFeatures();
    return (this.cachedGrammarFeatures ?? []).find((f) => f.id === id) ?? null;
  }

  /**
   * Get grammar features for a specific language
   */
  async getGrammarFeaturesByLanguage(languageId: string): Promise<GrammarFeatures | null> {
    this.loadGrammarFeatures();
    return (this.cachedGrammarFeatures ?? []).find((f) => f.languageId === languageId) ?? null;
  }
}
