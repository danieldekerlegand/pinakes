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

// Sankey diagram types for cultural influence flow
export type SankeyNode = {
  id: string;
  name: string;
  group: string; // e.g. language family or civilization type
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  contactType: string;
  timePeriod: string;
};

export type SankeyData = {
  nodes: SankeyNode[];
  links: SankeyLink[];
};

// Generic reusable Sankey flow types for any flow/influence dataset
export type SankeyFlowNode = {
  id: string;
  label: string;
  group: string;
};

export type SankeyFlowLink = {
  source: string;
  target: string;
  value: number;
  category?: string;
  metadata?: Record<string, string>;
};

export type SankeyFlowData = {
  nodes: SankeyFlowNode[];
  links: SankeyFlowLink[];
};

// Chord diagram types for mutual language family influences
export type ChordEntry = {
  source: string;
  target: string;
  value: number;
};

export type ChordData = {
  names: string[];
  matrix: number[][];
};

// Culture profile types for the culture explorer
export type CultureProfile = {
  id: string;
  name: string;
  alternateNames: string[];
  civilizationId: string | null;
  archaeologicalCultureId: string | null;
  timePeriodStart: number;
  timePeriodEnd: number;
  region: string;
  summaryDescription: string;
  socialOrganization: 'egalitarian' | 'chiefdom' | 'state' | 'empire';
  subsistenceType: 'hunter-gatherer' | 'pastoral' | 'agricultural' | 'maritime' | 'mixed';
  urbanismLevel: 'nomadic' | 'village' | 'town' | 'city-state' | 'metropolis';
  populationEstimate: number | null;
  technologyLevel: 'stone' | 'copper' | 'bronze' | 'iron' | 'steel' | 'industrial';
  associatedLanguageIds: string[];
  associatedReligionIds: string[];
  associatedWritingSystemIds: string[];
  associatedArtTraditionIds: string[];
  associatedMusicTraditionIds: string[];
  associatedCuisineId: string | null;
  associatedArchitecturalStyleIds: string[];
  associatedLiteraryTraditionIds: string[];
  notableSettlements: string[];
  imageGalleryTags: string[];
  sources: string[];
};
