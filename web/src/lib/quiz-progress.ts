/**
 * Quiz progress & streaks — client-side persistence + pure helpers (US-006).
 *
 * Per-session quiz results (score, category, difficulty, timestamp) are persisted
 * to localStorage so a learner can track improvement over time. All the derived
 * numbers — streaks, per-category mastery, adaptive-difficulty suggestion — are
 * computed by the pure, side-effect-free functions here (unit-tested in the
 * node-env vitest suite). The React UI in `web/src/pages/quiz.tsx` is a thin
 * wrapper that reads/writes through the persistence helpers.
 *
 * Storage access is abstracted behind {@link QuizStorage} so the persistence
 * helpers are testable in node (no `localStorage`); pass `browserStorage()` from
 * the component, or an in-memory stub in tests.
 */

export type Difficulty = "easy" | "medium" | "hard";

/** A single completed quiz attempt. */
export interface QuizResult {
  /** Unique id for the attempt. */
  id: string;
  category: string;
  difficulty: Difficulty;
  /** Number of questions answered correctly. */
  correct: number;
  /** Total number of questions in the attempt (> 0). */
  total: number;
  /** Completion time, ms since epoch. */
  timestamp: number;
}

/** Minimal `Storage`-like surface — satisfied by `window.localStorage`. */
export interface QuizStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const QUIZ_HISTORY_KEY = "pinakes.quiz.history";
export const QUIZ_AUTOSCALE_KEY = "pinakes.quiz.autoscale";

/** A quiz counts as "passed" at or above this percentage. */
export const PASS_THRESHOLD = 60;

/** Newest-first history is capped so localStorage never grows unbounded. */
const MAX_HISTORY = 500;
const MS_PER_DAY = 86_400_000;
const DIFFICULTY_ORDER: readonly Difficulty[] = ["easy", "medium", "hard"];

// --- Pure scoring helpers -----------------------------------------------------

/** Percentage correct (0–100, rounded); 0 when `total` is 0. */
export function scorePct(result: Pick<QuizResult, "correct" | "total">): number {
  if (result.total <= 0) return 0;
  return Math.round((result.correct / result.total) * 100);
}

/** True when the attempt reaches the pass threshold. */
export function isPass(
  result: Pick<QuizResult, "correct" | "total">,
  threshold = PASS_THRESHOLD,
): boolean {
  return scorePct(result) >= threshold;
}

/** UTC day index (days since epoch) — the unit day-streaks are counted in. */
export function dayNumber(timestamp: number): number {
  return Math.floor(timestamp / MS_PER_DAY);
}

// --- Serialization ------------------------------------------------------------

function isValidResult(x: unknown): x is QuizResult {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.category === "string" &&
    (r.difficulty === "easy" || r.difficulty === "medium" || r.difficulty === "hard") &&
    typeof r.correct === "number" &&
    Number.isFinite(r.correct) &&
    r.correct >= 0 &&
    typeof r.total === "number" &&
    Number.isFinite(r.total) &&
    r.total > 0 &&
    r.correct <= r.total &&
    typeof r.timestamp === "number" &&
    Number.isFinite(r.timestamp)
  );
}

/** Safely parse a stored history blob, dropping any malformed rows. */
export function parseHistory(raw: string | null): QuizResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidResult);
  } catch {
    return [];
  }
}

export function serializeHistory(history: QuizResult[]): string {
  return JSON.stringify(history);
}

// --- Streaks ------------------------------------------------------------------

/**
 * Consecutive calendar days (UTC) with at least one completed quiz, counted back
 * from the most recent activity day. When `referenceTimestamp` (today) is given,
 * a streak that last saw activity before *yesterday* is considered lapsed (0).
 */
export function computeDayStreak(
  history: QuizResult[],
  referenceTimestamp?: number,
): number {
  if (history.length === 0) return 0;
  const dayList = history.map((r) => dayNumber(r.timestamp));
  const days = new Set(dayList);
  const latest = Math.max(...dayList);
  if (referenceTimestamp != null) {
    const today = dayNumber(referenceTimestamp);
    if (latest < today - 1) return 0;
  }
  let streak = 0;
  for (let d = latest; days.has(d); d--) streak++;
  return streak;
}

/** Consecutive passing attempts counting back from the most recent attempt. */
export function computeWinStreak(
  history: QuizResult[],
  threshold = PASS_THRESHOLD,
): number {
  const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);
  let streak = 0;
  for (const r of sorted) {
    if (isPass(r, threshold)) streak++;
    else break;
  }
  return streak;
}

// --- Mastery & overall stats --------------------------------------------------

