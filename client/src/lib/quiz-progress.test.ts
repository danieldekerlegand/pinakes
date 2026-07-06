import { describe, it, expect } from "vitest";

import {
  QUIZ_AUTOSCALE_KEY,
  QUIZ_HISTORY_KEY,
  addResult,
  categoryMastery,
  clearHistory,
  computeDayStreak,
  computeWinStreak,
  dayNumber,
  isPass,
  loadAutoScale,
  loadHistory,
  overallStats,
  parseHistory,
  saveAutoScale,
  scorePct,
  suggestDifficulty,
  type Difficulty,
  type QuizResult,
  type QuizStorage,
} from "./quiz-progress";

const MS_PER_DAY = 86_400_000;

/** In-memory QuizStorage stub for node-env tests. */
function memoryStorage(seed: Record<string, string> = {}): QuizStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function makeResult(overrides: Partial<QuizResult> = {}): QuizResult {
  return {
    id: overrides.id ?? "r1",
    category: overrides.category ?? "languages",
    difficulty: overrides.difficulty ?? "medium",
    correct: overrides.correct ?? 8,
    total: overrides.total ?? 10,
    timestamp: overrides.timestamp ?? 0,
  };
}

describe("scorePct / isPass", () => {
  it("rounds the percentage and guards against total 0", () => {
    expect(scorePct({ correct: 8, total: 10 })).toBe(80);
    expect(scorePct({ correct: 1, total: 3 })).toBe(33);
    expect(scorePct({ correct: 0, total: 0 })).toBe(0);
  });

  it("passes at or above the 60% threshold", () => {
    expect(isPass({ correct: 6, total: 10 })).toBe(true);
    expect(isPass({ correct: 5, total: 10 })).toBe(false);
    expect(isPass({ correct: 5, total: 10 }, 50)).toBe(true);
  });
});

describe("parseHistory", () => {
  it("returns [] for null / invalid JSON / non-array", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("not json")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
  });

  it("drops malformed rows but keeps valid ones", () => {
    const raw = JSON.stringify([
      makeResult({ id: "ok" }),
      { id: "bad", category: "x", difficulty: "medium", correct: 5, total: 0, timestamp: 1 }, // total 0
      { id: "bad2", category: "x", difficulty: "impossible", correct: 1, total: 2, timestamp: 1 }, // bad difficulty
      { id: "bad3", category: "x", difficulty: "easy", correct: 5, total: 2, timestamp: 1 }, // correct > total
      "garbage",
    ]);
    const parsed = parseHistory(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("ok");
  });
});

describe("dayNumber", () => {
  it("maps timestamps to UTC day indices", () => {
    expect(dayNumber(0)).toBe(0);
    expect(dayNumber(MS_PER_DAY)).toBe(1);
    expect(dayNumber(MS_PER_DAY * 3 + 5000)).toBe(3);
  });
});

describe("computeDayStreak", () => {
  it("is 0 for empty history", () => {
    expect(computeDayStreak([])).toBe(0);
  });

  it("counts consecutive days back from the latest activity", () => {
    const history = [
      makeResult({ id: "a", timestamp: MS_PER_DAY * 5 }),
      makeResult({ id: "b", timestamp: MS_PER_DAY * 4 }),
      makeResult({ id: "c", timestamp: MS_PER_DAY * 3 }),
      // gap at day 2
      makeResult({ id: "d", timestamp: MS_PER_DAY * 1 }),
    ];
    expect(computeDayStreak(history)).toBe(3);
  });

  it("collapses multiple attempts on the same day into one day", () => {
    const history = [
      makeResult({ id: "a", timestamp: MS_PER_DAY * 2 + 100 }),
      makeResult({ id: "b", timestamp: MS_PER_DAY * 2 + 200 }),
      makeResult({ id: "c", timestamp: MS_PER_DAY * 1 }),
    ];
    expect(computeDayStreak(history)).toBe(2);
  });

  it("keeps the streak alive when last activity was yesterday", () => {
    const today = MS_PER_DAY * 10;
    const history = [
      makeResult({ id: "a", timestamp: MS_PER_DAY * 9 }),
      makeResult({ id: "b", timestamp: MS_PER_DAY * 8 }),
    ];
    expect(computeDayStreak(history, today)).toBe(2);
  });

  it("lapses to 0 when last activity is older than yesterday", () => {
    const today = MS_PER_DAY * 10;
    const history = [makeResult({ id: "a", timestamp: MS_PER_DAY * 7 })];
    expect(computeDayStreak(history, today)).toBe(0);
  });
});

