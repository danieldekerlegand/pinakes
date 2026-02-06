/**
 * Phonetic Feature-Based Distance Weighting
 *
 * Uses articulatory phonetics to calculate realistic substitution costs
 * instead of treating all phoneme changes equally.
 *
 * Based on IPA feature matrices from linguistics research.
 */

/**
 * Phonetic features for IPA phonemes
 * Each phoneme is described by its articulatory features
 */
interface PhoneticFeatures {
  // Consonants
  manner?: 'plosive' | 'fricative' | 'affricate' | 'nasal' | 'approximant' | 'trill' | 'tap';
  place?: 'bilabial' | 'labiodental' | 'dental' | 'alveolar' | 'postalveolar' | 'retroflex' | 'palatal' | 'velar' | 'uvular' | 'pharyngeal' | 'glottal';
  voicing?: 'voiced' | 'voiceless';

  // Vowels
  height?: 'close' | 'near-close' | 'close-mid' | 'mid' | 'open-mid' | 'near-open' | 'open';
  backness?: 'front' | 'central' | 'back';
  roundness?: 'rounded' | 'unrounded';

  // General
  type: 'consonant' | 'vowel';
}

/**
 * IPA phoneme feature database
 * Simplified but covers most common phonemes
 */
const phoneticFeatureMap: Record<string, PhoneticFeatures> = {
  // Plosives
  'p': { type: 'consonant', manner: 'plosive', place: 'bilabial', voicing: 'voiceless' },
  'b': { type: 'consonant', manner: 'plosive', place: 'bilabial', voicing: 'voiced' },
  't': { type: 'consonant', manner: 'plosive', place: 'alveolar', voicing: 'voiceless' },
  'd': { type: 'consonant', manner: 'plosive', place: 'alveolar', voicing: 'voiced' },
  'k': { type: 'consonant', manner: 'plosive', place: 'velar', voicing: 'voiceless' },
  'g': { type: 'consonant', manner: 'plosive', place: 'velar', voicing: 'voiced' },
  'ɡ': { type: 'consonant', manner: 'plosive', place: 'velar', voicing: 'voiced' },
  'ʔ': { type: 'consonant', manner: 'plosive', place: 'glottal', voicing: 'voiceless' },

  // Fricatives
  'f': { type: 'consonant', manner: 'fricative', place: 'labiodental', voicing: 'voiceless' },
  'v': { type: 'consonant', manner: 'fricative', place: 'labiodental', voicing: 'voiced' },
  'θ': { type: 'consonant', manner: 'fricative', place: 'dental', voicing: 'voiceless' },
  'ð': { type: 'consonant', manner: 'fricative', place: 'dental', voicing: 'voiced' },
  's': { type: 'consonant', manner: 'fricative', place: 'alveolar', voicing: 'voiceless' },
  'z': { type: 'consonant', manner: 'fricative', place: 'alveolar', voicing: 'voiced' },
  'ʃ': { type: 'consonant', manner: 'fricative', place: 'postalveolar', voicing: 'voiceless' },
  'ʒ': { type: 'consonant', manner: 'fricative', place: 'postalveolar', voicing: 'voiced' },
  'ʂ': { type: 'consonant', manner: 'fricative', place: 'retroflex', voicing: 'voiceless' },
  'ʐ': { type: 'consonant', manner: 'fricative', place: 'retroflex', voicing: 'voiced' },
  'ç': { type: 'consonant', manner: 'fricative', place: 'palatal', voicing: 'voiceless' },
  'ʝ': { type: 'consonant', manner: 'fricative', place: 'palatal', voicing: 'voiced' },
  'x': { type: 'consonant', manner: 'fricative', place: 'velar', voicing: 'voiceless' },
  'ɣ': { type: 'consonant', manner: 'fricative', place: 'velar', voicing: 'voiced' },
  'χ': { type: 'consonant', manner: 'fricative', place: 'uvular', voicing: 'voiceless' },
  'ʁ': { type: 'consonant', manner: 'fricative', place: 'uvular', voicing: 'voiced' },
  'ħ': { type: 'consonant', manner: 'fricative', place: 'pharyngeal', voicing: 'voiceless' },
  'ʕ': { type: 'consonant', manner: 'fricative', place: 'pharyngeal', voicing: 'voiced' },
  'h': { type: 'consonant', manner: 'fricative', place: 'glottal', voicing: 'voiceless' },
  'ɦ': { type: 'consonant', manner: 'fricative', place: 'glottal', voicing: 'voiced' },

  // Affricates
  'ʦ': { type: 'consonant', manner: 'affricate', place: 'alveolar', voicing: 'voiceless' },
  'ʣ': { type: 'consonant', manner: 'affricate', place: 'alveolar', voicing: 'voiced' },
  'ʧ': { type: 'consonant', manner: 'affricate', place: 'postalveolar', voicing: 'voiceless' },
  'ʤ': { type: 'consonant', manner: 'affricate', place: 'postalveolar', voicing: 'voiced' },
  'ʨ': { type: 'consonant', manner: 'affricate', place: 'palatal', voicing: 'voiceless' },
  'ʥ': { type: 'consonant', manner: 'affricate', place: 'palatal', voicing: 'voiced' },

  // Nasals
  'm': { type: 'consonant', manner: 'nasal', place: 'bilabial', voicing: 'voiced' },
  'ɱ': { type: 'consonant', manner: 'nasal', place: 'labiodental', voicing: 'voiced' },
  'n': { type: 'consonant', manner: 'nasal', place: 'alveolar', voicing: 'voiced' },
  'ɳ': { type: 'consonant', manner: 'nasal', place: 'retroflex', voicing: 'voiced' },
  'ɲ': { type: 'consonant', manner: 'nasal', place: 'palatal', voicing: 'voiced' },
  'ŋ': { type: 'consonant', manner: 'nasal', place: 'velar', voicing: 'voiced' },
  'ɴ': { type: 'consonant', manner: 'nasal', place: 'uvular', voicing: 'voiced' },

  // Approximants
  'ʋ': { type: 'consonant', manner: 'approximant', place: 'labiodental', voicing: 'voiced' },
  'ɹ': { type: 'consonant', manner: 'approximant', place: 'alveolar', voicing: 'voiced' },
  'ɻ': { type: 'consonant', manner: 'approximant', place: 'retroflex', voicing: 'voiced' },
  'j': { type: 'consonant', manner: 'approximant', place: 'palatal', voicing: 'voiced' },
  'ɰ': { type: 'consonant', manner: 'approximant', place: 'velar', voicing: 'voiced' },
  'w': { type: 'consonant', manner: 'approximant', place: 'velar', voicing: 'voiced' },
  'l': { type: 'consonant', manner: 'approximant', place: 'alveolar', voicing: 'voiced' },
  'ɭ': { type: 'consonant', manner: 'approximant', place: 'retroflex', voicing: 'voiced' },
  'ʎ': { type: 'consonant', manner: 'approximant', place: 'palatal', voicing: 'voiced' },
  'ʟ': { type: 'consonant', manner: 'approximant', place: 'velar', voicing: 'voiced' },
  'r': { type: 'consonant', manner: 'trill', place: 'alveolar', voicing: 'voiced' },
  'ʀ': { type: 'consonant', manner: 'trill', place: 'uvular', voicing: 'voiced' },
  'ɾ': { type: 'consonant', manner: 'tap', place: 'alveolar', voicing: 'voiced' },
  'ɽ': { type: 'consonant', manner: 'tap', place: 'retroflex', voicing: 'voiced' },

  // Close vowels
  'i': { type: 'vowel', height: 'close', backness: 'front', roundness: 'unrounded' },
  'y': { type: 'vowel', height: 'close', backness: 'front', roundness: 'rounded' },
  'ɨ': { type: 'vowel', height: 'close', backness: 'central', roundness: 'unrounded' },
  'ʉ': { type: 'vowel', height: 'close', backness: 'central', roundness: 'rounded' },
  'ɯ': { type: 'vowel', height: 'close', backness: 'back', roundness: 'unrounded' },
  'u': { type: 'vowel', height: 'close', backness: 'back', roundness: 'rounded' },

  // Near-close vowels
  'ɪ': { type: 'vowel', height: 'near-close', backness: 'front', roundness: 'unrounded' },
  'ʏ': { type: 'vowel', height: 'near-close', backness: 'front', roundness: 'rounded' },
  'ʊ': { type: 'vowel', height: 'near-close', backness: 'back', roundness: 'rounded' },

  // Close-mid vowels
  'e': { type: 'vowel', height: 'close-mid', backness: 'front', roundness: 'unrounded' },
  'ø': { type: 'vowel', height: 'close-mid', backness: 'front', roundness: 'rounded' },
  'ɘ': { type: 'vowel', height: 'close-mid', backness: 'central', roundness: 'unrounded' },
  'ɵ': { type: 'vowel', height: 'close-mid', backness: 'central', roundness: 'rounded' },
  'ɤ': { type: 'vowel', height: 'close-mid', backness: 'back', roundness: 'unrounded' },
  'o': { type: 'vowel', height: 'close-mid', backness: 'back', roundness: 'rounded' },

  // Mid vowels
  'ə': { type: 'vowel', height: 'mid', backness: 'central', roundness: 'unrounded' },

  // Open-mid vowels
  'ɛ': { type: 'vowel', height: 'open-mid', backness: 'front', roundness: 'unrounded' },
  'œ': { type: 'vowel', height: 'open-mid', backness: 'front', roundness: 'rounded' },
  'ɜ': { type: 'vowel', height: 'open-mid', backness: 'central', roundness: 'unrounded' },
  'ɞ': { type: 'vowel', height: 'open-mid', backness: 'central', roundness: 'rounded' },
  'ʌ': { type: 'vowel', height: 'open-mid', backness: 'back', roundness: 'unrounded' },
  'ɔ': { type: 'vowel', height: 'open-mid', backness: 'back', roundness: 'rounded' },

  // Near-open vowels
  'æ': { type: 'vowel', height: 'near-open', backness: 'front', roundness: 'unrounded' },
  'ɐ': { type: 'vowel', height: 'near-open', backness: 'central', roundness: 'unrounded' },

  // Open vowels
  'a': { type: 'vowel', height: 'open', backness: 'front', roundness: 'unrounded' },
  'ɶ': { type: 'vowel', height: 'open', backness: 'front', roundness: 'rounded' },
  'ɑ': { type: 'vowel', height: 'open', backness: 'back', roundness: 'unrounded' },
  'ɒ': { type: 'vowel', height: 'open', backness: 'back', roundness: 'rounded' },
};

