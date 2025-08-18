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
    wordListsScraped: number;
    baseWords: number;
    scrapingQueue: number;
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
    // Initialize sample language families
    const indoEuropean: LanguageFamily = {
      id: "1",
      name: "Indo-European",
      parentId: null,
      description: "Largest language family in the world",
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
      estimatedOrigin: "Northern Europe",
      timeOrigin: "c. 500 BCE", 
      region: "Northern Europe, Americas",
      totalSpeakers: 515000000,
      languageCount: 58,
      createdAt: new Date(),
    };

    const sinoTibetan: LanguageFamily = {
      id: "3",
      name: "Sino-Tibetan", 
      parentId: null,
      description: "Second largest language family",
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

    // Initialize sample languages
    const english: Language = {
      id: "lang1",
      name: "English",
      nativeName: "English",
      iso639_1: "en",
      iso639_2: "eng", 
      familyId: "2",
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
      chronologicalOrder: 4,
      historicalContext: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const german: Language = {
      id: "lang2",
      name: "German",
      nativeName: "Deutsch",
      iso639_1: "de",
      iso639_2: "deu",
      familyId: "2", 
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
      chronologicalOrder: 1,
      historicalContext: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Historical variants of English
    const oldEnglish: Language = {
      id: "lang3",
      name: "Old English",
      nativeName: "Englisc",
      iso639_1: null,
      iso639_2: "ang",
      familyId: "2",
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const middleEnglish: Language = {
      id: "lang4",
      name: "Middle English",
      nativeName: "Englisch",
      iso639_1: null,
      iso639_2: "enm",
      familyId: "2",
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const earlyModernEnglish: Language = {
      id: "lang5",
      name: "Early Modern English",
      nativeName: "English",
      iso639_1: null,
      iso639_2: null,
      familyId: "2",
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.languages.set("lang1", english);
    this.languages.set("lang2", german);
    this.languages.set("lang3", oldEnglish);
    this.languages.set("lang4", middleEnglish);
    this.languages.set("lang5", earlyModernEnglish);

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
    
    const buildTree = (parentId: string | null): LanguageFamilyWithChildren[] => {
      return families
        .filter(f => f.parentId === parentId)
        .map(family => ({
          ...family,
          children: buildTree(family.id),
          languages: Array.from(this.languages.values())
            .filter(lang => lang.familyId === family.id && !lang.isHistoricalVariant)
            .map(lang => ({
              ...lang,
              historicalVariants: Array.from(this.languages.values())
                .filter(variant => variant.parentLanguageId === lang.id)
                .sort((a, b) => (a.chronologicalOrder || 0) - (b.chronologicalOrder || 0))
            }))
        }));
    };

    return buildTree(null);
  }

  async createLanguageFamily(insertFamily: InsertLanguageFamily): Promise<LanguageFamily> {
    const id = randomUUID();
    const family: LanguageFamily = {
      ...insertFamily,
      id,
      createdAt: new Date(),
    };
    this.languageFamilies.set(id, family);
    return family;
  }

  async getLanguages(): Promise<Language[]> {
    return Array.from(this.languages.values());
  }

  async getLanguagesByFamily(familyId: string): Promise<Language[]> {
    return Array.from(this.languages.values())
      .filter(lang => lang.familyId === familyId);
  }

  async getLanguage(id: string): Promise<LanguageWithStats | undefined> {
    const language = this.languages.get(id);
    if (!language) return undefined;

    const baseWordCount = this.baseWords.size;
    const translationCount = Array.from(this.wordTranslations.values())
      .filter(t => t.languageId === id && t.translation !== null).length;
    
    const wordListCompletion = baseWordCount > 0 ? (translationCount / baseWordCount) * 100 : 0;
    
    const activeJob = Array.from(this.scrapingJobs.values())
      .find(job => job.languageId === id && job.status === 'running');

    const historicalVariants = Array.from(this.languages.values())
      .filter(variant => variant.parentLanguageId === id)
      .sort((a, b) => (a.chronologicalOrder || 0) - (b.chronologicalOrder || 0));

    return {
      ...language,
      wordListCompletion,
      lastScrapedAt: activeJob?.completedAt?.toISOString(),
      scrapingStatus: activeJob?.status as any,
      historicalVariants,
    };
  }

  async getLanguageByCode(code: string): Promise<Language | undefined> {
    return Array.from(this.languages.values())
      .find(lang => lang.iso639_1 === code || lang.iso639_2 === code);
  }

  async createLanguage(insertLanguage: InsertLanguage): Promise<Language> {
    const id = randomUUID();
    const language: Language = {
      ...insertLanguage,
      id,
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
      ...insertWord,
      id,
      createdAt: new Date(),
    };
    this.baseWords.set(id, word);
    return word;
  }

  async updateBaseWords(words: InsertBaseWord[]): Promise<void> {
    this.baseWords.clear();
    words.forEach((word, index) => {
      const id = randomUUID();
      const baseWord: BaseWord = {
        ...word,
        id,
        position: index + 1,
        createdAt: new Date(),
      };
      this.baseWords.set(id, baseWord);
    });
  }

  async getWordTranslations(languageId: string): Promise<WordTranslation[]> {
    return Array.from(this.wordTranslations.values())
      .filter(t => t.languageId === languageId);
  }

  async getTranslation(baseWordId: string, languageId: string): Promise<WordTranslation | undefined> {
    return Array.from(this.wordTranslations.values())
      .find(t => t.baseWordId === baseWordId && t.languageId === languageId);
  }

  async createWordTranslation(insertTranslation: InsertWordTranslation): Promise<WordTranslation> {
    const id = randomUUID();
    const translation: WordTranslation = {
      ...insertTranslation,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.wordTranslations.set(id, translation);
    return translation;
  }

  async updateWordTranslation(id: string, updateData: Partial<WordTranslation>): Promise<WordTranslation> {
    const translation = this.wordTranslations.get(id);
    if (!translation) throw new Error("Translation not found");
    
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
      b.createdAt.getTime() - a.createdAt.getTime()
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
    wordListsScraped: number;
    baseWords: number;
    scrapingQueue: number;
  }> {
    const totalLanguages = Array.from(this.languages.values())
      .filter(lang => !lang.isHistoricalVariant).length;
    const baseWords = this.baseWords.size;
    
    // Count languages with any translations
    const languagesWithTranslations = new Set(
      Array.from(this.wordTranslations.values()).map(t => t.languageId)
    ).size;
    
    const pendingJobs = Array.from(this.scrapingJobs.values())
      .filter(job => job.status === 'pending' || job.status === 'running').length;

    return {
      totalLanguages,
      wordListsScraped: languagesWithTranslations,
      baseWords,
      scrapingQueue: pendingJobs,
    };
  }
}

export const storage = new MemStorage();
