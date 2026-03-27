import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { MUSIC_REGION_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface MusicTraditionFeature {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  instruments: string[];
  scales: string[];
  rhythmicPatterns: string[];
  relatedTraditions: string[];
  description: string;
}

interface MusicTraditionLayerProps {
  traditions: MusicTraditionFeature[];
  opacity?: number;
  onTraditionClick?: (id: string) => void;
  selectedTraditionId?: string | null;
}

// Region-based color scheme (musical note inspired)
const getRegionColor = (region: string): string => {
  for (const [key, color] of Object.entries(MUSIC_REGION_COLORS)) {
    if (region.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return INTERACTION_COLORS.defaultFallback;
};

const formatTimePeriod = (start: number | null, end: number | null): string => {
  const formatYear = (year: number) => {
    if (year < 0) return `${Math.abs(year)} BCE`;
    return `${year} CE`;
  };
  if (start === null && end === null) return 'Unknown period';
  if (start === null) return `Until ${formatYear(end!)}`;
  if (end === null) return `Since ${formatYear(start)}`;
  return `${formatYear(start)} – ${formatYear(end)}`;
};

export function MusicTraditionLayer({
  traditions,
  opacity = 0.8,
  onTraditionClick,
  selectedTraditionId,
}: MusicTraditionLayerProps) {
  if (traditions.length === 0) {
    return null;
  }

  return (
    <>
      {traditions.map((tradition) => {
        const { lat, lng } = tradition.coordinates;
        const isSelected = selectedTraditionId === tradition.id;
        const color = getRegionColor(tradition.region);

        return (
          <CircleMarker
            key={tradition.id}
            center={[lat, lng]}
            radius={isSelected ? 12 : 8}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => {
                if (onTraditionClick) {
                  onTraditionClick(tradition.id);
                }
              },
            }}
          >
            <Popup>
              <div className="min-w-[240px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">♪ {tradition.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: color, color: color }}
                  >
                    {tradition.region}
                  </Badge>
                </div>

                {tradition.nativeName && tradition.nativeName !== tradition.name && (
                  <p className="text-sm text-gray-600 mb-2">
                    {tradition.nativeName}
                  </p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">
                      {formatTimePeriod(tradition.timeOrigin, tradition.timeEnd)}
                    </span>
                  </div>

                  {tradition.scales.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Scales:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {tradition.scales.join(', ')}
                      </span>
                    </div>
                  )}

                  {tradition.instruments.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Instruments:</span>
                      <span className="font-medium">
                        {tradition.instruments.length}
                      </span>
                    </div>
                  )}

                  {tradition.associatedLanguageIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Languages:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {tradition.associatedLanguageIds.slice(0, 3).join(', ')}
                        {tradition.associatedLanguageIds.length > 3 &&
                          ` +${tradition.associatedLanguageIds.length - 3}`}
                      </span>
                    </div>
                  )}
                </div>

                {tradition.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                    {tradition.description}
                  </p>
                )}

                <Button
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => {
                    if (onTraditionClick) {
                      onTraditionClick(tradition.id);
                    }
                  }}
                >
                  View Instruments
                </Button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default MusicTraditionLayer;
