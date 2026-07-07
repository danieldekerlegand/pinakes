/**
 * Server-side translation proxy route (US-002).
 *
 * `POST /api/translate` accepts `{ text, to, from? }` and returns the translation,
 * making the upstream Google Translate call with the **server-side**
 * `GOOGLE_TRANSLATE_API_KEY`. The key is never exposed to the client — mirrors the
 * Gemini "server-side only" posture (docs/SECURITY.md).
 *
 * Both the network boundary (`TranslateDeps`) and the resolved key are injectable so
 * tests run with a fixture-backed fake and no real API key (see
 * `server/routes/translate.test.ts`).
 */

import type { Express } from "express";
import {
  liveDeps,
  loadTranslateApiKey,
  translateText,
  TranslateError,
  TranslateNotConfiguredError,
  TranslateValidationError,
  validateTranslateInput,
  type TranslateDeps,
} from "../services/translate";

export interface TranslateRouteOptions {
  /** Network boundary (default: live Google Translate REST). */
  deps?: TranslateDeps;
  /** Server-side key (default: read from `GOOGLE_TRANSLATE_API_KEY`). */
  apiKey?: string | null;
}

export function registerTranslateRoutes(app: Express, options: TranslateRouteOptions = {}): void {
  const deps = options.deps ?? liveDeps;
  // Resolve the key once at registration; `undefined` means "read env now".
  const apiKey = options.apiKey === undefined ? loadTranslateApiKey() : options.apiKey;

  /**
   * POST /api/translate
   * Body: `{ text, to, from? }`.
   * 200 `{ translation, source, from, to }`; 400 invalid body; 502 upstream failure;
   * 503 when no server-side key is configured.
   */
  app.post("/api/translate", async (req, res) => {
    let input;
    try {
      input = validateTranslateInput(req.body);
    } catch (error) {
      if (error instanceof TranslateValidationError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }

    try {
      const result = await translateText(input, deps, apiKey);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof TranslateNotConfiguredError) {
        return res.status(503).json({ message: "Translation is not available (no server-side key configured)" });
      }
      if (error instanceof TranslateError) {
        return res.status(502).json({ message: "Translation failed" });
      }
      console.error("Translation failed:", error);
      return res.status(502).json({ message: "Translation failed" });
    }
  });
}
