import React, { useMemo } from 'react';
import { GeoJSON, Popup } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import { getFamilyColor } from '../../../lib/visualization/d3-helpers';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import { smoothFeatures } from '../../../lib/visualization/spline-interpolation';
import type { LanguageRangeFeature } from '../../../lib/visualization/geospatial-types';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

interface LanguageRangeLayerProps {
  features: LanguageRangeFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  smoothBoundaries?: boolean;
}

export function LanguageRangeLayer({
  features,
  opacity = 0.6,
  onFeatureClick,
  selectedFeatureId,
  smoothBoundaries = true,
}: LanguageRangeLayerProps) {
  // Apply spline smoothing to features
  const smoothedFeatures = useMemo(() => {
    if (!smoothBoundaries) return features;
    return smoothFeatures(features, 6, 0.5);
  }, [features, smoothBoundaries]);

  // Style function for each feature
  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === feature.id;
    const familyColor = getFamilyColor(props.familyId);

    return {
      fillColor: isSelected ? '#3b82f6' : familyColor,
      fillOpacity: isSelected ? 0.5 : opacity * 0.5,
      color: isSelected ? '#1d4ed8' : '#ffffff',
      weight: isSelected ? 3 : 2,
      opacity: isSelected ? 1 : 0.8,
    };
  };

  // Event handlers for each feature
  const onEachFeature = (feature: any, layer: any) => {
    const props = feature.properties;

    // Add popup
    layer.bindPopup(() => {
      const container = document.createElement('div');
      container.className = 'p-2 min-w-[220px]';

      container.innerHTML = `
        <div>
          <h3 class="font-bold text-base mb-1">${props.languageName}</h3>
          ${props.nativeName ? `<p class="text-sm text-gray-600 mb-2">(${props.nativeName})</p>` : ''}

          <div class="space-y-1.5 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600">Family:</span>
              <span class="font-medium">${props.familyName}</span>
            </div>

            <div class="flex justify-between">
              <span class="text-gray-600">Range Type:</span>
              <span class="font-medium capitalize">${props.rangeType}</span>
            </div>

            <div class="flex justify-between">
              <span class="text-gray-600">Time Period:</span>
              <span class="font-medium text-right">${formatTimePeriod(props.timePeriod.start, props.timePeriod.end)}</span>
            </div>

            ${props.totalSpeakers ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Speakers:</span>
                <span class="font-medium">${props.totalSpeakers.toLocaleString()}</span>
              </div>
            ` : ''}

            ${props.status ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Status:</span>
                <span class="font-medium">${props.status}</span>
              </div>
            ` : ''}

            ${props.confidence ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Confidence:</span>
                <span class="font-medium">${props.confidence}%</span>
              </div>
            ` : ''}

            ${props.iso639_1 || props.iso639_2 ? `
              <div class="flex justify-between">
                <span class="text-gray-600">ISO Code:</span>
                <span class="font-medium font-mono text-xs">${props.iso639_1 || props.iso639_2}</span>
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
        onFeatureClick(props.languageId);
      }
    });

    // Hover effects
    layer.on('mouseover', function() {
      if (feature.id !== selectedFeatureId) {
        this.setStyle({
          fillOpacity: opacity * 0.7,
          weight: 3,
        });
      }
    });

    layer.on('mouseout', function() {
      if (feature.id !== selectedFeatureId) {
        this.setStyle({
          fillOpacity: opacity * 0.5,
          weight: 2,
        });
      }
    });
  };

  // Convert features to GeoJSON FeatureCollection
  const geoJsonData = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: smoothedFeatures,
  }), [smoothedFeatures]);

  if (features.length === 0) {
    return null;
  }

  return (
    <GeoJSON
      key={JSON.stringify(features.map(f => f.id))} // Force re-render when features change
      data={geoJsonData}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}
