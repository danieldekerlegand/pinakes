import React, { useEffect, useRef } from 'react';
import { Polyline, Popup } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { HistoricalRouteFeature } from '../../../lib/visualization/geospatial-types';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

interface RoutesLayerProps {
  features: HistoricalRouteFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  isAnimating?: boolean;
}

export function RoutesLayer({
  features,
  opacity = 0.7,
  onFeatureClick,
  selectedFeatureId,
  isAnimating = false,
}: RoutesLayerProps) {
  // Add CSS animation for flowing dash effect
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (isAnimating && !styleRef.current) {
      const style = document.createElement('style');
      style.textContent = `
        @keyframes dash-flow {
          to { stroke-dashoffset: -30; }
        }
        .animated-route {
          animation: dash-flow 1s linear infinite;
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
  // Get color based on route type
  const getRouteColor = (routeType: string): string => {
    const colors: Record<string, string> = {
      trade: '#22c55e', // green
      migration: '#3b82f6', // blue
      conquest: '#ef4444', // red
      colonization: '#f97316', // orange
      diaspora: '#eab308', // yellow
      pilgrimage: '#a855f7', // purple
      communication: '#06b6d4', // cyan
      unknown: '#9ca3af', // gray
    };
    return colors[routeType] || colors.unknown;
  };

  // Get dash pattern based on route type
  const getDashPattern = (routeType: string): string | undefined => {
    if (routeType === 'migration') {
      return '10, 5'; // Dashed for migration
    }
    if (routeType === 'pilgrimage') {
      return '5, 10'; // Dotted for pilgrimage
    }
    if (routeType === 'diaspora') {
      return '15, 5, 5, 5'; // Dash-dot for diaspora
    }
    return undefined; // Solid for others
  };

  if (features.length === 0) {
    return null;
  }

  return (
    <>
      {features.map((feature) => {
        const props = feature.properties;
        const isSelected = selectedFeatureId === feature.id;
        const color = getRouteColor(props.routeType);
        const dashArray = getDashPattern(props.routeType);

        // Convert LineString coordinates to Leaflet LatLng format
        const positions: LatLngExpression[] = feature.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as LatLngExpression
        );

        return (
          <Polyline
            key={feature.id}
            positions={positions}
            pathOptions={{
              color: isSelected ? '#1d4ed8' : color,
              weight: isSelected ? 5 : 3,
              opacity: isSelected ? 1 : opacity,
              dashArray: isAnimating ? '10, 10' : (isSelected ? undefined : dashArray),
              className: isAnimating && !isSelected ? 'animated-route' : undefined,
            }}
            eventHandlers={{
              click: () => {
                if (onFeatureClick) {
                  onFeatureClick(props.routeId);
                }
              },
              mouseover: function() {
                if (!isSelected) {
                  this.setStyle({
                    weight: 5,
                    opacity: opacity * 1.2,
                  });
                }
              },
              mouseout: function() {
                if (!isSelected) {
                  this.setStyle({
                    weight: 3,
                    opacity: opacity,
                  });
                }
              },
            }}
          >
            <Popup>
              <div className="p-2 min-w-[220px]">
                <h3 className="font-bold text-base mb-1">{props.name}</h3>

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Route Type:</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {props.routeType}
                    </Badge>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Time Period:</span>
                    <span className="font-medium text-right">
                      {formatTimePeriod(props.timePeriod.start, props.timePeriod.end)}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-600">Direction:</span>
                    <span className="font-medium capitalize">{props.direction}</span>
                  </div>

                  {props.linguisticImpact && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Linguistic Impact:</span>
                      <p className="text-xs mt-1 text-gray-700">{props.linguisticImpact}</p>
                    </div>
                  )}

                  {props.tradedGoods && props.tradedGoods.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Traded Goods:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {props.tradedGoods.slice(0, 4).map((good, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded"
                          >
                            {good}
                          </span>
                        ))}
                        {props.tradedGoods.length > 4 && (
                          <span className="text-xs text-gray-500">
                            +{props.tradedGoods.length - 4}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {props.associatedLanguageIds && props.associatedLanguageIds.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs">
                        Influenced {props.associatedLanguageIds.length} language(s)
                      </span>
                    </div>
                  )}

                  {props.sources && props.sources.length > 0 && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs">
                        {props.sources.length} source(s)
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => {
                    if (onFeatureClick) {
                      onFeatureClick(props.routeId);
                    }
                  }}
                >
                  View Details
                </Button>
              </div>
            </Popup>
          </Polyline>
        );
      })}
    </>
  );
}
