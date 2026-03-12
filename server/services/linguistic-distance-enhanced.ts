import { storage } from "../storage";
import type { PhonologicalInventory, GrammarFeatures } from "../tsv-storage";

/**
 * Enhanced Linguistic Distance Service
 *
 * Extends the existing vocabulary-based distance with phonological
 * and grammatical comparison modes.
 */

export type ComparisonMode = 'vocabulary' | 'phonological' | 'grammatical' | 'combined';

export interface DimensionalDistance {
  vocabulary: number | null;      // LDND-based lexical distance (0-1, null if no data)
  phonological: number | null;    // Phonological inventory distance (0-1)
  grammatical: number | null;     // Grammar feature distance (0-1)
  combined: number | null;        // Weighted blend of all available dimensions
}

export interface EnhancedPairwiseResult {
  language1Id: string;
  language2Id: string;
  distances: DimensionalDistance;
  breakdown: {
    phonological?: PhonologicalBreakdown;
    grammatical?: GrammaticalBreakdown;
  };
}

export interface PhonologicalBreakdown {
  consonantOverlap: number;       // Jaccard similarity 0-1
  vowelOverlap: number;
  toneMatch: boolean;
  syllableStructureSimilarity: number;
  stressSystemMatch: boolean;
}

export interface GrammaticalBreakdown {
  wordOrderMatch: boolean;
  morphologicalTypeMatch: boolean;
  caseSystemOverlap: number;
  genderSystemOverlap: number;
  tamOverlap: number;
  negationMatch: boolean;
  ergativityMatch: boolean;
  evidentialityMatch: boolean;
}

// Cache for loaded data
let phonologicalCache: Map<string, PhonologicalInventory> | null = null;
let grammarCache: Map<string, GrammarFeatures> | null = null;

async function getPhonologicalMap(): Promise<Map<string, PhonologicalInventory>> {
  if (phonologicalCache) return phonologicalCache;
  const inventories = await storage.getPhonologicalInventories();
  phonologicalCache = new Map();
  for (const inv of inventories) {
    phonologicalCache.set(inv.languageId, inv);
  }
  return phonologicalCache;
}

async function getGrammarMap(): Promise<Map<string, GrammarFeatures>> {
  if (grammarCache) return grammarCache;
  const features = await storage.getGrammarFeatures();
  grammarCache = new Map();
  for (const feat of features) {
    grammarCache.set(feat.languageId, feat);
  }
  return grammarCache;
}

/**
 * Jaccard similarity between two string arrays (0 = no overlap, 1 = identical sets)
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of Array.from(setA)) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Compute phonological distance between two languages (0 = identical, 1 = maximally different)
 */
export async function computePhonologicalDistance(
  lang1Id: string,
  lang2Id: string
): Promise<{ distance: number; breakdown: PhonologicalBreakdown } | null> {
  const phonMap = await getPhonologicalMap();
  const inv1 = phonMap.get(lang1Id);
  const inv2 = phonMap.get(lang2Id);

  if (!inv1 || !inv2) return null;

  const consonantOverlap = jaccardSimilarity(inv1.consonants, inv2.consonants);
  const vowelOverlap = jaccardSimilarity(inv1.vowels, inv2.vowels);

  // Tone system comparison
  const bothHaveTones = inv1.tones !== null && inv2.tones !== null;
  const neitherHasTones = inv1.tones === null && inv2.tones === null;
  const toneMatch = bothHaveTones || neitherHasTones;
  const toneSimilarity = toneMatch
    ? (bothHaveTones ? jaccardSimilarity(inv1.tones!, inv2.tones!) : 1.0)
    : 0.0;

  // Syllable structure comparison (simple string similarity)
  const syllableStructureSimilarity = inv1.syllableStructure === inv2.syllableStructure
    ? 1.0
    : (inv1.syllableStructure.length > 0 && inv2.syllableStructure.length > 0
      ? computeStringSimilarity(inv1.syllableStructure, inv2.syllableStructure)
      : 0.0);

  const stressSystemMatch = inv1.stressSystem.toLowerCase() === inv2.stressSystem.toLowerCase();

  const breakdown: PhonologicalBreakdown = {
    consonantOverlap,
    vowelOverlap,
    toneMatch,
    syllableStructureSimilarity,
    stressSystemMatch,
  };

  // Weighted combination: consonants and vowels are most important
  const distance = 1 - (
    consonantOverlap * 0.30 +
    vowelOverlap * 0.25 +
    toneSimilarity * 0.15 +
    syllableStructureSimilarity * 0.15 +
    (stressSystemMatch ? 1 : 0) * 0.15
  );

  return { distance: Math.max(0, Math.min(1, distance)), breakdown };
}

/**
 * Compute grammatical distance between two languages (0 = identical, 1 = maximally different)
 */