/**
 * Feature distance weights
 * How different are various feature changes?
 */
const featureWeights = {
  // Consonant feature differences
  voicing: 0.2,           // p→b (common sound change)
  place1Step: 0.3,        // p→t (adjacent places)
  place2Steps: 0.5,       // p→k (distant places)
  place3Steps: 0.7,       // p→ʔ (very distant)
  mannerSimilar: 0.4,     // plosive→affricate
  mannerDifferent: 0.8,   // plosive→fricative
  mannerVeryDifferent: 1.0, // plosive→approximant

  // Vowel feature differences
  height1Step: 0.25,      // i→ɪ (one step in height)
  height2Steps: 0.5,      // i→e (two steps)
  height3Steps: 0.75,     // i→a (three steps)
  backness1Step: 0.3,     // i→ɨ (front→central)
  backness2Steps: 0.6,    // i→u (front→back)
  roundness: 0.2,         // i→y (rounding change)

  // Cross-category
  consonantVowel: 1.0,    // Maximum distance
};

/**
 * Place of articulation ordering (for calculating distance)
 */
const placeOrder: Record<string, number> = {
  'bilabial': 0,
  'labiodental': 1,
  'dental': 2,
  'alveolar': 3,
  'postalveolar': 4,
  'retroflex': 5,
  'palatal': 6,
  'velar': 7,
  'uvular': 8,
  'pharyngeal': 9,
  'glottal': 10,
};

