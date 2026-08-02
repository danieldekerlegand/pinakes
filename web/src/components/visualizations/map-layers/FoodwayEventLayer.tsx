import React, { useEffect, useRef } from 'react';
import { Polyline, CircleMarker, Popup } from 'react-leaflet';
import type { LatLngExpression, Path } from 'leaflet';
import { FOODWAY_MECHANISM_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';
import { Badge } from '../../ui/badge';

export interface FoodwayEventFeature {
  id: string;
  name: string;
  foodItem: string;
  originRegion: string;
  originCoordinates: [number, number];
  destinationRegion: string;
  destinationCoordinates: [number, number];
  date: number;
  mechanism: string;
  associatedRouteId: string;
  description: string;
  culturalImpact: string;
}

interface FoodwayEventLayerProps {
  events: FoodwayEventFeature[];
  opacity?: number;
  onEventClick?: (id: string) => void;
  selectedEventId?: string | null;
  isAnimating?: boolean;
}

const MECHANISM_DASH: Record<string, string | undefined> = {
  trade: undefined,       // solid
  colonization: '10, 5',  // dashed
  migration: '5, 10',     // dotted
};

function getMechanismColor(mechanism: string): string {
  return FOODWAY_MECHANISM_COLORS[mechanism] ?? INTERACTION_COLORS.defaultFallback;
}

function getMechanismDash(mechanism: string): string | undefined {
  return MECHANISM_DASH[mechanism];
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function FoodwayEventLayer({
  events,
  opacity = 0.8,
  onEventClick,
  selectedEventId,
  isAnimating = false,
}: FoodwayEventLayerProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (isAnimating && !styleRef.current) {
      const style = document.createElement('style');
      style.textContent = `
        @keyframes foodway-flow {
          to { stroke-dashoffset: -30; }
        }
        .animated-foodway {
          animation: foodway-flow 1.5s linear infinite;
        }
      `;
      document.head.appendChild(style);
      styleRef.current = style;
    }
    return () => {
      if (styleRef.current) {
        document.head.removeChild(styleRef.current);
        styleRef.current = null;
      }
    };
  }, [isAnimating]);

  if (events.length === 0) return null;

  return (
    <>
      {events.map((event) => {
        const isSelected = selectedEventId === event.id;
        const color = getMechanismColor(event.mechanism);
        const dashArray = getMechanismDash(event.mechanism);

        // Coordinates in TSV are [lng, lat], Leaflet needs [lat, lng]
        const originPos: LatLngExpression = [event.originCoordinates[1], event.originCoordinates[0]];
        const destPos: LatLngExpression = [event.destinationCoordinates[1], event.destinationCoordinates[0]];
        const positions: LatLngExpression[] = [originPos, destPos];

        return (
          <React.Fragment key={event.id}>
            {/* Route line from origin to destination */}
            <Polyline
              positions={positions}
              pathOptions={{
                color: isSelected ? INTERACTION_COLORS.selectedBorder : color,
                weight: isSelected ? 5 : 3,
                opacity: isSelected ? 1 : opacity,
                dashArray: isAnimating ? '10, 10' : (isSelected ? undefined : dashArray),
                className: isAnimating && !isSelected ? 'animated-foodway' : undefined,
              }}
              eventHandlers={{
                click: () => onEventClick?.(event.id),
                mouseover: function (this: Path) {
                  if (!isSelected) {
                    this.setStyle({ weight: 5, opacity: opacity * 1.2 });
                  }
                },
                mouseout: function (this: Path) {
                  if (!isSelected) {
                    this.setStyle({ weight: 3, opacity });
                  }
                },
              }}
            >
              <Popup>
                <div className="p-2 min-w-[240px]">
                  <h3 className="font-bold text-base mb-1">{event.name}</h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Food:</span>
                      <span className="font-medium capitalize">{event.foodItem}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Mechanism:</span>
                      <Badge variant="outline" className="text-xs capitalize">{event.mechanism}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Date:</span>
                      <span className="font-medium">{formatYear(event.date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">From:</span>
                      <span className="font-medium text-right">{event.originRegion}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">To:</span>
                      <span className="font-medium text-right">{event.destinationRegion}</span>
                    </div>
                    {event.description && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-gray-700">{event.description}</p>
                      </div>
                    )}
                    {event.culturalImpact && (
                      <div className="pt-2 border-t">
                        <span className="text-gray-600 text-xs font-medium">Cultural Impact:</span>
                        <p className="text-xs mt-1 text-gray-700">{event.culturalImpact}</p>
                      </div>
                    )}
                    {event.associatedRouteId && (
                      <div className="pt-2 border-t">
                        <span className="text-xs text-gray-500">Route: {event.associatedRouteId}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Popup>
            </Polyline>

            {/* Origin marker */}
            <CircleMarker
              center={originPos}
              radius={isSelected ? 7 : 5}
              pathOptions={{
                color: isSelected ? INTERACTION_COLORS.selectedBorder : color,
                fillColor: color,
                fillOpacity: 0.9,
                weight: 2,
              }}
            />

            {/* Destination marker */}
            <CircleMarker
              center={destPos}
              radius={isSelected ? 7 : 5}
              pathOptions={{
                color: isSelected ? INTERACTION_COLORS.selectedBorder : INTERACTION_COLORS.defaultNodeBorder,
                fillColor: color,
                fillOpacity: 0.6,
                weight: 2,
              }}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}
