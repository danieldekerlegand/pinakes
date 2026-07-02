import { useState, useEffect, useCallback, useRef } from 'react';
import type { Feature, Polygon, MultiPolygon, GeoJsonProperties } from 'geojson';

interface ResolvedBoundary {
  id: string;
  name: string;
  source: string;
  geometry: Polygon | MultiPolygon;
}

interface UseBoundaryResolverOptions {
  /** Whether to enable boundary resolution (default: true) */
  enabled?: boolean;
  /** Property key used to look up region names (default: 'name') */
  regionNameKey?: string;
}

interface UseBoundaryResolverResult<P extends GeoJsonProperties> {
  /** Features with resolved precise boundaries where available */
  resolvedFeatures: Feature<Polygon | MultiPolygon, P>[];
  /** Whether boundary resolution is in progress */
  isResolving: boolean;
  /** Number of features that were enhanced with precise boundaries */
  resolvedCount: number;
}

// Client-side cache for resolved boundaries
const boundaryCache = new Map<string, ResolvedBoundary | null>();

async function resolveBoundary(name: string): Promise<ResolvedBoundary | null> {
  if (boundaryCache.has(name)) {
    return boundaryCache.get(name) ?? null;
  }

  try {
    const response = await fetch(`/api/map/boundaries/resolve?name=${encodeURIComponent(name)}`);
    if (!response.ok) {
      boundaryCache.set(name, null);
      return null;
    }
    const data: ResolvedBoundary = await response.json();
    boundaryCache.set(name, data);
    return data;
  } catch {
    boundaryCache.set(name, null);
    return null;
  }
}

/**
 * Hook that resolves feature geometries to precise GeoJSON boundaries.
 * Features with matching region names get their geometry replaced with
 * high-fidelity boundaries from the server's boundary resolver.
 * Falls back to original geometry when no precise boundary is available.
 */
export function useBoundaryResolver<P extends GeoJsonProperties>(
  features: Feature<Polygon | MultiPolygon, P>[],
  options: UseBoundaryResolverOptions = {}
): UseBoundaryResolverResult<P> {
  const { enabled = true, regionNameKey = 'name' } = options;
  const [resolvedFeatures, setResolvedFeatures] = useState<Feature<Polygon | MultiPolygon, P>[]>(features);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedCount, setResolvedCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || features.length === 0) {
      setResolvedFeatures(features);
      setResolvedCount(0);
      return;
    }

    // Abort previous resolution
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    async function resolveAll() {
      setIsResolving(true);

      const results: Feature<Polygon | MultiPolygon, P>[] = [];
      let count = 0;

      // Resolve boundaries in parallel
      const promises = features.map(async (feature) => {
        const regionName = feature.properties?.[regionNameKey] as string | undefined;
        if (!regionName) return feature;

        const boundary = await resolveBoundary(regionName);
        if (boundary && !cancelled) {
          count++;
          return {
            ...feature,
            geometry: boundary.geometry,
            properties: {
              ...feature.properties,
              _boundarySource: boundary.source,
              _boundaryResolved: true,
            } as P,
          };
        }
        return feature;
      });

      const resolved = await Promise.all(promises);

      if (!cancelled) {
        setResolvedFeatures(resolved);
        setResolvedCount(count);
        setIsResolving(false);
      }
    }

    resolveAll();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [features, enabled, regionNameKey]);

  return { resolvedFeatures, isResolving, resolvedCount };
}

/**
 * Clear the client-side boundary cache.
 */
export function clearBoundaryCache(): void {
  boundaryCache.clear();
}
