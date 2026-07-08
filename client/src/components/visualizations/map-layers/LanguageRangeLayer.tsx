import React, { useMemo } from 'react';
import { GeoJSON, Popup } from 'react-leaflet';
import type { PathOptions, Path } from 'leaflet';
import { getFamilyColor } from '../../../lib/visualization/d3-helpers';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import { smoothFeature } from '../../../lib/visualization/spline-interpolation';
import type { LanguageRangeFeature } from '../../../lib/visualization/geospatial-types';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { INTERACTION_COLORS } from '../../../lib/visualization/color-theme';
import { useBoundaryResolver } from '../hooks/useBoundaryResolver';
import {
  type TerritorialFillType,
  generateInwardGradientRings,
  territorialClassName,
} from '../../../lib/visualization/territorial-shading';

interface LanguageRangeLayerProps {
  features: LanguageRangeFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  smoothBoundaries?: boolean;
  /** Use precise GeoJSON boundaries from boundary resolver when available */
  usePreciseBoundaries?: boolean;
  fillType?: TerritorialFillType;
}

export function LanguageRangeLayer({
  features,
  opacity = 0.6,
  onFeatureClick,
  selectedFeatureId,
  smoothBoundaries = true,
  usePreciseBoundaries = true,
  fillType = 'solid',
}: LanguageRangeLayerProps) {
  // Resolve precise GeoJSON boundaries where available
  const { resolvedFeatures } = useBoundaryResolver(features, {
    enabled: usePreciseBoundaries,
    regionNameKey: 'languageName',
  });

  // Apply spline smoothing only to features without precise boundaries
  const processedFeatures = useMemo(() => {
    return resolvedFeatures.map(feature => {
      if ((feature.properties as any)._boundaryResolved || !smoothBoundaries) {
        return feature;
      }
      return smoothFeature(feature, 6, 0.5);
    });
  }, [resolvedFeatures, smoothBoundaries]);

  // Generate inward gradient rings for core-to-periphery fill
  const inwardGradientData = useMemo(() => {
    if (fillType !== 'gradient') return null;

    const gradientFeatures: Array<{
      type: 'Feature';
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
      properties: { familyId: string; opacityMultiplier: number };
    }> = [];

    for (const feature of processedFeatures) {
      const coords =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates[0]]
          : feature.geometry.type === 'MultiPolygon'
            ? feature.geometry.coordinates.map((p) => p[0])
            : [];

      for (const ring of coords) {
        const inwardRings = generateInwardGradientRings(ring, 4);
        for (const { ring: innerRing, opacityMultiplier } of inwardRings) {
          gradientFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [innerRing as [number, number][]] },
            properties: {
              familyId: feature.properties.familyId,
              opacityMultiplier,
            },
          });
        }
      }
    }

    return { type: 'FeatureCollection' as const, features: gradientFeatures };
  }, [processedFeatures, fillType]);

  // Style for inward gradient rings
  const inwardGradientStyle = (feature: any): PathOptions => {
    const props = feature.properties;
    const familyColor = getFamilyColor(props.familyId);
    return {
      fillColor: familyColor,
      fillOpacity: opacity * 0.5 * props.opacityMultiplier,
      color: familyColor,
      weight: 0,
      opacity: 0,
    };
  };

  // Style function for each feature
  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === feature.id;
    const familyColor = getFamilyColor(props.familyId);
    const isPrecise = props._boundaryResolved;
    const className = territorialClassName(fillType, familyColor);

    return {
      fillColor: isSelected ? INTERACTION_COLORS.selected : familyColor,
      fillOpacity: isSelected ? 0.5 : fillType === 'gradient' ? opacity * 0.15 : opacity * 0.5,
      color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
      weight: isSelected ? 3 : (isPrecise ? 2.5 : 2),
      opacity: isSelected ? 1 : 0.8,
      ...(className ? { className } : {}),
    };
  };

  // Event handlers for each feature
  const onEachFeature = (feature: any, layer: any) => {
    const props = feature.properties;

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

            ${props._boundarySource ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs">Boundary: ${props._boundarySource}</span>
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
    layer.on('mouseover', function (this: Path) {
      if (feature.id !== selectedFeatureId) {
        this.setStyle({
          fillOpacity: opacity * 0.7,
          weight: 3,
        });
      }
    });

    layer.on('mouseout', function (this: Path) {
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
    features: processedFeatures,
  }), [processedFeatures]);

  if (features.length === 0) {
    return null;
  }

  return (
    <>
      {/* Inward gradient rings for core-to-periphery fill */}
      {inwardGradientData && inwardGradientData.features.length > 0 && (
        <GeoJSON
          key={`inward-gradient-${JSON.stringify(features.map(f => f.id))}`}
          data={inwardGradientData as any}
          style={inwardGradientStyle}
        />
      )}
      <GeoJSON
        key={JSON.stringify(features.map(f => f.id))}
        data={geoJsonData}
        style={style}
        onEachFeature={onEachFeature}
      />
    </>
  );
}