describe("computeWinStreak", () => {
  it("counts consecutive passes from the most recent attempt", () => {
    const history = [
      makeResult({ id: "newest", timestamp: 300, correct: 9, total: 10 }), // pass
      makeResult({ id: "mid", timestamp: 200, correct: 7, total: 10 }), // pass
      makeResult({ id: "fail", timestamp: 100, correct: 2, total: 10 }), // fail
      makeResult({ id: "old", timestamp: 50, correct: 10, total: 10 }), // pass (before the break)
    ];
    expect(computeWinStreak(history)).toBe(2);
  });

  it("is 0 when the most recent attempt failed", () => {
    const history = [makeResult({ timestamp: 100, correct: 1, total: 10 })];
    expect(computeWinStreak(history)).toBe(0);
  });
});

describe("categoryMastery", () => {
  it("aggregates per category, most-recent first", () => {
    const history = [
      makeResult({ id: "l1", category: "languages", correct: 8, total: 10, timestamp: 100 }),
      makeResult({ id: "l2", category: "languages", correct: 6, total: 10, timestamp: 300 }),
      makeResult({ id: "g1", category: "geography", correct: 5, total: 10, timestamp: 200 }),
    ];
    const mastery = categoryMastery(history);
    expect(mastery.map((m) => m.category)).toEqual(["languages", "geography"]);

    const langs = mastery.find((m) => m.category === "languages")!;
    expect(langs.attempts).toBe(2);
    expect(langs.totalCorrect).toBe(14);
    expect(langs.totalQuestions).toBe(20);
    expect(langs.accuracyPct).toBe(70);
    expect(langs.bestPct).toBe(80);
    expect(langs.lastPlayed).toBe(300);
  });
});

describe("overallStats", () => {
  it("aggregates across the whole history", () => {
    const history = [
      makeResult({ id: "a", correct: 10, total: 10, timestamp: MS_PER_DAY * 2 }),
      makeResult({ id: "b", correct: 5, total: 10, timestamp: MS_PER_DAY * 1 }),
    ];
    const stats = overallStats(history);
    expect(stats.attempts).toBe(2);
    expect(stats.totalCorrect).toBe(15);
    expect(stats.totalQuestions).toBe(20);
    expect(stats.accuracyPct).toBe(75);
    expect(stats.bestPct).toBe(100);
    expect(stats.dayStreak).toBe(2);
    expect(stats.winStreak).toBe(1); // newest is a pass, previous (50%) is a fail
  });
});

describe("suggestDifficulty", () => {
  const strong = (id: string, ts: number): QuizResult =>
    makeResult({ id, correct: 10, total: 10, timestamp: ts });
  const weak = (id: string, ts: number): QuizResult =>
    makeResult({ id, correct: 2, total: 10, timestamp: ts });

  it("keeps current difficulty with fewer than 2 relevant attempts", () => {
    expect(suggestDifficulty([strong("a", 1)], "medium")).toBe("medium");
    expect(suggestDifficulty([], "hard")).toBe("hard");
  });

  it("bumps up after strong recent performance", () => {
    const history = [strong("a", 3), strong("b", 2), strong("c", 1)];
    expect(suggestDifficulty(history, "medium")).toBe("hard");
    expect(suggestDifficulty(history, "hard")).toBe("hard"); // clamps at top
  });

  it("bumps down after weak recent performance", () => {
    const history = [weak("a", 3), weak("b", 2)];
    expect(suggestDifficulty(history, "medium")).toBe("easy");
    expect(suggestDifficulty(history, "easy")).toBe("easy"); // clamps at bottom
  });

  it("scopes to a category when given", () => {
    const history = [
      strong("g1", 4),
      strong("g2", 3),
      weak("l1", 2),
      weak("l2", 1),
    ].map((r, i) =>
      i < 2 ? { ...r, category: "geography" } : { ...r, category: "languages" },
    );
    expect(suggestDifficulty(history, "medium", "geography")).toBe("hard");
    expect(suggestDifficulty(history, "medium", "languages")).toBe("easy");
  });
});

describe("persistence", () => {
  it("round-trips results newest-first", () => {
    const storage = memoryStorage();
    expect(loadHistory(storage)).toEqual([]);

    const first = makeResult({ id: "first", timestamp: 100 });
    addResult(storage, first);
    const second = makeResult({ id: "second", timestamp: 200 });
    const history = addResult(storage, second);

    expect(history.map((r) => r.id)).toEqual(["second", "first"]);
    expect(loadHistory(storage).map((r) => r.id)).toEqual(["second", "first"]);
    expect(storage.getItem(QUIZ_HISTORY_KEY)).toBeTruthy();
  });

  it("clears history", () => {
    const storage = memoryStorage();
    addResult(storage, makeResult());
    clearHistory(storage);
    expect(loadHistory(storage)).toEqual([]);
  });

  it("persists the auto-scale toggle", () => {
    const storage = memoryStorage();
    expect(loadAutoScale(storage)).toBe(false);
    saveAutoScale(storage, true);
    expect(storage.getItem(QUIZ_AUTOSCALE_KEY)).toBe("true");
    expect(loadAutoScale(storage)).toBe(true);
    saveAutoScale(storage, false);
    expect(loadAutoScale(storage)).toBe(false);
  });
});