export interface CategoryMastery {
  category: string;
  attempts: number;
  totalCorrect: number;
  totalQuestions: number;
  /** Lifetime accuracy across all attempts in the category (0–100). */
  accuracyPct: number;
  /** Best single-attempt percentage (0–100). */
  bestPct: number;
  /** Timestamp of the most recent attempt in the category. */
  lastPlayed: number;
}

/** Per-category mastery, most-recently-played first. */
export function categoryMastery(history: QuizResult[]): CategoryMastery[] {
  const byCategory = new Map<string, CategoryMastery>();
  for (const r of history) {
    const m =
      byCategory.get(r.category) ??
      ({
        category: r.category,
        attempts: 0,
        totalCorrect: 0,
        totalQuestions: 0,
        accuracyPct: 0,
        bestPct: 0,
        lastPlayed: 0,
      } satisfies CategoryMastery);
    m.attempts += 1;
    m.totalCorrect += r.correct;
    m.totalQuestions += r.total;
    m.bestPct = Math.max(m.bestPct, scorePct(r));
    m.lastPlayed = Math.max(m.lastPlayed, r.timestamp);
    byCategory.set(r.category, m);
  }
  return Array.from(byCategory.values())
    .map((m) => ({
      ...m,
      accuracyPct:
        m.totalQuestions > 0 ? Math.round((m.totalCorrect / m.totalQuestions) * 100) : 0,
    }))
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export interface OverallStats {
  attempts: number;
  totalCorrect: number;
  totalQuestions: number;
  accuracyPct: number;
  bestPct: number;
  dayStreak: number;
  winStreak: number;
}

/** Aggregate stats across the whole history. */
export function overallStats(
  history: QuizResult[],
  referenceTimestamp?: number,
): OverallStats {
  let totalCorrect = 0;
  let totalQuestions = 0;
  let bestPct = 0;
  for (const r of history) {
    totalCorrect += r.correct;
    totalQuestions += r.total;
    bestPct = Math.max(bestPct, scorePct(r));
  }
  return {
    attempts: history.length,
    totalCorrect,
    totalQuestions,
    accuracyPct: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    bestPct,
    dayStreak: computeDayStreak(history, referenceTimestamp),
    winStreak: computeWinStreak(history),
  };
}

// --- Adaptive difficulty ------------------------------------------------------

/**
 * Suggest the next difficulty from recent performance (optionally scoped to a
 * category). Averages up to the last 3 relevant attempts: ≥85% bumps up, <50%
 * bumps down, otherwise unchanged. With fewer than 2 relevant attempts the
 * current difficulty is kept (not enough signal).
 */
export function suggestDifficulty(
  history: QuizResult[],
  current: Difficulty,
  category?: string,
): Difficulty {
  const relevant = (category ? history.filter((r) => r.category === category) : history)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);
  if (relevant.length < 2) return current;
  const avg = relevant.reduce((sum, r) => sum + scorePct(r), 0) / relevant.length;
  const idx = DIFFICULTY_ORDER.indexOf(current);
  if (avg >= 85 && idx < DIFFICULTY_ORDER.length - 1) return DIFFICULTY_ORDER[idx + 1];
  if (avg < 50 && idx > 0) return DIFFICULTY_ORDER[idx - 1];
  return current;
}

// --- Persistence --------------------------------------------------------------

/** Read the stored history (newest first). */
export function loadHistory(storage: QuizStorage): QuizResult[] {
  return parseHistory(storage.getItem(QUIZ_HISTORY_KEY));
}

/**
 * Prepend a result to the stored history (capped at {@link MAX_HISTORY}) and
 * persist it. Returns the new, in-memory history so callers can update state
 * without a re-read.
 */
export function addResult(storage: QuizStorage, result: QuizResult): QuizResult[] {
  const next = [result, ...loadHistory(storage)].slice(0, MAX_HISTORY);
  storage.setItem(QUIZ_HISTORY_KEY, serializeHistory(next));
  return next;
}

export function clearHistory(storage: QuizStorage): void {
  storage.removeItem(QUIZ_HISTORY_KEY);
}

export function loadAutoScale(storage: QuizStorage): boolean {
  return storage.getItem(QUIZ_AUTOSCALE_KEY) === "true";
}

export function saveAutoScale(storage: QuizStorage, enabled: boolean): void {
  storage.setItem(QUIZ_AUTOSCALE_KEY, enabled ? "true" : "false");
}

/** Mint a unique result id (crypto.randomUUID when available). */
export function newResultId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `quiz_${crypto.randomUUID()}`;
  }
  return `quiz_${Math.random().toString(36).slice(2)}`;
}

/**
 * The browser's localStorage as a {@link QuizStorage}, or a no-op fallback when
 * storage is unavailable (SSR, privacy mode) so callers never throw.
 */
export function browserStorage(): QuizStorage {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // fall through to no-op
  }
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}
