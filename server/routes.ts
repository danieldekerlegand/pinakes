import path from "node:path";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { languageFamilyScraperTSV } from "./services/language-family-scraper-tsv";
import { wordListScraper } from "./services/word-list-scraper";
import { jobStore } from "./services/job-store";
import {
  calculatePairwiseDistance,
  calculateDistanceMatrix,
  findNearestLanguages,
  calculateGenealogyDistance,
  calculateGeographicDistance,
  getAvailableLanguageIds,
} from "./services/linguistic-distance-calculator";
import { traceEtymology, traceDescendants } from "./services/etymology-trace";
import { analyzeTextOrigins } from "./services/text-etymology-analyzer";
import {
  computeEnhancedDistance,
  computePhonologicalDistance,
  computeGrammaticalDistance,
  findNearestByDimension,
  type ComparisonMode,
  type EnhancedPairwiseResult,
} from "./services/linguistic-distance-enhanced";
import { globalSearch } from "./services/global-search";
import { bulkImport, getImportTargets } from "./services/bulk-import";
import { generateQuiz, scoreMapClick, type QuizCategory, type Difficulty } from "./services/quiz-generator";
import {
  parseNaturalLanguageQuery,
  spatialSearch,
  whatWasHere,
  getQuerySuggestions,
} from "./services/natural-language-search";
import { DataValidationService } from "./services/data-validation";

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);
  
  
  // Language Families
  app.get("/api/language-families", async (req, res) => {
    try {
      const families = await storage.getLanguageFamilies();
      res.json(families);
    } catch (error) {
      console.error("Error in /api/language-families endpoint:", error);
      res.status(500).json({ message: "Failed to fetch language families" });
    }
  });

  app.get("/api/language-families/tree", async (req, res) => {
    try {
      const tree = await storage.getLanguageFamilyTree();
      res.json(tree);
    } catch (error) {
      console.error("Error in /api/language-families/tree endpoint:", error);
      res.status(500).json({ message: "Failed to fetch language family tree" });
    }
  });

  // (Read-only TSV mode) /api/languages/tree removed

  // Languages
  app.get("/api/languages", async (req, res) => {
    try {
      const { family, status, region, search } = req.query;
      let languages = await storage.getLanguages();

      if (family) {
        languages = languages.filter(lang => lang.familyId === family);
      }
      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        languages = languages.filter(lang => statuses.includes(lang.status));
      }
      if (region) {
        languages = languages.filter(lang => 
          lang.region?.toLowerCase().includes((region as string).toLowerCase())
        );
      }
      if (search) {
        const searchTerm = (search as string).toLowerCase();
        languages = languages.filter(lang => 
          lang.name.toLowerCase().includes(searchTerm) ||
          lang.nativeName?.toLowerCase().includes(searchTerm)
        );
      }

      res.json(languages);
    } catch (error) {
      console.error("Error in /api/languages endpoint:", error);
      res.status(500).json({ message: "Failed to fetch languages" });
    }
  });

  app.get("/api/languages/:id", async (req, res) => {
    try {
      const language = await storage.getLanguage(req.params.id);
      if (!language) {
        return res.status(404).json({ message: "Language not found" });
      }
      res.json(language);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch language" });
    }
  });

  // (Read-only TSV mode) language creation/deletion removed

  // Base Words
  app.get("/api/base-words", async (_req, res) => {
    try {
      const words = await storage.getBaseWords();
      res.json(words);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch base words" });
    }
  });

  // Stats
  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getLanguageStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Word Comparisons
  app.get("/api/word-comparisons", async (req, res) => {
    try {
      const { languages } = req.query;

      if (!languages) {
        return res.status(400).json({ message: "Languages parameter is required" });
      }

      const languageIds = Array.isArray(languages) ? languages as string[] : [languages as string];

      if (languageIds.length < 2) {
        return res.status(400).json({ message: "At least 2 languages are required for comparison" });
      }

      const comparisons = await storage.getWordComparisons(languageIds);
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      if (limit !== undefined) {
        const paginatedItems = comparisons.slice(offset, offset + limit);
        res.json({ items: paginatedItems, total: comparisons.length, limit, offset });
      } else {
        res.json(comparisons);
      }
    } catch (error) {
      console.error("Error in /api/word-comparisons endpoint:", error);
      res.status(500).json({ message: "Failed to fetch word comparisons" });
    }
  });

  // Language Word List (with optional pagination)
  app.get("/api/languages/:id/word-list", async (req, res) => {
    try {
      const wordList = await storage.getLanguageWordList(req.params.id);
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      if (limit !== undefined) {
        const paginatedItems = wordList.slice(offset, offset + limit);
        res.json({ items: paginatedItems, total: wordList.length, limit, offset });
      } else {
        res.json(wordList);
      }
    } catch (error) {
      console.error("Error in /api/languages/:id/word-list endpoint:", error);
      res.status(500).json({ message: "Failed to fetch language word list" });
    }
  });

  // Scraping Endpoints

  // Scrape language families with Gemini AI
  app.post("/api/scraping/families", async (req, res) => {
    try {
      const { clearExisting, familyFilter } = req.body;

      // Get existing families to avoid re-scraping
      const existingFamilies = await storage.getLanguageFamilies();

      // Create in-memory job for tracking
      const job = jobStore.createJob(
        "language-families",
        100, // Estimated total families
        "gemini"
      );

      // Start scraping in the background (don't wait for completion)
      languageFamilyScraperTSV
        .scrapeLanguageFamilies({
          clearExisting: clearExisting || false,
          familyFilter: familyFilter || undefined,
          existingFamilies,
          jobId: job.id,
          progressCallback: (type, message, data) => {
            console.log(`[Family Scraping] ${type}: ${message}`, data || "");

            // Update job with current status message for UI display
            if (type === 'progress') {
              jobStore.updateJob(job.id, {
                statusMessage: message,
              });
            } else if (type === 'error') {
              jobStore.updateJob(job.id, {
                errorMessage: message,
              });
            }
          },
        })
        .then((result) => {
          console.log(
            `Family scraping completed: ${result.families.length} families, ${result.languages.length} languages`
          );
        })
        .catch((error) => {
          console.error("Family scraping failed:", error);

          // Update job status to failed
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Language family scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting family scraping:", error);
      res.status(500).json({
        message: "Failed to start scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape word list for a language
  app.post("/api/scraping/words", async (req, res) => {
    try {
      const { languageId, languageName, dataSources } = req.body;

      if (!languageId || !languageName) {
        return res.status(400).json({
          message: "languageId and languageName are required",
        });
      }

      // Get base words for scraping
      const baseWords = await storage.getBaseWords();

      if (baseWords.length === 0) {
        return res.status(400).json({
          message: "No base words available for scraping",
        });
      }

      // Create in-memory job for tracking
      const job = jobStore.createJob(
        languageId,
        baseWords.length,
        dataSources?.[0] || "gemini"
      );

      // Start scraping in the background
      wordListScraper
        .scrapeWordList({
          languageId,
          languageName,
          baseWords,
          dataSources: dataSources || ["gemini"],
          resumable: true,
          jobId: job.id,
          progressCallback: (progress) => {
            console.log(
              `[Word Scraping ${languageId}] ${progress.type}: ${progress.message}`
            );

            // Update job with current status message for UI display
            if (progress.type === 'progress') {
              jobStore.updateJob(job.id, {
                statusMessage: progress.message,
              });
            } else if (progress.type === 'error') {
              jobStore.updateJob(job.id, {
                errorMessage: progress.message,
              });
            }
          },
        })
        .then((result) => {
          console.log(
            `Word scraping completed for ${languageId}: ${result.scrapedWords}/${result.totalWords} words`
          );
        })
        .catch((error) => {
          console.error(`Word scraping failed for ${languageId}:`, error);

          // Update job status to failed
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: `Word scraping started for ${languageName}`,
        status: "pending",
        languageId,
        totalWords: baseWords.length,
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting word scraping:", error);
      res.status(500).json({
        message: "Failed to start word scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get scraping status (placeholder for now)
  app.get("/api/scraping/status", async (_req, res) => {
    try {
      // For now, just return a basic status
      // In the future, this could track active scraping jobs
      res.json({
        familyScraping: false,
        wordScraping: [],
      });
    } catch (error) {
      console.error("Error getting scraping status:", error);
      res.status(500).json({ message: "Failed to get scraping status" });
    }
  });

  // Scraping Jobs Management (in-memory tracking)

  // Get all scraping jobs
  app.get("/api/scraping-jobs", async (_req, res) => {
    try {
      const jobs = jobStore.getAllJobs();

      // Clean up old jobs periodically
      jobStore.cleanup();

      res.json(jobs);
    } catch (error) {
      console.error("Error fetching scraping jobs:", error);
      res.status(500).json({ message: "Failed to fetch scraping jobs" });
    }
  });

  // Get a specific scraping job
  app.get("/api/scraping-jobs/:id", async (req, res) => {
    try {
      const job = jobStore.getJob(req.params.id);

      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      res.json(job);
    } catch (error) {
      console.error("Error fetching scraping job:", error);
      res.status(500).json({ message: "Failed to fetch scraping job" });
    }
  });

  // Create a new scraping job (for compatibility)
  app.post("/api/scraping-jobs", async (req, res) => {
    try {
      const { languageId, totalWords, dataSource } = req.body;

      if (!languageId) {
        return res.status(400).json({ message: "languageId is required" });
      }

      const job = jobStore.createJob(languageId, totalWords || 0, dataSource);

      res.json(job);
    } catch (error) {
      console.error("Error creating scraping job:", error);
      res.status(500).json({ message: "Failed to create scraping job" });
    }
  });

  // Update a scraping job (for compatibility)
  app.patch("/api/scraping-jobs/:id", async (req, res) => {
    try {
      const updates = req.body;

      const updatedJob = jobStore.updateJob(req.params.id, updates);

      if (!updatedJob) {
        return res.status(404).json({ message: "Job not found" });
      }

      res.json(updatedJob);
    } catch (error) {
      console.error("Error updating scraping job:", error);
      res.status(500).json({ message: "Failed to update scraping job" });
    }
  });

  // Linguistic Distance Analysis Endpoints

  // Calculate pairwise distance between two languages
  app.post("/api/linguistic-distance/pairwise", async (req, res) => {
    try {
      const { language1Id, language2Id } = req.body;

      if (!language1Id || !language2Id) {
        return res.status(400).json({
          message: "Both language1Id and language2Id are required"
        });
      }

      const languages = await storage.getLanguages();
      const lang1 = languages.find(l => l.id === language1Id);
      const lang2 = languages.find(l => l.id === language2Id);

      if (!lang1 || !lang2) {
        return res.status(404).json({ message: "One or both languages not found" });
      }

      const result = await calculatePairwiseDistance(lang1, lang2);

      // Add genealogical and geographic distances
      const genealogicalDistance = calculateGenealogyDistance(lang1, lang2, languages);
      const geographicDistance = calculateGeographicDistance(lang1, lang2);

      res.json({
        ...result,
        genealogical: {
          distance: genealogicalDistance,
          sameFamily: lang1.familyId === lang2.familyId,
        },
        geographic: {
          distanceKm: geographicDistance,
          hasData: geographicDistance !== null,
        },
      });
    } catch (error) {
      console.error("Error calculating pairwise distance:", error);
      res.status(500).json({
        message: "Failed to calculate linguistic distance",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Calculate distance matrix for multiple languages
  app.post("/api/linguistic-distance/matrix", async (req, res) => {
    try {
      const { languageIds, metric, phoneticMode } = req.body;

      if (!languageIds || !Array.isArray(languageIds)) {
        return res.status(400).json({ message: "languageIds array is required" });
      }

      if (languageIds.length < 2) {
        return res.status(400).json({ message: "At least 2 languages are required" });
      }

      if (languageIds.length > 50) {
        return res.status(400).json({
          message: "Maximum 50 languages allowed for matrix calculation"
        });
      }

      const allLanguages = await storage.getLanguages();
      const languages = languageIds
        .map(id => allLanguages.find(l => l.id === id))
        .filter((l): l is NonNullable<typeof l> => l !== undefined);

      if (languages.length !== languageIds.length) {
        return res.status(404).json({ message: "One or more languages not found" });
      }

      // Validate phonetic mode
      const validPhoneticModes = ['asjp', 'ipa', 'ipa-weighted', 'wordform'];
      const selectedPhoneticMode = validPhoneticModes.includes(phoneticMode) ? phoneticMode : 'ipa';

      const result = await calculateDistanceMatrix(
        languages,
        metric === 'levenshtein' ? 'levenshtein' : 'ldnd',
        selectedPhoneticMode as 'asjp' | 'ipa' | 'ipa-weighted' | 'wordform'
      );

      res.json(result);
    } catch (error) {
      console.error("Error calculating distance matrix:", error);
      res.status(500).json({
        message: "Failed to calculate distance matrix",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Find nearest languages to a target language
  app.get("/api/linguistic-distance/nearest/:languageId", async (req, res) => {
    try {
      const { languageId } = req.params;
      const k = parseInt(req.query.k as string) || 10;

      if (k < 1 || k > 100) {
        return res.status(400).json({ message: "k must be between 1 and 100" });
      }

      const languages = await storage.getLanguages();
      const targetLanguage = languages.find(l => l.id === languageId);

      if (!targetLanguage) {
        return res.status(404).json({ message: "Language not found" });
      }

      const results = await findNearestLanguages(targetLanguage, languages, k);

      res.json({
        targetLanguage,
        nearestLanguages: results,
        count: results.length,
      });
    } catch (error) {
      console.error("Error finding nearest languages:", error);
      res.status(500).json({
        message: "Failed to find nearest languages",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get languages that have word data available for distance analysis
  app.get("/api/linguistic-distance/available-languages", async (_req, res) => {
    try {
      const availableIds = getAvailableLanguageIds();
      const allLanguages = await storage.getLanguages();

      // Filter to only languages with word data
      const availableLanguages = allLanguages.filter(lang =>
        availableIds.includes(lang.id)
      );

      res.json({
        languages: availableLanguages,
        count: availableLanguages.length,
        totalLanguages: allLanguages.length,
      });
    } catch (error) {
      console.error("Error fetching available languages:", error);
      res.status(500).json({
        message: "Failed to fetch available languages",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Enhanced Linguistic Distance Endpoints (multi-dimensional)
  // ============================================================================

  // Enhanced pairwise distance with comparison modes
  app.post("/api/linguistic-distance/enhanced/pairwise", async (req, res) => {
    try {
      const { language1Id, language2Id, mode } = req.body;

      if (!language1Id || !language2Id) {
        return res.status(400).json({
          message: "Both language1Id and language2Id are required"
        });
      }

      const validModes: ComparisonMode[] = ['vocabulary', 'phonological', 'grammatical', 'combined'];
      const selectedMode: ComparisonMode = validModes.includes(mode) ? mode : 'combined';

      const languages = await storage.getLanguages();
      const lang1 = languages.find(l => l.id === language1Id);
      const lang2 = languages.find(l => l.id === language2Id);

      if (!lang1 || !lang2) {
        return res.status(404).json({ message: "One or both languages not found" });
      }

      // Get vocabulary distance if needed
      let vocabDistance: number | undefined;
      if (selectedMode === 'vocabulary' || selectedMode === 'combined') {
        try {
          const pairwise = await calculatePairwiseDistance(lang1, lang2);
          vocabDistance = pairwise.lexical.ldnd >= 0 ? pairwise.lexical.ldnd : undefined;
        } catch {
          // vocabulary data might not be available
        }
      }

      const result = await computeEnhancedDistance(language1Id, language2Id, vocabDistance);

      // Build similarity description
      const descriptions: string[] = [];
      if (result.distances.grammatical !== null) {
        const gramSim = Math.round((1 - result.distances.grammatical) * 100);
        descriptions.push(`${gramSim}% similar grammatically`);
      }
      if (result.distances.phonological !== null) {
        const phonSim = Math.round((1 - result.distances.phonological) * 100);
        descriptions.push(`${phonSim}% similar phonologically`);
      }
      if (result.distances.vocabulary !== null && result.distances.vocabulary >= 0) {
        const vocabSim = Math.round((1 - result.distances.vocabulary) * 100);
        descriptions.push(`${vocabSim}% similar in vocabulary`);
      }

      res.json({
        ...result,
        language1: lang1,
        language2: lang2,
        mode: selectedMode,
        description: descriptions.length > 0
          ? `${lang1.name} and ${lang2.name} are ${descriptions.join(' but ')}`
          : `Insufficient data to compare ${lang1.name} and ${lang2.name}`,
      });
    } catch (error) {
      console.error("Error calculating enhanced pairwise distance:", error);
      res.status(500).json({
        message: "Failed to calculate enhanced distance",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Enhanced nearest neighbors filtered by dimension
  app.get("/api/linguistic-distance/enhanced/nearest/:languageId", async (req, res) => {
    try {
      const { languageId } = req.params;
      const k = parseInt(req.query.k as string) || 10;
      const mode = (req.query.mode as ComparisonMode) || 'combined';

      const validModes: ComparisonMode[] = ['vocabulary', 'phonological', 'grammatical', 'combined'];
      if (!validModes.includes(mode)) {
        return res.status(400).json({ message: "mode must be one of: vocabulary, phonological, grammatical, combined" });
      }

      if (k < 1 || k > 100) {
        return res.status(400).json({ message: "k must be between 1 and 100" });
      }

      const languages = await storage.getLanguages();
      const targetLanguage = languages.find(l => l.id === languageId);

      if (!targetLanguage) {
        return res.status(404).json({ message: "Language not found" });
      }

      // For vocabulary mode, use existing calculator
      if (mode === 'vocabulary') {
        const results = await findNearestLanguages(targetLanguage, languages, k);
        res.json({
          targetLanguage,
          mode,
          nearestLanguages: results.map(r => ({
            language: r.language2,
            distance: r.lexical.ldnd,
          })),
          count: results.length,
        });
        return;
      }

      const results = await findNearestByDimension(languageId, mode, k);

      // Resolve language objects
      const enrichedResults = results.map(r => ({
        language: languages.find(l => l.id === r.languageId) || { id: r.languageId, name: r.languageId },
        distance: r.distance,
      }));

      res.json({
        targetLanguage,
        mode,
        nearestLanguages: enrichedResults,
        count: enrichedResults.length,
      });
    } catch (error) {
      console.error("Error finding enhanced nearest languages:", error);
      res.status(500).json({
        message: "Failed to find nearest languages",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Geospatial Map Data Endpoints
  // ============================================================================

  // Get language ranges (GeoJSON polygons for language territories)
  app.get("/api/map/language-ranges", async (req, res) => {
    try {
      const { timeStart, timeEnd, bbox, familyIds } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        bbox: bbox as string,
        familyIds: familyIds ? (Array.isArray(familyIds) ? familyIds as string[] : [familyIds as string]) : undefined,
      };

      const features = await storage.getLanguageRanges(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching language ranges:", error);
      res.status(500).json({
        message: "Failed to fetch language ranges",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get language range polygons (expanded polygon dataset)
  app.get("/api/map/language-range-polygons", async (req, res) => {
    try {
      const { timeStart, timeEnd, bbox, familyIds, rangeType } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        bbox: bbox as string,
        familyIds: familyIds ? (Array.isArray(familyIds) ? familyIds as string[] : [familyIds as string]) : undefined,
        rangeType: rangeType as string | undefined,
      };

      const features = await storage.getLanguageRangePolygons(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching language range polygons:", error);
      res.status(500).json({
        message: "Failed to fetch language range polygons",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get archaeological sites
  app.get("/api/map/archaeological-sites", async (req, res) => {
    try {
      const { timeStart, timeEnd, bbox, siteTypes } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        bbox: bbox as string,
        siteTypes: siteTypes ? (Array.isArray(siteTypes) ? siteTypes as string[] : [siteTypes as string]) : undefined,
      };

      const features = await storage.getArchaeologicalSites(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching archaeological sites:", error);
      res.status(500).json({
        message: "Failed to fetch archaeological sites",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get archaeological cultures
  app.get("/api/map/archaeological-cultures", async (req, res) => {
    try {
      const { timeStart, timeEnd, region } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        region: region as string | undefined,
      };

      const features = await storage.getArchaeologicalCultures(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching archaeological cultures:", error);
      res.status(500).json({
        message: "Failed to fetch archaeological cultures",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get civilizations with boundaries
  app.get("/api/map/civilizations", async (req, res) => {
    try {
      const { timeStart, timeEnd, bbox } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        bbox: bbox as string,
      };

      const features = await storage.getCivilizations(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching civilizations:", error);
      res.status(500).json({
        message: "Failed to fetch civilizations",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get historical routes
  app.get("/api/map/routes", async (req, res) => {
    try {
      const { timeStart, timeEnd, bbox, routeTypes } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        bbox: bbox as string,
        routeTypes: routeTypes ? (Array.isArray(routeTypes) ? routeTypes as string[] : [routeTypes as string]) : undefined,
      };

      const features = await storage.getHistoricalRoutes(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching historical routes:", error);
      res.status(500).json({
        message: "Failed to fetch historical routes",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get trade routes specifically (convenience endpoint filtering by trade type)
  app.get("/api/trade-routes", async (req, res) => {
    try {
      const { timeStart, timeEnd } = req.query;

      const features = await storage.getHistoricalRoutes({
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        routeTypes: ["trade"],
      });

      res.json({
        type: "FeatureCollection",
        features,
        count: features.length,
      });
    } catch (error) {
      console.error("Error fetching trade routes:", error);
      res.status(500).json({
        message: "Failed to fetch trade routes",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get material culture distributions
  app.get("/api/map/material-cultures", async (req, res) => {
    try {
      const { timeStart, timeEnd, bbox, cultureTypes } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        bbox: bbox as string,
        cultureTypes: cultureTypes ? (Array.isArray(cultureTypes) ? cultureTypes as string[] : [cultureTypes as string]) : undefined,
      };

      const distributions = await storage.getMaterialCultureDistributions(filters);

      res.json({
        distributions,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching material cultures:", error);
      res.status(500).json({
        message: "Failed to fetch material cultures",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get all material culture items with optional category filter
  app.get("/api/material-culture", async (req, res) => {
    try {
      const { category } = req.query;
      const filters = {
        category: category as string | undefined,
      };
      const items = await storage.getMaterialCultures(filters);
      res.json({ items, count: items.length });
    } catch (error) {
      console.error("Error fetching material culture:", error);
      res.status(500).json({
        message: "Failed to fetch material culture",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get a single material culture item by ID
  app.get("/api/material-culture/:id", async (req, res) => {
    try {
      const item = await storage.getMaterialCultureById(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Material culture item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error fetching material culture item:", error);
      res.status(500).json({
        message: "Failed to fetch material culture item",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Bulk endpoint to fetch multiple layer types at once
  app.post("/api/map/features", async (req, res) => {
    try {
      const { layers, timeStart, timeEnd, bbox } = req.body;

      if (!Array.isArray(layers) || layers.length === 0) {
        return res.status(400).json({
          message: "layers must be a non-empty array",
        });
      }

      const filters = { timeStart, timeEnd, bbox };
      const result: Record<string, any> = {};

      // Fetch data for each requested layer type
      for (const layerType of layers) {
        switch (layerType) {
          case 'language-ranges':
            result[layerType] = {
              type: "FeatureCollection",
              features: await storage.getLanguageRanges(filters),
            };
            break;
          case 'archaeological-sites':
            result[layerType] = {
              type: "FeatureCollection",
              features: await storage.getArchaeologicalSites(filters),
            };
            break;
          case 'archaeological-cultures':
            result[layerType] = {
              type: "FeatureCollection",
              features: await storage.getArchaeologicalCultures(filters),
            };
            break;
          case 'civilizations':
            result[layerType] = {
              type: "FeatureCollection",
              features: await storage.getCivilizations(filters),
            };
            break;
          case 'routes':
            result[layerType] = {
              type: "FeatureCollection",
              features: await storage.getHistoricalRoutes(filters),
            };
            break;
          case 'material-cultures':
            result[layerType] = {
              distributions: await storage.getMaterialCultureDistributions(filters),
            };
            break;
          default:
            result[layerType] = {
              type: "FeatureCollection",
              features: [],
            };
        }
      }

      res.json({
        ...result,
        metadata: {
          layers,
          timeStart,
          timeEnd,
          bbox,
        },
      });
    } catch (error) {
      console.error("Error fetching map features:", error);
      res.status(500).json({
        message: "Failed to fetch map features",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Cuisine API Routes
  // ============================================================================

  /**
   * GET /api/cuisines - Get all cuisines with optional filtering
   */
  app.get("/api/cuisines", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const region = req.query.region as string | undefined;

      const cuisines = await storage.getCuisines({ year, region });

      res.json({
        cuisines,
        count: cuisines.length,
        filters: { year, region },
      });
    } catch (error) {
      console.error("Error fetching cuisines:", error);
      res.status(500).json({
        message: "Failed to fetch cuisines",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cuisines/:id - Get a single cuisine with its items
   */
  app.get("/api/cuisines/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

      const result = await storage.getCuisineWithItems(id, year);

      if (!result) {
        res.status(404).json({ message: `Cuisine '${id}' not found` });
        return;
      }

      res.json({
        ...result,
        itemCount: result.items.length,
        filters: { year },
      });
    } catch (error) {
      console.error("Error fetching cuisine:", error);
      res.status(500).json({
        message: "Failed to fetch cuisine",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cuisine-items - Get cuisine items with optional filtering
   */
  app.get("/api/cuisine-items", async (req, res) => {
    try {
      const cuisineId = req.query.cuisineId as string | undefined;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const foodType = req.query.foodType as string | undefined;

      const items = await storage.getCuisineItems({ cuisineId, year, foodType });

      res.json({
        items,
        count: items.length,
        filters: { cuisineId, year, foodType },
      });
    } catch (error) {
      console.error("Error fetching cuisine items:", error);
      res.status(500).json({
        message: "Failed to fetch cuisine items",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Ingredient Origin API Routes
  // ============================================================================

  /**
   * GET /api/ingredient-origins - Get all ingredient origins with optional filtering
   */
  app.get("/api/ingredient-origins", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const cuisineId = req.query.cuisineId as string | undefined;

      const items = await storage.getIngredientOrigins({ category, cuisineId });

      res.json({
        ingredientOrigins: items,
        count: items.length,
        filters: { category, cuisineId },
      });
    } catch (error) {
      console.error("Error fetching ingredient origins:", error);
      res.status(500).json({
        message: "Failed to fetch ingredient origins",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/ingredient-origins/:id - Get a single ingredient origin
   */
  app.get("/api/ingredient-origins/:id", async (req, res) => {
    try {
      const item = await storage.getIngredientOriginById(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Ingredient origin not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error fetching ingredient origin:", error);
      res.status(500).json({
        message: "Failed to fetch ingredient origin",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Cooking Technique API Routes
  // ============================================================================

  /**
   * GET /api/cooking-techniques - Get all cooking techniques with optional filtering
   */
  app.get("/api/cooking-techniques", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const cuisineId = req.query.cuisineId as string | undefined;

      const items = await storage.getCookingTechniques({ category, cuisineId });

      res.json({
        cookingTechniques: items,
        count: items.length,
        filters: { category, cuisineId },
      });
    } catch (error) {
      console.error("Error fetching cooking techniques:", error);
      res.status(500).json({
        message: "Failed to fetch cooking techniques",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cooking-techniques/:id - Get a single cooking technique
   */
  app.get("/api/cooking-techniques/:id", async (req, res) => {
    try {
      const item = await storage.getCookingTechniqueById(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Cooking technique not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error fetching cooking technique:", error);
      res.status(500).json({
        message: "Failed to fetch cooking technique",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });


  // ============================================================================
  // Haplogroup API Routes
  // ============================================================================

  /**
   * GET /api/haplogroups - Get all haplogroups with optional filtering
   */
  app.get("/api/haplogroups", async (req, res) => {
    try {
      const parentId = req.query.parentId as string | undefined;
      const languageFamilyId = req.query.languageFamilyId as string | undefined;
      const olderThan = req.query.olderThan ? parseInt(req.query.olderThan as string, 10) : undefined;

      const haplogroups = await storage.getHaplogroups({ parentId, languageFamilyId, olderThan });

      res.json({
        haplogroups,
        count: haplogroups.length,
        filters: { parentId, languageFamilyId, olderThan },
      });
    } catch (error) {
      console.error("Error fetching haplogroups:", error);
      res.status(500).json({
        message: "Failed to fetch haplogroups",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/haplogroups/tree - Get the full haplogroup tree
   */
  app.get("/api/haplogroups/tree", async (req, res) => {
    try {
      const tree = await storage.getHaplogroupTree();
      res.json({
        haplogroups: tree,
        count: tree.length,
      });
    } catch (error) {
      console.error("Error fetching haplogroup tree:", error);
      res.status(500).json({
        message: "Failed to fetch haplogroup tree",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/haplogroups/:id - Get a single haplogroup with its children
   */
  app.get("/api/haplogroups/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await storage.getHaplogroupWithChildren(id);

      if (!result) {
        res.status(404).json({ message: `Haplogroup '${id}' not found` });
        return;
      }

      res.json({
        ...result,
        childCount: result.children.length,
      });
    } catch (error) {
      console.error("Error fetching haplogroup:", error);
      res.status(500).json({
        message: "Failed to fetch haplogroup",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Music API Routes
  // ============================================================================

  /**
   * GET /api/music-traditions - Get music traditions with optional filtering
   */
  app.get("/api/music-traditions", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const region = req.query.region as string | undefined;
      const languageId = req.query.languageId as string | undefined;

      const traditions = await storage.getMusicTraditions({ year, region, languageId });

      res.json({
        traditions,
        count: traditions.length,
        filters: { year, region, languageId },
      });
    } catch (error) {
      console.error("Error fetching music traditions:", error);
      res.status(500).json({
        message: "Failed to fetch music traditions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/music-traditions/:id - Get a single music tradition with its instruments
   */
  app.get("/api/music-traditions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await storage.getMusicTraditionWithInstruments(id);

      if (!result) {
        res.status(404).json({ message: `Music tradition '${id}' not found` });
        return;
      }

      res.json({
        ...result,
        instrumentCount: result.instruments.length,
      });
    } catch (error) {
      console.error("Error fetching music tradition:", error);
      res.status(500).json({
        message: "Failed to fetch music tradition",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/musical-instruments - Get instruments with optional filtering
   */
  app.get("/api/musical-instruments", async (req, res) => {
    try {
      const family = req.query.family as string | undefined;
      const traditionId = req.query.traditionId as string | undefined;
      const olderThan = req.query.olderThan ? parseInt(req.query.olderThan as string, 10) : undefined;

      const instruments = await storage.getMusicalInstruments({ family, traditionId, olderThan });

      res.json({
        instruments,
        count: instruments.length,
        filters: { family, traditionId, olderThan },
      });
    } catch (error) {
      console.error("Error fetching musical instruments:", error);
      res.status(500).json({
        message: "Failed to fetch musical instruments",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Dance Tradition API Routes
  // ============================================================================

  /**
   * GET /api/dance-traditions - Get dance traditions with optional filtering
   */
  app.get("/api/dance-traditions", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const region = req.query.region as string | undefined;
      const languageId = req.query.languageId as string | undefined;
      const danceType = req.query.danceType as string | undefined;

      const traditions = await storage.getDanceTraditions({ year, region, languageId, danceType });

      res.json({
        traditions,
        count: traditions.length,
        filters: { year, region, languageId, danceType },
      });
    } catch (error) {
      console.error("Error fetching dance traditions:", error);
      res.status(500).json({
        message: "Failed to fetch dance traditions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/dance-traditions/:id - Get a single dance tradition
   */
  app.get("/api/dance-traditions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const tradition = await storage.getDanceTraditionById(id);

      if (!tradition) {
        res.status(404).json({ message: `Dance tradition '${id}' not found` });
        return;
      }

      res.json(tradition);
    } catch (error) {
      console.error("Error fetching dance tradition:", error);
      res.status(500).json({
        message: "Failed to fetch dance tradition",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Religion API Routes
  // ============================================================================

  /**
   * GET /api/religions - Get religions with optional filtering
   */
  app.get("/api/religions", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const region = req.query.region as string | undefined;
      const religionType = req.query.religionType as string | undefined;
      const languageId = req.query.languageId as string | undefined;

      const religions = await storage.getReligions({ year, region, religionType, languageId });

      res.json({
        religions,
        count: religions.length,
        filters: { year, region, religionType, languageId },
      });
    } catch (error) {
      console.error("Error fetching religions:", error);
      res.status(500).json({
        message: "Failed to fetch religions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/religions/:id - Get a single religion by ID
   */
  app.get("/api/religions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const religion = await storage.getReligion(id);

      if (!religion) {
        res.status(404).json({ message: `Religion '${id}' not found` });
        return;
      }

      res.json(religion);
    } catch (error) {
      console.error("Error fetching religion:", error);
      res.status(500).json({
        message: "Failed to fetch religion",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Urheimat Hypotheses API Routes
  // ============================================================================

  /**
   * GET /api/urheimat-hypotheses - Get urheimat hypotheses with optional filtering
   */
  app.get("/api/urheimat-hypotheses", async (req, res) => {
    try {
      const languageFamilyId = req.query.language_family as string | undefined;
      const consensusMin = req.query.consensus_min
        ? parseFloat(req.query.consensus_min as string)
        : undefined;

      const hypotheses = await storage.getUrheimatHypotheses({
        languageFamilyId,
        consensusMin,
      });

      res.json({
        hypotheses,
        count: hypotheses.length,
        filters: { languageFamilyId, consensusMin },
      });
    } catch (error) {
      console.error("Error fetching urheimat hypotheses:", error);
      res.status(500).json({
        message: "Failed to fetch urheimat hypotheses",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/urheimat-hypotheses/:id - Get a single urheimat hypothesis by ID
   */
  app.get("/api/urheimat-hypotheses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const hypothesis = await storage.getUrheimatHypothesis(id);

      if (!hypothesis) {
        res.status(404).json({ message: `Urheimat hypothesis '${id}' not found` });
        return;
      }

      res.json(hypothesis);
    } catch (error) {
      console.error("Error fetching urheimat hypothesis:", error);
      res.status(500).json({
        message: "Failed to fetch urheimat hypothesis",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Mythology API Routes
  // ============================================================================

  app.get("/api/deities", async (req, res) => {
    try {
      const mythology = req.query.mythology as string | undefined;
      const domain = req.query.domain as string | undefined;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

      const deities = await storage.getDeities({ mythology, domain, year });

      res.json({
        deities,
        count: deities.length,
        filters: { mythology, domain, year },
      });
    } catch (error) {
      console.error("Error fetching deities:", error);
      res.status(500).json({
        message: "Failed to fetch deities",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/deities/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deity = await storage.getDeity(id);

      if (!deity) {
        res.status(404).json({ message: `Deity '${id}' not found` });
        return;
      }

      res.json(deity);
    } catch (error) {
      console.error("Error fetching deity:", error);
      res.status(500).json({
        message: "Failed to fetch deity",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/deities/:id/equivalents", async (req, res) => {
    try {
      const { id } = req.params;
      const equivalents = await storage.getDeityEquivalents(id);
      res.json({ equivalents, count: equivalents.length });
    } catch (error) {
      console.error("Error fetching deity equivalents:", error);
      res.status(500).json({
        message: "Failed to fetch deity equivalents",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/myth-motifs", async (req, res) => {
    try {
      const motifType = req.query.motifType as string | undefined;
      const mythology = req.query.mythology as string | undefined;
      const region = req.query.region as string | undefined;

      const motifs = await storage.getMythMotifs({ motifType, mythology, region });

      res.json({
        motifs,
        count: motifs.length,
        filters: { motifType, mythology, region },
      });
    } catch (error) {
      console.error("Error fetching myth motifs:", error);
      res.status(500).json({
        message: "Failed to fetch myth motifs",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/myth-motifs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const motif = await storage.getMythMotif(id);

      if (!motif) {
        res.status(404).json({ message: `Myth motif '${id}' not found` });
        return;
      }

      res.json(motif);
    } catch (error) {
      console.error("Error fetching myth motif:", error);
      res.status(500).json({
        message: "Failed to fetch myth motif",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/deities/:id/motifs", async (req, res) => {
    try {
      const { id } = req.params;
      const motifs = await storage.getMotifsByDeity(id);
      res.json({ motifs, count: motifs.length });
    } catch (error) {
      console.error("Error fetching motifs for deity:", error);
      res.status(500).json({
        message: "Failed to fetch motifs for deity",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Cross-Domain Analysis API Routes (Phase 4)
  // ============================================================================

  const { CrossDomainAnalysis } = await import("./services/cross-domain-analysis");
  const crossDomain = new CrossDomainAnalysis(storage);

  /**
   * GET /api/cross-domain/search - Search across all cultural domains
   */
  app.get("/api/cross-domain/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ message: "Query parameter 'q' is required" });
        return;
      }
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const types = req.query.types ? (req.query.types as string).split(",") : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const entities = await crossDomain.search(query, {
        year,
        types: types as any,
        limit,
      });

      res.json({ entities, count: entities.length, query });
    } catch (error) {
      console.error("Error in cross-domain search:", error);
      res.status(500).json({
        message: "Failed to perform cross-domain search",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cross-domain/connections/:type/:id - Find connections for an entity
   */
  app.get("/api/cross-domain/connections/:type/:id", async (req, res) => {
    try {
      const { type, id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const relationships = await crossDomain.findConnections(
        id,
        type as any,
        limit,
      );

      res.json({
        entityId: id,
        entityType: type,
        relationships,
        count: relationships.length,
      });
    } catch (error) {
      console.error("Error finding connections:", error);
      res.status(500).json({
        message: "Failed to find connections",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cross-domain/by-language/:languageId - Find all entities for a language
   */
  app.get("/api/cross-domain/by-language/:languageId", async (req, res) => {
    try {
      const { languageId } = req.params;
      const entities = await crossDomain.findByLanguage(languageId);

      res.json({
        languageId,
        entities,
        count: entities.length,
      });
    } catch (error) {
      console.error("Error finding entities by language:", error);
      res.status(500).json({
        message: "Failed to find entities by language",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cross-domain/by-time/:year - Find all entities existing at a given year
   */
  app.get("/api/cross-domain/by-time/:year", async (req, res) => {
    try {
      const year = parseInt(req.params.year, 10);
      const types = req.query.types ? (req.query.types as string).split(",") : undefined;

      const entities = await crossDomain.findByTimePeriod(year, types as any);

      res.json({
        year,
        entities,
        count: entities.length,
      });
    } catch (error) {
      console.error("Error finding entities by time:", error);
      res.status(500).json({
        message: "Failed to find entities by time",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cross-domain/summary - Get summary statistics across all domains
   */
  app.get("/api/cross-domain/summary", async (req, res) => {
    try {
      const summary = await crossDomain.getSummary();
      res.json(summary);
    } catch (error) {
      console.error("Error getting summary:", error);
      res.status(500).json({
        message: "Failed to get summary",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cross-domain/entities - Get all unified entities with optional filtering
   */
  app.get("/api/cross-domain/entities", async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const region = req.query.region as string | undefined;
      const types = req.query.types ? (req.query.types as string).split(",") : undefined;

      const entities = await crossDomain.getAllEntities({
        year,
        region,
        types: types as any,
      });

      res.json({
        entities,
        count: entities.length,
        filters: { year, region, types },
      });
    } catch (error) {
      console.error("Error fetching unified entities:", error);
      res.status(500).json({
        message: "Failed to fetch entities",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Cross-Domain Correlation API Routes (Phase 4)
  // ============================================================================

  const { CrossDomainCorrelation } = await import("./services/cross-domain-correlation");
  const correlation = new CrossDomainCorrelation(storage);

  /**
   * POST /api/cross-domain/correlate - Compute correlations between two domains
   */
  app.post("/api/cross-domain/correlate", async (req, res) => {
    try {
      const { domainA, domainB, relationshipType } = req.body;
      if (!domainA || !domainB || !relationshipType) {
        res.status(400).json({
          message: "Missing required fields: domainA, domainB, relationshipType",
        });
        return;
      }

      const result = await correlation.queryCorrelation(domainA, domainB, relationshipType);
      res.json(result);
    } catch (error) {
      console.error("Error computing cross-domain correlation:", error);
      res.status(500).json({
        message: "Failed to compute correlation",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cross-domain/prebuilt-queries - Get list of pre-built correlation queries
   */
  app.get("/api/cross-domain/prebuilt-queries", async (_req, res) => {
    try {
      const queries = correlation.getPrebuiltQueries();
      res.json({ queries, count: queries.length });
    } catch (error) {
      console.error("Error fetching prebuilt queries:", error);
      res.status(500).json({
        message: "Failed to fetch prebuilt queries",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Genetic-Linguistic Correlation Routes (Phase 4)
  // ============================================================================

  const { GeneticLinguisticCorrelationService } = await import("./services/genetic-linguistic-correlation");
  const geneticLinguistic = new GeneticLinguisticCorrelationService(storage as any);

  /**
   * GET /api/genetic-linguistic-correlations - Compute genetic-linguistic correlations
   * Query params: haplogroupType (optional) - 'Y-chromosome' or 'mtDNA'
   */
  app.get("/api/genetic-linguistic-correlations", async (req, res) => {
    try {
      const haplogroupType = req.query.haplogroupType as string | undefined;
      const result = await geneticLinguistic.computeCorrelations(haplogroupType);
      res.json(result);
    } catch (error) {
      console.error("Error computing genetic-linguistic correlations:", error);
      res.status(500).json({
        message: "Failed to compute genetic-linguistic correlations",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Contribution API Routes (Phase 5)
  // ============================================================================

  const { ContributionService } = await import("./services/contribution-service");
  const contributions = new ContributionService();

  /**
   * POST /api/contributions - Submit a new contribution
   */
  app.post("/api/contributions", async (req, res) => {
    try {
      const result = contributions.submit(req.body);

      if (!result.validation.valid) {
        res.status(400).json({
          message: "Validation failed",
          errors: result.validation.errors,
          warnings: result.validation.warnings,
        });
        return;
      }

      res.status(201).json({
        contribution: result.contribution,
        warnings: result.validation.warnings,
      });
    } catch (error) {
      console.error("Error submitting contribution:", error);
      res.status(500).json({
        message: "Failed to submit contribution",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions - List contributions with filtering
   */
  app.get("/api/contributions", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const entityType = req.query.entityType as string | undefined;
      const action = req.query.action as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      const result = contributions.list({
        status: status as any,
        entityType: entityType as any,
        action: action as any,
        limit,
        offset,
      });

      res.json(result);
    } catch (error) {
      console.error("Error listing contributions:", error);
      res.status(500).json({
        message: "Failed to list contributions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/export - Export contributions as CSV
   */
  app.get("/api/contributions/export", async (_req, res) => {
    try {
      const csv = contributions.exportCsv();
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contributions.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting contributions:", error);
      res.status(500).json({
        message: "Failed to export contributions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/entity/:entityType/:entityId - Get approved contributions for an entity
   */
  app.get("/api/contributions/entity/:entityType/:entityId", async (req, res) => {
    try {
      const contribs = contributions.getByEntity(req.params.entityType, req.params.entityId);
      res.json({ contributions: contribs });
    } catch (error) {
      console.error("Error getting entity contributions:", error);
      res.status(500).json({
        message: "Failed to get entity contributions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/stats - Get contribution statistics
   */
  app.get("/api/contributions/stats", async (req, res) => {
    try {
      const stats = contributions.stats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting contribution stats:", error);
      res.status(500).json({
        message: "Failed to get contribution stats",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/:id - Get a single contribution
   */
  app.get("/api/contributions/:id", async (req, res) => {
    try {
      const contribution = contributions.get(req.params.id);
      if (!contribution) {
        res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
        return;
      }
      res.json(contribution);
    } catch (error) {
      console.error("Error getting contribution:", error);
      res.status(500).json({
        message: "Failed to get contribution",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PATCH /api/contributions/:id/review - Review (approve/reject) a contribution
   */
  app.patch("/api/contributions/:id/review", async (req, res) => {
    try {
      const { decision, note } = req.body;
      if (!decision || !["approved", "rejected"].includes(decision)) {
        res.status(400).json({ message: "decision must be 'approved' or 'rejected'" });
        return;
      }

      const contribution = contributions.review(req.params.id, decision, note);
      if (!contribution) {
        res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
        return;
      }

      res.json(contribution);
    } catch (error) {
      console.error("Error reviewing contribution:", error);
      res.status(500).json({
        message: "Failed to review contribution",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Sample Texts
  // ============================================================================

  /**
   * GET /api/sample-texts - Get sample texts with optional filtering
   */
  app.get("/api/sample-texts", async (req, res) => {
    try {
      const languageId = req.query.language_id as string | undefined;
      const genre = req.query.genre as string | undefined;
      const script = req.query.script as string | undefined;

      const texts = await storage.getSampleTexts({ languageId, genre, script });
      res.json({
        texts,
        count: texts.length,
        filters: { languageId, genre, script },
      });
    } catch (error) {
      console.error("Error fetching sample texts:", error);
      res.status(500).json({
        message: "Failed to fetch sample texts",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Phonological Inventories
  // ============================================================================

  /**
   * GET /api/phonological-inventories - Get all phonological inventories
   */
  app.get("/api/phonological-inventories", async (req, res) => {
    try {
      const languageId = req.query.language_id as string | undefined;
      const inventories = await storage.getPhonologicalInventories(languageId);
      res.json({
        inventories,
        count: inventories.length,
      });
    } catch (error) {
      console.error("Error fetching phonological inventories:", error);
      res.status(500).json({
        message: "Failed to fetch phonological inventories",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/sample-texts/:id - Get a single sample text by ID
   */
  app.get("/api/sample-texts/:id", async (req, res) => {
    try {
      const text = await storage.getSampleText(req.params.id);
      if (!text) {
        res.status(404).json({ message: `Sample text '${req.params.id}' not found` });
        return;
      }
      res.json(text);
    } catch (error) {
      console.error("Error fetching sample text:", error);
      res.status(500).json({
        message: "Failed to fetch sample text",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/phonological-inventories/:id - Get a single phonological inventory
   */
  app.get("/api/phonological-inventories/:id", async (req, res) => {
    try {
      const inventory = await storage.getPhonologicalInventory(req.params.id);
      if (!inventory) {
        res.status(404).json({ message: `Phonological inventory '${req.params.id}' not found` });
        return;
      }
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching phonological inventory:", error);
      res.status(500).json({
        message: "Failed to fetch phonological inventory",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/languages/:id/sample-texts - Get all sample texts for a specific language
   */
  app.get("/api/languages/:id/sample-texts", async (req, res) => {
    try {
      const texts = await storage.getSampleTexts({ languageId: req.params.id });
      res.json({
        texts,
        count: texts.length,
        languageId: req.params.id,
      });
    } catch (error) {
      console.error("Error fetching language sample texts:", error);
      res.status(500).json({
        message: "Failed to fetch sample texts for language",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/languages/:id/phonological-inventory - Get inventory for a specific language
   */
  app.get("/api/languages/:id/phonological-inventory", async (req, res) => {
    try {
      const inventory = await storage.getPhonologicalInventoryByLanguage(req.params.id);
      if (!inventory) {
        res.status(404).json({ message: `No phonological inventory found for language '${req.params.id}'` });
        return;
      }
      res.json(inventory);
    } catch (error) {
      console.error("Error fetching phonological inventory for language:", error);
      res.status(500).json({
        message: "Failed to fetch phonological inventory for language",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Etymology Relations
  // ============================================================================

  /**
   * GET /api/etymology-relations - Get etymology relations with optional filtering
   */
  app.get("/api/etymology-relations", async (req, res) => {
    try {
      const sourceLanguage = req.query.source_language as string | undefined;
      const targetLanguage = req.query.target_language as string | undefined;
      const relationType = req.query.relation_type as string | undefined;

      const relations = await storage.getEtymologyRelations({
        sourceLanguage,
        targetLanguage,
        relationType,
      });
      res.json({
        relations,
        count: relations.length,
        filters: { sourceLanguage, targetLanguage, relationType },
      });
    } catch (error) {
      console.error("Error fetching etymology relations:", error);
      res.status(500).json({
        message: "Failed to fetch etymology relations",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Grammar Features Endpoints
  // ============================================================================

  /**
   * GET /api/grammar-features - Get all grammar features
   */
  app.get("/api/grammar-features", async (req, res) => {
    try {
      const languageId = req.query.language_id as string | undefined;
      const wordOrder = req.query.word_order as string | undefined;
      const morphologicalType = req.query.morphological_type as string | undefined;
      const features = await storage.getGrammarFeatures(languageId, wordOrder, morphologicalType);
      res.json({
        features,
        count: features.length,
      });
    } catch (error) {
      console.error("Error fetching grammar features:", error);
      res.status(500).json({
        message: "Failed to fetch grammar features",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/etymology-relations/word/:word - Get all relations for a given word
   */
  app.get("/api/etymology-relations/word/:word", async (req, res) => {
    try {
      const relations = await storage.getEtymologyRelationsForWord(req.params.word);
      res.json({
        relations,
        count: relations.length,
        word: req.params.word,
      });
    } catch (error) {
      console.error("Error fetching etymology relations for word:", error);
      res.status(500).json({
        message: "Failed to fetch etymology relations for word",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/grammar-features/:id - Get a single grammar features entry
   */
  app.get("/api/grammar-features/:id", async (req, res) => {
    try {
      const feature = await storage.getGrammarFeaturesById(req.params.id);
      if (!feature) {
        res.status(404).json({ message: `Grammar features '${req.params.id}' not found` });
        return;
      }
      res.json(feature);
    } catch (error) {
      console.error("Error fetching grammar features:", error);
      res.status(500).json({
        message: "Failed to fetch grammar features",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/etymology-relations/trace/:word - Trace full etymology tree for a word
   */
  app.get("/api/etymology-relations/trace/:word", async (req, res) => {
    try {
      const language = req.query.language as string | undefined;
      const direction = req.query.direction as string | undefined;

      let tree;
      if (direction === "descendants") {
        tree = await traceDescendants(req.params.word, language);
      } else {
        tree = await traceEtymology(req.params.word, language);
      }

      res.json({
        tree,
        word: req.params.word,
        language: language ?? null,
        direction: direction ?? "ancestors",
      });
    } catch (error) {
      console.error("Error tracing etymology:", error);
      res.status(500).json({
        message: "Failed to trace etymology",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/languages/:id/grammar-features - Get grammar features for a specific language
   */
  app.get("/api/languages/:id/grammar-features", async (req, res) => {
    try {
      const feature = await storage.getGrammarFeaturesByLanguage(req.params.id);
      if (!feature) {
        res.status(404).json({ message: `No grammar features found for language '${req.params.id}'` });
        return;
      }
      res.json(feature);
    } catch (error) {
      console.error("Error fetching grammar features for language:", error);
      res.status(500).json({
        message: "Failed to fetch grammar features for language",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/writing-systems - Get all writing systems
   */
  app.get("/api/writing-systems", async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const direction = req.query.direction as string | undefined;
      const isActive = req.query.is_active as string | undefined;
      const systems = await storage.getWritingSystems(type, direction, isActive);
      res.json({
        systems,
        count: systems.length,
      });
    } catch (error) {
      console.error("Error fetching writing systems:", error);
      res.status(500).json({
        message: "Failed to fetch writing systems",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/text-analysis/origins - Analyze etymological origins of a text
   */
  app.post("/api/text-analysis/origins", async (req, res) => {
    try {
      const { text, language } = req.body;
      if (!text || !language) {
        res.status(400).json({
          message: "Both 'text' and 'language' fields are required",
        });
        return;
      }

      const result = await analyzeTextOrigins(text, language);
      res.json(result);
    } catch (error) {
      console.error("Error analyzing text origins:", error);
      res.status(500).json({
        message: "Failed to analyze text origins",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/writing-systems/:id - Get a single writing system
   */
  app.get("/api/writing-systems/:id", async (req, res) => {
    try {
      const system = await storage.getWritingSystemById(req.params.id);
      if (!system) {
        res.status(404).json({ message: `Writing system '${req.params.id}' not found` });
        return;
      }
      res.json(system);
    } catch (error) {
      console.error("Error fetching writing system:", error);
      res.status(500).json({
        message: "Failed to fetch writing system",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/writing-systems/:id/descendants - Get all descendants of a writing system
   */
  app.get("/api/writing-systems/:id/descendants", async (req, res) => {
    try {
      const parent = await storage.getWritingSystemById(req.params.id);
      if (!parent) {
        res.status(404).json({ message: `Writing system '${req.params.id}' not found` });
        return;
      }
      const descendants = await storage.getWritingSystemDescendants(req.params.id);
      res.json({
        parent,
        descendants,
        count: descendants.length,
      });
    } catch (error) {
      console.error("Error fetching writing system descendants:", error);
      res.status(500).json({
        message: "Failed to fetch writing system descendants",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Verb Paradigms Endpoints
  // ============================================================================

  /**
   * GET /api/verb-paradigms - Get all verb paradigms
   */
  app.get("/api/verb-paradigms", async (req, res) => {
    try {
      const languageId = req.query.language_id as string | undefined;
      const verbConcept = req.query.verb_concept as string | undefined;
      const paradigms = await storage.getVerbParadigms(languageId, verbConcept);
      res.json({
        paradigms,
        count: paradigms.length,
      });
    } catch (error) {
      console.error("Error fetching verb paradigms:", error);
      res.status(500).json({
        message: "Failed to fetch verb paradigms",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/verb-paradigms/:id - Get a single verb paradigm
   */
  app.get("/api/verb-paradigms/:id", async (req, res) => {
    try {
      const paradigm = await storage.getVerbParadigmById(req.params.id);
      if (!paradigm) {
        res.status(404).json({ message: `Verb paradigm '${req.params.id}' not found` });
        return;
      }
      res.json(paradigm);
    } catch (error) {
      console.error("Error fetching verb paradigm:", error);
      res.status(500).json({
        message: "Failed to fetch verb paradigm",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/languages/:id/verb-paradigms - Get verb paradigms for a specific language
   */
  app.get("/api/languages/:id/verb-paradigms", async (req, res) => {
    try {
      const paradigms = await storage.getVerbParadigmsByLanguage(req.params.id);
      if (paradigms.length === 0) {
        res.status(404).json({ message: `No verb paradigms found for language '${req.params.id}'` });
        return;
      }
      res.json({
        paradigms,
        count: paradigms.length,
      });
    } catch (error) {
      console.error("Error fetching verb paradigms for language:", error);
      res.status(500).json({
        message: "Failed to fetch verb paradigms for language",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/battles - Get all battles
   */
  app.get("/api/battles", async (req, res) => {
    try {
      const warName = req.query.war_name as string | undefined;
      const startDate = req.query.start_date as string | undefined;
      const endDate = req.query.end_date as string | undefined;
      const civilizationId = req.query.civilization_id as string | undefined;
      const battles = await storage.getBattles(warName, startDate, endDate, civilizationId);
      res.json({
        battles,
        count: battles.length,
      });
    } catch (error) {
      console.error("Error fetching battles:", error);
      res.status(500).json({
        message: "Failed to fetch battles",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/battles/:id - Get a single battle
   */
  app.get("/api/battles/:id", async (req, res) => {
    try {
      const battle = await storage.getBattleById(req.params.id);
      if (!battle) {
        res.status(404).json({ message: `Battle '${req.params.id}' not found` });
        return;
      }
      res.json(battle);
    } catch (error) {
      console.error("Error fetching battle:", error);
      res.status(500).json({
        message: "Failed to fetch battle",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/migration-routes - Get all migration routes
   */
  app.get("/api/migration-routes", async (req, res) => {
    try {
      const routeType = req.query.route_type as string | undefined;
      const startDate = req.query.start_date as string | undefined;
      const endDate = req.query.end_date as string | undefined;
      const routes = await storage.getMigrationRoutes(routeType, startDate, endDate);
      res.json({
        routes,
        count: routes.length,
      });
    } catch (error) {
      console.error("Error fetching migration routes:", error);
      res.status(500).json({
        message: "Failed to fetch migration routes",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/migration-routes/:id - Get a single migration route
   */
  app.get("/api/migration-routes/:id", async (req, res) => {
    try {
      const route = await storage.getMigrationRouteById(req.params.id);
      if (!route) {
        res.status(404).json({ message: `Migration route '${req.params.id}' not found` });
        return;
      }
      res.json(route);
    } catch (error) {
      console.error("Error fetching migration route:", error);
      res.status(500).json({
        message: "Failed to fetch migration route",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/trade-routes - Get all trade routes
   */
  app.get("/api/trade-routes", async (req, res) => {
    try {
      const routeType = req.query.route_type as string | undefined;
      const startDate = req.query.start_date as string | undefined;
      const endDate = req.query.end_date as string | undefined;
      const routes = await storage.getTradeRoutes(routeType, startDate, endDate);
      res.json({
        routes,
        count: routes.length,
      });
    } catch (error) {
      console.error("Error fetching trade routes:", error);
      res.status(500).json({
        message: "Failed to fetch trade routes",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/trade-routes/:id - Get a single trade route
   */
  app.get("/api/trade-routes/:id", async (req, res) => {
    try {
      const route = await storage.getTradeRouteById(req.params.id);
      if (!route) {
        res.status(404).json({ message: `Trade route '${req.params.id}' not found` });
        return;
      }
      res.json(route);
    } catch (error) {
      console.error("Error fetching trade route:", error);
      res.status(500).json({
        message: "Failed to fetch trade route",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/language-contacts - Get all language contact events
   */
  app.get("/api/language-contacts", async (req, res) => {
    try {
      const sourceLanguageId = req.query.source_language_id as string | undefined;
      const targetLanguageId = req.query.target_language_id as string | undefined;
      const contactType = req.query.contact_type as string | undefined;
      const intensity = req.query.intensity as string | undefined;
      const contacts = await storage.getLanguageContacts(sourceLanguageId, targetLanguageId, contactType, intensity);
      res.json({
        contacts,
        count: contacts.length,
      });
    } catch (error) {
      console.error("Error fetching language contacts:", error);
      res.status(500).json({
        message: "Failed to fetch language contacts",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/language-contacts/:id - Get a single language contact event
   */
  app.get("/api/language-contacts/:id", async (req, res) => {
    try {
      const contact = await storage.getLanguageContactById(req.params.id);
      if (!contact) {
        res.status(404).json({ message: `Language contact '${req.params.id}' not found` });
        return;
      }
      res.json(contact);
    } catch (error) {
      console.error("Error fetching language contact:", error);
      res.status(500).json({
        message: "Failed to fetch language contact",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/languages/:id/contacts - Get all contact events involving a specific language
   */
  app.get("/api/languages/:id/contacts", async (req, res) => {
    try {
      const contacts = await storage.getLanguageContactsByLanguage(req.params.id);
      if (contacts.length === 0) {
        res.status(404).json({ message: `No language contacts found for language '${req.params.id}'` });
        return;
      }
      res.json({
        contacts,
        count: contacts.length,
      });
    } catch (error) {
      console.error("Error fetching language contacts for language:", error);
      res.status(500).json({
        message: "Failed to fetch language contacts for language",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/sound-changes - Get all sound changes
   */
  app.get("/api/sound-changes", async (req, res) => {
    try {
      const { family_id, source_language_id, target_language_id } = req.query;
      const changes = await storage.getSoundChanges(
        family_id as string | undefined,
        source_language_id as string | undefined,
        target_language_id as string | undefined,
      );
      res.json({
        changes,
        count: changes.length,
      });
    } catch (error) {
      console.error("Error fetching sound changes:", error);
      res.status(500).json({
        message: "Failed to fetch sound changes",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/sound-changes/:id - Get a single sound change
   */
  app.get("/api/sound-changes/:id", async (req, res) => {
    try {
      const change = await storage.getSoundChangeById(req.params.id);
      if (!change) {
        res.status(404).json({ message: `Sound change '${req.params.id}' not found` });
        return;
      }
      res.json(change);
    } catch (error) {
      console.error("Error fetching sound change:", error);
      res.status(500).json({
        message: "Failed to fetch sound change",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/foodway-events - Get all foodway events with optional filtering
   */
  app.get("/api/foodway-events", async (req, res) => {
    try {
      const foodItem = req.query.food_item as string | undefined;
      const mechanism = req.query.mechanism as string | undefined;
      const dateStart = req.query.date_start ? parseInt(req.query.date_start as string, 10) : undefined;
      const dateEnd = req.query.date_end ? parseInt(req.query.date_end as string, 10) : undefined;
      const events = await storage.getFoodwayEvents({ foodItem, mechanism, dateStart, dateEnd });
      res.json({ events, count: events.length });
    } catch (error) {
      console.error("Error fetching foodway events:", error);
      res.status(500).json({
        message: "Failed to fetch foodway events",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/foodway-events/:id - Get a single foodway event
   */
  app.get("/api/foodway-events/:id", async (req, res) => {
    try {
      const event = await storage.getFoodwayEventById(req.params.id);
      if (!event) {
        return res.status(404).json({ message: "Foodway event not found" });
      }
      res.json(event);
    } catch (error) {
      console.error("Error fetching foodway event:", error);
      res.status(500).json({
        message: "Failed to fetch foodway event",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/art-traditions - Get all art traditions with optional filtering
   */
  app.get("/api/art-traditions", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const stylePeriod = req.query.style_period as string | undefined;
      const traditions = await storage.getArtTraditions({ category, stylePeriod });
      res.json({ traditions, count: traditions.length });
    } catch (error) {
      console.error("Error fetching art traditions:", error);
      res.status(500).json({
        message: "Failed to fetch art traditions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/art-traditions/:id - Get a single art tradition
   */
  app.get("/api/art-traditions/:id", async (req, res) => {
    try {
      const tradition = await storage.getArtTraditionById(req.params.id);
      if (!tradition) {
        return res.status(404).json({ message: "Art tradition not found" });
      }
      res.json(tradition);
    } catch (error) {
      console.error("Error fetching art tradition:", error);
      res.status(500).json({
        message: "Failed to fetch art tradition",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/architectural-styles - Get all architectural styles with optional filtering
   */
  app.get("/api/architectural-styles", async (req, res) => {
    try {
      const stylePeriod = req.query.style_period as string | undefined;
      const region = req.query.region as string | undefined;
      const styles = await storage.getArchitecturalStyles({ stylePeriod, region });
      res.json({ styles, count: styles.length });
    } catch (error) {
      console.error("Error fetching architectural styles:", error);
      res.status(500).json({
        message: "Failed to fetch architectural styles",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/architectural-styles/:id - Get a single architectural style
   */
  app.get("/api/architectural-styles/:id", async (req, res) => {
    try {
      const style = await storage.getArchitecturalStyleById(req.params.id);
      if (!style) {
        return res.status(404).json({ message: "Architectural style not found" });
      }
      res.json(style);
    } catch (error) {
      console.error("Error fetching architectural style:", error);
      res.status(500).json({
        message: "Failed to fetch architectural style",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/archaeological-cultures - Get all archaeological cultures with optional filtering
   */
  app.get("/api/archaeological-cultures", async (req, res) => {
    try {
      const region = req.query.region as string | undefined;
      const language = req.query.language as string | undefined;
      const timeStart = req.query.time_start ? parseInt(req.query.time_start as string) : undefined;
      const timeEnd = req.query.time_end ? parseInt(req.query.time_end as string) : undefined;
      const cultures = await storage.getArchaeologicalCultures({ region, language, timeStart, timeEnd });
      res.json({ cultures, count: cultures.length });
    } catch (error) {
      console.error("Error fetching archaeological cultures:", error);
      res.status(500).json({
        message: "Failed to fetch archaeological cultures",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/archaeological-cultures/:id - Get a single archaeological culture
   */
  app.get("/api/archaeological-cultures/:id", async (req, res) => {
    try {
      const culture = await storage.getArchaeologicalCultureById(req.params.id);
      if (!culture) {
        return res.status(404).json({ message: "Archaeological culture not found" });
      }
      res.json(culture);
    } catch (error) {
      console.error("Error fetching archaeological culture:", error);
      res.status(500).json({
        message: "Failed to fetch archaeological culture",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/kinship-systems - Get all kinship systems with optional filtering
   */
  app.get("/api/kinship-systems", async (req, res) => {
    try {
      const systemType = req.query.system_type as string | undefined;
      const descentRule = req.query.descent_rule as string | undefined;
      const systems = await storage.getKinshipSystems({ systemType, descentRule });
      res.json({ systems, count: systems.length });
    } catch (error) {
      console.error("Error fetching kinship systems:", error);
      res.status(500).json({
        message: "Failed to fetch kinship systems",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/kinship-systems/:id - Get a single kinship system
   */
  app.get("/api/kinship-systems/:id", async (req, res) => {
    try {
      const system = await storage.getKinshipSystemById(req.params.id);
      if (!system) {
        return res.status(404).json({ message: "Kinship system not found" });
      }
      res.json(system);
    } catch (error) {
      console.error("Error fetching kinship system:", error);
      res.status(500).json({
        message: "Failed to fetch kinship system",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/trade-goods - Get all trade goods with optional filtering
   */
  app.get("/api/trade-goods", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const timePeriod = req.query.time_period as string | undefined;
      const goods = await storage.getTradeGoods({ category, timePeriod });
      res.json({ goods, count: goods.length });
    } catch (error) {
      console.error("Error fetching trade goods:", error);
      res.status(500).json({
        message: "Failed to fetch trade goods",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/trade-goods/:id - Get a single trade good
   */
  app.get("/api/trade-goods/:id", async (req, res) => {
    try {
      const good = await storage.getTradeGoodById(req.params.id);
      if (!good) {
        return res.status(404).json({ message: "Trade good not found" });
      }
      res.json(good);
    } catch (error) {
      console.error("Error fetching trade good:", error);
      res.status(500).json({
        message: "Failed to fetch trade good",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Narratives Endpoints
  // ============================================================================

  /**
   * GET /api/narratives - Get all narratives
   */
  app.get("/api/narratives", async (req, res) => {
    try {
      const narratives = await storage.getNarratives();
      res.json({ narratives, count: narratives.length });
    } catch (error) {
      console.error("Error fetching narratives:", error);
      res.status(500).json({
        message: "Failed to fetch narratives",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/narratives/:id - Get a single narrative with all steps
   */
  app.get("/api/narratives/:id", async (req, res) => {
    try {
      const narrative = await storage.getNarrativeById(req.params.id);
      if (!narrative) {
        return res.status(404).json({ message: "Narrative not found" });
      }
      res.json(narrative);
    } catch (error) {
      console.error("Error fetching narrative:", error);
      res.status(500).json({
        message: "Failed to fetch narrative",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Global Search Endpoint
  // ============================================================================

  /**
   * GET /api/search?q=query - Unified search across all data domains
   */
  app.get("/api/search", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      if (!q || !q.trim()) {
        res.json({ results: [], query: "", totalCount: 0 });
        return;
      }
      const result = await globalSearch(q);
      res.json(result);
    } catch (error) {
      console.error("Error in global search:", error);
      res.status(500).json({
        message: "Failed to perform search",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/text-analysis/compare - Compare etymological origins of two texts
   */
  app.post("/api/text-analysis/compare", async (req, res) => {
    try {
      const { textA, textB, languageA, languageB } = req.body;
      if (!textA || !textB || !languageA || !languageB) {
        res.status(400).json({
          message:
            "Fields 'textA', 'textB', 'languageA', and 'languageB' are all required",
        });
        return;
      }

      const [analysisA, analysisB] = await Promise.all([
        analyzeTextOrigins(textA, languageA),
        analyzeTextOrigins(textB, languageB),
      ]);

      // Build origin language sets
      const originsMapA = new Map<string, number>();
      for (const o of analysisA.origins) {
        originsMapA.set(o.language, o.percentage);
      }
      const originsMapB = new Map<string, number>();
      for (const o of analysisB.origins) {
        originsMapB.set(o.language, o.percentage);
      }

      // Collect all origin languages
      const allLanguages = new Set<string>();
      originsMapA.forEach((_v, k) => allLanguages.add(k));
      originsMapB.forEach((_v, k) => allLanguages.add(k));

      const sharedOrigins: string[] = [];
      const uniqueToA: string[] = [];
      const uniqueToB: string[] = [];
      const differences: Array<{
        language: string;
        percentA: number;
        percentB: number;
        diff: number;
      }> = [];

      allLanguages.forEach((lang) => {
        const inA = originsMapA.has(lang);
        const inB = originsMapB.has(lang);
        const percentA = originsMapA.get(lang) ?? 0;
        const percentB = originsMapB.get(lang) ?? 0;

        if (inA && inB) {
          sharedOrigins.push(lang);
        } else if (inA) {
          uniqueToA.push(lang);
        } else {
          uniqueToB.push(lang);
        }

        differences.push({
          language: lang,
          percentA,
          percentB,
          diff: Math.round((percentA - percentB) * 10) / 10,
        });
      });

      // Sort differences by absolute difference descending
      differences.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

      res.json({
        analysisA,
        analysisB,
        comparison: {
          sharedOrigins,
          uniqueToA,
          uniqueToB,
          differences,
        },
      });
    } catch (error) {
      console.error("Error comparing text origins:", error);
      res.status(500).json({
        message: "Failed to compare text origins",
      });
    }
  });

<<<<<<< HEAD
  // Bulk CSV/TSV Import
  app.get("/api/import/targets", async (_req, res) => {
    try {
      const targets = await getImportTargets();
      res.json(targets);
    } catch (error) {
      console.error("Error listing import targets:", error);
      res.status(500).json({ message: "Failed to list import targets" });
    }
  });

  app.post("/api/import/bulk", async (req, res) => {
    try {
      const { target, content, mode, skipDuplicates } = req.body;

      if (!target || typeof target !== "string") {
        return res.status(400).json({ message: "Missing required field: target" });
      }
      if (!content || typeof content !== "string") {
        return res.status(400).json({ message: "Missing required field: content" });
      }
      if (!mode || !["append", "replace"].includes(mode)) {
        return res.status(400).json({ message: "Mode must be 'append' or 'replace'" });
      }

      const result = await bulkImport({
        target,
        content,
        mode,
        skipDuplicates: skipDuplicates !== false,
      });

      const hasErrors = result.errors.some(
        (e) => !e.startsWith("Unmapped columns")
      );
      res.status(hasErrors ? 400 : 200).json(result);
    } catch (error) {
      console.error("Error in bulk import:", error);
      res.status(500).json({ message: "Bulk import failed" });
    }
  });

  // Quiz & Learning Mode
  app.get("/api/quiz", async (req, res) => {
    try {
      const count = Math.min(Math.max(parseInt(req.query.count as string, 10) || 10, 1), 30);
      const category = (req.query.category as QuizCategory | "mixed") || "mixed";
      const difficulty = (req.query.difficulty as Difficulty) || "medium";

      const validCategories = ["mixed", "languages", "families", "grammar", "writing_systems", "geography"];
      const validDifficulties = ["easy", "medium", "hard"];

      if (!validCategories.includes(category)) {
        return res.status(400).json({ message: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
      }
      if (!validDifficulties.includes(difficulty)) {
        return res.status(400).json({ message: `Invalid difficulty. Must be one of: ${validDifficulties.join(", ")}` });
      }

      const session = await generateQuiz(count, category, difficulty);
      res.json(session);
    } catch (error) {
      console.error("Error generating quiz:", error);
      res.status(500).json({ message: "Failed to generate quiz" });
    }
  });

  app.post("/api/quiz/score-map", async (req, res) => {
    try {
      const { answer, guess, difficulty } = req.body;
      if (!answer || !guess || !answer.lat || !answer.lng || !guess.lat || !guess.lng) {
        return res.status(400).json({ message: "answer and guess must have lat and lng" });
      }
      const result = scoreMapClick(answer, guess, difficulty || "medium");
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to score map click" });
    }
  });

  // ── Cultural Influence Visualizations (Sankey & Chord) ─────────────

  /**
   * GET /api/visualizations/sankey - Build Sankey diagram data from language contacts
   * Query params: yearStart, yearEnd (optional temporal filter)
   */
  app.get("/api/visualizations/sankey", async (req, res) => {
    try {
      const yearStart = req.query.yearStart ? parseInt(req.query.yearStart as string, 10) : undefined;
      const yearEnd = req.query.yearEnd ? parseInt(req.query.yearEnd as string, 10) : undefined;

      const contacts = await storage.getLanguageContacts();
      const languages = await storage.getLanguages();
      const langMap = new Map(languages.map((l) => [l.id, l]));

      // Filter by time period if provided
      const filtered = contacts.filter((c) => {
        if (!yearStart && !yearEnd) return true;
        const match = c.timePeriod.match(/(-?\d+)/);
        if (!match) return true;
        const year = parseInt(match[1], 10);
        if (yearStart !== undefined && year < yearStart) return false;
        if (yearEnd !== undefined && year > yearEnd) return false;
        return true;
      });

      const nodeIds = new Set<string>();
      const links = filtered.map((c) => {
        nodeIds.add(c.sourceLanguageId);
        nodeIds.add(c.targetLanguageId);
        const intensityValue = c.intensity === "heavy" ? 3 : c.intensity === "moderate" ? 2 : 1;
        return {
          source: c.sourceLanguageId,
          target: c.targetLanguageId,
          value: intensityValue,
          contactType: c.contactType,
          timePeriod: c.timePeriod,
        };
      });

      const nodes = Array.from(nodeIds).map((id) => {
        const lang = langMap.get(id);
        return {
          id,
          name: lang?.name || id,
          group: lang?.familyId || "unknown",
        };
      });

      res.json({ nodes, links });
    } catch (error) {
      console.error("Error building sankey data:", error);
      res.status(500).json({ message: "Failed to build sankey visualization data" });
    }
  });

  // ============================================================================
  // Cultural Lineage API Routes
  // ============================================================================

  /**
   * GET /api/cultural-lineages - Get all cultural lineages with optional filtering
   */
  app.get("/api/cultural-lineages", async (req, res) => {
    try {
      const { relationship_type, source_id, target_id } = req.query;
      const lineages = await storage.getCulturalLineages(
        relationship_type as string | undefined,
        source_id as string | undefined,
        target_id as string | undefined,
      );
      res.json(lineages);
    } catch (error) {
      console.error("Error fetching cultural lineages:", error);
      res.status(500).json({
        message: "Failed to fetch cultural lineages",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Natural Language & Spatial Search Endpoints
  // ============================================================================

  /**
   * GET /api/search/natural?q=query - Natural language search with temporal-spatial parsing
   */
  app.get("/api/search/natural", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      if (!q || !q.trim()) {
        res.json({ results: [], query: { raw: "" }, totalCount: 0 });
        return;
      }
      const parsed = parseNaturalLanguageQuery(q);
      const result = await spatialSearch(parsed);
      res.json(result);
    } catch (error) {
      console.error("Error in natural language search:", error);
      res.status(500).json({
        message: "Failed to perform natural language search",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/literary-traditions - Get all literary traditions with optional filtering
   */
  app.get("/api/literary-traditions", async (req, res) => {
    try {
      const region = req.query.region as string | undefined;
      const genre = req.query.genre as string | undefined;
      const traditions = await storage.getLiteraryTraditions({ region, genre });
      res.json({ traditions, count: traditions.length });
    } catch (error) {
      console.error("Error fetching literary traditions:", error);
      res.status(500).json({
        message: "Failed to fetch literary traditions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/visualizations/chord - Build chord diagram data (language family mutual influences)
   * Query params: yearStart, yearEnd (optional temporal filter)
   */
  app.get("/api/visualizations/chord", async (req, res) => {
    try {
      const yearStart = req.query.yearStart ? parseInt(req.query.yearStart as string, 10) : undefined;
      const yearEnd = req.query.yearEnd ? parseInt(req.query.yearEnd as string, 10) : undefined;

      const contacts = await storage.getLanguageContacts();
      const languages = await storage.getLanguages();
      const langMap = new Map(languages.map((l) => [l.id, l]));
      const families = await storage.getLanguageFamilies();
      const familyMap = new Map(families.map((f) => [f.id, f.name]));

      // Filter by time period
      const filtered = contacts.filter((c) => {
        if (!yearStart && !yearEnd) return true;
        const match = c.timePeriod.match(/(-?\d+)/);
        if (!match) return true;
        const year = parseInt(match[1], 10);
        if (yearStart !== undefined && year < yearStart) return false;
        if (yearEnd !== undefined && year > yearEnd) return false;
        return true;
      });

      // Aggregate contacts by language family pairs
      const familyPairs = new Map<string, number>();
      const familyIds = new Set<string>();

      for (const c of filtered) {
        const srcLang = langMap.get(c.sourceLanguageId);
        const tgtLang = langMap.get(c.targetLanguageId);
        const srcFamily = srcLang?.familyId || "unknown";
        const tgtFamily = tgtLang?.familyId || "unknown";
        if (srcFamily === tgtFamily) continue; // skip intra-family contacts

        familyIds.add(srcFamily);
        familyIds.add(tgtFamily);

        const intensityValue = c.intensity === "heavy" ? 3 : c.intensity === "moderate" ? 2 : 1;
        const key = `${srcFamily}|${tgtFamily}`;
        familyPairs.set(key, (familyPairs.get(key) || 0) + intensityValue);
      }

      const names = Array.from(familyIds).map((id) => familyMap.get(id) || id);
      const idList = Array.from(familyIds);
      const n = idList.length;
      const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

      for (const [key, value] of familyPairs) {
        const [src, tgt] = key.split("|");
        const i = idList.indexOf(src);
        const j = idList.indexOf(tgt);
        if (i >= 0 && j >= 0) {
          matrix[i][j] += value;
          matrix[j][i] += value; // symmetric
        }
      }

      res.json({ names, matrix });
    } catch (error) {
      console.error("Error building chord data:", error);
      res.status(500).json({ message: "Failed to build chord visualization data" });
    }
  });

  /**
   * GET /api/cultural-lineages/ancestors/:entityId - Recursively find all ancestors
   */
  app.get("/api/cultural-lineages/ancestors/:entityId", async (req, res) => {
    try {
      const maxDepth = req.query.maxDepth
        ? parseInt(req.query.maxDepth as string, 10) : 20;
      const lineages = await storage.getCulturalLineageAncestors(req.params.entityId, maxDepth);

      res.json({
        entityId: req.params.entityId,
        lineages,
        count: lineages.length,
      });
    } catch (error) {
      console.error("Error fetching cultural lineage ancestors:", error);
      res.status(500).json({
        message: "Failed to fetch cultural lineage ancestors",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Archaeological Cultures API Routes
  // ============================================================================

  /**
   * GET /api/archaeological-cultures - Get archaeological cultures with optional filtering
   */
  app.get("/api/archaeological-cultures", async (req, res) => {
    try {
      const region = req.query.region as string | undefined;
      const languageId = req.query.languageId as string | undefined;
      const timeStart = req.query.timeStart ? parseInt(req.query.timeStart as string, 10) : undefined;
      const timeEnd = req.query.timeEnd ? parseInt(req.query.timeEnd as string, 10) : undefined;

      const cultures = await storage.getArchaeologicalCultures({ region, languageId, timeStart, timeEnd });

      res.json({
        cultures,
        count: cultures.length,
        filters: { region, languageId, timeStart, timeEnd },
      });
    } catch (error) {
      console.error("Error fetching archaeological cultures:", error);
      res.status(500).json({
        message: "Failed to fetch archaeological cultures",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/literary-traditions/:id - Get a single literary tradition with its works
   */
  app.get("/api/literary-traditions/:id", async (req, res) => {
    try {
      const result = await storage.getLiteraryTraditionWithWorks(req.params.id);
      if (!result) {
        return res.status(404).json({ message: "Literary tradition not found" });
      }
      res.json({ ...result, workCount: result.works.length });
    } catch (error) {
      console.error("Error fetching literary tradition:", error);
      res.status(500).json({
        message: "Failed to fetch literary tradition",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cultural-lineages/descendants/:entityId - Recursively find all descendants
   */
  app.get("/api/cultural-lineages/descendants/:entityId", async (req, res) => {
    try {
      const maxDepth = req.query.maxDepth
        ? parseInt(req.query.maxDepth as string, 10) : 20;
      const lineages = await storage.getCulturalLineageDescendants(req.params.entityId, maxDepth);

      res.json({
        entityId: req.params.entityId,
        lineages,
        count: lineages.length,
      });
    } catch (error) {
      console.error("Error fetching cultural lineage descendants:", error);
      res.status(500).json({
        message: "Failed to fetch cultural lineage descendants",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/literary-works - Get all literary works with optional filtering
   */
  app.get("/api/literary-works", async (req, res) => {
    try {
      const traditionId = req.query.tradition_id as string | undefined;
      const genre = req.query.genre as string | undefined;
      const languageId = req.query.language_id as string | undefined;
      const works = await storage.getLiteraryWorks({ traditionId, genre, languageId });
      res.json({ works, count: works.length });
    } catch (error) {
      console.error("Error fetching literary works:", error);
      res.status(500).json({
        message: "Failed to fetch literary works",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/cultural-lineages/:id - Get a single cultural lineage by ID
   */
  app.get("/api/cultural-lineages/:id", async (req, res) => {
    try {
      const lineage = await storage.getCulturalLineageById(req.params.id);
      if (!lineage) {
        res.status(404).json({ message: `Cultural lineage '${req.params.id}' not found` });
        return;
      }
      res.json(lineage);
    } catch (error) {
      console.error("Error fetching cultural lineage:", error);
      res.status(500).json({
        message: "Failed to fetch cultural lineage",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/search/spatial?lat=X&lng=Y&year=Z&radius=R - Spatial search by coordinates
   */
  app.get("/api/search/spatial", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (isNaN(lat) || isNaN(lng)) {
        res.status(400).json({ message: "lat and lng are required numeric parameters" });
        return;
      }
      const year = req.query.year ? parseInt(req.query.year as string, 10) : null;
      const radius = req.query.radius ? parseInt(req.query.radius as string, 10) : 200;
      const result = await whatWasHere(lat, lng, isNaN(year as number) ? null : year, radius);
      res.json(result);
    } catch (error) {
      console.error("Error in spatial search:", error);
      res.status(500).json({
        message: "Failed to perform spatial search",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/literary-works/:id - Get a single literary work
   */
  app.get("/api/literary-works/:id", async (req, res) => {
    try {
      const work = await storage.getLiteraryWorkById(req.params.id);
      if (!work) {
        return res.status(404).json({ message: "Literary work not found" });
      }
      res.json(work);
    } catch (error) {
      console.error("Error fetching literary work:", error);
      res.status(500).json({
        message: "Failed to fetch literary work",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/archaeological-cultures/:id - Get a single archaeological culture by ID
   */
  app.get("/api/archaeological-cultures/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const culture = await storage.getArchaeologicalCultureById(id);

      if (!culture) {
        res.status(404).json({ message: `Archaeological culture '${id}' not found` });
        return;
      }

      res.json(culture);
    } catch (error) {
      console.error("Error fetching archaeological culture:", error);
      res.status(500).json({
        message: "Failed to fetch archaeological culture",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/search/suggestions?q=partial - Query autocomplete suggestions
   */
  app.get("/api/search/suggestions", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      const suggestions = getQuerySuggestions(q || "");
      res.json({ suggestions });
    } catch (error) {
      console.error("Error in search suggestions:", error);
      res.status(500).json({ message: "Failed to get suggestions" });
=======
  /**
   * GET /api/urheimat-hypotheses - Get all urheimat hypotheses with optional filtering
   */
  app.get("/api/urheimat-hypotheses", async (req, res) => {
    try {
      const languageFamily = req.query.language_family as string | undefined;
      const consensusMin = req.query.consensus_min ? parseInt(req.query.consensus_min as string, 10) : undefined;

      const hypotheses = await storage.getUrheimatHypotheses({
        languageFamily,
        consensusMin,
      });

      res.json({ hypotheses, count: hypotheses.length });
    } catch (error) {
      console.error("Error fetching urheimat hypotheses:", error);
      res.status(500).json({ message: "Failed to fetch urheimat hypotheses" });
    }
  });

  /**
   * GET /api/urheimat-hypotheses/:id - Get a single urheimat hypothesis
   */
  app.get("/api/urheimat-hypotheses/:id", async (req, res) => {
    try {
      const hypothesis = await storage.getUrheimatHypothesisById(req.params.id);
      if (!hypothesis) {
        return res.status(404).json({ message: "Urheimat hypothesis not found" });
      }
      res.json(hypothesis);
    } catch (error) {
      console.error("Error fetching urheimat hypothesis:", error);
      res.status(500).json({ message: "Failed to fetch urheimat hypothesis" });
>>>>>>> ralphy/agent-8-1773826977547-zs0206-add-urheimat-hypothesis-map-overlay
    }
  });

  // ============================================================================
  // Data Validation API Routes
  // ============================================================================

  const validationService = new DataValidationService(
    path.join(import.meta.dirname, "..", "lexicons")
  );

  /**
   * GET /api/data-validation/validate - Run full data validation
   * Query params: files (comma-separated), skipCrossReferences (boolean)
   */
  app.get("/api/data-validation/validate", async (req, res) => {
    try {
      const files = req.query.files
        ? (req.query.files as string).split(",").map((f) => f.trim())
        : undefined;
      const skipCrossReferences = req.query.skipCrossReferences === "true";

      const report = await validationService.validate({ files, skipCrossReferences });
      res.json(report);
    } catch (error) {
      console.error("Error running data validation:", error);
      res.status(500).json({
        message: "Failed to run data validation",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/data-validation/summary - Get data file summary
   */
  app.get("/api/data-validation/summary", async (_req, res) => {
    try {
      const summary = validationService.getDataSummary();
      res.json({ files: summary, totalFiles: summary.length });
    } catch (error) {
      console.error("Error fetching data summary:", error);
      res.status(500).json({
        message: "Failed to fetch data summary",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/data-validation/cross-references - Get cross-reference rules
   */
  app.get("/api/data-validation/cross-references", async (_req, res) => {
    try {
      const rules = validationService.getCrossReferenceRules();
      res.json({ rules, totalRules: rules.length });
    } catch (error) {
      console.error("Error fetching cross-reference rules:", error);
      res.status(500).json({
        message: "Failed to fetch cross-reference rules",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return server;
}
