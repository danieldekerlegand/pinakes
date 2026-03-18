/**
 * Pure computation functions for linguistic analysis.
 * No Node.js or DOM dependencies - safe to run in WebWorkers, server, or main thread.
 */

// ============================================================================
// Types
// ============================================================================

export interface WordFormData {
  conceptId: string;
  wordForm: string;
  ipa: string | null;
  asjp: string | null;
}

export type PhoneticMode = 'asjp' | 'ipa' | 'wordform';

export interface DistanceMetrics {
  ldnd: number;
  avgLevenshtein: number;
  comparedWords: number;
  coverage: number;
  sharedCognates: number;
}

export interface DistanceMatrixResult {
  matrix: number[][];
  metric: 'ldnd' | 'levenshtein';
}

export interface CorrelationEntity {
  id: string;
  name: string;
  domain: string;
  languageIds: string[];
  region: string | null;
  coordinates: { lat: number; lng: number } | null;
  timeStart: number | null;
  timeEnd: number | null;
}

export interface CorrelationEntry {
  entityA: { id: string; name: string; domain: string };
  entityB: { id: string; name: string; domain: string };
  score: number;
  evidence: string[];
}

// ============================================================================
// Worker message types
// ============================================================================

export type ComputationTask =
  | {
      type: 'levenshtein';
      payload: { str1: string; str2: string };
    }
  | {
      type: 'ldnd';
      payload: {
        lang1Forms: [string, WordFormData][];
        lang2Forms: [string, WordFormData][];
        phoneticMode: PhoneticMode;
      };
    }
  | {
      type: 'distanceMatrix';
      payload: {
        languageForms: [string, WordFormData][][];
        metric: 'ldnd' | 'levenshtein';
        phoneticMode: PhoneticMode;
      };
    }
  | {
      type: 'correlationCoOccurrence';
      payload: { entitiesA: CorrelationEntity[]; entitiesB: CorrelationEntity[] };
    }
  | {
      type: 'correlationTemporal';
      payload: { entitiesA: CorrelationEntity[]; entitiesB: CorrelationEntity[] };
    }
  | {
      type: 'correlationGeographic';
      payload: { entitiesA: CorrelationEntity[]; entitiesB: CorrelationEntity[] };
    };

export interface ComputationRequest {
  id: string;
  task: ComputationTask;
}

export interface ComputationResponse {
  id: string;
  result?: unknown;
  error?: string;
  duration: number;
}

// ============================================================================
// Levenshtein distance
// ============================================================================

export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[len1][len2];
}

export function normalizedLevenshtein(str1: string, str2: string): number {
  if (str1.length === 0 && str2.length === 0) return 0;
  const distance = levenshteinDistance(str1, str2);
  return distance / Math.max(str1.length, str2.length);
}

// ============================================================================
// LDND calculation (pure - operates on pre-loaded data)
// ============================================================================

