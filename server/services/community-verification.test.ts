import { describe, it, expect } from "vitest";
import {
  addConfirmation,
  computeConfidence,
  distinctReviewers,
  hasStewardConfirmation,
  isVerified,
  loadVerificationConfig,
  requiredConfirmations,
  reviewerKey,
  stewardReviewers,
  summarizeVerification,
  DEFAULT_VERIFICATION_CONFIG,
  VERIFIED_CONFIDENCE,
  type Confirmation,
} from "./community-verification";

const cfg = { threshold: 3, stewardThreshold: 1 };

function conf(reviewer: string, opts: Partial<Confirmation> = {}): Confirmation {
  return { reviewer, confirmedAt: "2026-07-06T00:00:00.000Z", ...opts };
}

describe("addConfirmation", () => {
  it("adds a new distinct reviewer", () => {
    const r = addConfirmation([], conf("alice"));
    expect(r.added).toBe(true);
    expect(r.confirmations).toHaveLength(1);
  });

  it("dedups a repeated reviewer case-insensitively / trimmed", () => {
    const first = addConfirmation([], conf("Alice"));
    const second = addConfirmation(first.confirmations, conf("  alice "));
    expect(second.added).toBe(false);
    expect(second).toMatchObject({ reason: "duplicate" });
    expect(second.confirmations).toHaveLength(1);
  });

  it("does not mutate the input list", () => {
    const existing = [conf("alice")];
    addConfirmation(existing, conf("bob"));
    expect(existing).toHaveLength(1);
  });
});

describe("reviewerKey / distinctReviewers", () => {
  it("normalizes reviewer identity", () => {
    expect(reviewerKey("  Alice  ")).toBe("alice");
  });

  it("counts distinct reviewers ignoring case/whitespace", () => {
    const list = [conf("Alice"), conf("alice "), conf("Bob")];
    expect(distinctReviewers(list)).toBe(2);
  });
});

describe("required confirmations & steward weighting", () => {
  it("requires the full threshold with no steward", () => {
    const list = [conf("alice"), conf("bob")];
    expect(hasStewardConfirmation(list)).toBe(false);
    expect(requiredConfirmations(list, cfg)).toBe(3);
  });

  it("lowers the bar to the steward threshold once a steward confirms", () => {
    const list = [conf("carol", { isSteward: true })];
    expect(hasStewardConfirmation(list)).toBe(true);
    expect(requiredConfirmations(list, cfg)).toBe(1);
  });

  it("lists distinct steward reviewers", () => {
    const list = [conf("Carol", { isSteward: true }), conf("carol", { isSteward: true }), conf("dan")];
    expect(stewardReviewers(list)).toEqual(["Carol"]);
  });
});

describe("isVerified", () => {
  it("is false below the threshold", () => {
    expect(isVerified([conf("a"), conf("b")], cfg)).toBe(false);
  });

  it("is true once N distinct reviewers confirm", () => {
    expect(isVerified([conf("a"), conf("b"), conf("c")], cfg)).toBe(true);
  });

  it("a single domain steward can verify (steward threshold)", () => {
    expect(isVerified([conf("carol", { isSteward: true })], cfg)).toBe(true);
  });

  it("duplicate reviewers do NOT count toward the threshold", () => {
    // Three confirmations but only two distinct reviewers.
    const list = [conf("a"), conf("a"), conf("b")];
    expect(distinctReviewers(list)).toBe(2);
    expect(isVerified(list, cfg)).toBe(false);
  });
});

describe("computeConfidence", () => {
  it("returns the base with no confirmations", () => {
    expect(computeConfidence(60, [], cfg)).toBe(60);
  });

  it("ramps toward the verified ceiling with progress and never lowers the base", () => {
    const base = 60;
    const one = computeConfidence(base, [conf("a")], cfg);
    const two = computeConfidence(base, [conf("a"), conf("b")], cfg);
    const three = computeConfidence(base, [conf("a"), conf("b"), conf("c")], cfg);
    expect(one).toBeGreaterThanOrEqual(base);
    expect(two).toBeGreaterThan(one);
    expect(three).toBe(VERIFIED_CONFIDENCE);
  });

  it("caps progress at 1 (extra reviewers past the threshold don't exceed the ceiling)", () => {
    const list = [conf("a"), conf("b"), conf("c"), conf("d")];
    expect(computeConfidence(60, list, cfg)).toBe(VERIFIED_CONFIDENCE);
  });

  it("a steward confirmation immediately reaches the ceiling (steward threshold met)", () => {
    expect(computeConfidence(40, [conf("carol", { isSteward: true })], cfg)).toBe(VERIFIED_CONFIDENCE);
  });
});

describe("summarizeVerification", () => {
  it("bundles the derived state", () => {
    const list = [conf("a"), conf("b")];
    const state = summarizeVerification(50, list, cfg);
    expect(state).toMatchObject({
      distinctReviewers: 2,
      required: 3,
      verified: false,
      stewardConfirmed: false,
      stewards: [],
    });
    expect(state.confidence).toBeGreaterThan(50);
  });
});

describe("loadVerificationConfig", () => {
  it("defaults when unset", () => {
    expect(loadVerificationConfig({})).toEqual(DEFAULT_VERIFICATION_CONFIG);
  });

  it("reads env overrides", () => {
    expect(
      loadVerificationConfig({ VERIFICATION_THRESHOLD: "5", VERIFICATION_STEWARD_THRESHOLD: "2" }),
    ).toEqual({ threshold: 5, stewardThreshold: 2 });
  });

  it("clamps the steward threshold to never exceed the full threshold", () => {
    expect(
      loadVerificationConfig({ VERIFICATION_THRESHOLD: "2", VERIFICATION_STEWARD_THRESHOLD: "9" }),
    ).toEqual({ threshold: 2, stewardThreshold: 2 });
  });

  it("ignores non-numeric / sub-1 values", () => {
    expect(loadVerificationConfig({ VERIFICATION_THRESHOLD: "abc" })).toEqual(
      DEFAULT_VERIFICATION_CONFIG,
    );
    expect(loadVerificationConfig({ VERIFICATION_THRESHOLD: "0" })).toEqual(
      DEFAULT_VERIFICATION_CONFIG,
    );
  });
});
