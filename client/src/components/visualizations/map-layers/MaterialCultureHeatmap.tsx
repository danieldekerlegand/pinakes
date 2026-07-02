import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import type { MaterialCultureDistribution } from '../../../lib/visualization/geospatial-types';

interface MaterialCultureHeatmapProps {
  distributions: MaterialCultureDistribution[];
  radius?: number;
  blur?: number;
  maxZoom?: number;
  gradient?: Record<number, string>;
  opacity?: number;
}

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
    }
  ): any;
}

export function MaterialCultureHeatmap({
  distributions,
  radius = 25,
  blur = 15,
  maxZoom = 10,
  gradient = {
    0.0: 'blue',
    0.5: 'lime',
    1.0: 'red',
  },
  opacity = 0.6,
}: MaterialCultureHeatmapProps) {
  const map = useMap();
  const heatLayerRef = useRef<any>(null);

  useEffect(() => {
    if (!map || distributions.length === 0) return;

    // Remove existing heatmap layer if it exists
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
    }

    // Convert distributions to heatmap data format: [lat, lng, intensity]
    const heatData: Array<[number, number, number]> = distributions.map((dist) => [
      dist.lat,
      dist.lng,
      dist.intensity,
    ]);

    // Create heatmap layer
    const heatLayer = (L as any).heatLayer(heatData, {
      radius,
      blur,
      maxZoom,
      gradient,
      minOpacity: opacity * 0.5,
      max: 1.0,
    });

    // Add to map
    heatLayer.addTo(map);
    heatLayerRef.current = heatLayer;

    // Cleanup on unmount
    return () => {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map, distributions, radius, blur, maxZoom, gradient, opacity]);

  return null; // This component doesn't render anything directly
}
