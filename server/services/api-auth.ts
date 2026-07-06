/**
 * Public contribution API — auth + rate limiting (US-011)
 *
 * Hardens the write side of the contribution API so programmatic contributions
 * are safe and supported. Two concerns, both pure/injectable so the route can be
 * unit-tested with no live env / no wall-clock:
 *
 *   1. API-key auth  — a write must present a valid key (`X-API-Key` header or
 *      `Authorization: Bearer <key>`). Keys are configured out-of-band via the
 *      `CONTRIBUTION_API_KEYS` env var.
 *   2. Per-key rate limiting — a fixed-window counter keyed on the presenting key
 *      (or the client IP when auth is disabled).
 *
 * **Backward-compatible by default (like `GEONAMES_USERNAME`):** with no keys
 * configured, auth is *disabled* and every request passes (the app still works
 * out-of-the-box). Configure `CONTRIBUTION_API_KEYS` to require authenticated
 * writes. Read endpoints are never guarded.
 */

import crypto from "crypto";
import type { RequestHandler } from "express";
import type { IncomingHttpHeaders } from "http";

// ============================================================================
// Types & config
// ============================================================================

export interface ApiKeyRecord {
  /** The secret key value presented by clients. */
  key: string;
  /** A human-readable label for logs / attribution (never the full secret). */
  label: string;
}

export interface RateLimitConfig {
  /** Length of the fixed window, in milliseconds. */
  windowMs: number;
  /** Max requests allowed per identity per window. */
  max: number;
}

export interface ApiAuthConfig {
  /** Configured API keys. Empty ⇒ auth disabled (open, backward-compatible). */
  keys: ApiKeyRecord[];
  rateLimit: RateLimitConfig;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { windowMs: 60_000, max: 60 };

/**
 * Parse the `CONTRIBUTION_API_KEYS` env value: a comma-separated list of
 * `key` or `key:label` entries. Blank/whitespace entries are dropped.
 */
export function parseApiKeys(raw: string | undefined): ApiKeyRecord[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx === -1) {
        return { key: entry, label: defaultLabel(entry) };
      }
      const key = entry.slice(0, idx).trim();
      const label = entry.slice(idx + 1).trim();
      return { key, label: label || defaultLabel(key) };
    })
    .filter((record) => record.key.length > 0);
}

/** A short, non-secret display label derived from a key. */
function defaultLabel(key: string): string {
  return key.length <= 6 ? `${key.slice(0, 2)}…` : `${key.slice(0, 6)}…`;
}

/** Build the auth config from environment variables. */
export function loadApiAuthConfig(env: NodeJS.ProcessEnv = process.env): ApiAuthConfig {
  const max = Number.parseInt(env.CONTRIBUTION_RATE_LIMIT_MAX ?? "", 10);
  const windowMs = Number.parseInt(env.CONTRIBUTION_RATE_LIMIT_WINDOW_MS ?? "", 10);
  return {
    keys: parseApiKeys(env.CONTRIBUTION_API_KEYS),
    rateLimit: {
      max: Number.isFinite(max) && max > 0 ? max : DEFAULT_RATE_LIMIT.max,
      windowMs:
        Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_RATE_LIMIT.windowMs,
    },
  };
}

// ============================================================================
// Auth (pure)
// ============================================================================

export type AuthResult =
  /** Authenticated (or auth disabled, in which case `key` is null). */
  | { ok: true; key: ApiKeyRecord | null }
  /** Rejected — `status` is the HTTP status the route should return. */
  | { ok: false; status: 401 | 403; error: string };

/**
 * Extract a presented API key from request headers: prefers `X-API-Key`, falls
 * back to a `Authorization: Bearer <key>` header. Returns null if neither is set.
 */
export function extractApiKey(headers: IncomingHttpHeaders): string | null {
  const apiKeyHeader = headers["x-api-key"];
  const raw = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  const auth = headers["authorization"];
  const authStr = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authStr === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authStr.trim());
    if (match && match[1].trim()) return match[1].trim();
  }
  return null;
}

/** Constant-time string comparison (avoids leaking key length/prefix via timing). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticate a request against the configured keys.
 * - No keys configured ⇒ `{ ok: true, key: null }` (auth disabled, open).
 * - No key presented ⇒ 401.
 * - Key presented but unknown ⇒ 403.
 */
export function authenticate(config: ApiAuthConfig, headers: IncomingHttpHeaders): AuthResult {
  if (config.keys.length === 0) {
    return { ok: true, key: null };
  }
  const presented = extractApiKey(headers);
  if (!presented) {
    return {
      ok: false,
      status: 401,
      error:
        "API key required. Provide an 'X-API-Key' header or 'Authorization: Bearer <key>'.",
    };
  }
  const match = config.keys.find((record) => timingSafeEqualStr(record.key, presented));
  if (!match) {
    return { ok: false, status: 403, error: "Invalid API key." };
  }
  return { ok: true, key: match };
}

// ============================================================================
// Rate limiting (fixed-window counter, injectable clock)
// ============================================================================

export interface RateLimitResult {
  allowed: boolean;
  /** Max requests per window. */
  limit: number;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Epoch-ms at which the current window resets. */
  resetAt: number;
  /** Ms until the window resets (0 when allowed). */
  retryAfterMs: number;
}

/**
 * In-memory fixed-window rate limiter. Stateful (per-identity counters) but the
 * clock is injected into `check`, so it is deterministically unit-testable.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT) {
    this.windowMs = config.windowMs;
    this.max = config.max;
  }

  check(identity: string, now: number): RateLimitResult {
    const bucket = this.buckets.get(identity);

    // New identity, or the previous window has fully elapsed → start fresh.
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(identity, { count: 1, windowStart: now });
      return {
        allowed: true,
        limit: this.max,
        remaining: this.max - 1,
        resetAt: now + this.windowMs,
        retryAfterMs: 0,
      };
    }

    const resetAt = bucket.windowStart + this.windowMs;

    if (bucket.count >= this.max) {
      return {
        allowed: false,
        limit: this.max,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, resetAt - now),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      limit: this.max,
      remaining: this.max - bucket.count,
      resetAt,
      retryAfterMs: 0,
    };
  }

  /** Drop all counters (test helper / manual flush). */
  reset(): void {
    this.buckets.clear();
  }
}

// ============================================================================
// Express middleware
// ============================================================================

export interface ContributionWriteGuardOptions {
  config?: ApiAuthConfig;
  limiter?: RateLimiter;
  now?: () => number;
}

/**
 * Middleware guarding a contribution *write* endpoint: authenticate, then apply
 * per-identity rate limiting. Emits standard `X-RateLimit-*` headers and a
 * `Retry-After` on a 429. Rejected requests never reach the handler.
 *
 * Rate-limit identity = the presenting key (when authed) else the client IP, so
 * an authenticated caller gets its own quota regardless of source address.
 */
export function createContributionWriteGuard(
  options: ContributionWriteGuardOptions = {},
): RequestHandler {
  const config = options.config ?? loadApiAuthConfig();
  const limiter = options.limiter ?? new RateLimiter(config.rateLimit);
  const now = options.now ?? (() => Date.now());

  return (req, res, next) => {
    const auth = authenticate(config, req.headers);
    if (!auth.ok) {
      res.status(auth.status).json({ message: auth.error });
      return;
    }

    const identity = auth.key ? `key:${auth.key.key}` : `ip:${req.ip ?? "unknown"}`;
    const result = limiter.check(identity, now());

    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({
        message: "Rate limit exceeded. Please retry later.",
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    next();
  };
}
