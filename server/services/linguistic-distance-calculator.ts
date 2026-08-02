import fs from "node:fs";
import path from "node:path";
import type { Language } from "@contracts/types";
import { normalizedPhoneticLevenshtein } from "./phonetic-features";

// Cache for available languages with word data
let cachedAvailableLanguageIds: string[] | null = null;

/**
 * Linguistic Distance Calculator Service
 *
 * Implements the ASJP-based Levenshtein Distance Normalized Divided (LDND) algorithm
 * for computing lexical distance between languages.
 *
 * Based on research from the Automated Similarity Judgment Program (ASJP) consortium.
 */

interface WordFormData {
  conceptId: string;
  wordForm: string;
  ipa: string | null;
  asjp: string | null;
  dolgo: string | null;
}

interface DistanceMetrics {
  ldnd: number;                    // Levenshtein Distance Normalized Divided
  avgLevenshtein: number;          // Average normalized Levenshtein distance
  comparedWords: number;           // Number of word pairs compared
  coverage: number;                // Percentage of concepts with both translations (0-1)
  sharedCognates: number;          // Estimated number of cognates (simple threshold)
}

interface PairwiseDistanceResult {
  language1: Language;
  language2: Language;
  lexical: DistanceMetrics;
  confidence: number;              // Based on coverage and data quality
}

interface DistanceMatrixResult {
  languages: Language[];
  matrix: number[][];              // Symmetric distance matrix
  metric: 'ldnd' | 'levenshtein';
}

/**
 * Calculate Levenshtein edit distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create distance matrix
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate normalized Levenshtein distance (LDN)
 * Normalized by the length of the longer string
 */
function normalizedLevenshtein(str1: string, str2: string): number {
  if (str1.length === 0 && str2.length === 0) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  return distance / maxLength;
}

/**
 * Parse TSV file for a specific language's word forms
 */
function parseLanguageWordForms(languageId: string): Map<string, WordFormData> {
  const wordForms = new Map<string, WordFormData>();

  // Try to read from individual language file first
  const individualFilePath = path.join(process.cwd(), 'lexicons', `${languageId}.tsv`);
  if (fs.existsSync(individualFilePath)) {
    const content = fs.readFileSync(individualFilePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const header = lines[0].split('\t');

    const idxConceptId = header.indexOf('Concept_ID');
    const idxWordForm = header.indexOf('Word_Form');
    const idxIPA = header.indexOf('IPA');
    const idxASJP = header.indexOf('ASJP');
    const idxDolgo = header.indexOf('Dolgo');

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split('\t');
      const conceptId = row[idxConceptId]?.trim();
      const wordForm = row[idxWordForm]?.trim();

      if (conceptId && wordForm) {
        wordForms.set(conceptId, {
          conceptId,
          wordForm,
          ipa: idxIPA >= 0 ? (row[idxIPA]?.trim() || null) : null,
          asjp: idxASJP >= 0 ? (row[idxASJP]?.trim() || null) : null,
          dolgo: idxDolgo >= 0 ? (row[idxDolgo]?.trim() || null) : null,
        });
      }
    }

    return wordForms;
  }

  // Fall back to main words.tsv file
  const mainFilePath = path.join(process.cwd(), 'lexicons', 'words.tsv');
  if (!fs.existsSync(mainFilePath)) {
    console.warn(`No word forms found for language ${languageId}`);
    return wordForms;
  }

  const content = fs.readFileSync(mainFilePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const header = lines[0].split('\t');

  const idxLanguageId = header.indexOf('Language_ID');
  const idxConceptId = header.indexOf('Concept_ID');
  const idxWordForm = header.indexOf('Word_Form');
  const idxIPA = header.indexOf('IPA');
  const idxASJP = header.indexOf('ASJP');
  const idxDolgo = header.indexOf('Dolgo');

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split('\t');
    const langId = row[idxLanguageId]?.trim();

    if (langId === languageId) {
      const conceptId = row[idxConceptId]?.trim();
      const wordForm = row[idxWordForm]?.trim();

      if (conceptId && wordForm) {
        wordForms.set(conceptId, {
          conceptId,
          wordForm,
          ipa: idxIPA >= 0 ? (row[idxIPA]?.trim() || null) : null,
          asjp: idxASJP >= 0 ? (row[idxASJP]?.trim() || null) : null,
          dolgo: idxDolgo >= 0 ? (row[idxDolgo]?.trim() || null) : null,
        });
      }
    }
  }

  return wordForms;
}

