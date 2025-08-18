import { 
  type LanguageFamily, 
  type InsertLanguageFamily,
  type Language, 
  type InsertLanguage,
  type BaseWord,
  type InsertBaseWord,
  type WordTranslation,
  type InsertWordTranslation,
  type ScrapingJob,
  type InsertScrapingJob,
  type LanguageFamilyWithChildren,
  type LanguageWithStats,
  type LanguageWithVariants,
  type WordComparison
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Language Families
  getLanguageFamilies(): Promise<LanguageFamily[]>;
  getLanguageFamilyTree(): Promise<LanguageFamilyWithChildren[]>;
  createLanguageFamily(family: InsertLanguageFamily): Promise<LanguageFamily>;
  
  // Languages
  getLanguages(): Promise<Language[]>;
  getLanguagesByFamily(familyId: string): Promise<Language[]>;
  getLanguage(id: string): Promise<LanguageWithStats | undefined>;
  getLanguageByCode(code: string): Promise<Language | undefined>;
  createLanguage(language: InsertLanguage): Promise<Language>;
  
  // Base Words
  getBaseWords(): Promise<BaseWord[]>;
  createBaseWord(word: InsertBaseWord): Promise<BaseWord>;
  updateBaseWords(words: InsertBaseWord[]): Promise<void>;
  
  // Word Translations
  getWordTranslations(languageId: string): Promise<WordTranslation[]>;
  getTranslation(baseWordId: string, languageId: string): Promise<WordTranslation | undefined>;
  createWordTranslation(translation: InsertWordTranslation): Promise<WordTranslation>;
  updateWordTranslation(id: string, translation: Partial<WordTranslation>): Promise<WordTranslation>;
  
  // Scraping Jobs
  getScrapingJobs(): Promise<ScrapingJob[]>;
  getActiveScrapingJob(languageId: string): Promise<ScrapingJob | undefined>;
  createScrapingJob(job: InsertScrapingJob): Promise<ScrapingJob>;
  updateScrapingJob(id: string, job: Partial<ScrapingJob>): Promise<ScrapingJob>;
  
  // Word Comparison
  getWordComparisons(languageIds: string[]): Promise<WordComparison[]>;
  
  // Statistics
  getLanguageStats(): Promise<{
    totalLanguages: number;
    historicalVariants: number;
    dialects: number;
    wordListsScraped: number;
    baseWords: number;
    scrapingQueue: number;
    totalFamilies: number;
    phylums: number;
    families: number;
    subfamilies: number;
    branches: number;
    groups: number;
    complexes: number;
  }>;
}

export class MemStorage implements IStorage {
  private languageFamilies: Map<string, LanguageFamily> = new Map();
  private languages: Map<string, Language> = new Map();
  private baseWords: Map<string, BaseWord> = new Map();
  private wordTranslations: Map<string, WordTranslation> = new Map();
  private scrapingJobs: Map<string, ScrapingJob> = new Map();

  constructor() {
    this.initializeData();
  }

