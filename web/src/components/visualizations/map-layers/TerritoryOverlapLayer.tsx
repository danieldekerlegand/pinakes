import React, { useMemo } from 'react';
import { GeoJSON, Pane } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { BlendMode } from '../../../lib/visualization/geospatial-types';
import {
  detectOverlaps,
  blendMultipleColors,
  hatchPatternId,
  type TerritoryFeature,
  type OverlapRegion,
} from '../../../lib/visualization/territory-overlap';

interface TerritoryOverlapLayerProps {
  /** All polygon territories from active layers, with their colors. */
  territories: TerritoryFeature[];
  /** Active blend mode. */
  blendMode: BlendMode;
  /** Global opacity multiplier (0-1). */
  opacity?: number;
}

export function TerritoryOverlapLayer({
  territories,
  blendMode,
  opacity = 0.5,
}: TerritoryOverlapLayerProps) {
  const overlaps = useMemo(
    () => detectOverlaps(territories),
    [territories],
  );

  const geoJsonData = useMemo(() => {
    if (overlaps.length === 0) return null;

    return {
      type: 'FeatureCollection' as const,
      features: overlaps.map((o) => ({
        type: 'Feature' as const,
        id: o.id,
        geometry: o.geometry,
        properties: {
          overlapId: o.id,
          sourceIds: o.sourceIds,
          sourceLayerIds: o.sourceLayerIds,
          colors: o.colors,
          overlapCount: o.overlapCount,
        },
      })),
    };
  }, [overlaps]);

  const style = useMemo(() => {
    return (feature: any): PathOptions => {
      const props = feature.properties;
      const colors: string[] = props.colors;

      const fillColor = blendMultipleColors(colors, blendMode);

      return {
        fillColor,
        fillOpacity: opacity * 0.6,
        color: fillColor,
        weight: 1,
        opacity: 0.4,
        dashArray: blendMode === 'normal' ? '4, 4' : undefined,
      };
    };
  }, [blendMode, opacity]);

  const onEachFeature = useMemo(() => {
    return (feature: any, layer: any) => {
      const props = feature.properties;
      layer.bindPopup(() => {
        const container = document.createElement('div');
        container.className = 'p-2 min-w-[180px]';
        container.innerHTML = `
          <div>
            <h3 class="font-bold text-sm mb-1">Territory Overlap</h3>
            <div class="text-xs text-gray-600">
              <p>${props.overlapCount} overlapping territories</p>
              <p class="mt-1">Layers: ${props.sourceLayerIds.join(', ')}</p>
              <p class="mt-1">Blend: ${blendMode}</p>
            </div>
          </div>
        `;
        return container;
      });
    };
  }, [blendMode]);

  if (!geoJsonData || overlaps.length === 0) {
    return null;
  }

  // Use CSS mix-blend-mode on the pane for GPU-accelerated blending
  const paneStyle: Record<string, string> = {};
  if (blendMode !== 'normal') {
    paneStyle.mixBlendMode = blendMode;
  }

  return (
    <Pane name="territory-overlaps" style={paneStyle}>
      <GeoJSON
        key={`overlaps-${blendMode}-${overlaps.length}`}
        data={geoJsonData}
        style={style}
        onEachFeature={onEachFeature}
      />
    </Pane>
  );
}
