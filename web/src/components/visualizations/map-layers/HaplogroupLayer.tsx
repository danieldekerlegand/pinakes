import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { HAPLOGROUP_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface HaplogroupFeature {
  id: string;
  name: string;
  haplogroupType: string;
  geographicOrigin: string;
  timeOrigin: number | null;
  description: string;
  associatedLanguageFamilyIds: string[];
  associatedCivilizationIds: string[];
  coordinates: { lat: number; lng: number };
}

interface HaplogroupLayerProps {
  haplogroups: HaplogroupFeature[];
  opacity?: number;
  onHaplogroupClick?: (id: string) => void;
  selectedHaplogroupId?: string | null;
}

// Color by haplogroup type (Y-DNA vs mtDNA)
const getHaplogroupColor = (type: string): string => {
  return HAPLOGROUP_COLORS[type] || INTERACTION_COLORS.defaultFallback;
};

// Geographic region to approximate coordinates
const REGION_COORDS: Record<string, { lat: number; lng: number }> = {
  'Africa': { lat: 5, lng: 20 },
  'East Africa': { lat: 0, lng: 35 },
  'West Africa': { lat: 10, lng: -5 },
  'North Africa': { lat: 30, lng: 10 },
  'South Africa': { lat: -25, lng: 28 },
  'Central Africa': { lat: 0, lng: 20 },
  'Europe': { lat: 48, lng: 10 },
  'Western Europe': { lat: 46, lng: 2 },
  'Eastern Europe': { lat: 50, lng: 30 },
  'Northern Europe': { lat: 60, lng: 15 },
  'Southern Europe': { lat: 40, lng: 15 },
  'Central Europe': { lat: 48, lng: 15 },
  'Middle East': { lat: 32, lng: 44 },
  'Near East': { lat: 35, lng: 38 },
  'Central Asia': { lat: 42, lng: 65 },
  'South Asia': { lat: 22, lng: 78 },
  'East Asia': { lat: 35, lng: 105 },
  'Southeast Asia': { lat: 10, lng: 110 },
  'Northeast Asia': { lat: 55, lng: 130 },
  'Siberia': { lat: 60, lng: 100 },
  'Oceania': { lat: -10, lng: 150 },
  'Americas': { lat: 10, lng: -80 },
  'North America': { lat: 45, lng: -100 },
  'South America': { lat: -15, lng: -60 },
  'Arctic': { lat: 70, lng: -40 },
};

function getCoordinatesForRegion(region: string): { lat: number; lng: number } {
  // Try exact match first
  if (REGION_COORDS[region]) return REGION_COORDS[region];

  // Try partial match
  for (const [key, coords] of Object.entries(REGION_COORDS)) {
    if (region.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(region.toLowerCase())) {
      return coords;
    }
  }

  // Default to center of world
  return { lat: 20, lng: 0 };
}

const formatYear = (year: number | null): string => {
  if (year === null) return 'Unknown';
  if (year < 0) return `${Math.abs(year).toLocaleString()} BCE`;
  return `${year.toLocaleString()} CE`;
};

export function HaplogroupLayer({
  haplogroups,
  opacity = 0.7,
  onHaplogroupClick,
  selectedHaplogroupId,
}: HaplogroupLayerProps) {
  if (haplogroups.length === 0) {
    return null;
  }

  return (
    <>
      {haplogroups.map((haplo) => {
        const coords = haplo.coordinates.lat !== 0 || haplo.coordinates.lng !== 0
          ? haplo.coordinates
          : getCoordinatesForRegion(haplo.geographicOrigin);
        const isSelected = selectedHaplogroupId === haplo.id;
        const color = getHaplogroupColor(haplo.haplogroupType);

        return (
          <CircleMarker
            key={haplo.id}
            center={[coords.lat, coords.lng]}
            radius={isSelected ? 14 : 10}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => {
                if (onHaplogroupClick) {
                  onHaplogroupClick(haplo.id);
                }
              },
            }}
          >
            <Popup>
              <div className="min-w-[220px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{haplo.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: color, color: color }}
                  >
                    {haplo.haplogroupType}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Origin:</span>
                    <span className="font-medium">{haplo.geographicOrigin}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Time:</span>
                    <span className="font-medium">{formatYear(haplo.timeOrigin)}</span>
                  </div>

                  {haplo.associatedLanguageFamilyIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Language Families:</span>
                      <span className="font-medium text-right max-w-[120px] truncate">
                        {haplo.associatedLanguageFamilyIds.slice(0, 3).join(', ')}
                        {haplo.associatedLanguageFamilyIds.length > 3 &&
                          ` +${haplo.associatedLanguageFamilyIds.length - 3}`}
                      </span>
                    </div>
                  )}
                </div>

                {haplo.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-3">
                    {haplo.description}
                  </p>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default HaplogroupLayer;
