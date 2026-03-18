import React, { useEffect, useRef, useMemo, useState } from 'react';
import { CircleMarker, Popup, Circle, useMap } from 'react-leaflet';
import { Badge } from '../../ui/badge';

interface SpreadEvent {
  date: number;
  coordinates: [number, number];
  associatedCivilization: string;
}

export interface MaterialCultureItem {
  id: string;
  name: string;
  category: string;
  originDate: number;
  originCoordinates: [number, number];
  spreadData: SpreadEvent[];
  description: string;
  associatedLanguages: string[];
  significance: string;
}

interface MaterialCultureWaveLayerProps {
  items: MaterialCultureItem[];
  opacity?: number;
  currentYear?: number;
  onItemClick?: (id: string) => void;
  selectedItemId?: string | null;
  animationEnabled?: boolean;
}

const categoryColors: Record<string, string> = {
  pottery: '#d97706',
  metallurgy: '#6b7280',
  tools: '#92400e',
  agriculture: '#16a34a',
  textiles: '#7c3aed',
  architecture: '#dc2626',
  weapons: '#1e293b',
  writing: '#2563eb',
  navigation: '#0891b2',
  printing: '#4f46e5',
  glasswork: '#06b6d4',
  unknown: '#9ca3af',
};

const getCategoryColor = (category: string): string => {
  return categoryColors[category] || categoryColors.unknown;
};

const formatYear = (year: number): string => {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
};

export function MaterialCultureWaveLayer({
  items,
  opacity = 0.7,
  currentYear = 2024,
  onItemClick,
  selectedItemId,
  animationEnabled = true,
}: MaterialCultureWaveLayerProps) {
  const [animPhase, setAnimPhase] = useState(0);

  useEffect(() => {
    if (!animationEnabled) return;
    const interval = setInterval(() => {
      setAnimPhase((prev) => (prev + 1) % 60);
    }, 100);
    return () => clearInterval(interval);
  }, [animationEnabled]);

  // Filter items visible at current year
  const visibleItems = useMemo(() => {
    return items.filter((item) => item.originDate <= currentYear);
  }, [items, currentYear]);

  // Wave animation: concentric circles that pulse outward
  const waveRadius = useMemo(() => {
    // Pulsing radius from 0 to max over 60 frames
    const t = animPhase / 60;
    return t;
  }, [animPhase]);

  return (
    <>
      {visibleItems.map((item) => {
        const color = getCategoryColor(item.category);
        const isSelected = selectedItemId === item.id;

        // Compute which spread points are visible at currentYear
        const visibleSpreads = item.spreadData.filter(
          (s) => s.date <= currentYear
        );

        // Animated wave rings from origin
        const waveRings = animationEnabled ? [1, 2, 3].map((ring) => {
          const phase = ((waveRadius + ring * 0.33) % 1);
          const radius = phase * 300000; // max 300km radius
          const ringOpacity = Math.max(0, (1 - phase) * 0.3 * opacity);
          return (
            <Circle
              key={`${item.id}-wave-${ring}`}
              center={[item.originCoordinates[0], item.originCoordinates[1]]}
              radius={radius}
              pathOptions={{
                color,
                weight: 1.5,
                fillColor: color,
                fillOpacity: ringOpacity * 0.1,
                opacity: ringOpacity,
                dashArray: '4 4',
              }}
            />
          );
        }) : [];

        return (
          <React.Fragment key={item.id}>
            {/* Animated wave rings from origin */}
            {waveRings}

            {/* Origin point marker */}
            <CircleMarker
              center={[item.originCoordinates[0], item.originCoordinates[1]]}
              radius={isSelected ? 10 : 7}
              pathOptions={{
                color: '#fff',
                weight: 2,
                fillColor: color,
                fillOpacity: opacity,
              }}
              eventHandlers={{
                click: () => onItemClick?.(item.id),
              }}
            >
              <Popup>
                <div className="min-w-[220px]">
                  <h3 className="font-bold text-sm mb-1">{item.name}</h3>
                  <div className="flex gap-1 mb-2">
                    <Badge variant="secondary" className="text-xs">
                      {item.category}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {formatYear(item.originDate)}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{item.description}</p>
                  {item.associatedLanguages.length > 0 && (
                    <p className="text-xs text-gray-500">
                      Languages: {item.associatedLanguages.join(', ')}
                    </p>
                  )}
                  {item.spreadData.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      <p className="text-xs font-semibold mb-1">Spread Timeline:</p>
                      {item.spreadData.map((s, i) => (
                        <div key={i} className="text-xs text-gray-500 flex justify-between">
                          <span>{s.associatedCivilization}</span>
                          <span>{formatYear(s.date)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>

            {/* Spread point markers with connecting lines */}
            {visibleSpreads.map((spread, idx) => {
              const spreadOpacity = opacity * 0.7;
              return (
                <React.Fragment key={`${item.id}-spread-${idx}`}>
                  <CircleMarker
                    center={[spread.coordinates[0], spread.coordinates[1]]}
                    radius={5}
                    pathOptions={{
                      color,
                      weight: 1,
                      fillColor: color,
                      fillOpacity: spreadOpacity,
                    }}
                  >
                    <Popup>
                      <div className="min-w-[180px]">
                        <h4 className="font-bold text-xs">{item.name}</h4>
                        <p className="text-xs text-gray-500">
                          Reached {spread.associatedCivilization} by {formatYear(spread.date)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {Math.abs(spread.date - item.originDate)} years after origin
                        </p>
                      </div>
                    </Popup>
                  </CircleMarker>
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}