export function calculateLDND(
  lang1Forms: Map<string, WordFormData>,
  lang2Forms: Map<string, WordFormData>,
  phoneticMode: PhoneticMode = 'asjp',
): DistanceMetrics {
  const sharedConcepts: string[] = [];
  for (const conceptId of lang1Forms.keys()) {
    if (lang2Forms.has(conceptId)) {
      sharedConcepts.push(conceptId);
    }
  }

  if (sharedConcepts.length === 0) {
    return { ldnd: -1, avgLevenshtein: -1, comparedWords: 0, coverage: 0, sharedCognates: 0 };
  }

  function getPhoneticString(form: WordFormData): string {
    if (phoneticMode === 'ipa' && form.ipa) {
      return form.ipa.toLowerCase().replace(/\s+/g, '');
    }
    if (phoneticMode === 'asjp' && form.asjp) {
      return form.asjp.toLowerCase();
    }
    return form.wordForm.toLowerCase();
  }

  // Same-meaning distances
  const sameMeaningDistances: number[] = [];
  for (const conceptId of sharedConcepts) {
    const str1 = getPhoneticString(lang1Forms.get(conceptId)!);
    const str2 = getPhoneticString(lang2Forms.get(conceptId)!);
    sameMeaningDistances.push(normalizedLevenshtein(str1, str2));
  }
  const avgSameMeaning = sameMeaningDistances.reduce((a, b) => a + b, 0) / sameMeaningDistances.length;

  // Different-meaning distances (deterministic sampling using modulo)
  const differentMeaningDistances: number[] = [];
  const sampleSize = Math.min(100, sharedConcepts.length * 2);
  const conceptIds1 = Array.from(lang1Forms.keys());
  const conceptIds2 = Array.from(lang2Forms.keys());

  for (let i = 0; i < sampleSize; i++) {
    const idx1 = (i * 7) % conceptIds1.length;
    const idx2 = (i * 13 + 3) % conceptIds2.length;
    const concept1 = conceptIds1[idx1];
    const concept2 = conceptIds2[idx2];
    if (concept1 === concept2) continue;

    const str1 = getPhoneticString(lang1Forms.get(concept1)!);
    const str2 = getPhoneticString(lang2Forms.get(concept2)!);
    differentMeaningDistances.push(normalizedLevenshtein(str1, str2));
  }

  const avgDifferentMeaning = differentMeaningDistances.length > 0
    ? differentMeaningDistances.reduce((a, b) => a + b, 0) / differentMeaningDistances.length
    : 1.0;

  const ldnd = avgDifferentMeaning > 0 ? avgSameMeaning / avgDifferentMeaning : avgSameMeaning;
  const potentialCognates = sameMeaningDistances.filter(d => d < 0.5).length;
  const totalConcepts = Math.max(lang1Forms.size, lang2Forms.size);
  const coverage = sharedConcepts.length / totalConcepts;

  return { ldnd, avgLevenshtein: avgSameMeaning, comparedWords: sharedConcepts.length, coverage, sharedCognates: potentialCognates };
}

// ============================================================================
// Distance matrix (pure computation)
// ============================================================================

export function calculateDistanceMatrixPure(
  languageForms: Map<string, WordFormData>[],
  metric: 'ldnd' | 'levenshtein' = 'ldnd',
  phoneticMode: PhoneticMode = 'asjp',
): DistanceMatrixResult {
  const n = languageForms.length;
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const metrics = calculateLDND(languageForms[i], languageForms[j], phoneticMode);
      const distance = metric === 'ldnd' ? metrics.ldnd : metrics.avgLevenshtein;
      matrix[i][j] = distance;
      matrix[j][i] = distance;
    }
  }

  return { matrix, metric };
}

// ============================================================================
// Correlation algorithms (pure computation)
// ============================================================================

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aLat = (a.lat * Math.PI) / 180;
  const bLat = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function computeCoOccurrence(
  entitiesA: CorrelationEntity[],
  entitiesB: CorrelationEntity[],
): CorrelationEntry[] {
  const correlations: CorrelationEntry[] = [];

  for (const a of entitiesA) {
    if (a.languageIds.length === 0) continue;
    for (const b of entitiesB) {
      if (b.languageIds.length === 0) continue;
      if (a.id === b.id && a.domain === b.domain) continue;

      const shared = a.languageIds.filter((id) => b.languageIds.includes(id));
      if (shared.length === 0) continue;

      const union = new Set([...a.languageIds, ...b.languageIds]);
      const score = shared.length / union.size;

      correlations.push({
        entityA: { id: a.id, name: a.name, domain: a.domain },
        entityB: { id: b.id, name: b.name, domain: b.domain },
        score: Math.round(score * 100) / 100,
        evidence: [
          `Shared language IDs: ${shared.join(", ")}`,
          `Jaccard similarity: ${shared.length}/${union.size}`,
        ],
      });
    }
  }

  return correlations;
}

