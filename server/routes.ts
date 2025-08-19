import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { linguisticService } from "./services/linguistic-apis";
import { insertLanguageFamilySchema, insertLanguageSchema, insertBaseWordSchema, insertWordTranslationSchema, insertScrapingJobSchema } from "@shared/schema";
import { z } from "zod";

// WebSocket connection manager
class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log('Client connected to WebSocket');
      
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('Client disconnected from WebSocket');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Send initial status
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Connected to scraping progress updates'
      }));
    });
  }

  broadcast(data: any) {
    const message = JSON.stringify(data);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  broadcastProgress(jobId: string, progress: {
    status: string;
    completed: number;
    total: number;
    currentWord?: string;
    percentage?: number;
    errorMessage?: string;
  }) {
    this.broadcast({
      type: 'scraping_progress',
      jobId,
      ...progress
    });
  }

  broadcastJobUpdate(job: any) {
    this.broadcast({
      type: 'job_update',
      job
    });
  }
}

export const wsManager = new WebSocketManager();

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);
  
  // Initialize WebSocket manager
  wsManager.initialize(server);
  
  // Language Families
  app.get("/api/language-families", async (req, res) => {
    try {
      const families = await storage.getLanguageFamilies();
      res.json(families);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch language families" });
    }
  });

  app.get("/api/language-families/tree", async (req, res) => {
    try {
      const tree = await storage.getLanguageFamilyTree();
      res.json(tree);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch language family tree" });
    }
  });

  app.post("/api/language-families", async (req, res) => {
    try {
      const validatedData = insertLanguageFamilySchema.parse(req.body);
      const family = await storage.createLanguageFamily(validatedData);
      res.status(201).json(family);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create language family" });
      }
    }
  });

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

  app.post("/api/languages", async (req, res) => {
    try {
      const validatedData = insertLanguageSchema.parse(req.body);
      const language = await storage.createLanguage(validatedData);
      res.status(201).json(language);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create language" });
      }
    }
  });

  // Base Words
  app.get("/api/base-words", async (req, res) => {
    try {
      const words = await storage.getBaseWords();
      res.json(words);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch base words" });
    }
  });

  // Get word comparisons across multiple languages
  app.get('/api/word-comparisons', async (req, res) => {
    const languageIds = Array.isArray(req.query.languages) 
      ? req.query.languages as string[]
      : typeof req.query.languages === 'string' 
        ? [req.query.languages]
        : [];

    if (languageIds.length < 2) {
      return res.status(400).json({ error: 'At least 2 language IDs required' });
    }

    try {
      const comparisons = await storage.getWordComparisons(languageIds);
      res.json(comparisons);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get word comparisons' });
    }
  });

  app.post("/api/base-words", async (req, res) => {
    try {
      const validatedData = insertBaseWordSchema.parse(req.body);
      const word = await storage.createBaseWord(validatedData);
      res.status(201).json(word);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create base word" });
      }
    }
  });

  app.put("/api/base-words", async (req, res) => {
    try {
      const wordsSchema = z.array(insertBaseWordSchema);
      const validatedData = wordsSchema.parse(req.body);
      await storage.updateBaseWords(validatedData);
      res.json({ message: "Base words updated successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update base words" });
      }
    }
  });

  // Word Translations
  app.get("/api/languages/:languageId/translations", async (req, res) => {
    try {
      const translations = await storage.getWordTranslations(req.params.languageId);
      res.json(translations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch word translations" });
    }
  });

  app.post("/api/word-translations", async (req, res) => {
    try {
      const validatedData = insertWordTranslationSchema.parse(req.body);
      const translation = await storage.createWordTranslation(validatedData);
      res.status(201).json(translation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create word translation" });
      }
    }
  });

  // Scraping Jobs
  app.get("/api/scraping-jobs", async (req, res) => {
    try {
      const jobs = await storage.getScrapingJobs();
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch scraping jobs" });
    }
  });

  app.post("/api/scraping-jobs", async (req, res) => {
    try {
      const validatedData = insertScrapingJobSchema.parse(req.body);
      
      // Check if there's already an active job for this language
      const existingJob = await storage.getActiveScrapingJob(validatedData.languageId);
      if (existingJob) {
        return res.status(409).json({ message: "Scraping job already active for this language" });
      }

      const job = await storage.createScrapingJob({
        ...validatedData,
        status: 'pending',
        totalWords: (await storage.getBaseWords()).length,
        completedWords: 0,
        failedWords: 0,
      });
      
      // Broadcast job creation to WebSocket clients
      wsManager.broadcastJobUpdate(job);
      
      // Start scraping process (in a real app, this would be a background job)
      startScrapingProcess(job.id);
      
      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create scraping job" });
      }
    }
  });

  // Word Comparisons
  app.get("/api/word-comparisons", async (req, res) => {
    try {
      const { languages } = req.query;
      if (!languages) {
        return res.status(400).json({ message: "Language IDs are required" });
      }
      
      const languageIds = Array.isArray(languages) ? languages as string[] : [languages as string];
      const comparisons = await storage.getWordComparisons(languageIds);
      res.json(comparisons);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch word comparisons" });
    }
  });

  // Statistics
  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await storage.getLanguageStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Linguistic API status and testing endpoints
  app.get("/api/linguistic-services/status", async (req, res) => {
    try {
      const status = linguisticService.getServiceStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch linguistic service status" });
    }
  });

  // Language Family Tree Scraping endpoint
  app.post("/api/scrape-language-families", async (req, res) => {
    try {
      console.log("Starting language family tree scraping...");
      await storage.scrapeLanguageFamilyTree();
      res.json({ 
        success: true, 
        message: "Language family tree scraping completed successfully" 
      });
    } catch (error) {
      console.error("Error during language family tree scraping:", error);
      res.status(500).json({ 
        error: "Failed to scrape language family tree", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Database Normalization endpoint
  app.post("/api/normalize-database", async (req, res) => {
    try {
      console.log("Starting database normalization...");
      await storage.normalizeDatabase();
      res.json({ 
        success: true, 
        message: "Database normalization completed successfully" 
      });
    } catch (error) {
      console.error("Error during database normalization:", error);
      res.status(500).json({ 
        error: "Failed to normalize database", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Taxonomic structure endpoints
  app.get("/api/phylums", async (req, res) => {
    try {
      const phylums = await storage.getPhylums();
      res.json(phylums);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phylums" });
    }
  });

  app.get("/api/families/:phylumId?", async (req, res) => {
    try {
      const { phylumId } = req.params;
      const families = await storage.getFamilies(phylumId);
      res.json(families);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch families" });
    }
  });

  app.get("/api/main-languages", async (req, res) => {
    try {
      const languages = await storage.getMainLanguages();
      res.json(languages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch main languages" });
    }
  });

  app.get("/api/historical-variants/:mainLanguageId", async (req, res) => {
    try {
      const { mainLanguageId } = req.params;
      const variants = await storage.getHistoricalVariants(mainLanguageId);
      res.json(variants);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch historical variants" });
    }
  });

  app.get("/api/modern-dialects/:mainLanguageId", async (req, res) => {
    try {
      const { mainLanguageId } = req.params;
      const dialects = await storage.getModernDialects(mainLanguageId);
      res.json(dialects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch modern dialects" });
    }
  });

  // Etymology and Historical Word Migration endpoints
  app.post("/api/generate-etymology-data", async (req, res) => {
    try {
      console.log("Starting etymology data generation...");
      await storage.generateEtymologyData();
      res.json({ 
        success: true, 
        message: "Etymology data generation completed successfully" 
      });
    } catch (error) {
      console.error("Error generating etymology data:", error);
      res.status(500).json({ 
        error: "Failed to generate etymology data", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Expand base vocabulary
  app.post("/api/expand-base-vocabulary", async (req, res) => {
    try {
      console.log("Starting base vocabulary expansion...");
      await storage.expandBaseVocabulary();
      res.json({ 
        success: true, 
        message: "Base vocabulary expansion completed successfully" 
      });
    } catch (error) {
      console.error("Error expanding base vocabulary:", error);
      res.status(500).json({ 
        error: "Failed to expand base vocabulary", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.get("/api/etymology/:baseWordId", async (req, res) => {
    try {
      const { baseWordId } = req.params;
      const etymology = await storage.getEtymologyByWord(baseWordId);
      res.json(etymology);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch etymology" });
    }
  });

  app.get("/api/word-migrations/:etymologyId", async (req, res) => {
    try {
      const { etymologyId } = req.params;
      const migrations = await storage.getWordMigrations(etymologyId);
      res.json(migrations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch word migrations" });
    }
  });

  app.get("/api/cognates/:baseWordId", async (req, res) => {
    try {
      const { baseWordId } = req.params;
      const cognates = await storage.getCognates(baseWordId);
      res.json(cognates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cognates" });
    }
  });

  app.get("/api/phonetic-evolution/:baseWordId", async (req, res) => {
    try {
      const { baseWordId } = req.params;
      const evolution = await storage.getPhoneticEvolution(baseWordId);
      res.json(evolution);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch phonetic evolution" });
    }
  });

  app.get("/api/semantic-shifts/:baseWordId", async (req, res) => {
    try {
      const { baseWordId } = req.params;
      const shifts = await storage.getSemanticShifts(baseWordId);
      res.json(shifts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch semantic shifts" });
    }
  });

  app.get("/api/search-etymologies", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query required" });
      }
      const results = await storage.searchEtymologies(q);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to search etymologies" });
    }
  });

  app.get("/api/etymological-network/:networkId", async (req, res) => {
    try {
      const { networkId } = req.params;
      const network = await storage.getEtymologicalNetwork(networkId);
      res.json(network);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch etymological network" });
    }
  });

  app.post("/api/linguistic-services/test", async (req, res) => {
    try {
      const { word, fromLang = 'en', toLang = 'de' } = req.body;
      
      if (!word) {
        return res.status(400).json({ error: "Word parameter is required" });
      }

      const result = await linguisticService.getTranslation(word, fromLang, toLang);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Translation test failed", details: error.message });
    }
  });

  // Mock scraping process with real-time progress tracking
  async function startScrapingProcess(jobId: string) {
    try {
      const updatedJob = await storage.updateScrapingJob(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      // Broadcast job started
      wsManager.broadcastJobUpdate(updatedJob);
      wsManager.broadcastProgress(jobId, {
        status: 'running',
        completed: 0,
        total: updatedJob.totalWords || 0,
        percentage: 0
      });

      const baseWords = await storage.getBaseWords();
      const language = await storage.getLanguage(updatedJob.languageId);
      
      if (!language) return;

      let completedCount = 0;
      let failedCount = 0;

      // Simulate scraping with delays and real-time updates
      for (let i = 0; i < baseWords.length; i++) {
        const baseWord = baseWords[i];
        
        // Broadcast current word being processed
        wsManager.broadcastProgress(jobId, {
          status: 'running',
          completed: completedCount,
          total: baseWords.length,
          currentWord: baseWord.word,
          percentage: Math.round((completedCount / baseWords.length) * 100)
        });
        
        // Simulate API call delay (realistic scraping time)
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 300));
        
        // Simulate success/failure (90% success rate)
        const success = Math.random() > 0.1;
        
        if (success) {
          // Use professional linguistic API for authentic translation
          const linguisticResult = await linguisticService.getTranslation(
            baseWord.word, 
            'en', // Base language
            language.iso639_1 || language.iso639_2 || 'en'
          );

          let translationData;
          if (linguisticResult.success && linguisticResult.data) {
            translationData = {
              baseWordId: baseWord.id,
              languageId: updatedJob.languageId,
              translation: linguisticResult.data.translation,
              pronunciation: linguisticResult.data.pronunciation,
              notes: linguisticResult.data.definition ? `Definition: ${linguisticResult.data.definition}` : null,
              source: linguisticResult.data.source,
              verified: linguisticResult.data.confidence > 0.8,
            };
          } else {
            // Fallback to basic translation if API fails
            translationData = {
              baseWordId: baseWord.id,
              languageId: updatedJob.languageId,
              translation: getFallbackTranslation(baseWord.word, language.iso639_1),
              source: "fallback_rules",
              verified: false,
            };
          }

          await storage.createWordTranslation(translationData);
          
          completedCount++;
        } else {
          failedCount++;
        }

        // Update job progress
        const jobUpdate = await storage.updateScrapingJob(jobId, {
          completedWords: completedCount,
          failedWords: failedCount,
        });

        // Broadcast progress update
        wsManager.broadcastProgress(jobId, {
          status: 'running',
          completed: completedCount,
          total: baseWords.length,
          percentage: Math.round((completedCount / baseWords.length) * 100)
        });

        wsManager.broadcastJobUpdate(jobUpdate);
      }

      // Mark job as completed
      const completedJob = await storage.updateScrapingJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
      });

      // Broadcast completion
      wsManager.broadcastProgress(jobId, {
        status: 'completed',
        completed: completedCount,
        total: baseWords.length,
        percentage: 100
      });

      wsManager.broadcastJobUpdate(completedJob);

    } catch (error) {
      const failedJob = await storage.updateScrapingJob(jobId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      wsManager.broadcastProgress(jobId, {
        status: 'failed',
        completed: 0,
        total: 0,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });

      wsManager.broadcastJobUpdate(failedJob);
    }
  }

  // Fallback translation for when professional APIs are unavailable
  function getFallbackTranslation(word: string, targetLang: string): string {
    const translations: { [key: string]: { [key: string]: string } } = {
      de: {
        hello: "hallo", water: "wasser", house: "haus", family: "familie",
        mountain: "berg", tree: "baum", sun: "sonne", moon: "mond",
        fire: "feuer", earth: "erde", wind: "wind", love: "liebe",
        time: "zeit", person: "person", woman: "frau", man: "mann",
        child: "kind", mother: "mutter", father: "vater", brother: "bruder",
        sister: "schwester", hand: "hand", eye: "auge", ear: "ohr",
        mouth: "mund", food: "essen", eat: "essen", drink: "trinken",
        sleep: "schlafen", walk: "gehen", run: "laufen", speak: "sprechen"
      },
      nl: {
        hello: "hallo", water: "water", house: "huis", family: "familie",
        mountain: "berg", tree: "boom", sun: "zon", moon: "maan",
        fire: "vuur", earth: "aarde", wind: "wind", love: "liefde",
        time: "tijd", person: "persoon", woman: "vrouw", man: "man",
        child: "kind", mother: "moeder", father: "vader", brother: "broer",
        sister: "zus", hand: "hand", eye: "oog", ear: "oor",
        mouth: "mond", food: "voedsel", eat: "eten", drink: "drinken",
        sleep: "slapen", walk: "lopen", run: "rennen", speak: "spreken"
      },
      sv: {
        hello: "hej", water: "vatten", house: "hus", family: "familj",
        mountain: "berg", tree: "träd", sun: "sol", moon: "måne",
        fire: "eld", earth: "jord", wind: "vind", love: "kärlek",
        time: "tid", person: "person", woman: "kvinna", man: "man",
        child: "barn", mother: "mor", father: "far", brother: "bror",
        sister: "syster", hand: "hand", eye: "öga", ear: "öra",
        mouth: "mun", food: "mat", eat: "äta", drink: "dricka",
        sleep: "sova", walk: "gå", run: "springa", speak: "tala"
      },
      no: {
        hello: "hei", water: "vann", house: "hus", family: "familie",
        mountain: "fjell", tree: "tre", sun: "sol", moon: "måne",
        fire: "ild", earth: "jord", wind: "vind", love: "kjærlighet",
        time: "tid", person: "person", woman: "kvinne", man: "mann",
        child: "barn", mother: "mor", father: "far", brother: "bror",
        sister: "søster", hand: "hånd", eye: "øye", ear: "øre",
        mouth: "munn", food: "mat", eat: "spise", drink: "drikke",
        sleep: "sove", walk: "gå", run: "løpe", speak: "snakke"
      },
      da: {
        hello: "hej", water: "vand", house: "hus", family: "familie",
        mountain: "bjerg", tree: "træ", sun: "sol", moon: "måne",
        fire: "ild", earth: "jord", wind: "vind", love: "kærlighed",
        time: "tid", person: "person", woman: "kvinde", man: "mand",
        child: "barn", mother: "mor", father: "far", brother: "bror",
        sister: "søster", hand: "hånd", eye: "øje", ear: "øre",
        mouth: "mund", food: "mad", eat: "spise", drink: "drikke",
        sleep: "sove", walk: "gå", run: "løbe", speak: "tale"
      }
    };

    return translations[targetLang]?.[word] || `${word}_${targetLang}`;
  }

  // Language Evolution API routes
  app.get('/api/languages/:languageId/evolution', async (req, res) => {
    try {
      const { languageId } = req.params;
      const evolution = await storage.getLanguageEvolution(languageId);
      res.json(evolution);
    } catch (error) {
      console.error('Error fetching language evolution:', error);
      res.status(500).json({ error: 'Failed to fetch language evolution' });
    }
  });

  app.post('/api/languages/:languageId/evolution', async (req, res) => {
    try {
      const { languageId } = req.params;
      const evolutionData = {
        ...req.body,
        languageId,
        verificationStatus: 'pending' as const,
      };
      
      const evolution = await storage.createLanguageEvolution(evolutionData);
      res.status(201).json(evolution);
    } catch (error) {
      console.error('Error creating language evolution:', error);
      res.status(500).json({ error: 'Failed to create language evolution' });
    }
  });

  // User Contributions API routes
  app.get('/api/words/:baseWordId/user-contributions', async (req, res) => {
    try {
      const { baseWordId } = req.params;
      const contributions = await storage.getUserContributions(baseWordId);
      res.json(contributions);
    } catch (error) {
      console.error('Error fetching user contributions:', error);
      res.status(500).json({ error: 'Failed to fetch user contributions' });
    }
  });

  app.post('/api/words/:baseWordId/user-contributions', async (req, res) => {
    try {
      const { baseWordId } = req.params;
      const contributionData = {
        ...req.body,
        baseWordId,
        verificationStatus: 'pending' as const,
      };
      
      const contribution = await storage.createUserContribution(contributionData);
      res.status(201).json(contribution);
    } catch (error) {
      console.error('Error creating user contribution:', error);
      res.status(500).json({ error: 'Failed to create user contribution' });
    }
  });

  // Translation Context API routes
  app.get('/api/words/:baseWordId/languages/:languageId/contexts', async (req, res) => {
    try {
      const { baseWordId, languageId } = req.params;
      const contexts = await storage.getTranslationContexts(baseWordId, languageId);
      res.json(contexts);
    } catch (error) {
      console.error('Error fetching translation contexts:', error);
      res.status(500).json({ error: 'Failed to fetch translation contexts' });
    }
  });

  app.post('/api/words/:baseWordId/languages/:languageId/generate-contexts', async (req, res) => {
    try {
      const { baseWordId, languageId } = req.params;
      const { baseWord, translation, languageName } = req.body;

      // Check if OpenAI API key is available
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({ 
          error: 'OpenAI API key not configured. Please provide your OpenAI API key to use AI translation contexts.' 
        });
      }

      // Import OpenAI here to avoid errors if not available
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Generate AI contexts for different types
      const contextTypes = ['cultural', 'historical', 'semantic', 'phonetic'] as const;
      const generatedContexts = [];

      for (const contextType of contextTypes) {
        try {
          const prompt = `As a professional linguist, analyze the translation of "${baseWord}" to "${translation}" in ${languageName} from a ${contextType} perspective. 

Provide a detailed analysis including:
1. Context description (2-3 sentences)
2. Linguistic insight (2-3 sentences)
3. Related terms (3-5 words)
4. Cross-linguistic comparisons if relevant

Respond with JSON in this exact format:
{
  "contextDescription": "string",
  "aiGeneratedInsight": "string", 
  "relatedTerms": ["term1", "term2", "term3"],
  "linguisticAnalysis": {
    "semanticField": ["field1", "field2"],
    "cognates": ["cognate1", "cognate2"],
    "borrowings": ["source1", "source2"],
    "soundChanges": ["change1", "change2"]
  },
  "crossLinguisticComparisons": [
    {"language": "Language Name", "term": "word", "relationship": "cognate/borrowing/etc"}
  ],
  "confidence": 85
}`;

          const response = await openai.chat.completions.create({
            model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_tokens: 800,
          });

          const result = JSON.parse(response.choices[0].message.content);
          
          const contextData = {
            baseWordId,
            languageId,
            contextType,
            contextDescription: result.contextDescription,
            aiGeneratedInsight: result.aiGeneratedInsight,
            linguisticAnalysis: result.linguisticAnalysis,
            relatedTerms: result.relatedTerms,
            crossLinguisticComparisons: result.crossLinguisticComparisons,
            confidence: result.confidence,
            humanVerified: false,
          };

          const context = await storage.createTranslationContext(contextData);
          generatedContexts.push(context);
        } catch (error) {
          console.error(`Error generating ${contextType} context:`, error);
          // Continue with other context types even if one fails
        }
      }

      res.status(201).json(generatedContexts);
    } catch (error) {
      console.error('Error generating AI contexts:', error);
      res.status(500).json({ error: 'Failed to generate AI contexts' });
    }
  });

  // Search Filters API routes
  app.get('/api/search-filters', async (req, res) => {
    try {
      const filters = await storage.getSearchFilters();
      res.json(filters);
    } catch (error) {
      console.error('Error fetching search filters:', error);
      res.status(500).json({ error: 'Failed to fetch search filters' });
    }
  });

  app.post('/api/search-filters', async (req, res) => {
    try {
      const filterData = {
        ...req.body,
        isDefault: false,
      };
      
      const filter = await storage.createSearchFilter(filterData);
      res.status(201).json(filter);
    } catch (error) {
      console.error('Error creating search filter:', error);
      res.status(500).json({ error: 'Failed to create search filter' });
    }
  });

  app.delete('/api/search-filters/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteSearchFilter(id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting search filter:', error);
      res.status(500).json({ error: 'Failed to delete search filter' });
    }
  });

  return server;
}