/**
 * Calculate LDND (Levenshtein Distance Normalized Divided) between two languages
 *
 * This is the gold-standard metric from ASJP research.
 * LDND = (avg LDN for same meanings) / (avg LDN for different meanings)
 *
 * This corrects for chance similarity by dividing by baseline randomness.
 *
 * @param lang1Forms - Word forms for first language
 * @param lang2Forms - Word forms for second language
 * @param phoneticMode - Which phonetic encoding to use:
 *   - 'asjp': Simplified phonetic encoding (fast, standard)
 *   - 'ipa': IPA phonetic alphabet (more accurate)
 *   - 'ipa-weighted': IPA with phonetic feature-based distance weighting (most accurate)
 *   - 'wordform': Raw orthography (spelling)
 */
export function calculateLDND(
  lang1Forms: Map<string, WordFormData>,
  lang2Forms: Map<string, WordFormData>,
  phoneticMode: 'asjp' | 'ipa' | 'ipa-weighted' | 'wordform' = 'asjp'
): DistanceMetrics {
  // Find shared concepts (concepts that exist in both languages)
  const sharedConcepts: string[] = [];
  for (const conceptId of lang1Forms.keys()) {
    if (lang2Forms.has(conceptId)) {
      sharedConcepts.push(conceptId);
    }
  }

  if (sharedConcepts.length === 0) {
    // No shared vocabulary - cannot calculate meaningful distance
    return {
      ldnd: -1, // Use -1 to indicate insufficient data
      avgLevenshtein: -1,
      comparedWords: 0,
      coverage: 0,
      sharedCognates: 0,
    };
  }

  // Calculate same-meaning distances
  const sameMeaningDistances: number[] = [];

  for (const conceptId of sharedConcepts) {
    const form1 = lang1Forms.get(conceptId)!;
    const form2 = lang2Forms.get(conceptId)!;

    // Select phonetic representation based on mode
    let str1: string;
    let str2: string;
    let useWeightedDistance = false;

    if ((phoneticMode === 'ipa' || phoneticMode === 'ipa-weighted') && form1.ipa && form2.ipa) {
      // Use IPA (space-separated phonemes, more accurate)
      str1 = form1.ipa.toLowerCase().replace(/\s+/g, ''); // Remove spaces for comparison
      str2 = form2.ipa.toLowerCase().replace(/\s+/g, '');
      useWeightedDistance = phoneticMode === 'ipa-weighted';
    } else if (phoneticMode === 'asjp' && form1.asjp && form2.asjp) {
      // Use ASJP (simplified encoding, faster)
      str1 = form1.asjp.toLowerCase();
      str2 = form2.asjp.toLowerCase();
    } else {
      // Fallback to word forms (orthography)
      str1 = form1.wordForm.toLowerCase();
      str2 = form2.wordForm.toLowerCase();
    }

    // Use phonetic feature-based weighting if in weighted mode
    const ldn = useWeightedDistance
      ? normalizedPhoneticLevenshtein(str1, str2)
      : normalizedLevenshtein(str1, str2);
    sameMeaningDistances.push(ldn);
  }

  const avgSameMeaning = sameMeaningDistances.reduce((a, b) => a + b, 0) / sameMeaningDistances.length;

  // Calculate different-meaning distances (for normalization)
  // Sample random pairs with different meanings
  const differentMeaningDistances: number[] = [];
  const sampleSize = Math.min(100, sharedConcepts.length * 2); // Sample size for efficiency

  const conceptIds1 = Array.from(lang1Forms.keys());
  const conceptIds2 = Array.from(lang2Forms.keys());

  for (let i = 0; i < sampleSize; i++) {
    // Pick two random different concepts
    const idx1 = Math.floor(Math.random() * conceptIds1.length);
    const idx2 = Math.floor(Math.random() * conceptIds2.length);

    const concept1 = conceptIds1[idx1];
    const concept2 = conceptIds2[idx2];

    // Skip if they're the same concept
    if (concept1 === concept2) continue;

    const form1 = lang1Forms.get(concept1)!;
    const form2 = lang2Forms.get(concept2)!;

    // Use same phonetic mode as for same-meaning comparisons
    let str1: string;
    let str2: string;
    let useWeightedDistance = false;

    if ((phoneticMode === 'ipa' || phoneticMode === 'ipa-weighted') && form1.ipa && form2.ipa) {
      str1 = form1.ipa.toLowerCase().replace(/\s+/g, '');
      str2 = form2.ipa.toLowerCase().replace(/\s+/g, '');
      useWeightedDistance = phoneticMode === 'ipa-weighted';
    } else if (phoneticMode === 'asjp' && form1.asjp && form2.asjp) {
      str1 = form1.asjp.toLowerCase();
      str2 = form2.asjp.toLowerCase();
    } else {
      str1 = form1.wordForm.toLowerCase();
      str2 = form2.wordForm.toLowerCase();
    }

    const ldn = useWeightedDistance
      ? normalizedPhoneticLevenshtein(str1, str2)
      : normalizedLevenshtein(str1, str2);
    differentMeaningDistances.push(ldn);
  }

  const avgDifferentMeaning = differentMeaningDistances.length > 0
    ? differentMeaningDistances.reduce((a, b) => a + b, 0) / differentMeaningDistances.length
    : 1.0;

  // Calculate LDND: normalize same-meaning by different-meaning baseline
  const ldnd = avgDifferentMeaning > 0 ? avgSameMeaning / avgDifferentMeaning : avgSameMeaning;

  // Estimate cognates (simple threshold: LDN < 0.5 suggests possible cognate)
  const potentialCognates = sameMeaningDistances.filter(d => d < 0.5).length;

  // Calculate coverage
  const totalConcepts = Math.max(lang1Forms.size, lang2Forms.size);
  const coverage = sharedConcepts.length / totalConcepts;

  return {
    ldnd,
    avgLevenshtein: avgSameMeaning,
    comparedWords: sharedConcepts.length,
    coverage,
    sharedCognates: potentialCognates,
  };
}

