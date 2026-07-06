import { describe, it, expect } from "vitest";
import {
  encodeQuizResult,
  decodeQuizResult,
  quizResultShareUrl,
  sharedQuizRoute,
  resultMessage,
  resultShareText,
  type ShareableQuizResult,
} from "./quiz-share";

const sample: ShareableQuizResult = {
  category: "languages",
  difficulty: "medium",
  correct: 7,
  total: 10,
  timestamp: 1_700_000_000_000,
};

describe("encodeQuizResult / decodeQuizResult", () => {
  it("round-trips a full result", () => {
    const token = encodeQuizResult(sample);
    expect(decodeQuizResult(token)).toEqual(sample);
  });

  it("produces a URL-safe token (no +, /, or = padding)", () => {
    const token = encodeQuizResult(sample);
    expect(token).not.toMatch(/[+/=]/);
  });

  it("round-trips without a timestamp (field omitted, not null)", () => {
    const { timestamp, ...noTs } = sample;
    void timestamp;
    const decoded = decodeQuizResult(encodeQuizResult(noTs));
    expect(decoded).toEqual(noTs);
    expect(decoded && "timestamp" in decoded).toBe(false);
  });

  it("round-trips a non-latin1 category label", () => {
    const unicode: ShareableQuizResult = { ...sample, category: "café–cuisine é中" };
    expect(decodeQuizResult(encodeQuizResult(unicode))).toEqual(unicode);
  });

  it("handles a perfect and a zero score", () => {
    for (const correct of [0, 10]) {
      const r = { ...sample, correct };
      expect(decodeQuizResult(encodeQuizResult(r))).toEqual(r);
    }
  });
});

describe("decodeQuizResult validation", () => {
  it("returns null for empty / nullish tokens", () => {
    expect(decodeQuizResult("")).toBeNull();
    expect(decodeQuizResult(null)).toBeNull();
    expect(decodeQuizResult(undefined)).toBeNull();
  });

  it("returns null for garbage tokens", () => {
    expect(decodeQuizResult("!!!not-base64!!!")).toBeNull();
    expect(decodeQuizResult("aGVsbG8")).toBeNull(); // decodes to "hello", not JSON
  });

  it("rejects out-of-range or malformed payloads", () => {
    const bad: unknown[] = [
      { c: "languages", d: "medium", s: 5, t: 0 }, // total 0
      { c: "languages", d: "medium", s: 11, t: 10 }, // correct > total
      { c: "languages", d: "medium", s: -1, t: 10 }, // negative
      { c: "", d: "medium", s: 5, t: 10 }, // empty category
      { c: "languages", d: "extreme", s: 5, t: 10 }, // bad difficulty
      { c: "languages", d: "medium", t: 10 }, // missing correct
      [1, 2, 3], // not an object
    ];
    for (const payload of bad) {
      const token = Buffer.from(encodeURIComponent(JSON.stringify(payload)))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      expect(decodeQuizResult(token)).toBeNull();
    }
  });
});

describe("share URL helpers", () => {
  it("builds a relative shared path by default", () => {
    const url = quizResultShareUrl(sample);
    expect(url.startsWith("/shared/quiz/")).toBe(true);
    const token = url.replace("/shared/quiz/", "");
    expect(decodeQuizResult(token)).toEqual(sample);
  });

  it("prefixes the origin when provided", () => {
    const url = quizResultShareUrl(sample, "https://example.com");
    expect(url.startsWith("https://example.com/shared/quiz/")).toBe(true);
  });

  it("sharedQuizRoute matches the URL builder", () => {
    const token = encodeQuizResult(sample);
    expect(quizResultShareUrl(sample)).toBe(sharedQuizRoute(token));
  });
});

describe("presentation helpers", () => {
  it("resultMessage tiers by percentage", () => {
    expect(resultMessage(100)).toMatch(/Perfect/);
    expect(resultMessage(85)).toMatch(/Excellent/);
    expect(resultMessage(70)).toMatch(/Good job/);
    expect(resultMessage(45)).toMatch(/Not bad/);
    expect(resultMessage(10)).toMatch(/Keep practicing/);
  });

  it("resultShareText includes score, percentage, and label", () => {
    const text = resultShareText(sample, "Languages");
    expect(text).toContain("7/10");
    expect(text).toContain("70%");
    expect(text).toContain("Languages");
  });
});