  private initializeData() {
    // Initialize language families
    const indoEuropean: LanguageFamily = {
      id: "1",
      name: "Indo-European",
      parentId: null,
      description: "Largest language family in the world",
      taxonomicLevel: "phylum",
      estimatedOrigin: "Pontic-Caspian steppe",
      timeOrigin: "c. 3500 BCE",
      region: "Europe, Asia, Americas",
      totalSpeakers: 3200000000,
      languageCount: 448,
      createdAt: new Date(),
    };
    
    const germanic: LanguageFamily = {
      id: "2", 
      name: "Germanic",
      parentId: "1",
      description: "Branch of Indo-European languages",
      taxonomicLevel: "family",
      estimatedOrigin: "Northern Europe",
      timeOrigin: "c. 500 BCE", 
      region: "Northern Europe, Americas",
      totalSpeakers: 515000000,
      languageCount: 58,
      createdAt: new Date(),
    };

    const westGermanic: LanguageFamily = {
      id: "4",
      name: "West Germanic", 
      parentId: "2",
      description: "Largest subfamily of Germanic languages",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "North Sea Germanic region",
      timeOrigin: "c. 200 CE",
      region: "Western Europe, Americas",
      totalSpeakers: 490000000,
      languageCount: 25,
      createdAt: new Date(),
    };

    const northGermanic: LanguageFamily = {
      id: "5",
      name: "North Germanic",
      parentId: "2", 
      description: "Scandinavian languages",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Scandinavia",
      timeOrigin: "c. 200 CE",
      region: "Scandinavia, Iceland",
      totalSpeakers: 20000000,
      languageCount: 5,
      createdAt: new Date(),
    };

    const eastGermanic: LanguageFamily = {
      id: "6",
      name: "East Germanic",
      parentId: "2",
      description: "Extinct Germanic subfamily",
      taxonomicLevel: "subfamily", 
      estimatedOrigin: "Eastern Europe",
      timeOrigin: "c. 200 CE",
      region: "Eastern Europe",
      totalSpeakers: 0,
      languageCount: 3,
      createdAt: new Date(),
    };

    const sinoTibetan: LanguageFamily = {
      id: "3",
      name: "Sino-Tibetan", 
      parentId: null,
      description: "Second largest language family",
      taxonomicLevel: "phylum",
      estimatedOrigin: "Yellow River valley",
      timeOrigin: "c. 4500 BCE",
      region: "East Asia, Southeast Asia",
      totalSpeakers: 1400000000,
      languageCount: 449,
      createdAt: new Date(),
    };

    this.languageFamilies.set("1", indoEuropean);
    this.languageFamilies.set("2", germanic);
    this.languageFamilies.set("3", sinoTibetan);
    this.languageFamilies.set("4", westGermanic);
    this.languageFamilies.set("5", northGermanic);
    this.languageFamilies.set("6", eastGermanic);

    // Initialize languages - English branch
    const english: Language = {
      id: "lang1",
      name: "English",
      nativeName: "English",
      iso639_1: "en",
      iso639_2: "eng", 
      familyId: "4", // West Germanic
      parentLanguageId: null,
      region: "Global",
      countries: ["United States", "United Kingdom", "Canada", "Australia"],
      nativeSpeakers: 380000000,
      totalSpeakers: 1500000000,
      status: "living",
      timeOrigin: "5th century CE",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 4,
      historicalContext: null,
      coordinates: { lat: 54.5260, lng: -2.2173 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const modernEnglish: Language = {
      id: "lang9",
      name: "Modern English",
      nativeName: "Modern English",
      iso639_1: "en",
      iso639_2: "eng",
      familyId: "4", // West Germanic
      parentLanguageId: "lang1",
      region: "Global",
      countries: ["Multiple"],
      nativeSpeakers: 380000000,
      totalSpeakers: 1500000000,
      status: "living",
      timeOrigin: "17th century",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic > English",
      writingSystem: "Latin script",
      isHistoricalVariant: true,
      isDialect: false,
      chronologicalOrder: 4,
      historicalContext: "Contemporary form of English from 17th century onwards",
      coordinates: { lat: 54.5260, lng: -2.2173 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // English dialects
    const americanEnglish: Language = {
      id: "lang6",
      name: "American English",
      nativeName: "American English",
      iso639_1: "en",
      iso639_2: "eng",
      familyId: "4", // West Germanic
      parentLanguageId: "lang9", // Parent is Modern English
      region: "United States",
      countries: ["United States"],
      nativeSpeakers: 300000000,
      totalSpeakers: 300000000,
      status: "living",
      timeOrigin: "17th century",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic > English",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: true,
      chronologicalOrder: 5,
      historicalContext: "Developed from early colonial English with indigenous and immigrant influences",
      coordinates: { lat: 39.8283, lng: -98.5795 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const britishEnglish: Language = {
      id: "lang7",
      name: "British English", 
      nativeName: "British English",
      iso639_1: "en",
      iso639_2: "eng",
      familyId: "4", // West Germanic
      parentLanguageId: "lang9", // Parent is Modern English
      region: "United Kingdom",
      countries: ["United Kingdom"],
      nativeSpeakers: 65000000,
      totalSpeakers: 65000000,
      status: "living",
      timeOrigin: "18th century",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic > English",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: true,
      chronologicalOrder: 5,
      historicalContext: "Standard form developed during the 18th-19th centuries",
      coordinates: { lat: 55.3781, lng: -3.4360 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const australianEnglish: Language = {
      id: "lang8",
      name: "Australian English",
      nativeName: "Australian English", 
      iso639_1: "en",
      iso639_2: "eng",
      familyId: "4", // West Germanic
      parentLanguageId: "lang9", // Parent is Modern English
      region: "Australia",
      countries: ["Australia"],
      nativeSpeakers: 25000000,
      totalSpeakers: 25000000,
      status: "living",
      timeOrigin: "19th century",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic > English",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: true,
      chronologicalOrder: 5,
      historicalContext: "Developed from British colonial English with unique Australian innovations",
      coordinates: { lat: -25.2744, lng: 133.7751 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Historical English variants
    const oldEnglish: Language = {
      id: "lang3",
      name: "Old English",
      nativeName: "Englisc",
      iso639_1: null,
      iso639_2: "ang",
      familyId: "4", // West Germanic
      parentLanguageId: "lang1",
      region: "England, Southern Scotland",
      countries: ["England"],
      nativeSpeakers: 0,
      totalSpeakers: 0,
      status: "dead",
      timeOrigin: "5th century CE",
      timeEnd: "12th century CE",
      classification: "Indo-European > Germanic > West Germanic",
      writingSystem: "Latin script, Runic script",
      isHistoricalVariant: true,
      chronologicalOrder: 1,
      historicalContext: "Anglo-Saxon period, influenced by Latin and Old Norse",
      coordinates: { lat: 52.3555, lng: -1.1743 },
      isDialect: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const middleEnglish: Language = {
      id: "lang4",
      name: "Middle English",
      nativeName: "Englisch",
      iso639_1: null,
      iso639_2: "enm",
      familyId: "4", // West Germanic
      parentLanguageId: "lang1",
      region: "England, Wales, Southern Scotland",
      countries: ["England", "Wales"],
      nativeSpeakers: 0,
      totalSpeakers: 0,
      status: "dead",
      timeOrigin: "12th century CE",
      timeEnd: "15th century CE",
      classification: "Indo-European > Germanic > West Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: true,
      chronologicalOrder: 2,
      historicalContext: "Norman influence, Great Vowel Shift beginning",
      coordinates: { lat: 52.3555, lng: -1.1743 },
      isDialect: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const earlyModernEnglish: Language = {
      id: "lang5",
      name: "Early Modern English",
      nativeName: "English",
      iso639_1: null,
      iso639_2: null,
      familyId: "4", // West Germanic
      parentLanguageId: "lang1",
      region: "England, Wales, Scotland, Ireland",
      countries: ["England", "Wales", "Scotland", "Ireland"],
      nativeSpeakers: 0,
      totalSpeakers: 0,
      status: "dead",
      timeOrigin: "15th century CE",
      timeEnd: "17th century CE",
      classification: "Indo-European > Germanic > West Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: true,
      chronologicalOrder: 3,
      historicalContext: "Renaissance period, Shakespearean era, printing press influence",
      coordinates: { lat: 52.3555, lng: -1.1743 },
      isDialect: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Other West Germanic languages
    const german: Language = {
      id: "lang2",
      name: "German",
      nativeName: "Deutsch",
      iso639_1: "de",
      iso639_2: "deu",
      familyId: "4", // West Germanic
      parentLanguageId: null,
      region: "Central Europe",
      countries: ["Germany", "Austria", "Switzerland"],
      nativeSpeakers: 76000000,
      totalSpeakers: 95000000,
      status: "living",
      timeOrigin: "6th century CE",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 51.1657, lng: 10.4515 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const dutch: Language = {
      id: "lang10",
      name: "Dutch",
      nativeName: "Nederlands", 
      iso639_1: "nl",
      iso639_2: "nld",
      familyId: "4", // West Germanic
      parentLanguageId: null,
      region: "Netherlands, Belgium, Suriname",
      countries: ["Netherlands", "Belgium", "Suriname"],
      nativeSpeakers: 24000000,
      totalSpeakers: 29000000,
      status: "living",
      timeOrigin: "6th century CE",
      timeEnd: null,
      classification: "Indo-European > Germanic > West Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 52.1326, lng: 5.2913 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // North Germanic languages
    const swedish: Language = {
      id: "lang11",
      name: "Swedish",
      nativeName: "svenska",
      iso639_1: "sv",
      iso639_2: "swe",
      familyId: "5", // North Germanic
      parentLanguageId: null,
      region: "Sweden, Finland",
      countries: ["Sweden", "Finland"],
      nativeSpeakers: 10000000,
      totalSpeakers: 13000000,
      status: "living",
      timeOrigin: "9th century CE",
      timeEnd: null,
      classification: "Indo-European > Germanic > North Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 60.1282, lng: 18.6435 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const norwegian: Language = {
      id: "lang12", 
      name: "Norwegian",
      nativeName: "norsk",
      iso639_1: "no",
      iso639_2: "nor",
      familyId: "5", // North Germanic
      parentLanguageId: null,
      region: "Norway",
      countries: ["Norway"],
      nativeSpeakers: 5000000,
      totalSpeakers: 5000000,
      status: "living",
      timeOrigin: "14th century CE",
      timeEnd: null,
      classification: "Indo-European > Germanic > North Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 60.4720, lng: 8.4689 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const danish: Language = {
      id: "lang13",
      name: "Danish",
      nativeName: "dansk",
      iso639_1: "da",
      iso639_2: "dan",
      familyId: "5", // North Germanic
      parentLanguageId: null,
      region: "Denmark, Greenland, Faroe Islands",
      countries: ["Denmark", "Greenland", "Faroe Islands"],
      nativeSpeakers: 6000000,
      totalSpeakers: 6000000,
      status: "living",
      timeOrigin: "9th century CE",
      timeEnd: null,
      classification: "Indo-European > Germanic > North Germanic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 56.2639, lng: 9.5018 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store all languages
    this.languages.set("lang1", english);
    this.languages.set("lang2", german);
    this.languages.set("lang3", oldEnglish);
    this.languages.set("lang4", middleEnglish);
    this.languages.set("lang5", earlyModernEnglish);
    this.languages.set("lang6", americanEnglish);
    this.languages.set("lang7", britishEnglish);
    this.languages.set("lang8", australianEnglish);
    this.languages.set("lang9", modernEnglish);
    this.languages.set("lang10", dutch);
    this.languages.set("lang11", swedish);
    this.languages.set("lang12", norwegian);
    this.languages.set("lang13", danish);

    // Initialize sample base words
    const sampleWords = [
      "hello", "water", "house", "family", "mountain", "tree", "sun", "moon", 
      "fire", "earth", "wind", "love", "time", "person", "woman", "man", 
      "child", "mother", "father", "brother", "sister", "hand", "eye", "ear",
      "mouth", "food", "eat", "drink", "sleep", "walk", "run", "speak"
    ];

    sampleWords.forEach((word, index) => {
      const baseWord: BaseWord = {
        id: `word${index + 1}`,
        word,
        position: index + 1,
        category: "common",
        definition: `Definition of ${word}`,
        createdAt: new Date(),
      };
      this.baseWords.set(baseWord.id, baseWord);
    });
  }

  async getLanguageFamilies(): Promise<LanguageFamily[]> {
    return Array.from(this.languageFamilies.values());
  }

  async getLanguageFamilyTree(): Promise<LanguageFamilyWithChildren[]> {
    const families = Array.from(this.languageFamilies.values());
    const languages = Array.from(this.languages.values());
    
    const buildTree = (parentId: string | null): LanguageFamilyWithChildren[] => {
      return families
        .filter(family => family.parentId === parentId)
        .map(family => ({
          ...family,
          children: buildTree(family.id),
          languages: languages.filter(lang => lang.familyId === family.id).map(lang => ({
            ...lang,
            historicalVariants: languages.filter(l => l.parentLanguageId === lang.id && l.isHistoricalVariant),
            dialects: languages.filter(l => l.parentLanguageId === lang.id && l.isDialect)
          }))
        }));
    };

    return buildTree(null);
  }

  async createLanguageFamily(insertFamily: InsertLanguageFamily): Promise<LanguageFamily> {
    const id = randomUUID();
    const family: LanguageFamily = {
      id,
      name: insertFamily.name,
      parentId: insertFamily.parentId,
      description: insertFamily.description,
      taxonomicLevel: insertFamily.taxonomicLevel,
      estimatedOrigin: insertFamily.estimatedOrigin,
      timeOrigin: insertFamily.timeOrigin,
      region: insertFamily.region,
      totalSpeakers: insertFamily.totalSpeakers,
      languageCount: insertFamily.languageCount,
      createdAt: new Date(),
    };
    this.languageFamilies.set(id, family);
    return family;
  }

  async getLanguages(): Promise<Language[]> {
    return Array.from(this.languages.values());
  }

  async getLanguagesByFamily(familyId: string): Promise<Language[]> {
    return Array.from(this.languages.values()).filter(lang => lang.familyId === familyId);
  }

  async getLanguage(id: string): Promise<LanguageWithStats | undefined> {
    const language = this.languages.get(id);
    if (!language) return undefined;

    const translationCount = Array.from(this.wordTranslations.values())
      .filter(t => t.languageId === id).length;
    
    const totalWords = this.baseWords.size;
    const completionPercentage = totalWords > 0 ? Math.round((translationCount / totalWords) * 100) : 0;

    // Get historical variants if this is a main language
    const historicalVariants = !language.isHistoricalVariant && !language.isDialect
      ? Array.from(this.languages.values()).filter(l => 
          l.parentLanguageId === id && l.isHistoricalVariant
        )
      : [];

    // Get dialects if this is a modern variant
    const dialects = language.isHistoricalVariant && language.name.includes("Modern")
      ? Array.from(this.languages.values()).filter(l => 
          l.parentLanguageId === id && l.isDialect
        )
      : [];

    return {
      ...language,
      completionPercentage,
      historicalVariants,
      dialects
    };
  }

  async getLanguageByCode(code: string): Promise<Language | undefined> {
    return Array.from(this.languages.values())
      .find(lang => lang.iso639_1 === code || lang.iso639_2 === code);
  }

  async createLanguage(insertLanguage: InsertLanguage): Promise<Language> {
    const id = randomUUID();
    const language: Language = {
      id,
      name: insertLanguage.name,
      nativeName: insertLanguage.nativeName,
      iso639_1: insertLanguage.iso639_1,
      iso639_2: insertLanguage.iso639_2,
      familyId: insertLanguage.familyId,
      parentLanguageId: insertLanguage.parentLanguageId,
      region: insertLanguage.region,
      countries: insertLanguage.countries,
      nativeSpeakers: insertLanguage.nativeSpeakers,
      totalSpeakers: insertLanguage.totalSpeakers,
      status: insertLanguage.status,
      timeOrigin: insertLanguage.timeOrigin,
      timeEnd: insertLanguage.timeEnd,
      classification: insertLanguage.classification,
      writingSystem: insertLanguage.writingSystem,
      isHistoricalVariant: insertLanguage.isHistoricalVariant,
      isDialect: insertLanguage.isDialect,
      chronologicalOrder: insertLanguage.chronologicalOrder,
      historicalContext: insertLanguage.historicalContext,
      coordinates: insertLanguage.coordinates,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.languages.set(id, language);
    return language;
  }

  async getBaseWords(): Promise<BaseWord[]> {
    return Array.from(this.baseWords.values()).sort((a, b) => a.position - b.position);
  }

  async createBaseWord(insertWord: InsertBaseWord): Promise<BaseWord> {
    const id = randomUUID();
    const word: BaseWord = {
      id,
      word: insertWord.word,
      position: insertWord.position,
      category: insertWord.category || null,
      definition: insertWord.definition || null,
      createdAt: new Date(),
    };
    this.baseWords.set(id, word);
    return word;
  }

  async updateBaseWords(words: InsertBaseWord[]): Promise<void> {
    // Clear existing base words
    this.baseWords.clear();
    
    // Add new words
    words.forEach((word, index) => {
      const baseWord: BaseWord = {
        id: `word${index + 1}`,
        word: word.word,
        position: word.position,
        category: word.category || null,
        definition: word.definition || null,
        createdAt: new Date(),
      };
      this.baseWords.set(baseWord.id, baseWord);
    });
  }

  async getWordTranslations(languageId: string): Promise<WordTranslation[]> {
    return Array.from(this.wordTranslations.values())
      .filter(translation => translation.languageId === languageId);
  }

  async getTranslation(baseWordId: string, languageId: string): Promise<WordTranslation | undefined> {
    return Array.from(this.wordTranslations.values())
      .find(t => t.baseWordId === baseWordId && t.languageId === languageId);
  }

  async createWordTranslation(insertTranslation: InsertWordTranslation): Promise<WordTranslation> {
    const id = randomUUID();
    const translation: WordTranslation = {
      id,
      baseWordId: insertTranslation.baseWordId,
      languageId: insertTranslation.languageId,
      translation: insertTranslation.translation || null,
      pronunciation: insertTranslation.pronunciation || null,
      notes: insertTranslation.notes || null,
      source: insertTranslation.source || null,
      verified: insertTranslation.verified || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.wordTranslations.set(id, translation);
    return translation;
  }

  async updateWordTranslation(id: string, updateData: Partial<WordTranslation>): Promise<WordTranslation> {
    const translation = this.wordTranslations.get(id);
    if (!translation) throw new Error("Word translation not found");
    
    const updated: WordTranslation = {
      ...translation,
      ...updateData,
      updatedAt: new Date(),
    };
    this.wordTranslations.set(id, updated);
    return updated;
  }

  async getScrapingJobs(): Promise<ScrapingJob[]> {
    return Array.from(this.scrapingJobs.values()).sort((a, b) => 
      (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getActiveScrapingJob(languageId: string): Promise<ScrapingJob | undefined> {
    return Array.from(this.scrapingJobs.values())
      .find(job => job.languageId === languageId && 
        (job.status === 'pending' || job.status === 'running'));
  }

  async createScrapingJob(insertJob: InsertScrapingJob): Promise<ScrapingJob> {
    const id = randomUUID();
    const job: ScrapingJob = {
      ...insertJob,
      id,
      totalWords: insertJob.totalWords || null,
      completedWords: insertJob.completedWords || null,
      failedWords: insertJob.failedWords || null,
      startedAt: insertJob.startedAt || null,
      completedAt: insertJob.completedAt || null,
      errorMessage: insertJob.errorMessage || null,
      createdAt: new Date(),
    };
    this.scrapingJobs.set(id, job);
    return job;
  }

  async updateScrapingJob(id: string, updateData: Partial<ScrapingJob>): Promise<ScrapingJob> {
    const job = this.scrapingJobs.get(id);
    if (!job) throw new Error("Scraping job not found");
    
    const updated: ScrapingJob = {
      ...job,
      ...updateData,
    };
    this.scrapingJobs.set(id, updated);
    return updated;
  }

  async getWordComparisons(languageIds: string[]): Promise<WordComparison[]> {
    const baseWords = Array.from(this.baseWords.values()).sort((a, b) => a.position - b.position);
    const languages = languageIds.map(id => this.languages.get(id)).filter(Boolean) as Language[];
    
    return baseWords.map(baseWord => ({
      baseWord,
      translations: languages.map(language => ({
        language,
        translation: Array.from(this.wordTranslations.values())
          .find(t => t.baseWordId === baseWord.id && t.languageId === language.id) || null
      }))
    }));
  }

  async getLanguageStats(): Promise<{
    totalLanguages: number;
    historicalVariants: number;
    dialects: number;
    wordListsScraped: number;
    baseWords: number;
    scrapingQueue: number;
    totalFamilies: number;
    phylums: number;
    families: number;
    subfamilies: number;
    branches: number;
    groups: number;
    complexes: number;
  }> {
    const allLanguages = Array.from(this.languages.values());
    const totalLanguages = allLanguages.filter(lang => !lang.isHistoricalVariant && !lang.isDialect).length;
    const historicalVariants = allLanguages.filter(lang => lang.isHistoricalVariant).length;
    const dialects = allLanguages.filter(lang => lang.isDialect).length;
    const baseWords = this.baseWords.size;
    
    // Count languages with any translations
    const languagesWithTranslations = new Set(
      Array.from(this.wordTranslations.values()).map(t => t.languageId)
    ).size;
    
    const pendingJobs = Array.from(this.scrapingJobs.values())
      .filter(job => job.status === 'pending' || job.status === 'running').length;

    // Count families by taxonomic level
    const families = Array.from(this.languageFamilies.values());
    const totalFamilies = families.length;
    const phylums = families.filter(f => f.taxonomicLevel === 'phylum').length;
    const familyLevel = families.filter(f => f.taxonomicLevel === 'family').length;
    const subfamilies = families.filter(f => f.taxonomicLevel === 'subfamily').length;
    const branches = families.filter(f => f.taxonomicLevel === 'branch').length;
    const groups = families.filter(f => f.taxonomicLevel === 'group').length;
    const complexes = families.filter(f => f.taxonomicLevel === 'complex').length;

    return {
      totalLanguages,
      historicalVariants,
      dialects,
      wordListsScraped: languagesWithTranslations,
      baseWords,
      scrapingQueue: pendingJobs,
      totalFamilies,
      phylums,
      families: familyLevel,
      subfamilies,
      branches,
      groups,
      complexes,
    };
  }
}

export const storage = new MemStorage();