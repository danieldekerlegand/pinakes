import React, { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { CivilizationFeature } from '../../../lib/visualization/geospatial-types';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

interface CivilizationLayerProps {
  features: CivilizationFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
}

export function CivilizationLayer({
  features,
  opacity = 0.5,
  onFeatureClick,
  selectedFeatureId,
}: CivilizationLayerProps) {
  // Civilization colors (different from language family colors)
  const getCivilizationColor = (civilizationId: string): string => {
    const colors = [
      '#c084fc', // purple-400
      '#f472b6', // pink-400
      '#fb923c', // orange-400
      '#34d399', // emerald-400
      '#60a5fa', // blue-400
      '#a78bfa', // violet-400
    ];

    // Simple hash to get consistent color per civilization
    let hash = 0;
    for (let i = 0; i < civilizationId.length; i++) {
      hash = civilizationId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Style function for each feature
  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === feature.id;
    const civColor = getCivilizationColor(props.civilizationId);

    return {
      fillColor: isSelected ? '#3b82f6' : civColor,
      fillOpacity: isSelected ? 0.3 : opacity * 0.4,
      color: isSelected ? '#1d4ed8' : civColor,
      weight: isSelected ? 3 : 2,
      opacity: isSelected ? 1 : 0.7,
      dashArray: '5, 5', // Dashed border to distinguish from language ranges
    };
  };

  // Event handlers for each feature
  const onEachFeature = (feature: any, layer: any) => {
    const props = feature.properties;

    // Add popup
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

            ${props.population ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Peak Population:</span>
                <span class="font-medium">${props.population.toLocaleString()}</span>
              </div>
            ` : ''}

            ${props.writingSystems && props.writingSystems.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs font-medium">Writing Systems:</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  ${props.writingSystems.slice(0, 3).map((ws: string) =>
                    `<span class="inline-block px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded">${ws}</span>`
                  ).join('')}
                  ${props.writingSystems.length > 3 ?
                    `<span class="text-xs text-gray-500">+${props.writingSystems.length - 3}</span>` : ''}
                </div>
              </div>
            ` : ''}

            ${props.associatedLanguageIds && props.associatedLanguageIds.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs">
                  ${props.associatedLanguageIds.length} associated language(s)
                </span>
              </div>
            ` : ''}

            ${props.sources && props.sources.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs">
                  ${props.sources.length} source(s)
                </span>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      return container;
    });

    // Click handler
    layer.on('click', () => {
      if (onFeatureClick) {
        onFeatureClick(props.civilizationId);
      }
    });

    // Hover effects
    layer.on('mouseover', function() {
      if (feature.id !== selectedFeatureId) {
        this.setStyle({
          fillOpacity: opacity * 0.6,
          weight: 3,
        });
      }
    });

    layer.on('mouseout', function() {
      if (feature.id !== selectedFeatureId) {
        this.setStyle({
          fillOpacity: opacity * 0.4,
          weight: 2,
        });
      }
    });
  };

  // Convert features to GeoJSON FeatureCollection
  const geoJsonData = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: features,
  }), [features]);

  if (features.length === 0) {
    return null;
  }

  return (
    <GeoJSON
      key={JSON.stringify(features.map(f => f.id))}
      data={geoJsonData}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}
