import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getDefaultBoundaryResolver } from "./services/boundary-resolver";
import { applyViewport, viewportOptionsFromQuery } from "./services/geo-bbox";
import { languageFamilyScraperTSV } from "./services/language-family-scraper-tsv";
import { wordListScraper } from "./services/word-list-scraper";
import { writingSystemScraper } from "./services/writing-system-scraper";
import { glottologScraper } from "./services/glottolog-scraper";
import { polityScraper, SESHAT_POLITIES_COUNT } from "./services/polity-scraper";
import { religionScraper } from "./services/religion-scraper";
import { cuisineScraper } from "./services/cuisine-scraper";
import { mythologyScraperTSV } from "./services/mythology-scraper-tsv";
import { soundChangeScraper } from "./services/sound-change-scraper";
import { tradeGoodsScraper } from "./services/trade-goods-scraper";
import { musicScraper } from "./services/music-scraper";
import { artTraditionScraper } from "./services/art-tradition-scraper";
import { jobStore } from "./services/job-store";
import { languageContactScraper } from "./services/language-contact-scraper";
import { architecturalStylesScraper } from "./services/architectural-styles-scraper";
import { wikimediaCommonsScraper } from "./services/wikimedia-commons-scraper";
import {
  identifyUnderrepresentedFamilies,
  underrepresentedVocabScraper,
} from "./services/underrepresented-vocab-scraper";
import { analyzeMapImage } from "./services/map-image-analyzer";
import type { FeatureExtractionRequest } from "./services/map-image-analyzer";
import { MediaAssetService } from "./services/media-asset-service";
import {
  generateReconstructionImage,
  readPromptRecords,
  validateSceneType,
  validateStyle,
} from "./services/image-generator";
import type { ImageGenerationRequest } from "./services/image-generator";
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
import { federatedSearch, parseSearchFilters } from "./services/global-search";
import { registerGraphRoutes } from "./routes/graph";
import { registerMcpRoutes } from "./routes/mcp";
import { registerCapabilityBusRoutes } from "./routes/capability-bus";
import { registerConnectionNarrativeRoutes } from "./routes/connection-narrative";
import { registerAnomalyRoutes } from "./routes/anomaly-detection";
import { registerHypothesisRoutes } from "./routes/hypotheses";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerSummaryRoutes } from "./routes/summaries";
import { registerCitationRoutes } from "./routes/citations";
import { registerEntityResolverRoutes } from "./routes/entity-resolver";
import { registerCollectionRoutes } from "./routes/collections";
import { registerAnnotationRoutes } from "./routes/annotations";
import { registerDrawnGeometryRoutes } from "./routes/drawn-geometry";
import { registerTimelineEventRoutes } from "./routes/timeline-event";
import { registerRelationshipEdgeRoutes } from "./routes/relationship-edge";
import { registerRelationshipSuggestionRoutes } from "./routes/relationship-suggestions";
import { registerUrlExtractorRoutes } from "./routes/url-extractor";
import { registerTextExtractorRoutes } from "./routes/text-extractor";
import { registerTranslateRoutes } from "./routes/translate";
import { registerAiReviewRoutes } from "./routes/ai-review";
import { registerCultureScrapeAcquisitionRoutes } from "./routes/culturescrape-acquisition";
import { registerArchaeologyAcquisitionRoutes } from "./routes/archaeological-acquisition";
import { registerContributionRoutes } from "./routes/contributions";
import { registerCommunityVerificationRoutes } from "./routes/community-verification";
import { registerChangelogRoutes } from "./routes/changelog";
import { registerDatasetReleaseRoutes } from "./routes/dataset-releases";
import { registerAncestryRoutes } from "./routes/ancestry";
import { registerLanguagePreservationRoutes } from "./routes/language-preservation";
import { registerLivingDatasetRoutes } from "./routes/living-dataset";
import { ChangelogStore } from "./services/changelog";
import { searchPlacesWithNominatim, autocompletePlaces, resolvePlace } from "./services/place-resolver";
import { generateDataQualityReport } from "./services/data-quality-scorer";
import { ethnographicScraper } from "./services/ethnographic-scraper";
import { bulkImport, getImportTargets } from "./services/bulk-import";
import { grammarWalsGrambankScraper } from "./services/grammar-wals-grambank-scraper";
import {
  exportDataset,
  getDatasetProfiles,
  getDatasetProfile,
  validateExportOptions,
  createZenodoDoiMinter,
  type ExportFormat,
} from "./services/export-pipeline";
import { battleScraper } from "./services/battle-scraper";
import { generateQuiz, scoreMapClick, type QuizCategory, type Difficulty } from "./services/quiz-generator";
import {
  parseNaturalLanguageQuery,
  spatialSearch,
  whatWasHere,
  getQuerySuggestions,
} from "./services/natural-language-search";
import { DataValidationService } from "./services/data-validation";
import { getFreshnessSummary } from "./services/data-freshness";
import {
  analyzeTsvFiles,
  runBatchEnrichment,
  getEnrichmentJob,
  getAllEnrichmentJobs,
} from "./services/batch-enrichment";
import {
  runCultureProfileEnrichment,
  getCultureEnrichmentJob,
  getAllCultureEnrichmentJobs,
  type EnrichmentDomain,
} from "./services/culture-profile-enrichment";

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);

  // Shared data changelog (US-010). One store instance so the contribution +
  // ai-review pipelines record into the same log that /api/changelog reads.
  const changelog = new ChangelogStore();

  // First-party shared-graph proxy routes (/api/graph/*, US-004).
  registerGraphRoutes(app);

  // MCP server surface (/mcp, 41-US-1) — the KCB §4 invoke-by-MCP-tool front for
  // the three §6 capabilities. Each tool forwards to the already-built surface it
  // wraps (resolve → graph-resolver, reconcile → culture-scrape acquisition,
  // query → the sidecar Datalog console); no resolver/reconciler is reimplemented.
  registerMcpRoutes(app);

  // KCB capability-bus surface (US-PKA2) — publishes the manifest that advertises the
  // already-built resolve/reconcile/query surfaces on the Koine control plane, and
  // best-effort registers it with the discovery registry. Registration never gates
  // serving: with no reachable registry the capabilities stay invocable directly.
  registerCapabilityBusRoutes(app);

  // AI "explain the connection" narrative route (POST /api/graph/explain, US-005) —
  // traverse the shared graph + Datalog between two entities and generate a sourced,
  // AI-labelled narrative of how they are connected.
  registerConnectionNarrativeRoutes(app);

  // Anomaly-detection routes (GET /api/anomalies, US-006) — scan the cross-domain
  // corpus for statistically unexpected similarities between distant, unrelated
  // cultures (rare shared scales/pottery/motifs), ranked as research hypotheses.
  registerAnomalyRoutes(app);

  // Automated hypothesis & site-location generation (GET /api/hypotheses, US-007) —
  // generated, explicitly-speculative leads: clusters of distant unrelated cultures
  // sharing a rare trait (possible common ancestor) + undiscovered-site regions
  // predicted from gaps along migration corridors (with an uncertainty radius).
  registerHypothesisRoutes(app);

  // Runtime analytical-index routes (/api/analytics/*, US-001) — heavy tabular
  // faceting/aggregates served from the DuckDB index over lexicons/*.tsv.
  registerAnalyticsRoutes(app);

  // Progressive summary/detail routes (/api/summaries/*, US-004) — lightweight
  // per-domain list records; detail hydrated on demand from /api/<domain>/:id.
  registerSummaryRoutes(app);

  // Citation export routes (/api/citations/*, US-008) — download an entity's
  // sources[] as BibTeX/RIS/CSL-JSON for academic citation.
  registerCitationRoutes(app);

  // Canonical per-entity URL resolver routes (/api/entity/:domain/:id, US-009) —
  // resolve a permanent entity id to its canonical descriptor (name, canonical URL,
  // stable cs: id); backs the /entity/:domain/:id landing page.
  registerEntityResolverRoutes(app);

  // DNA-to-culture ancestry mapping routes (/api/ancestry/*, US-001) — map the Y-DNA
  // haplogroup ids a raw-DNA file was reduced to *in the browser* onto associated
  // languages/cultures/cuisines; raw genotypes never leave the client.
  registerAncestryRoutes(app);

  // Endangered-language dashboard + field-research workflow (/api/languages/preservation,
  // /api/languages/field-update, US-010) — preservation-status aggregation over the corpus,
  // plus attributed, sourced field updates that ride the contribution pipeline and are
  // recorded in the shared changelog. Same `changelog` store as the other pipelines.
  registerLanguagePreservationRoutes(app, { changelog });

  // Collaborative collections routes (/api/collections/*, US-007) — user-curated
  // groups of entities (stable-id references) with soft ownership + URL sharing.
  registerCollectionRoutes(app);

  // User annotations & notes routes (/api/annotations/*, US-008) — free-text notes
  // on entities (stable-id references), private by default with an option to share.
  registerAnnotationRoutes(app);

  // Drawn-geometry authoring routes (/api/map/drawn-geometry, US-001) — polygons
  // & lines drawn on the map land in the contribution review queue with
  // provenance source='user-drawn'; a reviewer promotes them into TSV later.
  registerDrawnGeometryRoutes(app);

  // Timeline-event authoring routes (/api/timeline/event, US-002) — events &
  // period markers authored on the temporal axis land in the contribution
  // review queue with provenance source='user-authored'; a reviewer promotes
  // them into culture-events.tsv later.
  registerTimelineEventRoutes(app);

  // Relationship-builder routes (/api/relationships/edge, US-003) — typed edges
  // authored by dragging one entity onto another land in the contribution
  // review queue with provenance source='user-authored'; a reviewer promotes
  // them into cultural-lineages.tsv later. Duplicate/self edges are rejected.
  registerRelationshipEdgeRoutes(app);

  // Authoring-time suggested-relationship routes (/api/relationships/suggestions,
  // US-010) — when a contributor creates/edits an entity, surface the most
  // likely relationships (ranked by the cross-domain temporal/spatial/linguistic
  // proximity math) with rationale + confidence. Suggestions NEVER auto-create an
  // edge; the contributor confirms one via POST /api/relationships/edge (US-003).
  registerRelationshipSuggestionRoutes(app);

  // URL-paste extractor route (/api/extract/url, US-004) — a pasted Wikipedia/
  // Wikidata URL becomes a structured entity draft (name/coords/dates/relations
  // with per-field confidence) that lands in the contribution review queue
  // flagged aiGenerated/autoDerived; a reviewer promotes it later. Wikidata
  // resolves via the single-entity REST endpoint (no TS SPARQL client).
  registerUrlExtractorRoutes(app);

  // LLM text-extraction route (/api/extract/text, US-008) — a pasted paragraph
  // becomes structured entity/date/relationship drafts (each field with a
  // confidence, flagged AI-generated) that land in the contribution review
  // queue (US-009); never a live write. Uses the existing Gemini client.
  registerTextExtractorRoutes(app);

  // Translation proxy route (/api/translate, US-002) — translates a string via
  // Google Translate using the SERVER-SIDE GOOGLE_TRANSLATE_API_KEY. The key is
  // never shipped to the client (no VITE_-prefixed key); the client calls this
  // proxy. Returns 503 when no key is configured (translation optional).
  registerTranslateRoutes(app);

  // AI-extraction review-queue routes (/api/ai-review, US-009) — a dedicated
  // field-level review workflow for AI-generated drafts (US-004/US-008): a human
  // accepts/edits/rejects each field (low-confidence fields flagged), and an
  // approved draft is promoted into lexicons/*.tsv with provenance recording both
  // the AI source and the human reviewer.
  registerAiReviewRoutes(app, { changelog });

  // culture-scrape Wikidata bulk-acquisition routes (/api/scraping/culturescrape,
  // US-005) — trigger + monitor culture-scrape's Wikidata SPARQL acquisition of
  // civilizations/sites/figures/trade-goods from the scraper dashboard. Bulk
  // SPARQL stays culture-scrape's job (no TS SPARQL client); acquired records
  // land in the contribution review queue with Wikidata provenance. Progress
  // streams via the existing jobStore (GET /api/scraping-jobs).
  registerCultureScrapeAcquisitionRoutes(app);

  // Open Context / tDAR archaeological acquisition routes
  // (/api/scraping/archaeology, US-007) — complement the Pleiades path with two
  // external archaeological authorities. Acquired sites (coordinates, time
  // ranges, associated cultures, provenance) land in the contribution review
  // queue — never a live TSV write. Progress streams via the jobStore.
  registerArchaeologyAcquisitionRoutes(app);


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

  // Word coverage by language (for scraper orchestration dashboard)
  app.get("/api/scraping/coverage", async (_req, res) => {
    try {
      const coverage = await storage.getWordCoverageByLanguage();
      res.json(coverage);
    } catch (error) {
      console.error("Error fetching word coverage:", error);
      res.status(500).json({ message: "Failed to fetch word coverage" });
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

  // Scrape language families from Glottolog
  app.post("/api/scraping/glottolog", async (req, res) => {
    try {
      const { maxFamilies, familyFilter, maxDepth } = req.body;

      const job = jobStore.createJob(
        "glottolog-families",
        100,
        "other"
      );

      glottologScraper
        .scrapeGlottolog({
          maxFamilies,
          familyFilter,
          maxDepth,
          jobId: job.id,
          progressCallback: (type, message, data) => {
            console.log(`[Glottolog Scraping] ${type}: ${message}`, data || "");
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Glottolog scraping completed: ${result.families.length} families, ${result.languages.length} languages, ${result.totalApiCalls} API calls`
          );
        })
        .catch((error) => {
          console.error("Glottolog scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Glottolog scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting Glottolog scraping:", error);
      res.status(500).json({
        message: "Failed to start Glottolog scraping",
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

  // Scrape historical polities/empires from Wikipedia and Seshat
  app.post("/api/scraping/polities", async (req, res) => {
    try {
      const job = jobStore.createJob("polities", SESHAT_POLITIES_COUNT, "wikipedia+seshat");

      polityScraper
        .scrapePolities({
          jobId: job.id,
          progressCallback: (progress) => {
            console.log(`[Polity Scraping] ${progress.type}: ${progress.message}`);
            if (progress.type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: progress.message });
            } else if (progress.type === "error") {
              jobStore.updateJob(job.id, { errorMessage: progress.message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Polity scraping completed: ${result.newPolities} new, ${result.skippedDuplicates} skipped`
          );
        })
        .catch((error) => {
          console.error("Polity scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Polity scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting polity scraping:", error);
      res.status(500).json({
        message: "Failed to start polity scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape battles and military history
  app.post("/api/scraping/battles", async (req, res) => {
    try {
      const { clearExisting, eraFilter } = req.body;

      const job = jobStore.createJob("battles", 4, "gemini");

      battleScraper
        .scrapeBattles({
          clearExisting: clearExisting || false,
          eraFilter: eraFilter || undefined,
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Battle Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(`Battle scraping completed: ${result.length} battles`);
        })
        .catch((error) => {
          console.error("Battle scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Battle scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting battle scraping:", error);
      res.status(500).json({
        message: "Failed to start battle scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape religions and belief systems
  app.post("/api/scraping/religions", async (_req, res) => {
    try {
      const job = jobStore.createJob("religions", 3, "gemini");

      religionScraper
        .scrapeReligions({
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Religion Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(`Religion scraping completed: ${result.religions.length} new religions`);
        })
        .catch((error) => {
          console.error("Religion scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Religion scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting religion scraping:", error);
      res.status(500).json({
        message: "Failed to start religion scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape cuisine and food culture data
  app.post("/api/scraping/cuisines", async (req, res) => {
    try {
      const { cuisineFilter } = req.body;

      const job = jobStore.createJob(
        "cuisines",
        0,
        "gemini"
      );

      cuisineScraper
        .scrapeCuisines({
          cuisineFilter: cuisineFilter || undefined,
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Cuisine Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Cuisine scraping completed: ${result.cuisines} cuisines, ${result.cuisineItems} items`
          );
        })
        .catch((error) => {
          console.error("Cuisine scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Cuisine scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting cuisine scraping:", error);
      res.status(500).json({
        message: "Failed to start cuisine scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape language contact events with Gemini AI
  app.post("/api/scraping/language-contacts", async (req, res) => {
    try {
      const { contactTypes, regions, targetCount } = req.body;

      const job = jobStore.createJob(
        "language-contacts",
        targetCount || 300,
        "gemini"
      );

      languageContactScraper
        .scrapeLanguageContacts({
          contactTypes,
          regions,
          targetCount: targetCount || 300,
          jobId: job.id,
          progressCallback: (type, message, data) => {
            if (type === "error") {
              console.error(`Contact scraping error: ${message}`);
            } else {
              console.log(`Contact scraping: ${message}`);
            }
          },
        })
        .then((result) => {
          console.log(
            `Contact scraping completed: ${result.newEntries} new entries (total: ${result.totalAfter})`
          );
        })
        .catch((error) => {
          console.error("Contact scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Language contact scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting contact scraping:", error);
      res.status(500).json({
        message: "Failed to start language contact scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape trade goods and economic data
  app.post("/api/scraping/trade-goods", async (_req, res) => {
    try {
      const existingGoods = await storage.getTradeGoods();
      const existingRoutes = await storage.getTradeRoutes();

      const job = jobStore.createJob("trade-goods", 2, "gemini");

      tradeGoodsScraper
        .scrapeTradeGoods({
          existingGoods,
          existingRoutes,
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Trade Goods Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Trade goods scraping completed: ${result.goods.length} goods, ${result.routes.length} routes`
          );
        })
        .catch((error) => {
          console.error("Trade goods scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Trade goods scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting trade goods scraping:", error);
      res.status(500).json({
        message: "Failed to start trade goods scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Scrape music traditions and instruments with Gemini AI
  app.post("/api/scraping/music", async (req, res) => {
    try {
      // Get existing IDs to inform the scraper
      const existingTraditions = await storage.getMusicTraditions();
      const existingInstruments = await storage.getMusicalInstruments();

      const job = jobStore.createJob("music-traditions", 3, "gemini");

      musicScraper
        .scrapeMusicTraditionsAndInstruments({
          existingTraditionIds: existingTraditions.map((t: any) => t.id),
          existingInstrumentIds: existingInstruments.map((i: any) => i.id),
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Music Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Music scraping completed: ${result.traditions.length} traditions, ${result.instruments.length} instruments`
          );
        })
        .catch((error) => {
          console.error("Music scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Music traditions and instruments scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting music scraping:", error);
      res.status(500).json({
        message: "Failed to start music scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // === Data Enrichment Endpoints ===

  // Enrich languages with coordinates and temporal data
  app.post("/api/enrichment/languages", async (req, res) => {
    try {
      const { fields } = req.body;
      const validFields = (fields || ['coordinates', 'temporal']).filter(
        (f: string) => f === 'coordinates' || f === 'temporal'
      );

      const languages = await storage.getLanguages();
      if (languages.length === 0) {
        return res.status(400).json({ message: "No languages available to enrich" });
      }

      const job = jobStore.createJob("language-enrichment", languages.length, "gemini");

      // Lazy import to avoid circular deps and only load when needed
      const { languageEnrichmentService } = await import("./services/language-enrichment");

      languageEnrichmentService
        .enrichLanguages({
          languages,
          fields: validFields,
          jobId: job.id,
          progressCallback: (type: string, message: string) => {
            console.log(`[Language Enrichment] ${type}: ${message}`);
            if (type === 'progress') {
              jobStore.updateJob(job.id, { statusMessage: message });
            }
          },
        })
        .then((result: { enriched: number; failed: number }) => {
          storage.invalidateCache('languages');
          console.log(`Language enrichment complete: ${result.enriched} enriched, ${result.failed} failed`);
        })
        .catch((error: unknown) => {
          console.error("Language enrichment failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Language enrichment started",
        status: "pending",
        totalLanguages: languages.length,
        fields: validFields,
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting language enrichment:", error);
      res.status(500).json({ message: "Failed to start language enrichment" });
    }
  });

  // Enrich phonological inventories
  app.post("/api/enrichment/phonology", async (req, res) => {
    try {
      const languages = await storage.getLanguages();
      if (languages.length === 0) {
        return res.status(400).json({ message: "No languages available" });
      }

      const job = jobStore.createJob("phonology-enrichment", languages.length, "gemini");

      const { phonologyEnrichmentService } = await import("./services/phonology-enrichment");

      phonologyEnrichmentService
        .enrichPhonologies({
          languages,
          jobId: job.id,
          progressCallback: (type: string, message: string) => {
            console.log(`[Phonology Enrichment] ${type}: ${message}`);
            if (type === 'progress') {
              jobStore.updateJob(job.id, { statusMessage: message });
            }
          },
        })
        .then((result: { enriched: number; failed: number }) => {
          storage.invalidateCache('phonology');
          console.log(`Phonology enrichment complete: ${result.enriched} enriched, ${result.failed} failed`);
        })
        .catch((error: unknown) => {
          console.error("Phonology enrichment failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Phonology enrichment started",
        status: "pending",
        totalLanguages: languages.length,
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting phonology enrichment:", error);
      res.status(500).json({ message: "Failed to start phonology enrichment" });
    }
  });

  // Enrich grammar features
  app.post("/api/enrichment/grammar", async (req, res) => {
    try {
      const languages = await storage.getLanguages();
      if (languages.length === 0) {
        return res.status(400).json({ message: "No languages available" });
      }

      const job = jobStore.createJob("grammar-enrichment", languages.length, "gemini");

      const { grammarEnrichmentService } = await import("./services/grammar-enrichment");

      grammarEnrichmentService
        .enrichGrammar({
          languages,
          jobId: job.id,
          progressCallback: (type: string, message: string) => {
            console.log(`[Grammar Enrichment] ${type}: ${message}`);
            if (type === 'progress') {
              jobStore.updateJob(job.id, { statusMessage: message });
            }
          },
        })
        .then((result: { enriched: number; failed: number }) => {
          storage.invalidateCache('grammar');
          console.log(`Grammar enrichment complete: ${result.enriched} enriched, ${result.failed} failed`);
        })
        .catch((error: unknown) => {
          console.error("Grammar enrichment failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Grammar enrichment started",
        status: "pending",
        totalLanguages: languages.length,
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting grammar enrichment:", error);
      res.status(500).json({ message: "Failed to start grammar enrichment" });
    }
  });

  // Dataset statistics for the Data Overview page
  // Uses direct file reads to avoid parser failures in storage methods
  app.get("/api/data/stats", async (_req, res) => {
    try {
      const fs = await import("node:fs");
      const nodePath = await import("node:path");
      const lexDir = nodePath.resolve(process.cwd(), "lexicons");

      const countRows = (file: string): number => {
        try {
          const content = fs.readFileSync(nodePath.join(lexDir, file), "utf8");
          const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
          return Math.max(0, lines.length - 1);
        } catch {
          return 0;
        }
      };

      const languageCoverage = () => {
        try {
          const content = fs.readFileSync(nodePath.join(lexDir, "languages.tsv"), "utf8");
          const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
          if (lines.length < 2) return { coordinates: 0, temporal: 0, writingSystem: 0 };
          const header = lines[0].split("\t");
          const latIdx = header.indexOf("latitude");
          const lngIdx = header.indexOf("longitude");
          const originIdx = header.indexOf("originYear");
          const wsIdx = header.indexOf("writingSystem");
          let coords = 0, temporal = 0, ws = 0;
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split("\t");
            if (latIdx >= 0 && lngIdx >= 0 && cols[latIdx]?.trim() && cols[lngIdx]?.trim()) coords++;
            if (originIdx >= 0 && cols[originIdx]?.trim()) temporal++;
            if (wsIdx >= 0 && cols[wsIdx]?.trim()) ws++;
          }
          return { coordinates: coords, temporal, writingSystem: ws };
        } catch {
          return { coordinates: 0, temporal: 0, writingSystem: 0 };
        }
      };

      const tsvFiles: { category: string; name: string; file: string; unit?: string; note?: string }[] = [
        { category: "Linguistics", name: "Language Families", file: "families.tsv" },
        { category: "Linguistics", name: "Languages", file: "languages.tsv" },
        { category: "Linguistics", name: "Base Words (Concepts)", file: "words-base.tsv" },
        { category: "Linguistics", name: "Word Forms", file: "words.tsv", unit: "forms" },
        { category: "Linguistics", name: "Etymology Relations", file: "etymology-relations.tsv" },
        { category: "Linguistics", name: "Sample Texts", file: "sample-texts.tsv" },
        { category: "Linguistics", name: "Phonological Inventories", file: "phonological-inventories.tsv" },
        { category: "Linguistics", name: "Grammar Features", file: "grammar-features.tsv" },
        { category: "Linguistics", name: "Writing Systems", file: "writing-systems.tsv" },
        { category: "Linguistics", name: "Verb Paradigms", file: "verb-paradigms.tsv" },
        { category: "Linguistics", name: "Language Contacts", file: "language-contacts.tsv" },
        { category: "Linguistics", name: "Sound Changes", file: "sound-changes.tsv" },
        { category: "Genetics", name: "Haplogroups", file: "haplogroups.tsv" },
        { category: "Culture", name: "Art Traditions", file: "art-traditions.tsv" },
        { category: "Culture", name: "Architectural Styles", file: "architectural-styles.tsv" },
        { category: "Culture", name: "Literary Traditions", file: "literary-traditions.tsv" },
        { category: "Culture", name: "Literary Works", file: "literary-works.tsv" },
        { category: "Culture", name: "Music Traditions", file: "music-traditions.tsv" },
        { category: "Culture", name: "Musical Instruments", file: "musical-instruments.tsv" },
        { category: "Culture", name: "Dance Traditions", file: "dance-traditions.tsv" },
        { category: "Religion", name: "Religions", file: "religions.tsv" },
        { category: "Religion", name: "Deities", file: "deities.tsv" },
        { category: "Religion", name: "Myth Motifs", file: "myth-motifs.tsv" },
        { category: "History", name: "Archaeological Cultures", file: "archaeological-cultures.tsv" },
        { category: "History", name: "Battles", file: "battles.tsv" },
        { category: "History", name: "Migration Routes", file: "migration-routes.tsv" },
        { category: "History", name: "Trade Goods", file: "trade-goods.tsv" },
        { category: "History", name: "Trade Routes", file: "trade-routes.tsv" },
        { category: "History", name: "Urheimat Hypotheses", file: "urheimat-hypotheses.tsv" },
        { category: "History", name: "Civilizations", file: "civilizations.tsv" },
        { category: "History", name: "Civilization Boundaries", file: "civilization-boundaries.tsv" },
        { category: "Food", name: "Cuisines", file: "cuisines.tsv" },
        { category: "Food", name: "Cuisine Items", file: "cuisine-items.tsv" },
        { category: "Food", name: "Ingredient Origins", file: "ingredient-origins.tsv" },
        { category: "Food", name: "Cooking Techniques", file: "cooking-techniques.tsv" },
        { category: "Food", name: "Foodway Events", file: "foodway-events.tsv" },
        { category: "Culture", name: "Material Culture", file: "material-culture.tsv" },
        { category: "Social", name: "Kinship Systems", file: "kinship-systems.tsv" },
        { category: "Social", name: "Cultural Lineages", file: "cultural-lineages.tsv" },
        { category: "Social", name: "Narratives", file: "narratives.tsv" },
        { category: "Mythology", name: "Deities", file: "deities.tsv" },
        { category: "Mythology", name: "Myth Motifs", file: "myth-motifs.tsv" },
        { category: "Geography", name: "Language Ranges", file: "language-ranges.tsv" },
        { category: "Geography", name: "Range Polygons", file: "language-range-polygons.tsv" },
      ];

      // Deduplicate by file name (deities/myth-motifs appear in both Religion and Mythology)
      const seen = new Set<string>();
      const uniqueFiles = tsvFiles.filter((f) => {
        const key = `${f.category}:${f.file}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const datasets = uniqueFiles.map((entry) => {
        const count = countRows(entry.file);
        const result: Record<string, unknown> = {
          category: entry.category,
          name: entry.name,
          count,
          file: entry.file,
        };
        if (entry.unit) result.unit = entry.unit;
        if (entry.note) result.note = entry.note;
        if (entry.name === "Languages") {
          result.coverage = languageCoverage();
        }
        return result;
      });

      res.json({ datasets });
    } catch (error) {
      console.error("Error getting data stats:", error);
      res.status(500).json({ message: "Failed to get data stats" });
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

  // Scrape grammar features from WALS and Grambank
  app.post("/api/scraping/grammar-wals-grambank", async (req, res) => {
    try {
      const { sources, languageIds } = req.body;

      const job = jobStore.createJob(
        "grammar-wals-grambank",
        0,
        "wals-grambank"
      );

      // Start scraping in the background
      grammarWalsGrambankScraper
        .scrape({
          sources: sources || ["wals", "grambank"],
          languageIds: languageIds || undefined,
          jobId: job.id,
          progressCallback: (progress) => {
            console.log(`[Grammar WALS/Grambank] ${progress.type}: ${progress.message}`);
            if (progress.type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: progress.message });
            } else if (progress.type === "error") {
              jobStore.updateJob(job.id, { errorMessage: progress.message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Grammar WALS/Grambank scraping completed: ${result.totalFeatures} features for ${result.languagesMatched} languages`
          );
        })
        .catch((error) => {
          console.error("Grammar WALS/Grambank scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Grammar WALS/Grambank scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting grammar WALS/Grambank scraping:", error);
      res.status(500).json({
        message: "Failed to start grammar WALS/Grambank scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
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

      const allFeatures = await storage.getLanguageRanges(filters);
      const { features, meta } = applyViewport(allFeatures, viewportOptionsFromQuery(req.query));

      res.json({
        type: "FeatureCollection",
        features,
        metadata: { ...filters, ...meta },
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

      const allFeatures = await storage.getLanguageRangePolygons(filters);
      const { features, meta } = applyViewport(allFeatures, viewportOptionsFromQuery(req.query));

      res.json({
        type: "FeatureCollection",
        features,
        metadata: { ...filters, ...meta },
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

      const allFeatures = await storage.getArchaeologicalSites(filters);
      const { features, meta } = applyViewport(allFeatures, viewportOptionsFromQuery(req.query));

      res.json({
        type: "FeatureCollection",
        features,
        metadata: { ...filters, ...meta },
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

      const allFeatures = await storage.getCivilizations(filters);
      const { features, meta } = applyViewport(allFeatures, viewportOptionsFromQuery(req.query));

      res.json({
        type: "FeatureCollection",
        features,
        metadata: { ...filters, ...meta },
      });
    } catch (error) {
      console.error("Error fetching civilizations:", error);
      res.status(500).json({
        message: "Failed to fetch civilizations",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Resolve a region name to a precise GeoJSON boundary
  app.get("/api/map/boundaries/resolve", async (req, res) => {
    try {
      const { name, simplify } = req.query;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "name query parameter is required" });
      }

      const resolver = await getDefaultBoundaryResolver();
      const tolerance = simplify ? parseFloat(simplify as string) : undefined;
      const boundary = resolver.resolve(name, tolerance);

      if (!boundary) {
        return res.status(404).json({ message: `No boundary found for "${name}"` });
      }

      res.json({
        id: boundary.id,
        name: boundary.name,
        source: boundary.source,
        geometry: boundary.geometry,
      });
    } catch (error) {
      console.error("Error resolving boundary:", error);
      res.status(500).json({
        message: "Failed to resolve boundary",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Resolve multiple feature geometries with precise boundaries
  app.post("/api/map/boundaries/resolve-features", async (req, res) => {
    try {
      const { features, regionNameKey } = req.body;
      if (!Array.isArray(features)) {
        return res.status(400).json({ message: "features array is required in request body" });
      }

      const resolver = await getDefaultBoundaryResolver();
      const resolved = resolver.resolveFeatures(features, regionNameKey ?? "name");

      res.json({
        type: "FeatureCollection",
        features: resolved,
      });
    } catch (error) {
      console.error("Error resolving feature boundaries:", error);
      res.status(500).json({
        message: "Failed to resolve feature boundaries",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Search available boundaries
  app.get("/api/map/boundaries/search", async (req, res) => {
    try {
      const { q, limit } = req.query;
      const resolver = await getDefaultBoundaryResolver();

      if (q && typeof q === "string") {
        const results = resolver.search(q, limit ? parseInt(limit as string) : 10);
        res.json({
          results: results.map((b) => ({
            id: b.id,
            name: b.name,
            source: b.source,
          })),
        });
      } else {
        const names = resolver.listBoundaryNames();
        res.json({ boundaries: names, total: resolver.size });
      }
    } catch (error) {
      console.error("Error searching boundaries:", error);
      res.status(500).json({
        message: "Failed to search boundaries",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/map/places/search?q=query&limit=15 - Search places (local + Nominatim)
   */
  app.get("/api/map/places/search", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      if (!q || !q.trim()) {
        res.json({ results: [], query: "" });
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 15;
      const result = await searchPlacesWithNominatim(q, limit);
      res.json(result);
    } catch (error) {
      console.error("Error in place search:", error);
      res.status(500).json({
        message: "Failed to search places",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/map/places/autocomplete?q=query&limit=8 - Fast autocomplete (local only)
   */
  app.get("/api/map/places/autocomplete", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      if (!q || q.trim().length < 2) {
        res.json([]);
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;
      const results = await autocompletePlaces(q, limit);
      res.json(results);
    } catch (error) {
      console.error("Error in place autocomplete:", error);
      res.status(500).json({
        message: "Failed to autocomplete places",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/map/places/resolve?q=query&limit=10 - Resolve a place to canonical
   * records (name, lat/lng, geonames_id). Prefers GeoNames for standardized
   * naming and falls back to Nominatim; results carry provenance.
   */
  app.get("/api/map/places/resolve", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      if (!q || !q.trim()) {
        res.json({ results: [], query: "", source: null });
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const result = await resolvePlace(q, limit);
      res.json(result);
    } catch (error) {
      console.error("Error resolving place:", error);
      res.status(500).json({
        message: "Failed to resolve place",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get empires timeline
  app.get("/api/map/empires-timeline", async (req, res) => {
    try {
      const { timeStart, timeEnd, empireId, phase } = req.query;

      const filters = {
        timeStart: timeStart ? parseInt(timeStart as string) : undefined,
        timeEnd: timeEnd ? parseInt(timeEnd as string) : undefined,
        empireId: empireId as string | undefined,
        phase: phase as string | undefined,
      };

      const features = await storage.getEmpiresTimeline(filters);

      res.json({
        type: "FeatureCollection",
        features,
        metadata: filters,
      });
    } catch (error) {
      console.error("Error fetching empires timeline:", error);
      res.status(500).json({
        message: "Failed to fetch empires timeline",
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
        languageFamily: languageFamilyId,
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

  app.post("/api/scraping/mythology", async (req, res) => {
    try {
      const { pantheons } = req.body;

      const job = jobStore.createJob(
        "mythology",
        100,
        "gemini"
      );

      mythologyScraperTSV
        .scrapeMythology({
          pantheons: pantheons || undefined,
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Mythology Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Mythology scraping completed: ${result.deities.length} deities, ${result.motifs.length} motifs`
          );
        })
        .catch((error) => {
          console.error("Mythology scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Mythology scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting mythology scraping:", error);
      res.status(500).json({
        message: "Failed to start mythology scraping",
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
  const { correlateWithGraphFallback } = await import(
    "./services/cross-domain-correlation-graph"
  );
  const correlation = new CrossDomainCorrelation(storage);

  /**
   * POST /api/cross-domain/correlate - Compute correlations between two domains.
   * When CORRELATION_GRAPH_ENABLED is set and the domains exist in the shared
   * graph, this is served from Neo4j (US-007); otherwise (and if the graph is
   * unreachable) it degrades to the in-memory TSV path. The `source` field
   * reports which path answered.
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

      const { result, source } = await correlateWithGraphFallback(
        domainA,
        domainB,
        relationshipType,
        () => correlation.queryCorrelation(domainA, domainB, relationshipType),
      );
      res.json({ ...result, source });
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
  // Cross-Domain Timeline Routes
  // ============================================================================

  const { CrossDomainTimeline: CrossDomainTimelineService } = await import("./services/cross-domain-timeline");
  const crossDomainTimeline = new CrossDomainTimelineService(storage);

  /**
   * GET /api/cross-domain/timeline - Get unified timeline events from multiple datasets
   */
  app.get("/api/cross-domain/timeline", async (req, res) => {
    try {
      const domains = req.query.domains
        ? (req.query.domains as string).split(",")
        : undefined;
      const yearStart = req.query.yearStart
        ? parseInt(req.query.yearStart as string, 10)
        : undefined;
      const yearEnd = req.query.yearEnd
        ? parseInt(req.query.yearEnd as string, 10)
        : undefined;

      const result = await crossDomainTimeline.getTimeline({
        domains: domains as any,
        yearStart,
        yearEnd,
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching cross-domain timeline:", error);
      res.status(500).json({
        message: "Failed to fetch cross-domain timeline",
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
  // Contribution API Routes (Phase 5; hardened public API US-011)
  // ============================================================================
  // Write endpoints (POST /api/contributions, PATCH .../:id/review) are guarded
  // by API-key auth + per-key rate limiting; read endpoints stay open. The
  // OpenAPI spec is published at GET /api/openapi.json. See routes/contributions.ts.
  registerContributionRoutes(app, { changelog });

  // ============================================================================
  // Data versioning & changelog (US-010)
  // ============================================================================
  // A browsable, filterable audit log of dataset changes. The contribution +
  // ai-review pipelines record approved edits into the shared `changelog` store
  // above; GET /api/changelog[/stats] exposes it filterable by domain + date.
  registerChangelogRoutes(app, { changelog });

  // ============================================================================
  // Versioned dataset releases + public dataset API (US-011)
  // ============================================================================
  // Citable, versioned snapshots of the whole open corpus (semver derived from
  // the shared changelog, optional Zenodo DOI) + a full-dataset download endpoint.
  // GET/POST /api/dataset/release and GET /api/dataset/full; documented in the
  // OpenAPI spec. Default nullDoiMinter keeps DOI minting off without a token.
  registerDatasetReleaseRoutes(app, {
    changelog,
    doiMinter: createZenodoDoiMinter(),
  });

  // ============================================================================
  // Living dataset: discovery ingestion & DOI snapshots (US-011, speculative)
  // ============================================================================
  // The lifecycle layer that keeps the corpus current + citable: a scheduled
  // discovery-ingestion pass (culture-scrape bulk acquisition → review queue),
  // an annual versioned-release cadence (reuses the snapshot builder + DOI minter),
  // and a freshness/versioning status feed. GET /api/living-dataset/status,
  // POST /api/living-dataset/{ingest,release}. See routes/living-dataset.ts.
  registerLivingDatasetRoutes(app, {
    changelog,
    doiMinter: createZenodoDoiMinter(),
  });

  // ============================================================================
  // Community verification & culture stewardship (US-012)
  // ============================================================================
  // Multi-confirmation (N distinct reviewers verify a contribution before it
  // goes live; a domain steward lowers the bar) + an "adopt a culture" ownership
  // model. See routes/community-verification.ts.
  registerCommunityVerificationRoutes(app);

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
   * POST /api/scrape/wiktionary-phonology - Scrape phonological inventories from Wiktionary
   */
  app.post("/api/scrape/wiktionary-phonology", async (req, res) => {
    try {
      const { languageIds } = req.body;
      let languages = await storage.getLanguages();

      if (languageIds && Array.isArray(languageIds) && languageIds.length > 0) {
        languages = languages.filter((l: any) => languageIds.includes(l.id));
      }

      if (languages.length === 0) {
        return res.status(400).json({ message: "No languages available" });
      }

      const job = jobStore.createJob("wiktionary-phonology", languages.length, "wiktionary");

      const { wiktionaryPhonologyScraper } = await import("./services/wiktionary-phonology-scraper");

      wiktionaryPhonologyScraper
        .scrapePhonologies({
          languages,
          jobId: job.id,
          progressCallback: (type: string, message: string) => {
            console.log(`[Wiktionary Phonology] ${type}: ${message}`);
          },
        })
        .then((result: { scraped: number; failed: number; skipped: number }) => {
          storage.invalidateCache("phonology");
          console.log(
            `Wiktionary phonology scraping complete: ${result.scraped} scraped, ${result.failed} failed, ${result.skipped} skipped`
          );
        })
        .catch((error: unknown) => {
          console.error("Wiktionary phonology scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Wiktionary phonology scraping started",
        status: "pending",
        totalLanguages: languages.length,
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting Wiktionary phonology scraping:", error);
      res.status(500).json({ message: "Failed to start Wiktionary phonology scraping" });
    }
  });

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
   * POST /api/scraping/writing-systems - Scrape writing systems from Unicode CLDR + Gemini
   */
  app.post("/api/scraping/writing-systems", async (req, res) => {
    try {
      const job = jobStore.createJob("writing-systems", 100, "cldr+gemini");

      writingSystemScraper
        .scrapeWritingSystems({
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[Writing System Scraping] ${type}: ${message}`);
            if (type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: message });
            } else if (type === "error") {
              jobStore.updateJob(job.id, { errorMessage: message });
            }
          },
        })
        .then((systems) => {
          console.log(`Writing system scraping completed: ${systems.length} total systems`);
        })
        .catch((error) => {
          console.error("Writing system scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Writing system scraping started",
        status: "pending",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Error starting writing system scraping:", error);
      res.status(500).json({
        message: "Failed to start writing system scraping",
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
   * POST /api/verb-paradigms/scrape - Scrape verb paradigms from UniMorph and Wiktionary
   */
  app.post("/api/verb-paradigms/scrape", async (req, res) => {
    try {
      const { languageIds, verbs, sources } = req.body as {
        languageIds?: string[];
        verbs?: string[];
        sources?: Array<"unimorph" | "wiktionary">;
      };

      if (!languageIds || !Array.isArray(languageIds) || languageIds.length === 0) {
        res.status(400).json({ message: "languageIds array is required" });
        return;
      }

      const { verbParadigmScraper } = await import("./services/verb-paradigm-scraper");

      const entries = await verbParadigmScraper.scrapeVerbParadigms({
        languageIds,
        verbs,
        sources,
      });

      const written = await verbParadigmScraper.writeParadigms(entries);

      // Invalidate cache so next read picks up new data
      (storage as any).cachedVerbParadigms = null;

      res.json({
        message: `Scraped and wrote ${written} new verb paradigm entries`,
        count: written,
        entries: entries.map((e) => ({
          languageId: e.languageId,
          verbConcept: e.verbConcept,
          infinitiveForm: e.infinitiveForm,
          source: e.source,
        })),
      });
    } catch (error) {
      console.error("Error scraping verb paradigms:", error);
      res.status(500).json({
        message: "Failed to scrape verb paradigms",
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
   * POST /api/scraping/sound-changes - Scrape sound change rules from historical linguistics sources
   */
  app.post("/api/scraping/sound-changes", async (req, res) => {
    try {
      const { familyIds } = req.body;

      const job = jobStore.createJob("sound-changes", familyIds?.length ?? 12, "gemini");

      res.json({
        message: "Sound change scraping started",
        jobId: job.id,
      });

      soundChangeScraper
        .scrapeSoundChanges({
          familyIds: familyIds || undefined,
          jobId: job.id,
          progressCallback: (progress) => {
            console.log(`[Sound Changes] ${progress.message}`);
          },
        })
        .then((result) => {
          console.log(
            `Sound change scraping completed: ${result.newChanges} new changes (${result.totalScraped} total)`,
          );
        })
        .catch((error) => {
          console.error("Sound change scraping failed:", error);
        });
    } catch (error) {
      console.error("Error starting sound change scraping:", error);
      res.status(500).json({
        message: "Failed to start sound change scraping",
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
   * GET /api/art-style-evolutions - Get style evolution connections
   */
  app.get("/api/art-style-evolutions", async (req, res) => {
    try {
      const traditionId = req.query.tradition_id as string | undefined;
      const transitionType = req.query.transition_type as string | undefined;
      const evolutions = await storage.getStyleEvolutions({ traditionId, transitionType });
      res.json({ evolutions, count: evolutions.length });
    } catch (error) {
      console.error("Error fetching style evolutions:", error);
      res.status(500).json({
        message: "Failed to fetch style evolutions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/scrape/art-traditions - Scrape art traditions with style evolution tracking
   */
  app.post("/api/scrape/art-traditions", async (req, res) => {
    try {
      const { categories, regions, clearExisting } = req.body || {};

      const job = jobStore.createJob("art-traditions", 0, "gemini");

      res.json({ jobId: job.id, message: "Art tradition scraping started" });

      artTraditionScraper
        .scrapeArtTraditions({
          categories,
          regions,
          clearExisting,
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[art-scraper] ${type}: ${message}`);
          },
        })
        .then(() => {
          storage.invalidateArtTraditionsCache();
        })
        .catch((err) => {
          console.error("Art tradition scraping failed:", err);
        });
    } catch (error) {
      console.error("Error starting art tradition scraping:", error);
      res.status(500).json({
        message: "Failed to start art tradition scraping",
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
   * GET /api/architectural-styles/by-building-type/:buildingTypeId - Get styles by building type
   */
  app.get("/api/architectural-styles/by-building-type/:buildingTypeId", async (req, res) => {
    try {
      const styles = await storage.getArchitecturalStylesByBuildingType(req.params.buildingTypeId);
      res.json({ styles, count: styles.length });
    } catch (error) {
      console.error("Error fetching architectural styles by building type:", error);
      res.status(500).json({
        message: "Failed to fetch architectural styles by building type",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/architectural-styles/scrape - Scrape additional architectural styles using Gemini
   */
  app.post("/api/architectural-styles/scrape", async (req, res) => {
    try {
      const job = jobStore.createJob("architectural-styles", 30, "gemini");
      res.json({ message: "Architectural styles scraping started", jobId: job.id });

      architecturalStylesScraper.scrapeArchitecturalStyles({
        jobId: job.id,
        progressCallback: (type, message) => {
          console.log(`[architectural-styles-scraper] ${type}: ${message}`);
        },
      }).catch((error) => {
        console.error("Architectural styles scraping failed:", error);
      });
    } catch (error) {
      console.error("Error starting architectural styles scraper:", error);
      res.status(500).json({
        message: "Failed to start architectural styles scraper",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/building-types - Get all building types with optional category filter
   */
  app.get("/api/building-types", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const types = await storage.getBuildingTypes({ category });
      res.json({ buildingTypes: types, count: types.length });
    } catch (error) {
      console.error("Error fetching building types:", error);
      res.status(500).json({
        message: "Failed to fetch building types",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/building-types/categories - Get building type categories
   */
  app.get("/api/building-types/categories", async (_req, res) => {
    try {
      const categories = architecturalStylesScraper.getBuildingCategories();
      res.json({ categories, count: categories.length });
    } catch (error) {
      console.error("Error fetching building type categories:", error);
      res.status(500).json({
        message: "Failed to fetch building type categories",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/building-types/:id - Get a single building type
   */
  app.get("/api/building-types/:id", async (req, res) => {
    try {
      const buildingType = await storage.getBuildingTypeById(req.params.id);
      if (!buildingType) {
        return res.status(404).json({ message: "Building type not found" });
      }
      res.json(buildingType);
    } catch (error) {
      console.error("Error fetching building type:", error);
      res.status(500).json({
        message: "Failed to fetch building type",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/city-layouts - Get all city layouts with optional filtering
   */
  app.get("/api/city-layouts", async (req, res) => {
    try {
      const cultureProfileId = req.query.culture_profile_id as string | undefined;
      const layoutType = req.query.layout_type as string | undefined;
      const layouts = await storage.getCityLayouts({ cultureProfileId, layoutType });
      res.json({ layouts, count: layouts.length });
    } catch (error) {
      console.error("Error fetching city layouts:", error);
      res.status(500).json({
        message: "Failed to fetch city layouts",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/city-layouts/:id - Get a single city layout
   */
  app.get("/api/city-layouts/:id", async (req, res) => {
    try {
      const layout = await storage.getCityLayoutById(req.params.id);
      if (!layout) {
        return res.status(404).json({ message: "City layout not found" });
      }
      res.json(layout);
    } catch (error) {
      console.error("Error fetching city layout:", error);
      res.status(500).json({
        message: "Failed to fetch city layout",
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
      const cultures = await storage.getArchaeologicalCultures({ region, languageId: language, timeStart, timeEnd });
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
  // Innovations Endpoints
  // ============================================================================

  /**
   * GET /api/innovations - Get all innovations with optional filtering
   */
  app.get("/api/innovations", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const cultureProfileId = req.query.culture_profile_id as string | undefined;
      const innovations = await storage.getInnovations({ category, cultureProfileId });
      res.json({ innovations, count: innovations.length });
    } catch (error) {
      console.error("Error fetching innovations:", error);
      res.status(500).json({
        message: "Failed to fetch innovations",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/innovations/:id - Get a single innovation
   */
  app.get("/api/innovations/:id", async (req, res) => {
    try {
      const innovation = await storage.getInnovationById(req.params.id);
      if (!innovation) {
        return res.status(404).json({ message: "Innovation not found" });
      }
      res.json(innovation);
    } catch (error) {
      console.error("Error fetching innovation:", error);
      res.status(500).json({
        message: "Failed to fetch innovation",
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
   * GET /api/search?q=query - Unified (federated) search across all data domains.
   * Merges local corpus results with shared-graph hits, degrading to local-only
   * when the graph is unavailable (see federatedSearch).
   */
  app.get("/api/search", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      if (!q || !q.trim()) {
        res.json({ results: [], query: "", totalCount: 0 });
        return;
      }
      // `types` / `sources` (comma-separated) narrow results by facet.
      const filters = parseSearchFilters(req.query);
      const result = await federatedSearch(q, filters);
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

  /**
   * GET /api/visualizations/cuisine-sankey - Build Sankey diagram for cuisine connections via shared food types
   */
  app.get("/api/visualizations/cuisine-sankey", async (req, res) => {
    try {
      const cuisines = await storage.getCuisines({});
      const items = await storage.getCuisineItems({});

      // Build nodes from cuisines
      const nodes = cuisines.map((c) => ({
        id: c.id,
        name: c.name,
        group: c.region,
      }));

      const cuisineIds = new Set(cuisines.map((c) => c.id));

      // Group items by food type to find cross-cuisine connections
      const itemsByFoodType = new Map<string, string[]>();
      for (const item of items) {
        if (!cuisineIds.has(item.cuisineId)) continue;
        const ft = item.foodType;
        if (!itemsByFoodType.has(ft)) itemsByFoodType.set(ft, []);
        itemsByFoodType.get(ft)!.push(item.cuisineId);
      }

      // Build links between cuisines sharing food types
      const linkMap = new Map<string, { source: string; target: string; value: number; contactType: string; timePeriod: string }>();

      for (const [foodType, cuisineList] of itemsByFoodType) {
        const unique = [...new Set(cuisineList)];
        for (let i = 0; i < unique.length; i++) {
          for (let j = i + 1; j < unique.length; j++) {
            const [a, b] = [unique[i], unique[j]].sort();
            const key = `${a}->${b}`;
            if (!linkMap.has(key)) {
              linkMap.set(key, {
                source: a,
                target: b,
                value: 1,
                contactType: "shared_food_type",
                timePeriod: foodType,
              });
            } else {
              linkMap.get(key)!.value++;
            }
          }
        }
      }

      // Also connect cuisines in the same region
      const cuisinesByRegion = new Map<string, typeof cuisines>();
      for (const c of cuisines) {
        if (!cuisinesByRegion.has(c.region)) cuisinesByRegion.set(c.region, []);
        cuisinesByRegion.get(c.region)!.push(c);
      }

      for (const [region, regionCuisines] of cuisinesByRegion) {
        for (let i = 0; i < regionCuisines.length; i++) {
          for (let j = i + 1; j < regionCuisines.length; j++) {
            const [a, b] = [regionCuisines[i].id, regionCuisines[j].id].sort();
            const key = `${a}->${b}`;
            if (!linkMap.has(key)) {
              linkMap.set(key, {
                source: a,
                target: b,
                value: 1,
                contactType: "regional",
                timePeriod: region,
              });
            }
          }
        }
      }

      const links = Array.from(linkMap.values());
      res.json({ nodes, links });
    } catch (error) {
      console.error("Error building cuisine sankey data:", error);
      res.status(500).json({ message: "Failed to build cuisine sankey visualization data" });
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
    }
  });

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
      const hypothesis = await storage.getUrheimatHypothesis(req.params.id);
      if (!hypothesis) {
        return res.status(404).json({ message: "Urheimat hypothesis not found" });
      }
      res.json(hypothesis);
    } catch (error) {
      console.error("Error fetching urheimat hypothesis:", error);
      res.status(500).json({ message: "Failed to fetch urheimat hypothesis" });
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
   * GET /api/social-organization - Get all social organization entries with optional filtering
   */
  app.get("/api/social-organization", async (req, res) => {
    try {
      const politicalStructure = req.query.political_structure as string | undefined;
      const descentSystem = req.query.descent_system as string | undefined;
      const subsistencePattern = req.query.subsistence_pattern as string | undefined;
      const region = req.query.region as string | undefined;
      const orgs = await storage.getSocialOrganization({ politicalStructure, descentSystem, subsistencePattern, region });
      res.json({ organizations: orgs, count: orgs.length });
    } catch (error) {
      console.error("Error fetching social organization:", error);
      res.status(500).json({
        message: "Failed to fetch social organization data",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/social-organization/:id - Get a single social organization entry
   */
  app.get("/api/social-organization/:id", async (req, res) => {
    try {
      const org = await storage.getSocialOrganizationById(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Social organization entry not found" });
      }
      res.json(org);
    } catch (error) {
      console.error("Error fetching social organization:", error);
      res.status(500).json({
        message: "Failed to fetch social organization entry",
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

  // Data Freshness Tracking
  app.get("/api/data-freshness", async (req, res) => {
    try {
      const freshDays = req.query.freshDays ? Number(req.query.freshDays) : undefined;
      const agingDays = req.query.agingDays ? Number(req.query.agingDays) : undefined;
      const thresholds = freshDays || agingDays
        ? { freshDays: freshDays ?? 7, agingDays: agingDays ?? 30 }
        : undefined;
      const lexiconsDir = path.resolve(process.cwd(), "lexicons");
      const summary = getFreshnessSummary(lexiconsDir, new Date(), thresholds);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching data freshness:", error);
      res.status(500).json({ message: "Failed to fetch data freshness" });
    }
  });

  /**
   * GET /api/data-quality - Get data quality report for all TSV files
   */
  app.get("/api/data-quality", async (_req, res) => {
    try {
      const report = generateDataQualityReport();
      res.json(report);
    } catch (error) {
      console.error("Error generating data quality report:", error);
      res.status(500).json({ message: "Failed to generate data quality report" });
    }
  });

  /**
   * GET /api/export/datasets - List available dataset profiles for export
   */
  app.get("/api/export/datasets", async (_req, res) => {
    try {
      const profiles = getDatasetProfiles();
      res.json(profiles);
    } catch (error) {
      console.error("Error listing export datasets:", error);
      res.status(500).json({ message: "Failed to list export datasets" });
    }
  });

  /**
   * GET /api/export/datasets/:id - Get a specific dataset profile
   */
  app.get("/api/export/datasets/:id", async (req, res) => {
    try {
      const profile = getDatasetProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ message: "Dataset not found" });
      }
      res.json(profile);
    } catch (error) {
      console.error("Error fetching export dataset:", error);
      res.status(500).json({ message: "Failed to fetch export dataset" });
    }
  });

  /**
   * POST /api/export - Export a dataset in the specified format
   */
  app.post("/api/export", async (req, res) => {
    try {
      const { dataset, format, filters, includeFiles } = req.body;

      const errors = validateExportOptions({ dataset, format: format as ExportFormat, filters, includeFiles });
      if (errors.length > 0) {
        return res.status(400).json({ message: "Invalid export options", errors });
      }

      const result = await exportDataset({ dataset, format: format as ExportFormat, filters, includeFiles });
      res.json(result);
    } catch (error) {
      console.error("Error exporting dataset:", error);
      res.status(500).json({
        message: "Failed to export dataset",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/export/download/:dataset/:format - Download a single-file export
   */
  app.get("/api/export/download/:dataset/:format", async (req, res) => {
    try {
      const { dataset, format } = req.params;
      const filters: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (key !== "includeFiles" && typeof value === "string") {
          filters[key] = value;
        }
      }

      const includeFiles = typeof req.query.includeFiles === "string"
        ? req.query.includeFiles.split(",")
        : undefined;

      const errors = validateExportOptions({ dataset, format: format as ExportFormat, filters, includeFiles });
      if (errors.length > 0) {
        return res.status(400).json({ message: "Invalid export options", errors });
      }

      const result = await exportDataset({ dataset, format: format as ExportFormat, filters, includeFiles });

      if (result.files.length === 0) {
        return res.status(404).json({ message: "No data to export" });
      }

      // For single-file downloads, return the first file directly
      const file = result.files[0];
      const contentType = format === "json" ? "application/json" : "text/csv";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
      res.send(file.content);
    } catch (error) {
      console.error("Error downloading export:", error);
      res.status(500).json({
        message: "Failed to download export",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ============================================================================
  // Batch Enrichment Endpoints
  // ============================================================================

  /**
   * GET /api/enrichment/analyze - Analyze TSV files for under-population
   */
  app.get("/api/enrichment/analyze", async (req, res) => {
    try {
      const threshold = parseInt(req.query.threshold as string) || 100;
      const analysis = analyzeTsvFiles(threshold);
      res.json({
        files: analysis,
        totalUnderPopulated: analysis.length,
        threshold,
      });
    } catch (error) {
      console.error("Error analyzing TSV files:", error);
      res.status(500).json({ message: "Failed to analyze TSV files" });
    }
  });

  // Under-represented family vocabulary scraping

  /**
   * GET /api/scraping/underrepresented-families - List under-represented families and their scraping strategies
   */
  app.get("/api/scraping/underrepresented-families", async (_req, res) => {
    try {
      const familiesRaw = await storage.getLanguageFamilies();
      const languagesRaw = await storage.getLanguages();

      const familiesData = familiesRaw.map((f: any) => ({
        id: f.id,
        name: f.name,
        parent_id: f.parentId ?? "",
        description: f.description ?? "",
        taxonomic_level: f.taxonomicLevel ?? "",
      }));

      const languagesData = languagesRaw.map((l: any) => ({
        id: l.id,
        name: l.name,
        family_id: l.familyId,
        status: l.status ?? "living",
      }));

      const families = identifyUnderrepresentedFamilies(familiesData, languagesData);

      res.json({
        count: families.length,
        totalLanguages: families.reduce((sum, f) => sum + f.languages.length, 0),
        families: families.map((f) => ({
          familyId: f.familyId,
          familyName: f.familyName,
          languageCount: f.languages.length,
          strategyType: f.strategy.familyType,
          languages: f.languages,
        })),
      });
    } catch (error) {
      console.error("Error listing underrepresented families:", error);
      res.status(500).json({ message: "Failed to list underrepresented families" });
    }
  });

  /**
   * POST /api/enrichment/culture-profiles - Enrich culture profile supporting TSVs
   * Generates daily-life, social-structures, and city-layouts entries for the
   * specified culture profiles using Gemini AI. Returns the job record; clients
   * can poll GET /api/enrichment/culture-profiles/jobs/:id for progress.
   */
  app.post("/api/enrichment/culture-profiles", async (req, res) => {
    try {
      const { profileIds, domains, entriesPerDomain } = req.body ?? {};

      const validDomains: EnrichmentDomain[] = ["daily-life", "social-structures", "city-layouts"];
      let requestedDomains: EnrichmentDomain[] | undefined;
      if (Array.isArray(domains)) {
        requestedDomains = domains.filter((d): d is EnrichmentDomain =>
          validDomains.includes(d as EnrichmentDomain)
        );
        if (requestedDomains.length === 0) {
          return res.status(400).json({
            message: `domains must contain at least one of: ${validDomains.join(", ")}`,
          });
        }
      }

      let requestedProfileIds: string[] | undefined;
      if (Array.isArray(profileIds)) {
        requestedProfileIds = profileIds.filter((id): id is string => typeof id === "string" && id.length > 0);
      }

      const entriesCount =
        typeof entriesPerDomain === "number" && entriesPerDomain > 0 && entriesPerDomain <= 25
          ? entriesPerDomain
          : undefined;

      const job = await runCultureProfileEnrichment({
        profileIds: requestedProfileIds,
        domains: requestedDomains,
        entriesPerDomain: entriesCount,
        onProgress: (msg) => console.log(`[Culture Enrichment] ${msg}`),
      });

      storage.invalidateCache("all");
      res.json(job);
    } catch (error) {
      console.error("Error running culture profile enrichment:", error);
      res.status(500).json({ message: "Failed to run culture profile enrichment" });
    }
  });

  /**
   * GET /api/enrichment/culture-profiles/jobs - List culture enrichment jobs
   */
  app.get("/api/enrichment/culture-profiles/jobs", async (_req, res) => {
    try {
      res.json(getAllCultureEnrichmentJobs());
    } catch (error) {
      console.error("Error fetching culture enrichment jobs:", error);
      res.status(500).json({ message: "Failed to fetch culture enrichment jobs" });
    }
  });

  /**
   * GET /api/enrichment/culture-profiles/jobs/:id - Get a single job's status
   */
  app.get("/api/enrichment/culture-profiles/jobs/:id", async (req, res) => {
    try {
      const job = getCultureEnrichmentJob(req.params.id);
      if (!job) {
        return res.status(404).json({ message: "Culture enrichment job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error("Error fetching culture enrichment job:", error);
      res.status(500).json({ message: "Failed to fetch culture enrichment job" });
    }
  });

  /**
   * POST /api/enrichment/batch - Start batch enrichment for under-populated TSVs
   */
  app.post("/api/enrichment/batch", async (req, res) => {
    try {
      const { targetFiles, maxRowThreshold, batchesPerFile } = req.body;

      const job = await runBatchEnrichment({
        targetFiles,
        maxRowThreshold: maxRowThreshold || 50,
        batchesPerFile: batchesPerFile || 4,
        onProgress: (msg) => console.log(`[Batch Enrichment] ${msg}`),
      });

      res.json(job);
    } catch (error) {
      console.error("Error starting batch enrichment:", error);
      res.status(500).json({ message: "Failed to start batch enrichment" });
    }
  });

  // ── Settlements endpoints ──────────────────────────────────

  /**
   * GET /api/settlements - List settlements with optional filters
   */
  app.get("/api/settlements", async (req, res) => {
    try {
      const civilizationId = req.query.civilization_id as string | undefined;
      const cultureId = req.query.culture_id as string | undefined;
      const type = req.query.type as string | undefined;
      const region = req.query.region as string | undefined;
      const timeStart = req.query.time_start ? parseInt(req.query.time_start as string, 10) : undefined;
      const timeEnd = req.query.time_end ? parseInt(req.query.time_end as string, 10) : undefined;

      let boundingBox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined;
      if (req.query.min_lat && req.query.max_lat && req.query.min_lng && req.query.max_lng) {
        boundingBox = {
          minLat: parseFloat(req.query.min_lat as string),
          maxLat: parseFloat(req.query.max_lat as string),
          minLng: parseFloat(req.query.min_lng as string),
          maxLng: parseFloat(req.query.max_lng as string),
        };
      }

      const settlements = await storage.getSettlements({
        civilizationId, cultureId, type, timeStart, timeEnd, region, boundingBox,
      });

      res.json({ settlements, count: settlements.length });
    } catch (error) {
      console.error("Error fetching settlements:", error);
      res.status(500).json({ message: "Failed to fetch settlements" });
    }
  });

  /**
   * GET /api/enrichment/jobs - List all enrichment jobs
   */
  app.get("/api/enrichment/jobs", async (_req, res) => {
    try {
      res.json(getAllEnrichmentJobs());
    } catch (error) {
      console.error("Error fetching enrichment jobs:", error);
      res.status(500).json({ message: "Failed to fetch enrichment jobs" });
    }
  });

  /**
   * GET /api/settlements/by-civilization/:civilizationId - Get settlements by civilization
   */
  app.get("/api/settlements/by-civilization/:civilizationId", async (req, res) => {
    try {
      const settlements = await storage.getSettlementsByCivilization(req.params.civilizationId);
      res.json({ settlements, count: settlements.length });
    } catch (error) {
      console.error("Error fetching settlements by civilization:", error);
      res.status(500).json({ message: "Failed to fetch settlements by civilization" });
    }
  });

  /**
   * GET /api/enrichment/jobs/:id - Get enrichment job status
   */
  app.get("/api/enrichment/jobs/:id", async (req, res) => {
    try {
      const job = getEnrichmentJob(req.params.id);
      if (!job) {
        return res.status(404).json({ message: "Enrichment job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error("Error fetching enrichment job:", error);
      res.status(500).json({ message: "Failed to fetch enrichment job" });
    }
  });

  /**
   * GET /api/settlements/nearby/:lat/:lng - Find settlements near coordinates
   */
  app.get("/api/settlements/nearby/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 100;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }

      const settlements = await storage.getSettlementsNearby(lat, lng, radius);
      res.json({ settlements, count: settlements.length, center: { lat, lng }, radiusKm: radius });
    } catch (error) {
      console.error("Error fetching nearby settlements:", error);
      res.status(500).json({ message: "Failed to fetch nearby settlements" });
    }
  });

  /**
   * GET /api/city-layouts - List city layouts with optional filters
   */
  app.get("/api/city-layouts", async (req, res) => {
    try {
      const cultureProfileId = req.query.culture_profile_id as string | undefined;
      const settlementId = req.query.settlement_id as string | undefined;
      const layoutType = req.query.layout_type as string | undefined;

      const layouts = await storage.getCityLayouts({ cultureProfileId, settlementId, layoutType });
      res.json({ layouts, count: layouts.length });
    } catch (error) {
      console.error("Error fetching city layouts:", error);
      res.status(500).json({ message: "Failed to fetch city layouts" });
    }
  });

  /**
   * GET /api/city-layouts/:id - Get a single city layout
   */
  app.get("/api/city-layouts/:id", async (req, res) => {
    try {
      const layout = await storage.getCityLayoutById(req.params.id);
      if (!layout) {
        res.status(404).json({ message: `City layout '${req.params.id}' not found` });
        return;
      }
      res.json(layout);
    } catch (error) {
      console.error("Error fetching city layout:", error);
      res.status(500).json({ message: "Failed to fetch city layout" });
    }
  });

  /**
   * GET /api/social-structures - List social structures with optional filters
   */
  app.get("/api/social-structures", async (req, res) => {
    try {
      const cultureProfileId = req.query.culture_profile_id as string | undefined;
      const structureType = req.query.structure_type as string | undefined;

      const structures = await storage.getSocialStructures({ cultureProfileId, structureType });
      res.json({ structures, count: structures.length });
    } catch (error) {
      console.error("Error fetching social structures:", error);
      res.status(500).json({ message: "Failed to fetch social structures" });
    }
  });

  /**
   * GET /api/social-structures/:id - Get a single social structure
   */
  app.get("/api/social-structures/:id", async (req, res) => {
    try {
      const structure = await storage.getSocialStructureById(req.params.id);
      if (!structure) {
        res.status(404).json({ message: `Social structure '${req.params.id}' not found` });
        return;
      }
      res.json(structure);
    } catch (error) {
      console.error("Error fetching social structure:", error);
      res.status(500).json({ message: "Failed to fetch social structure" });
    }
  });

  /**
   * GET /api/culture-profiles/:id/city-layouts - Get city layouts for a culture profile
   */
  app.get("/api/culture-profiles/:id/city-layouts", async (req, res) => {
    try {
      const layouts = await storage.getCityLayouts({ cultureProfileId: req.params.id });
      res.json({ layouts, count: layouts.length });
    } catch (error) {
      console.error("Error fetching city layouts for culture profile:", error);
      res.status(500).json({ message: "Failed to fetch city layouts for culture profile" });
    }
  });

  /**
   * GET /api/culture-profiles/:id/social-structures - Get social structures for a culture profile
   */
  app.get("/api/culture-profiles/:id/social-structures", async (req, res) => {
    try {
      const structures = await storage.getSocialStructures({ cultureProfileId: req.params.id });
      res.json({ structures, count: structures.length });
    } catch (error) {
      console.error("Error fetching social structures for culture profile:", error);
      res.status(500).json({ message: "Failed to fetch social structures for culture profile" });
    }
  });

  /**
   * POST /api/scrape-ethnographic - Trigger ethnographic data scraping
   */
  app.post("/api/scrape-ethnographic", async (req, res) => {
    try {
      const { type } = req.body as { type?: "kinship" | "social-organization" | "both" };
      const scrapeType = type || "both";

      const job = jobStore.createJob("ethnographic", 0, "gemini");
      res.json({ jobId: job.id, message: `Started ethnographic scraping (${scrapeType})` });

      const progressCallback = (progressType: string, message: string) => {
        console.log(`[ethnographic-scrape] ${progressType}: ${message}`);
      };

      if (scrapeType === "kinship" || scrapeType === "both") {
        await ethnographicScraper.scrapeKinshipSystems({ jobId: job.id, progressCallback });
      }
      if (scrapeType === "social-organization" || scrapeType === "both") {
        await ethnographicScraper.scrapeSocialOrganization({ jobId: job.id, progressCallback });
      }
    } catch (error) {
      console.error("Error in ethnographic scraping:", error);
    }
  });

  /**
   * GET /api/empires-timeline - List empire timeline events with optional filters
   */
  app.get("/api/empires-timeline", async (req, res) => {
    try {
      const empireId = req.query.empire_id as string | undefined;
      const eventType = req.query.event_type as string | undefined;
      const yearStart = req.query.year_start ? parseInt(req.query.year_start as string, 10) : undefined;
      const yearEnd = req.query.year_end ? parseInt(req.query.year_end as string, 10) : undefined;

      const events = await storage.getEmpireTimeline({ empireId, eventType, yearStart, yearEnd });
      res.json({ events, count: events.length });
    } catch (error) {
      console.error("Error fetching empire timeline:", error);
      res.status(500).json({ message: "Failed to fetch empire timeline" });
    }
  });

  /**
   * GET /api/empires-timeline/:id - Get a single empire timeline event
   */
  app.get("/api/empires-timeline/:id", async (req, res) => {
    try {
      const event = await storage.getEmpireTimelineEventById(req.params.id);
      if (!event) {
        return res.status(404).json({ message: "Empire timeline event not found" });
      }
      res.json(event);
    } catch (error) {
      console.error("Error fetching empire timeline event:", error);
      res.status(500).json({ message: "Failed to fetch empire timeline event" });
    }
  });

  /**
   * GET /api/settlements/:id - Get a single settlement
   */
  app.get("/api/settlements/:id", async (req, res) => {
    try {
      const settlement = await storage.getSettlementById(req.params.id);
      if (!settlement) {
        return res.status(404).json({ message: "Settlement not found" });
      }
      res.json(settlement);
    } catch (error) {
      console.error("Error fetching settlement:", error);
      res.status(500).json({ message: "Failed to fetch settlement" });
    }
  });

  // ── Rivers & Water Features endpoints ──────────────────────

  /**
   * GET /api/rivers-and-waters - List rivers and water features with optional filters
   */
  app.get("/api/rivers-and-waters", async (req, res) => {
    try {
      const waterType = req.query.water_type as string | undefined;
      const region = req.query.region as string | undefined;
      const historicalImportance = req.query.historical_importance as string | undefined;
      const timeStart = req.query.time_start ? parseInt(req.query.time_start as string, 10) : undefined;
      const timeEnd = req.query.time_end ? parseInt(req.query.time_end as string, 10) : undefined;

      const features = await storage.getRiversAndWaters({
        waterType, region, historicalImportance, timeStart, timeEnd,
      });

      res.json({ features, count: features.length });
    } catch (error) {
      console.error("Error fetching rivers and waters:", error);
      res.status(500).json({ message: "Failed to fetch rivers and water features" });
    }
  });

  /**
   * GET /api/rivers-and-waters/:id - Get a single river/water feature
   */
  app.get("/api/rivers-and-waters/:id", async (req, res) => {
    try {
      const feature = await storage.getRiverWaterById(req.params.id);
      if (!feature) {
        return res.status(404).json({ message: "River/water feature not found" });
      }
      res.json(feature);
    } catch (error) {
      console.error("Error fetching river/water feature:", error);
      res.status(500).json({ message: "Failed to fetch river/water feature" });
    }
  });

  // ── Daily Life endpoints ──────────────────────

  /**
   * GET /api/daily-life - List daily life entries with optional filters
   */
  app.get("/api/daily-life", async (req, res) => {
    try {
      const cultureProfileId = req.query.culture_profile_id as string | undefined;
      const category = req.query.category as string | undefined;
      const socialClass = req.query.social_class as string | undefined;
      const genderContext = req.query.gender_context as string | undefined;

      const entries = await storage.getDailyLife({
        cultureProfileId, category, socialClass, genderContext,
      });

      res.json({ entries, count: entries.length });
    } catch (error) {
      console.error("Error fetching daily life entries:", error);
      res.status(500).json({ message: "Failed to fetch daily life entries" });
    }
  });

  /**
   * GET /api/daily-life/:id - Get a single daily life entry
   */
  app.get("/api/daily-life/:id", async (req, res) => {
    try {
      const entry = await storage.getDailyLifeById(req.params.id);
      if (!entry) {
        return res.status(404).json({ message: "Daily life entry not found" });
      }
      res.json(entry);
    } catch (error) {
      console.error("Error fetching daily life entry:", error);
      res.status(500).json({ message: "Failed to fetch daily life entry" });
    }
  });

  /**
   * GET /api/culture-profiles/:id/daily-life - Get daily life entries grouped by category for a culture
   */
  app.get("/api/culture-profiles/:id/daily-life", async (req, res) => {
    try {
      const grouped = await storage.getDailyLifeByCulture(req.params.id);
      res.json({ cultureProfileId: req.params.id, categories: grouped });
    } catch (error) {
      console.error("Error fetching daily life by culture:", error);
      res.status(500).json({ message: "Failed to fetch daily life entries for culture" });
    }
  });

  /**
   * POST /api/scraping/underrepresented-vocab - Scrape vocabulary for under-represented families
   * Body: { familyId?, languageId?, maxLanguages? }
   */
  app.post("/api/scraping/underrepresented-vocab", async (req, res) => {
    try {
      const { familyId, languageId, maxLanguages } = req.body;

      const familiesRaw = await storage.getLanguageFamilies();
      const languagesRaw = await storage.getLanguages();

      const familiesData = familiesRaw.map((f: any) => ({
        id: f.id,
        name: f.name,
        parent_id: f.parentId ?? "",
        description: f.description ?? "",
        taxonomic_level: f.taxonomicLevel ?? "",
      }));

      const languagesData = languagesRaw.map((l: any) => ({
        id: l.id,
        name: l.name,
        family_id: l.familyId,
        status: l.status ?? "living",
      }));

      const families = identifyUnderrepresentedFamilies(familiesData, languagesData);

      if (families.length === 0) {
        return res.status(404).json({ message: "No under-represented families found" });
      }

      const job = jobStore.createJob(
        familyId || languageId || "underrepresented",
        families.reduce((sum, f) => sum + f.languages.length, 0) * 75,
        "gemini"
      );

      underrepresentedVocabScraper
        .scrape(families, {
          familyId,
          languageId,
          maxLanguages: maxLanguages || 10,
          jobId: job.id,
          progressCallback: (progress) => {
            console.log(`[Underrepresented Vocab] ${progress.type}: ${progress.message}`);
            if (progress.type === "progress") {
              jobStore.updateJob(job.id, { statusMessage: progress.message });
            }
          },
        })
        .then((result) => {
          console.log(
            `Underrepresented vocab scraping completed: ${result.languagesProcessed} languages, ${result.totalWordsScraped} words`
          );
        })
        .catch((error) => {
          console.error("Underrepresented vocab scraping failed:", error);
          jobStore.updateJob(job.id, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date().toISOString(),
          });
        });

      res.json({
        message: "Under-represented vocabulary scraping started",
        jobId: job.id,
        targetFamilies: familyId ? 1 : families.length,
      });
    } catch (error) {
      console.error("Error starting underrepresented vocab scraping:", error);
      res.status(500).json({ message: "Failed to start underrepresented vocab scraping" });
    }
  });

  /**
   * POST /api/map/analyze-image - Extract features from a georeferenced map image using AI
   */
  app.post("/api/map/analyze-image", async (req, res) => {
    try {
      const { imageBase64, mimeType, bounds, featureTypes } = req.body as FeatureExtractionRequest;

      if (!imageBase64 || !mimeType || !bounds) {
        return res.status(400).json({
          message: "Missing required fields: imageBase64, mimeType, bounds",
        });
      }

      if (!Array.isArray(bounds) || bounds.length !== 2) {
        return res.status(400).json({ message: "bounds must be [[south, west], [north, east]]" });
      }

      const result = await analyzeMapImage({ imageBase64, mimeType, bounds, featureTypes });
      res.json(result);
    } catch (error) {
      console.error("Error analyzing map image:", error);
      const message = error instanceof Error ? error.message : "Failed to analyze map image";
      res.status(500).json({ message });
    }
  });

  // ── Culture Profiles ─────────────────────────────────────────

  /**
   * GET /api/culture-profiles - List culture profiles with filters
   */
  app.get("/api/culture-profiles", async (req, res) => {
    try {
      const region = req.query.region as string | undefined;
      const civilizationId = req.query.civilization_id as string | undefined;
      const subsistenceType = req.query.subsistence_type as string | undefined;
      const urbanismLevel = req.query.urbanism_level as string | undefined;
      const socialOrganization = req.query.social_organization as string | undefined;
      const technologyLevel = req.query.technology_level as string | undefined;
      const timeStart = req.query.time_start ? parseInt(req.query.time_start as string, 10) : undefined;
      const timeEnd = req.query.time_end ? parseInt(req.query.time_end as string, 10) : undefined;

      const profiles = await storage.getCultureProfiles({
        region, civilizationId, subsistenceType, urbanismLevel,
        socialOrganization, technologyLevel, timeStart, timeEnd,
      });

      res.json({ profiles, count: profiles.length });
    } catch (error) {
      console.error("Error fetching culture profiles:", error);
      res.status(500).json({ message: "Failed to fetch culture profiles" });
    }
  });

  // ── Media Assets ──────────────────────────────────────────────────

  const mediaAssetService = new MediaAssetService(
    path.resolve(import.meta.dirname, "..", "lexicons")
  );

  /**
   * GET /api/media-assets - Get all media assets with optional filtering
   */
  app.get("/api/media-assets", async (req, res) => {
    try {
      const entityType = req.query.entity_type as string | undefined;
      const entityId = req.query.entity_id as string | undefined;
      const mediaType = req.query.media_type as string | undefined;
      const tag = req.query.tag as string | undefined;
      const assets = await storage.getMediaAssets({ entityType, entityId, mediaType, tag });
      res.json({ assets, count: assets.length });
    } catch (error) {
      console.error("Error fetching media assets:", error);
      res.status(500).json({
        message: "Failed to fetch media assets",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/culture-profiles/by-civilization/:civilizationId - Get profiles by civilization
   */
  app.get("/api/culture-profiles/by-civilization/:civilizationId", async (req, res) => {
    try {
      const profiles = await storage.getCultureProfilesByCivilization(req.params.civilizationId);
      res.json({ profiles, count: profiles.length });
    } catch (error) {
      console.error("Error fetching culture profiles by civilization:", error);
      res.status(500).json({ message: "Failed to fetch culture profiles by civilization" });
    }
  });

  /**
   * GET /api/culture-profiles/by-location/:lat/:lng - Find profiles near coordinates
   */
  app.get("/api/culture-profiles/by-location/:lat/:lng", async (req, res) => {
    try {
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 500;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }

      const profiles = await storage.getCultureProfilesByLocation(lat, lng, radius);
      res.json({ profiles, count: profiles.length });
    } catch (error) {
      console.error("Error fetching culture profiles by location:", error);
      res.status(500).json({ message: "Failed to fetch culture profiles by location" });
    }
  });

  /**
   * GET /api/media-assets/:id - Get a single media asset
   */
  app.get("/api/media-assets/:id", async (req, res) => {
    try {
      const asset = await storage.getMediaAssetById(req.params.id);
      if (!asset) {
        return res.status(404).json({ message: "Media asset not found" });
      }
      res.json(asset);
    } catch (error) {
      console.error("Error fetching media asset:", error);
      res.status(500).json({
        message: "Failed to fetch media asset",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/culture-profiles/:id - Get a single culture profile by ID
   */
  app.get("/api/culture-profiles/:id", async (req, res) => {
    try {
      const profile = await storage.getCultureProfileById(req.params.id);
      if (!profile) {
        return res.status(404).json({ message: "Culture profile not found" });
      }
      res.json(profile);
    } catch (error) {
      console.error("Error fetching culture profile:", error);
      res.status(500).json({ message: "Failed to fetch culture profile" });
    }
  });

  /**
   * GET /api/culture-profiles/:id/evolution-events - Timeline events for a culture
   */
  app.get("/api/culture-profiles/:id/evolution-events", async (req, res) => {
    try {
      const events = await storage.getCultureEventsByCulture(req.params.id);
      res.json({ cultureProfileId: req.params.id, events, count: events.length });
    } catch (error) {
      console.error("Error fetching culture evolution events:", error);
      res.status(500).json({ message: "Failed to fetch culture evolution events" });
    }
  });

  /**
   * GET /api/media-assets/entity/:entityType/:entityId - Get media for a specific entity
   */
  app.get("/api/media-assets/entity/:entityType/:entityId", async (req, res) => {
    try {
      const assets = await storage.getMediaAssetsForEntity(
        req.params.entityType,
        req.params.entityId
      );
      res.json({ assets, count: assets.length });
    } catch (error) {
      console.error("Error fetching entity media assets:", error);
      res.status(500).json({
        message: "Failed to fetch entity media assets",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/culture-profiles/:id/socio-cultural - Get profile with resolved references
   */
  app.get("/api/culture-profiles/:id/socio-cultural", async (req, res) => {
    try {
      const result = await storage.getCultureProfileSocioCultural(req.params.id);
      if (!result) {
        return res.status(404).json({ message: "Culture profile not found" });
      }
      res.json(result);
    } catch (error) {
      console.error("Error fetching socio-cultural data:", error);
      res.status(500).json({ message: "Failed to fetch socio-cultural data" });
    }
  });

  /**
   * POST /api/media-assets - Add a new media asset
   */
  app.post("/api/media-assets", async (req, res) => {
    try {
      const errors = mediaAssetService.validate(req.body);
      if (errors.length > 0) {
        return res.status(400).json({ errors });
      }
      const asset = await mediaAssetService.addAsset(req.body);
      storage.invalidateCache("media");
      res.status(201).json(asset);
    } catch (error) {
      console.error("Error adding media asset:", error);
      res.status(500).json({
        message: "Failed to add media asset",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /api/media-assets/:id - Delete a media asset
   */
  app.delete("/api/media-assets/:id", async (req, res) => {
    try {
      const deleted = await mediaAssetService.deleteAsset(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Media asset not found" });
      }
      storage.invalidateCache("media");
      res.json({ message: "Media asset deleted" });
    } catch (error) {
      console.error("Error deleting media asset:", error);
      res.status(500).json({
        message: "Failed to delete media asset",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/media-assets/meta/types - Get valid entity types and media types
   */
  app.get("/api/media-assets/meta/types", (_req, res) => {
    res.json({
      entityTypes: mediaAssetService.getValidEntityTypes(),
      mediaTypes: mediaAssetService.getValidMediaTypes(),
    });
  });

  // ── Wikimedia Commons ─────────────────────────────────────────

  /**
   * POST /api/scrape/wikimedia-commons - Scrape cultural images from Wikimedia Commons
   */
  app.post("/api/scrape/wikimedia-commons", async (req, res) => {
    try {
      const { categories, maxPerCategory } = req.body || {};
      const job = jobStore.createJob("wikimedia-commons", 0, "wikimedia-api");
      res.json({ jobId: job.id, message: "Wikimedia Commons image scraping started" });
      wikimediaCommonsScraper
        .scrapeImages({
          categories,
          maxPerCategory,
          jobId: job.id,
          progressCallback: (type, message) => {
            console.log(`[wikimedia-commons] ${type}: ${message}`);
          },
        })
        .catch((err) => {
          console.error("Wikimedia Commons scraping failed:", err);
        });
    } catch (error) {
      console.error("Error starting Wikimedia Commons scraping:", error);
      res.status(500).json({
        message: "Failed to start Wikimedia Commons scraping",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/wikimedia-commons-images - Get scraped Wikimedia Commons images
   */
  app.get("/api/wikimedia-commons-images", async (req, res) => {
    try {
      const culture = req.query.culture as string | undefined;
      const artifactType = req.query.artifact_type as string | undefined;
      const region = req.query.region as string | undefined;

      const filePath = path.resolve("lexicons/wikimedia-commons-images.tsv");
      if (!fs.existsSync(filePath)) {
        return res.json({ images: [], count: 0 });
      }

      const content = await fs.promises.readFile(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      if (lines.length <= 1) {
        return res.json({ images: [], count: 0 });
      }

      const headers = lines[0].split("\t");
      const getIdx = (name: string) => headers.indexOf(name);

      let images = lines.slice(1).map((line) => {
        const cols = line.split("\t");
        return {
          id: cols[getIdx("id")] || "",
          title: cols[getIdx("title")] || "",
          description: cols[getIdx("description")] || "",
          imageUrl: cols[getIdx("image_url")] || "",
          thumbUrl: cols[getIdx("thumb_url")] || "",
          artist: cols[getIdx("artist")] || "",
          license: cols[getIdx("license")] || "",
          categories: (() => { try { return JSON.parse(cols[getIdx("categories")] || "[]"); } catch { return []; } })(),
          coordinates: (() => { try { const v = cols[getIdx("coordinates")]; return v ? JSON.parse(v) : null; } catch { return null; } })(),
          dateCreated: cols[getIdx("date_created")] || "",
          associatedCulture: cols[getIdx("associated_culture")] || "",
          associatedLanguageIds: (() => { try { return JSON.parse(cols[getIdx("associated_language_ids")] || "[]"); } catch { return []; } })(),
          artifactType: cols[getIdx("artifact_type")] || "",
          region: cols[getIdx("region")] || "",
          source: cols[getIdx("source")] || "",
        };
      });

      if (culture) {
        images = images.filter((img) =>
          img.associatedCulture.toLowerCase().includes(culture.toLowerCase())
        );
      }
      if (artifactType) {
        images = images.filter((img) =>
          img.artifactType.toLowerCase() === artifactType.toLowerCase()
        );
      }
      if (region) {
        images = images.filter((img) =>
          img.region.toLowerCase().includes(region.toLowerCase())
        );
      }

      res.json({ images, count: images.length });
    } catch (error) {
      console.error("Error fetching Wikimedia Commons images:", error);
      res.status(500).json({
        message: "Failed to fetch Wikimedia Commons images",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ── GenAI Image Generation ────────────────────────────────────

  /**
   * POST /api/media/generate - Generate a historical reconstruction image using GenAI
   */
  app.post("/api/media/generate", async (req, res) => {
    try {
      const { entityType, entityId, sceneType, style, description, timePeriod, region } = req.body;

      if (!entityType || !entityId || !sceneType || !style || !description) {
        return res.status(400).json({
          message: "Missing required fields: entityType, entityId, sceneType, style, description",
        });
      }

      if (!validateSceneType(sceneType)) {
        return res.status(400).json({
          message: "Invalid sceneType. Must be one of: city_reconstruction, architectural, daily_life, artifact",
        });
      }

      if (!validateStyle(style)) {
        return res.status(400).json({
          message: "Invalid style. Must be one of: realistic, illustrated, watercolor, archaeological_sketch",
        });
      }

      const result = await generateReconstructionImage({
        entityType,
        entityId,
        sceneType,
        style,
        description,
        timePeriod,
        region,
      });

      res.json(result);
    } catch (error) {
      console.error("Error generating reconstruction image:", error);
      const message = error instanceof Error ? error.message : "Failed to generate image";
      res.status(500).json({ message });
    }
  });

  /**
   * GET /api/media/prompts - Get all stored generation prompts
   */
  app.get("/api/media/prompts", async (_req, res) => {
    try {
      const prompts = readPromptRecords();
      res.json({ prompts, count: prompts.length });
    } catch (error) {
      console.error("Error reading prompt records:", error);
      const message = error instanceof Error ? error.message : "Failed to read prompts";
      res.status(500).json({ message });
    }
  });

  return server;
}
