import { useMemo } from "react";
import {
  createSpeechController,
  prefersReducedMotion,
  type SpeechController,
} from "./ipa-speech";

/**
 * React binding for the Web Speech controller. Reads the browser globals once
 * and memoises a single controller for the component tree. Safe under SSR / the
 * node test environment (falls back to an unsupported controller).
 *
 * The playback logic itself is pure and lives in `ipa-speech.ts` (tested there);
 * this hook only wires in `window.speechSynthesis`.
 */
export function useSpeechController(): SpeechController {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return createSpeechController({ synth: null, Utterance: null });
    }
    return createSpeechController({
      synth: window.speechSynthesis ?? null,
      Utterance: window.SpeechSynthesisUtterance ?? null,
    });
  }, []);
}

/** Convenience hook: the user's reduced-motion preference. */
export function useReducedMotion(): boolean {
  return useMemo(
    () => prefersReducedMotion(typeof window === "undefined" ? null : window),
    [],
  );
}
