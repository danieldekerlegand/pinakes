import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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

export const languages = pgTable("languages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  nativeName: text("native_name"),
  iso639_1: varchar("iso639_1", { length: 2 }),
  iso639_2: varchar("iso639_2", { length: 3 }),
  familyId: varchar("family_id").references((): any => languageFamilies.id).notNull(),
  parentLanguageId: varchar("parent_language_id").references((): any => languages.id), // For historical variants and dialects
  region: text("region"),
  countries: jsonb("countries").$type<string[]>().default([]),
  nativeSpeakers: integer("native_speakers").default(0),
  totalSpeakers: integer("total_speakers").default(0),
  status: text("status").notNull(), // living, endangered, moribund, dead, historical, dialect
  timeOrigin: text("time_origin"),
  timeEnd: text("time_end"), // For historical variants that are no longer spoken
  classification: text("classification"),
  writingSystem: text("writing_system"),
  isHistoricalVariant: boolean("is_historical_variant").default(false),
  isDialect: boolean("is_dialect").default(false), // For modern dialects and varieties
  chronologicalOrder: integer("chronological_order").default(0), // For ordering variants
  historicalContext: text("historical_context"), // Description of historical period or dialect context
  coordinates: jsonb("coordinates").$type<{lat: number, lng: number}>(), // Geographic coordinates for mapping
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

// Insert schemas
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

// Types
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

// New feature types
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
