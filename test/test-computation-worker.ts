/**
 * Test script for shared computation module and worker infrastructure.
 * Tests pure computation functions that power both server-side and WebWorker execution.
 *
 * Run with: npx tsx test/test-computation-worker.ts
 */

import {
  levenshteinDistance,
  normalizedLevenshtein,
  calculateLDND,
  calculateDistanceMatrixPure,
  computeCoOccurrence,
  computeTemporalCorrelation,
  computeGeographicOverlap,
  executeTask,
} from "../shared/computation";
import type { WordFormData, CorrelationEntity } from "../shared/computation";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message} (got ${actual.toFixed(4)}, expected ~${expected} ±${tolerance})`);
}

// ============================================================================
// Levenshtein tests
// ============================================================================

console.log("\n=== Levenshtein Distance Tests ===\n");

assert(levenshteinDistance("", "") === 0, "Empty strings have distance 0");
assert(levenshteinDistance("abc", "abc") === 0, "Identical strings have distance 0");
assert(levenshteinDistance("kitten", "sitting") === 3, "kitten→sitting = 3");
assert(levenshteinDistance("abc", "") === 3, "abc→empty = 3");
assert(levenshteinDistance("", "abc") === 3, "empty→abc = 3");
assert(levenshteinDistance("a", "b") === 1, "Single char substitution = 1");

console.log("\n=== Normalized Levenshtein Tests ===\n");

assertApprox(normalizedLevenshtein("", ""), 0, 0.001, "Empty strings = 0");
assertApprox(normalizedLevenshtein("abc", "abc"), 0, 0.001, "Identical = 0");
assertApprox(normalizedLevenshtein("abc", ""), 1, 0.001, "Complete difference = 1");
assertApprox(normalizedLevenshtein("ab", "cd"), 1, 0.001, "No shared chars = 1");
assertApprox(normalizedLevenshtein("kitten", "sitting"), 3 / 7, 0.001, "kitten/sitting normalized");

// ============================================================================
// LDND tests
// ============================================================================

console.log("\n=== LDND Calculation Tests ===\n");

// Create mock language word forms
function makeForms(entries: [string, string, string | null][]): Map<string, WordFormData> {
  const map = new Map<string, WordFormData>();
  for (const [conceptId, wordForm, asjp] of entries) {
    map.set(conceptId, { conceptId, wordForm, ipa: null, asjp });
  }
  return map;
}

// Two identical languages should have LDND ~0 (or very low)
const identicalForms = makeForms([
  ["water", "water", "wAter"],
  ["fire", "fire", "fAyr"],
  ["sun", "sun", "sun"],
]);

const identicalResult = calculateLDND(identicalForms, identicalForms, "asjp");
assertApprox(identicalResult.avgLevenshtein, 0, 0.001, "Identical languages have 0 avg Levenshtein");
assert(identicalResult.comparedWords === 3, "Compared all 3 shared concepts");
assertApprox(identicalResult.coverage, 1, 0.001, "Full coverage for identical forms");

// Similar languages
const lang1Forms = makeForms([
  ["water", "wasser", "wasEr"],
  ["fire", "feuer", "foyEr"],
  ["sun", "sonne", "zonE"],
  ["moon", "mond", "mont"],
]);

const lang2Forms = makeForms([
  ["water", "water", "wAtEr"],
  ["fire", "fire", "fAyr"],
  ["sun", "sun", "sun"],
  ["moon", "moon", "mun"],
]);

const similarResult = calculateLDND(lang1Forms, lang2Forms, "asjp");
assert(similarResult.ldnd > 0, "Similar languages have positive LDND");
assert(similarResult.comparedWords === 4, "Compared 4 shared concepts");
assertApprox(similarResult.coverage, 1, 0.001, "Full coverage");

// No shared concepts
const noOverlapForms = makeForms([
  ["bread", "brot", "brot"],
  ["milk", "milch", "milx"],
]);

const noOverlapResult = calculateLDND(identicalForms, noOverlapForms, "asjp");
assert(noOverlapResult.ldnd === -1, "No shared concepts returns -1 LDND");
assert(noOverlapResult.comparedWords === 0, "No compared words");

// Wordform mode
const wordformResult = calculateLDND(lang1Forms, lang2Forms, "wordform");
assert(wordformResult.ldnd > 0, "Wordform mode produces positive LDND");
assert(wordformResult.comparedWords === 4, "Wordform mode compares same concepts");

// ============================================================================
// Distance Matrix tests
// ============================================================================

console.log("\n=== Distance Matrix Tests ===\n");

const matrixResult = calculateDistanceMatrixPure(
  [identicalForms, lang1Forms, lang2Forms],
  "ldnd",
  "asjp",
);

assert(matrixResult.matrix.length === 3, "Matrix has correct dimensions");
assert(matrixResult.matrix[0].length === 3, "Matrix rows have correct length");
assertApprox(matrixResult.matrix[0][0], 0, 0.001, "Self-distance is 0");
assertApprox(matrixResult.matrix[1][1], 0, 0.001, "Self-distance is 0");
assert(
  Math.abs(matrixResult.matrix[0][1] - matrixResult.matrix[1][0]) < 0.0001,
  "Matrix is symmetric",
);
assert(matrixResult.metric === "ldnd", "Metric is preserved");

// ============================================================================
// Correlation algorithm tests
// ============================================================================

console.log("\n=== Correlation Algorithm Tests ===\n");

const entityA1: CorrelationEntity = {
  id: "lang-eng", name: "English", domain: "language",
  languageIds: ["eng", "sco"], region: "Europe", coordinates: { lat: 51.5, lng: -0.1 },
  timeStart: null, timeEnd: null,
};

const entityA2: CorrelationEntity = {
  id: "lang-jpn", name: "Japanese", domain: "language",
  languageIds: ["jpn"], region: "East Asia", coordinates: { lat: 35.7, lng: 139.7 },
  timeStart: null, timeEnd: null,
};

const entityB1: CorrelationEntity = {
  id: "civ-brit", name: "British Empire", domain: "civilization",
  languageIds: ["eng", "sco", "cym"], region: "Europe", coordinates: { lat: 51.5, lng: -0.1 },
  timeStart: 1600, timeEnd: 1997,
};

const entityB2: CorrelationEntity = {
  id: "civ-tokugawa", name: "Tokugawa Japan", domain: "civilization",
  languageIds: ["jpn"], region: "East Asia", coordinates: { lat: 35.7, lng: 139.7 },
  timeStart: 1603, timeEnd: 1868,
};

// Co-occurrence
const coOccurrence = computeCoOccurrence([entityA1, entityA2], [entityB1, entityB2]);
assert(coOccurrence.length > 0, "Co-occurrence finds correlations");
const engBrit = coOccurrence.find(
  (c) => c.entityA.id === "lang-eng" && c.entityB.id === "civ-brit",
);
assert(engBrit !== undefined, "English ↔ British Empire found");
assert(engBrit!.score > 0, "English ↔ British Empire has positive score");

// Temporal correlation
const temporalEntA: CorrelationEntity = {
  ...entityA1, timeStart: 1500, timeEnd: 2000,
};
const temporalEntB: CorrelationEntity = {
  ...entityB1, timeStart: 1600, timeEnd: 1997,
};
const temporalCorr = computeTemporalCorrelation([temporalEntA], [temporalEntB]);
assert(temporalCorr.length > 0, "Temporal correlation finds overlapping periods");
assert(temporalCorr[0].score > 0.5, "High overlap period gets high score");

// Geographic overlap
const geoCorr = computeGeographicOverlap([entityA1], [entityB1]);
assert(geoCorr.length > 0, "Geographic overlap finds nearby entities");
const geoEng = geoCorr.find(
  (c) => c.entityA.id === "lang-eng" && c.entityB.id === "civ-brit",
);
assert(geoEng !== undefined, "Same-location entities correlated");
assert(geoEng!.score > 0.9, "Entities at same coordinates have high score");

// Distant entities should not correlate geographically
const geoDistant = computeGeographicOverlap([entityA1], [entityB2]);
const distantMatch = geoDistant.find(
  (c) => c.entityA.id === "lang-eng" && c.entityB.id === "civ-tokugawa",
);
// They're ~9500km apart, should not be within 2000km threshold
assert(
  distantMatch === undefined || distantMatch.score < 0.1,
  "Distant entities have low/no geographic correlation",
);

// ============================================================================
// executeTask tests (the function used by the worker)
// ============================================================================

console.log("\n=== executeTask (Worker Interface) Tests ===\n");

// Levenshtein task
const levResult = executeTask({
  type: "levenshtein",
  payload: { str1: "kitten", str2: "sitting" },
});
assertApprox(levResult as number, 3 / 7, 0.001, "executeTask: levenshtein works");

// LDND task
const ldndResult = executeTask({
  type: "ldnd",
  payload: {
    lang1Forms: Array.from(lang1Forms.entries()),
    lang2Forms: Array.from(lang2Forms.entries()),
    phoneticMode: "asjp",
  },
}) as { ldnd: number; comparedWords: number };
assert(ldndResult.ldnd > 0, "executeTask: ldnd produces positive result");
assert(ldndResult.comparedWords === 4, "executeTask: ldnd compared correct number of words");

// Distance matrix task
const matResult = executeTask({
  type: "distanceMatrix",
  payload: {
    languageForms: [
      Array.from(lang1Forms.entries()),
      Array.from(lang2Forms.entries()),
    ],
    metric: "ldnd",
    phoneticMode: "asjp",
  },
}) as { matrix: number[][] };
assert(matResult.matrix.length === 2, "executeTask: matrix has correct dimensions");
assert(matResult.matrix[0][0] === 0, "executeTask: matrix self-distance is 0");

// Co-occurrence task
const coResult = executeTask({
  type: "correlationCoOccurrence",
  payload: { entitiesA: [entityA1], entitiesB: [entityB1] },
}) as { length: number }[];
assert(Array.isArray(coResult), "executeTask: co-occurrence returns array");

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
