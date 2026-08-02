import { useState, useCallback, useMemo, useRef } from 'react';
import { useMapEvents } from 'react-leaflet';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { BoundingBox } from '../../../lib/visualization/geospatial-types';
import {
  cullToViewport,
  simplifyFeature,
  TileCache,
  shouldUseWebGL,
  WEBGL_FEATURE_THRESHOLD,
} from '../../../lib/visualization/map-performance';

export interface MapPerformanceState {
  viewport: BoundingBox | null;
  zoom: number;
}

/**
 * Hook that tracks the current map viewport and provides performance
 * utilities: viewport culling, level-of-detail simplification, and a
 * tile-based computation cache.
 *
 * Must be rendered as a child of <MapContainer>.
 */
export function useMapPerformance() {
  const [viewport, setViewport] = useState<BoundingBox | null>(null);
  const [zoom, setZoom] = useState<number>(2);
  const cacheRef = useRef(new TileCache<Feature[]>(128, 30_000));

  const updateBounds = useCallback(() => {
    // This is intentionally a no-op stub — the actual map event listener
    // calls setBoundsFromMap which reads the map instance directly.
  }, []);

  return {
    viewport,
    zoom,
    setViewport,
    setZoom,
    cache: cacheRef.current,

    /**
     * Filter features to the current viewport.
     */
    cullFeatures: useCallback(
      <T extends Feature>(features: T[]): T[] => {
        if (!viewport) return features;
        return cullToViewport(features, viewport);
      },
      [viewport]
    ),

    /**
     * Apply LOD simplification to polygon features based on current zoom.
     */
    simplifyPolygons: useCallback(
      <T extends Feature<Polygon | MultiPolygon>>(features: T[]): T[] => {
        return features.map((f) => simplifyFeature(f, zoom));
      },
      [zoom]
    ),

    /**
     * Check if a layer should recommend WebGL rendering.
     */
    shouldUseWebGL: useCallback(
      (featureCount: number) => shouldUseWebGL(featureCount),
      []
    ),

    WEBGL_FEATURE_THRESHOLD,
  };
}

/**
 * Component (rendered inside MapContainer) that syncs Leaflet map events
 * to the useMapPerformance state setters.
 */
export function MapPerformanceTracker({
  onViewportChange,
  onZoomChange,
}: {
  onViewportChange: (vp: BoundingBox) => void;
  onZoomChange: (z: number) => void;
}) {
  const updateFromMap = useCallback(
    (map: L.Map) => {
      const bounds = map.getBounds();
      onViewportChange({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
      onZoomChange(map.getZoom());
    },
    [onViewportChange, onZoomChange]
  );

  useMapEvents({
    moveend: (e) => updateFromMap(e.target),
    zoomend: (e) => updateFromMap(e.target),
    load: (e) => updateFromMap(e.target),
  });

  return null;
}
