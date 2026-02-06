import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

export interface CuisineFeature {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  associatedLanguageIds: string[];
  timeOrigin: number | null;
  timeEnd: number | null;
  description: string;
  itemCount?: number;
}

interface CuisineLayerProps {
  cuisines: CuisineFeature[];
  opacity?: number;
  onCuisineClick?: (id: string) => void;
  selectedCuisineId?: string | null;
}

// Region-based color scheme
const getRegionColor = (region: string): string => {
  const colors: Record<string, string> = {
    'East Asia': '#ef4444', // red
    'South Asia': '#f97316', // orange
    'Southeast Asia': '#eab308', // yellow
    'Middle East': '#84cc16', // lime
    'East Africa': '#22c55e', // green
    'Southern Europe': '#14b8a6', // teal
    'Western Europe': '#3b82f6', // blue
    'Central Europe': '#6366f1', // indigo
    'Caucasus': '#a855f7', // purple
    'North America': '#ec4899', // pink
    'South America': '#f43f5e', // rose
  };
  
  // Find matching region
  for (const [key, color] of Object.entries(colors)) {
    if (region.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return '#6b7280'; // gray default
};

// Format time period for display
const formatTimePeriod = (start: number | null, end: number | null): string => {
  const formatYear = (year: number) => {
    if (year < 0) return `${Math.abs(year)} BCE`;
    return `${year} CE`;
  };

  if (start === null && end === null) return 'Unknown period';
  if (start === null) return `Until ${formatYear(end!)}`;
  if (end === null) return `Since ${formatYear(start)}`;
  return `${formatYear(start)} - ${formatYear(end)}`;
};

export function CuisineLayer({
  cuisines,
  opacity = 0.8,
  onCuisineClick,
  selectedCuisineId,
}: CuisineLayerProps) {
  if (cuisines.length === 0) {
    return null;
  }

  return (
    <>
      {cuisines.map((cuisine) => {
        const { lat, lng } = cuisine.coordinates;
        const isSelected = selectedCuisineId === cuisine.id;
        const color = getRegionColor(cuisine.region);

        return (
          <CircleMarker
            key={cuisine.id}
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
                if (onCuisineClick) {
                  onCuisineClick(cuisine.id);
                }
              },
            }}
          >
            <Popup>
              <div className="min-w-[220px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{cuisine.name}</h3>
                  <Badge 
                    variant="outline" 
                    className="text-xs"
                    style={{ borderColor: color, color: color }}
                  >
                    {cuisine.region}
                  </Badge>
                </div>

                {cuisine.nativeName && (
                  <p className="text-sm text-gray-600 mb-2">
                    {cuisine.nativeName}
                  </p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Period:</span>
                    <span className="font-medium">
                      {formatTimePeriod(cuisine.timeOrigin, cuisine.timeEnd)}
                    </span>
                  </div>

                  {cuisine.associatedLanguageIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Languages:</span>
                      <span className="font-medium text-right max-w-[140px] truncate">
                        {cuisine.associatedLanguageIds.slice(0, 3).join(', ')}
                        {cuisine.associatedLanguageIds.length > 3 && 
                          ` +${cuisine.associatedLanguageIds.length - 3}`}
                      </span>
                    </div>
                  )}

                  {cuisine.itemCount !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Dishes:</span>
                      <span className="font-medium">{cuisine.itemCount}</span>
                    </div>
                  )}
                </div>

                {cuisine.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                    {cuisine.description}
                  </p>
                )}

                <Button
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => {
                    if (onCuisineClick) {
                      onCuisineClick(cuisine.id);
                    }
                  }}
                >
                  View Dishes
                </Button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default CuisineLayer;
