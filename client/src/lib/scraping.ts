// Mock scraping service - in a real app this would interface with actual translation APIs
// like Google Translate, Microsoft Translator, or linguistic databases

interface TranslationSource {
  name: string;
  priority: number;
  translate: (word: string, fromLang: string, toLang: string) => Promise<string | null>;
}

class MockTranslationAPI implements TranslationSource {
  name = "Mock Translator";
  priority = 1;

  async translate(word: string, fromLang: string, toLang: string): Promise<string | null> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    
    // Simulate 90% success rate
    if (Math.random() < 0.9) {
      return `${word}_${toLang}`;
    }
    
    return null;
  }
}

class GoogleTranslateAPI implements TranslationSource {
  name = "Google Translate";
  priority = 2;

  async translate(word: string, fromLang: string, toLang: string): Promise<string | null> {
    // The Google Translate key is SERVER-SIDE ONLY (see docs/SECURITY.md). The client
    // never holds it — translation is proxied through POST /api/translate, which reads
    // the server-side key. A 503 means no key is configured (translation optional);
    // we fall through to the next source.
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: word, from: fromLang, to: toLang }),
      });
      if (!res.ok) {
        // 503 (no key) / 502 (upstream) — degrade to the next translation source.
        return null;
      }
      const data = (await res.json()) as { translation: string | null };
      return data.translation;
    } catch (error) {
      console.error("Google Translate proxy error:", error);
      return null;
    }
  }
}

class WiktionaryAPI implements TranslationSource {
  name = "Wiktionary";
  priority = 3;

  async translate(word: string, fromLang: string, toLang: string): Promise<string | null> {
    // In a real implementation, this would scrape Wiktionary for translations
    try {
      // Mock Wiktionary scraping
      await new Promise(resolve => setTimeout(resolve, 300));
      return Math.random() < 0.7 ? `${word}_wikt_${toLang}` : null;
    } catch (error) {
      console.error("Wiktionary scraping error:", error);
      return null;
    }
  }
}

export class ScrapingService {
  private sources: TranslationSource[] = [
    new GoogleTranslateAPI(),
    new WiktionaryAPI(), 
    new MockTranslationAPI(), // Fallback
  ];

  async translateWord(
    word: string, 
    fromLanguageCode: string, 
    toLanguageCode: string
  ): Promise<{
    translation: string | null;
    source: string;
    confidence: number;
  }> {
    // Try each translation source in priority order
    for (const source of this.sources.sort((a, b) => a.priority - b.priority)) {
      try {
        const translation = await source.translate(word, fromLanguageCode, toLanguageCode);
        
        if (translation) {
          return {
            translation,
            source: source.name,
            confidence: this.calculateConfidence(source, translation),
          };
        }
      } catch (error) {
        console.warn(`${source.name} failed for word "${word}":`, error);
        continue;
      }
    }

    return {
      translation: null,
      source: "none",
      confidence: 0,
    };
  }

  private calculateConfidence(source: TranslationSource, translation: string): number {
    // Simple confidence scoring based on source priority and translation length
    let confidence = 1.0 - (source.priority - 1) * 0.1; // Higher priority = higher confidence
    
    if (translation.length < 2) confidence *= 0.7;
    if (translation.includes("_")) confidence *= 0.8; // Mock translations have underscores
    
    return Math.max(0, Math.min(1, confidence));
  }

  async scrapeWordList(
    words: string[],
    fromLanguageCode: string,
    toLanguageCode: string,
    onProgress?: (completed: number, total: number, currentWord: string) => void
  ): Promise<Array<{
    word: string;
    translation: string | null;
    source: string;
    confidence: number;
  }>> {
    const results = [];
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      onProgress?.(i, words.length, word);
      
      const result = await this.translateWord(word, fromLanguageCode, toLanguageCode);
      results.push({
        word,
        ...result,
      });
      
      // Add small delay between requests to be respectful to APIs
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    onProgress?.(words.length, words.length, "");
    return results;
  }
}

export const scrapingService = new ScrapingService();
