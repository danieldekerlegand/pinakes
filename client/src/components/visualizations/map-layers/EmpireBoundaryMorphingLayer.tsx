import React, { useMemo } from 'react';
import { GeoJSON, CircleMarker, Tooltip, Popup } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { Feature, Polygon, FeatureCollection } from 'geojson';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { MorphedBoundary, EmpireSettlementOverlay, EmpireLabelInfo } from '../../../lib/visualization/temporal-boundary-morphing';
import {
  computeSettlementOverlays,
  computeEmpireLabels,
} from '../../../lib/visualization/temporal-boundary-morphing';
import { CIVILIZATION_PALETTE, INTERACTION_COLORS, hexToRgba } from '../../../lib/visualization/color-theme';

export interface Settlement {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  type: string;
}

interface EmpireBoundaryMorphingLayerProps {
  morphedBoundaries: MorphedBoundary[];
  settlements: Settlement[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  showTransitionEffect?: boolean;
  showSettlements?: boolean;
  showLabels?: boolean;
}

function getEmpireColor(empireId: string): string {
  let hash = 0;
  for (let i = 0; i < empireId.length; i++) {
    hash = empireId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CIVILIZATION_PALETTE[Math.abs(hash) % CIVILIZATION_PALETTE.length];
}

export function EmpireBoundaryMorphingLayer({
  morphedBoundaries,
  settlements,
  opacity = 0.5,
  onFeatureClick,
  selectedFeatureId,
  showTransitionEffect = true,
  showSettlements = true,
  showLabels = true,
}: EmpireBoundaryMorphingLayerProps) {
  // Convert morphed boundaries to GeoJSON
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

  // Compute settlement overlays
  const settlementOverlays = useMemo((): EmpireSettlementOverlay[] => {
    if (!showSettlements || settlements.length === 0 || morphedBoundaries.length === 0) return [];
    return computeSettlementOverlays(morphedBoundaries, settlements, getEmpireColor);
  }, [morphedBoundaries, settlements, showSettlements]);

  // Compute empire label positions
  const empireLabels = useMemo((): EmpireLabelInfo[] => {
    if (!showLabels || morphedBoundaries.length === 0) return [];
    return computeEmpireLabels(morphedBoundaries, getEmpireColor);
  }, [morphedBoundaries, showLabels]);

  const style = (feature: any): PathOptions => {
    const props = feature.properties;
    const isSelected = selectedFeatureId === props._civilizationId;
    const civColor = getEmpireColor(props._civilizationId);
    const morphProgress = props._morphProgress ?? 0;

    const transitionPulse = showTransitionEffect && morphProgress > 0 && morphProgress < 1
      ? 0.1 * Math.sin(morphProgress * Math.PI)
      : 0;

    return {
      fillColor: isSelected ? INTERACTION_COLORS.selected : civColor,
      fillOpacity: isSelected ? 0.3 : (opacity * 0.4 + transitionPulse),
      color: isSelected ? INTERACTION_COLORS.selectedBorder : civColor,
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

    layer.on('mouseover', function () {
      if (props._civilizationId !== selectedFeatureId) {
        this.setStyle({ fillOpacity: opacity * 0.6, weight: 3 });
      }
    });

    layer.on('mouseout', function () {
      if (props._civilizationId !== selectedFeatureId) {
        this.setStyle({ fillOpacity: opacity * 0.4, weight: 2 });
      }
    });
  };

  if (morphedBoundaries.length === 0) return null;

  return (
    <>
      {/* Empire boundary polygons */}
      <GeoJSON
        key={`empire-morphing-${morphedBoundaries.map(b => `${b.civilizationId}-${b.progress.toFixed(2)}`).join(',')}`}
        data={geoJsonData}
        style={style}
        onEachFeature={onEachFeature}
      />

      {/* Empire name labels at centroids */}
      {empireLabels.map((label) => (
        <CircleMarker
          key={`empire-label-${label.empireId}`}
          center={[label.centroid[1], label.centroid[0]]}
          radius={0}
          pathOptions={{ opacity: 0 }}
        >
          <Tooltip
            permanent
            direction="center"
            className="empire-label-tooltip"
          >
            <span
              style={{
                color: label.color,
                fontWeight: 'bold',
                fontSize: '13px',
                textShadow: '1px 1px 2px rgba(0,0,0,0.7), -1px -1px 2px rgba(0,0,0,0.7)',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {label.name}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Settlement markers with empire color overlay */}
      {settlementOverlays.map((overlay) => (
        <CircleMarker
          key={`empire-settlement-${overlay.settlementId}`}
          center={[overlay.position[1], overlay.position[0]]}
          radius={overlay.isCapital ? 8 : 5}
          pathOptions={{
            fillColor: overlay.empireColor,
            fillOpacity: 0.8,
            color: overlay.isCapital ? '#fbbf24' : overlay.empireColor,
            weight: overlay.isCapital ? 3 : 1.5,
            opacity: 1,
          }}
        >
          <Popup>
            <div className="p-1 min-w-[160px]">
              <h4 className="font-bold text-sm mb-1">
                {overlay.isCapital ? '\u2605 ' : ''}{overlay.name}
              </h4>
              <div className="text-xs text-gray-600 space-y-0.5">
                <div>Type: <span className="font-medium capitalize">{overlay.type}</span></div>
                {overlay.isCapital && (
                  <div className="text-amber-600 font-medium">Capital City</div>
                )}
              </div>
            </div>
          </Popup>
          {overlay.isCapital && (
            <Tooltip direction="top" offset={[0, -10]}>
              <span className="font-bold text-xs">{'\u2605'} {overlay.name}</span>
            </Tooltip>
          )}
        </CircleMarker>
      ))}
    </>
  );
}
