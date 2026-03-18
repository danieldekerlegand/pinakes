import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';

export interface CookingTechniqueFeature {
  id: string;
  name: string;
  cuisineId: string;
  category: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  description: string;
}

interface CookingTechniquesLayerProps {
  techniques: CookingTechniqueFeature[];
  opacity?: number;
  onTechniqueClick?: (id: string) => void;
  selectedTechniqueId?: string | null;
}

const getCategoryColor = (category: string): string => {
  const colors: Record<string, string> = {
    'heat': '#ef4444',
    'fermentation': '#22c55e',
    'preservation': '#3b82f6',
    'preparation': '#f97316',
    'sauce': '#a855f7',
    'dough': '#eab308',
    'dairy': '#14b8a6',
    'beverage': '#6366f1',
  };
  return colors[category.toLowerCase()] || '#6b7280';
};

const getCategoryIcon = (category: string): string => {
  const icons: Record<string, string> = {
    'heat': 'Fire',
    'fermentation': 'Ferment',
    'preservation': 'Preserve',
    'preparation': 'Prep',
    'sauce': 'Sauce',
    'dough': 'Dough',
    'dairy': 'Dairy',
    'beverage': 'Drink',
  };
  return icons[category.toLowerCase()] || category;
};

const formatYear = (year: number) => {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
};

export function CookingTechniquesLayer({
  techniques,
  opacity = 0.8,
  onTechniqueClick,
  selectedTechniqueId,
}: CookingTechniquesLayerProps) {
  if (techniques.length === 0) return null;

  return (
    <>
      {techniques.map((technique) => {
        const { lat, lng } = technique.coordinates;
        const isSelected = selectedTechniqueId === technique.id;
        const color = getCategoryColor(technique.category);

        return (
          <CircleMarker
            key={technique.id}
            center={[lat, lng]}
            radius={isSelected ? 10 : 6}
            pathOptions={{
              fillColor: isSelected ? '#3b82f6' : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? '#1d4ed8' : '#ffffff',
              weight: isSelected ? 3 : 1.5,
            }}
            eventHandlers={{
              click: () => onTechniqueClick?.(technique.id),
            }}
          >
            <Popup>
              <div className="min-w-[200px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{technique.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: color, color: color }}
                  >
                    {getCategoryIcon(technique.category)}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cuisine:</span>
                    <span className="font-medium capitalize">{technique.cuisineId}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Category:</span>
                    <span className="font-medium capitalize">{technique.category}</span>
                  </div>

                  {technique.timeOrigin !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Origin:</span>
                      <span className="font-medium">{formatYear(technique.timeOrigin)}</span>
                    </div>
                  )}
                </div>

                {technique.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-3">
                    {technique.description}
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

export default CookingTechniquesLayer;
