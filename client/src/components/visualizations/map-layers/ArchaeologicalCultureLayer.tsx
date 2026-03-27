import React, { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { ArchaeologicalCultureFeature } from '../../../lib/visualization/geospatial-types';
import { ARCHAEOLOGICAL_CULTURE_PALETTE, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';
import {
  type TerritorialFillType,
  generateInwardGradientRings,
  territorialClassName,
} from '../../../lib/visualization/territorial-shading';

interface ArchaeologicalCultureLayerProps {
  features: ArchaeologicalCultureFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  fillType?: TerritorialFillType;
}

const getCultureColor = (cultureId: string): string => {
  let hash = 0;
  for (let i = 0; i < cultureId.length; i++) {
    hash = cultureId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ARCHAEOLOGICAL_CULTURE_PALETTE[Math.abs(hash) % ARCHAEOLOGICAL_CULTURE_PALETTE.length];
};

export function ArchaeologicalCultureLayer({
  features,
  opacity = 0.5,
  onFeatureClick,
  selectedFeatureId,
  fillType = 'solid',
}: ArchaeologicalCultureLayerProps) {
  // Generate inward gradient rings for core-to-periphery fill
  const inwardGradientData = useMemo(() => {
    if (fillType !== 'gradient') return null;

    const gradientFeatures: Array<{
      type: 'Feature';
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
      properties: { cultureId: string; opacityMultiplier: number };
    }> = [];

    for (const feature of features) {
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
              cultureId: feature.properties.cultureId,
              opacityMultiplier,
            },
          });
        }
      }
    }

    return { type: 'FeatureCollection' as const, features: gradientFeatures };
  }, [features, fillType]);

  // Style for inward gradient rings
  const inwardGradientStyle = (feature: any): PathOptions => {
    const props = feature.properties;
    const cultureColor = getCultureColor(props.cultureId);
    return {
      fillColor: cultureColor,
      fillOpacity: opacity * 0.5 * props.opacityMultiplier,
      color: cultureColor,
      weight: 0,
      opacity: 0,
    };
  };

  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === feature.id;
    const color = getCultureColor(props.cultureId);
    const className = territorialClassName(fillType, color);

    return {
      fillColor: isSelected ? INTERACTION_COLORS.selected : color,
      fillOpacity: isSelected ? 0.35 : fillType === 'gradient' ? opacity * 0.15 : opacity * 0.4,
      color: isSelected ? INTERACTION_COLORS.selectedBorder : color,
      weight: isSelected ? 3 : 2,
      opacity: isSelected ? 1 : 0.7,
      dashArray: '8, 4',
      ...(className ? { className } : {}),
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
          <p class="text-xs text-gray-500 mb-2">${props.region}</p>

          <div class="space-y-1.5 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-600">Time Period:</span>
              <span class="font-medium text-right">${formatTimePeriod(props.timePeriod.start, props.timePeriod.end)}</span>
            </div>

            ${props.subsistencePattern && props.subsistencePattern !== 'unknown' ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Subsistence:</span>
                <span class="font-medium capitalize">${props.subsistencePattern}</span>
              </div>
            ` : ''}

            ${props.potteryStyle ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Pottery:</span>
                <span class="font-medium text-right max-w-[160px]">${props.potteryStyle}</span>
              </div>
            ` : ''}

            ${props.burialPractices ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Burials:</span>
                <span class="font-medium text-right max-w-[160px]">${props.burialPractices}</span>
              </div>
            ` : ''}

            ${props.probableLanguageFamily ? `
              <div class="flex justify-between">
                <span class="text-gray-600">Language:</span>
                <span class="font-medium">${props.probableLanguageFamily}</span>
              </div>
            ` : ''}

            <div class="flex justify-between">
              <span class="text-gray-600">Confidence:</span>
              <span class="font-medium">${props.confidence}%</span>
            </div>

            ${props.description ? `
              <div class="pt-2 border-t">
                <p class="text-xs text-gray-700">${props.description}</p>
              </div>
            ` : ''}

            ${props.probableHaplogroups && props.probableHaplogroups.length > 0 ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs font-medium">Haplogroups:</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  ${props.probableHaplogroups.map((h: string) =>
                    `<span class="inline-block px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800 rounded">${h}</span>`
                  ).join('')}
                </div>
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

    layer.on('click', () => {
      if (onFeatureClick) {
        onFeatureClick(props.cultureId);
      }
    });

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

  const geoJsonData = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: features,
  }), [features]);

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
