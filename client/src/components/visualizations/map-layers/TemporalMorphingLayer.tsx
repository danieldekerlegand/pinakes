import React, { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { Feature, Polygon, FeatureCollection } from 'geojson';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { MorphedBoundary } from '../../../lib/visualization/temporal-boundary-morphing';

interface TemporalMorphingLayerProps {
  morphedBoundaries: MorphedBoundary[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  showTransitionEffect?: boolean;
}

export function TemporalMorphingLayer({
  morphedBoundaries,
  opacity = 0.5,
  onFeatureClick,
  selectedFeatureId,
  showTransitionEffect = true,
}: TemporalMorphingLayerProps) {
  const getCivilizationColor = (civilizationId: string): string => {
    const colors = [
      '#c084fc', '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#a78bfa',
    ];
    let hash = 0;
    for (let i = 0; i < civilizationId.length; i++) {
      hash = civilizationId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Convert morphed boundaries to GeoJSON features
  const geoJsonData = useMemo((): FeatureCollection<Polygon> => {
    const features: Feature<Polygon>[] = morphedBoundaries.map((boundary) => ({
      type: 'Feature' as const,
      id: boundary.civilizationId,
      geometry: {
        type: 'Polygon' as const,
        coordinates: boundary.coordinates,
      },
      properties: {
        ...boundary.properties,
        _morphProgress: boundary.progress,
        _civilizationId: boundary.civilizationId,
      },
    }));

    return { type: 'FeatureCollection', features };
  }, [morphedBoundaries]);

  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === props._civilizationId;
    const civColor = getCivilizationColor(props._civilizationId);
    const morphProgress = props._morphProgress ?? 0;

    // Pulse effect during transition
    const transitionPulse = showTransitionEffect && morphProgress > 0 && morphProgress < 1
      ? 0.1 * Math.sin(morphProgress * Math.PI)
      : 0;

    return {
      fillColor: isSelected ? '#3b82f6' : civColor,
      fillOpacity: isSelected ? 0.3 : (opacity * 0.4 + transitionPulse),
      color: isSelected ? '#1d4ed8' : civColor,
      weight: isSelected ? 3 : 2,
      opacity: isSelected ? 1 : 0.7,
      dashArray: '5, 5',
    };
  };

  const onEachFeature = (feature: any, layer: any) => {
    const props = feature.properties;

    layer.bindPopup(() => {
      const container = document.createElement('div');
      container.className = 'p-2 min-w-[240px]';
      container.innerHTML = `
        <div>
          <h3 class="font-bold text-base mb-1">${props.name}</h3>
          ${props.nativeName ? `<p class="text-sm text-gray-600 mb-2">(${props.nativeName})</p>` : ''}
          <div class="space-y-1.5 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600">Time Period:</span>
              <span class="font-medium text-right">${formatTimePeriod(props.timePeriod.start, props.timePeriod.end)}</span>
            </div>
            ${props.politicalStructure ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Type:</span>
                <span class="font-medium capitalize">${props.politicalStructure}</span>
              </div>
            ` : ''}
            ${props.capital ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Capital:</span>
                <span class="font-medium">${props.capital}</span>
              </div>
            ` : ''}
            ${props._morphProgress !== undefined && props._morphProgress > 0 && props._morphProgress < 1 ? `
              <div class="pt-2 border-t">
                <div class="flex items-center gap-2">
                  <span class="text-gray-600 text-xs">Boundary transition:</span>
                  <div class="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div class="bg-blue-500 h-1.5 rounded-full transition-all" style="width: ${Math.round(props._morphProgress * 100)}%"></div>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
      return container;
    });

    layer.on('click', () => {
      if (onFeatureClick) {
        onFeatureClick(props._civilizationId);
      }
    });

    layer.on('mouseover', function() {
      if (props._civilizationId !== selectedFeatureId) {
        this.setStyle({ fillOpacity: opacity * 0.6, weight: 3 });
      }
    });

    layer.on('mouseout', function() {
      if (props._civilizationId !== selectedFeatureId) {
        this.setStyle({ fillOpacity: opacity * 0.4, weight: 2 });
      }
    });
  };

  if (morphedBoundaries.length === 0) return null;

  return (
    <GeoJSON
      key={`morphing-${morphedBoundaries.map(b => `${b.civilizationId}-${b.progress.toFixed(2)}`).join(',')}`}
      data={geoJsonData}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}
