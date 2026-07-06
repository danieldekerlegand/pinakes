/**
 * Test script for quiz generation service
 * Run with: npx tsx test/test-quiz-generator.ts
 */

import { generateQuiz, scoreMapClick, type QuizQuestion } from "../server/services/quiz-generator";

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

async function testGenerateQuiz() {
  console.log("\n=== Quiz Generation Tests ===\n");

  // Test: mixed category generates questions
  console.log("--- Mixed category quiz ---");
  const mixedQuiz = await generateQuiz(5, "mixed", "medium");
  assert(mixedQuiz.questions.length > 0, `Generated ${mixedQuiz.questions.length} mixed questions (expected > 0)`);
  assert(mixedQuiz.category === "mixed", "Category is mixed");
  assert(mixedQuiz.difficulty === "medium", "Difficulty is medium");

  // Test: each question has required fields
  console.log("\n--- Question structure ---");
  for (const q of mixedQuiz.questions) {
    assert(!!q.id, `Question has id: ${q.id}`);
    assert(!!q.type, `Question has type: ${q.type}`);
    assert(!!q.question, `Question has text: ${q.question.slice(0, 50)}...`);
    assert(!!q.category, `Question has category: ${q.category}`);
    assert(!!q.difficulty, `Question has difficulty: ${q.difficulty}`);
    assert(q.answer !== undefined && q.answer !== null, "Question has answer");
  }

  // Test: multiple choice questions have options
  console.log("\n--- Multiple choice validation ---");
  const mcQuestions = mixedQuiz.questions.filter(q => q.type === "multiple_choice");
  for (const q of mcQuestions) {
    assert(Array.isArray(q.options), "MC question has options array");
    assert((q.options?.length || 0) >= 2, `MC question has ${q.options?.length} options (>= 2)`);
    assert(typeof q.answer === "number", "MC answer is a number (index)");
    assert((q.answer as number) >= 0 && (q.answer as number) < (q.options?.length || 0), "MC answer index is valid");
  }

  // Test: drag sort questions have options and answer array
  console.log("\n--- Drag sort validation ---");
  const dsQuestions = mixedQuiz.questions.filter(q => q.type === "drag_sort");
  for (const q of dsQuestions) {
    assert(Array.isArray(q.options), "Drag sort has options array");
    assert(Array.isArray(q.answer), "Drag sort answer is an array");
    const ans = q.answer as string[];
    assert(ans.length === (q.options?.length || 0), "Answer length matches options length");
    // Verify answer contains same items as options
    const optionsSorted = [...(q.options || [])].sort();
    const answerSorted = [...ans].sort();
    assert(JSON.stringify(optionsSorted) === JSON.stringify(answerSorted), "Answer contains same items as options");
  }

  // Test: map click questions have coordinate answer
  console.log("\n--- Map click validation ---");
  const mapQuestions = mixedQuiz.questions.filter(q => q.type === "map_click");
  for (const q of mapQuestions) {
    const ans = q.answer as { lat: number; lng: number };
    assert(typeof ans.lat === "number", "Map click answer has lat");
    assert(typeof ans.lng === "number", "Map click answer has lng");
    assert(ans.lat >= -90 && ans.lat <= 90, `Latitude ${ans.lat} is valid`);
    assert(ans.lng >= -180 && ans.lng <= 180, `Longitude ${ans.lng} is valid`);
  }

  // Test: specific categories
  console.log("\n--- Category-specific generation ---");
  const familyQuiz = await generateQuiz(3, "families", "easy");
  assert(familyQuiz.questions.length > 0, `Family quiz generated ${familyQuiz.questions.length} questions`);
  for (const q of familyQuiz.questions) {
    assert(q.category === "families", `Family question category is 'families' (got '${q.category}')`);
  }

  const geoQuiz = await generateQuiz(3, "geography", "medium");
  assert(geoQuiz.questions.length > 0, `Geography quiz generated ${geoQuiz.questions.length} questions`);
  for (const q of geoQuiz.questions) {
    assert(q.category === "geography", `Geography question category is 'geography' (got '${q.category}')`);
  }

  // Test: difficulty levels
  console.log("\n--- Difficulty levels ---");
  for (const diff of ["easy", "medium", "hard"] as const) {
    const quiz = await generateQuiz(2, "mixed", diff);
    assert(quiz.difficulty === diff, `Quiz difficulty is ${diff}`);
    for (const q of quiz.questions) {
      assert(q.difficulty === diff, `Question difficulty matches: ${diff}`);
    }
  }

  // Test: count limiting
  console.log("\n--- Question count ---");
  const smallQuiz = await generateQuiz(3, "mixed", "easy");
  assert(smallQuiz.questions.length <= 3, `Requested 3, got ${smallQuiz.questions.length} (<= 3)`);

  // Test: dish-origin (cuisine) map-click questions (US-004)
  console.log("\n--- Dish-origin (cuisine) questions ---");
  const cuisineQuiz = await generateQuiz(5, "cuisine", "medium");
  assert(cuisineQuiz.questions.length > 0, `Cuisine quiz generated ${cuisineQuiz.questions.length} questions`);
  for (const q of cuisineQuiz.questions) {
    assert(q.category === "cuisine", `Cuisine question category is 'cuisine' (got '${q.category}')`);
    assert(q.type === "map_click", `Cuisine question is a map_click (got '${q.type}')`);
    const ans = q.answer as { lat: number; lng: number };
    assert(typeof ans.lat === "number" && typeof ans.lng === "number", "Dish answer has lat/lng coordinates");
    assert(!(ans.lat === 0 && ans.lng === 0), "Dish origin is not the {0,0} sentinel");
    assert(q.question.includes("dish"), "Dish question text references the dish");
  }
}

function testScoreMapClick() {
  console.log("\n=== Map Click Scoring Tests ===\n");

  // Test: exact match
  const exact = scoreMapClick({ lat: 48.8, lng: 2.3 }, { lat: 48.8, lng: 2.3 }, "hard");
  assert(exact.correct === true, "Exact match is correct");
  assert(exact.distanceKm < 1, `Exact match distance is ~0 (got ${exact.distanceKm.toFixed(2)}km)`);

  // Test: nearby guess (Paris to London ~340km)
  const nearby = scoreMapClick({ lat: 48.8, lng: 2.3 }, { lat: 51.5, lng: -0.1 }, "easy");
  assert(nearby.distanceKm > 300 && nearby.distanceKm < 400, `Paris-London distance ~340km (got ${nearby.distanceKm.toFixed(0)}km)`);
  assert(nearby.correct === true, "Paris-London is correct on easy (threshold 1500km)");

  // Test: far guess on hard difficulty (Paris to Moscow ~2500km)
  const far = scoreMapClick({ lat: 48.8, lng: 2.3 }, { lat: 55.75, lng: 37.6 }, "hard");
  assert(far.correct === false, "Paris-Moscow is incorrect on hard (threshold 400km)");

  // Test: opposite side of world
  const opposite = scoreMapClick({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }, "easy");
  assert(opposite.distanceKm > 15000, `Antipodal distance > 15000km (got ${opposite.distanceKm.toFixed(0)}km)`);
  assert(opposite.correct === false, "Antipodal guess is incorrect even on easy");
}

async function main() {
  console.log("=== Quiz Generator Test Suite ===");

  await testGenerateQuiz();
  testScoreMapClick();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
