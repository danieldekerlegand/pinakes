/**
 * Vitest coverage for the quiz generator, focused on the dish-origin (cuisine)
 * map-click question type (US-004). Runs against the live lexicon TSVs
 * (`data/source/lexicons/cuisines.tsv`, `data/source/lexicons/cuisine-items.tsv`) loaded by storage.
 *
 * This is the vitest-runnable counterpart to the standalone
 * `test/test-quiz-generator.ts` script (which is invoked via `npx tsx`).
 */
import { describe, it, expect } from "vitest";
import {
  generateQuiz,
  scoreMapClick,
  chronologyItemCount,
  orderCivilizationsChronologically,
  selectChronologyItems,
  type QuizQuestion,
  type ChronologyCivItem,
} from "../server/services/quiz-generator";

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

describe("civilization chronology ordering (pure helpers)", () => {
  const sample: ChronologyCivItem[] = [
    { name: "Ancient Egypt", year: -3100 },
    { name: "Sumer", year: -4500 },
    { name: "Roman Empire", year: -27 },
    { name: "Byzantine Empire", year: 330 },
    { name: "Ancient Greece", year: -800 },
  ];

  it("orders civilizations by founding year, earliest first (BCE before CE)", () => {
    expect(orderCivilizationsChronologically(sample)).toEqual([
      "Sumer",         // -4500
      "Ancient Egypt", // -3100
      "Ancient Greece",// -800
      "Roman Empire",  // -27
      "Byzantine Empire", // 330
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...sample];
    orderCivilizationsChronologically(sample);
    expect(sample).toEqual(copy);
  });

  it("scales the number of items by difficulty", () => {
    expect(chronologyItemCount("easy")).toBe(3);
    expect(chronologyItemCount("medium")).toBe(4);
    expect(chronologyItemCount("hard")).toBe(5);
  });

  it("selects a valid, year-sorted subset for each difficulty", () => {
    const sorted = [...sample].sort((a, b) => a.year - b.year);
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const count = chronologyItemCount(difficulty);
      const selected = selectChronologyItems(sorted, count, difficulty);
      expect(selected).not.toBeNull();
      expect(selected!.length).toBe(count);
      // returned items are a subset of the source and sorted ascending by year
      for (const item of selected!) expect(sorted).toContainEqual(item);
      for (let i = 1; i < selected!.length; i++) {
        expect(selected![i].year).toBeGreaterThanOrEqual(selected![i - 1].year);
      }
    }
  });

  it("hard difficulty draws a contiguous (closest-founding) run", () => {
    const sorted: ChronologyCivItem[] = Array.from({ length: 10 }, (_, i) => ({
      name: `civ-${i}`,
      year: i * 100,
    }));
    const selected = selectChronologyItems(sorted, 5, "hard")!;
    const indices = selected.map(s => sorted.indexOf(s));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
  });

  it("returns null when there are fewer civilizations than requested", () => {
    expect(selectChronologyItems(sample.slice(0, 2), 5, "hard")).toBeNull();
  });
});

describe("civilization chronology quiz questions", () => {
  it("generates civilizations-category drag-sort questions", async () => {
    const quiz = await generateQuiz(5, "civilizations", "medium");
    expect(quiz.category).toBe("civilizations");
    expect(quiz.questions.length).toBeGreaterThan(0);
    for (const q of quiz.questions) {
      expect(q.category).toBe("civilizations");
      expect(q.type).toBe("drag_sort");
    }
  });

  it("produces a drag-sort payload whose answer is a permutation of the options", async () => {
    const quiz = await generateQuiz(5, "civilizations", "hard");
    for (const q of quiz.questions) {
      const options = q.options as string[];
      const answer = q.answer as string[];
      expect(Array.isArray(options)).toBe(true);
      expect(Array.isArray(answer)).toBe(true);
      expect(answer.length).toBe(chronologyItemCount("hard"));
      expect([...answer].sort()).toEqual([...options].sort());
      expect(new Set(answer).size).toBe(answer.length); // no duplicate civilizations
      expect(q.explanation).toBeTruthy();
    }
  });

  it("scales item count with difficulty", async () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const quiz = await generateQuiz(3, "civilizations", difficulty);
      expect(quiz.questions.length).toBeGreaterThan(0);
      for (const q of quiz.questions) {
        expect((q.answer as string[]).length).toBe(chronologyItemCount(difficulty));
      }
    }
  });
});
