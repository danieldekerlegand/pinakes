import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipForward, SkipBack, ListMusic, Music, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/audio/use-speech-controller";
import {
  type AudioClip,
  clipProvenance,
  detectAudioSupport,
  nextClipIndex,
  prevClipIndex,
  forwardClipIndex,
} from "./audio-gallery-utils";

interface CultureAudioGalleryProps {
  clips: AudioClip[];
  className?: string;
  /** Heading shown above the player (e.g. "Music & instrument clips"). */
  title?: string;
}

/**
 * Audio side of the culture media gallery (US-003): plays `mediaType:'audio'`
 * assets (music traditions, instrument clips) with a single shared `<audio>`
 * element, per-clip play/pause, and a "Play all" sequence/playlist that
 * auto-advances. Attribution/provenance is shown for every clip. Degrades
 * gracefully when audio is unsupported or no clips exist.
 *
 * All list/sequence/provenance logic is pure in `audio-gallery-utils.ts`
 * (unit-tested there); this component only wires the DOM `<audio>` element.
 */
export function CultureAudioGallery({ clips, className, title = "Audio" }: CultureAudioGalleryProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSequence, setIsSequence] = useState(false);
  const reducedMotion = useReducedMotion();

  const supported = useMemo(
    () => detectAudioSupport(typeof document === "undefined" ? null : document),
    [],
  );

  const playIndex = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsPlaying(true);
    // Defer the actual play() to the effect below so the <audio src> updates first.
  }, []);

  // Load + play whenever the selected clip changes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || currentIndex === null) return;
    const clip = clips[currentIndex];
    if (!clip) return;
    if (el.src !== clip.url) el.src = clip.url;
    if (isPlaying) {
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => setIsPlaying(false));
      }
    } else {
      el.pause();
    }
  }, [currentIndex, isPlaying, clips]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setIsSequence(false);
  }, []);

  const togglePlay = useCallback(
    (index: number) => {
      if (currentIndex === index && isPlaying) {
        setIsPlaying(false);
        setIsSequence(false);
        return;
      }
      setIsSequence(false);
      playIndex(index);
    },
    [currentIndex, isPlaying, playIndex],
  );

  const playAll = useCallback(() => {
    if (clips.length === 0) return;
    setIsSequence(true);
    playIndex(0);
  }, [clips.length, playIndex]);

  const goNext = useCallback(() => {
    if (currentIndex === null) return;
    const next = forwardClipIndex(currentIndex, clips.length);
    playIndex(next);
  }, [currentIndex, clips.length, playIndex]);

  const goPrev = useCallback(() => {
    if (currentIndex === null) return;
    playIndex(prevClipIndex(currentIndex, clips.length));
  }, [currentIndex, clips.length, playIndex]);

  const handleEnded = useCallback(() => {
    if (isSequence && currentIndex !== null) {
      const next = nextClipIndex(currentIndex, clips.length, false);
      if (next !== null) {
        playIndex(next);
        return;
      }
      setIsSequence(false);
    }
    setIsPlaying(false);
  }, [isSequence, currentIndex, clips.length, playIndex]);

  if (clips.length === 0) return null;

  if (!supported) {
    return (
      <div
        className={cn("rounded-lg border border-gray-200 dark:border-gray-700 p-4", className)}
        data-testid="culture-audio-gallery-unsupported"
      >
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <VolumeX className="h-4 w-4" />
          <span>Audio playback isn&apos;t available in this browser.</span>
        </div>
        <ul className="mt-2 space-y-1">
          {clips.map((clip) => (
            <li key={clip.id} className="text-xs text-gray-500 dark:text-gray-400">
              <a
                href={clip.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-gray-200"
              >
                {clip.title}
              </a>{" "}
              — {clipProvenance(clip).summary}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} data-testid="culture-audio-gallery">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
          <Music className="h-3.5 w-3.5" />
          <span>{title}</span>
          <span className="text-gray-400 dark:text-gray-500">({clips.length})</span>
        </div>
        {clips.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={isSequence && isPlaying ? stop : playAll}
            data-testid="audio-play-all"
            aria-label={isSequence && isPlaying ? "Stop playlist" : "Play all clips in sequence"}
          >
            <ListMusic className="h-3.5 w-3.5" />
            {isSequence && isPlaying ? "Stop" : "Play all"}
          </Button>
        )}
      </div>

      <ul className="space-y-1.5" role="list">
        {clips.map((clip, i) => {
          const active = currentIndex === i;
          const playing = active && isPlaying;
          const prov = clipProvenance(clip);
          return (
            <li
              key={clip.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-2.5 transition-colors",
                active
                  ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40"
                  : "border-gray-200 dark:border-gray-700",
              )}
              data-testid={`audio-clip-${clip.id}`}
            >
              <Button
                variant={playing ? "default" : "secondary"}
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0 rounded-full",
                  playing && !reducedMotion && "animate-pulse",
                )}
                onClick={() => togglePlay(i)}
                data-testid={`audio-toggle-${clip.id}`}
                aria-label={playing ? `Pause ${clip.title}` : `Play ${clip.title}`}
                aria-pressed={playing}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {clip.title}
                </p>
                {clip.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                    {clip.description}
                  </p>
                )}
                <div
                  className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-gray-400 dark:text-gray-500"
                  data-testid={`audio-provenance-${clip.id}`}
                >
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {prov.license}
                  </Badge>
                  {prov.attribution && <span>by {prov.attribution}</span>}
                  {prov.source && (
                    <a
                      href={clip.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {prov.source}
                    </a>
                  )}
                </div>
              </div>

              {active && clips.length > 1 && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={goPrev}
                    data-testid="audio-prev"
                    aria-label="Previous clip"
                  >
                    <SkipBack className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={goNext}
                    data-testid="audio-next"
                    aria-label="Next clip"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Single shared audio element for the whole playlist. */}
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        preload="none"
        data-testid="culture-audio-element"
      >
        <track kind="captions" />
      </audio>
    </div>
  );
}

export default CultureAudioGallery;