export async function computeGrammaticalDistance(
  lang1Id: string,
  lang2Id: string
): Promise<{ distance: number; breakdown: GrammaticalBreakdown } | null> {
  const gramMap = await getGrammarMap();
  const g1 = gramMap.get(lang1Id);
  const g2 = gramMap.get(lang2Id);

  if (!g1 || !g2) return null;

  const wordOrderMatch = g1.wordOrder === g2.wordOrder;
  const morphologicalTypeMatch = g1.morphologicalType === g2.morphologicalType;
  const caseSystemOverlap = jaccardSimilarity(g1.caseSystem, g2.caseSystem);
  const genderSystemOverlap = jaccardSimilarity(g1.genderSystem, g2.genderSystem);
  const tamOverlap = jaccardSimilarity(g1.tenseAspectMood, g2.tenseAspectMood);
  const negationMatch = g1.negationStrategy === g2.negationStrategy;
  const ergativityMatch = g1.ergativity === g2.ergativity;
  const evidentialityMatch = g1.evidentiality === g2.evidentiality;

  const breakdown: GrammaticalBreakdown = {
    wordOrderMatch,
    morphologicalTypeMatch,
    caseSystemOverlap,
    genderSystemOverlap,
    tamOverlap,
    negationMatch,
    ergativityMatch,
    evidentialityMatch,
  };

  // Weighted combination
  const similarity =
    (wordOrderMatch ? 1 : 0) * 0.20 +
    (morphologicalTypeMatch ? 1 : 0) * 0.15 +
    caseSystemOverlap * 0.15 +
    genderSystemOverlap * 0.10 +
    tamOverlap * 0.15 +
    (negationMatch ? 1 : 0) * 0.10 +
    (ergativityMatch ? 1 : 0) * 0.075 +
    (evidentialityMatch ? 1 : 0) * 0.075;

  return { distance: Math.max(0, Math.min(1, 1 - similarity)), breakdown };
}

/**
 * Compute multi-dimensional distance between two languages
 */
export async function computeEnhancedDistance(
  lang1Id: string,
  lang2Id: string,
  vocabularyDistance?: number
): Promise<EnhancedPairwiseResult> {
  const [phonResult, gramResult] = await Promise.all([
    computePhonologicalDistance(lang1Id, lang2Id),
    computeGrammaticalDistance(lang1Id, lang2Id),
  ]);

  const distances: DimensionalDistance = {
    vocabulary: vocabularyDistance ?? null,
    phonological: phonResult?.distance ?? null,
    grammatical: gramResult?.distance ?? null,
    combined: null,
  };

  // Compute combined as weighted average of available dimensions
  const weights: Array<{ value: number; weight: number }> = [];
  if (distances.vocabulary !== null && distances.vocabulary >= 0) {
    weights.push({ value: distances.vocabulary, weight: 0.4 });
  }
  if (distances.phonological !== null) {
    weights.push({ value: distances.phonological, weight: 0.3 });
  }
  if (distances.grammatical !== null) {
    weights.push({ value: distances.grammatical, weight: 0.3 });
  }

  if (weights.length > 0) {
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    distances.combined = weights.reduce((sum, w) => sum + w.value * w.weight, 0) / totalWeight;
  }

  return {
    language1Id: lang1Id,
    language2Id: lang2Id,
    distances,
    breakdown: {
      phonological: phonResult?.breakdown,
      grammatical: gramResult?.breakdown,
    },
  };
}

/**
 * Find nearest languages by a specific dimension
 */
export async function findNearestByDimension(
  targetLanguageId: string,
  mode: ComparisonMode,
  k: number = 10
): Promise<Array<{ languageId: string; distance: number }>> {
  let availableLanguageIds: string[];

  if (mode === 'phonological') {
    const phonMap = await getPhonologicalMap();
    availableLanguageIds = Array.from(phonMap.keys()).filter(id => id !== targetLanguageId);
  } else if (mode === 'grammatical') {
    const gramMap = await getGrammarMap();
    availableLanguageIds = Array.from(gramMap.keys()).filter(id => id !== targetLanguageId);
  } else {
    // For vocabulary and combined, we need both maps
    const phonMap = await getPhonologicalMap();
    const gramMap = await getGrammarMap();
    const allIds = new Set([...Array.from(phonMap.keys()), ...Array.from(gramMap.keys())]);
    allIds.delete(targetLanguageId);
    availableLanguageIds = Array.from(allIds);
  }

  const results: Array<{ languageId: string; distance: number }> = [];

  for (const langId of availableLanguageIds) {
    let distance: number | null = null;

    if (mode === 'phonological') {
      const result = await computePhonologicalDistance(targetLanguageId, langId);
      distance = result?.distance ?? null;
    } else if (mode === 'grammatical') {
      const result = await computeGrammaticalDistance(targetLanguageId, langId);
      distance = result?.distance ?? null;
    } else if (mode === 'combined') {
      const enhanced = await computeEnhancedDistance(targetLanguageId, langId);
      distance = enhanced.distances.combined;
    }

    if (distance !== null) {
      results.push({ languageId: langId, distance });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, k);
}

/**
 * Simple string similarity based on normalized Levenshtein
 */
function computeStringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen;
}
