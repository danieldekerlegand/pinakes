import { useState, useCallback, useMemo } from 'react';
import {
  filterEntitiesByYear,
  filterEntitiesByTimeRange,
  type TemporalEntity,
} from '../lib/visualization/temporal-utils';

interface UseTemporalFilterOptions {
  /** Initial year (defaults to current year) */
  initialYear?: number;
  /** Minimum year for the time range */
  minYear?: number;
  /** Maximum year for the time range */
  maxYear?: number;
  /** Initial playback state */
  initialPlaying?: boolean;
  /** Initial playback speed (years per second) */
  initialSpeed?: number;
  /** Initial step size */
  initialStep?: number;
}

interface UseTemporalFilterReturn {
  /** Current selected year */
  currentYear: number;
  /** Set the current year */
  setCurrentYear: (year: number) => void;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Toggle playback */
  setIsPlaying: (playing: boolean) => void;
  /** Playback speed (years per second) */
  playbackSpeed: number;
  /** Set playback speed */
  setPlaybackSpeed: (speed: number) => void;
  /** Step size for navigation */
  stepSize: number;
  /** Set step size */
  setStepSize: (step: number) => void;
  /** Minimum year */
  minYear: number;
  /** Maximum year */
  maxYear: number;
  /** Filter entities by current year */
  filterByCurrentYear: <T extends TemporalEntity>(entities: T[]) => T[];
  /** Filter entities by time range */
  filterByRange: <T extends TemporalEntity>(entities: T[], startYear: number, endYear: number) => T[];
  /** Check if an entity is visible at current year */
  isVisibleAtCurrentYear: (entity: TemporalEntity) => boolean;
}

/**
 * Hook for managing temporal filtering state and operations
 */
export function useTemporalFilter(options: UseTemporalFilterOptions = {}): UseTemporalFilterReturn {
  const {
    initialYear = new Date().getFullYear(),
    minYear = -10000,
    maxYear = new Date().getFullYear(),
    initialPlaying = false,
    initialSpeed = 100,
    initialStep = 100,
  } = options;

  const [currentYear, setCurrentYear] = useState(initialYear);
  const [isPlaying, setIsPlaying] = useState(initialPlaying);
  const [playbackSpeed, setPlaybackSpeed] = useState(initialSpeed);
  const [stepSize, setStepSize] = useState(initialStep);

  const filterByCurrentYear = useCallback(
    <T extends TemporalEntity>(entities: T[]): T[] => {
      return filterEntitiesByYear(entities, currentYear);
    },
    [currentYear]
  );

  const filterByRange = useCallback(
    <T extends TemporalEntity>(entities: T[], startYear: number, endYear: number): T[] => {
      return filterEntitiesByTimeRange(entities, startYear, endYear);
    },
    []
  );

  const isVisibleAtCurrentYear = useCallback(
    (entity: TemporalEntity): boolean => {
      const filtered = filterEntitiesByYear([entity], currentYear);
      return filtered.length > 0;
    },
    [currentYear]
  );

  return useMemo(
    () => ({
      currentYear,
      setCurrentYear,
      isPlaying,
      setIsPlaying,
      playbackSpeed,
      setPlaybackSpeed,
      stepSize,
      setStepSize,
      minYear,
      maxYear,
      filterByCurrentYear,
      filterByRange,
      isVisibleAtCurrentYear,
    }),
    [
      currentYear,
      isPlaying,
      playbackSpeed,
      stepSize,
      minYear,
      maxYear,
      filterByCurrentYear,
      filterByRange,
      isVisibleAtCurrentYear,
    ]
  );
}

export default useTemporalFilter;
