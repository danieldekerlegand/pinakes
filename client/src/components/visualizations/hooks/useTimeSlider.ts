import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimeSliderState } from '../../../lib/visualization/geospatial-types';
import { DEFAULT_TIME_SLIDER_STATE } from '../../../lib/visualization/geospatial-types';
import { useVisualization } from '../../../contexts/VisualizationContext';

interface UseTimeSliderReturn {
  state: TimeSliderState;
  currentYear: number;
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setCurrentYear: (year: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setStepSize: (size: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  jumpToYear: (year: number) => void;
  jumpToStart: () => void;
  jumpToEnd: () => void;
  reset: () => void;
}

const FRAME_RATE = 30; // Target 30 FPS for smooth animation
const MS_PER_FRAME = 1000 / FRAME_RATE;

/**
 * Custom hook for managing time slider state with animation
 * Now syncs with VisualizationContext for cross-view temporal state
 */
export function useTimeSlider(
  initialState: Partial<TimeSliderState> = {},
  useGlobalState: boolean = true
): UseTimeSliderReturn {
  // Get global temporal state from VisualizationContext
  const vizContext = useVisualization();
  const { state: vizState, setCurrentYear: setGlobalYear, setIsPlaying: setGlobalPlaying } = vizContext;

  // Local state as fallback when not using global state
  const [localState, setLocalState] = useState<TimeSliderState>({
    ...DEFAULT_TIME_SLIDER_STATE,
    ...initialState,
  });

  // Use global state if available and enabled, otherwise use local state
  const state: TimeSliderState = useGlobalState && vizState?.temporal
    ? {
        currentYear: vizState.temporal.currentYear,
        minYear: vizState.temporal.minYear,
        maxYear: vizState.temporal.maxYear,
        isPlaying: vizState.temporal.isPlaying,
        playbackSpeed: vizState.temporal.playbackSpeed,
        stepSize: vizState.temporal.stepSize,
      }
    : localState;

  // Unified setState that updates both local and global state
  const setState = useCallback((updater: TimeSliderState | ((prev: TimeSliderState) => TimeSliderState)) => {
    const newState = typeof updater === 'function' ? updater(state) : updater;
    
    // Update local state
    setLocalState(newState);
    
    // Sync to global state if enabled
    if (useGlobalState && vizContext.updateTemporal) {
      vizContext.updateTemporal({
        currentYear: newState.currentYear,
        isPlaying: newState.isPlaying,
        playbackSpeed: newState.playbackSpeed,
        stepSize: newState.stepSize,
      });
    }
  }, [state, useGlobalState, vizContext]);

  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Animation loop
  const animate = useCallback((timestamp: number) => {
    if (!lastFrameTimeRef.current) {
      lastFrameTimeRef.current = timestamp;
    }

    const elapsed = timestamp - lastFrameTimeRef.current;

    // Only update if enough time has passed for target frame rate
    if (elapsed >= MS_PER_FRAME) {
      setState((prev) => {
        if (!prev.isPlaying) return prev;

        // Calculate years to advance based on playback speed and elapsed time
        const yearsPerSecond = prev.playbackSpeed;
        const yearsToAdvance = (yearsPerSecond * elapsed) / 1000;
        const newYear = Math.min(
          prev.maxYear,
          Math.round(prev.currentYear + yearsToAdvance)
        );

        // Stop playing if we've reached the end
        if (newYear >= prev.maxYear) {
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
          }
          return {
            ...prev,
            currentYear: prev.maxYear,
            isPlaying: false,
          };
        }

        return {
          ...prev,
          currentYear: newYear,
        };
      });

      lastFrameTimeRef.current = timestamp;
    }

    // Continue animation
    if (animationRef.current !== null) {
      animationRef.current = requestAnimationFrame(animate);
    }
  }, []);

  // Play animation
  const play = useCallback(() => {
    setState((prev) => {
      // If at the end, restart from beginning
      if (prev.currentYear >= prev.maxYear) {
        return {
          ...prev,
          currentYear: prev.minYear,
          isPlaying: true,
        };
      }

      return { ...prev, isPlaying: true };
    });

    lastFrameTimeRef.current = 0;
    if (animationRef.current === null) {
      animationRef.current = requestAnimationFrame(animate);
    }
  }, [animate]);

  // Pause animation
  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: false }));

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  // Toggle play/pause
  const toggle = useCallback(() => {
    setState((prev) => {
      if (prev.isPlaying) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        return { ...prev, isPlaying: false };
      } else {
        // If at the end, restart from beginning
        if (prev.currentYear >= prev.maxYear) {
          lastFrameTimeRef.current = 0;
          animationRef.current = requestAnimationFrame(animate);
          return {
            ...prev,
            currentYear: prev.minYear,
            isPlaying: true,
          };
        }

        lastFrameTimeRef.current = 0;
        animationRef.current = requestAnimationFrame(animate);
        return { ...prev, isPlaying: true };
      }
    });
  }, [animate]);

  // Set current year manually
  const setCurrentYear = useCallback((year: number) => {
    const clampedYear = Math.max(state.minYear, Math.min(state.maxYear, year));
    setState((prev) => ({
      ...prev,
      currentYear: clampedYear,
    }));
    // Also update global state directly for immediate sync
    if (useGlobalState && setGlobalYear) {
      setGlobalYear(clampedYear);
    }
  }, [state.minYear, state.maxYear, useGlobalState, setGlobalYear, setState]);

  // Set playback speed
  const setPlaybackSpeed = useCallback((speed: number) => {
    setState((prev) => ({
      ...prev,
      playbackSpeed: Math.max(1, speed), // Minimum 1 year/sec
    }));
  }, [setState]);

  // Set step size for manual stepping
  const setStepSize = useCallback((size: number) => {
    setState((prev) => ({
      ...prev,
      stepSize: Math.max(1, size), // Minimum 1 year steps
    }));
  }, [setState]);

  // Step forward by stepSize
  const stepForward = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentYear: Math.min(prev.maxYear, prev.currentYear + prev.stepSize),
    }));
  }, [setState]);

  // Step backward by stepSize
  const stepBackward = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentYear: Math.max(prev.minYear, prev.currentYear - prev.stepSize),
    }));
  }, [setState]);

  // Jump to specific year
  const jumpToYear = useCallback((year: number) => {
    pause();
    setState((prev) => ({
      ...prev,
      currentYear: Math.max(prev.minYear, Math.min(prev.maxYear, year)),
    }));
  }, [pause, setState]);

  // Jump to start
  const jumpToStart = useCallback(() => {
    pause();
    setState((prev) => ({ ...prev, currentYear: prev.minYear }));
  }, [pause, setState]);

  // Jump to end
  const jumpToEnd = useCallback(() => {
    pause();
    setState((prev) => ({ ...prev, currentYear: prev.maxYear }));
  }, [pause, setState]);

  // Reset to initial state
  const reset = useCallback(() => {
    pause();
    setState({
      ...DEFAULT_TIME_SLIDER_STATE,
      ...initialState,
    });
  }, [pause, initialState, setState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Restart animation when play state changes
  useEffect(() => {
    if (state.isPlaying && animationRef.current === null) {
      lastFrameTimeRef.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    }
  }, [state.isPlaying, animate]);

  return {
    state,
    currentYear: state.currentYear,
    isPlaying: state.isPlaying,
    play,
    pause,
    toggle,
    setCurrentYear,
    setPlaybackSpeed,
    setStepSize,
    stepForward,
    stepBackward,
    jumpToYear,
    jumpToStart,
    jumpToEnd,
    reset,
  };
}
