import { db } from "./db";
import { eq, and, sql, count } from "drizzle-orm";
import type {
  LanguageFamily, Language, BaseWord, WordTranslation, ScrapingJob,
  InsertLanguageFamily, InsertLanguage, InsertBaseWord, InsertWordTranslation, InsertScrapingJob,
  LanguageWithStats, LanguageFamilyWithChildren, LanguageEvolution, UserContribution, TranslationContext,
  InsertLanguageEvolution, InsertUserContribution, InsertTranslationContext,
  LanguageWithVariants, WordComparison, SearchFilter, InsertSearchFilter
} from "@shared/schema";
import { 
  languageFamilies, languages, baseWords, wordTranslations, scrapingJobs,
  languageEvolution, userContributions, translationContexts, searchFilters
} from "@shared/schema";

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

  // Language Evolution
  getLanguageEvolution(languageId: string): Promise<LanguageEvolution[]>;
  createLanguageEvolution(evolution: InsertLanguageEvolution): Promise<LanguageEvolution>;

  // User Contributions
  getUserContributions(): Promise<UserContribution[]>;
  createUserContribution(contribution: InsertUserContribution): Promise<UserContribution>;

  // Translation Contexts
  getTranslationContexts(baseWordId: string, languageId: string): Promise<TranslationContext[]>;
  createTranslationContext(context: InsertTranslationContext): Promise<TranslationContext>;

  // Search Filters
  getSearchFilters(): Promise<SearchFilter[]>;
  createSearchFilter(filter: InsertSearchFilter): Promise<SearchFilter>;

  // Language Family Tree Scraping
  scrapeLanguageFamilyTree(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initializeData();
  }

  private async initializeData() {
    try {
      // Check if data already exists
      const existingFamilies = await db.select().from(languageFamilies).limit(1);
      if (existingFamilies.length > 0) {
        console.log("Database already initialized with data");
        return;
      }

      console.log("Initializing database with sample data...");
      await this.migrateExistingData();
      console.log("Database initialization complete");
    } catch (error) {
      console.error("Error initializing database:", error);
    }
  }

  private async migrateExistingData() {
    // This will migrate the existing in-memory data to PostgreSQL
    // First, create base words
    const baseWordsData = [
      { word: "hello", position: 1, category: "greeting", definition: "a greeting" },
      { word: "water", position: 2, category: "nature", definition: "liquid H2O" },
      { word: "house", position: 3, category: "building", definition: "a dwelling" },
      { word: "family", position: 4, category: "social", definition: "related people" },
      { word: "mountain", position: 5, category: "nature", definition: "elevated land" },
      { word: "tree", position: 6, category: "nature", definition: "woody plant" },
      { word: "sun", position: 7, category: "nature", definition: "star that lights Earth" },
      { word: "moon", position: 8, category: "nature", definition: "Earth's satellite" },
      { word: "fire", position: 9, category: "nature", definition: "combustion reaction" },
      { word: "earth", position: 10, category: "nature", definition: "soil or planet" },
      { word: "wind", position: 11, category: "nature", definition: "moving air" },
      { word: "love", position: 12, category: "emotion", definition: "deep affection" },
      { word: "time", position: 13, category: "abstract", definition: "duration" },
      { word: "person", position: 14, category: "human", definition: "individual human" },
      { word: "woman", position: 15, category: "human", definition: "adult female" },
      { word: "man", position: 16, category: "human", definition: "adult male" },
      { word: "child", position: 17, category: "human", definition: "young person" },
      { word: "mother", position: 18, category: "family", definition: "female parent" },
      { word: "father", position: 19, category: "family", definition: "male parent" },
      { word: "brother", position: 20, category: "family", definition: "male sibling" },
      { word: "sister", position: 21, category: "family", definition: "female sibling" },
      { word: "hand", position: 22, category: "body", definition: "end of arm" },
      { word: "eye", position: 23, category: "body", definition: "organ of sight" },
      { word: "ear", position: 24, category: "body", definition: "organ of hearing" },
      { word: "mouth", position: 25, category: "body", definition: "opening for eating" },
      { word: "food", position: 26, category: "sustenance", definition: "nourishment" },
      { word: "eat", position: 27, category: "action", definition: "consume food" },
      { word: "drink", position: 28, category: "action", definition: "consume liquid" },
      { word: "sleep", position: 29, category: "action", definition: "rest state" },
      { word: "walk", position: 30, category: "action", definition: "move on foot" },
      { word: "run", position: 31, category: "action", definition: "move quickly" },
      { word: "speak", position: 32, category: "action", definition: "use voice" }
    ];

    await db.insert(baseWords).values(baseWordsData);

    // Create language families - simplified initial structure
    const familiesData = [
      { id: "1", name: "Indo-European", parentId: null, description: "Large language family of Europe and parts of Asia", taxonomicLevel: "phylum" },
      { id: "1.1", name: "Germanic", parentId: "1", description: "Branch of Indo-European including English, German", taxonomicLevel: "family" },
      { id: "1.2", name: "Romance", parentId: "1", description: "Branch of Indo-European including Spanish, French", taxonomicLevel: "family" },
      { id: "1.3", name: "Slavic", parentId: "1", description: "Branch of Indo-European including Russian, Polish", taxonomicLevel: "family" },
    ];

    await db.insert(languageFamilies).values(familiesData);

    // Create some initial languages
    const languagesData = [
      {
        id: "lang1", name: "English", nativeName: "English", iso639_1: "en", iso639_2: "eng",
        familyId: "1.1", region: "Global", status: "living", nativeSpeakers: 380000000, totalSpeakers: 1500000000
      },
      {
        id: "lang2", name: "German", nativeName: "Deutsch", iso639_1: "de", iso639_2: "deu", 
        familyId: "1.1", region: "Central Europe", status: "living", nativeSpeakers: 95000000, totalSpeakers: 130000000
      },
      {
        id: "lang11", name: "Swedish", nativeName: "Svenska", iso639_1: "sv", iso639_2: "swe",
        familyId: "1.1", region: "Scandinavia", status: "living", nativeSpeakers: 10000000, totalSpeakers: 10500000
      }
    ];

    await db.insert(languages).values(languagesData);
    console.log("Basic data migration complete");
  }

  async getLanguageFamilies(): Promise<LanguageFamily[]> {
    return await db.select().from(languageFamilies);
  }

  async getLanguageFamilyTree(): Promise<LanguageFamilyWithChildren[]> {
    const families = await db.select().from(languageFamilies);
    const allLanguages = await db.select().from(languages);
    
    const buildTree = (parentId: string | null): LanguageFamilyWithChildren[] => {
      return families
        .filter(family => family.parentId === parentId)
        .map(family => ({
          ...family,
          children: buildTree(family.id),
          languages: allLanguages
            .filter(lang => lang.familyId === family.id && !lang.parentLanguageId)
            .map(lang => ({
              ...lang,
              historicalVariants: allLanguages.filter(l => 
                l.parentLanguageId === lang.id && l.isHistoricalVariant
              ),
              dialects: allLanguages.filter(l => 
                l.parentLanguageId === lang.id && l.isDialect
              )
            }))
        }));
    };

    return buildTree(null);
  }

  async createLanguageFamily(family: InsertLanguageFamily): Promise<LanguageFamily> {
    const [created] = await db.insert(languageFamilies).values(family).returning();
    return created;
  }

  async getLanguages(): Promise<Language[]> {
    return await db.select().from(languages);
  }

  async getLanguagesByFamily(familyId: string): Promise<Language[]> {
    return await db.select().from(languages).where(eq(languages.familyId, familyId));
  }

  async getLanguage(id: string): Promise<LanguageWithStats | undefined> {
    const [language] = await db.select().from(languages).where(eq(languages.id, id));
    if (!language) return undefined;

    // Calculate completion percentage
    const [translationCount] = await db
      .select({ count: count() })
      .from(wordTranslations)
      .where(eq(wordTranslations.languageId, id));

    const [totalWords] = await db.select({ count: count() }).from(baseWords);
    
    const completionPercentage = totalWords.count > 0 
      ? Math.round((translationCount.count / totalWords.count) * 100) 
      : 0;

    // Get historical variants and dialects
    const historicalVariants = await db
      .select()
      .from(languages)
      .where(and(
        eq(languages.parentLanguageId, id),
        eq(languages.isHistoricalVariant, true)
      ));

    const dialects = await db
      .select()
      .from(languages)
      .where(and(
        eq(languages.parentLanguageId, id),
        eq(languages.isDialect, true)
      ));

    return {
      ...language,
      completionPercentage,
      historicalVariants,
      dialects
    };
  }

  async getLanguageByCode(code: string): Promise<Language | undefined> {
    const [language] = await db
      .select()
      .from(languages)
      .where(sql`${languages.iso639_1} = ${code} OR ${languages.iso639_2} = ${code}`);
    return language;
  }

  async createLanguage(language: InsertLanguage): Promise<Language> {
    const [created] = await db.insert(languages).values(language).returning();
    return created;
  }

  async getBaseWords(): Promise<BaseWord[]> {
    return await db.select().from(baseWords).orderBy(baseWords.position);
  }

  async createBaseWord(word: InsertBaseWord): Promise<BaseWord> {
    const [created] = await db.insert(baseWords).values(word).returning();
    return created;
  }

  async updateBaseWords(words: InsertBaseWord[]): Promise<void> {
    if (words.length === 0) return;
    await db.insert(baseWords).values(words).onConflictDoNothing();
  }

  async getWordTranslations(languageId: string): Promise<WordTranslation[]> {
    return await db
      .select()
      .from(wordTranslations)
      .where(eq(wordTranslations.languageId, languageId));
  }

  async getTranslation(baseWordId: string, languageId: string): Promise<WordTranslation | undefined> {
    const [translation] = await db
      .select()
      .from(wordTranslations)
      .where(and(
        eq(wordTranslations.baseWordId, baseWordId),
        eq(wordTranslations.languageId, languageId)
      ));
    return translation;
  }

  async createWordTranslation(translation: InsertWordTranslation): Promise<WordTranslation> {
    const [created] = await db.insert(wordTranslations).values(translation).returning();
    return created;
  }

  async updateWordTranslation(id: string, translation: Partial<WordTranslation>): Promise<WordTranslation> {
    const [updated] = await db
      .update(wordTranslations)
      .set({ ...translation, updatedAt: new Date() })
      .where(eq(wordTranslations.id, id))
      .returning();
    return updated;
  }

  async getScrapingJobs(): Promise<ScrapingJob[]> {
    return await db.select().from(scrapingJobs);
  }

  async getActiveScrapingJob(languageId: string): Promise<ScrapingJob | undefined> {
    const [job] = await db
      .select()
      .from(scrapingJobs)
      .where(and(
        eq(scrapingJobs.languageId, languageId),
        sql`${scrapingJobs.status} IN ('pending', 'running')`
      ));
    return job;
  }

  async createScrapingJob(job: InsertScrapingJob): Promise<ScrapingJob> {
    const [created] = await db.insert(scrapingJobs).values(job).returning();
    return created;
  }

  async updateScrapingJob(id: string, job: Partial<ScrapingJob>): Promise<ScrapingJob> {
    const [updated] = await db
      .update(scrapingJobs)
      .set(job)
      .where(eq(scrapingJobs.id, id))
      .returning();
    return updated;
  }

  async getWordComparisons(languageIds: string[]): Promise<WordComparison[]> {
    const baseWordsData = await db.select().from(baseWords).orderBy(baseWords.position);
    
    const comparisons: WordComparison[] = [];
    
    for (const baseWord of baseWordsData) {
      const translations = await db
        .select()
        .from(wordTranslations)
        .where(sql`${wordTranslations.baseWordId} = ${baseWord.id} AND ${wordTranslations.languageId} = ANY(${languageIds})`);
      
      const languageTranslations: { [key: string]: string } = {};
      translations.forEach(t => {
        languageTranslations[t.languageId] = t.translation || '';
      });
      
      comparisons.push({
        baseWord: baseWord.word,
        position: baseWord.position,
        category: baseWord.category || '',
        translations: languageTranslations
      });
    }
    
    return comparisons;
  }

  async getLanguageStats() {
    const [totalLanguagesResult] = await db.select({ count: count() }).from(languages);
    const [historicalVariantsResult] = await db
      .select({ count: count() })
      .from(languages)
      .where(eq(languages.isHistoricalVariant, true));
    const [dialectsResult] = await db
      .select({ count: count() })
      .from(languages)
      .where(eq(languages.isDialect, true));
    const [baseWordsResult] = await db.select({ count: count() }).from(baseWords);
    const [scrapingQueueResult] = await db
      .select({ count: count() })
      .from(scrapingJobs)
      .where(sql`${scrapingJobs.status} IN ('pending', 'running')`);
    const [totalFamiliesResult] = await db.select({ count: count() }).from(languageFamilies);

    // Get counts by taxonomic level
    const [phylumsResult] = await db
      .select({ count: count() })
      .from(languageFamilies)
      .where(eq(languageFamilies.taxonomicLevel, 'phylum'));
    const [familiesResult] = await db
      .select({ count: count() })
      .from(languageFamilies)
      .where(eq(languageFamilies.taxonomicLevel, 'family'));
    const [subfamiliesResult] = await db
      .select({ count: count() })
      .from(languageFamilies)
      .where(eq(languageFamilies.taxonomicLevel, 'subfamily'));
    const [branchesResult] = await db
      .select({ count: count() })
      .from(languageFamilies)
      .where(eq(languageFamilies.taxonomicLevel, 'branch'));
    const [groupsResult] = await db
      .select({ count: count() })
      .from(languageFamilies)
      .where(eq(languageFamilies.taxonomicLevel, 'group'));
    const [complexesResult] = await db
      .select({ count: count() })
      .from(languageFamilies)
      .where(eq(languageFamilies.taxonomicLevel, 'complex'));

    return {
      totalLanguages: totalLanguagesResult.count,
      historicalVariants: historicalVariantsResult.count,
      dialects: dialectsResult.count,
      wordListsScraped: 0, // TODO: Calculate from completed scraping jobs
      baseWords: baseWordsResult.count,
      scrapingQueue: scrapingQueueResult.count,
      totalFamilies: totalFamiliesResult.count,
      phylums: phylumsResult.count,
      families: familiesResult.count,
      subfamilies: subfamiliesResult.count,
      branches: branchesResult.count,
      groups: groupsResult.count,
      complexes: complexesResult.count,
    };
  }

  async getLanguageEvolution(languageId: string): Promise<LanguageEvolution[]> {
    return await db
      .select()
      .from(languageEvolution)
      .where(eq(languageEvolution.languageId, languageId));
  }

  async createLanguageEvolution(evolution: InsertLanguageEvolution): Promise<LanguageEvolution> {
    // TODO: Implement when needed
    throw new Error("Not implemented yet");
  }

  async getUserContributions(): Promise<UserContribution[]> {
    return [];
  }

  async createUserContribution(contribution: InsertUserContribution): Promise<UserContribution> {
    // TODO: Implement when needed
    throw new Error("Not implemented yet");
  }

  async getTranslationContexts(baseWordId: string, languageId: string): Promise<TranslationContext[]> {
    return [];
  }

  async createTranslationContext(context: InsertTranslationContext): Promise<TranslationContext> {
    // TODO: Implement when needed
    throw new Error("Not implemented yet");
  }

  async getSearchFilters(): Promise<SearchFilter[]> {
    return [];
  }

  async createSearchFilter(filter: InsertSearchFilter): Promise<SearchFilter> {
    // TODO: Implement when needed
    throw new Error("Not implemented yet");
  }

  async scrapeLanguageFamilyTree(): Promise<void> {
    // Import the language family scraper service
    const { languageFamilyScraper } = await import("./services/language-family-scraper");
    await languageFamilyScraper.scrapeComprehensiveLanguageFamilies();
  }
}

export const storage = new DatabaseStorage();