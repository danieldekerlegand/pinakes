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
      res.json(comparisons);
    } catch (error) {
      console.error("Error in /api/word-comparisons endpoint:", error);
      res.status(500).json({ message: "Failed to fetch word comparisons" });
    }
  });

  // Language Word List
  app.get("/api/languages/:id/word-list", async (req, res) => {
    try {
      const wordList = await storage.getLanguageWordList(req.params.id);
      res.json(wordList);
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

  return server;
}
