import { useState, useCallback, useEffect, useRef } from 'react';

export type ComparisonMode = 'swipe' | 'blink';

/** Layer types available for per-side configuration in comparison mode */
export type ComparisonLayerType = 'civilizations' | 'language-ranges';

export const ALL_COMPARISON_LAYERS: ComparisonLayerType[] = ['civilizations', 'language-ranges'];

export const COMPARISON_LAYER_LABELS: Record<ComparisonLayerType, string> = {
  'civilizations': 'Civilizations',
  'language-ranges': 'Language Ranges',
};

export interface SplitScreenState {
  isActive: boolean;
  mode: ComparisonMode;
  leftYear: number;
  rightYear: number;
  dividerPosition: number; // 0-100 percentage
  blinkInterval: number; // milliseconds
  blinkShowingLeft: boolean;
  /** Layer types visible on the left side */
  leftLayers: Set<ComparisonLayerType>;
  /** Layer types visible on the right side */
  rightLayers: Set<ComparisonLayerType>;
}

const DEFAULT_SPLIT_STATE: SplitScreenState = {
  isActive: false,
  mode: 'swipe',
  leftYear: -500,
  rightYear: 2024,
  dividerPosition: 50,
  blinkInterval: 1500,
  blinkShowingLeft: true,
  leftLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
  rightLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
};

interface UseSplitScreenReturn {
  state: SplitScreenState;
  activate: (mode?: ComparisonMode) => void;
  deactivate: () => void;
  toggle: () => void;
  setMode: (mode: ComparisonMode) => void;
  setLeftYear: (year: number) => void;
  setRightYear: (year: number) => void;
  setDividerPosition: (position: number) => void;
  setBlinkInterval: (interval: number) => void;
  /** In blink mode, returns the year currently being displayed */
  activeYear: number;
  /** Swap left and right years */
  swapYears: () => void;
  /** Toggle a layer type on the left side */
  toggleLeftLayer: (layer: ComparisonLayerType) => void;
  /** Toggle a layer type on the right side */
  toggleRightLayer: (layer: ComparisonLayerType) => void;
}

export function useSplitScreen(
  currentYear: number = 2024,
  minYear: number = -3000,
  maxYear: number = 2024,
): UseSplitScreenReturn {
  const [state, setState] = useState<SplitScreenState>({
    ...DEFAULT_SPLIT_STATE,
    rightYear: currentYear,
    leftLayers: new Set(DEFAULT_SPLIT_STATE.leftLayers),
    rightLayers: new Set(DEFAULT_SPLIT_STATE.rightLayers),
  });

  const blinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Blink mode timer
  useEffect(() => {
    if (state.isActive && state.mode === 'blink') {
      blinkTimerRef.current = setInterval(() => {
        setState((prev) => ({
          ...prev,
          blinkShowingLeft: !prev.blinkShowingLeft,
        }));
      }, state.blinkInterval);
    }

    return () => {
      if (blinkTimerRef.current) {
        clearInterval(blinkTimerRef.current);
        blinkTimerRef.current = null;
      }
    };
  }, [state.isActive, state.mode, state.blinkInterval]);

  const activate = useCallback(
    (mode: ComparisonMode = 'swipe') => {
      setState((prev) => ({
        ...prev,
        isActive: true,
        mode,
        rightYear: prev.rightYear === currentYear ? currentYear : prev.rightYear,
        blinkShowingLeft: true,
      }));
    },
    [currentYear],
  );

  const deactivate = useCallback(() => {
    setState((prev) => ({ ...prev, isActive: false, blinkShowingLeft: true }));
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => {
      if (prev.isActive) {
        return { ...prev, isActive: false, blinkShowingLeft: true };
      }
      return { ...prev, isActive: true, blinkShowingLeft: true };
    });
  }, []);

  const setMode = useCallback((mode: ComparisonMode) => {
    setState((prev) => ({ ...prev, mode, blinkShowingLeft: true }));
  }, []);

  const setLeftYear = useCallback(
    (year: number) => {
      const clamped = Math.max(minYear, Math.min(maxYear, year));
      setState((prev) => ({ ...prev, leftYear: clamped }));
    },
    [minYear, maxYear],
  );

  const setRightYear = useCallback(
    (year: number) => {
      const clamped = Math.max(minYear, Math.min(maxYear, year));
      setState((prev) => ({ ...prev, rightYear: clamped }));
    },
    [minYear, maxYear],
  );

  const setDividerPosition = useCallback((position: number) => {
    setState((prev) => ({
      ...prev,
      dividerPosition: Math.max(10, Math.min(90, position)),
    }));
  }, []);

  const setBlinkInterval = useCallback((interval: number) => {
    setState((prev) => ({
      ...prev,
      blinkInterval: Math.max(200, Math.min(5000, interval)),
    }));
  }, []);

  const swapYears = useCallback(() => {
    setState((prev) => ({
      ...prev,
      leftYear: prev.rightYear,
      rightYear: prev.leftYear,
    }));
  }, []);

  const toggleLeftLayer = useCallback((layer: ComparisonLayerType) => {
    setState((prev) => {
      const next = new Set(prev.leftLayers);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return { ...prev, leftLayers: next };
    });
  }, []);

  const toggleRightLayer = useCallback((layer: ComparisonLayerType) => {
    setState((prev) => {
      const next = new Set(prev.rightLayers);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return { ...prev, rightLayers: next };
    });
  }, []);

  const activeYear =
    state.isActive && state.mode === 'blink'
      ? state.blinkShowingLeft
        ? state.leftYear
        : state.rightYear
      : currentYear;

  return {
    state,
    activate,
    deactivate,
    toggle,
    setMode,
    setLeftYear,
    setRightYear,
    setDividerPosition,
    setBlinkInterval,
    activeYear,
    swapYears,
    toggleLeftLayer,
    toggleRightLayer,
  };
}

// Helper to format year for display
export function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}
