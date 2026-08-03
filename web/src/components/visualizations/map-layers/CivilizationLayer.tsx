import React, { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions, Path } from 'leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import { smoothFeature, generateGradientEdgeRings } from '../../../lib/visualization/spline-interpolation';
import type { CivilizationFeature } from '../../../lib/visualization/geospatial-types';
import { CIVILIZATION_PALETTE, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';
import { useBoundaryResolver } from '../hooks/useBoundaryResolver';
import {
  type TerritorialFillType,
  generateInwardGradientRings,
  territorialClassName,
} from '../../../lib/visualization/territorial-shading';

interface CivilizationLayerProps {
  features: CivilizationFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  smoothBoundaries?: boolean;
  showGradientEdges?: boolean;
  /** Use precise GeoJSON boundaries from boundary resolver when available */
  usePreciseBoundaries?: boolean;
  fillType?: TerritorialFillType;
}

export function CivilizationLayer({
  features,
  opacity = 0.5,
  onFeatureClick,
  selectedFeatureId,
  smoothBoundaries = true,
  showGradientEdges = true,
  usePreciseBoundaries = true,
  fillType = 'solid',
}: CivilizationLayerProps) {
  // Civilization colors (different from language family colors)
  const getCivilizationColor = (civilizationId: string): string => {
    let hash = 0;
    for (let i = 0; i < civilizationId.length; i++) {
      hash = civilizationId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CIVILIZATION_PALETTE[Math.abs(hash) % CIVILIZATION_PALETTE.length];
  };

  // Resolve precise GeoJSON boundaries where available
  const { resolvedFeatures } = useBoundaryResolver(features, {
    enabled: usePreciseBoundaries,
    regionNameKey: 'name',
  });

  // Apply spline smoothing only to features without precise boundaries
  const processedFeatures = useMemo(() => {
    return resolvedFeatures.map(feature => {
      // Skip smoothing for features with resolved precise boundaries
      if ((feature.properties as any)._boundaryResolved || !smoothBoundaries) {
        return feature;
      }
      return smoothFeature(feature, 6, 0.5);
    });
  }, [resolvedFeatures, smoothBoundaries]);

  // Generate gradient edge features for transition zones
  const gradientEdgeData = useMemo(() => {
    if (!showGradientEdges) return null;

    const edgeFeatures: Array<{
      type: 'Feature';
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
      properties: { civilizationId: string; opacityMultiplier: number };
    }> = [];

    for (const feature of processedFeatures) {
      // Skip gradient edges for precisely-resolved boundaries
      if ((feature.properties as any)._boundaryResolved) continue;

      const coords = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates[0]]
        : feature.geometry.type === 'MultiPolygon'
          ? feature.geometry.coordinates.map((p) => p[0])
          : [];

      for (const ring of coords) {
        const gradientRings = generateGradientEdgeRings(ring, 3, 0.3);
        for (const { ring: edgeRing, opacityMultiplier } of gradientRings) {
          edgeFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [edgeRing as [number, number][]] },
            properties: {
              civilizationId: feature.properties.civilizationId,
              opacityMultiplier,
            },
          });
        }
      }
    }

    return {
      type: 'FeatureCollection' as const,
      features: edgeFeatures,
    };
  }, [processedFeatures, showGradientEdges]);

  // Generate inward gradient rings for core-to-periphery fill
  const inwardGradientData = useMemo(() => {
    if (fillType !== 'gradient') return null;

    const gradientFeatures: Array<{
      type: 'Feature';
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
      properties: { civilizationId: string; opacityMultiplier: number };
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
              civilizationId: feature.properties.civilizationId,
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
    const civColor = getCivilizationColor(props.civilizationId);
    return {
      fillColor: civColor,
      fillOpacity: opacity * 0.5 * props.opacityMultiplier,
      color: civColor,
      weight: 0,
      opacity: 0,
    };
  };

  // Style function for each feature
  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === feature.id;
    const civColor = getCivilizationColor(props.civilizationId);
    const isPrecise = props._boundaryResolved;
    const className = territorialClassName(fillType, civColor);

    return {
      fillColor: isSelected ? INTERACTION_COLORS.selected : civColor,
      fillOpacity: isSelected ? 0.3 : fillType === 'gradient' ? opacity * 0.15 : opacity * 0.4,
      color: isSelected ? INTERACTION_COLORS.selectedBorder : civColor,
      weight: isSelected ? 3 : (isPrecise ? 2.5 : 2),
      opacity: isSelected ? 1 : 0.7,
      dashArray: isPrecise ? undefined : '5, 5',
      ...(className ? { className } : {}),
    };
  };

  // Style for gradient edge features
  const gradientEdgeStyle = (feature: any): PathOptions => {
    const props = feature.properties;
    const civColor = getCivilizationColor(props.civilizationId);

    return {
      fillColor: civColor,
      fillOpacity: opacity * 0.15 * props.opacityMultiplier,
      color: civColor,
      weight: 0.5,
      opacity: 0.2 * props.opacityMultiplier,
    };
  };

  // Event handlers for each feature
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

            ${props._boundarySource ? `
              <div class="pt-2 border-t">
                <span class="text-gray-600 text-xs">Boundary: ${props._boundarySource}</span>
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
    layer.on('mouseover', function (this: Path) {
      if (feature.id !== selectedFeatureId) {
        this.setStyle({
          fillOpacity: opacity * 0.6,
          weight: 3,
        });
      }
    });

    layer.on('mouseout', function (this: Path) {
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
    features: processedFeatures,
  }), [processedFeatures]);

  if (features.length === 0) {
    return null;
  }

  return (
    <>
      {/* Gradient edge layers (rendered behind main boundaries) */}
      {gradientEdgeData && gradientEdgeData.features.length > 0 && (
        <GeoJSON
          key={`gradient-${JSON.stringify(features.map(f => f.id))}`}
          data={gradientEdgeData as any}
          style={gradientEdgeStyle}
        />
      )}
      {/* Inward gradient rings for core-to-periphery fill */}
      {inwardGradientData && inwardGradientData.features.length > 0 && (
        <GeoJSON
          key={`inward-gradient-${JSON.stringify(features.map(f => f.id))}`}
          data={inwardGradientData as any}
          style={inwardGradientStyle}
        />
      )}
      {/* Main boundary layer - precise GeoJSON where available, smoothed fallback */}
      <GeoJSON
        key={JSON.stringify(features.map(f => f.id))}
        data={geoJsonData}
        style={style}
        onEachFeature={onEachFeature}
      />
    </>
  );
}
