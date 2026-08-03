/**
 * IPA / word-form audio playback via the Web Speech API (`speechSynthesis`).
 *
 * The browser-facing pieces (`SpeechSynthesis`, `SpeechSynthesisUtterance`) are
 * injected through {@link SpeechEnv} so this logic is unit-testable in a
 * non-DOM (node) environment — see `ipa-speech.test.ts`. The React binding
 * lives in `web/src/lib/audio/use-speech-controller.ts` +
 * `web/src/components/IpaAudioButton.tsx`.
 *
 * Recorded-clip playback (`mediaType:'audio'` assets from
 * `server/services/media-asset-service.ts`) can be layered on later by
 * preferring a clip URL over synthesis; for now we synthesise, which needs no
 * pre-recorded assets and degrades gracefully where TTS is unavailable.
 */

export interface SpeechTarget {
  /** Orthographic word form — the most reliable thing for a TTS engine to say. */
  form?: string | null;
  /** IPA transcription (e.g. "/ˈwɔːtər/"). Spoken only as a best-effort fallback. */
  ipa?: string | null;
  /** BCP-47 language hint (e.g. "de", "fr-FR") used to pick a matching voice. */
  lang?: string | null;
}

export interface PlayOptions {
  /** Speaking rate (0.1–10). Default 0.85 — slightly slow for clarity. */
  rate?: number;
  /** Fired when the utterance actually begins. */
  onStart?: () => void;
  /** Fired when the utterance ends, is cancelled, or errors. */
  onEnd?: () => void;
}

/** Minimal shape of the Web Speech globals we depend on (kept injectable). */
export interface SpeechEnv {
  synth?: SpeechSynthesis | null;
  Utterance?: typeof SpeechSynthesisUtterance | null;
}

export interface SpeechController {
  /** Whether the current environment can synthesise speech at all. */
  readonly supported: boolean;
  /** Speak the target. Returns `true` if playback was actually started. */
  play(target: SpeechTarget, options?: PlayOptions): boolean;
  /** Cancel any in-progress or queued speech. */
  stop(): void;
}

const DEFAULT_RATE = 0.85;

/** Strip IPA delimiters and suprasegmental marks so a TTS engine has a chance. */
export function stripIpaDelimiters(ipa: string): string {
  return ipa
    .replace(/[/[\]]/g, "") // /.../ and [...] delimiters
    .replace(/[ˈˌ]/g, "") // primary / secondary stress
    .replace(/[ːˑ]/g, "") // length marks
    .replace(/[|‖.]/g, " ") // prosodic breaks / syllable dots
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Choose the best text to speak: prefer the orthographic form (TTS engines
 * pronounce real words far better than raw IPA), fall back to cleaned IPA, and
 * return `null` when there is nothing pronounceable.
 */
export function resolveSpeechText(target: SpeechTarget): string | null {
  const form = target.form?.trim();
  if (form) return form;
  const ipa = target.ipa?.trim();
  if (ipa) {
    const cleaned = stripIpaDelimiters(ipa);
    return cleaned.length > 0 ? cleaned : null;
  }
  return null;
}

/** Normalise a BCP-47 / ISO-639 hint to something usable as `utterance.lang`. */
export function normalizeLang(lang?: string | null): string | undefined {
  const l = lang?.trim();
  return l ? l : undefined;
}

/** Feature-detect: is speech synthesis usable in this environment? */
export function isSpeechSupported(env: SpeechEnv): boolean {
  return !!(env.synth && typeof env.synth.speak === "function" && env.Utterance);
}

/**
 * Honour the user's reduced-motion preference. Playback is always
 * user-initiated (button click), so audio is never auto-played; this is used by
 * the UI to suppress the pulsing "now playing" animation.
 */
export function prefersReducedMotion(
  win?: { matchMedia?: (query: string) => { matches: boolean } } | null,
): boolean {
  try {
    return win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  } catch {
    return false;
  }
}

/** Build a speech controller over an injectable Web Speech environment. */
export function createSpeechController(env: SpeechEnv): SpeechController {
  const supported = isSpeechSupported(env);

  return {
    supported,
    play(target, options = {}) {
      if (!supported || !env.synth || !env.Utterance) return false;
      const text = resolveSpeechText(target);
      if (!text) return false;

      // Stop anything already speaking so clicks don't queue up.
      env.synth.cancel();

      const utterance = new env.Utterance(text);
      const lang = normalizeLang(target.lang);
      if (lang) utterance.lang = lang;
      utterance.rate = options.rate ?? DEFAULT_RATE;
      utterance.onstart = () => options.onStart?.();
      utterance.onend = () => options.onEnd?.();
      utterance.onerror = () => options.onEnd?.();

      env.synth.speak(utterance);
      return true;
    },
    stop() {
      env.synth?.cancel();
    },
  };
}
