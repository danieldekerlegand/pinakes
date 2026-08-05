import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * US-001 — Gemini key never reaches the client.
 *
 * Gemini is called SERVER-SIDE ONLY. The client triggers model work through Express
 * proxy endpoints (e.g. `POST /api/extract/text`, `/api/scraping/*`) which read the
 * server-side `GEMINI_API_KEY`; the key is never shipped in the Vite bundle. These
 * tests lock that invariant in place:
 *   1. no `VITE_GEMINI_*` (client-exposed) Gemini config exists;
 *   2. no `web/` source references a Gemini key / SDK / raw model endpoint;
 *   3. the representative proxy endpoint works with the LLM mocked and needs no
 *      client-supplied key, and never echoes a key back to the caller.
 */

import { registerTextExtractorRoutes } from "../routes/text-extractor";
import type { RawTextExtraction } from "../services/text-extractor";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLIENT_SRC = path.join(REPO_ROOT, "web", "src");
const FIXTURES = path.join(__dirname, "..", "services", "fixtures", "text-extractor");

/** Recursively collect all `.ts`/`.tsx` source files under a dir. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("Gemini key is server-side only (US-001)", () => {
  it(".env.example declares the server key but no VITE_-exposed Gemini key", () => {
    const env = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf-8");
    expect(env).toMatch(/^GEMINI_API_KEY=/m);
    // A VITE_-prefixed var would be inlined into the client bundle by Vite.
    expect(env).not.toMatch(/VITE_GEMINI/i);
  });

  it("no web/ source references a Gemini key, SDK, or raw model endpoint", () => {
    const files = collectSourceFiles(CLIENT_SRC);
    // Patterns that would mean the key/model is reachable from the browser bundle.
    const forbidden = [
      /VITE_GEMINI/i, // client-exposed key
      /@google\/generative-ai/, // model SDK imported client-side
      /generativelanguage\.googleapis\.com/, // direct model REST call
      /import\.meta\.env\.[A-Z_]*GEMINI[A-Z_]*_?KEY/i, // reading a Gemini key from the client env
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf-8");
      if (forbidden.some((re) => re.test(src))) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The proxy itself moved (pinakes:64 US-1): `POST /api/extract/text` is served by
 * `services/api/src/pinakes/routers/extract.py`, which reads the same server-side
 * key — and reaches the model over REST with the key in an `x-goog-api-key`
 * **header**, so it is not in a URL any hop can log. That the Python proxy needs
 * no client-supplied key and never returns one is asserted in
 * `services/api/tests/test_ingest_routes.py`.
 *
 * What is asserted here is that this backend's retired handler cannot leak a key
 * either. The invariants above — the two that scan `.env.example` and every
 * `web/` source — are the ones that actually keep the key out of the browser
 * bundle, and they are backend-agnostic.
 */
describe("Gemini proxy endpoint /api/extract/text (retired here)", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-proxy-"));
    app = express();
    app.use(express.json());
    registerTextExtractorRoutes(app);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers 501 and never returns key material", async () => {
    // The client sends only content — no Authorization header, no key of any kind.
    const res = await fetch(`${baseUrl}/api/extract/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "The Roman Empire was founded in 27 BCE." }),
    });
    expect(res.status).toBe(501);
    const body = await res.text();
    expect(body).not.toMatch(/GEMINI_API_KEY|VITE_GEMINI/i);
  });

  it("still names the recorded fixture the Python port is graded against", () => {
    // The fixture is shared: `services/api/tests/test_text_extractor.py` reads
    // this same file, which is what makes the two normalisers comparable.
    const raw = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "roman-empire-paragraph.json"), "utf-8"),
    ) as RawTextExtraction;
    expect(raw.entities.length).toBeGreaterThan(0);
  });
});
