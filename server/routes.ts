import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertLanguageFamilySchema, insertLanguageSchema, insertBaseWordSchema, insertWordTranslationSchema, insertScrapingJobSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  
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
      const job = await storage.createScrapingJob(validatedData);
      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create scraping job" });
      }
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

  // Mock scraping process (simulates web scraping)
  async function startScrapingProcess(jobId: string) {
    try {
      const job = await storage.updateScrapingJob(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      const baseWords = await storage.getBaseWords();
      const language = await storage.getLanguage(job.languageId);
      
      if (!language) return;

      // Simulate scraping with delays
      for (let i = 0; i < baseWords.length; i++) {
        const baseWord = baseWords[i];
        
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        
        // Simulate success/failure (90% success rate)
        const success = Math.random() > 0.1;
        
        if (success) {
          // Create mock translation
          await storage.createWordTranslation({
            baseWordId: baseWord.id,
            languageId: job.languageId,
            translation: `${baseWord.word}_${language.iso639_1}`, // Mock translation
            source: "mock_scraper",
            verified: false,
          });
          
          await storage.updateScrapingJob(jobId, {
            completedWords: i + 1,
          });
        } else {
          await storage.updateScrapingJob(jobId, {
            completedWords: i,
            failedWords: (await storage.getScrapingJobs())[0]?.failedWords || 0 + 1,
          });
        }
      }

      // Mark job as completed
      await storage.updateScrapingJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
      });

    } catch (error) {
      await storage.updateScrapingJob(jobId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const httpServer = createServer(app);
  return httpServer;
}
