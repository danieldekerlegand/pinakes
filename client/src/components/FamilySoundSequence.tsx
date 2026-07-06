import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, Music4, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useSpeechController,
  useReducedMotion,
} from "@/lib/audio/use-speech-controller";
import {
  buildFamilySequence,
  createSequencePlayer,
  type OrderableFamily,
  type OrderableLanguage,
  type ReconstructedForm,
  type SequencePlayerHandle,
} from "@/lib/audio/family-sequence";
import { resolveSpeechText } from "@/lib/audio/ipa-speech";

interface FamilySoundSequenceProps {
  /** Languages to play, in any order — sorted genealogically internally. */
  languages: OrderableLanguage[];
  /** Family tree used to derive the genealogical ordering. */
  families: OrderableFamily[];
  /** Pronounceable content per language (form / IPA / BCP-47 hint). */
  content: (lang: OrderableLanguage) => {
    form?: string | null;
    ipa?: string | null;
    lang?: string | null;
  };
  /** Optional reconstructed proto-forms (clearly labelled speculative). */
  reconstructed?: ReconstructedForm[];
  /** Short description of what is being played (e.g. the concept/base word). */
  conceptLabel?: string;
  className?: string;
}

/**
 * Plays the pronunciations of a language family in genealogical order (US-004),
 * reusing the US-002 Web Speech controller. Reconstructed proto-forms, where
 * supplied, are played first and clearly flagged speculative. Renders a graceful
 * message when speech is unsupported or there is nothing pronounceable.
 */
export default function FamilySoundSequence({
  languages,
  families,
  content,
  reconstructed,
  conceptLabel,
  className,
}: FamilySoundSequenceProps) {
  const controller = useSpeechController();
  const reducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<SequencePlayerHandle | null>(null);

  const items = useMemo(
    () => buildFamilySequence({ languages, families, content, reconstructed }),
    [languages, families, content, reconstructed],
  );

  const playableCount = useMemo(
    () => items.filter((item) => resolveSpeechText(item) !== null).length,
    [items],
  );

  // Rebuild the player whenever the sequence or controller changes; tear down on
  // unmount so a navigation away cancels any in-flight speech.
  useEffect(() => {
    const player = createSequencePlayer(controller, items, {
      onItemStart: (_item, index) => setActiveIndex(index),
      onComplete: () => {
        setPlaying(false);
        setActiveIndex(-1);
      },
      onStop: () => {
        setPlaying(false);
        setActiveIndex(-1);
      },
    });
    playerRef.current = player;
    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [controller, items]);

  const canPlay = controller.supported && playableCount > 0;

  const handleToggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.stop();
      setPlaying(false);
      setActiveIndex(-1);
      return;
    }
    setPlaying(true);
    player.start();
    // A synchronous (unsupported / empty) run may already have completed.
    if (!player.isPlaying()) {
      setPlaying(false);
      setActiveIndex(-1);
    }
  };

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50",
        className,
      )}
      data-testid="family-sound-sequence"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          <Music4 className="h-4 w-4" />
          <span>
            Sound of the family
            {conceptLabel ? (
              <span className="text-gray-500 dark:text-gray-400"> — "{conceptLabel}"</span>
            ) : null}
          </span>
        </div>
        <Button
          size="sm"
          variant={playing ? "secondary" : "default"}
          onClick={handleToggle}
          disabled={!canPlay}
          aria-pressed={playing}
          title={
            !controller.supported
              ? "Pronunciation audio not supported in this browser"
              : playableCount === 0
                ? "No pronunciations available for this selection"
                : playing
                  ? "Stop sequence"
                  : "Play the family in genealogical order"
          }
        >
          {playing ? (
            <>
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </>
          ) : (
            <>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Play sequence
            </>
          )}
        </Button>
      </div>

      {!controller.supported ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Your browser does not support speech playback, but the languages are still listed below
          in genealogical order.
        </p>
      ) : playableCount === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No pronounceable forms are available for the selected languages.
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Plays {playableCount} pronunciation{playableCount === 1 ? "" : "s"} across the family, from
          ancestral branches outward.
        </p>
      )}

      <ol className="mt-3 flex flex-wrap gap-1.5">
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          const speakable = resolveSpeechText(item) !== null;
          return (
            <li key={`${item.id}-${index}`}>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  isActive
                    ? cn(
                        "border-blue-500 bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100",
                        !reducedMotion && "animate-pulse",
                      )
                    : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300",
                  !speakable && "opacity-50",
                )}
                title={item.reconstructed ? "Reconstructed proto-form (speculative)" : undefined}
              >
                {item.reconstructed && <Sparkles className="h-3 w-3 text-amber-500" />}
                <span>{item.label}</span>
                {item.reconstructed && (
                  <Badge
                    variant="outline"
                    className="ml-0.5 border-amber-300 px-1 py-0 text-[10px] font-normal text-amber-700 dark:text-amber-300"
                  >
                    reconstructed
                  </Badge>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
