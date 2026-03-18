import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { CivilizationFeature } from '../lib/visualization/geospatial-types';
import type { HistoricalRouteFeature } from '../lib/visualization/geospatial-types';
import {
  groupSnapshotsByCivilization,
  generateMorphedBoundaries,
  generateMigrationParticles,
  type MorphedBoundary,
  type MigrationParticle,
  type TemporalSnapshot,
} from '../lib/visualization/temporal-boundary-morphing';

export interface UseTemporalMorphingOptions {
  /** All civilization boundary features (across all time periods) */
  allFeatures: CivilizationFeature[];
  /** Migration route features */
  migrationRoutes?: HistoricalRouteFeature[];
  /** Current year from the time slider */
  currentYear: number;
  /** Whether morphing animation is enabled */
  enabled?: boolean;
  /** Number of particles per migration route */
  particlesPerRoute?: number;
}

export interface UseTemporalMorphingResult {
  /** Morphed boundaries for the current year */
  morphedBoundaries: MorphedBoundary[];
  /** Migration particles for animation */
  migrationParticles: Map<string, MigrationParticle[]>;
  /** Whether morphing is currently animating between snapshots */
  isTransitioning: boolean;
  /** Snapshot groups for debugging/display */
  snapshotGroups: Map<string, TemporalSnapshot[]>;
}

export function useTemporalMorphing({
  allFeatures,
  migrationRoutes = [],
  currentYear,
  enabled = true,
  particlesPerRoute = 5,
}: UseTemporalMorphingOptions): UseTemporalMorphingResult {
  const [animationTime, setAnimationTime] = useState(0);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Group snapshots by civilization (memoized)
  const snapshotGroups = useMemo(
    () => groupSnapshotsByCivilization(allFeatures),
    [allFeatures]
  );

  // Generate morphed boundaries
  const morphedBoundaries = useMemo(() => {
    if (!enabled) return [];
    return generateMorphedBoundaries(snapshotGroups, currentYear);
  }, [snapshotGroups, currentYear, enabled]);

  // Check if any boundary is mid-transition
  const isTransitioning = useMemo(
    () => morphedBoundaries.some(b => b.progress > 0 && b.progress < 1),
    [morphedBoundaries]
  );

  // Filter migration routes active at current year
  const activeRoutes = useMemo(() => {
    return migrationRoutes.filter(route => {
      const start = route.properties.timePeriod.start;
      const end = route.properties.timePeriod.end ?? Infinity;
      return currentYear >= start && currentYear <= end;
    });
  }, [migrationRoutes, currentYear]);

  // Animate migration particles
  useEffect(() => {
    if (!enabled || activeRoutes.length === 0) {
      setAnimationTime(0);
      return;
    }

    const animate = (timestamp: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }
      const delta = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      setAnimationTime(prev => (prev + delta * 0.15) % 1);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      lastTimeRef.current = 0;
    };
  }, [enabled, activeRoutes.length]);

  // Generate particles for active routes
  const migrationParticles = useMemo(() => {
    const particles = new Map<string, MigrationParticle[]>();
    if (!enabled) return particles;

    const routeColors: Record<string, string> = {
      trade: '#22c55e',
      migration: '#3b82f6',
      conquest: '#ef4444',
      pilgrimage: '#a855f7',
      communication: '#06b6d4',
      unknown: '#9ca3af',
    };

    for (const route of activeRoutes) {
      const color = routeColors[route.properties.routeType] || routeColors.unknown;
      const routeParticles = generateMigrationParticles(
        route.geometry.coordinates,
        particlesPerRoute,
        animationTime,
        color
      );
      particles.set(route.properties.routeId, routeParticles);
    }

    return particles;
  }, [activeRoutes, animationTime, particlesPerRoute, enabled]);

  return {
    morphedBoundaries,
    migrationParticles,
    isTransitioning,
    snapshotGroups,
  };
}
