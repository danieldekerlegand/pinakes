export type LanguageFamily = {
  id: string;
  name: string;
  parentId: string | null;
  description?: string | null;
  taxonomicLevel: string;
  region?: string | null;
  totalSpeakers?: number | null;
  languageCount?: number | null;
  source?: 'northeuralex' | 'scraped';
};

export type Language = {
  id: string;
  name: string;
  nativeName?: string | null;
  iso639_1?: string | null;
  iso639_2?: string | null;
  familyId: string;
  parentLanguageId?: string | null;
  region?: string | null;
  countries?: string[];
  nativeSpeakers?: number | null;
  totalSpeakers?: number | null;
  status: string;
  timeOrigin?: string | null;
  timeEnd?: string | null;
  classification?: string | null;
  writingSystem?: string | null;
  isHistoricalVariant?: boolean;
  isDialect?: boolean;
  chronologicalOrder?: number;
  historicalContext?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  source?: 'northeuralex' | 'scraped';
};

export type BaseWord = {
  id: string;
  word: string;
  position: number;
  category?: string | null;
  frequency?: string | null;
  difficulty?: number | null;
  pos?: string | null;
  notes?: string | null;
  definition?: string | null;
};

export type WordTranslation = {
  id: string;
  baseWordId: string;
  languageId: string;
  translation?: string | null;
  pronunciation?: string | null;
  notes?: string | null;
  source?: string | null;
  verified?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type LanguageWithVariants = Language & {
  historicalVariants: Language[];
  dialects: Language[];
};

export type LanguageFamilyWithChildren = LanguageFamily & {
  children: LanguageFamilyWithChildren[];
  languages: LanguageWithVariants[];
};

export type LanguageWithStats = Language & {
  completionPercentage: number;
  lastScrapedAt?: string;
  scrapingStatus?: "pending" | "running" | "completed" | "failed";
  historicalVariants: Language[];
  dialects: Language[];
};

export type WordComparison = {
  baseWord: string;
  conceptId?: string;
  position?: number;
  category?: string;
  translations: { [languageId: string]: { form: string; ipa: string | null } | string };
};

export type ScrapingJob = {
  id: string;
  languageId: string;
  status: string;
  totalWords?: number | null;
  completedWords?: number | null;
  failedWords?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  statusMessage?: string | null; // Current progress message for UI display
  createdAt?: string | null;
  dataSource?: 'gemini' | 'wiktionary' | 'merriam-webster' | 'other' | null;
  outputPath?: string | null;
  wordCount?: number | null;
  apiCallsUsed?: number | null;
};
