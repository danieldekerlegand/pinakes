import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { RELIGION_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface ReligionFeature {
  id: string;
  name: string;
  nativeName: string;
  religionType: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  sacredTexts: string[];
  associatedLanguageIds: string[];
  deityPantheon: string[];
  ritualPractices: string[];
  description: string;
}

interface ReligionLayerProps {
  religions: ReligionFeature[];
  opacity?: number;
  onReligionClick?: (id: string) => void;
  selectedReligionId?: string | null;
}

// Religion type-based color scheme
const getReligionColor = (religionType: string): string => {
  return RELIGION_COLORS[religionType] || INTERACTION_COLORS.defaultFallback;
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

export function ReligionLayer({
  religions,
  opacity = 0.8,
  onReligionClick,
  selectedReligionId,
}: ReligionLayerProps) {
  if (religions.length === 0) {
    return null;
  }

  return (
    <>
      {religions.map((religion) => {
        const { lat, lng } = religion.coordinates;
        const isSelected = selectedReligionId === religion.id;
        const color = getReligionColor(religion.religionType);

        return (
          <CircleMarker
            key={religion.id}
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
                if (onReligionClick) {
                  onReligionClick(religion.id);
                }
              },
            }}
          >
            <Popup>
              <div className="min-w-[240px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{religion.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs capitalize"
                    style={{ borderColor: color, color: color }}
                  >
                    {religion.religionType}
                  </Badge>
                </div>

                {religion.nativeName && religion.nativeName !== religion.name && (
                  <p className="text-sm text-gray-600 mb-2">
                    {religion.nativeName}
                  </p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">
                      {formatTimePeriod(religion.timeOrigin, religion.timeEnd)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Origin:</span>
                    <span className="font-medium">{religion.originRegion}</span>
                  </div>

                  {religion.deityPantheon.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Deities:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {religion.deityPantheon.slice(0, 3).join(', ')}
                        {religion.deityPantheon.length > 3 &&
                          ` +${religion.deityPantheon.length - 3}`}
                      </span>
                    </div>
                  )}

                  {religion.sacredTexts.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Texts:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {religion.sacredTexts.slice(0, 2).join(', ')}
                        {religion.sacredTexts.length > 2 &&
                          ` +${religion.sacredTexts.length - 2}`}
                      </span>
                    </div>
                  )}

                  {religion.associatedLanguageIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Languages:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {religion.associatedLanguageIds.slice(0, 3).join(', ')}
                        {religion.associatedLanguageIds.length > 3 &&
                          ` +${religion.associatedLanguageIds.length - 3}`}
                      </span>
                    </div>
                  )}
                </div>

                {religion.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                    {religion.description}
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

export default ReligionLayer;
