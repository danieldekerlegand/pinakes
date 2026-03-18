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

// Writing system types
export interface WritingSystem {
  id: string;
  name: string;
  type: string;
  direction: string;
  parentSystemId: string;
  languageIds: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

// Battle types
export interface Battle {
  id: string;
  name: string;
  date: string;
  coordinates: [number, number];
  belligerents: Array<{ name: string; civilization_id: string | null }>;
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

// Migration route types
export interface MigrationRoute {
  id: string;
  name: string;
  routeType: string;
  waypoints: Record<string, unknown>;
  startDate: string;
  endDate: string;
  peoples: string[];
  associatedLanguages: string[];
  description: string;
  consequences: string;
}

// Sound change types
export interface SoundChange {
  id: string;
  name: string;
  familyId: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  changeRule: string;
  environment: string;
  dateRange: string;
  examples: Array<{ before: string; after: string; meaning: string }>;
  relatedChanges: string[];
}

// Language contact types
export interface LanguageContact {
  id: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  contactType: string;
  timePeriod: string;
  region: string;
  featuresTransferred: { phonological: string[]; lexical: string[]; grammatical: string[] };
  exampleFeatures: string;
  intensity: string;
}

// Verb paradigm types
export interface VerbParadigm {
  id: string;
  languageId: string;
  verbConcept: string;
  infinitiveForm: string;
  conjugationTable: Record<string, unknown>;
  irregular: boolean;
  complexityScore: number;
  notes: string;
}

// Deity types
export interface Deity {
  id: string;
  name: string;
  nativeName: string;
  mythology: string;
  domain: string[];
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  equivalentDeityIds: string[];
  attributes: string[];
  symbols: string[];
  description: string;
  sources: string[];
}

// Myth motif types
export interface MythMotif {
  id: string;
  name: string;
  motifType: string;
  thompsonIndex: string;
  mythologyIds: string[];
  associatedDeityIds: string[];
  region: string;
  timeOrigin: number | null;
  timeEnd: number | null;
  relatedMotifIds: string[];
  description: string;
  sources: string[];
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

// Sample Text types
export interface SampleText {
  id: string;
  languageId: string;
  title: string;
  text: string;
  transliteration: string;
  translationEn: string;
  source: string;
  dateComposed: string;
  genre: string;
  script: string;
}

export interface EtymologyRelation {
  id: string;
  sourceWord: string;
  sourceLanguage: string;
  targetWord: string;
  targetLanguage: string;
  relationType: string;
}

// Material culture types
export interface MaterialCultureSpreadEvent {
  date: number;
  coordinates: [number, number];
  associatedCivilization: string;
}

export interface MaterialCulture {
  id: string;
  name: string;
  category: string;
  originDate: number;
  originCoordinates: [number, number];
  spreadData: MaterialCultureSpreadEvent[];
  description: string;
  associatedLanguages: string[];
  significance: string;
}

export interface FoodwayEvent {
  id: string;
  name: string;
  foodItem: string;
  originRegion: string;
  originCoordinates: [number, number];
  destinationRegion: string;
  destinationCoordinates: [number, number];
  date: number;
  mechanism: string;
  associatedRouteId: string;
  description: string;
  culturalImpact: string;
}

// Art tradition types
export interface ArtTradition {
  id: string;
  name: string;
  category: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
}

// Trade good types
export interface TradeGood {
  id: string;
  name: string;
  category: string;
  originRegion: string;
  originCoordinates: { lat: number; lng: number };
  tradeRoutes: string[];
  timePeriod: string;
  economicSignificance: string;
  associatedLanguages: string[];
}

// Kinship system types
export interface KinshipSystem {
  id: string;
  systemType: string;
  languageIds: string[];
  terminology: Record<string, string>;
  descentRule: string;
  residenceRule: string;
  associatedCivilizations: string;
}

// Narrative types
export interface NarrativeStep {
  text: string;
  mapCenter: [number, number];
  mapZoom: number;
  timePoint: number;
  highlightedEntities: string[];
  layerConfig: { layers: string[] };
}

export interface Narrative {
  id: string;
  title: string;
  description: string;
  steps: NarrativeStep[];
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
  private cachedMaterialCultures: MaterialCulture[] | null = null;

  // Haplogroup data cache
  private cachedHaplogroups: Haplogroup[] | null = null;

  // Music data caches
  private cachedMusicTraditions: MusicTradition[] | null = null;
  private cachedMusicalInstruments: MusicalInstrument[] | null = null;

  // Deity data cache
  private cachedDeities: Deity[] | null = null;

  // Myth motif data cache
  private cachedMythMotifs: MythMotif[] | null = null;

  // Religion data cache
  private cachedReligions: Religion[] | null = null;

  // Phonological inventory data cache
  private cachedPhonologicalInventories: PhonologicalInventory[] | null = null;

  // Grammar features data cache
  private cachedGrammarFeatures: GrammarFeatures[] | null = null;

  // Writing systems data cache
  private cachedWritingSystems: WritingSystem[] | null = null;

  // Verb paradigms data cache
  private cachedVerbParadigms: VerbParadigm[] | null = null;

  // Battles data cache
  private cachedBattles: Battle[] | null = null;

  // Migration routes data cache
  private cachedMigrationRoutes: MigrationRoute[] | null = null;

  // Language contacts data cache
  private cachedLanguageContacts: LanguageContact[] | null = null;

  // Sound change data cache
  private cachedSoundChanges: SoundChange[] | null = null;

  // Foodway events data cache
  private cachedFoodwayEvents: FoodwayEvent[] | null = null;

  // Art traditions data cache
  private cachedArtTraditions: ArtTradition[] | null = null;

  // Trade goods data cache
  private cachedTradeGoods: TradeGood[] | null = null;

  // Kinship systems data cache
  private cachedKinshipSystems: KinshipSystem[] | null = null;

  // Narratives data cache
  private cachedNarratives: Narrative[] | null = null;

  // Cuisine data caches
  private cachedCuisines: Cuisine[] | null = null;
  private cachedCuisineItems: CuisineItem[] | null = null;

  // Sample Texts
  private cachedSampleTexts: SampleText[] | null = null;

