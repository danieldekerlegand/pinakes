/**
 * Shareable quiz results — pure encode/decode helpers (US-007).
 *
 * A finished quiz can be summarised into a compact, self-contained token that
 * embeds the score + category directly in the share URL (no server storage
 * needed — the same "state lives in the URL" idea as {@link ../hooks/useShareableState}).
 * The token round-trips through `/shared/quiz/:token`, which renders a read-only
 * result summary.
 *
 * Everything here is side-effect free and node-testable; the React UI in
 * `client/src/pages/quiz.tsx` (share button) and the shared-result page are thin
 * wrappers over these functions.
 */

import { scorePct, type Difficulty } from "./quiz-progress";

/** The minimal, shareable projection of a completed quiz attempt. */
export interface ShareableQuizResult {
  category: string;
  difficulty: Difficulty;
  /** Number of questions answered correctly. */
  correct: number;
  /** Total number of questions (> 0). */
  total: number;
  /** Completion time, ms since epoch (optional). */
  timestamp?: number;
}

/** Canonical path for a shared quiz result. */
export function sharedQuizRoute(token: string): string {
  return `/shared/quiz/${token}`;
}

// --- URL-safe base64 ----------------------------------------------------------
// Wrap the JSON in encodeURIComponent first so any (future) non-latin1 category
// label survives btoa, then make the base64 URL-safe (RFC 4648 §5).

function base64UrlEncode(input: string): string {
  const b64 = btoa(encodeURIComponent(input));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(token: string): string {
  let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return decodeURIComponent(atob(b64));
}

// --- Encode / decode ----------------------------------------------------------

function isDifficulty(x: unknown): x is Difficulty {
  return x === "easy" || x === "medium" || x === "hard";
}

/**
 * Encode a result summary into a URL-safe token. Keys are shortened so the URL
 * stays compact: `c`=category, `d`=difficulty, `s`=correct, `t`=total, `ts`=timestamp.
 */
export function encodeQuizResult(result: ShareableQuizResult): string {
  const payload: Record<string, unknown> = {
    c: result.category,
    d: result.difficulty,
    s: result.correct,
    t: result.total,
  };
  if (result.timestamp != null && Number.isFinite(result.timestamp)) {
    payload.ts = result.timestamp;
  }
  return base64UrlEncode(JSON.stringify(payload));
}

/**
 * Decode a share token back into a validated result summary, or `null` when the
 * token is malformed / fails validation. Never throws.
 */
export function decodeQuizResult(token: string | null | undefined): ShareableQuizResult | null {
  if (!token) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(token));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  const category = p.c;
  const difficulty = p.d;
  const correct = p.s;
  const total = p.t;
  const timestamp = p.ts;

  if (
    typeof category !== "string" ||
    category.length === 0 ||
    !isDifficulty(difficulty) ||
    typeof correct !== "number" ||
    !Number.isFinite(correct) ||
    correct < 0 ||
    typeof total !== "number" ||
    !Number.isFinite(total) ||
    total <= 0 ||
    correct > total
  ) {
    return null;
  }

  const result: ShareableQuizResult = { category, difficulty, correct, total };
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    result.timestamp = timestamp;
  }
  return result;
}

/** Absolute, shareable URL for a quiz result (origin defaults to relative). */
export function quizResultShareUrl(result: ShareableQuizResult, origin = ""): string {
  return `${origin}${sharedQuizRoute(encodeQuizResult(result))}`;
}

// --- Presentation helpers (shared by the results screen + shared page) ---------

/** Encouraging one-liner keyed off the percentage score. */
export function resultMessage(pct: number): string {
  if (pct >= 100) return "Perfect score! You're a linguistics expert!";
  if (pct >= 80) return "Excellent! You really know your languages.";
  if (pct >= 60) return "Good job! Keep learning.";
  if (pct >= 40) return "Not bad! There's more to discover.";
  return "Keep practicing — the world of languages awaits!";
}

/** Short plain-text summary suitable for clipboard / social sharing. */
export function resultShareText(
  result: ShareableQuizResult,
  categoryLabel = result.category,
): string {
  const pct = scorePct(result);
  return `I scored ${result.correct}/${result.total} (${pct}%) on the ${categoryLabel} quiz in LinguaScrape!`;
}