/**
 * Calculate pairwise linguistic distance between two languages
 * @param phoneticMode - Which phonetic encoding to use:
 *   - 'asjp': Simplified phonetic encoding (fast, standard)
 *   - 'ipa': IPA phonetic alphabet (default, more accurate)
 *   - 'ipa-weighted': IPA with phonetic feature-based weighting (most accurate)
 *   - 'wordform': Raw orthography
 */
export async function calculatePairwiseDistance(
  lang1: Language,
  lang2: Language,
  phoneticMode: 'asjp' | 'ipa' | 'ipa-weighted' | 'wordform' = 'ipa'
): Promise<PairwiseDistanceResult> {
  // Load word forms for both languages
  const lang1Forms = parseLanguageWordForms(lang1.id);
  const lang2Forms = parseLanguageWordForms(lang2.id);

  // Calculate lexical distance metrics
  const lexical = calculateLDND(lang1Forms, lang2Forms, phoneticMode);

  // Calculate confidence based on coverage and data quality
  // Higher coverage = higher confidence
  const confidence = Math.min(1.0, lexical.coverage * 1.5);

  return {
    language1: lang1,
    language2: lang2,
    lexical,
    confidence,
  };
}

/**
 * Calculate distance matrix for multiple languages
 * Returns a symmetric matrix where matrix[i][j] represents distance between languages[i] and languages[j]
 * @param phoneticMode - Which phonetic encoding to use:
 *   - 'asjp': Simplified phonetic encoding (fast, standard)
 *   - 'ipa': IPA phonetic alphabet (default)
 *   - 'ipa-weighted': IPA with phonetic feature-based weighting (most accurate)
 *   - 'wordform': Raw orthography
 */
export async function calculateDistanceMatrix(
  languages: Language[],
  metric: 'ldnd' | 'levenshtein' = 'ldnd',
  phoneticMode: 'asjp' | 'ipa' | 'ipa-weighted' | 'wordform' = 'ipa'
): Promise<DistanceMatrixResult> {
  const n = languages.length;
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  // Load all language word forms
  const languageForms = languages.map(lang => ({
    language: lang,
    forms: parseLanguageWordForms(lang.id),
  }));

  // Calculate pairwise distances
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const metrics = calculateLDND(
        languageForms[i].forms,
        languageForms[j].forms,
        phoneticMode
      );

      const distance = metric === 'ldnd' ? metrics.ldnd : metrics.avgLevenshtein;
      matrix[i][j] = distance;
      matrix[j][i] = distance; // Symmetric
    }
  }

  return {
    languages,
    matrix,
    metric,
  };
}

/**
 * Find nearest neighbor languages for a given language
 */
