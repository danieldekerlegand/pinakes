import { describe, it, expect } from "vitest";
import type { IncomingHttpHeaders } from "http";
import {
  parseApiKeys,
  loadApiAuthConfig,
  extractApiKey,
  authenticate,
  RateLimiter,
  DEFAULT_RATE_LIMIT,
  type ApiAuthConfig,
} from "./api-auth";

const h = (headers: Record<string, string>): IncomingHttpHeaders => headers;

describe("parseApiKeys", () => {
  it("returns [] for unset/blank", () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys("   ,  ")).toEqual([]);
  });

  it("parses bare keys and key:label entries", () => {
    const keys = parseApiKeys("secret-abc, key-two:Partner Bot ");
    expect(keys).toHaveLength(2);
    expect(keys[0].key).toBe("secret-abc");
    expect(keys[1]).toEqual({ key: "key-two", label: "Partner Bot" });
  });

  it("derives a non-secret label from a bare key", () => {
    const [record] = parseApiKeys("supersecretvalue");
    expect(record.key).toBe("supersecretvalue");
    expect(record.label).not.toContain("value");
    expect(record.label).toBe("supers…");
  });
});

describe("loadApiAuthConfig", () => {
  it("is open (no keys) and uses default rate limits when env is empty", () => {
    const cfg = loadApiAuthConfig({});
    expect(cfg.keys).toEqual([]);
    expect(cfg.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
  });

  it("reads keys + overridable rate limits from env", () => {
    const cfg = loadApiAuthConfig({
      CONTRIBUTION_API_KEYS: "k1,k2:two",
      CONTRIBUTION_RATE_LIMIT_MAX: "5",
      CONTRIBUTION_RATE_LIMIT_WINDOW_MS: "1000",
    } as NodeJS.ProcessEnv);
    expect(cfg.keys.map((k) => k.key)).toEqual(["k1", "k2"]);
    expect(cfg.rateLimit).toEqual({ max: 5, windowMs: 1000 });
  });

  it("falls back to defaults for non-positive/garbage rate-limit env", () => {
    const cfg = loadApiAuthConfig({
      CONTRIBUTION_RATE_LIMIT_MAX: "-3",
      CONTRIBUTION_RATE_LIMIT_WINDOW_MS: "nope",
    } as NodeJS.ProcessEnv);
    expect(cfg.rateLimit).toEqual(DEFAULT_RATE_LIMIT);
  });
});

describe("extractApiKey", () => {
  it("reads X-API-Key", () => {
    expect(extractApiKey(h({ "x-api-key": "  abc " }))).toBe("abc");
  });

  it("reads a Bearer token (case-insensitive)", () => {
    expect(extractApiKey(h({ authorization: "Bearer tok-1" }))).toBe("tok-1");
    expect(extractApiKey(h({ authorization: "bearer tok-2" }))).toBe("tok-2");
  });

  it("prefers X-API-Key over Authorization", () => {
    expect(extractApiKey(h({ "x-api-key": "primary", authorization: "Bearer other" }))).toBe(
      "primary",
    );
  });

  it("returns null when absent or malformed", () => {
    expect(extractApiKey(h({}))).toBeNull();
    expect(extractApiKey(h({ authorization: "Basic xyz" }))).toBeNull();
    expect(extractApiKey(h({ authorization: "Bearer " }))).toBeNull();
  });
});

describe("authenticate", () => {
  const config: ApiAuthConfig = {
    keys: [{ key: "good-key", label: "good" }],
    rateLimit: DEFAULT_RATE_LIMIT,
  };

  it("is open (key: null) when no keys are configured", () => {
    const result = authenticate({ keys: [], rateLimit: DEFAULT_RATE_LIMIT }, h({}));
    expect(result).toEqual({ ok: true, key: null });
  });

  it("401s when a key is required but none presented", () => {
    const result = authenticate(config, h({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("403s on an unknown key", () => {
    const result = authenticate(config, h({ "x-api-key": "wrong" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("accepts a valid key (header or bearer)", () => {
    expect(authenticate(config, h({ "x-api-key": "good-key" }))).toEqual({
      ok: true,
      key: { key: "good-key", label: "good" },
    });
    expect(authenticate(config, h({ authorization: "Bearer good-key" })).ok).toBe(true);
  });

  it("rejects a key that is a prefix of a valid key (length-guarded)", () => {
    const result = authenticate(config, h({ "x-api-key": "good" }));
    expect(result.ok).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to max requests then blocks within a window", () => {
    const limiter = new RateLimiter({ max: 3, windowMs: 1000 });
    const first = limiter.check("id", 0);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    expect(limiter.check("id", 100).allowed).toBe(true); // 2nd
    expect(limiter.check("id", 200).allowed).toBe(true); // 3rd
    const blocked = limiter.check("id", 300); // 4th
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(700); // resetAt(1000) - now(300)
  });

  it("resets after the window elapses", () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.check("id", 0).allowed).toBe(true);
    expect(limiter.check("id", 500).allowed).toBe(false);
    // window fully elapsed → new window
    const after = limiter.check("id", 1000);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(0);
  });

  it("tracks identities independently", () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true); // different identity, own quota
    expect(limiter.check("a", 10).allowed).toBe(false);
  });
});