/**
 * Manner of articulation similarity matrix
 */
const mannerSimilarity: Record<string, Record<string, number>> = {
  'plosive': { 'plosive': 0, 'affricate': 0.4, 'fricative': 0.6, 'nasal': 0.5, 'approximant': 1.0, 'trill': 0.9, 'tap': 0.9 },
  'affricate': { 'plosive': 0.4, 'affricate': 0, 'fricative': 0.3, 'nasal': 0.8, 'approximant': 0.9, 'trill': 1.0, 'tap': 1.0 },
  'fricative': { 'plosive': 0.6, 'affricate': 0.3, 'fricative': 0, 'nasal': 0.8, 'approximant': 0.7, 'trill': 0.9, 'tap': 0.9 },
  'nasal': { 'plosive': 0.5, 'affricate': 0.8, 'fricative': 0.8, 'nasal': 0, 'approximant': 0.4, 'trill': 0.6, 'tap': 0.6 },
  'approximant': { 'plosive': 1.0, 'affricate': 0.9, 'fricative': 0.7, 'nasal': 0.4, 'approximant': 0, 'trill': 0.3, 'tap': 0.3 },
  'trill': { 'plosive': 0.9, 'affricate': 1.0, 'fricative': 0.9, 'nasal': 0.6, 'approximant': 0.3, 'trill': 0, 'tap': 0.2 },
  'tap': { 'plosive': 0.9, 'affricate': 1.0, 'fricative': 0.9, 'nasal': 0.6, 'approximant': 0.3, 'trill': 0.2, 'tap': 0 },
};

