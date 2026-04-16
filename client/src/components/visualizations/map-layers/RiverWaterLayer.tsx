import { useMemo } from 'react';
import { Polyline, Polygon, Popup, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { RiverWaterFeature, WaterType } from '../../../lib/visualization/geospatial-types';
import { WATER_TYPE_COLORS, WATER_IMPORTANCE_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

// Re-export for use in EnhancedLanguageMapView
export type { RiverWaterFeature } from '../../../lib/visualization/geospatial-types';

interface RiverWaterLayerProps {
  features: RiverWaterFeature[];
  currentYear: number;
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
}

export function getWaterColor(waterType: string): string {
  return WATER_TYPE_COLORS[waterType] ?? WATER_TYPE_COLORS.river;
}

export function getLineWeight(waterType: string, lengthKm: number | null): number {
  // Base weight by type
  const baseWeight: Record<string, number> = {
    river: 2,
    lake: 2,
    sea: 3,
    strait: 2,
    canal: 1.5,
  };
  let weight = baseWeight[waterType] ?? 2;

  // Scale rivers by length
  if (waterType === 'river' && lengthKm !== null && lengthKm > 0) {
    if (lengthKm >= 5000) weight = 4;
    else if (lengthKm >= 2000) weight = 3;
    else if (lengthKm >= 500) weight = 2.5;
  }

  return weight;
}

export function isVisibleAtYear(feature: RiverWaterFeature, currentYear: number): boolean {
  if (feature.timeStart !== null && feature.timeStart > currentYear) return false;
  if (feature.timeEnd !== null && feature.timeEnd < currentYear) return false;
  return true;
}

export function formatWaterType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function isClosedShape(waterType: string): boolean {
  return waterType === 'lake';
}

export function RiverWaterLayer({
  features,
  currentYear,
  opacity = 0.8,
  onFeatureClick,
  selectedFeatureId,
}: RiverWaterLayerProps) {
  const visibleFeatures = useMemo(() => {
    return features.filter((f) => isVisibleAtYear(f, currentYear));
  }, [features, currentYear]);

  if (visibleFeatures.length === 0) return null;

  return (
    <>
      {visibleFeatures.map((feature) => {
        const isSelected = selectedFeatureId === feature.id;
        const color = getWaterColor(feature.waterType);
        const weight = getLineWeight(feature.waterType, feature.lengthKm);
        const positions: LatLngExpression[] = feature.coordinates.map(
          ([lng, lat]) => [lat, lng] as LatLngExpression
        );

        const importanceColor = feature.historicalImportance
          ? WATER_IMPORTANCE_COLORS[feature.historicalImportance]
          : undefined;

        const popupContent = (
          <div className="max-w-xs">
            <h3 className="font-bold text-sm mb-1">{feature.name}</h3>
            {feature.alternateNames.length > 0 && (
              <p className="text-xs text-gray-500 mb-1">
                aka {feature.alternateNames.join(', ')}
              </p>
            )}
            <p className="text-xs mb-1">
              <span className="font-semibold">Type:</span> {formatWaterType(feature.waterType)}
            </p>
            {feature.lengthKm && feature.lengthKm > 0 && (
              <p className="text-xs mb-1">
                <span className="font-semibold">Length:</span> {feature.lengthKm.toLocaleString()} km
              </p>
            )}
            <p className="text-xs mb-1">
              <span className="font-semibold">Region:</span> {feature.region}
            </p>
            {feature.historicalImportance && (
              <p className="text-xs mb-1">
                <span className="font-semibold">Significance:</span>{' '}
                {feature.historicalImportance.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </p>
            )}
            {feature.description && (
              <p className="text-xs text-gray-600 mt-1">{feature.description}</p>
            )}
            {feature.modernName && feature.modernName !== feature.name && (
              <p className="text-xs mt-1">
                <span className="font-semibold">Modern name:</span> {feature.modernName}
              </p>
            )}
          </div>
        );

        if (isClosedShape(feature.waterType) && positions.length >= 3) {
          return (
            <Polygon
              key={feature.id}
              positions={positions}
              pathOptions={{
                color: isSelected ? INTERACTION_COLORS.selectedBorder : color,
                fillColor: color,
                fillOpacity: isSelected ? 0.4 : opacity * 0.25,
                weight: isSelected ? weight + 1 : weight,
                opacity: isSelected ? 1 : opacity,
              }}
              eventHandlers={{
                click: () => onFeatureClick?.(feature.id),
              }}
            >
              <Tooltip sticky>{feature.name}</Tooltip>
              <Popup>{popupContent}</Popup>
            </Polygon>
          );
        }

        return (
          <Polyline
            key={feature.id}
            positions={positions}
            pathOptions={{
              color: isSelected ? INTERACTION_COLORS.selectedBorder : color,
              weight: isSelected ? weight + 2 : weight,
              opacity: isSelected ? 1 : opacity,
              dashArray: feature.waterType === 'canal' ? '8, 4' : undefined,
            }}
            eventHandlers={{
              click: () => onFeatureClick?.(feature.id),
            }}
          >
            <Tooltip sticky>{feature.name}</Tooltip>
            <Popup>{popupContent}</Popup>
          </Polyline>
        );
      })}
    </>
  );
}