export async function findNearestLanguages(
  targetLanguage: Language,
  allLanguages: Language[],
  k: number = 10
): Promise<PairwiseDistanceResult[]> {
  const results: PairwiseDistanceResult[] = [];

  for (const lang of allLanguages) {
    if (lang.id === targetLanguage.id) continue; // Skip self

    const result = await calculatePairwiseDistance(targetLanguage, lang);
    results.push(result);
  }

  // Sort by LDND distance (ascending - lower is more similar)
  results.sort((a, b) => a.lexical.ldnd - b.lexical.ldnd);

  // Return top k
  return results.slice(0, k);
}

/**
 * Calculate genealogical distance between two languages based on family tree
 * Returns the number of steps to common ancestor, or -1 if no common ancestor
 */
export function calculateGenealogyDistance(
  lang1: Language,
  lang2: Language,
  allLanguages: Language[]
): number {
  // Same language
  if (lang1.id === lang2.id) return 0;

  // Different top-level families (no common ancestor in our data)
  if (lang1.familyId !== lang2.familyId) return -1;

  // Build ancestry paths for both languages
  const getAncestryPath = (lang: Language): string[] => {
    const path: string[] = [lang.id];
    let current = lang;

    while (current.parentLanguageId) {
      path.push(current.parentLanguageId);
      const parent = allLanguages.find(l => l.id === current.parentLanguageId);
      if (!parent) break;
      current = parent;
    }

    // Add family ID at the end
    path.push(lang.familyId);

    return path;
  };

  const path1 = getAncestryPath(lang1);
  const path2 = getAncestryPath(lang2);

  // Find common ancestor
  let commonAncestorIdx1 = -1;
  let commonAncestorIdx2 = -1;

  for (let i = 0; i < path1.length; i++) {
    const idx = path2.indexOf(path1[i]);
    if (idx !== -1) {
      commonAncestorIdx1 = i;
      commonAncestorIdx2 = idx;
      break;
    }
  }

  if (commonAncestorIdx1 === -1) {
    // Should not happen if they're in the same family, but handle it
    return -1;
  }

  // Distance is the sum of steps from each language to common ancestor
  return commonAncestorIdx1 + commonAncestorIdx2;
}

/**
 * Calculate geographic distance between two languages using Haversine formula
 * Returns distance in kilometers, or null if coordinates not available
 */
export function calculateGeographicDistance(
  lang1: Language,
  lang2: Language
): number | null {
  if (!lang1.coordinates || !lang2.coordinates) return null;

  const { lat: lat1, lng: lng1 } = lang1.coordinates;
  const { lat: lat2, lng: lng2 } = lang2.coordinates;

  // Haversine formula
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

/**
 * Get list of language IDs that have word data available
 * This filters out languages without lexical data to prevent errors
 */
export function getAvailableLanguageIds(): string[] {
  if (cachedAvailableLanguageIds !== null) {
    return cachedAvailableLanguageIds;
  }

  const availableIds = new Set<string>();

  // Check main words.tsv file
  const mainFilePath = path.join(process.cwd(), 'lexicons', 'words.tsv');
  if (fs.existsSync(mainFilePath)) {
    const content = fs.readFileSync(mainFilePath, 'utf-8');
    const lines = content.split('\n');
    const header = lines[0].split('\t');
    const idxLanguageId = header.indexOf('Language_ID');

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split('\t');
      const langId = row[idxLanguageId]?.trim();
      if (langId) {
        availableIds.add(langId);
      }
    }
  }

  // Check individual language TSV files
  const lexiconsDir = path.join(process.cwd(), 'lexicons');
  if (fs.existsSync(lexiconsDir)) {
    const files = fs.readdirSync(lexiconsDir);
    for (const file of files) {
      if (file.endsWith('.tsv') &&
          file !== 'families.tsv' &&
          file !== 'languages.tsv' &&
          file !== 'words.tsv' &&
          file !== 'words-base.tsv') {
        const langId = file.replace('.tsv', '');
        availableIds.add(langId);
      }
    }
  }

  cachedAvailableLanguageIds = Array.from(availableIds).sort();
  console.log(`[Distance Calculator] Found ${cachedAvailableLanguageIds.length} languages with word data`);

  return cachedAvailableLanguageIds;
}

/**
 * Check if a language has word data available
 */
export function hasWordData(languageId: string): boolean {
  const available = getAvailableLanguageIds();
  return available.includes(languageId);
}