/**
 * Height ordering for vowels
 */
const heightOrder: Record<string, number> = {
  'close': 0,
  'near-close': 1,
  'close-mid': 2,
  'mid': 3,
  'open-mid': 4,
  'near-open': 5,
  'open': 6,
};

/**
 * Backness ordering for vowels
 */
const backnessOrder: Record<string, number> = {
  'front': 0,
  'central': 1,
  'back': 2,
};

/**
 * Calculate phonetic distance between two IPA phonemes
 * Returns a value between 0 (identical) and 1 (maximally different)
 */
export function calculatePhoneticDistance(phoneme1: string, phoneme2: string): number {
  // Identical phonemes
  if (phoneme1 === phoneme2) return 0;

  // Get features
  const features1 = phoneticFeatureMap[phoneme1];
  const features2 = phoneticFeatureMap[phoneme2];

  // Unknown phonemes - fall back to simple edit distance
  if (!features1 || !features2) return 1.0;

  // Cross-category (consonant vs vowel) = maximum distance
  if (features1.type !== features2.type) {
    return featureWeights.consonantVowel;
  }

  // Consonant distance
  if (features1.type === 'consonant' && features2.type === 'consonant') {
    let distance = 0;

    // Voicing difference
    if (features1.voicing !== features2.voicing) {
      distance += featureWeights.voicing;
    }

    // Place difference
    if (features1.place && features2.place) {
      const placeDiff = Math.abs(placeOrder[features1.place] - placeOrder[features2.place]);
      if (placeDiff === 1) distance += featureWeights.place1Step;
      else if (placeDiff === 2) distance += featureWeights.place2Steps;
      else if (placeDiff >= 3) distance += featureWeights.place3Steps;
    }

    // Manner difference
    if (features1.manner && features2.manner) {
      const mannerDist = mannerSimilarity[features1.manner]?.[features2.manner] ?? 1.0;
      distance += mannerDist;
    }

    // Normalize (max possible: voicing + place + manner = 0.2 + 0.7 + 1.0 = 1.9)
    return Math.min(1.0, distance / 1.9);
  }

  // Vowel distance
  if (features1.type === 'vowel' && features2.type === 'vowel') {
    let distance = 0;

    // Height difference
    if (features1.height && features2.height) {
      const heightDiff = Math.abs(heightOrder[features1.height] - heightOrder[features2.height]);
      if (heightDiff === 1) distance += featureWeights.height1Step;
      else if (heightDiff === 2) distance += featureWeights.height2Steps;
      else if (heightDiff >= 3) distance += featureWeights.height3Steps;
    }

    // Backness difference
    if (features1.backness && features2.backness) {
      const backnessDiff = Math.abs(backnessOrder[features1.backness] - backnessOrder[features2.backness]);
      if (backnessDiff === 1) distance += featureWeights.backness1Step;
      else if (backnessDiff >= 2) distance += featureWeights.backness2Steps;
    }

    // Roundness difference
    if (features1.roundness !== features2.roundness) {
      distance += featureWeights.roundness;
    }

    // Normalize (max possible: height + backness + roundness = 0.75 + 0.6 + 0.2 = 1.55)
    return Math.min(1.0, distance / 1.55);
  }

  // Fallback
  return 1.0;
}

/**
 * Calculate weighted Levenshtein distance using phonetic features
 * This is more accurate than standard Levenshtein for phonetic data
 */
export function phoneticLevenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create distance matrix
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill in the rest of the matrix with phonetic weights
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const phoneme1 = str1[i - 1];
      const phoneme2 = str2[j - 1];

      // Substitution cost based on phonetic features
      const substitutionCost = calculatePhoneticDistance(phoneme1, phoneme2);

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,                           // deletion
        matrix[i][j - 1] + 1,                           // insertion
        matrix[i - 1][j - 1] + substitutionCost         // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate normalized phonetic Levenshtein distance
 */
export function normalizedPhoneticLevenshtein(str1: string, str2: string): number {
  if (str1.length === 0 && str2.length === 0) return 0;

  const distance = phoneticLevenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  return distance / maxLength;
}
