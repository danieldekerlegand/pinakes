import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

export interface DanceTraditionFeature {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  danceType: string;
  associatedMusicTraditionIds: string[];
  costumes: string[];
  keyMovements: string[];
  culturalSignificance: string;
  description: string;
}

interface DanceTraditionLayerProps {
  traditions: DanceTraditionFeature[];
  opacity?: number;
  onTraditionClick?: (id: string) => void;
  selectedTraditionId?: string | null;
}

const getDanceTypeColor = (danceType: string): string => {
  const colors: Record<string, string> = {
    'classical': '#7c3aed',    // violet
    'folk': '#16a34a',         // green
    'ceremonial': '#e11d48',   // rose
    'social': '#f59e0b',       // amber
    'martial': '#dc2626',      // red
    'spiritual': '#0891b2',    // cyan
    'contemporary': '#2563eb', // blue
  };
  return colors[danceType.toLowerCase()] ?? '#6b7280';
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

export function DanceTraditionLayer({
  traditions,
  opacity = 0.8,
  onTraditionClick,
  selectedTraditionId,
}: DanceTraditionLayerProps) {
  if (traditions.length === 0) {
    return null;
  }

  return (
    <>
      {traditions.map((tradition) => {
        const { lat, lng } = tradition.coordinates;
        const isSelected = selectedTraditionId === tradition.id;
        const color = getDanceTypeColor(tradition.danceType);

        return (
          <CircleMarker
            key={tradition.id}
            center={[lat, lng]}
            radius={isSelected ? 12 : 8}
            pathOptions={{
              fillColor: isSelected ? '#3b82f6' : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? '#1d4ed8' : '#ffffff',
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
                  <h3 className="font-bold text-base">{tradition.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs capitalize"
                    style={{ borderColor: color, color: color }}
                  >
                    {tradition.danceType}
                  </Badge>
                </div>

                {tradition.nativeName && tradition.nativeName !== tradition.name && (
                  <p className="text-sm text-gray-600 mb-2">
                    {tradition.nativeName}
                  </p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Region:</span>
                    <span className="font-medium">{tradition.region}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">
                      {formatTimePeriod(tradition.timeOrigin, tradition.timeEnd)}
                    </span>
                  </div>

                  {tradition.keyMovements.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Key moves:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {tradition.keyMovements.slice(0, 3).join(', ')}
                        {tradition.keyMovements.length > 3 &&
                          ` +${tradition.keyMovements.length - 3}`}
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

                {tradition.culturalSignificance && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                    {tradition.culturalSignificance}
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
                  View Details
                </Button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default DanceTraditionLayer;
