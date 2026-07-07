/**
 * Server-side Google Translate proxy (US-002).
 *
 * The Google Translate API key is read from the **server-side** `GOOGLE_TRANSLATE_API_KEY`
 * env var only — it is never shipped to the client (no `VITE_`-prefixed key). The client
 * calls `POST /api/translate` (see `server/routes/translate.ts`) and this service makes the
 * upstream request, mirroring the Gemini "server-side only" posture (docs/SECURITY.md).
 *
 * The network boundary (`TranslateDeps`) is injectable so tests exercise the service with a
 * fixture-backed fake — no live Google call, no API key. `liveDeps` hits the real
 * Translation v2 REST endpoint.
 */

/** A single translation request. */
export interface TranslateInput {
  text: string;
  /** BCP-47 / ISO source language code (optional — Google auto-detects when omitted). */
  from?: string;
  /** BCP-47 / ISO target language code. */
  to: string;
}

/** The upstream network boundary — injected in tests, `liveDeps` in production. */
export interface TranslateDeps {
  /**
   * Translate `text` into `to` (optionally from `from`) using `apiKey`.
   * Returns the translated string, or `null` when the upstream yields no translation.
   * Throws `TranslateError` on an upstream/transport failure.
   */
  translate(input: Required<Pick<TranslateInput, "text" | "to">> & { from?: string }, apiKey: string): Promise<string | null>;
}

/** Raised on an upstream Google Translate failure (mapped to 502 by the route). */
export class TranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslateError";
  }
}

/** Raised when no server-side key is configured (mapped to 503 by the route). */
export class TranslateNotConfiguredError extends Error {
  constructor(message = "GOOGLE_TRANSLATE_API_KEY is not configured on the server") {
    super(message);
    this.name = "TranslateNotConfiguredError";
  }
}

/** Read the server-side key (never a `VITE_`-prefixed one). */
export function loadTranslateApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.GOOGLE_TRANSLATE_API_KEY?.trim();
  return key ? key : null;
}

const GOOGLE_TRANSLATE_ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

interface GoogleTranslateResponse {
  data?: { translations?: Array<{ translatedText?: string }> };
  error?: { message?: string };
}

/** Live deps hitting the real Google Translation v2 REST API. */
export const liveDeps: TranslateDeps = {
  async translate(input, apiKey): Promise<string | null> {
    const body: Record<string, string> = {
      q: input.text,
      target: input.to,
      format: "text",
    };
    if (input.from) body.source = input.from;

    let res: Response;
    try {
      res = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new TranslateError(`Google Translate request failed: ${String(error)}`);
    }

    const data = (await res.json().catch(() => ({}))) as GoogleTranslateResponse;
    if (!res.ok) {
      throw new TranslateError(
        `Google Translate returned ${res.status}${data.error?.message ? `: ${data.error.message}` : ""}`,
      );
    }
    return data.data?.translations?.[0]?.translatedText ?? null;
  },
};

/** Validation error (mapped to 400 by the route). */
export class TranslateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslateValidationError";
  }
}

/** Normalize + validate a raw request body into a `TranslateInput`. */
export function validateTranslateInput(body: unknown): TranslateInput {
  const b = (body ?? {}) as { text?: unknown; from?: unknown; to?: unknown };
  if (typeof b.text !== "string" || !b.text.trim()) {
    throw new TranslateValidationError("text is required");
  }
  if (typeof b.to !== "string" || !b.to.trim()) {
    throw new TranslateValidationError("to (target language) is required");
  }
  const from = typeof b.from === "string" && b.from.trim() ? b.from.trim() : undefined;
  return { text: b.text, to: b.to.trim(), from };
}

export interface TranslateResult {
  translation: string | null;
  source: "google-translate";
  from: string | null;
  to: string;
}

/**
 * Translate one string through the injectable deps using the server-side key.
 * Throws `TranslateNotConfiguredError` when no key is set, `TranslateError` on upstream failure.
 */
export async function translateText(
  input: TranslateInput,
  deps: TranslateDeps = liveDeps,
  apiKey: string | null = loadTranslateApiKey(),
): Promise<TranslateResult> {
  if (!apiKey) throw new TranslateNotConfiguredError();
  const translation = await deps.translate({ text: input.text, to: input.to, from: input.from }, apiKey);
  return { translation, source: "google-translate", from: input.from ?? null, to: input.to };
}
