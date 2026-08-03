/**
 * The parity replay harness (tasks/chief/30-api-shell-parity.json US-1).
 *
 * A *fixture* is one recorded request/response pair against the TS Express API.
 * `replayFixture` sends that same request at any handler behind an injectable
 * `ParityFetch` — the Express app under vitest today, the FastAPI service
 * (`services/api`) as each route group is ported — and reports how the answer
 * differs from the baseline, structurally (see `shape.ts`).
 *
 * Injectable fetch is the whole point: the harness never knows or cares which
 * implementation is on the other end, so the same fixtures grade both.
 *
 * `loadParityFixtures` is a **node-only** convenience (it touches `node:fs`);
 * never import it from `web/src`.
 */
import fs from "node:fs";
import path from "node:path";

import { formatShape, matchShape, type MatchOptions, type ShapeMismatch, type TypeShape } from "./shape";

/** A request worth recording — the curated catalog lives in `requests.json`. */
export interface ParityRequest {
  /** Stable slug; also the fixture filename. */
  id: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Concrete path including any query string, e.g. `/api/summaries/language?limit=2`. */
  path: string;
  /** The route template this exercises, e.g. `/api/summaries/{domain}`. */
  route: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Set when the request deliberately records an error contract (400/404/…). */
  expectStatus?: number;
}

export interface ParityFixture {
  id: string;
  description: string;
  request: Omit<ParityRequest, "id" | "description">;
  response: {
    status: number;
    contentType: string | null;
    /** The structural baseline the ported handler must satisfy. */
    shape: TypeShape;
    /** Truncated illustrative body — documentation only, never asserted on. */
    sample: unknown;
  };
}

export interface ParityResponse {
  status: number;
  contentType: string | null;
  body: unknown;
}

export type ParityFetch = (request: ParityRequest) => Promise<ParityResponse>;

export interface ParityResult {
  id: string;
  ok: boolean;
  status: number;
  expectedStatus: number;
  mismatches: ShapeMismatch[];
  /** Populated when the candidate could not be reached / did not answer JSON. */
  error?: string;
}

/** Build a `ParityFetch` that talks HTTP to a running server at `baseUrl`. */
export function httpParityFetch(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ParityFetch {
  return async (request) => {
    const headers: Record<string, string> = { ...request.headers };
    let body: string | undefined;
    if (request.body !== undefined) {
      body = JSON.stringify(request.body);
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${request.path}`, {
      method: request.method,
      headers,
      body,
    });
    const contentType = response.headers.get("content-type");
    const text = await response.text();
    let parsed: unknown = text;
    if (contentType?.includes("json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, contentType, body: parsed };
  };
}

/**
 * Replay one fixture against a handler and grade the answer.
 *
 * A status difference is always an error; the body is only compared when the
 * status matches (a 500 body has nothing to say about the 200 baseline).
 */
export async function replayFixture(
  fixture: ParityFixture,
  fetchImpl: ParityFetch,
  options: MatchOptions = {},
): Promise<ParityResult> {
  const request: ParityRequest = {
    id: fixture.id,
    description: fixture.description,
    ...fixture.request,
  };
  let response: ParityResponse;
  try {
    response = await fetchImpl(request);
  } catch (error) {
    return {
      id: fixture.id,
      ok: false,
      status: 0,
      expectedStatus: fixture.response.status,
      mismatches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const expectedStatus = fixture.response.status;
  if (response.status !== expectedStatus) {
    return {
      id: fixture.id,
      ok: false,
      status: response.status,
      expectedStatus,
      mismatches: [
        {
          path: "$status",
          expected: String(expectedStatus),
          actual: String(response.status),
          severity: "error",
        },
      ],
    };
  }

  const mismatches = matchShape(fixture.response.shape, response.body, options);
  return {
    id: fixture.id,
    ok: mismatches.every((m) => m.severity !== "error"),
    status: response.status,
    expectedStatus,
    mismatches,
  };
}

/** Replay every fixture, sequentially (handlers may share process-wide state). */
export async function replayFixtures(
  fixtures: ParityFixture[],
  fetchImpl: ParityFetch,
  options: MatchOptions = {},
): Promise<ParityResult[]> {
  const results: ParityResult[] = [];
  for (const fixture of fixtures) {
    results.push(await replayFixture(fixture, fetchImpl, options));
  }
  return results;
}

/** One-line-per-mismatch report for a failed replay. */
export function formatParityResult(result: ParityResult): string {
  if (result.ok) return `${result.id}: ok (${result.status})`;
  if (result.error) return `${result.id}: unreachable — ${result.error}`;
  const lines = result.mismatches
    .filter((m) => m.severity === "error")
    .map((m) => `    ${m.path}: expected ${m.expected}, got ${m.actual}`);
  return [`${result.id}: FAILED`, ...lines].join("\n");
}

/** Node-only: read every `*.json` fixture from a directory, sorted by id. */
export function loadParityFixtures(dir: string): ParityFixture[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as ParityFixture);
}

export { formatShape };
export type { ShapeMismatch, TypeShape };
