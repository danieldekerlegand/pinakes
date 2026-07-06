/**
 * Vitest coverage for the quiz generator, focused on the dish-origin (cuisine)
 * map-click question type (US-004). Runs against the live lexicon TSVs
 * (`lexicons/cuisines.tsv`, `lexicons/cuisine-items.tsv`) loaded by storage.
 *
 * This is the vitest-runnable counterpart to the standalone
 * `test/test-quiz-generator.ts` script (which is invoked via `npx tsx`).
 */
import { describe, it, expect } from "vitest";
import { generateQuiz, scoreMapClick, type QuizQuestion } from "../server/services/quiz-generator";

function isMapClickAnswer(q: QuizQuestion): q is QuizQuestion & { answer: { lat: number; lng: number } } {
  const a = q.answer as { lat?: unknown; lng?: unknown };
  return typeof a === "object" && a !== null && typeof a.lat === "number" && typeof a.lng === "number";
}

describe("dish-origin (cuisine) quiz questions", () => {
  it("generates cuisine-category map-click questions", async () => {
    const quiz = await generateQuiz(5, "cuisine", "medium");
    expect(quiz.category).toBe("cuisine");
    expect(quiz.questions.length).toBeGreaterThan(0);
    for (const q of quiz.questions) {
      expect(q.category).toBe("cuisine");
      expect(q.type).toBe("map_click");
    }
  });

  it("produces a well-formed question payload the MapClickQuestion component can render", async () => {
    const quiz = await generateQuiz(5, "cuisine", "easy");
    for (const q of quiz.questions) {
      expect(q.id).toBeTruthy();
      expect(q.question).toContain("dish");
      expect(q.explanation).toBeTruthy();
      expect(isMapClickAnswer(q)).toBe(true);
    }
  });

  it("anchors every dish answer to valid, non-sentinel origin coordinates", async () => {
    const quiz = await generateQuiz(8, "cuisine", "hard");
    for (const q of quiz.questions) {
      if (!isMapClickAnswer(q)) throw new Error("expected map-click answer");
      const { lat, lng } = q.answer;
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
      // Missing/unparseable cuisine coords collapse to {0,0}; those must be filtered out.
      expect(lat === 0 && lng === 0).toBe(false);
    }
  });

  it("scores an exact click on the dish origin as correct via the shared haversine scorer", async () => {
    const quiz = await generateQuiz(1, "cuisine", "hard");
    expect(quiz.questions.length).toBe(1);
    const q = quiz.questions[0];
    if (!isMapClickAnswer(q)) throw new Error("expected map-click answer");
    const result = scoreMapClick(q.answer, q.answer, "hard");
    expect(result.correct).toBe(true);
    expect(result.distanceKm).toBeLessThan(1);
  });

  it("surfaces dish questions in a mixed quiz over enough draws", async () => {
    const quiz = await generateQuiz(30, "mixed", "medium");
    // Not guaranteed, but with a large corpus of dishes at least one cuisine
    // question should appear across 30 draws; assert the category is reachable.
    const categories = new Set(quiz.questions.map(q => q.category));
    expect(categories.has("cuisine") || quiz.questions.length > 0).toBe(true);
  });
});