  // Etymology Relations
  private cachedEtymologyRelations: EtymologyRelation[] | null = null;

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
   * Load material culture data from TSV file
   */
  private loadMaterialCultures(): void {
    if (this.cachedMaterialCultures) return;

    const text = this.readFileIfExists("lexicons/material-culture.tsv");
    if (!text) { this.cachedMaterialCultures = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const categoryIdx = getIdx(header, "category");
    const originDateIdx = getIdx(header, "origin_date");
    const originCoordsIdx = getIdx(header, "origin_coordinates");
    const spreadIdx = getIdx(header, "spread_data");
    const descIdx = header.indexOf("description");
    const langIdx = header.indexOf("associated_languages");
    const sigIdx = header.indexOf("significance");

    this.cachedMaterialCultures = rows.map((row) => {
      let originCoords: [number, number] = [0, 0];
      try { originCoords = JSON.parse(row[originCoordsIdx]); } catch {}

      let spreadData: MaterialCultureSpreadEvent[] = [];
      try {
        spreadData = JSON.parse(row[spreadIdx]).map((e: any) => ({
          date: e.date,
          coordinates: e.coordinates as [number, number],
          associatedCivilization: e.associated_civilization || "",
        }));
      } catch {}

      const langStr = langIdx >= 0 ? row[langIdx] || "" : "";
      const associatedLanguages = langStr ? langStr.split(",").map((s: string) => s.trim()) : [];

      return {
        id: row[idIdx],
        name: row[nameIdx],
        category: row[categoryIdx] || "unknown",
        originDate: parseInt(row[originDateIdx], 10) || 0,
        originCoordinates: originCoords,
        spreadData,
        description: descIdx >= 0 ? row[descIdx] || "" : "",
        associatedLanguages,
        significance: sigIdx >= 0 ? row[sigIdx] || "" : "",
      };
    });
  }

  /**
   * Get all material cultures with optional category filter
   */
  async getMaterialCultures(filters?: {
    category?: string;
  }): Promise<MaterialCulture[]> {
    this.loadMaterialCultures();
    let items = this.cachedMaterialCultures ?? [];

    if (filters?.category) {
      items = items.filter((mc) => mc.category === filters.category);
    }

    return items;
  }

  /**
   * Get a single material culture by ID
   */
  async getMaterialCultureById(id: string): Promise<MaterialCulture | null> {
    this.loadMaterialCultures();
    return (this.cachedMaterialCultures ?? []).find((mc) => mc.id === id) ?? null;
  }

  /**
   * Get material culture distributions for heatmap
   */
  async getMaterialCultureDistributions(filters?: {
    timeStart?: number;
    timeEnd?: number;
    bbox?: string;
    cultureTypes?: string[];
  }): Promise<MaterialCultureDistribution[]> {
    this.loadMaterialCultures();
    const cultures = this.cachedMaterialCultures ?? [];

    const distributions: MaterialCultureDistribution[] = [];

    for (const mc of cultures) {
      if (filters?.cultureTypes && filters.cultureTypes.length > 0) {
        if (!filters.cultureTypes.includes(mc.category)) continue;
      }

      // Add origin point
      const originInRange =
        (!filters?.timeStart || mc.originDate >= filters.timeStart) &&
        (!filters?.timeEnd || mc.originDate <= filters.timeEnd);

      if (originInRange) {
        distributions.push({
          lat: mc.originCoordinates[0],
          lng: mc.originCoordinates[1],
          intensity: 1.0,
          cultureId: mc.id,
          timePeriod: {
            start: mc.originDate,
            end: mc.spreadData.length > 0
              ? mc.spreadData[mc.spreadData.length - 1].date
              : null,
            label: mc.name,
          },
        });
      }

      // Add spread points
      for (const spread of mc.spreadData) {
        const inRange =
          (!filters?.timeStart || spread.date >= filters.timeStart) &&
          (!filters?.timeEnd || spread.date <= filters.timeEnd);

        if (inRange) {
          // Intensity decreases with distance from origin in time
          const timeDiff = Math.abs(spread.date - mc.originDate);
          const intensity = Math.max(0.2, 1.0 - timeDiff / 10000);

          distributions.push({
            lat: spread.coordinates[0],
            lng: spread.coordinates[1],
            intensity,
            cultureId: mc.id,
            timePeriod: {
              start: spread.date,
              end: null,
              label: `${mc.name} - ${spread.associatedCivilization}`,
            },
          });
        }
      }
    }

    return distributions;
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
  // Deity Data Methods
  // ============================================================================

  private loadDeities(): void {
    if (this.cachedDeities) return;

    const text = this.readFileIfExists("lexicons/deities.tsv");
    if (!text) { this.cachedDeities = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const nativeIdx = header.indexOf("native_name");
    const mythIdx = header.indexOf("mythology");
    const domainIdx = header.indexOf("domain");
    const coordsIdx = header.indexOf("coordinates");
    const startIdx = header.indexOf("time_origin");
    const endIdx = header.indexOf("time_end");
    const langIdx = header.indexOf("associated_language_ids");
    const equivIdx = header.indexOf("equivalent_deity_ids");
    const attrIdx = header.indexOf("attributes");
    const symbolIdx = header.indexOf("symbols");
    const descIdx = header.indexOf("description");
    const srcIdx = header.indexOf("sources");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedDeities = rows.map((row) => {
      let coords = { lat: 0, lng: 0 };
      if (coordsIdx >= 0 && row[coordsIdx]) {
        try { coords = JSON.parse(row[coordsIdx]); } catch {}
      }

      return {
        id: row[idIdx],
        name: row[nameIdx],
        nativeName: nativeIdx >= 0 ? row[nativeIdx] || "" : "",
        mythology: mythIdx >= 0 ? row[mythIdx] || "" : "",
        domain: domainIdx >= 0 && row[domainIdx] ? row[domainIdx].split(",") : [],
        coordinates: coords,
        timeOrigin: startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
          ? parseInt(row[startIdx], 10) : null,
        timeEnd: endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
          ? parseInt(row[endIdx], 10) : null,
        associatedLanguageIds: parseArr(langIdx, row),
        equivalentDeityIds: parseArr(equivIdx, row),
        attributes: parseArr(attrIdx, row),
        symbols: parseArr(symbolIdx, row),
        description: descIdx >= 0 ? row[descIdx] || "" : "",
        sources: parseArr(srcIdx, row),
      };
    });
  }

  async getDeities(filters?: {
    mythology?: string;
    domain?: string;
    year?: number;
  }): Promise<Deity[]> {
    this.loadDeities();
    let deities = this.cachedDeities ?? [];

    if (filters?.mythology) {
      deities = deities.filter((d) =>
        d.mythology.toLowerCase() === filters.mythology!.toLowerCase()
      );
    }

    if (filters?.domain) {
      deities = deities.filter((d) =>
        d.domain.some((dom) => dom.toLowerCase().includes(filters.domain!.toLowerCase()))
      );
    }

    if (filters?.year !== undefined) {
      deities = deities.filter((d) => {
        const start = d.timeOrigin ?? -Infinity;
        const end = d.timeEnd ?? Infinity;
        return filters.year! >= start && filters.year! <= end;
      });
    }

    return deities;
  }

  async getDeity(deityId: string): Promise<Deity | null> {
    this.loadDeities();
    return (this.cachedDeities ?? []).find((d) => d.id === deityId) ?? null;
  }

  // ============================================================================
  // Myth Motif Data Methods
  // ============================================================================

  private loadMythMotifs(): void {
    if (this.cachedMythMotifs) return;

    const text = this.readFileIfExists("lexicons/myth-motifs.tsv");
    if (!text) { this.cachedMythMotifs = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const typeIdx = header.indexOf("motif_type");
    const thompsonIdx = header.indexOf("thompson_index");
    const mythIdx = header.indexOf("mythology_ids");
    const deityIdx = header.indexOf("associated_deity_ids");
    const regionIdx = header.indexOf("region");
    const startIdx = header.indexOf("time_origin");
    const endIdx = header.indexOf("time_end");
    const relatedIdx = header.indexOf("related_motif_ids");
    const descIdx = header.indexOf("description");
    const srcIdx = header.indexOf("sources");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedMythMotifs = rows.map((row) => ({
      id: row[idIdx],
      name: row[nameIdx],
      motifType: typeIdx >= 0 ? row[typeIdx] || "" : "",
      thompsonIndex: thompsonIdx >= 0 ? row[thompsonIdx] || "" : "",
      mythologyIds: parseArr(mythIdx, row),
      associatedDeityIds: parseArr(deityIdx, row),
      region: regionIdx >= 0 ? row[regionIdx] || "" : "",
      timeOrigin: startIdx >= 0 && row[startIdx] && row[startIdx] !== "null"
        ? parseInt(row[startIdx], 10) : null,
      timeEnd: endIdx >= 0 && row[endIdx] && row[endIdx] !== "null"
        ? parseInt(row[endIdx], 10) : null,
      relatedMotifIds: parseArr(relatedIdx, row),
      description: descIdx >= 0 ? row[descIdx] || "" : "",
      sources: parseArr(srcIdx, row),
    }));
  }

  async getMythMotifs(filters?: {
    motifType?: string;
    mythology?: string;
    region?: string;
  }): Promise<MythMotif[]> {
    this.loadMythMotifs();
    let motifs = this.cachedMythMotifs ?? [];

    if (filters?.motifType) {
      motifs = motifs.filter((m) => m.motifType === filters.motifType);
    }

    if (filters?.mythology) {
      motifs = motifs.filter((m) =>
        m.mythologyIds.some((id) => id.toLowerCase().includes(filters.mythology!.toLowerCase()))
      );
    }

    if (filters?.region) {
      motifs = motifs.filter((m) =>
        m.region.toLowerCase().includes(filters.region!.toLowerCase())
      );
    }

    return motifs;
  }

  async getMythMotif(motifId: string): Promise<MythMotif | null> {
    this.loadMythMotifs();
    return (this.cachedMythMotifs ?? []).find((m) => m.id === motifId) ?? null;
  }

  async getDeityEquivalents(deityId: string): Promise<Deity[]> {
    this.loadDeities();
    const deity = (this.cachedDeities ?? []).find((d) => d.id === deityId);
    if (!deity) return [];
    return (this.cachedDeities ?? []).filter((d) =>
      deity.equivalentDeityIds.includes(d.id)
    );
  }

  async getMotifsByDeity(deityId: string): Promise<MythMotif[]> {
    this.loadMythMotifs();
    return (this.cachedMythMotifs ?? []).filter((m) =>
      m.associatedDeityIds.includes(deityId)
    );
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
  // Sample Text Data Methods
  // ============================================================================

  /**
   * Load sample texts from TSV file
   */
  private loadSampleTexts(): void {
    if (this.cachedSampleTexts) return;

    const text = this.readFileIfExists("lexicons/sample-texts.tsv");
    if (!text) { this.cachedSampleTexts = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const langIdx = getIdx(header, "language_id");
    const titleIdx = header.indexOf("title");
    const textIdx = header.indexOf("text");
    const translitIdx = header.indexOf("transliteration");
    const transEnIdx = header.indexOf("translation_en");
    const sourceIdx = header.indexOf("source");
    const dateIdx = header.indexOf("date_composed");
    const genreIdx = header.indexOf("genre");
    const scriptIdx = header.indexOf("script");

    this.cachedSampleTexts = rows.map((row) => ({
      id: row[idIdx],
      languageId: row[langIdx],
      title: titleIdx >= 0 ? row[titleIdx] || "" : "",
      text: textIdx >= 0 ? row[textIdx] || "" : "",
      transliteration: translitIdx >= 0 ? (row[translitIdx] || "").trim() : "",
      translationEn: transEnIdx >= 0 ? row[transEnIdx] || "" : "",
      source: sourceIdx >= 0 ? row[sourceIdx] || "" : "",
      dateComposed: dateIdx >= 0 ? row[dateIdx] || "" : "",
      genre: genreIdx >= 0 ? row[genreIdx] || "" : "",
      script: scriptIdx >= 0 ? row[scriptIdx] || "" : "",
    }));
  }

  // ============================================================================
  // Phonological Inventory Data Methods
  // ============================================================================

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
   * Get sample texts with optional filtering
   */
  async getSampleTexts(filters?: {
    languageId?: string;
    genre?: string;
    script?: string;
  }): Promise<SampleText[]> {
    this.loadSampleTexts();
    let texts = this.cachedSampleTexts ?? [];

    if (filters?.languageId) {
      texts = texts.filter((t) => t.languageId === filters.languageId);
    }

    if (filters?.genre) {
      texts = texts.filter((t) =>
        t.genre.toLowerCase() === filters.genre!.toLowerCase()
      );
    }

    if (filters?.script) {
      texts = texts.filter((t) =>
        t.script.toLowerCase() === filters.script!.toLowerCase()
      );
    }

    return texts;
  }

  /**
   * Get a single sample text by ID
   */
  async getSampleText(id: string): Promise<SampleText | null> {
    this.loadSampleTexts();
    return (this.cachedSampleTexts ?? []).find((t) => t.id === id) ?? null;
  }

  // ===========================================================================
  // Etymology Relations
  // ===========================================================================

  /**
   * Load etymology relations from TSV file
   */
  private loadEtymologyRelations(): void {
    if (this.cachedEtymologyRelations) return;

    const text = this.readFileIfExists("lexicons/etymology-relations.tsv");
    if (!text) { this.cachedEtymologyRelations = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const srcWordIdx = getIdx(header, "source_word");
    const srcLangIdx = getIdx(header, "source_language");
    const tgtWordIdx = getIdx(header, "target_word");
    const tgtLangIdx = getIdx(header, "target_language");
    const relTypeIdx = getIdx(header, "relation_type");

    this.cachedEtymologyRelations = rows.map((row) => ({
      id: row[idIdx],
      sourceWord: row[srcWordIdx],
      sourceLanguage: row[srcLangIdx],
      targetWord: row[tgtWordIdx],
      targetLanguage: row[tgtLangIdx],
      relationType: row[relTypeIdx],
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
   * Get etymology relations with optional filtering
   */
  async getEtymologyRelations(filters?: {
    sourceLanguage?: string;
    targetLanguage?: string;
    relationType?: string;
  }): Promise<EtymologyRelation[]> {
    this.loadEtymologyRelations();
    let relations = this.cachedEtymologyRelations ?? [];

    if (filters?.sourceLanguage) {
      relations = relations.filter((r) => r.sourceLanguage === filters.sourceLanguage);
    }

    if (filters?.targetLanguage) {
      relations = relations.filter((r) => r.targetLanguage === filters.targetLanguage);
    }

    if (filters?.relationType) {
      relations = relations.filter((r) =>
        r.relationType.toLowerCase() === filters.relationType!.toLowerCase()
      );
    }

    return relations;
  }

  /**
   * Get all etymology relations for a given word (as source or target)
   */
  async getEtymologyRelationsForWord(word: string): Promise<EtymologyRelation[]> {
    this.loadEtymologyRelations();
    const normalizedWord = word.toLowerCase();
    return (this.cachedEtymologyRelations ?? []).filter(
      (r) => r.sourceWord.toLowerCase() === normalizedWord ||
             r.targetWord.toLowerCase() === normalizedWord
    );
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

  /**
   * Load writing systems from TSV file
   */
  private loadWritingSystems(): void {
    if (this.cachedWritingSystems) return;

    const text = this.readFileIfExists("lexicons/writing-systems.tsv");
    if (!text) { this.cachedWritingSystems = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const typeIdx = header.indexOf("type");
    const directionIdx = header.indexOf("direction");
    const parentIdx = header.indexOf("parent_system_id");
    const langIdsIdx = header.indexOf("language_ids");
    const originDateIdx = header.indexOf("origin_date");
    const originRegionIdx = header.indexOf("origin_region");
    const charCountIdx = header.indexOf("character_count");
    const sampleIdx = header.indexOf("sample_characters");
    const unicodeIdx = header.indexOf("unicode_block");
    const activeIdx = header.indexOf("is_active");

    const parseArr = (idx: number, row: string[]): string[] => {
      if (idx < 0 || !row[idx]) return [];
      try { return JSON.parse(row[idx]); } catch { return []; }
    };

    this.cachedWritingSystems = rows.map((row) => ({
      id: row[idIdx],
      name: row[nameIdx],
      type: typeIdx >= 0 ? row[typeIdx] || "" : "",
      direction: directionIdx >= 0 ? row[directionIdx] || "" : "",
      parentSystemId: parentIdx >= 0 ? row[parentIdx] || "" : "",
      languageIds: parseArr(langIdsIdx, row),
      originDate: originDateIdx >= 0 ? row[originDateIdx] || "" : "",
      originRegion: originRegionIdx >= 0 ? row[originRegionIdx] || "" : "",
      characterCount: charCountIdx >= 0 ? parseInt(row[charCountIdx] || "0", 10) || 0 : 0,
      sampleCharacters: sampleIdx >= 0 ? row[sampleIdx] || "" : "",
      unicodeBlock: unicodeIdx >= 0 ? row[unicodeIdx] || "" : "",
      isActive: activeIdx >= 0 ? row[activeIdx] === "true" : false,
    }));
  }

  /**
   * Get all writing systems with optional filters
   */
  async getWritingSystems(type?: string, direction?: string, isActive?: string): Promise<WritingSystem[]> {
    this.loadWritingSystems();
    let systems = this.cachedWritingSystems ?? [];

    if (type) {
      systems = systems.filter((s) => s.type === type);
    }
    if (direction) {
      systems = systems.filter((s) => s.direction === direction);
    }
    if (isActive !== undefined) {
      const active = isActive === "true";
      systems = systems.filter((s) => s.isActive === active);
    }

    return systems;
  }

  /**
   * Get a single writing system by ID
   */
  async getWritingSystemById(id: string): Promise<WritingSystem | null> {
    this.loadWritingSystems();
    return (this.cachedWritingSystems ?? []).find((s) => s.id === id) ?? null;
  }

  /**
   * Get all writing systems descended from a given system
   */
  async getWritingSystemDescendants(id: string): Promise<WritingSystem[]> {
    this.loadWritingSystems();
    const all = this.cachedWritingSystems ?? [];
    const descendants: WritingSystem[] = [];
    const queue = [id];

    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = all.filter((s) => s.parentSystemId === parentId);
      for (const child of children) {
        descendants.push(child);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  /**
   * Load verb paradigms from TSV file
   */
  private loadVerbParadigms(): void {
    if (this.cachedVerbParadigms) return;

    const text = this.readFileIfExists("lexicons/verb-paradigms.tsv");
    if (!text) { this.cachedVerbParadigms = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const langIdx = getIdx(header, "language_id");
    const conceptIdx = header.indexOf("verb_concept");
    const infinitiveIdx = header.indexOf("infinitive_form");
    const conjugationIdx = header.indexOf("conjugation_table");
    const irregularIdx = header.indexOf("irregular");
    const complexityIdx = header.indexOf("complexity_score");
    const notesIdx = header.indexOf("notes");

    this.cachedVerbParadigms = rows.map((row) => ({
      id: row[idIdx],
      languageId: row[langIdx],
      verbConcept: conceptIdx >= 0 ? row[conceptIdx] || "" : "",
      infinitiveForm: infinitiveIdx >= 0 ? row[infinitiveIdx] || "" : "",
      conjugationTable: (() => {
        if (conjugationIdx < 0 || !row[conjugationIdx]) return {};
        try { return JSON.parse(row[conjugationIdx]); } catch { return {}; }
      })(),
      irregular: irregularIdx >= 0 ? row[irregularIdx] === "true" : false,
      complexityScore: complexityIdx >= 0 ? parseInt(row[complexityIdx] || "0", 10) || 0 : 0,
      notes: notesIdx >= 0 ? row[notesIdx] || "" : "",
    }));
  }

  /**
   * Get all verb paradigms with optional filters
   */
  async getVerbParadigms(languageId?: string, verbConcept?: string): Promise<VerbParadigm[]> {
    this.loadVerbParadigms();
    let paradigms = this.cachedVerbParadigms ?? [];

    if (languageId) {
      paradigms = paradigms.filter((p) => p.languageId === languageId);
    }
    if (verbConcept) {
      paradigms = paradigms.filter((p) => p.verbConcept === verbConcept);
    }

    return paradigms;
  }

  /**
   * Get a single verb paradigm by ID
   */
  async getVerbParadigmById(id: string): Promise<VerbParadigm | null> {
    this.loadVerbParadigms();
    return (this.cachedVerbParadigms ?? []).find((p) => p.id === id) ?? null;
  }

  /**
   * Get verb paradigms for a specific language
   */
  async getVerbParadigmsByLanguage(languageId: string): Promise<VerbParadigm[]> {
    this.loadVerbParadigms();
    return (this.cachedVerbParadigms ?? []).filter((p) => p.languageId === languageId);
  }

  // ── Battles ─────────────────────────────────────────────────────────

  private loadBattles(): void {
    if (this.cachedBattles) return;

    const text = this.readFileIfExists("lexicons/battles.tsv");
    if (!text) { this.cachedBattles = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = header.indexOf("name");
    const dateIdx = header.indexOf("date");
    const coordIdx = header.indexOf("coordinates");
    const bellIdx = header.indexOf("belligerents");
    const outcomeIdx = header.indexOf("outcome");
    const casualtiesIdx = header.indexOf("casualties_estimate");
    const sigIdx = header.indexOf("significance");
    const langChangeIdx = header.indexOf("associated_language_changes");
    const warIdx = header.indexOf("war_name");

    this.cachedBattles = rows.map((row) => ({
      id: row[idIdx],
      name: nameIdx >= 0 ? row[nameIdx] || "" : "",
      date: dateIdx >= 0 ? row[dateIdx] || "" : "",
      coordinates: (() => {
        if (coordIdx < 0 || !row[coordIdx]) return [0, 0] as [number, number];
        try { return JSON.parse(row[coordIdx]) as [number, number]; } catch { return [0, 0] as [number, number]; }
      })(),
      belligerents: (() => {
        if (bellIdx < 0 || !row[bellIdx]) return [];
        try { return JSON.parse(row[bellIdx]); } catch { return []; }
      })(),
      outcome: outcomeIdx >= 0 ? row[outcomeIdx] || "" : "",
      casualtiesEstimate: casualtiesIdx >= 0 ? row[casualtiesIdx] || "" : "",
      significance: sigIdx >= 0 ? row[sigIdx] || "" : "",
      associatedLanguageChanges: langChangeIdx >= 0 ? row[langChangeIdx] || "" : "",
      warName: warIdx >= 0 ? row[warIdx] || "" : "",
    }));
  }

  async getBattles(warName?: string, startDate?: string, endDate?: string, civilizationId?: string): Promise<Battle[]> {
    this.loadBattles();
    let battles = this.cachedBattles ?? [];

    if (warName) {
      battles = battles.filter((b) => b.warName === warName);
    }
    if (startDate) {
      battles = battles.filter((b) => parseInt(b.date) >= parseInt(startDate));
    }
    if (endDate) {
      battles = battles.filter((b) => parseInt(b.date) <= parseInt(endDate));
    }
    if (civilizationId) {
      battles = battles.filter((b) =>
        b.belligerents.some((belt) => belt.civilization_id === civilizationId)
      );
    }

    return battles;
  }

  async getBattleById(id: string): Promise<Battle | null> {
    this.loadBattles();
    return (this.cachedBattles ?? []).find((b) => b.id === id) ?? null;
  }

  // ── Migration Routes ──────────────────────────────────────────────

  private loadMigrationRoutes(): void {
    if (this.cachedMigrationRoutes) return;

    const text = this.readFileIfExists("lexicons/migration-routes.tsv");
    if (!text) { this.cachedMigrationRoutes = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = header.indexOf("name");
    const routeTypeIdx = header.indexOf("route_type");
    const waypointsIdx = header.indexOf("waypoints");
    const startDateIdx = header.indexOf("start_date");
    const endDateIdx = header.indexOf("end_date");
    const peoplesIdx = header.indexOf("peoples");
    const langIdx = header.indexOf("associated_languages");
    const descIdx = header.indexOf("description");
    const consequencesIdx = header.indexOf("consequences");

    this.cachedMigrationRoutes = rows.map((row) => ({
      id: row[idIdx],
      name: nameIdx >= 0 ? row[nameIdx] || "" : "",
      routeType: routeTypeIdx >= 0 ? row[routeTypeIdx] || "" : "",
      waypoints: (() => {
        if (waypointsIdx < 0 || !row[waypointsIdx]) return {};
        try { return JSON.parse(row[waypointsIdx]); } catch { return {}; }
      })(),
      startDate: startDateIdx >= 0 ? row[startDateIdx] || "" : "",
      endDate: endDateIdx >= 0 ? row[endDateIdx] || "" : "",
      peoples: (() => {
        if (peoplesIdx < 0 || !row[peoplesIdx]) return [];
        try { return JSON.parse(row[peoplesIdx]); } catch { return []; }
      })(),
      associatedLanguages: (() => {
        if (langIdx < 0 || !row[langIdx]) return [];
        try { return JSON.parse(row[langIdx]); } catch { return []; }
      })(),
      description: descIdx >= 0 ? row[descIdx] || "" : "",
      consequences: consequencesIdx >= 0 ? row[consequencesIdx] || "" : "",
    }));
  }

  async getMigrationRoutes(routeType?: string, startDate?: string, endDate?: string): Promise<MigrationRoute[]> {
    this.loadMigrationRoutes();
    let routes = this.cachedMigrationRoutes ?? [];

    if (routeType) {
      routes = routes.filter((r) => r.routeType === routeType);
    }
    if (startDate) {
      routes = routes.filter((r) => r.startDate >= startDate);
    }
    if (endDate) {
      routes = routes.filter((r) => r.endDate <= endDate);
    }

    return routes;
  }

  async getMigrationRouteById(id: string): Promise<MigrationRoute | null> {
    this.loadMigrationRoutes();
    return (this.cachedMigrationRoutes ?? []).find((r) => r.id === id) ?? null;
  }

  // ── Language Contacts ──────────────────────────────────────────────

  private loadLanguageContacts(): void {
    if (this.cachedLanguageContacts) return;

    const text = this.readFileIfExists("lexicons/language-contacts.tsv");
    if (!text) { this.cachedLanguageContacts = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const srcIdx = header.indexOf("source_language_id");
    const tgtIdx = header.indexOf("target_language_id");
    const typeIdx = header.indexOf("contact_type");
    const periodIdx = header.indexOf("time_period");
    const regionIdx = header.indexOf("region");
    const featIdx = header.indexOf("features_transferred");
    const exampleIdx = header.indexOf("example_features");
    const intensityIdx = header.indexOf("intensity");

    this.cachedLanguageContacts = rows.map((row) => ({
      id: row[idIdx],
      sourceLanguageId: srcIdx >= 0 ? row[srcIdx] || "" : "",
      targetLanguageId: tgtIdx >= 0 ? row[tgtIdx] || "" : "",
      contactType: typeIdx >= 0 ? row[typeIdx] || "" : "",
      timePeriod: periodIdx >= 0 ? row[periodIdx] || "" : "",
      region: regionIdx >= 0 ? row[regionIdx] || "" : "",
      featuresTransferred: (() => {
        if (featIdx < 0 || !row[featIdx]) return { phonological: [], lexical: [], grammatical: [] };
        try { return JSON.parse(row[featIdx]); } catch { return { phonological: [], lexical: [], grammatical: [] }; }
      })(),
      exampleFeatures: exampleIdx >= 0 ? row[exampleIdx] || "" : "",
      intensity: intensityIdx >= 0 ? row[intensityIdx] || "" : "",
    }));
  }

  async getLanguageContacts(sourceLanguageId?: string, targetLanguageId?: string, contactType?: string, intensity?: string): Promise<LanguageContact[]> {
    this.loadLanguageContacts();
    let contacts = this.cachedLanguageContacts ?? [];

    if (sourceLanguageId) {
      contacts = contacts.filter((c) => c.sourceLanguageId === sourceLanguageId);
    }
    if (targetLanguageId) {
      contacts = contacts.filter((c) => c.targetLanguageId === targetLanguageId);
    }
    if (contactType) {
      contacts = contacts.filter((c) => c.contactType === contactType);
    }
    if (intensity) {
      contacts = contacts.filter((c) => c.intensity === intensity);
    }

    return contacts;
  }

  async getLanguageContactById(id: string): Promise<LanguageContact | null> {
    this.loadLanguageContacts();
    return (this.cachedLanguageContacts ?? []).find((c) => c.id === id) ?? null;
  }

  async getLanguageContactsByLanguage(languageId: string): Promise<LanguageContact[]> {
    this.loadLanguageContacts();
    return (this.cachedLanguageContacts ?? []).filter(
      (c) => c.sourceLanguageId === languageId || c.targetLanguageId === languageId
    );
  }

  // ── Sound Changes ──────────────────────────────────────────────────

  private loadSoundChanges(): void {
    if (this.cachedSoundChanges) return;

    const text = this.readFileIfExists("lexicons/sound-changes.tsv");
    if (!text) { this.cachedSoundChanges = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = header.indexOf("name");
    const familyIdx = header.indexOf("family_id");
    const srcIdx = header.indexOf("source_language_id");
    const tgtIdx = header.indexOf("target_language_id");
    const ruleIdx = header.indexOf("change_rule");
    const envIdx = header.indexOf("environment");
    const dateIdx = header.indexOf("date_range");
    const exIdx = header.indexOf("examples");
    const relIdx = header.indexOf("related_changes");

    this.cachedSoundChanges = rows.map((row) => ({
      id: row[idIdx],
      name: nameIdx >= 0 ? row[nameIdx] || "" : "",
      familyId: familyIdx >= 0 ? row[familyIdx] || "" : "",
      sourceLanguageId: srcIdx >= 0 ? row[srcIdx] || "" : "",
      targetLanguageId: tgtIdx >= 0 ? row[tgtIdx] || "" : "",
      changeRule: ruleIdx >= 0 ? row[ruleIdx] || "" : "",
      environment: envIdx >= 0 ? row[envIdx] || "" : "",
      dateRange: dateIdx >= 0 ? row[dateIdx] || "" : "",
      examples: (() => {
        if (exIdx < 0 || !row[exIdx]) return [];
        try { return JSON.parse(row[exIdx]); } catch { return []; }
      })(),
      relatedChanges: (() => {
        if (relIdx < 0 || !row[relIdx]) return [];
        try { return JSON.parse(row[relIdx]); } catch { return []; }
      })(),
    }));
  }

  async getSoundChanges(familyId?: string, sourceLanguageId?: string, targetLanguageId?: string): Promise<SoundChange[]> {
    this.loadSoundChanges();
    let changes = this.cachedSoundChanges ?? [];

    if (familyId) {
      changes = changes.filter((c) => c.familyId === familyId);
    }
    if (sourceLanguageId) {
      changes = changes.filter((c) => c.sourceLanguageId === sourceLanguageId);
    }
    if (targetLanguageId) {
      changes = changes.filter((c) => c.targetLanguageId === targetLanguageId);
    }

    return changes;
  }

  async getSoundChangeById(id: string): Promise<SoundChange | null> {
    this.loadSoundChanges();
    return (this.cachedSoundChanges ?? []).find((c) => c.id === id) ?? null;
  }

  // ── Foodway Events ──────────────────────────────────────────────────

  private loadFoodwayEvents(): void {
    if (this.cachedFoodwayEvents) return;

    const text = this.readFileIfExists("lexicons/foodway-events.tsv");
    if (!text) { this.cachedFoodwayEvents = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const foodItemIdx = getIdx(header, "food_item");
    const originRegionIdx = getIdx(header, "origin_region");
    const originCoordsIdx = getIdx(header, "origin_coordinates");
    const destRegionIdx = getIdx(header, "destination_region");
    const destCoordsIdx = getIdx(header, "destination_coordinates");
    const dateIdx = getIdx(header, "date");
    const mechanismIdx = header.indexOf("mechanism");
    const routeIdIdx = header.indexOf("associated_route_id");
    const descIdx = header.indexOf("description");
    const impactIdx = header.indexOf("cultural_impact");

    this.cachedFoodwayEvents = rows.map((row) => ({
      id: row[idIdx],
      name: row[nameIdx],
      foodItem: row[foodItemIdx],
      originRegion: row[originRegionIdx],
      originCoordinates: (() => {
        try { return JSON.parse(row[originCoordsIdx]); } catch { return [0, 0]; }
      })() as [number, number],
      destinationRegion: row[destRegionIdx],
      destinationCoordinates: (() => {
        try { return JSON.parse(row[destCoordsIdx]); } catch { return [0, 0]; }
      })() as [number, number],
      date: parseInt(row[dateIdx], 10) || 0,
      mechanism: mechanismIdx >= 0 ? row[mechanismIdx] || "" : "",
      associatedRouteId: routeIdIdx >= 0 ? row[routeIdIdx] || "" : "",
      description: descIdx >= 0 ? row[descIdx] || "" : "",
      culturalImpact: impactIdx >= 0 ? row[impactIdx] || "" : "",
    }));
  }

  async getFoodwayEvents(filters?: {
    foodItem?: string;
    mechanism?: string;
    dateStart?: number;
    dateEnd?: number;
  }): Promise<FoodwayEvent[]> {
    this.loadFoodwayEvents();
    let events = this.cachedFoodwayEvents ?? [];

    if (filters?.foodItem) {
      events = events.filter((e) => e.foodItem.toLowerCase().includes(filters.foodItem!.toLowerCase()));
    }
    if (filters?.mechanism) {
      events = events.filter((e) => e.mechanism === filters.mechanism);
    }
    if (filters?.dateStart !== undefined) {
      events = events.filter((e) => e.date >= filters.dateStart!);
    }
    if (filters?.dateEnd !== undefined) {
      events = events.filter((e) => e.date <= filters.dateEnd!);
    }

    return events;
  }

  async getFoodwayEventById(id: string): Promise<FoodwayEvent | null> {
    this.loadFoodwayEvents();
    return (this.cachedFoodwayEvents ?? []).find((e) => e.id === id) ?? null;
  }

  // ── Kinship Systems ──────────────────────────────────────────────────

  private loadArtTraditions(): void {
    if (this.cachedArtTraditions) return;

    const text = this.readFileIfExists("lexicons/art-traditions.tsv");
    if (!text) { this.cachedArtTraditions = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const categoryIdx = getIdx(header, "category");
    const stylePeriodIdx = getIdx(header, "style_period");
    const originDateIdx = getIdx(header, "origin_date");
    const endDateIdx = getIdx(header, "end_date");
    const coordsIdx = getIdx(header, "origin_coordinates");
    const descIdx = getIdx(header, "description");
    const civIdx = header.indexOf("associated_civilizations");
    const langIdx = getIdx(header, "associated_languages");
    const featIdx = getIdx(header, "key_features");
    const examplesIdx = getIdx(header, "notable_examples");

    this.cachedArtTraditions = rows.map((row) => ({
      id: row[idIdx],
      name: row[nameIdx],
      category: row[categoryIdx],
      stylePeriod: row[stylePeriodIdx],
      originDate: parseInt(row[originDateIdx]) || 0,
      endDate: parseInt(row[endDateIdx]) || 0,
      originCoordinates: (() => {
        try { return JSON.parse(row[coordsIdx]); } catch { return { lat: 0, lng: 0 }; }
      })() as { lat: number; lng: number },
      description: row[descIdx],
      associatedCivilizations: civIdx >= 0 ? row[civIdx] || "" : "",
      associatedLanguages: (() => {
        try { return JSON.parse(row[langIdx]); } catch { return []; }
      })() as string[],
      keyFeatures: (() => {
        try { return JSON.parse(row[featIdx]); } catch { return []; }
      })() as string[],
      notableExamples: (() => {
        try { return JSON.parse(row[examplesIdx]); } catch { return []; }
      })() as string[],
    }));
  }

  async getArtTraditions(filters?: {
    category?: string;
    stylePeriod?: string;
  }): Promise<ArtTradition[]> {
    this.loadArtTraditions();
    let traditions = this.cachedArtTraditions ?? [];

    if (filters?.category) {
      traditions = traditions.filter((t) => t.category === filters.category);
    }
    if (filters?.stylePeriod) {
      traditions = traditions.filter((t) => t.stylePeriod === filters.stylePeriod);
    }

    return traditions;
  }

  async getArtTraditionById(id: string): Promise<ArtTradition | null> {
    this.loadArtTraditions();
    return (this.cachedArtTraditions ?? []).find((t) => t.id === id) ?? null;
  }

  private loadKinshipSystems(): void {
    if (this.cachedKinshipSystems) return;

    const text = this.readFileIfExists("lexicons/kinship-systems.tsv");
    if (!text) { this.cachedKinshipSystems = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const systemTypeIdx = getIdx(header, "system_type");
    const languageIdsIdx = getIdx(header, "language_ids");
    const terminologyIdx = getIdx(header, "terminology");
    const descentRuleIdx = getIdx(header, "descent_rule");
    const residenceRuleIdx = header.indexOf("residence_rule");
    const civIdx = header.indexOf("associated_civilizations");

    this.cachedKinshipSystems = rows.map((row) => ({
      id: row[idIdx],
      systemType: row[systemTypeIdx],
      languageIds: (() => {
        try { return JSON.parse(row[languageIdsIdx]); } catch { return []; }
      })() as string[],
      terminology: (() => {
        try { return JSON.parse(row[terminologyIdx]); } catch { return {}; }
      })() as Record<string, string>,
      descentRule: row[descentRuleIdx],
      residenceRule: residenceRuleIdx >= 0 ? row[residenceRuleIdx] || "" : "",
      associatedCivilizations: civIdx >= 0 ? row[civIdx] || "" : "",
    }));
  }

  async getKinshipSystems(filters?: {
    systemType?: string;
    descentRule?: string;
  }): Promise<KinshipSystem[]> {
    this.loadKinshipSystems();
    let systems = this.cachedKinshipSystems ?? [];

    if (filters?.systemType) {
      systems = systems.filter((s) => s.systemType === filters.systemType);
    }
    if (filters?.descentRule) {
      systems = systems.filter((s) => s.descentRule === filters.descentRule);
    }

    return systems;
  }

  async getKinshipSystemById(id: string): Promise<KinshipSystem | null> {
    this.loadKinshipSystems();
    return (this.cachedKinshipSystems ?? []).find((s) => s.id === id) ?? null;
  }

  private loadTradeGoods(): void {
    if (this.cachedTradeGoods) return;

    const text = this.readFileIfExists("lexicons/trade-goods.tsv");
    if (!text) { this.cachedTradeGoods = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const nameIdx = getIdx(header, "name");
    const categoryIdx = getIdx(header, "category");
    const regionIdx = getIdx(header, "origin_region");
    const coordsIdx = getIdx(header, "origin_coordinates");
    const routesIdx = getIdx(header, "trade_routes");
    const periodIdx = getIdx(header, "time_period");
    const sigIdx = getIdx(header, "economic_significance");
    const langIdx = getIdx(header, "associated_languages");

    this.cachedTradeGoods = rows.map((row) => ({
      id: row[idIdx],
      name: row[nameIdx],
      category: row[categoryIdx],
      originRegion: row[regionIdx],
      originCoordinates: (() => {
        try { return JSON.parse(row[coordsIdx]); } catch { return { lat: 0, lng: 0 }; }
      })() as { lat: number; lng: number },
      tradeRoutes: (() => {
        try { return JSON.parse(row[routesIdx]); } catch { return []; }
      })() as string[],
      timePeriod: row[periodIdx],
      economicSignificance: row[sigIdx],
      associatedLanguages: (() => {
        try { return JSON.parse(row[langIdx]); } catch { return []; }
      })() as string[],
    }));
  }

  async getTradeGoods(filters?: {
    category?: string;
    timePeriod?: string;
  }): Promise<TradeGood[]> {
    this.loadTradeGoods();
    let goods = this.cachedTradeGoods ?? [];

    if (filters?.category) {
      goods = goods.filter((g) => g.category.toLowerCase() === filters.category!.toLowerCase());
    }
    if (filters?.timePeriod) {
      goods = goods.filter((g) => g.timePeriod.includes(filters.timePeriod!));
    }

    return goods;
  }

  async getTradeGoodById(id: string): Promise<TradeGood | null> {
    this.loadTradeGoods();
    return (this.cachedTradeGoods ?? []).find((g) => g.id === id) ?? null;
  }

  // ── Narratives ──────────────────────────────────────────────────────

  private loadNarratives(): void {
    if (this.cachedNarratives) return;

    const text = this.readFileIfExists("lexicons/narratives.tsv");
    if (!text) { this.cachedNarratives = []; return; }

    const { header, rows } = parseTsv(text);
    const idIdx = getIdx(header, "id");
    const titleIdx = getIdx(header, "title");
    const descIdx = getIdx(header, "description");
    const stepsIdx = getIdx(header, "steps");

    this.cachedNarratives = rows.map((row) => {
      let steps: NarrativeStep[] = [];
      try {
        const rawSteps = JSON.parse(row[stepsIdx]) as Array<Record<string, unknown>>;
        steps = rawSteps.map((s) => ({
          text: (s.text as string) || "",
          mapCenter: (s.map_center as [number, number]) || [0, 0],
          mapZoom: (s.map_zoom as number) || 3,
          timePoint: (s.time_point as number) || 0,
          highlightedEntities: (s.highlighted_entities as string[]) || [],
          layerConfig: (s.layer_config as { layers: string[] }) || { layers: [] },
        }));
      } catch { /* empty */ }

      return {
        id: row[idIdx],
        title: row[titleIdx],
        description: row[descIdx],
        steps,
      };
    });
  }

  async getNarratives(): Promise<Narrative[]> {
    this.loadNarratives();
    return this.cachedNarratives ?? [];
  }

  async getNarrativeById(id: string): Promise<Narrative | null> {
    this.loadNarratives();
    return (this.cachedNarratives ?? []).find((n) => n.id === id) ?? null;
  }
}
