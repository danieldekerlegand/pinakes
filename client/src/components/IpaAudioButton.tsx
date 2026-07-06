import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSpeechText, type SpeechTarget } from "@/lib/audio/ipa-speech";
import {
  useSpeechController,
  useReducedMotion,
} from "@/lib/audio/use-speech-controller";

interface IpaAudioButtonProps extends SpeechTarget {
  /**
   * Human-readable description of what is spoken, for the accessible label
   * (e.g. the word or language name). Falls back to the spoken text.
   */
  label?: string;
  className?: string;
  /** Icon size in px (default 14). */
  size?: number;
}

/**
 * Accessible speaker button that plays an IPA transcription / word form via the
 * Web Speech API. Renders as a disabled, clearly-labelled control when speech
 * is unsupported or there is nothing pronounceable (graceful fallback).
 */
export default function IpaAudioButton({
  form,
  ipa,
  lang,
  label,
  className,
  size = 14,
}: IpaAudioButtonProps) {
  const controller = useSpeechController();
  const reducedMotion = useReducedMotion();
  const [speaking, setSpeaking] = useState(false);

  const target: SpeechTarget = { form, ipa, lang };
  const hasContent = resolveSpeechText(target) !== null;
  const available = controller.supported && hasContent;
  const spokenLabel = label ?? resolveSpeechText(target) ?? "";

  // Cancel any in-progress speech if this control unmounts.
  useEffect(() => () => controller.stop(), [controller]);

  const handleClick = () => {
    if (!available) return;
    if (speaking) {
      controller.stop();
      setSpeaking(false);
      return;
    }
    const started = controller.play(target, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
    if (!started) setSpeaking(false);
  };

  const title = !controller.supported
    ? "Pronunciation audio not supported in this browser"
    : !hasContent
      ? "No pronunciation available"
      : speaking
        ? `Stop ${spokenLabel}`
        : `Play pronunciation of ${spokenLabel}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!available}
      aria-label={title}
      aria-pressed={speaking}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded p-0.5 align-middle text-gray-500 transition-colors",
        available
          ? "cursor-pointer hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          : "cursor-not-allowed opacity-40",
        speaking && !reducedMotion && "animate-pulse text-blue-600",
        speaking && reducedMotion && "text-blue-600",
        className,
      )}
    >
      {available ? (
        <Volume2 style={{ width: size, height: size }} />
      ) : (
        <VolumeX style={{ width: size, height: size }} />
      )}
    </button>
  );
}
