import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const languageFamilies = pgTable("language_families", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  parentId: varchar("parent_id").references(() => languageFamilies.id),
  description: text("description"),
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
  familyId: varchar("family_id").references(() => languageFamilies.id).notNull(),
  parentLanguageId: varchar("parent_language_id").references(() => languages.id), // For historical variants
  region: text("region"),
  countries: jsonb("countries").$type<string[]>().default([]),
  nativeSpeakers: integer("native_speakers").default(0),
  totalSpeakers: integer("total_speakers").default(0),
  status: text("status").notNull(), // living, endangered, moribund, dead
  timeOrigin: text("time_origin"),
  timeEnd: text("time_end"), // For historical variants that are no longer spoken
  classification: text("classification"),
  writingSystem: text("writing_system"),
  isHistoricalVariant: boolean("is_historical_variant").default(false),
  chronologicalOrder: integer("chronological_order").default(0), // For ordering variants
  historicalContext: text("historical_context"), // Description of historical period
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

// Extended types for frontend
export type LanguageFamilyWithChildren = LanguageFamily & {
  children: LanguageFamilyWithChildren[];
  languages: LanguageWithVariants[];
};

export type LanguageWithVariants = Language & {
  historicalVariants: Language[];
};

export type LanguageWithStats = Language & {
  wordListCompletion: number;
  lastScrapedAt?: string;
  scrapingStatus?: 'pending' | 'running' | 'completed' | 'failed';
  historicalVariants: Language[];
};

export type WordComparison = {
  baseWord: BaseWord;
  translations: Array<{
    language: Language;
    translation: WordTranslation | null;
  }>;
};
