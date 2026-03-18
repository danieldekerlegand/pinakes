import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

export interface ArchitecturalStyleFeature {
  id: string;
  name: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  region: string;
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
  buildingTypes: string[];
}

interface ArchitecturalStylesLayerProps {
  styles: ArchitecturalStyleFeature[];
  opacity?: number;
  onStyleClick?: (id: string) => void;
  selectedStyleId?: string | null;
}

const getRegionColor = (region: string): string => {
  const colors: Record<string, string> = {
    'North Africa': '#f59e0b',
    'Southern Europe': '#3b82f6',
    'Eastern Europe': '#8b5cf6',
    'Western Europe': '#6366f1',
    'Middle East': '#10b981',
    'South Asia': '#f97316',
    'East Asia': '#ef4444',
    'Southeast Asia': '#eab308',
    'Central America': '#14b8a6',
    'South America': '#ec4899',
    'West Africa': '#22c55e',
    'North America': '#a855f7',
  };

  for (const [key, color] of Object.entries(colors)) {
    if (region.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return '#6b7280';
};

const formatTimePeriod = (start: number, end: number): string => {
  const formatYear = (year: number) => {
    if (year < 0) return `${Math.abs(year)} BCE`;
    return `${year} CE`;
  };
  return `${formatYear(start)} - ${formatYear(end)}`;
};

export function ArchitecturalStylesLayer({
  styles,
  opacity = 0.8,
  onStyleClick,
  selectedStyleId,
}: ArchitecturalStylesLayerProps) {
  if (styles.length === 0) {
    return null;
  }

  return (
    <>
      {styles.map((style) => {
        const { lat, lng } = style.originCoordinates;
        const isSelected = selectedStyleId === style.id;
        const color = getRegionColor(style.region);

        return (
          <CircleMarker
            key={style.id}
            center={[lat, lng]}
            radius={isSelected ? 14 : 10}
            pathOptions={{
              fillColor: isSelected ? '#3b82f6' : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? '#1d4ed8' : '#ffffff',
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onStyleClick?.(style.id),
            }}
          >
            <Popup>
              <div className="p-2 max-w-xs">
                <h3 className="font-bold text-sm mb-1">{style.name}</h3>
                <div className="flex gap-1 mb-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">{style.stylePeriod}</Badge>
                  <Badge variant="secondary" className="text-xs">{style.region}</Badge>
                </div>
                <p className="text-xs text-gray-600 mb-2">{style.description}</p>
                <div className="text-xs text-gray-500 mb-1">
                  {formatTimePeriod(style.originDate, style.endDate)}
                </div>
                {style.notableExamples.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs font-semibold">Notable: </span>
                    <span className="text-xs text-gray-600">
                      {style.notableExamples.slice(0, 3).join(', ')}
                    </span>
                  </div>
                )}
                {style.buildingTypes.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {style.buildingTypes.map((bt) => (
                      <Badge key={bt} variant="outline" className="text-xs px-1 py-0">
                        {bt}
                      </Badge>
                    ))}
                  </div>
                )}
                {onStyleClick && (
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2 p-0 h-auto text-xs"
                    onClick={() => onStyleClick(style.id)}
                  >
                    View details
                  </Button>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
