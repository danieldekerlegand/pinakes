import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, json, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Core classification and language tables

export const languageFamilies = pgTable("language_families", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  parentId: varchar("parent_id").references((): any => languageFamilies.id),
  description: text("description"),
  taxonomicLevel: text("taxonomic_level").notNull().default("family"), // phylum, stock, family, subfamily, branch, group, complex
  estimatedOrigin: text("estimated_origin"),
  timeOrigin: text("time_origin"),
  region: text("region"),
  totalSpeakers: integer("total_speakers").default(0),
  languageCount: integer("language_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Canonical languages table for all genealogical nodes
export const languages = pgTable("languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  iso639_1: varchar("iso639_1", { length: 2 }),
  iso639_2: varchar("iso639_2", { length: 3 }),
  familyId: varchar("family_id").references((): any => languageFamilies.id).notNull(),
  parentLanguageId: varchar("parent_language_id").references((): any => languages.id),
  region: text("region"),
  countries: jsonb("countries").$type<string[]>().default([]),
  nativeSpeakers: integer("native_speakers").default(0),
  totalSpeakers: integer("total_speakers").default(0),
  status: text("status").notNull(),
  timeOrigin: text("time_origin"),
  timeEnd: text("time_end"),
  classification: text("classification"),
  writingSystem: text("writing_system"),
  isHistoricalVariant: boolean("is_historical_variant").default(false),
  isDialect: boolean("is_dialect").default(false),
  chronologicalOrder: integer("chronological_order").default(0),
  historicalContext: text("historical_context"),
  coordinates: jsonb("coordinates").$type<{lat: number, lng: number}>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const baseWords = pgTable("base_words", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  word: text("word").notNull().unique(),
  position: integer("position").notNull(),
  category: text("category"),
  frequency: decimal("frequency", { precision: 3, scale: 2 }).default("1.0"),
  difficulty: integer("difficulty").default(1),
  pos: varchar("pos", { length: 20 }),
  notes: text("notes"),
  definition: text("definition"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const wordTranslations = pgTable("word_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  baseWordId: varchar("base_word_id").references(() => baseWords.id).notNull(),
  languageId: varchar("language_id").references(() => languages.id).notNull(),
  translation: text("translation"),
  pronunciation: text("pronunciation"),
  notes: text("notes"),
  source: text("source"),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scrapingJobs = pgTable("scraping_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  languageId: varchar("language_id").references(() => languages.id).notNull(),
  status: text("status").notNull(), // pending, running, completed, failed
  totalWords: integer("total_words").default(0),
  completedWords: integer("completed_words").default(0),
  failedWords: integer("failed_words").default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  dataSource: text("data_source"), // gemini, wiktionary, merriam-webster, other
  outputPath: text("output_path"), // TSV file path where results are stored
  wordCount: integer("word_count"), // Number of words scraped
  apiCallsUsed: integer("api_calls_used"), // Track API usage
  createdAt: timestamp("created_at").defaultNow(),
});

// Language Evolution Timeline
export const languageEvolution = pgTable("language_evolution", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  languageId: varchar("language_id").notNull().references(() => languages.id),
  timelineEvent: text("timeline_event").notNull(),
  period: text("period").notNull(), // e.g., "500-1100 CE", "Modern Era"
  description: text("description").notNull(),
  linguisticChanges: jsonb("linguistic_changes").$type<string[]>().default([]),
  geographicInfluence: text("geographic_influence"),
  culturalContext: text("cultural_context"),
  evidenceSources: jsonb("evidence_sources").$type<string[]>().default([]),
  contributorId: text("contributor_id"),
  verificationStatus: text("verification_status").default("pending"), // pending, verified, disputed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Contributions for Word Translations
export const userContributions = pgTable("user_contributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  baseWordId: varchar("base_word_id").notNull().references(() => baseWords.id),
  languageId: varchar("language_id").notNull().references(() => languages.id),
  translation: text("translation").notNull(),
  pronunciation: text("pronunciation"),
  contextNotes: text("context_notes"),
  etymology: text("etymology"),
  usageExamples: jsonb("usage_examples").$type<string[]>().default([]),
  dialectVariant: text("dialect_variant"),
  contributorName: text("contributor_name"),
  contributorEmail: text("contributor_email"),
  sourceReferences: jsonb("source_references").$type<string[]>().default([]),
  confidence: integer("confidence").default(50), // 1-100 scale
  verificationStatus: text("verification_status").default("pending"), // pending, approved, rejected
  moderatorNotes: text("moderator_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Etymology and Historical Word Migration Tracking
export const etymologies = pgTable("etymologies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  baseWordId: varchar("base_word_id").notNull().references(() => baseWords.id),
  sourceLanguageId: varchar("source_language_id").references(() => languages.id),
  targetLanguageId: varchar("target_language_id").notNull().references(() => languages.id),
  originalForm: text("original_form").notNull(), // Original word form in source language
  currentForm: text("current_form").notNull(), // Current form in target language
  etymologyPath: jsonb("etymology_path").$type<{
    language: string;
    form: string;
    meaning: string;
    timeperiod: string;
    notes?: string;
  }[]>().default([]), // Complete migration path
  migrationRoute: jsonb("migration_route").$type<{
    fromLanguage: string;
    toLanguage: string;
    timeperiod: string;
    mechanism: string; // borrowing, conquest, trade, cultural_contact, etc.
    confidence: number; // 1-100
  }[]>().default([]),
  cognates: jsonb("cognates").$type<{
    language: string;
    form: string;
    meaning: string;
    relationship: string; // direct_descendant, borrowing, cognate, false_friend
  }[]>().default([]),
  semanticShifts: jsonb("semantic_shifts").$type<{
    timeperiod: string;
    oldMeaning: string;
    newMeaning: string;
    mechanism: string; // metaphor, metonymy, narrowing, broadening, etc.
  }[]>().default([]),
  phoneticChanges: jsonb("phonetic_changes").$type<{
    timeperiod: string;
    oldForm: string;
    newForm: string;
    soundLaw: string;
    environment?: string;
  }[]>().default([]),
  firstAttestation: text("first_attestation"), // Earliest recorded usage
  attestationSource: text("attestation_source"), // Historical source/document
  etymologyConfidence: integer("etymology_confidence").default(50), // 1-100 scale
  scholarlyNotes: text("scholarly_notes"),
  sources: jsonb("sources").$type<string[]>().default([]),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Word Migration Events - specific historical borrowing/transmission events
export const wordMigrations = pgTable("word_migrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  etymologyId: varchar("etymology_id").notNull().references(() => etymologies.id),
  sourceLanguageId: varchar("source_language_id").notNull().references(() => languages.id),
  targetLanguageId: varchar("target_language_id").notNull().references(() => languages.id),
  sourceForm: text("source_form").notNull(),
  targetForm: text("target_form").notNull(),
  migrationPeriod: text("migration_period").notNull(), // e.g., "1066-1200 CE"
  migrationMechanism: text("migration_mechanism").notNull(), // conquest, trade, religion, scholarship, etc.
  historicalContext: text("historical_context"), // Historical event that caused migration
  geographicRoute: jsonb("geographic_route").$type<{
    region: string;
    coordinates?: { lat: number; lng: number };
    role: string; // origin, intermediate, destination
  }[]>().default([]),
  culturalImpact: text("cultural_impact"), // How the word transmission affected culture
  frequency: text("frequency"), // common, rare, specialized, obsolete
  socialRegister: text("social_register"), // formal, informal, technical, archaic
  confidence: integer("confidence").default(50), // 1-100 confidence in this migration
  evidenceSources: jsonb("evidence_sources").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Etymological Networks - connections between related words
export const etymologicalNetworks = pgTable("etymological_networks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  networkName: text("network_name").notNull(), // e.g., "Proto-Indo-European *h₂er-"
  rootForm: text("root_form"), // Reconstructed root form
  protoLanguage: text("proto_language"), // e.g., "Proto-Indo-European"
  semanticField: text("semantic_field"), // e.g., "agriculture", "kinship", "warfare"
  members: jsonb("members").$type<{
    languageId: string;
    baseWordId: string;
    form: string;
    meaning: string;
    relationship: string; // direct_descendant, cognate, derivative
  }[]>().default([]),
  reconstruction: text("reconstruction"), // Scholarly reconstruction notes
  scholarConsensus: integer("scholar_consensus").default(50), // 1-100 agreement level
  controversies: text("controversies"), // Scholarly debates about this etymology
  references: jsonb("references").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI-Generated Translation Contexts
export const translationContexts = pgTable("translation_contexts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  baseWordId: varchar("base_word_id").notNull().references(() => baseWords.id),
  languageId: varchar("language_id").notNull().references(() => languages.id),
  contextType: text("context_type").notNull(), // cultural, historical, semantic, phonetic
  contextDescription: text("context_description").notNull(),
  aiGeneratedInsight: text("ai_generated_insight"),
  linguisticAnalysis: jsonb("linguistic_analysis").$type<{
    semanticField: string[];
    cognates: string[];
    borrowings: string[];
    soundChanges: string[];
  }>(),
  relatedTerms: jsonb("related_terms").$type<string[]>().default([]),
  crossLinguisticComparisons: jsonb("cross_linguistic_comparisons").$type<{
    language: string;
    term: string;
    relationship: string;
  }[]>().default([]),
  confidence: integer("confidence").default(80), // AI confidence level
  humanVerified: boolean("human_verified").default(false),
  generatedAt: timestamp("generated_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Advanced Search Filters Storage
export const searchFilters = pgTable("search_filters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id"), // Optional user association
  filterName: text("filter_name").notNull(),
  languageFamilies: jsonb("language_families").$type<string[]>().default([]),
  timePeriodsFrom: text("time_periods_from"),
  timePeriodsTo: text("time_periods_to"),
  geographicRegions: jsonb("geographic_regions").$type<string[]>().default([]),
  speakerCountMin: integer("speaker_count_min"),
  speakerCountMax: integer("speaker_count_max"),
  languageStatus: jsonb("language_status").$type<string[]>().default([]), // living, endangered, extinct
  etymologyPatterns: jsonb("etymology_patterns").$type<string[]>().default([]),
  phoneticFeatures: jsonb("phonetic_features").$type<string[]>().default([]),
  writingSystems: jsonb("writing_systems").$type<string[]>().default([]),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// Geospatial and Historical Data Tables
// ============================================================================

// Language Ranges - GeoJSON polygons for language territories
export const languageRanges = pgTable("language_ranges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  languageId: varchar("language_id").notNull().references(() => languages.id),
  familyId: varchar("family_id").notNull().references(() => languageFamilies.id),
  geometry: jsonb("geometry").notNull(), // GeoJSON geometry (Polygon or MultiPolygon)
  rangeType: text("range_type").notNull().default("current"), // current, historical, reconstructed
  timePeriodStart: integer("time_period_start"), // Year (negative for BCE)
  timePeriodEnd: integer("time_period_end"), // null means "to present"
  timePeriodLabel: text("time_period_label"), // Human-readable label
  confidence: integer("confidence").default(50), // 1-100
  sources: jsonb("sources").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Archaeological Sites - Point locations with temporal and cultural data
export const archaeologicalSites = pgTable("archaeological_sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  coordinates: jsonb("coordinates").notNull().$type<{ lat: number; lng: number }>(),
  siteType: text("site_type").notNull().default("unknown"), // settlement, burial, temple, fortification, workshop, ceremonial
  timePeriodStart: integer("time_period_start").notNull(),
  timePeriodEnd: integer("time_period_end"),
  timePeriodLabel: text("time_period_label"),
  associatedLanguageIds: jsonb("associated_language_ids").$type<string[]>().default([]),
  associatedCultureIds: jsonb("associated_culture_ids").$type<string[]>().default([]),
  excavationStatus: text("excavation_status").default("unexcavated"), // unexcavated, partial, extensive, complete
  findings: jsonb("findings").$type<string[]>().default([]),
  importance: integer("importance").default(50), // 1-100, for marker sizing
  confidence: integer("confidence").default(50), // 1-100
  sources: jsonb("sources").$type<string[]>().default([]),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Civilizations - Historical civilizations with metadata
export const civilizations = pgTable("civilizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  timePeriodStart: integer("time_period_start").notNull(),
  timePeriodEnd: integer("time_period_end"),
  timePeriodLabel: text("time_period_label"),
  associatedLanguageIds: jsonb("associated_language_ids").$type<string[]>().default([]),
  writingSystems: jsonb("writing_systems").$type<string[]>().default([]),
  politicalStructure: text("political_structure"), // Empire, city-state, etc.
  capital: text("capital"),
  population: integer("population"), // Estimated at peak
  sources: jsonb("sources").$type<string[]>().default([]),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Civilization Boundaries - GeoJSON polygons for civilization territories over time
export const civilizationBoundaries = pgTable("civilization_boundaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  civilizationId: varchar("civilization_id").notNull().references(() => civilizations.id),
  geometry: jsonb("geometry").notNull(), // GeoJSON geometry (Polygon or MultiPolygon)
  timePeriodStart: integer("time_period_start").notNull(),
  timePeriodEnd: integer("time_period_end"),
  timePeriodLabel: text("time_period_label"),
  boundaryType: text("boundary_type").default("political"), // political, cultural, linguistic, military
  confidence: integer("confidence").default(50), // 1-100
  sources: jsonb("sources").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Historical Routes - LineString geometries for trade/migration routes
export const historicalRoutes = pgTable("historical_routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  geometry: jsonb("geometry").notNull(), // GeoJSON geometry (LineString)
  routeType: text("route_type").notNull().default("unknown"), // trade, migration, conquest, pilgrimage, communication
  timePeriodStart: integer("time_period_start").notNull(),
  timePeriodEnd: integer("time_period_end"),
  timePeriodLabel: text("time_period_label"),
  associatedLanguageIds: jsonb("associated_language_ids").$type<string[]>().default([]),
  linguisticImpact: text("linguistic_impact"),
  tradedGoods: jsonb("traded_goods").$type<string[]>().default([]),
  direction: text("direction").default("bidirectional"), // bidirectional, unidirectional
  sources: jsonb("sources").$type<string[]>().default([]),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Material Cultures - Culture groups (pottery styles, burial practices, etc.)
export const materialCultures = pgTable("material_cultures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  cultureType: text("culture_type").notNull().default("unknown"), // pottery, burial, architecture, tools, art, clothing, weapons
  timePeriodStart: integer("time_period_start").notNull(),
  timePeriodEnd: integer("time_period_end"),
  timePeriodLabel: text("time_period_label"),
  associatedLanguageIds: jsonb("associated_language_ids").$type<string[]>().default([]),
  sources: jsonb("sources").$type<string[]>().default([]),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Material Culture Distributions - Points/polygons showing culture distribution
export const materialCultureDistributions = pgTable("material_culture_distributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cultureId: varchar("culture_id").notNull().references(() => materialCultures.id),
  geometry: jsonb("geometry").notNull(), // GeoJSON geometry (Point, Polygon, or MultiPolygon)
  intensity: decimal("intensity", { precision: 3, scale: 2 }).default("1.0"), // 0-1, for heatmap
  timePeriodStart: integer("time_period_start").notNull(),
  timePeriodEnd: integer("time_period_end"),
  timePeriodLabel: text("time_period_label"),
  artifactCount: integer("artifact_count"), // Number of artifacts found
  confidence: integer("confidence").default(50), // 1-100
  sources: jsonb("sources").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for etymology and migration tracking
export const insertEtymologySchema = createInsertSchema(etymologies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWordMigrationSchema = createInsertSchema(wordMigrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEtymologicalNetworkSchema = createInsertSchema(etymologicalNetworks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Legacy insert schemas for backward compatibility
export const insertLanguageFamilySchema = createInsertSchema(languageFamilies).omit({
  id: true,
  createdAt: true,
});

export const insertLanguageSchema = createInsertSchema(languages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBaseWordSchema = createInsertSchema(baseWords).omit({
  id: true,
  createdAt: true,
});

export const insertWordTranslationSchema = createInsertSchema(wordTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScrapingJobSchema = createInsertSchema(scrapingJobs).omit({
  id: true,
  createdAt: true,
});

export const insertLanguageEvolutionSchema = createInsertSchema(languageEvolution).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserContributionSchema = createInsertSchema(userContributions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTranslationContextSchema = createInsertSchema(translationContexts).omit({
  id: true,
  generatedAt: true,
  updatedAt: true,
});

export const insertSearchFilterSchema = createInsertSchema(searchFilters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Geospatial insert schemas
export const insertLanguageRangeSchema = createInsertSchema(languageRanges).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertArchaeologicalSiteSchema = createInsertSchema(archaeologicalSites).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCivilizationSchema = createInsertSchema(civilizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCivilizationBoundarySchema = createInsertSchema(civilizationBoundaries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertHistoricalRouteSchema = createInsertSchema(historicalRoutes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaterialCultureSchema = createInsertSchema(materialCultures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaterialCultureDistributionSchema = createInsertSchema(materialCultureDistributions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Etymology and migration types
export type Etymology = typeof etymologies.$inferSelect;
export type InsertEtymology = z.infer<typeof insertEtymologySchema>;
export type WordMigration = typeof wordMigrations.$inferSelect;
export type InsertWordMigration = z.infer<typeof insertWordMigrationSchema>;
export type EtymologicalNetwork = typeof etymologicalNetworks.$inferSelect;
export type InsertEtymologicalNetwork = z.infer<typeof insertEtymologicalNetworkSchema>;

// Legacy types for backward compatibility
export type LanguageFamily = typeof languageFamilies.$inferSelect;
export type InsertLanguageFamily = z.infer<typeof insertLanguageFamilySchema>;
export type Language = typeof languages.$inferSelect;
export type InsertLanguage = z.infer<typeof insertLanguageSchema>;
export type BaseWord = typeof baseWords.$inferSelect;
export type InsertBaseWord = z.infer<typeof insertBaseWordSchema>;
export type WordTranslation = typeof wordTranslations.$inferSelect;
export type InsertWordTranslation = z.infer<typeof insertWordTranslationSchema>;
export type ScrapingJob = typeof scrapingJobs.$inferSelect;
export type InsertScrapingJob = z.infer<typeof insertScrapingJobSchema>;

// Feature types
export type LanguageEvolution = typeof languageEvolution.$inferSelect;
export type InsertLanguageEvolution = z.infer<typeof insertLanguageEvolutionSchema>;
export type UserContribution = typeof userContributions.$inferSelect;
export type InsertUserContribution = z.infer<typeof insertUserContributionSchema>;
export type TranslationContext = typeof translationContexts.$inferSelect;
export type InsertTranslationContext = z.infer<typeof insertTranslationContextSchema>;
export type SearchFilter = typeof searchFilters.$inferSelect;
export type InsertSearchFilter = z.infer<typeof insertSearchFilterSchema>;

// Geospatial types
export type LanguageRange = typeof languageRanges.$inferSelect;
export type InsertLanguageRange = z.infer<typeof insertLanguageRangeSchema>;
export type ArchaeologicalSite = typeof archaeologicalSites.$inferSelect;
export type InsertArchaeologicalSite = z.infer<typeof insertArchaeologicalSiteSchema>;
export type Civilization = typeof civilizations.$inferSelect;
export type InsertCivilization = z.infer<typeof insertCivilizationSchema>;
export type CivilizationBoundary = typeof civilizationBoundaries.$inferSelect;
export type InsertCivilizationBoundary = z.infer<typeof insertCivilizationBoundarySchema>;
export type HistoricalRoute = typeof historicalRoutes.$inferSelect;
export type InsertHistoricalRoute = z.infer<typeof insertHistoricalRouteSchema>;
export type MaterialCulture = typeof materialCultures.$inferSelect;
export type InsertMaterialCulture = z.infer<typeof insertMaterialCultureSchema>;
export type MaterialCultureDistribution = typeof materialCultureDistributions.$inferSelect;
export type InsertMaterialCultureDistribution = z.infer<typeof insertMaterialCultureDistributionSchema>;

// Extended types for frontend
export type LanguageFamilyWithChildren = LanguageFamily & {
  children: LanguageFamilyWithChildren[];
  languages: LanguageWithVariants[];
};

export type LanguageWithVariants = Language & {
  historicalVariants: Language[];
  dialects: Language[];
};

export type LanguageWithStats = Language & {
  completionPercentage: number;
  lastScrapedAt?: string;
  scrapingStatus?: 'pending' | 'running' | 'completed' | 'failed';
  historicalVariants: Language[];
  dialects: Language[];
};

export type LanguageGenealogyNode = {
  id: string;
  name: string;
  taxonomicLevel?: string | null;
  status?: string | null;
  region?: string | null;
  totalSpeakers?: number | null;
  isLanguage: boolean;
  children: LanguageGenealogyNode[];
};

export type WordComparison = {
  baseWord: string;
  position: number;
  category: string;
  translations: { [languageId: string]: string };
};
