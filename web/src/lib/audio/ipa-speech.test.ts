import { describe, it, expect, vi } from "vitest";
import {
  stripIpaDelimiters,
  resolveSpeechText,
  normalizeLang,
  isSpeechSupported,
  prefersReducedMotion,
  createSpeechController,
  type SpeechEnv,
} from "./ipa-speech";

// --- Test doubles for the Web Speech API (unavailable in the node test env) ---

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeEnv() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      u.onstart?.();
    }),
    cancel: vi.fn(),
  };
  const env: SpeechEnv = {
    synth: synth as unknown as SpeechSynthesis,
    Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
  };
  return { env, synth, spoken };
}

describe("stripIpaDelimiters", () => {
  it("removes slash/bracket delimiters and stress/length marks", () => {
    expect(stripIpaDelimiters("/ˈwɔːtər/")).toBe("wɔtər");
    expect(stripIpaDelimiters("[ˌɪntərˈnæʃənəl]")).toBe("ɪntərnæʃənəl");
  });

  it("collapses prosodic breaks and whitespace", () => {
    expect(stripIpaDelimiters("a.b | c")).toBe("a b c");
  });
});

describe("resolveSpeechText", () => {
  it("prefers the orthographic form over IPA", () => {
    expect(resolveSpeechText({ form: "Wasser", ipa: "/ˈvasɐ/" })).toBe("Wasser");
  });

  it("falls back to cleaned IPA when there is no form", () => {
    expect(resolveSpeechText({ ipa: "/ˈvasɐ/" })).toBe("vasɐ");
  });

  it("returns null when nothing is pronounceable", () => {
    expect(resolveSpeechText({})).toBeNull();
    expect(resolveSpeechText({ form: "   ", ipa: "" })).toBeNull();
    expect(resolveSpeechText({ ipa: "//" })).toBeNull();
  });
});

describe("normalizeLang", () => {
  it("trims and passes through, undefined when empty", () => {
    expect(normalizeLang("  de ")).toBe("de");
    expect(normalizeLang(null)).toBeUndefined();
    expect(normalizeLang("")).toBeUndefined();
  });
});

describe("isSpeechSupported", () => {
  it("is true only when both synth.speak and Utterance exist", () => {
    const { env } = fakeEnv();
    expect(isSpeechSupported(env)).toBe(true);
    expect(isSpeechSupported({ synth: null, Utterance: null })).toBe(false);
    expect(isSpeechSupported({ synth: env.synth, Utterance: null })).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  it("reflects the media query and is safe when matchMedia is absent", () => {
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
  });
});

describe("createSpeechController", () => {
  it("exposes support based on the environment", () => {
    const { env } = fakeEnv();
    expect(createSpeechController(env).supported).toBe(true);
    expect(createSpeechController({ synth: null }).supported).toBe(false);
  });

  it("speaks the resolved text with lang and rate, cancelling first", () => {
    const { env, synth, spoken } = fakeEnv();
    const controller = createSpeechController(env);

    const started = controller.play({ form: "Wasser", lang: "de" }, { rate: 0.9 });

    expect(started).toBe(true);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Wasser");
    expect(spoken[0].lang).toBe("de");
    expect(spoken[0].rate).toBe(0.9);
  });

  it("fires onStart/onEnd callbacks around playback", () => {
    const { env, spoken } = fakeEnv();
    const controller = createSpeechController(env);
    const onStart = vi.fn();
    const onEnd = vi.fn();

    controller.play({ ipa: "/ˈvasɐ/" }, { onStart, onEnd });
    expect(onStart).toHaveBeenCalledTimes(1);

    spoken[0].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("returns false and does nothing when unsupported (graceful fallback)", () => {
    const controller = createSpeechController({ synth: null, Utterance: null });
    expect(controller.play({ form: "Wasser" })).toBe(false);
    expect(() => controller.stop()).not.toThrow();
  });

  it("returns false when there is no pronounceable content", () => {
    const { env, synth } = fakeEnv();
    const controller = createSpeechController(env);
    expect(controller.play({ form: "", ipa: "" })).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("stop() cancels in-progress speech", () => {
    const { env, synth } = fakeEnv();
    createSpeechController(env).stop();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });
});
