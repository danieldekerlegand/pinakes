import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { cn } from '@/lib/utils';

interface TimeNavigatorProps {
  /** Minimum year (negative for BCE) */
  minYear?: number;
  /** Maximum year */
  maxYear?: number;
  /** Current year value */
  currentYear: number;
  /** Callback when year changes */
  onYearChange: (year: number) => void;
  /** Whether the navigator is playing */
  isPlaying?: boolean;
  /** Callback when play state changes */
  onPlayingChange?: (playing: boolean) => void;
  /** Playback speed in years per second */
  playbackSpeed?: number;
  /** Callback when playback speed changes */
  onPlaybackSpeedChange?: (speed: number) => void;
  /** Step size for navigation */
  stepSize?: number;
  /** Callback when step size changes */
  onStepSizeChange?: (step: number) => void;
  /** Additional CSS classes */
  className?: string;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

const STEP_SIZES = [10, 25, 50, 100, 250, 500, 1000];
const PLAYBACK_SPEEDS = [0.5, 1, 2, 5, 10];

/**
 * Format a year for display (BCE/CE notation)
 */
export function formatYear(year: number): string {
  if (year < 0) {
    return `${Math.abs(year).toLocaleString()} BCE`;
  } else if (year === 0) {
    return '1 BCE'; // There's no year 0
  } else {
    return `${year.toLocaleString()} CE`;
  }
}

/**
 * Format a year in short form for compact display
 */
export function formatYearShort(year: number): string {
  const absYear = Math.abs(year);
  if (absYear >= 1000) {
    const k = absYear / 1000;
    const formatted = k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '');
    return year < 0 ? `-${formatted}k` : `${formatted}k`;
  }
  return year.toString();
}

export function TimeNavigator({
  minYear = -10000,
  maxYear = new Date().getFullYear(),
  currentYear,
  onYearChange,
  isPlaying = false,
  onPlayingChange,
  playbackSpeed = 100,
  onPlaybackSpeedChange,
  stepSize = 100,
  onStepSizeChange,
  className,
  compact = false,
}: TimeNavigatorProps) {
  const [localPlaying, setLocalPlaying] = useState(isPlaying);
  const [localSpeed, setLocalSpeed] = useState(playbackSpeed);
  const [localStep, setLocalStep] = useState(stepSize);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const playing = onPlayingChange ? isPlaying : localPlaying;
  const speed = onPlaybackSpeedChange ? playbackSpeed : localSpeed;
  const step = onStepSizeChange ? stepSize : localStep;

  const setPlaying = useCallback((value: boolean) => {
    if (onPlayingChange) {
      onPlayingChange(value);
    } else {
      setLocalPlaying(value);
    }
  }, [onPlayingChange]);

  const setSpeed = useCallback((value: number) => {
    if (onPlaybackSpeedChange) {
      onPlaybackSpeedChange(value);
    } else {
      setLocalSpeed(value);
    }
  }, [onPlaybackSpeedChange]);

  const setStep = useCallback((value: number) => {
    if (onStepSizeChange) {
      onStepSizeChange(value);
    } else {
      setLocalStep(value);
    }
  }, [onStepSizeChange]);

  // Animation loop for playback
  useEffect(() => {
    if (!playing) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const animate = (timestamp: number) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastTimeRef.current;
      const yearsPerMs = speed / 1000;
      const yearsToAdd = elapsed * yearsPerMs;

      if (yearsToAdd >= 1) {
        const newYear = Math.min(currentYear + Math.floor(yearsToAdd), maxYear);
        lastTimeRef.current = timestamp;

        if (newYear >= maxYear) {
          setPlaying(false);
          onYearChange(maxYear);
        } else {
          onYearChange(newYear);
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [playing, speed, currentYear, maxYear, onYearChange, setPlaying]);

  const handleSliderChange = useCallback((values: number[]) => {
    onYearChange(values[0]);
  }, [onYearChange]);

  const handleStepBack = useCallback(() => {
    const newYear = Math.max(currentYear - step, minYear);
    onYearChange(newYear);
  }, [currentYear, step, minYear, onYearChange]);

  const handleStepForward = useCallback(() => {
    const newYear = Math.min(currentYear + step, maxYear);
    onYearChange(newYear);
  }, [currentYear, step, maxYear, onYearChange]);

  const handleJumpToStart = useCallback(() => {
    onYearChange(minYear);
  }, [minYear, onYearChange]);

  const handleJumpToEnd = useCallback(() => {
    onYearChange(maxYear);
  }, [maxYear, onYearChange]);

  const togglePlay = useCallback(() => {
    if (currentYear >= maxYear) {
      onYearChange(minYear);
    }
    setPlaying(!playing);
  }, [playing, currentYear, maxYear, minYear, onYearChange, setPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleStepBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleStepForward();
          break;
        case 'Home':
          e.preventDefault();
          handleJumpToStart();
          break;
        case 'End':
          e.preventDefault();
          handleJumpToEnd();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, handleStepBack, handleStepForward, handleJumpToStart, handleJumpToEnd]);

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 p-2 bg-white/90 backdrop-blur rounded-lg shadow-md', className)}>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleStepBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePlay}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleStepForward}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-[100px]">
          <Slider
            value={[currentYear]}
            min={minYear}
            max={maxYear}
            step={1}
            onValueChange={handleSliderChange}
          />
        </div>
        <span className="text-xs font-mono w-20 text-center">{formatYear(currentYear)}</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn('flex flex-col gap-3 p-4 bg-white rounded-lg shadow-md border', className)}>
        {/* Year display */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">{formatYear(minYear)}</span>
          <span className="text-xl font-bold text-blue-600">{formatYear(currentYear)}</span>
          <span className="text-sm text-gray-500">{formatYear(maxYear)}</span>
        </div>

        {/* Slider */}
        <div className="px-2">
          <Slider
            value={[currentYear]}
            min={minYear}
            max={maxYear}
            step={1}
            onValueChange={handleSliderChange}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-4">
          {/* Playback controls */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleJumpToStart}>
                  <SkipBack className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Jump to start (Home)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleStepBack}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Step back (←)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={playing ? 'default' : 'outline'}
                  size="icon"
                  className="h-10 w-10"
                  onClick={togglePlay}
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Play/Pause (Space)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleStepForward}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Step forward (→)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleJumpToEnd}>
                  <SkipForward className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Jump to end (End)</TooltipContent>
            </Tooltip>
          </div>

          {/* Settings */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Speed:</span>
              <Select value={speed.toString()} onValueChange={(v) => setSpeed(Number(v))}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAYBACK_SPEEDS.map((s) => (
                    <SelectItem key={s} value={s.toString()}>
                      {s}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Step:</span>
              <Select value={step.toString()} onValueChange={(v) => setStep(Number(v))}>
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_SIZES.map((s) => (
                    <SelectItem key={s} value={s.toString()}>
                      {s} years
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Keyboard hint */}
        <div className="text-xs text-gray-400 text-center">
          Use ← → to step, Space to play/pause, Home/End to jump
        </div>
      </div>
    </TooltipProvider>
  );
}

export default TimeNavigator;
