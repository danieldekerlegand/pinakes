import { storage } from "../storage";
import type { EtymologyRelation } from "../tsv-storage";

export interface OriginEntry {
  language: string;
  languageName: string;
  count: number;
  percentage: number;
  words: string[];
}

export interface WordChainEntry {
  word: string;
  language: string;
  languageName: string;
}

export interface WordDetail {
  word: string;
  origin: string | null;
  chain: WordChainEntry[];
}

export interface TextAnalysisResult {
  totalWords: number;
  analyzedWords: number;
  unknownWords: number;
  origins: OriginEntry[];
  wordDetails: WordDetail[];
}

// Relations that indicate ancestry (source is derived FROM target)
const ANCESTOR_RELATIONS = ["derived_from", "etymology", "borrowed_from"];

/**
 * Tokenize text into normalized words.
 * Strips punctuation and splits on whitespace.
 */
export function tokenize(text: string, _language?: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3000-\u9FFF\uAC00-\uD7AF\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 0);
}

interface TraceResult {
  origin: string | null;
  chain: Array<{ word: string; language: string }>;
}

/**
 * Trace a single word to its oldest known ancestor language.
 * Returns the origin language code and the full chain of derivations.
 */
function traceToOriginWithChain(
  word: string,
  language: string,
  relations: EtymologyRelation[],
  visited: Set<string>,
): TraceResult {
  const key = `${word}|${language}`;
  if (visited.has(key)) return { origin: language, chain: [{ word, language }] };
  visited.add(key);

  const normalizedWord = word.toLowerCase();

  // Find ancestor relations for this word
  const ancestors = relations.filter((r) => {
    if (!ANCESTOR_RELATIONS.includes(r.relationType)) return false;
    if (r.sourceWord.toLowerCase() !== normalizedWord) return false;
    if (r.sourceLanguage.toLowerCase() !== language.toLowerCase()) return false;
    return true;
  });

  if (ancestors.length === 0) {
    // No further ancestors — check if this word exists at all in the dataset
    const existsAsTarget = relations.some(
      (r) =>
        ANCESTOR_RELATIONS.includes(r.relationType) &&
        r.targetWord.toLowerCase() === normalizedWord &&
        r.targetLanguage.toLowerCase() === language.toLowerCase(),
    );
    const existsAsSource = relations.some(
      (r) => r.sourceWord.toLowerCase() === normalizedWord,
    );
    if (existsAsTarget || existsAsSource) {
      return { origin: language, chain: [{ word, language }] };
    }
    return { origin: null, chain: [] };
  }

  // Follow the first ancestor chain (prefer derived_from > etymology > borrowed_from)
  const sorted = [...ancestors].sort((a, b) => {
    const order = ANCESTOR_RELATIONS;
    return order.indexOf(a.relationType) - order.indexOf(b.relationType);
  });

  const ancestor = sorted[0];
  const result = traceToOriginWithChain(
    ancestor.targetWord,
    ancestor.targetLanguage,
    relations,
    visited,
  );
  const chain = [{ word, language }, ...result.chain];
  return { origin: result.origin ?? ancestor.targetLanguage, chain };
}

/**
 * Analyze a text's etymological origins.
 * Tokenizes the text, traces each word to its oldest ancestor,
 * and returns frequency counts grouped by origin language.
 */
export async function analyzeTextOrigins(
  text: string,
  language: string,
): Promise<TextAnalysisResult> {
  const words = tokenize(text, language);
  const totalWords = words.length;

  const allRelations = await storage.getEtymologyRelations();
  const allLanguages = await storage.getLanguages();

  // Build a language name lookup
  const langNameMap = new Map<string, string>();
  for (const lang of allLanguages) {
    langNameMap.set(lang.id.toLowerCase(), lang.name);
  }

  // Count origins and build word details
  const originCounts = new Map<string, string[]>();
  let unknownWords = 0;
  const seen = new Map<string, TraceResult>(); // cache per unique word
  const wordDetails: WordDetail[] = [];

  for (const word of words) {
    let traceResult: TraceResult;
    if (seen.has(word)) {
      traceResult = seen.get(word)!;
    } else {
      const visited = new Set<string>();
      traceResult = traceToOriginWithChain(word, language, allRelations, visited);
      seen.set(word, traceResult);
    }

    const origin = traceResult.origin;

    // Build chain with language names
    const chainWithNames: WordChainEntry[] = traceResult.chain.map((entry) => ({
      word: entry.word,
      language: entry.language,
      languageName: langNameMap.get(entry.language.toLowerCase()) ?? entry.language,
    }));

    wordDetails.push({
      word,
      origin,
      chain: chainWithNames,
    });

    if (origin === null) {
      unknownWords++;
    } else {
      const key = origin.toLowerCase();
      const existing = originCounts.get(key) ?? [];
      existing.push(word);
      originCounts.set(key, existing);
    }
  }

  const analyzedWords = totalWords - unknownWords;

  // Build origins array sorted by count descending
  const origins: OriginEntry[] = [];
  originCounts.forEach((wordList, langCode) => {
    const uniqueWords: string[] = [];
    const wordSet: Record<string, boolean> = {};
    for (const w of wordList) {
      if (!wordSet[w]) {
        wordSet[w] = true;
        uniqueWords.push(w);
      }
    }
    origins.push({
      language: langCode,
      languageName: langNameMap.get(langCode) ?? langCode,
      count: wordList.length,
      percentage: totalWords > 0 ? Math.round((wordList.length / totalWords) * 1000) / 10 : 0,
      words: uniqueWords,
    });
  });

  origins.sort((a, b) => b.count - a.count);

  return {
    totalWords,
    analyzedWords,
    unknownWords,
    origins,
    wordDetails,
  };
}
