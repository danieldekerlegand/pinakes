import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Normalized taxonomic structure for linguistic classification

// Top-level phylums (e.g., Indo-European, Sino-Tibetan)
export const phylums = pgTable("phylums", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  region: text("region"),
  coordinates: jsonb("coordinates").$type<{ lat: number; lng: number }>(),
  speakerCount: integer("speaker_count").default(0),
  languageCount: integer("language_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Language families within phylums (e.g., Germanic, Romance)
export const families = pgTable("families", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phylumId: varchar("phylum_id").notNull().references(() => phylums.id),
  description: text("description"),
  region: text("region"),
  coordinates: jsonb("coordinates").$type<{ lat: number; lng: number }>(),
  speakerCount: integer("speaker_count").default(0),
  languageCount: integer("language_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Subfamilies within families (e.g., West Germanic, North Germanic)
export const subfamilies = pgTable("subfamilies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  familyId: varchar("family_id").notNull().references(() => families.id),
  description: text("description"),
  region: text("region"),
  coordinates: jsonb("coordinates").$type<{ lat: number; lng: number }>(),
  speakerCount: integer("speaker_count").default(0),
  languageCount: integer("language_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Branches within subfamilies (e.g., Anglo-Frisian, High German)
export const branches = pgTable("branches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  subfamilyId: varchar("subfamily_id").notNull().references(() => subfamilies.id),
  description: text("description"),
  region: text("region"),
  coordinates: jsonb("coordinates").$type<{ lat: number; lng: number }>(),
  speakerCount: integer("speaker_count").default(0),
  languageCount: integer("language_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Groups within branches (e.g., Anglo-Saxon, Franconian)
export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  branchId: varchar("branch_id").notNull().references(() => branches.id),
  description: text("description"),
  region: text("region"),
  coordinates: jsonb("coordinates").$type<{ lat: number; lng: number }>(),
  speakerCount: integer("speaker_count").default(0),
  languageCount: integer("language_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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

// Main languages - core linguistic units
export const mainLanguages = pgTable("main_languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  iso639_1: varchar("iso639_1", { length: 2 }),
  iso639_2: varchar("iso639_2", { length: 3 }),
  // Hierarchical references (nullable for flexibility)
  phylumId: varchar("phylum_id").references(() => phylums.id),
  familyId: varchar("family_id").references(() => families.id),
  subfamilyId: varchar("subfamily_id").references(() => subfamilies.id),
  branchId: varchar("branch_id").references(() => branches.id),
  groupId: varchar("group_id").references(() => groups.id),
  region: text("region"),
  countries: jsonb("countries").$type<string[]>().default([]),
  nativeSpeakers: integer("native_speakers").default(0),
  totalSpeakers: integer("total_speakers").default(0),
  status: text("status").notNull(), // living, endangered, moribund, dead
  timeOrigin: text("time_origin"),
  classification: text("classification"),
  writingSystem: text("writing_system"),
  coordinates: jsonb("coordinates").$type<{lat: number, lng: number}>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Historical variants of main languages (e.g., Old English, Middle English)
export const historicalVariants = pgTable("historical_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  mainLanguageId: varchar("main_language_id").notNull().references(() => mainLanguages.id),
  parentVariantId: varchar("parent_variant_id").references((): any => historicalVariants.id), // For evolution chains
  timeStart: text("time_start"), // e.g., "450 CE"
  timeEnd: text("time_end"), // e.g., "1150 CE"
  chronologicalOrder: integer("chronological_order").default(0),
  region: text("region"),
  historicalContext: text("historical_context"),
  linguisticChanges: jsonb("linguistic_changes").$type<string[]>().default([]),
  coordinates: jsonb("coordinates").$type<{lat: number, lng: number}>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Modern dialects and varieties of main languages
export const modernDialects = pgTable("modern_dialects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  mainLanguageId: varchar("main_language_id").notNull().references(() => mainLanguages.id),
  parentDialectId: varchar("parent_dialect_id").references((): any => modernDialects.id), // For nested dialects
  region: text("region"),
  countries: jsonb("countries").$type<string[]>().default([]),
  speakers: integer("speakers").default(0),
  dialectType: text("dialect_type"), // regional, social, creole, pidgin
  distinctiveFeatures: jsonb("distinctive_features").$type<string[]>().default([]),
  coordinates: jsonb("coordinates").$type<{lat: number, lng: number}>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Keep the original languages table for backward compatibility during migration
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
  definition: text("definition"),
  createdAt: timestamp("created_at").defaultNow(),
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

// Insert schemas for normalized taxonomic structure
export const insertPhylumSchema = createInsertSchema(phylums).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFamilySchema = createInsertSchema(families).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSubfamilySchema = createInsertSchema(subfamilies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBranchSchema = createInsertSchema(branches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGroupSchema = createInsertSchema(groups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMainLanguageSchema = createInsertSchema(mainLanguages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertHistoricalVariantSchema = createInsertSchema(historicalVariants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertModernDialectSchema = createInsertSchema(modernDialects).omit({
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

// Normalized taxonomic types
export type Phylum = typeof phylums.$inferSelect;
export type InsertPhylum = z.infer<typeof insertPhylumSchema>;
export type Family = typeof families.$inferSelect;
export type InsertFamily = z.infer<typeof insertFamilySchema>;
export type Subfamily = typeof subfamilies.$inferSelect;
export type InsertSubfamily = z.infer<typeof insertSubfamilySchema>;
export type Branch = typeof branches.$inferSelect;
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type MainLanguage = typeof mainLanguages.$inferSelect;
export type InsertMainLanguage = z.infer<typeof insertMainLanguageSchema>;
export type HistoricalVariant = typeof historicalVariants.$inferSelect;
export type InsertHistoricalVariant = z.infer<typeof insertHistoricalVariantSchema>;
export type ModernDialect = typeof modernDialects.$inferSelect;
export type InsertModernDialect = z.infer<typeof insertModernDialectSchema>;

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

export type WordComparison = {
  baseWord: string;
  position: number;
  category: string;
  translations: { [languageId: string]: string };
};
