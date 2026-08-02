import React from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { Badge } from '../../ui/badge';
import { REGION_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';

export interface IngredientOriginFeature {
  id: string;
  name: string;
  cuisineId: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  nativeName: string;
  description: string;
}

interface IngredientOriginsLayerProps {
  ingredients: IngredientOriginFeature[];
  opacity?: number;
  onIngredientClick?: (id: string) => void;
  selectedIngredientId?: string | null;
}

const getRegionColor = (region: string): string => {
  for (const [key, color] of Object.entries(REGION_COLORS)) {
    if (region.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }
  return INTERACTION_COLORS.defaultFallback;
};

const formatYear = (year: number) => {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
};

export function IngredientOriginsLayer({
  ingredients,
  opacity = 0.8,
  onIngredientClick,
  selectedIngredientId,
}: IngredientOriginsLayerProps) {
  if (ingredients.length === 0) return null;

  return (
    <>
      {ingredients.map((ingredient) => {
        const { lat, lng } = ingredient.coordinates;
        const isSelected = selectedIngredientId === ingredient.id;
        const color = getRegionColor(ingredient.originRegion);

        return (
          <CircleMarker
            key={ingredient.id}
            center={[lat, lng]}
            radius={isSelected ? 10 : 6}
            pathOptions={{
              fillColor: isSelected ? INTERACTION_COLORS.selected : color,
              fillOpacity: isSelected ? 0.9 : opacity,
              color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
              weight: isSelected ? 3 : 1.5,
            }}
            eventHandlers={{
              click: () => onIngredientClick?.(ingredient.id),
            }}
          >
            <Popup>
              <div className="min-w-[200px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{ingredient.name}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{ borderColor: color, color: color }}
                  >
                    {ingredient.originRegion}
                  </Badge>
                </div>

                {ingredient.nativeName && (
                  <p className="text-sm text-gray-600 mb-2">{ingredient.nativeName}</p>
                )}

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cuisine:</span>
                    <span className="font-medium capitalize">{ingredient.cuisineId}</span>
                  </div>

                  {ingredient.timeOrigin !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Domesticated:</span>
                      <span className="font-medium">{formatYear(ingredient.timeOrigin)}</span>
                    </div>
                  )}
                </div>

                {ingredient.description && (
                  <p className="text-xs text-gray-500 mt-2 line-clamp-3">
                    {ingredient.description}
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

export default IngredientOriginsLayer;