export function computeTemporalCorrelation(
  entitiesA: CorrelationEntity[],
  entitiesB: CorrelationEntity[],
): CorrelationEntry[] {
  const correlations: CorrelationEntry[] = [];
  const now = new Date().getFullYear();

  for (const a of entitiesA) {
    if (a.timeStart === null) continue;
    const aEnd = a.timeEnd ?? now;
    for (const b of entitiesB) {
      if (b.timeStart === null) continue;
      if (a.id === b.id && a.domain === b.domain) continue;
      const bEnd = b.timeEnd ?? now;

      const overlapStart = Math.max(a.timeStart, b.timeStart);
      const overlapEnd = Math.min(aEnd, bEnd);
      if (overlapStart > overlapEnd) continue;

      const overlapYears = overlapEnd - overlapStart;
      const maxSpan = Math.max(aEnd - a.timeStart, bEnd - b.timeStart, 1);
      const score = Math.min(overlapYears / maxSpan, 1);
      if (score < 0.1) continue;

      const sharedLangs = a.languageIds.filter((id) => b.languageIds.includes(id));
      const boostedScore = Math.min(score + sharedLangs.length * 0.05, 1);

      const evidence = [`Temporal overlap: ${overlapYears} years (${overlapStart} to ${overlapEnd})`];
      if (sharedLangs.length > 0) {
        evidence.push(`Also share languages: ${sharedLangs.join(", ")}`);
      }

      correlations.push({
        entityA: { id: a.id, name: a.name, domain: a.domain },
        entityB: { id: b.id, name: b.name, domain: b.domain },
        score: Math.round(boostedScore * 100) / 100,
        evidence,
      });
    }
  }

  return correlations;
}

export function computeGeographicOverlap(
  entitiesA: CorrelationEntity[],
  entitiesB: CorrelationEntity[],
): CorrelationEntry[] {
  const correlations: CorrelationEntry[] = [];

  for (const a of entitiesA) {
    for (const b of entitiesB) {
      if (a.id === b.id && a.domain === b.domain) continue;

      const evidence: string[] = [];
      let score = 0;

      if (a.coordinates && b.coordinates) {
        const dist = haversineKm(a.coordinates, b.coordinates);
        if (dist < 2000) {
          score = Math.max(score, 1 - dist / 2000);
          evidence.push(`Geographic distance: ${Math.round(dist)} km`);
        }
      }

      if (a.region && b.region) {
        const aReg = a.region.toLowerCase();
        const bReg = b.region.toLowerCase();
        if (aReg === bReg || aReg.includes(bReg) || bReg.includes(aReg)) {
          score = Math.max(score, 0.5);
          evidence.push(`Shared region: ${a.region}`);
        }
      }

      const sharedLangs = a.languageIds.filter((id) => b.languageIds.includes(id));
      if (sharedLangs.length > 0) {
        score = Math.min(score + sharedLangs.length * 0.05, 1);
        evidence.push(`Shared languages: ${sharedLangs.join(", ")}`);
      }

      if (score < 0.1 || evidence.length === 0) continue;

      correlations.push({
        entityA: { id: a.id, name: a.name, domain: a.domain },
        entityB: { id: b.id, name: b.name, domain: b.domain },
        score: Math.round(score * 100) / 100,
        evidence,
      });
    }
  }

  return correlations;
}

// ============================================================================
// Task executor (used by worker and fallback)
// ============================================================================

export function executeTask(task: ComputationTask): unknown {
  switch (task.type) {
    case 'levenshtein':
      return normalizedLevenshtein(task.payload.str1, task.payload.str2);

    case 'ldnd': {
      const lang1 = new Map(task.payload.lang1Forms);
      const lang2 = new Map(task.payload.lang2Forms);
      return calculateLDND(lang1, lang2, task.payload.phoneticMode);
    }

    case 'distanceMatrix': {
      const forms = task.payload.languageForms.map(entries => new Map(entries));
      return calculateDistanceMatrixPure(forms, task.payload.metric, task.payload.phoneticMode);
    }

    case 'correlationCoOccurrence':
      return computeCoOccurrence(task.payload.entitiesA, task.payload.entitiesB);

    case 'correlationTemporal':
      return computeTemporalCorrelation(task.payload.entitiesA, task.payload.entitiesB);

    case 'correlationGeographic':
      return computeGeographicOverlap(task.payload.entitiesA, task.payload.entitiesB);
  }
}
