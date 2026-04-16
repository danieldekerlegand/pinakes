import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "./job-store";
import type { Language } from "@shared/types";

interface GrammarFeatureRow {
  id: string;
  language_id: string;
  word_order: string;
  morphological_type: string;
  case_system: string;
  gender_system: string;
  number_system: string;
  tense_aspect_mood: string;
  agreement_system: string;
  negation_strategy: string;
  question_formation: string;
  relative_clause_strategy: string;
  noun_class_count: string;
  verb_valency_changes: string;
  evidentiality: string;
  ergativity: string;
}

const TSV_HEADERS = [
  "id",
  "language_id",
  "word_order",
  "morphological_type",
  "case_system",
  "gender_system",
  "number_system",
  "tense_aspect_mood",
  "agreement_system",
  "negation_strategy",
  "question_formation",
  "relative_clause_strategy",
  "noun_class_count",
  "verb_valency_changes",
  "evidentiality",
  "ergativity",
] as const;

class GrammarEnrichmentService {
  private static isScraping = false;
  private readonly filePath = "lexicons/grammar-features.tsv";

  private updateJobStatus(
    jobId: string | undefined,
    updates: {
      status?: string;
      completedWords?: number;
      totalWords?: number;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
    }
  ): void {
    if (!jobId) return;

    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  /**
   * Read existing grammar-features.tsv and return the set of already-enriched language IDs
   */
  private readExistingLanguageIds(): Set<string> {
    const ids = new Set<string>();

    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      const lines = content.trim().split("\n");
      if (lines.length < 2) return ids;

      const header = lines[0].split("\t");
      const langIdIdx = header.indexOf("language_id");
      if (langIdIdx < 0) return ids;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols[langIdIdx]) {
          ids.add(cols[langIdIdx]);
        }
      }
    } catch {
      // File doesn't exist yet — no existing data
    }

    return ids;
  }

  /**
   * Read existing TSV rows (including header) as raw text lines
   */
  private readExistingRows(): { headerLine: string; dataLines: string[] } {
    const headerLine = TSV_HEADERS.join("\t");

    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      const lines = content.trim().split("\n");
      if (lines.length < 1) return { headerLine, dataLines: [] };

      return {
        headerLine: lines[0],
        dataLines: lines.slice(1).filter((l) => l.trim().length > 0),
      };
    } catch {
      return { headerLine, dataLines: [] };
    }
  }

  /**
   * Atomically write the full TSV file (temp + rename)
   */
  private async writeAtomically(
    headerLine: string,
    dataLines: string[]
  ): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${this.filePath}.tmp`;
    const tsvContent = [headerLine, ...dataLines].join("\n") + "\n";

    await fs.promises.writeFile(tempFile, tsvContent, "utf8");
    await fs.promises.rename(tempFile, this.filePath);
  }

  /**
   * Convert a Gemini result row into a TSV line
   */
  private toTsvLine(row: GrammarFeatureRow): string {
    return TSV_HEADERS.map((h) => row[h] ?? "").join("\t");
  }

  /**
   * Enrich grammar features for languages that don't have them yet
   */
  async enrichGrammar(options: {
    languages: Language[];
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  }): Promise<{ enriched: number; failed: number }> {
    const { languages, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for grammar enrichment"
      );
    }

    if (GrammarEnrichmentService.isScraping) {
      throw new Error("Grammar enrichment is already in progress");
    }

    GrammarEnrichmentService.isScraping = true;

    let enriched = 0;
    let failed = 0;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      // 1. Read existing language IDs
      const existingIds = this.readExistingLanguageIds();

      if (progressCallback) {
        progressCallback(
          "progress",
          `Found ${existingIds.size} languages already enriched`
        );
      }

      // 2. Filter to only languages without grammar features
      const toEnrich = languages.filter((l) => !existingIds.has(l.id));

      if (toEnrich.length === 0) {
        if (progressCallback) {
          progressCallback(
            "completed",
            "All languages already have grammar features"
          );
        }
        this.updateJobStatus(jobId, {
          status: "completed",
          completedAt: new Date().toISOString(),
          totalWords: 0,
          completedWords: 0,
        });
        return { enriched: 0, failed: 0 };
      }

      console.log(
        `Grammar enrichment: ${toEnrich.length} languages to process (${existingIds.size} already done)`
      );

      this.updateJobStatus(jobId, {
        totalWords: toEnrich.length,
      });

      // 3. Process in batches of 10
      const batchSize = 10;
      const allNewRows: string[] = [];

      for (let i = 0; i < toEnrich.length; i += batchSize) {
        const batch = toEnrich.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(toEnrich.length / batchSize);

        if (progressCallback) {
          progressCallback(
            "progress",
            `Processing batch ${batchNum}/${totalBatches} (${batch.map((l) => l.name).join(", ")})...`
          );
        }

        try {
          const results = await this.callGeminiForBatch(batch);

          for (const row of results) {
            allNewRows.push(this.toTsvLine(row));
            enriched++;
          }

          this.updateJobStatus(jobId, {
            completedWords: Math.min(i + batch.length, toEnrich.length),
          });
        } catch (error) {
          console.error(
            `Failed to enrich batch ${batchNum}: ${error}`
          );
          failed += batch.length;

          if (progressCallback) {
            progressCallback(
              "error",
              `Batch ${batchNum} failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        // 6. Delay between batches (except for the last one)
        if (i + batchSize < toEnrich.length) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // 5. Atomic write: read existing, append new, write full file
      if (allNewRows.length > 0) {
        const { headerLine, dataLines } = this.readExistingRows();
        const combined = [...dataLines, ...allNewRows];
        await this.writeAtomically(headerLine, combined);

        console.log(
          `Grammar enrichment: wrote ${allNewRows.length} new rows (${combined.length} total)`
        );
      }

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: toEnrich.length,
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback(
          "completed",
          `Grammar enrichment complete: ${enriched} enriched, ${failed} failed`
        );
      }

      return { enriched, failed };
    } catch (error) {
      console.error("Grammar enrichment error:", error);

      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("error", `Grammar enrichment failed: ${error}`);
      }

      throw error;
    } finally {
      GrammarEnrichmentService.isScraping = false;
    }
  }

  /**
   * Call Gemini to get grammar features for a batch of languages
   */
  private async callGeminiForBatch(
    batch: Language[]
  ): Promise<GrammarFeatureRow[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const languageList = batch
      .map((l) => `- ${l.name} (id: ${l.id})`)
      .join("\n");

    const prompt = `You are a professional typological linguist. For each of the following languages, provide their grammatical features.

Languages:
${languageList}

For each language, provide:
- word_order: dominant word order (SVO, SOV, VSO, VOS, OVS, OSV, or free)
- morphological_type: isolating, agglutinative, fusional, or polysynthetic
- case_system: array of grammatical cases used (e.g. ["nominative","accusative","dative","genitive"]). Use empty array [] if the language has no case system.
- gender_system: array of grammatical genders (e.g. ["masculine","feminine","neuter"]). Use empty array [] if the language has no gender system.
- number_system: array of grammatical number distinctions (e.g. ["singular","plural","dual"])
- tense_aspect_mood: array of tense/aspect/mood categories (e.g. ["past","present","future","conditional","subjunctive"])
- agreement_system: brief description of verb/noun agreement patterns
- negation_strategy: how negation works (e.g. "preverbal particle", "suffix", "auxiliary")
- question_formation: how questions are formed (e.g. "inversion", "particle", "intonation")
- relative_clause_strategy: how relative clauses are formed (e.g. "relative pronoun", "gap", "resumptive", "participial")
- noun_class_count: number of noun classes (0 if none)
- verb_valency_changes: array of valency-changing operations (e.g. ["passive","causative","applicative"])
- evidentiality: evidentiality system (e.g. "none", "two-term", "multi-term")
- ergativity: alignment type (e.g. "nominative-accusative", "ergative-absolutive", "split")

Be as accurate as possible based on known typological data. Use the language id exactly as given.`;

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            languages: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  language_id: { type: SchemaType.STRING },
                  word_order: { type: SchemaType.STRING },
                  morphological_type: { type: SchemaType.STRING },
                  case_system: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  gender_system: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  number_system: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  tense_aspect_mood: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  agreement_system: { type: SchemaType.STRING },
                  negation_strategy: { type: SchemaType.STRING },
                  question_formation: { type: SchemaType.STRING },
                  relative_clause_strategy: { type: SchemaType.STRING },
                  noun_class_count: { type: SchemaType.INTEGER },
                  verb_valency_changes: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  evidentiality: { type: SchemaType.STRING },
                  ergativity: { type: SchemaType.STRING },
                },
                required: [
                  "language_id",
                  "word_order",
                  "morphological_type",
                  "case_system",
                  "gender_system",
                  "number_system",
                  "tense_aspect_mood",
                  "agreement_system",
                  "negation_strategy",
                  "question_formation",
                  "relative_clause_strategy",
                  "noun_class_count",
                  "verb_valency_changes",
                  "evidentiality",
                  "ergativity",
                ],
              },
            },
          },
          required: ["languages"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.languages)) {
      throw new Error("Invalid response structure from Gemini");
    }

    // Convert to TSV row format
    return parsed.languages.map((lang: any) => ({
      id: `gram_${lang.language_id}`,
      language_id: lang.language_id,
      word_order: lang.word_order || "",
      morphological_type: lang.morphological_type || "",
      case_system: JSON.stringify(lang.case_system || []),
      gender_system: JSON.stringify(lang.gender_system || []),
      number_system: JSON.stringify(lang.number_system || []),
      tense_aspect_mood: JSON.stringify(lang.tense_aspect_mood || []),
      agreement_system: lang.agreement_system || "",
      negation_strategy: lang.negation_strategy || "",
      question_formation: lang.question_formation || "",
      relative_clause_strategy: lang.relative_clause_strategy || "",
      noun_class_count: String(lang.noun_class_count ?? 0),
      verb_valency_changes: JSON.stringify(lang.verb_valency_changes || []),
      evidentiality: lang.evidentiality || "",
      ergativity: lang.ergativity || "",
    }));
  }
}

export const grammarEnrichmentService = new GrammarEnrichmentService();
