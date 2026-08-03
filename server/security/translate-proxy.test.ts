import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * US-002 — Google Translate key never reaches the client.
 *
 * Translation is proxied SERVER-SIDE through `POST /api/translate`, which reads the
 * server-side `GOOGLE_TRANSLATE_API_KEY`; the key is never shipped in the Vite bundle.
 * These tests lock that invariant in place (mirrors the Gemini guard, US-001):
 *   1. `.env.example` declares the server key but no `VITE_`-exposed translate key;
 *   2. no `web/` source references a `VITE_GOOGLE_TRANSLATE*` key, `process.env`
 *      translate key, or the raw Google Translate REST endpoint.
 *
 * The proxy's own behavior (mocked upstream, no key echoed) is covered in
 * `server/routes/translate.test.ts`.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLIENT_SRC = path.join(REPO_ROOT, "web", "src");

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

describe("Google Translate key is server-side only (US-002)", () => {
  it(".env.example declares the server key but no VITE_-exposed translate key", () => {
    const env = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf-8");
    expect(env).toMatch(/^GOOGLE_TRANSLATE_API_KEY=/m);
    // A VITE_-prefixed var would be inlined into the client bundle by Vite.
    expect(env).not.toMatch(/VITE_GOOGLE_TRANSLATE/i);
  });

  it("no web/ source references a translate key or the raw Google Translate endpoint", () => {
    const files = collectSourceFiles(CLIENT_SRC);
    const forbidden = [
      /VITE_GOOGLE_TRANSLATE/i, // client-exposed key
      /GOOGLE_TRANSLATE_API_KEY/i, // any reference to the translate key name in the bundle
      /translation\.googleapis\.com/, // direct REST call from the browser
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
