import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
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
          // Create mock translation with realistic data
          const translations = {
            en: baseWord.word,
            de: getGermanTranslation(baseWord.word),
            nl: getDutchTranslation(baseWord.word),
            sv: getSwedishTranslation(baseWord.word),
            no: getNorwegianTranslation(baseWord.word),
            da: getDanishTranslation(baseWord.word)
          };

          await storage.createWordTranslation({
            baseWordId: baseWord.id,
            languageId: updatedJob.languageId,
            translation: translations[language.iso639_1 as keyof typeof translations] || `${baseWord.word}_${language.iso639_1}`,
            source: "mock_linguistic_api",
            verified: false,
          });
          
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

  // Mock translation functions for realistic data
  function getGermanTranslation(word: string): string {
    const translations: { [key: string]: string } = {
      hello: "hallo", water: "wasser", house: "haus", family: "familie",
      mountain: "berg", tree: "baum", sun: "sonne", moon: "mond",
      fire: "feuer", earth: "erde", wind: "wind", love: "liebe",
      time: "zeit", person: "person", woman: "frau", man: "mann",
      child: "kind", mother: "mutter", father: "vater", brother: "bruder",
      sister: "schwester", hand: "hand", eye: "auge", ear: "ohr",
      mouth: "mund", food: "essen", eat: "essen", drink: "trinken",
      sleep: "schlafen", walk: "gehen", run: "laufen", speak: "sprechen"
    };
    return translations[word] || `${word}_de`;
  }

  function getDutchTranslation(word: string): string {
    const translations: { [key: string]: string } = {
      hello: "hallo", water: "water", house: "huis", family: "familie",
      mountain: "berg", tree: "boom", sun: "zon", moon: "maan",
      fire: "vuur", earth: "aarde", wind: "wind", love: "liefde",
      time: "tijd", person: "persoon", woman: "vrouw", man: "man",
      child: "kind", mother: "moeder", father: "vader", brother: "broer",
      sister: "zus", hand: "hand", eye: "oog", ear: "oor",
      mouth: "mond", food: "voedsel", eat: "eten", drink: "drinken",
      sleep: "slapen", walk: "lopen", run: "rennen", speak: "spreken"
    };
    return translations[word] || `${word}_nl`;
  }

  function getSwedishTranslation(word: string): string {
    const translations: { [key: string]: string } = {
      hello: "hej", water: "vatten", house: "hus", family: "familj",
      mountain: "berg", tree: "träd", sun: "sol", moon: "måne",
      fire: "eld", earth: "jord", wind: "vind", love: "kärlek",
      time: "tid", person: "person", woman: "kvinna", man: "man",
      child: "barn", mother: "mor", father: "far", brother: "bror",
      sister: "syster", hand: "hand", eye: "öga", ear: "öra",
      mouth: "mun", food: "mat", eat: "äta", drink: "dricka",
      sleep: "sova", walk: "gå", run: "springa", speak: "tala"
    };
    return translations[word] || `${word}_sv`;
  }

  function getNorwegianTranslation(word: string): string {
    const translations: { [key: string]: string } = {
      hello: "hei", water: "vann", house: "hus", family: "familie",
      mountain: "fjell", tree: "tre", sun: "sol", moon: "måne",
      fire: "ild", earth: "jord", wind: "vind", love: "kjærlighet",
      time: "tid", person: "person", woman: "kvinne", man: "mann",
      child: "barn", mother: "mor", father: "far", brother: "bror",
      sister: "søster", hand: "hånd", eye: "øye", ear: "øre",
      mouth: "munn", food: "mat", eat: "spise", drink: "drikke",
      sleep: "sove", walk: "gå", run: "løpe", speak: "snakke"
    };
    return translations[word] || `${word}_no`;
  }

  function getDanishTranslation(word: string): string {
    const translations: { [key: string]: string } = {
      hello: "hej", water: "vand", house: "hus", family: "familie",
      mountain: "bjerg", tree: "træ", sun: "sol", moon: "måne",
      fire: "ild", earth: "jord", wind: "vind", love: "kærlighed",
      time: "tid", person: "person", woman: "kvinde", man: "mand",
      child: "barn", mother: "mor", father: "far", brother: "bror",
      sister: "søster", hand: "hånd", eye: "øje", ear: "øre",
      mouth: "mund", food: "mad", eat: "spise", drink: "drikke",
      sleep: "sove", walk: "gå", run: "løbe", speak: "tale"
    };
    return translations[word] || `${word}_da`;
  }

  return server;
}
