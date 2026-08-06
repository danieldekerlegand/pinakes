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
  /**
   * Sourced UNESCO endangerment vitality (US-006 language-breadth enrichment), acquired from
   * Wikidata P1999 with full provenance. Distinct from the free-text `status`; the
   * endangered-language dashboard prefers it when present. Blank/absent when unsourced.
   */
  endangermentStatus?: string | null;
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

// ============================================================================
// Geospatial record shapes
//
// Row shapes for the geospatial layers, consumed by the record → GeoJSON
// converters in web/src/lib/visualization/geospatial-transformers.ts. The
// live loaders in services/api/src/pinakes/lexicons/storage.py build the GeoJSON `*Feature` types in
// web/src/lib/visualization/geospatial-types.ts directly from `data/source/lexicons/*.tsv`.
// ============================================================================

export type LanguageRange = {
  id: string;
  languageId: string;
  familyId: string;
  /** GeoJSON geometry (Polygon or MultiPolygon) */
  geometry: unknown;
  rangeType: string;
  /** Year (negative for BCE) */
  timePeriodStart: number | null;
  /** null means "to present" */
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  /** 1-100 */
  confidence: number | null;
  sources: string[] | null;
  notes: string | null;
};

export type ArchaeologicalSite = {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  /** settlement, burial, temple, fortification, workshop, ceremonial */
  siteType: string;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  associatedLanguageIds: string[] | null;
  associatedCultureIds: string[] | null;
  /** unexcavated, partial, extensive, complete */
  excavationStatus: string | null;
  findings: string[] | null;
  /** 1-100, for marker sizing */
  importance: number | null;
  /** 1-100 */
  confidence: number | null;
  sources: string[] | null;
  description: string | null;
};

export type Civilization = {
  id: string;
  name: string;
  nativeName: string | null;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  associatedLanguageIds: string[] | null;
  writingSystems: string[] | null;
  /** Empire, city-state, etc. */
  politicalStructure: string | null;
  capital: string | null;
  /** Estimated at peak */
  population: number | null;
  sources: string[] | null;
  description: string | null;
};

export type CivilizationBoundary = {
  id: string;
  civilizationId: string;
  /** GeoJSON geometry (Polygon or MultiPolygon) */
  geometry: unknown;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  /** political, cultural, linguistic, military */
  boundaryType: string | null;
  /** 1-100 */
  confidence: number | null;
  sources: string[] | null;
  notes: string | null;
};

export type HistoricalRoute = {
  id: string;
  name: string;
  /** GeoJSON geometry (LineString) */
  geometry: unknown;
  /** trade, migration, conquest, pilgrimage, communication */
  routeType: string;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  associatedLanguageIds: string[] | null;
  linguisticImpact: string | null;
  tradedGoods: string[] | null;
  /** bidirectional, unidirectional */
  direction: string | null;
  sources: string[] | null;
  description: string | null;
};

export type MaterialCulture = {
  id: string;
  name: string;
  /** pottery, burial, architecture, tools, art, clothing, weapons */
  cultureType: string;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  associatedLanguageIds: string[] | null;
  sources: string[] | null;
  description: string | null;
};

export type MaterialCultureDistribution = {
  id: string;
  cultureId: string;
  /** GeoJSON geometry (Point, Polygon, or MultiPolygon) */
  geometry: unknown;
  /** 0-1, for heatmap */
  intensity: string | null;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string | null;
  /** Number of artifacts found */
  artifactCount: number | null;
  /** 1-100 */
  confidence: number | null;
  sources: string[] | null;
  notes: string | null;
};
