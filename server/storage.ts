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
  type WordComparison,
  type LanguageEvolution,
  type InsertLanguageEvolution,
  type UserContribution,
  type InsertUserContribution,
  type TranslationContext,
  type InsertTranslationContext,
  type SearchFilter,
  type InsertSearchFilter
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

  // Language Evolution
  getLanguageEvolution(languageId: string): Promise<LanguageEvolution[]>;
  createLanguageEvolution(evolution: InsertLanguageEvolution): Promise<LanguageEvolution>;
  
  // User Contributions
  getUserContributions(baseWordId: string): Promise<UserContribution[]>;
  createUserContribution(contribution: InsertUserContribution): Promise<UserContribution>;
  
  // Translation Contexts
  getTranslationContexts(baseWordId: string, languageId: string): Promise<TranslationContext[]>;
  createTranslationContext(context: InsertTranslationContext): Promise<TranslationContext>;
  
  // Search Filters
  getSearchFilters(): Promise<SearchFilter[]>;
  createSearchFilter(filter: InsertSearchFilter): Promise<SearchFilter>;
  deleteSearchFilter(id: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private languageFamilies: Map<string, LanguageFamily> = new Map();
  private languages: Map<string, Language> = new Map();
  private baseWords: Map<string, BaseWord> = new Map();
  private wordTranslations: Map<string, WordTranslation> = new Map();
  private scrapingJobs: Map<string, ScrapingJob> = new Map();
  private languageEvolution: Map<string, LanguageEvolution> = new Map();
  private userContributions: Map<string, UserContribution> = new Map();
  private translationContexts: Map<string, TranslationContext> = new Map();
  private searchFilters: Map<string, SearchFilter> = new Map();

  constructor() {
    this.initializeData();
  }

  private initializeData() {
    // Initialize comprehensive world language families
    
    // ============ INDO-EUROPEAN FAMILY (2.91 billion speakers) ============
    const indoEuropean: LanguageFamily = {
      id: "1",
      name: "Indo-European",
      parentId: null,
      description: "The largest language family by native speakers, spanning Europe and large parts of Asia",
      taxonomicLevel: "family",
      estimatedOrigin: "Pontic-Caspian steppe",
      timeOrigin: "3500-2500 BCE",
      region: "Europe, Western and Southern Asia, Americas, Oceania",
      totalSpeakers: 2910000000,
      languageCount: 50,
      createdAt: new Date(),
    };

    // Germanic Branch
    const germanic: LanguageFamily = {
      id: "2", 
      name: "Germanic",
      parentId: "1",
      description: "Branch including English, German, Dutch, and Scandinavian languages",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Northern Europe",
      timeOrigin: "500 BCE - 1 CE", 
      region: "Northern and Western Europe, North America, Australia",
      totalSpeakers: 515000000,
      languageCount: 15,
      createdAt: new Date(),
    };

    const westGermanic: LanguageFamily = {
      id: "4",
      name: "West Germanic", 
      parentId: "2",
      description: "Largest subfamily of Germanic including English, German, Dutch",
      taxonomicLevel: "branch",
      estimatedOrigin: "North Sea Germanic region",
      timeOrigin: "200-500 CE",
      region: "Western Europe, Americas, Oceania",
      totalSpeakers: 490000000,
      languageCount: 10,
      createdAt: new Date(),
    };

    const northGermanic: LanguageFamily = {
      id: "5",
      name: "North Germanic",
      parentId: "2", 
      description: "Scandinavian languages including Swedish, Norwegian, Danish",
      taxonomicLevel: "branch",
      estimatedOrigin: "Scandinavia",
      timeOrigin: "200-500 CE",
      region: "Scandinavia, Iceland, Faroe Islands",
      totalSpeakers: 20000000,
      languageCount: 5,
      createdAt: new Date(),
    };

    // Romance Branch
    const romance: LanguageFamily = {
      id: "3",
      name: "Romance",
      parentId: "1",
      description: "Languages descended from Latin including Spanish, French, Italian, Portuguese",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Roman Empire",
      timeOrigin: "3rd-8th century CE",
      region: "Southern Europe, Latin America, parts of Africa",
      totalSpeakers: 920000000,
      languageCount: 10,
      createdAt: new Date(),
    };

    // Indo-Iranian Branch
    const indoIranian: LanguageFamily = {
      id: "6",
      name: "Indo-Iranian",
      parentId: "1",
      description: "Largest branch of Indo-European including Hindi, Persian, Bengali",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Central Asia",
      timeOrigin: "2000-1500 BCE",
      region: "South Asia, Central Asia, Iran, Afghanistan",
      totalSpeakers: 1500000000,
      languageCount: 10,
      createdAt: new Date(),
    };

    const indoAryan: LanguageFamily = {
      id: "7",
      name: "Indo-Aryan",
      parentId: "6",
      description: "Languages of the Indian subcontinent including Hindi, Bengali, Punjabi",
      taxonomicLevel: "branch",
      estimatedOrigin: "Northwestern India",
      timeOrigin: "1500-1000 BCE",
      region: "India, Pakistan, Bangladesh, Nepal, Sri Lanka",
      totalSpeakers: 1200000000,
      languageCount: 8,
      createdAt: new Date(),
    };

    const iranian: LanguageFamily = {
      id: "8",
      name: "Iranian",
      parentId: "6",
      description: "Persian, Kurdish, Pashto and related languages",
      taxonomicLevel: "branch",
      estimatedOrigin: "Iranian Plateau",
      timeOrigin: "1000 BCE",
      region: "Iran, Afghanistan, Central Asia, parts of Iraq and Turkey",
      totalSpeakers: 300000000,
      languageCount: 4,
      createdAt: new Date(),
    };

    // Slavic Branch
    const slavic: LanguageFamily = {
      id: "9",
      name: "Slavic",
      parentId: "1",
      description: "Languages including Russian, Polish, Czech, Serbian, Bulgarian",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Eastern Europe",
      timeOrigin: "500-1000 CE",
      region: "Eastern Europe, Russia, Central Europe, Balkans",
      totalSpeakers: 315000000,
      languageCount: 6,
      createdAt: new Date(),
    };

    // ============ SINO-TIBETAN FAMILY (1.27 billion speakers) ============
    const sinoTibetan: LanguageFamily = {
      id: "10",
      name: "Sino-Tibetan", 
      parentId: null,
      description: "Second largest family including Chinese languages and Tibeto-Burman",
      taxonomicLevel: "family",
      estimatedOrigin: "Tibet-Myanmar border region",
      timeOrigin: "4500-6000 years ago",
      region: "East Asia, Southeast Asia, parts of South Asia",
      totalSpeakers: 1270000000,
      languageCount: 15,
      createdAt: new Date(),
    };

    const sinitic: LanguageFamily = {
      id: "11",
      name: "Sinitic (Chinese)",
      parentId: "10",
      description: "Chinese languages including Mandarin, Cantonese, Wu, Min",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Yellow River valley",
      timeOrigin: "1250 BCE",
      region: "China, Taiwan, Singapore, Chinese diaspora",
      totalSpeakers: 1120000000,
      languageCount: 8,
      createdAt: new Date(),
    };

    const tibetoBurman: LanguageFamily = {
      id: "12",
      name: "Tibeto-Burman",
      parentId: "10",
      description: "Languages including Tibetan, Burmese, and hundreds of smaller languages",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Tibetan Plateau and Myanmar highlands",
      timeOrigin: "2500 years ago",
      region: "Tibet, Myanmar, Nepal, Northeast India, Bhutan",
      totalSpeakers: 150000000,
      languageCount: 7,
      createdAt: new Date(),
    };

    // ============ NIGER-CONGO FAMILY (437 million speakers) ============
    const nigerCongo: LanguageFamily = {
      id: "13",
      name: "Niger-Congo",
      parentId: null,
      description: "Largest language family by number of languages, primarily in Sub-Saharan Africa",
      taxonomicLevel: "family",
      estimatedOrigin: "West-Central Africa",
      timeOrigin: "7000-10000 years ago",
      region: "Sub-Saharan Africa",
      totalSpeakers: 437000000,
      languageCount: 12,
      createdAt: new Date(),
    };

    const bantu: LanguageFamily = {
      id: "14",
      name: "Bantu",
      parentId: "13",
      description: "Largest subfamily of Niger-Congo including Swahili, Zulu, Shona",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Cameroon-Nigeria border",
      timeOrigin: "3000-5000 years ago",
      region: "Central, Eastern, and Southern Africa",
      totalSpeakers: 350000000,
      languageCount: 8,
      createdAt: new Date(),
    };

    // ============ AFROASIATIC FAMILY (500+ million speakers) ============
    const afroasiatic: LanguageFamily = {
      id: "15",
      name: "Afroasiatic",
      parentId: null,
      description: "Ancient language family including Semitic, Berber, and Cushitic languages",
      taxonomicLevel: "family",
      estimatedOrigin: "Northeast Africa or Southwest Asia",
      timeOrigin: "12000-15000 years ago",
      region: "North Africa, Horn of Africa, Southwest Asia",
      totalSpeakers: 500000000,
      languageCount: 8,
      createdAt: new Date(),
    };

    const semitic: LanguageFamily = {
      id: "16",
      name: "Semitic",
      parentId: "15",
      description: "Languages including Arabic, Hebrew, Amharic, Aramaic",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Levant or Arabian Peninsula",
      timeOrigin: "3750 BCE",
      region: "Middle East, North Africa, Horn of Africa",
      totalSpeakers: 330000000,
      languageCount: 5,
      createdAt: new Date(),
    };

    // ============ AUSTRONESIAN FAMILY (326 million speakers) ============
    const austronesian: LanguageFamily = {
      id: "17",
      name: "Austronesian",
      parentId: null,
      description: "Most geographically dispersed family, from Madagascar to Easter Island",
      taxonomicLevel: "family",
      estimatedOrigin: "Taiwan",
      timeOrigin: "5200-6000 years ago",
      region: "Southeast Asia, Pacific Islands, Madagascar",
      totalSpeakers: 326000000,
      languageCount: 10,
      createdAt: new Date(),
    };

    const malayoPolynesian: LanguageFamily = {
      id: "18",
      name: "Malayo-Polynesian",
      parentId: "17",
      description: "Largest branch including Indonesian, Tagalog, Javanese, Hawaiian",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Philippines and Indonesia",
      timeOrigin: "4000 years ago",
      region: "Indonesia, Philippines, Malaysia, Pacific Islands",
      totalSpeakers: 300000000,
      languageCount: 10,
      createdAt: new Date(),
    };

    // ============ OTHER MAJOR LANGUAGE FAMILIES ============
    const japonic: LanguageFamily = {
      id: "19",
      name: "Japonic",
      parentId: null,
      description: "Language family including Japanese and Ryukyuan languages",
      taxonomicLevel: "family",
      estimatedOrigin: "Japan",
      timeOrigin: "2000+ years ago",
      region: "Japan, Ryukyu Islands",
      totalSpeakers: 125000000,
      languageCount: 3,
      createdAt: new Date(),
    };

    const koreanic: LanguageFamily = {
      id: "20",
      name: "Koreanic",
      parentId: null,
      description: "Language family including Korean and historical varieties",
      taxonomicLevel: "family",
      estimatedOrigin: "Korean Peninsula",
      timeOrigin: "2000+ years ago",
      region: "Korean Peninsula",
      totalSpeakers: 77000000,
      languageCount: 2,
      createdAt: new Date(),
    };

    const dravidian: LanguageFamily = {
      id: "21",
      name: "Dravidian",
      parentId: null,
      description: "Languages of South India including Tamil, Telugu, Kannada, Malayalam",
      taxonomicLevel: "family",
      estimatedOrigin: "South India",
      timeOrigin: "4500 years ago",
      region: "South India, Sri Lanka",
      totalSpeakers: 245000000,
      languageCount: 5,
      createdAt: new Date(),
    };

    const altaic: LanguageFamily = {
      id: "22",
      name: "Altaic",
      parentId: null,
      description: "Controversial grouping including Turkic, Mongolic, and Tungusic",
      taxonomicLevel: "family",
      estimatedOrigin: "Central Asia",
      timeOrigin: "6000+ years ago",
      region: "Central Asia, Siberia, Turkey",
      totalSpeakers: 200000000,
      languageCount: 8,
      createdAt: new Date(),
    };

    const turkic: LanguageFamily = {
      id: "23",
      name: "Turkic",
      parentId: "22",
      description: "Languages including Turkish, Kazakh, Uzbek, Azerbaijani",
      taxonomicLevel: "subfamily",
      estimatedOrigin: "Mongolia and Southern Siberia",
      timeOrigin: "2000+ years ago",
      region: "Turkey, Central Asia, Siberia",
      totalSpeakers: 170000000,
      languageCount: 6,
      createdAt: new Date(),
    };

    const austroasiatic: LanguageFamily = {
      id: "24",
      name: "Austroasiatic",
      parentId: null,
      description: "Languages including Vietnamese, Khmer, Mon",
      taxonomicLevel: "family",
      estimatedOrigin: "Southeast Asia",
      timeOrigin: "4000+ years ago",
      region: "Southeast Asia, Eastern India",
      totalSpeakers: 117000000,
      languageCount: 4,
      createdAt: new Date(),
    };

    const kraDai: LanguageFamily = {
      id: "25",
      name: "Kra-Dai",
      parentId: null,
      description: "Languages including Thai, Lao, Zhuang",
      taxonomicLevel: "family",
      estimatedOrigin: "Southern China",
      timeOrigin: "2500+ years ago",
      region: "Thailand, Laos, Southern China",
      totalSpeakers: 93000000,
      languageCount: 4,
      createdAt: new Date(),
    };

    // Store all families
    this.languageFamilies.set("1", indoEuropean);
    this.languageFamilies.set("2", germanic);
    this.languageFamilies.set("3", romance);
    this.languageFamilies.set("4", westGermanic);
    this.languageFamilies.set("5", northGermanic);
    this.languageFamilies.set("6", indoIranian);
    this.languageFamilies.set("7", indoAryan);
    this.languageFamilies.set("8", iranian);
    this.languageFamilies.set("9", slavic);
    this.languageFamilies.set("10", sinoTibetan);
    this.languageFamilies.set("11", sinitic);
    this.languageFamilies.set("12", tibetoBurman);
    this.languageFamilies.set("13", nigerCongo);
    this.languageFamilies.set("14", bantu);
    this.languageFamilies.set("15", afroasiatic);
    this.languageFamilies.set("16", semitic);
    this.languageFamilies.set("17", austronesian);
    this.languageFamilies.set("18", malayoPolynesian);
    this.languageFamilies.set("19", japonic);
    this.languageFamilies.set("20", koreanic);
    this.languageFamilies.set("21", dravidian);
    this.languageFamilies.set("22", altaic);
    this.languageFamilies.set("23", turkic);
    this.languageFamilies.set("24", austroasiatic);
    this.languageFamilies.set("25", kraDai);

    // ============ INITIALIZE COMPREHENSIVE WORLD LANGUAGES ============
    
    // === GERMANIC LANGUAGES ===
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

    // === ROMANCE LANGUAGES ===
    const spanish: Language = {
      id: "lang14",
      name: "Spanish",
      nativeName: "español",
      iso639_1: "es",
      iso639_2: "spa",
      familyId: "3", // Romance
      parentLanguageId: null,
      region: "Spain, Latin America",
      countries: ["Spain", "Mexico", "Argentina", "Colombia", "Peru", "Venezuela"],
      nativeSpeakers: 500000000,
      totalSpeakers: 559000000,
      status: "living",
      timeOrigin: "9th century CE",
      timeEnd: null,
      classification: "Indo-European > Romance",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 40.4637, lng: -3.7492 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const french: Language = {
      id: "lang15",
      name: "French",
      nativeName: "français",
      iso639_1: "fr",
      iso639_2: "fra",
      familyId: "3", // Romance
      parentLanguageId: null,
      region: "France, Belgium, Switzerland, Canada, West Africa",
      countries: ["France", "Canada", "Belgium", "Switzerland", "Congo", "Mali"],
      nativeSpeakers: 280000000,
      totalSpeakers: 321000000,
      status: "living",
      timeOrigin: "9th century CE",
      timeEnd: null,
      classification: "Indo-European > Romance",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 46.2276, lng: 2.2137 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const italian: Language = {
      id: "lang16",
      name: "Italian",
      nativeName: "italiano",
      iso639_1: "it",
      iso639_2: "ita",
      familyId: "3", // Romance
      parentLanguageId: null,
      region: "Italy, San Marino, Vatican, Switzerland",
      countries: ["Italy", "San Marino", "Vatican City", "Switzerland"],
      nativeSpeakers: 65000000,
      totalSpeakers: 85000000,
      status: "living",
      timeOrigin: "10th century CE",
      timeEnd: null,
      classification: "Indo-European > Romance",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 41.8719, lng: 12.5674 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const portuguese: Language = {
      id: "lang17",
      name: "Portuguese",
      nativeName: "português",
      iso639_1: "pt",
      iso639_2: "por",
      familyId: "3", // Romance
      parentLanguageId: null,
      region: "Portugal, Brazil, Angola, Mozambique",
      countries: ["Brazil", "Portugal", "Angola", "Mozambique", "East Timor"],
      nativeSpeakers: 260000000,
      totalSpeakers: 279000000,
      status: "living",
      timeOrigin: "12th century CE",
      timeEnd: null,
      classification: "Indo-European > Romance",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 39.3999, lng: -8.2245 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === INDO-ARYAN LANGUAGES ===
    const hindi: Language = {
      id: "lang18",
      name: "Hindi",
      nativeName: "हिन्दी",
      iso639_1: "hi",
      iso639_2: "hin",
      familyId: "7", // Indo-Aryan
      parentLanguageId: null,
      region: "India",
      countries: ["India"],
      nativeSpeakers: 602000000,
      totalSpeakers: 692000000,
      status: "living",
      timeOrigin: "7th century CE",
      timeEnd: null,
      classification: "Indo-European > Indo-Iranian > Indo-Aryan",
      writingSystem: "Devanagari script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 20.5937, lng: 78.9629 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const bengali: Language = {
      id: "lang19",
      name: "Bengali",
      nativeName: "বাংলা",
      iso639_1: "bn",
      iso639_2: "ben",
      familyId: "7", // Indo-Aryan
      parentLanguageId: null,
      region: "Bangladesh, West Bengal (India)",
      countries: ["Bangladesh", "India"],
      nativeSpeakers: 300000000,
      totalSpeakers: 324000000,
      status: "living",
      timeOrigin: "10th century CE",
      timeEnd: null,
      classification: "Indo-European > Indo-Iranian > Indo-Aryan",
      writingSystem: "Bengali script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 23.6850, lng: 90.3563 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === IRANIAN LANGUAGES ===
    const persian: Language = {
      id: "lang20",
      name: "Persian",
      nativeName: "فارسی",
      iso639_1: "fa",
      iso639_2: "fas",
      familyId: "8", // Iranian
      parentLanguageId: null,
      region: "Iran, Afghanistan, Tajikistan",
      countries: ["Iran", "Afghanistan", "Tajikistan"],
      nativeSpeakers: 70000000,
      totalSpeakers: 110000000,
      status: "living",
      timeOrigin: "6th century BCE",
      timeEnd: null,
      classification: "Indo-European > Indo-Iranian > Iranian",
      writingSystem: "Persian alphabet",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 32.4279, lng: 53.6880 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === SLAVIC LANGUAGES ===
    const russian: Language = {
      id: "lang21",
      name: "Russian",
      nativeName: "русский",
      iso639_1: "ru",
      iso639_2: "rus",
      familyId: "9", // Slavic
      parentLanguageId: null,
      region: "Russia, Belarus, Kazakhstan, Kyrgyzstan",
      countries: ["Russia", "Belarus", "Kazakhstan", "Kyrgyzstan"],
      nativeSpeakers: 150000000,
      totalSpeakers: 258000000,
      status: "living",
      timeOrigin: "10th century CE",
      timeEnd: null,
      classification: "Indo-European > Slavic > East Slavic",
      writingSystem: "Cyrillic script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 61.5240, lng: 105.3188 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === SINITIC LANGUAGES ===
    const mandarin: Language = {
      id: "lang22",
      name: "Mandarin Chinese",
      nativeName: "官话",
      iso639_1: "zh",
      iso639_2: "zho",
      familyId: "11", // Sinitic
      parentLanguageId: null,
      region: "China, Taiwan, Singapore",
      countries: ["China", "Taiwan", "Singapore"],
      nativeSpeakers: 918000000,
      totalSpeakers: 1118000000,
      status: "living",
      timeOrigin: "14th century CE",
      timeEnd: null,
      classification: "Sino-Tibetan > Sinitic",
      writingSystem: "Chinese characters",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 35.8617, lng: 104.1954 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const cantonese: Language = {
      id: "lang23",
      name: "Cantonese",
      nativeName: "粵語",
      iso639_1: "zh",
      iso639_2: "yue",
      familyId: "11", // Sinitic
      parentLanguageId: null,
      region: "Hong Kong, Guangdong, Macau",
      countries: ["China", "Hong Kong", "Macau"],
      nativeSpeakers: 85000000,
      totalSpeakers: 88000000,
      status: "living",
      timeOrigin: "7th century CE",
      timeEnd: null,
      classification: "Sino-Tibetan > Sinitic",
      writingSystem: "Chinese characters",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 23.1291, lng: 113.2644 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === TIBETO-BURMAN LANGUAGES ===
    const burmese: Language = {
      id: "lang24",
      name: "Burmese",
      nativeName: "မြန်မာဘာသာ",
      iso639_1: "my",
      iso639_2: "mya",
      familyId: "12", // Tibeto-Burman
      parentLanguageId: null,
      region: "Myanmar",
      countries: ["Myanmar"],
      nativeSpeakers: 33000000,
      totalSpeakers: 43000000,
      status: "living",
      timeOrigin: "12th century CE",
      timeEnd: null,
      classification: "Sino-Tibetan > Tibeto-Burman",
      writingSystem: "Burmese script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 21.9162, lng: 95.9560 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === BANTU LANGUAGES ===
    const swahili: Language = {
      id: "lang25",
      name: "Swahili",
      nativeName: "Kiswahili",
      iso639_1: "sw",
      iso639_2: "swa",
      familyId: "14", // Bantu
      parentLanguageId: null,
      region: "East Africa",
      countries: ["Tanzania", "Kenya", "Uganda", "Rwanda", "Burundi", "Congo"],
      nativeSpeakers: 20000000,
      totalSpeakers: 200000000,
      status: "living",
      timeOrigin: "1st century CE",
      timeEnd: null,
      classification: "Niger-Congo > Bantu",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: -6.3690, lng: 34.8888 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === SEMITIC LANGUAGES ===
    const arabic: Language = {
      id: "lang26",
      name: "Arabic",
      nativeName: "العربية",
      iso639_1: "ar",
      iso639_2: "ara",
      familyId: "16", // Semitic
      parentLanguageId: null,
      region: "Middle East, North Africa",
      countries: ["Saudi Arabia", "Egypt", "Iraq", "Algeria", "Sudan", "Morocco"],
      nativeSpeakers: 310000000,
      totalSpeakers: 422000000,
      status: "living",
      timeOrigin: "4th century CE",
      timeEnd: null,
      classification: "Afroasiatic > Semitic",
      writingSystem: "Arabic script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 23.8859, lng: 45.0792 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const hebrew: Language = {
      id: "lang27",
      name: "Hebrew",
      nativeName: "עברית",
      iso639_1: "he",
      iso639_2: "heb",
      familyId: "16", // Semitic
      parentLanguageId: null,
      region: "Israel",
      countries: ["Israel"],
      nativeSpeakers: 9000000,
      totalSpeakers: 11000000,
      status: "living",
      timeOrigin: "10th century BCE",
      timeEnd: null,
      classification: "Afroasiatic > Semitic",
      writingSystem: "Hebrew script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 31.0461, lng: 34.8516 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === MALAYO-POLYNESIAN LANGUAGES ===
    const indonesian: Language = {
      id: "lang28",
      name: "Indonesian",
      nativeName: "Bahasa Indonesia",
      iso639_1: "id",
      iso639_2: "ind",
      familyId: "18", // Malayo-Polynesian
      parentLanguageId: null,
      region: "Indonesia",
      countries: ["Indonesia"],
      nativeSpeakers: 45000000,
      totalSpeakers: 199000000,
      status: "living",
      timeOrigin: "7th century CE",
      timeEnd: null,
      classification: "Austronesian > Malayo-Polynesian",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: -0.7893, lng: 113.9213 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const tagalog: Language = {
      id: "lang29",
      name: "Tagalog",
      nativeName: "Tagalog",
      iso639_1: "tl",
      iso639_2: "tgl",
      familyId: "18", // Malayo-Polynesian
      parentLanguageId: null,
      region: "Philippines",
      countries: ["Philippines"],
      nativeSpeakers: 28000000,
      totalSpeakers: 65000000,
      status: "living",
      timeOrigin: "10th century CE",
      timeEnd: null,
      classification: "Austronesian > Malayo-Polynesian",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 12.8797, lng: 121.7740 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === JAPONIC LANGUAGES ===
    const japanese: Language = {
      id: "lang30",
      name: "Japanese",
      nativeName: "日本語",
      iso639_1: "ja",
      iso639_2: "jpn",
      familyId: "19", // Japonic
      parentLanguageId: null,
      region: "Japan",
      countries: ["Japan"],
      nativeSpeakers: 125000000,
      totalSpeakers: 128000000,
      status: "living",
      timeOrigin: "8th century CE",
      timeEnd: null,
      classification: "Japonic",
      writingSystem: "Hiragana, Katakana, Kanji",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 36.2048, lng: 138.2529 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === KOREANIC LANGUAGES ===
    const korean: Language = {
      id: "lang31",
      name: "Korean",
      nativeName: "한국어",
      iso639_1: "ko",
      iso639_2: "kor",
      familyId: "20", // Koreanic
      parentLanguageId: null,
      region: "Korean Peninsula",
      countries: ["South Korea", "North Korea"],
      nativeSpeakers: 77000000,
      totalSpeakers: 81000000,
      status: "living",
      timeOrigin: "1st century CE",
      timeEnd: null,
      classification: "Koreanic",
      writingSystem: "Hangul",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 35.9078, lng: 127.7669 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === DRAVIDIAN LANGUAGES ===
    const tamil: Language = {
      id: "lang32",
      name: "Tamil",
      nativeName: "தமிழ்",
      iso639_1: "ta",
      iso639_2: "tam",
      familyId: "21", // Dravidian
      parentLanguageId: null,
      region: "Tamil Nadu, Sri Lanka, Singapore",
      countries: ["India", "Sri Lanka", "Singapore"],
      nativeSpeakers: 78000000,
      totalSpeakers: 89000000,
      status: "living",
      timeOrigin: "3rd century BCE",
      timeEnd: null,
      classification: "Dravidian",
      writingSystem: "Tamil script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 11.1271, lng: 78.6569 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === TURKIC LANGUAGES ===
    const turkish: Language = {
      id: "lang33",
      name: "Turkish",
      nativeName: "Türkçe",
      iso639_1: "tr",
      iso639_2: "tur",
      familyId: "23", // Turkic
      parentLanguageId: null,
      region: "Turkey, Cyprus",
      countries: ["Turkey", "Cyprus"],
      nativeSpeakers: 82000000,
      totalSpeakers: 88000000,
      status: "living",
      timeOrigin: "13th century CE",
      timeEnd: null,
      classification: "Altaic > Turkic",
      writingSystem: "Latin script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 38.9637, lng: 35.2433 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === AUSTROASIATIC LANGUAGES ===
    const vietnamese: Language = {
      id: "lang34",
      name: "Vietnamese",
      nativeName: "tiếng Việt",
      iso639_1: "vi",
      iso639_2: "vie",
      familyId: "24", // Austroasiatic
      parentLanguageId: null,
      region: "Vietnam",
      countries: ["Vietnam"],
      nativeSpeakers: 95000000,
      totalSpeakers: 98000000,
      status: "living",
      timeOrigin: "10th century CE",
      timeEnd: null,
      classification: "Austroasiatic",
      writingSystem: "Latin script with diacritics",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 14.0583, lng: 108.2772 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // === KRA-DAI LANGUAGES ===
    const thai: Language = {
      id: "lang35",
      name: "Thai",
      nativeName: "ภาษาไทย",
      iso639_1: "th",
      iso639_2: "tha",
      familyId: "25", // Kra-Dai
      parentLanguageId: null,
      region: "Thailand",
      countries: ["Thailand"],
      nativeSpeakers: 61000000,
      totalSpeakers: 69000000,
      status: "living",
      timeOrigin: "13th century CE",
      timeEnd: null,
      classification: "Kra-Dai",
      writingSystem: "Thai script",
      isHistoricalVariant: false,
      isDialect: false,
      chronologicalOrder: 1,
      historicalContext: null,
      coordinates: { lat: 15.8700, lng: 100.9925 },
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
    this.languages.set("lang14", spanish);
    this.languages.set("lang15", french);
    this.languages.set("lang16", italian);
    this.languages.set("lang17", portuguese);
    this.languages.set("lang18", hindi);
    this.languages.set("lang19", bengali);
    this.languages.set("lang20", persian);
    this.languages.set("lang21", russian);
    this.languages.set("lang22", mandarin);
    this.languages.set("lang23", cantonese);
    this.languages.set("lang24", burmese);
    this.languages.set("lang25", swahili);
    this.languages.set("lang26", arabic);
    this.languages.set("lang27", hebrew);
    this.languages.set("lang28", indonesian);
    this.languages.set("lang29", tagalog);
    this.languages.set("lang30", japanese);
    this.languages.set("lang31", korean);
    this.languages.set("lang32", tamil);
    this.languages.set("lang33", turkish);
    this.languages.set("lang34", vietnamese);
    this.languages.set("lang35", thai);

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

    // Initialize sample word translations for comparison tool
    const translationData: { [key: string]: { [key: string]: string } } = {
      // English translations
      "lang1": {
        "word1": "hello", "word2": "water", "word3": "house", "word4": "family",
        "word5": "mountain", "word6": "tree", "word7": "sun", "word8": "moon",
        "word9": "fire", "word10": "earth", "word11": "wind", "word12": "love",
        "word13": "time", "word14": "person", "word15": "woman", "word16": "man",
        "word17": "child", "word18": "mother", "word19": "father", "word20": "brother",
        "word21": "sister", "word22": "hand", "word23": "eye", "word24": "ear",
        "word25": "mouth", "word26": "food", "word27": "eat", "word28": "drink",
        "word29": "sleep", "word30": "walk", "word31": "run", "word32": "speak"
      },
      // German translations
      "lang2": {
        "word1": "hallo", "word2": "wasser", "word3": "haus", "word4": "familie",
        "word5": "berg", "word6": "baum", "word7": "sonne", "word8": "mond",
        "word9": "feuer", "word10": "erde", "word11": "wind", "word12": "liebe",
        "word13": "zeit", "word14": "person", "word15": "frau", "word16": "mann",
        "word17": "kind", "word18": "mutter", "word19": "vater", "word20": "bruder",
        "word21": "schwester", "word22": "hand", "word23": "auge", "word24": "ohr",
        "word25": "mund", "word26": "essen", "word27": "essen", "word28": "trinken",
        "word29": "schlafen", "word30": "gehen", "word31": "laufen", "word32": "sprechen"
      },
      // Old English translations
      "lang3": {
        "word1": "hæl", "word2": "wæter", "word3": "hūs", "word4": "gefræge",
        "word5": "beorg", "word6": "trēow", "word7": "sunne", "word8": "mōna",
        "word9": "fȳr", "word10": "eorþe", "word11": "wind", "word12": "lufu",
        "word13": "tīd", "word14": "mann", "word15": "wīf", "word16": "wer",
        "word17": "cild", "word18": "mōdor", "word19": "fæder", "word20": "brōþor",
        "word21": "sweoster", "word22": "hand", "word23": "ēage", "word24": "ēare",
        "word25": "mūþ", "word26": "mete", "word27": "etan", "word28": "drincan",
        "word29": "slǣpan", "word30": "gān", "word31": "rinnan", "word32": "sprecan"
      },
      // Middle English translations
      "lang4": {
        "word1": "halo", "word2": "water", "word3": "hous", "word4": "familie",
        "word5": "mountaine", "word6": "tree", "word7": "sunne", "word8": "mone",
        "word9": "fyr", "word10": "erthe", "word11": "wynd", "word12": "love",
        "word13": "tyme", "word14": "persone", "word15": "womman", "word16": "man",
        "word17": "child", "word18": "moder", "word19": "fader", "word20": "brother",
        "word21": "sister", "word22": "hond", "word23": "ye", "word24": "ere",
        "word25": "mouth", "word26": "mete", "word27": "eten", "word28": "drynken",
        "word29": "slepen", "word30": "walken", "word31": "rennen", "word32": "speken"
      },
      // Early Modern English translations
      "lang5": {
        "word1": "hello", "word2": "water", "word3": "house", "word4": "family",
        "word5": "mountaine", "word6": "tree", "word7": "sunne", "word8": "moone",
        "word9": "fire", "word10": "earth", "word11": "winde", "word12": "love",
        "word13": "time", "word14": "person", "word15": "woman", "word16": "man",
        "word17": "childe", "word18": "mother", "word19": "father", "word20": "brother",
        "word21": "sister", "word22": "hande", "word23": "eye", "word24": "eare",
        "word25": "mouth", "word26": "foode", "word27": "eate", "word28": "drinke",
        "word29": "sleepe", "word30": "walke", "word31": "runne", "word32": "speake"
      },
      // American English translations
      "lang6": {
        "word1": "hello", "word2": "water", "word3": "house", "word4": "family",
        "word5": "mountain", "word6": "tree", "word7": "sun", "word8": "moon",
        "word9": "fire", "word10": "earth", "word11": "wind", "word12": "love",
        "word13": "time", "word14": "person", "word15": "woman", "word16": "man",
        "word17": "kid", "word18": "mom", "word19": "dad", "word20": "brother",
        "word21": "sister", "word22": "hand", "word23": "eye", "word24": "ear",
        "word25": "mouth", "word26": "food", "word27": "eat", "word28": "drink",
        "word29": "sleep", "word30": "walk", "word31": "run", "word32": "talk"
      },
      // British English translations
      "lang7": {
        "word1": "hello", "word2": "water", "word3": "house", "word4": "family",
        "word5": "mountain", "word6": "tree", "word7": "sun", "word8": "moon",
        "word9": "fire", "word10": "earth", "word11": "wind", "word12": "love",
        "word13": "time", "word14": "person", "word15": "woman", "word16": "man",
        "word17": "child", "word18": "mum", "word19": "dad", "word20": "brother",
        "word21": "sister", "word22": "hand", "word23": "eye", "word24": "ear",
        "word25": "mouth", "word26": "food", "word27": "eat", "word28": "drink",
        "word29": "sleep", "word30": "walk", "word31": "run", "word32": "speak"
      },
      // Australian English translations
      "lang8": {
        "word1": "g'day", "word2": "water", "word3": "house", "word4": "family",
        "word5": "mountain", "word6": "tree", "word7": "sun", "word8": "moon",
        "word9": "fire", "word10": "earth", "word11": "wind", "word12": "love",
        "word13": "time", "word14": "person", "word15": "woman", "word16": "man",
        "word17": "kid", "word18": "mum", "word19": "dad", "word20": "brother",
        "word21": "sister", "word22": "hand", "word23": "eye", "word24": "ear",
        "word25": "mouth", "word26": "tucker", "word27": "eat", "word28": "drink",
        "word29": "sleep", "word30": "walk", "word31": "run", "word32": "speak"
      },
      // Modern English translations
      "lang9": {
        "word1": "hello", "word2": "water", "word3": "house", "word4": "family",
        "word5": "mountain", "word6": "tree", "word7": "sun", "word8": "moon",
        "word9": "fire", "word10": "earth", "word11": "wind", "word12": "love",
        "word13": "time", "word14": "person", "word15": "woman", "word16": "man",
        "word17": "child", "word18": "mother", "word19": "father", "word20": "brother",
        "word21": "sister", "word22": "hand", "word23": "eye", "word24": "ear",
        "word25": "mouth", "word26": "food", "word27": "eat", "word28": "drink",
        "word29": "sleep", "word30": "walk", "word31": "run", "word32": "speak"
      },
      // Dutch translations
      "lang10": {
        "word1": "hallo", "word2": "water", "word3": "huis", "word4": "familie",
        "word5": "berg", "word6": "boom", "word7": "zon", "word8": "maan",
        "word9": "vuur", "word10": "aarde", "word11": "wind", "word12": "liefde",
        "word13": "tijd", "word14": "persoon", "word15": "vrouw", "word16": "man",
        "word17": "kind", "word18": "moeder", "word19": "vader", "word20": "broer",
        "word21": "zus", "word22": "hand", "word23": "oog", "word24": "oor",
        "word25": "mond", "word26": "voedsel", "word27": "eten", "word28": "drinken",
        "word29": "slapen", "word30": "lopen", "word31": "rennen", "word32": "spreken"
      },
      // Swedish translations
      "lang11": {
        "word1": "hej", "word2": "vatten", "word3": "hus", "word4": "familj",
        "word5": "berg", "word6": "träd", "word7": "sol", "word8": "måne",
        "word9": "eld", "word10": "jord", "word11": "vind", "word12": "kärlek",
        "word13": "tid", "word14": "person", "word15": "kvinna", "word16": "man",
        "word17": "barn", "word18": "mamma", "word19": "pappa", "word20": "bror",
        "word21": "syster", "word22": "hand", "word23": "öga", "word24": "öra",
        "word25": "mun", "word26": "mat", "word27": "äta", "word28": "dricka",
        "word29": "sova", "word30": "gå", "word31": "springa", "word32": "tala"
      },
      // Norwegian translations
      "lang12": {
        "word1": "hei", "word2": "vann", "word3": "hus", "word4": "familie",
        "word5": "fjell", "word6": "tre", "word7": "sol", "word8": "måne",
        "word9": "ild", "word10": "jord", "word11": "vind", "word12": "kjærlighet",
        "word13": "tid", "word14": "person", "word15": "kvinne", "word16": "mann",
        "word17": "barn", "word18": "mamma", "word19": "pappa", "word20": "bror",
        "word21": "søster", "word22": "hånd", "word23": "øye", "word24": "øre",
        "word25": "munn", "word26": "mat", "word27": "spise", "word28": "drikke",
        "word29": "sove", "word30": "gå", "word31": "løpe", "word32": "snakke"
      },
      // Danish translations
      "lang13": {
        "word1": "hej", "word2": "vand", "word3": "hus", "word4": "familie",
        "word5": "bjerg", "word6": "træ", "word7": "sol", "word8": "måne",
        "word9": "ild", "word10": "jord", "word11": "vind", "word12": "kærlighed",
        "word13": "tid", "word14": "person", "word15": "kvinde", "word16": "mand",
        "word17": "barn", "word18": "mor", "word19": "far", "word20": "bror",
        "word21": "søster", "word22": "hånd", "word23": "øje", "word24": "øre",
        "word25": "mund", "word26": "mad", "word27": "spise", "word28": "drikke",
        "word29": "sove", "word30": "gå", "word31": "løbe", "word32": "tale"
      },
      // Spanish translations
      "lang14": {
        "word1": "hola", "word2": "agua", "word3": "casa", "word4": "familia",
        "word5": "montaña", "word6": "árbol", "word7": "sol", "word8": "luna",
        "word9": "fuego", "word10": "tierra", "word11": "viento", "word12": "amor",
        "word13": "tiempo", "word14": "persona", "word15": "mujer", "word16": "hombre",
        "word17": "niño", "word18": "madre", "word19": "padre", "word20": "hermano",
        "word21": "hermana", "word22": "mano", "word23": "ojo", "word24": "oreja",
        "word25": "boca", "word26": "comida", "word27": "comer", "word28": "beber",
        "word29": "dormir", "word30": "caminar", "word31": "correr", "word32": "hablar"
      },
      // French translations
      "lang15": {
        "word1": "bonjour", "word2": "eau", "word3": "maison", "word4": "famille",
        "word5": "montagne", "word6": "arbre", "word7": "soleil", "word8": "lune",
        "word9": "feu", "word10": "terre", "word11": "vent", "word12": "amour",
        "word13": "temps", "word14": "personne", "word15": "femme", "word16": "homme",
        "word17": "enfant", "word18": "mère", "word19": "père", "word20": "frère",
        "word21": "sœur", "word22": "main", "word23": "œil", "word24": "oreille",
        "word25": "bouche", "word26": "nourriture", "word27": "manger", "word28": "boire",
        "word29": "dormir", "word30": "marcher", "word31": "courir", "word32": "parler"
      },
      // Italian translations
      "lang16": {
        "word1": "ciao", "word2": "acqua", "word3": "casa", "word4": "famiglia",
        "word5": "montagna", "word6": "albero", "word7": "sole", "word8": "luna",
        "word9": "fuoco", "word10": "terra", "word11": "vento", "word12": "amore",
        "word13": "tempo", "word14": "persona", "word15": "donna", "word16": "uomo",
        "word17": "bambino", "word18": "madre", "word19": "padre", "word20": "fratello",
        "word21": "sorella", "word22": "mano", "word23": "occhio", "word24": "orecchio",
        "word25": "bocca", "word26": "cibo", "word27": "mangiare", "word28": "bere",
        "word29": "dormire", "word30": "camminare", "word31": "correre", "word32": "parlare"
      },
      // Portuguese translations
      "lang17": {
        "word1": "olá", "word2": "água", "word3": "casa", "word4": "família",
        "word5": "montanha", "word6": "árvore", "word7": "sol", "word8": "lua",
        "word9": "fogo", "word10": "terra", "word11": "vento", "word12": "amor",
        "word13": "tempo", "word14": "pessoa", "word15": "mulher", "word16": "homem",
        "word17": "criança", "word18": "mãe", "word19": "pai", "word20": "irmão",
        "word21": "irmã", "word22": "mão", "word23": "olho", "word24": "orelha",
        "word25": "boca", "word26": "comida", "word27": "comer", "word28": "beber",
        "word29": "dormir", "word30": "andar", "word31": "correr", "word32": "falar"
      },
      // Hindi translations
      "lang18": {
        "word1": "नमस्ते", "word2": "पानी", "word3": "घर", "word4": "परिवार",
        "word5": "पहाड़", "word6": "पेड़", "word7": "सूर्य", "word8": "चाँद",
        "word9": "आग", "word10": "पृथ्वी", "word11": "हवा", "word12": "प्रेम",
        "word13": "समय", "word14": "व्यक्ति", "word15": "महिला", "word16": "पुरुष",
        "word17": "बच्चा", "word18": "माता", "word19": "पिता", "word20": "भाई",
        "word21": "बहन", "word22": "हाथ", "word23": "आंख", "word24": "कान",
        "word25": "मुंह", "word26": "भोजन", "word27": "खाना", "word28": "पीना",
        "word29": "सोना", "word30": "चलना", "word31": "दौड़ना", "word32": "बोलना"
      },
      // Bengali translations
      "lang19": {
        "word1": "নমস্কার", "word2": "পানি", "word3": "ঘর", "word4": "পরিবার",
        "word5": "পর্বত", "word6": "গাছ", "word7": "সূর্য", "word8": "চাঁদ",
        "word9": "আগুন", "word10": "পৃথিবী", "word11": "বাতাস", "word12": "ভালোবাসা",
        "word13": "সময়", "word14": "ব্যক্তি", "word15": "মহিলা", "word16": "পুরুষ",
        "word17": "শিশু", "word18": "মা", "word19": "বাবা", "word20": "ভাই",
        "word21": "বোন", "word22": "হাত", "word23": "চোখ", "word24": "কান",
        "word25": "মুখ", "word26": "খাবার", "word27": "খাওয়া", "word28": "পান করা",
        "word29": "ঘুমানো", "word30": "হাঁটা", "word31": "দৌড়ানো", "word32": "কথা বলা"
      },
      // Persian translations
      "lang20": {
        "word1": "سلام", "word2": "آب", "word3": "خانه", "word4": "خانواده",
        "word5": "کوه", "word6": "درخت", "word7": "خورشید", "word8": "ماه",
        "word9": "آتش", "word10": "زمین", "word11": "باد", "word12": "عشق",
        "word13": "زمان", "word14": "شخص", "word15": "زن", "word16": "مرد",
        "word17": "کودک", "word18": "مادر", "word19": "پدر", "word20": "برادر",
        "word21": "خواهر", "word22": "دست", "word23": "چشم", "word24": "گوش",
        "word25": "دهان", "word26": "غذا", "word27": "خوردن", "word28": "نوشیدن",
        "word29": "خوابیدن", "word30": "راه رفتن", "word31": "دویدن", "word32": "صحبت کردن"
      },
      // Russian translations
      "lang21": {
        "word1": "привет", "word2": "вода", "word3": "дом", "word4": "семья",
        "word5": "гора", "word6": "дерево", "word7": "солнце", "word8": "луна",
        "word9": "огонь", "word10": "земля", "word11": "ветер", "word12": "любовь",
        "word13": "время", "word14": "человек", "word15": "женщина", "word16": "мужчина",
        "word17": "ребёнок", "word18": "мать", "word19": "отец", "word20": "брат",
        "word21": "сестра", "word22": "рука", "word23": "глаз", "word24": "ухо",
        "word25": "рот", "word26": "еда", "word27": "есть", "word28": "пить",
        "word29": "спать", "word30": "идти", "word31": "бежать", "word32": "говорить"
      },
      // Mandarin Chinese translations
      "lang22": {
        "word1": "你好", "word2": "水", "word3": "房子", "word4": "家庭",
        "word5": "山", "word6": "树", "word7": "太阳", "word8": "月亮",
        "word9": "火", "word10": "地球", "word11": "风", "word12": "爱",
        "word13": "时间", "word14": "人", "word15": "女人", "word16": "男人",
        "word17": "孩子", "word18": "母亲", "word19": "父亲", "word20": "兄弟",
        "word21": "姐妹", "word22": "手", "word23": "眼睛", "word24": "耳朵",
        "word25": "嘴", "word26": "食物", "word27": "吃", "word28": "喝",
        "word29": "睡觉", "word30": "走", "word31": "跑", "word32": "说话"
      },
      // Cantonese translations
      "lang23": {
        "word1": "你好", "word2": "水", "word3": "屋企", "word4": "家庭",
        "word5": "山", "word6": "樹", "word7": "太陽", "word8": "月亮",
        "word9": "火", "word10": "地球", "word11": "風", "word12": "愛",
        "word13": "時間", "word14": "人", "word15": "女人", "word16": "男人",
        "word17": "細路", "word18": "阿媽", "word19": "阿爸", "word20": "兄弟",
        "word21": "姊妹", "word22": "手", "word23": "眼", "word24": "耳仔",
        "word25": "口", "word26": "嘢食", "word27": "食", "word28": "飲",
        "word29": "瞓覺", "word30": "行", "word31": "跑", "word32": "講嘢"
      },
      // Burmese translations
      "lang24": {
        "word1": "မင်္ဂလာပါ", "word2": "ရေ", "word3": "အိမ်", "word4": "မိသားစု",
        "word5": "တောင်", "word6": "သစ်ပင်", "word7": "နေ", "word8": "လ",
        "word9": "မီး", "word10": "ကမ္ဘာ", "word11": "လေ", "word12": "ချစ်ခြင်း",
        "word13": "အချိန်", "word14": "လူ", "word15": "အမျိုးသမီး", "word16": "အမျိုးသား",
        "word17": "ကလေး", "word18": "အမေ", "word19": "အဖေ", "word20": "အစ်ကို",
        "word21": "အစ်မ", "word22": "လက်", "word23": "မျက်လုံး", "word24": "နား",
        "word25": "ပါးစပ်", "word26": "အစားအစာ", "word27": "စား", "word28": "သောက်",
        "word29": "အိပ်", "word30": "လမ်းလျှောက်", "word31": "ပြေး", "word32": "ပြော"
      },
      // Swahili translations
      "lang25": {
        "word1": "hujambo", "word2": "maji", "word3": "nyumba", "word4": "familia",
        "word5": "mlima", "word6": "mti", "word7": "jua", "word8": "mwezi",
        "word9": "moto", "word10": "dunia", "word11": "upepo", "word12": "upendo",
        "word13": "wakati", "word14": "mtu", "word15": "mwanamke", "word16": "mwanaume",
        "word17": "mtoto", "word18": "mama", "word19": "baba", "word20": "kaka",
        "word21": "dada", "word22": "mkono", "word23": "jicho", "word24": "sikio",
        "word25": "mdomo", "word26": "chakula", "word27": "kula", "word28": "kunywa",
        "word29": "kulala", "word30": "kutembea", "word31": "kukimbia", "word32": "kusema"
      },
      // Arabic translations
      "lang26": {
        "word1": "مرحبا", "word2": "ماء", "word3": "بيت", "word4": "عائلة",
        "word5": "جبل", "word6": "شجرة", "word7": "شمس", "word8": "قمر",
        "word9": "نار", "word10": "أرض", "word11": "ريح", "word12": "حب",
        "word13": "وقت", "word14": "شخص", "word15": "امرأة", "word16": "رجل",
        "word17": "طفل", "word18": "أم", "word19": "أب", "word20": "أخ",
        "word21": "أخت", "word22": "يد", "word23": "عين", "word24": "أذن",
        "word25": "فم", "word26": "طعام", "word27": "أكل", "word28": "شرب",
        "word29": "نوم", "word30": "مشي", "word31": "جري", "word32": "كلام"
      },
      // Hebrew translations
      "lang27": {
        "word1": "שלום", "word2": "מים", "word3": "בית", "word4": "משפחה",
        "word5": "הר", "word6": "עץ", "word7": "שמש", "word8": "ירח",
        "word9": "אש", "word10": "אדמה", "word11": "רוח", "word12": "אהבה",
        "word13": "זמן", "word14": "אדם", "word15": "אישה", "word16": "גבר",
        "word17": "ילד", "word18": "אמא", "word19": "אבא", "word20": "אח",
        "word21": "אחות", "word22": "יד", "word23": "עין", "word24": "אוזן",
        "word25": "פה", "word26": "אוכל", "word27": "לאכול", "word28": "לשתות",
        "word29": "לישון", "word30": "ללכת", "word31": "לרוץ", "word32": "לדבר"
      },
      // Indonesian translations
      "lang28": {
        "word1": "halo", "word2": "air", "word3": "rumah", "word4": "keluarga",
        "word5": "gunung", "word6": "pohon", "word7": "matahari", "word8": "bulan",
        "word9": "api", "word10": "bumi", "word11": "angin", "word12": "cinta",
        "word13": "waktu", "word14": "orang", "word15": "wanita", "word16": "pria",
        "word17": "anak", "word18": "ibu", "word19": "ayah", "word20": "saudara",
        "word21": "saudari", "word22": "tangan", "word23": "mata", "word24": "telinga",
        "word25": "mulut", "word26": "makanan", "word27": "makan", "word28": "minum",
        "word29": "tidur", "word30": "berjalan", "word31": "berlari", "word32": "berbicara"
      },
      // Tagalog translations
      "lang29": {
        "word1": "kumusta", "word2": "tubig", "word3": "bahay", "word4": "pamilya",
        "word5": "bundok", "word6": "puno", "word7": "araw", "word8": "buwan",
        "word9": "apoy", "word10": "mundo", "word11": "hangin", "word12": "pagmamahal",
        "word13": "oras", "word14": "tao", "word15": "babae", "word16": "lalaki",
        "word17": "bata", "word18": "ina", "word19": "ama", "word20": "kuya",
        "word21": "ate", "word22": "kamay", "word23": "mata", "word24": "tenga",
        "word25": "bibig", "word26": "pagkain", "word27": "kumain", "word28": "uminom",
        "word29": "matulog", "word30": "maglakad", "word31": "tumakbo", "word32": "magsalita"
      },
      // Japanese translations
      "lang30": {
        "word1": "こんにちは", "word2": "水", "word3": "家", "word4": "家族",
        "word5": "山", "word6": "木", "word7": "太陽", "word8": "月",
        "word9": "火", "word10": "地球", "word11": "風", "word12": "愛",
        "word13": "時間", "word14": "人", "word15": "女性", "word16": "男性",
        "word17": "子供", "word18": "母", "word19": "父", "word20": "兄弟",
        "word21": "姉妹", "word22": "手", "word23": "目", "word24": "耳",
        "word25": "口", "word26": "食べ物", "word27": "食べる", "word28": "飲む",
        "word29": "寝る", "word30": "歩く", "word31": "走る", "word32": "話す"
      },
      // Korean translations
      "lang31": {
        "word1": "안녕하세요", "word2": "물", "word3": "집", "word4": "가족",
        "word5": "산", "word6": "나무", "word7": "태양", "word8": "달",
        "word9": "불", "word10": "지구", "word11": "바람", "word12": "사랑",
        "word13": "시간", "word14": "사람", "word15": "여자", "word16": "남자",
        "word17": "아이", "word18": "어머니", "word19": "아버지", "word20": "형제",
        "word21": "자매", "word22": "손", "word23": "눈", "word24": "귀",
        "word25": "입", "word26": "음식", "word27": "먹다", "word28": "마시다",
        "word29": "자다", "word30": "걷다", "word31": "뛰다", "word32": "말하다"
      },
      // Tamil translations
      "lang32": {
        "word1": "வணக்கம்", "word2": "நீர்", "word3": "வீடு", "word4": "குடும்பம்",
        "word5": "மலை", "word6": "மரம்", "word7": "சூரியன்", "word8": "சந்திரன்",
        "word9": "நெருப்பு", "word10": "பூமி", "word11": "காற்று", "word12": "காதல்",
        "word13": "நேரம்", "word14": "நபர்", "word15": "பெண்", "word16": "ஆண்",
        "word17": "குழந்தை", "word18": "அம்மா", "word19": "அப்பா", "word20": "சகோதரன்",
        "word21": "சகோதரி", "word22": "கை", "word23": "கண்", "word24": "காது",
        "word25": "வாய்", "word26": "உணவு", "word27": "சாப்பிட", "word28": "குடிக்க",
        "word29": "தூங்க", "word30": "நடக்க", "word31": "ஓட", "word32": "பேச"
      },
      // Turkish translations
      "lang33": {
        "word1": "merhaba", "word2": "su", "word3": "ev", "word4": "aile",
        "word5": "dağ", "word6": "ağaç", "word7": "güneş", "word8": "ay",
        "word9": "ateş", "word10": "dünya", "word11": "rüzgar", "word12": "aşk",
        "word13": "zaman", "word14": "kişi", "word15": "kadın", "word16": "erkek",
        "word17": "çocuk", "word18": "anne", "word19": "baba", "word20": "kardeş",
        "word21": "kız kardeş", "word22": "el", "word23": "göz", "word24": "kulak",
        "word25": "ağız", "word26": "yemek", "word27": "yemek", "word28": "içmek",
        "word29": "uyumak", "word30": "yürümek", "word31": "koşmak", "word32": "konuşmak"
      },
      // Vietnamese translations
      "lang34": {
        "word1": "xin chào", "word2": "nước", "word3": "nhà", "word4": "gia đình",
        "word5": "núi", "word6": "cây", "word7": "mặt trời", "word8": "mặt trăng",
        "word9": "lửa", "word10": "trái đất", "word11": "gió", "word12": "tình yêu",
        "word13": "thời gian", "word14": "người", "word15": "phụ nữ", "word16": "đàn ông",
        "word17": "trẻ em", "word18": "mẹ", "word19": "bố", "word20": "anh trai",
        "word21": "chị gái", "word22": "tay", "word23": "mắt", "word24": "tai",
        "word25": "miệng", "word26": "thức ăn", "word27": "ăn", "word28": "uống",
        "word29": "ngủ", "word30": "đi bộ", "word31": "chạy", "word32": "nói"
      },
      // Thai translations
      "lang35": {
        "word1": "สวัสดี", "word2": "น้ำ", "word3": "บ้าน", "word4": "ครอบครัว",
        "word5": "ภูเขา", "word6": "ต้นไม้", "word7": "ดวงอาทิตย์", "word8": "ดวงจันทร์",
        "word9": "ไฟ", "word10": "โลก", "word11": "ลม", "word12": "ความรัก",
        "word13": "เวลา", "word14": "คน", "word15": "ผู้หญิง", "word16": "ผู้ชาย",
        "word17": "เด็ก", "word18": "แม่", "word19": "พ่อ", "word20": "พี่ชาย",
        "word21": "พี่สาว", "word22": "มือ", "word23": "ตา", "word24": "หู",
        "word25": "ปาก", "word26": "อาหาร", "word27": "กิน", "word28": "ดื่ม",
        "word29": "นอน", "word30": "เดิน", "word31": "วิ่ง", "word32": "พูด"
      }
    };

    // Create word translation records
    Object.entries(translationData).forEach(([languageId, translations]) => {
      Object.entries(translations).forEach(([wordId, translation]) => {
        const wordTranslation: WordTranslation = {
          id: `${wordId}_${languageId}`,
          baseWordId: wordId,
          languageId: languageId,
          translation: translation,
          pronunciation: null,
          notes: null,
          source: "sample_data",
          verified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.wordTranslations.set(wordTranslation.id, wordTranslation);
      });
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
          // Only include root languages (no parentLanguageId) for the main language list
          languages: languages
            .filter(lang => lang.familyId === family.id && !lang.parentLanguageId)
            .map(lang => {
              // Get all historical variants and dialects recursively
              const getVariantsAndDialects = (parentLangId: string): { variants: any[], dialects: any[] } => {
                const children = languages.filter(l => l.parentLanguageId === parentLangId);
                const variants = children.filter(l => l.isHistoricalVariant);
                const dialects = children.filter(l => l.isDialect);
                
                // For each variant, also get its child dialects
                variants.forEach(variant => {
                  const variantChildren = getVariantsAndDialects(variant.id);
                  dialects.push(...variantChildren.dialects);
                });
                
                return { variants, dialects };
              };
              
              const { variants, dialects } = getVariantsAndDialects(lang.id);
              
              return {
                ...lang,
                historicalVariants: variants,
                dialects: dialects
              };
            })
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

  // Language Evolution methods
  async getLanguageEvolution(languageId: string): Promise<LanguageEvolution[]> {
    return Array.from(this.languageEvolution.values())
      .filter(evolution => evolution.languageId === languageId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async createLanguageEvolution(evolution: InsertLanguageEvolution): Promise<LanguageEvolution> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const newEvolution: LanguageEvolution = {
      id,
      ...evolution,
      createdAt: now,
      updatedAt: now,
    };
    this.languageEvolution.set(id, newEvolution);
    return newEvolution;
  }

  // User Contributions methods
  async getUserContributions(baseWordId: string): Promise<UserContribution[]> {
    const contributions = Array.from(this.userContributions.values())
      .filter(contribution => contribution.baseWordId === baseWordId);
    
    // Add language names
    return contributions.map(contrib => {
      const language = this.languages.get(contrib.languageId);
      return {
        ...contrib,
        languageName: language?.name || 'Unknown Language'
      } as UserContribution & { languageName: string };
    });
  }

  async createUserContribution(contribution: InsertUserContribution): Promise<UserContribution> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const newContribution: UserContribution = {
      id,
      ...contribution,
      createdAt: now,
      updatedAt: now,
    };
    this.userContributions.set(id, newContribution);
    return newContribution;
  }

  // Translation Contexts methods
  async getTranslationContexts(baseWordId: string, languageId: string): Promise<TranslationContext[]> {
    return Array.from(this.translationContexts.values())
      .filter(context => context.baseWordId === baseWordId && context.languageId === languageId)
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  async createTranslationContext(context: InsertTranslationContext): Promise<TranslationContext> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const newContext: TranslationContext = {
      id,
      ...context,
      generatedAt: now,
      updatedAt: now,
    };
    this.translationContexts.set(id, newContext);
    return newContext;
  }

  // Search Filters methods
  async getSearchFilters(): Promise<SearchFilter[]> {
    return Array.from(this.searchFilters.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createSearchFilter(filter: InsertSearchFilter): Promise<SearchFilter> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const newFilter: SearchFilter = {
      id,
      ...filter,
      createdAt: now,
      updatedAt: now,
    };
    this.searchFilters.set(id, newFilter);
    return newFilter;
  }

  async deleteSearchFilter(id: string): Promise<void> {
    this.searchFilters.delete(id);
  }
}

export const storage = new MemStorage();