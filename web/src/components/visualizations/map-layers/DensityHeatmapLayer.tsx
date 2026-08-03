import { useEffect, useRef, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import type { HeatPoint, DensitySource } from '../../../lib/visualization/density-heatmap-utils';
import {
  DENSITY_GRADIENTS,
  featuresToHeatPoints,
  coordsToHeatPoints,
  mergeHeatPoints,
} from '../../../lib/visualization/density-heatmap-utils';

// Extend Leaflet types to include heatLayer
declare module 'leaflet' {
  function heatLayer(
    latlngs: Array<[number, number, number]>,
    options?: {
      radius?: number;
      blur?: number;
      maxZoom?: number;
      gradient?: Record<number, string>;
      minOpacity?: number;
      max?: number;
    },
  ): any;
}

export interface DensityDataSources {
  /** GeoJSON features (language ranges, civilizations, archaeological sites, etc.) */
  features?: Array<{ geometry: { type: string; coordinates: any }; properties: Record<string, any> }>;
  /** Coordinate-bearing objects (cuisines, music, religions, settlements, battles, etc.) */
  coordItems?: Array<Record<string, any>>;
  /** Field on coordItems to use for intensity weighting (e.g. 'population', 'importance') */
  intensityField?: string;
  /** Pre-computed heat points that bypass conversion */
  rawPoints?: HeatPoint[];
}

export interface DensityHeatmapLayerProps {
  /** The data sources to aggregate into a density heatmap */
  sources: DensityDataSources;
  /** Which active density sources to label in the legend (informational only) */
  activeSources?: DensitySource[];
  /** Heatmap point radius in pixels */
  radius?: number;
  /** Gaussian blur radius in pixels */
  blur?: number;
  /** Zoom level at which points reach full intensity */
  maxZoom?: number;
  /** Gradient preset name or custom gradient stops */
  gradient?: string | Record<number, string>;
  /** Layer opacity (0-1) */
  opacity?: number;
}

export function DensityHeatmapLayer({
  sources,
  radius = 20,
  blur = 15,
  maxZoom = 12,
  gradient = 'thermal',
  opacity = 0.6,
}: DensityHeatmapLayerProps) {
  const map = useMap();
  const heatLayerRef = useRef<any>(null);

  // Resolve gradient — accept preset name or raw stops
  const resolvedGradient = useMemo(() => {
    if (typeof gradient === 'string') {
      return DENSITY_GRADIENTS[gradient] ?? DENSITY_GRADIENTS.thermal;
    }
    return gradient;
  }, [gradient]);

  // Convert all sources into a flat HeatPoint[]
  const heatPoints = useMemo<HeatPoint[]>(() => {
    const arrays: HeatPoint[][] = [];

    if (sources.features && sources.features.length > 0) {
      arrays.push(featuresToHeatPoints(sources.features));
    }
    if (sources.coordItems && sources.coordItems.length > 0) {
      arrays.push(coordsToHeatPoints(sources.coordItems, sources.intensityField));
    }
    if (sources.rawPoints && sources.rawPoints.length > 0) {
      arrays.push(sources.rawPoints);
    }

    return mergeHeatPoints(...arrays);
  }, [sources.features, sources.coordItems, sources.intensityField, sources.rawPoints]);

  useEffect(() => {
    if (!map || heatPoints.length === 0) {
      // Clean up if no data
      if (heatLayerRef.current) {
        map?.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      return;
    }

    // Remove existing layer before rebuilding
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
    }

    const heatData: Array<[number, number, number]> = heatPoints.map((p) => [
      p.lat,
      p.lng,
      p.intensity,
    ]);

    const layer = (L as any).heatLayer(heatData, {
      radius,
      blur,
      maxZoom,
      gradient: resolvedGradient,
      minOpacity: opacity * 0.3,
      max: 1.0,
    });

    layer.addTo(map);
    heatLayerRef.current = layer;

    return () => {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map, heatPoints, radius, blur, maxZoom, resolvedGradient, opacity]);

  return null;
}
