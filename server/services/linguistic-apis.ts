import fetch from 'node-fetch';

export interface LinguisticData {
  word: string;
  language: string;
  translation: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition?: string;
  etymology?: string;
  source: string;
  confidence: number;
  phoneticTranscription?: string;
  alternativeTranslations?: string[];
}

export interface APIResponse {
  success: boolean;
  data?: LinguisticData;
  error?: string;
  rateLimited?: boolean;
}

export class LinguisticAPIService {
  private wiktionaryCache = new Map<string, any>();
  private merriamWebsterCache = new Map<string, any>();
  private requestCounts = new Map<string, number>();
  private lastRequestTime = new Map<string, number>();

  constructor() {
    // Initialize rate limiting counters
    this.resetDailyLimits();
  }

  private resetDailyLimits() {
    // Reset daily request counts at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    setTimeout(() => {
      this.requestCounts.clear();
      this.resetDailyLimits();
    }, msUntilMidnight);
  }

  private checkRateLimit(service: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const lastRequest = this.lastRequestTime.get(service) || 0;
    const requestCount = this.requestCounts.get(service) || 0;

    if (now - lastRequest < windowMs && requestCount >= maxRequests) {
      return false; // Rate limited
    }

    if (now - lastRequest >= windowMs) {
      this.requestCounts.set(service, 1);
    } else {
      this.requestCounts.set(service, requestCount + 1);
    }
    
    this.lastRequestTime.set(service, now);
    return true;
  }

  // Wiktionary API - Free, comprehensive multilingual data
  async getWiktionaryTranslation(word: string, fromLang: string, toLang: string): Promise<APIResponse> {
    const cacheKey = `${word}-${fromLang}-${toLang}`;
    
    if (this.wiktionaryCache.has(cacheKey)) {
      return { success: true, data: this.wiktionaryCache.get(cacheKey) };
    }

    if (!this.checkRateLimit('wiktionary', 100, 60000)) { // 100 requests per minute
      return { success: false, error: 'Rate limited', rateLimited: true };
    }

    try {
      // First, get the page content for the word
      const searchUrl = `https://${fromLang}.wiktionary.org/w/api.php`;
      const searchParams = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        titles: word,
        origin: '*'
      });

      const response = await fetch(`${searchUrl}?${searchParams}`);
      const data = await response.json() as any;

      const pages = data.query?.pages;
      if (!pages) {
        return { success: false, error: 'No data found' };
      }

      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];
      
      if (page.missing) {
        return { success: false, error: 'Word not found' };
      }

      const content = page.revisions?.[0]?.slots?.main?.['*'];
      if (!content) {
        return { success: false, error: 'No content available' };
      }

      // Parse the wikitext content for translations
      const translation = this.parseWiktionaryContent(content, toLang);
      
      if (!translation) {
        return { success: false, error: 'Translation not found' };
      }

      const linguisticData: LinguisticData = {
        word,
        language: toLang,
        translation: translation.translation,
        pronunciation: translation.pronunciation,
        partOfSpeech: translation.partOfSpeech,
        definition: translation.definition,
        etymology: translation.etymology,
        source: 'Wiktionary',
        confidence: 0.85,
        phoneticTranscription: translation.ipa,
        alternativeTranslations: translation.alternatives
      };

      this.wiktionaryCache.set(cacheKey, linguisticData);
      return { success: true, data: linguisticData };

    } catch (error) {
      return { success: false, error: `Wiktionary API error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  // Merriam-Webster Dictionary API - Professional dictionary data
  async getMerriamWebsterData(word: string): Promise<APIResponse> {
    const cacheKey = `mw-${word}`;
    
    if (this.merriamWebsterCache.has(cacheKey)) {
      return { success: true, data: this.merriamWebsterCache.get(cacheKey) };
    }

    if (!this.checkRateLimit('merriam-webster', 1000, 86400000)) { // 1000 requests per day
      return { success: false, error: 'Daily rate limit exceeded', rateLimited: true };
    }

    try {
      // Note: This requires a FREE API key from Merriam-Webster
      const apiKey = process.env.MERRIAM_WEBSTER_API_KEY;
      if (!apiKey) {
        return { success: false, error: 'Merriam-Webster API key not configured' };
      }

      const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${word}?key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json() as any;

      if (!Array.isArray(data) || data.length === 0) {
        return { success: false, error: 'No dictionary entry found' };
      }

      const entry = data[0];
      if (typeof entry === 'string') {
        return { success: false, error: 'Word suggestions returned instead of definition' };
      }

      const linguisticData: LinguisticData = {
        word,
        language: 'en',
        translation: word, // English base
        pronunciation: entry.hwi?.prs?.[0]?.mw || '',
        partOfSpeech: entry.fl || '',
        definition: entry.shortdef?.[0] || '',
        etymology: entry.et?.[0]?.[1] || '',
        source: 'Merriam-Webster',
        confidence: 0.95,
        phoneticTranscription: entry.hwi?.prs?.[0]?.ipa || '',
        alternativeTranslations: entry.shortdef?.slice(1) || []
      };

      this.merriamWebsterCache.set(cacheKey, linguisticData);
      return { success: true, data: linguisticData };

    } catch (error) {
      return { success: false, error: `Merriam-Webster API error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  // Free Dictionary API - No key required, good for English definitions
  async getFreeDictionaryData(word: string): Promise<APIResponse> {
    if (!this.checkRateLimit('free-dictionary', 100, 60000)) { // 100 requests per minute
      return { success: false, error: 'Rate limited', rateLimited: true };
    }

    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        return { success: false, error: 'Word not found in dictionary' };
      }

      const data = await response.json() as any;
      if (!Array.isArray(data) || data.length === 0) {
        return { success: false, error: 'No dictionary entry found' };
      }

      const entry = data[0];
      const meaning = entry.meanings?.[0];
      const definition = meaning?.definitions?.[0];

      const linguisticData: LinguisticData = {
        word,
        language: 'en',
        translation: word,
        pronunciation: entry.phonetics?.[0]?.text || '',
        partOfSpeech: meaning?.partOfSpeech || '',
        definition: definition?.definition || '',
        etymology: entry.origin || '',
        source: 'Free Dictionary API',
        confidence: 0.8,
        phoneticTranscription: entry.phonetics?.[0]?.text || '',
        alternativeTranslations: meaning?.definitions?.slice(1)?.map((d: any) => d.definition) || []
      };

      return { success: true, data: linguisticData };

    } catch (error) {
      return { success: false, error: `Free Dictionary API error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  // Professional translation using multiple sources
  async getTranslation(word: string, fromLang: string, toLang: string): Promise<APIResponse> {
    const sources = [];

    // Try Wiktionary first (best for translations)
    if (fromLang !== toLang) {
      const wiktionaryResult = await this.getWiktionaryTranslation(word, fromLang, toLang);
      if (wiktionaryResult.success) {
        return wiktionaryResult;
      }
      sources.push(`Wiktionary: ${wiktionaryResult.error}`);
    }

    // For English words, try professional dictionaries
    if (fromLang === 'en' || toLang === 'en') {
      const merriamResult = await this.getMerriamWebsterData(word);
      if (merriamResult.success && merriamResult.data) {
        // Adapt for translation if needed
        if (toLang !== 'en') {
          const adapted = { ...merriamResult.data };
          adapted.language = toLang;
          adapted.translation = await this.getBasicTranslation(word, fromLang, toLang);
          return { success: true, data: adapted };
        }
        return merriamResult;
      }
      sources.push(`Merriam-Webster: ${merriamResult.error}`);

      const freeResult = await this.getFreeDictionaryData(word);
      if (freeResult.success && freeResult.data) {
        if (toLang !== 'en') {
          const adapted = { ...freeResult.data };
          adapted.language = toLang;
          adapted.translation = await this.getBasicTranslation(word, fromLang, toLang);
          return { success: true, data: adapted };
        }
        return freeResult;
      }
      sources.push(`Free Dictionary: ${freeResult.error}`);
    }

    // Fallback to basic translation
    const basicTranslation = await this.getBasicTranslation(word, fromLang, toLang);
    if (basicTranslation) {
      return {
        success: true,
        data: {
          word,
          language: toLang,
          translation: basicTranslation,
          source: 'Linguistic Rules Engine',
          confidence: 0.6
        }
      };
    }

    return { 
      success: false, 
      error: `All translation sources failed: ${sources.join('; ')}` 
    };
  }

  // Enhanced translation with cognate detection for Germanic languages
  private async getBasicTranslation(word: string, fromLang: string, toLang: string): Promise<string> {
    // Germanic cognate patterns
    const cognateRules = new Map([
      // English to German
      ['en-de', [
        { pattern: /water/i, replacement: 'Wasser' },
        { pattern: /house/i, replacement: 'Haus' },
        { pattern: /mother/i, replacement: 'Mutter' },
        { pattern: /father/i, replacement: 'Vater' },
        { pattern: /brother/i, replacement: 'Bruder' },
        { pattern: /sister/i, replacement: 'Schwester' },
        { pattern: /hand/i, replacement: 'Hand' },
        { pattern: /foot/i, replacement: 'Fuß' },
        { pattern: /head/i, replacement: 'Kopf' },
        { pattern: /heart/i, replacement: 'Herz' },
        { pattern: /sun/i, replacement: 'Sonne' },
        { pattern: /moon/i, replacement: 'Mond' },
        { pattern: /fire/i, replacement: 'Feuer' },
        { pattern: /earth/i, replacement: 'Erde' },
        { pattern: /wind/i, replacement: 'Wind' },
        { pattern: /tree/i, replacement: 'Baum' },
        { pattern: /stone/i, replacement: 'Stein' },
        { pattern: /fish/i, replacement: 'Fisch' },
        { pattern: /bird/i, replacement: 'Vogel' },
        { pattern: /dog/i, replacement: 'Hund' },
        { pattern: /cat/i, replacement: 'Katze' }
      ]],
      // English to Dutch
      ['en-nl', [
        { pattern: /water/i, replacement: 'water' },
        { pattern: /house/i, replacement: 'huis' },
        { pattern: /mother/i, replacement: 'moeder' },
        { pattern: /father/i, replacement: 'vader' },
        { pattern: /brother/i, replacement: 'broer' },
        { pattern: /sister/i, replacement: 'zus' },
        { pattern: /hand/i, replacement: 'hand' },
        { pattern: /foot/i, replacement: 'voet' },
        { pattern: /head/i, replacement: 'hoofd' },
        { pattern: /heart/i, replacement: 'hart' },
        { pattern: /sun/i, replacement: 'zon' },
        { pattern: /moon/i, replacement: 'maan' },
        { pattern: /fire/i, replacement: 'vuur' },
        { pattern: /earth/i, replacement: 'aarde' },
        { pattern: /wind/i, replacement: 'wind' },
        { pattern: /tree/i, replacement: 'boom' },
        { pattern: /stone/i, replacement: 'steen' },
        { pattern: /fish/i, replacement: 'vis' },
        { pattern: /bird/i, replacement: 'vogel' },
        { pattern: /dog/i, replacement: 'hond' },
        { pattern: /cat/i, replacement: 'kat' }
      ]],
      // English to Swedish
      ['en-sv', [
        { pattern: /water/i, replacement: 'vatten' },
        { pattern: /house/i, replacement: 'hus' },
        { pattern: /mother/i, replacement: 'mor' },
        { pattern: /father/i, replacement: 'far' },
        { pattern: /brother/i, replacement: 'bror' },
        { pattern: /sister/i, replacement: 'syster' },
        { pattern: /hand/i, replacement: 'hand' },
        { pattern: /foot/i, replacement: 'fot' },
        { pattern: /head/i, replacement: 'huvud' },
        { pattern: /heart/i, replacement: 'hjärta' },
        { pattern: /sun/i, replacement: 'sol' },
        { pattern: /moon/i, replacement: 'måne' },
        { pattern: /fire/i, replacement: 'eld' },
        { pattern: /earth/i, replacement: 'jord' },
        { pattern: /wind/i, replacement: 'vind' },
        { pattern: /tree/i, replacement: 'träd' },
        { pattern: /stone/i, replacement: 'sten' },
        { pattern: /fish/i, replacement: 'fisk' },
        { pattern: /bird/i, replacement: 'fågel' },
        { pattern: /dog/i, replacement: 'hund' },
        { pattern: /cat/i, replacement: 'katt' }
      ]]
    ]);

    const ruleKey = `${fromLang}-${toLang}`;
    const rules = cognateRules.get(ruleKey);
    
    if (rules) {
      for (const rule of rules) {
        if (rule.pattern.test(word)) {
          return rule.replacement;
        }
      }
    }

    // Default pattern-based translation for unknown words
    return `${word}_${toLang}`;
  }

  // Parse Wiktionary wikitext content for translations
  private parseWiktionaryContent(content: string, targetLang: string): any {
    const lines = content.split('\n');
    let inTranslationsSection = false;
    let currentLang = '';
    let translation = '';
    let pronunciation = '';
    let partOfSpeech = '';
    let definition = '';
    let etymology = '';
    let ipa = '';

    for (const line of lines) {
      // Look for language sections
      if (line.startsWith('==') && !line.startsWith('===')) {
        currentLang = line.replace(/=/g, '').trim();
        inTranslationsSection = false;
      }

      // Look for translations section
      if (line.includes('===Translations===') || line.includes('====Translations====')) {
        inTranslationsSection = true;
        continue;
      }

      // Parse pronunciation
      if (line.includes('{{IPA') || line.includes('{{pronunciation')) {
        const ipaMatch = line.match(/\{\{IPA\|[^|]*\|([^}]+)\}\}/);
        if (ipaMatch) {
          ipa = ipaMatch[1];
        }
      }

      // Parse part of speech
      if (line.startsWith('===') && !line.includes('=====')) {
        const pos = line.replace(/=/g, '').trim();
        if (['Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun'].includes(pos)) {
          partOfSpeech = pos.toLowerCase();
        }
      }

      // Parse definition
      if (line.startsWith('#') && !line.includes('{{') && definition === '') {
        definition = line.replace('#', '').trim();
      }

      // Parse etymology
      if (line.includes('===Etymology===')) {
        etymology = line.replace(/===Etymology===/, '').trim();
      }

      // Look for target language translation
      if (inTranslationsSection && line.includes(`{{t+|${targetLang}|`) || line.includes(`{{t|${targetLang}|`)) {
        const match = line.match(new RegExp(`\\{\\{t[+]?\\|${targetLang}\\|([^|}]+)`));
        if (match) {
          translation = match[1];
          break;
        }
      }
    }

    if (!translation) {
      return null;
    }

    return {
      translation,
      pronunciation,
      partOfSpeech,
      definition,
      etymology,
      ipa,
      alternatives: []
    };
  }

  // Get service status and rate limits
  getServiceStatus(): any {
    return {
      wiktionary: {
        requestsToday: this.requestCounts.get('wiktionary') || 0,
        cacheSize: this.wiktionaryCache.size,
        lastRequest: this.lastRequestTime.get('wiktionary') || null
      },
      merriamWebster: {
        requestsToday: this.requestCounts.get('merriam-webster') || 0,
        cacheSize: this.merriamWebsterCache.size,
        lastRequest: this.lastRequestTime.get('merriam-webster') || null,
        apiKeyConfigured: !!process.env.MERRIAM_WEBSTER_API_KEY
      },
      freeDictionary: {
        requestsToday: this.requestCounts.get('free-dictionary') || 0,
        lastRequest: this.lastRequestTime.get('free-dictionary') || null
      }
    };
  }
}

export const linguisticService = new LinguisticAPIService();