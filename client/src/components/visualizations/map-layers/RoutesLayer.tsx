import React, { useEffect, useRef, useMemo } from 'react';
import { Polyline, Popup, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type { HistoricalRouteFeature } from '../../../lib/visualization/geospatial-types';
import { ROUTE_TYPE_COLORS, INTERACTION_COLORS } from '../../../lib/visualization/color-theme';
import {
  splitRouteByTerrain,
  classifyRouteTerrain,
  generateElevationProfile,
  getTerrainStyle,
  getTerrainLabel,
  getTerrainIcon,
  type TerrainType,
  type RouteSegment,
  type ElevationProfile as ElevationProfileType,
} from '../../../lib/visualization/terrain-route-utils';
import { RouteElevationProfile } from './RouteElevationProfile';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

interface RoutesLayerProps {
  features: HistoricalRouteFeature[];
  opacity?: number;
  onFeatureClick?: (id: string) => void;
  selectedFeatureId?: string | null;
  isAnimating?: boolean;
  terrainAware?: boolean;
  /**
   * Route ids to emphasise (US-002 hypothesis-driven selection). When non-empty, these
   * routes are boosted and any route NOT in the set is dimmed. Empty/undefined = no
   * emphasis (all routes render normally).
   */
  highlightedRouteIds?: string[];
}

// Opacity multiplier applied to routes dimmed by an active hypothesis selection.
const DIMMED_OPACITY_FACTOR = 0.15;
// Extra stroke weight for routes an active hypothesis highlights.
const HIGHLIGHT_WEIGHT_BONUS = 2;

interface ProcessedRoute {
  feature: HistoricalRouteFeature;
  segments: RouteSegment[];
  terrainType: TerrainType;
  elevationProfile: ElevationProfileType;
}

// Sea segment marker interval (every Nth coordinate gets a ship icon)
const SEA_MARKER_INTERVAL = 3;

export function RoutesLayer({
  features,
  opacity = 0.7,
  onFeatureClick,
  selectedFeatureId,
  isAnimating = false,
  terrainAware = true,
  highlightedRouteIds,
}: RoutesLayerProps) {
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Hypothesis-driven emphasis (US-002): when a selection is active, highlighted routes
  // are boosted and all others dimmed. No selection ⇒ every route renders 'normal'.
  const emphasisFor = useMemo(() => {
    const highlighted = new Set(highlightedRouteIds ?? []);
    const active = highlighted.size > 0;
    return (routeId: string): 'highlight' | 'dim' | 'normal' => {
      if (!active) return 'normal';
      return highlighted.has(routeId) ? 'highlight' : 'dim';
    };
  }, [highlightedRouteIds]);

  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.textContent = `
        @keyframes dash-flow {
          to { stroke-dashoffset: -30; }
        }
        .animated-route {
          animation: dash-flow 1s linear infinite;
        }
        .route-river {
          filter: drop-shadow(0 0 2px rgba(59, 130, 246, 0.3));
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
  }, []);

  // Pre-process routes with terrain classification and elevation
  const processedRoutes = useMemo(() => {
    return features.map((feature): ProcessedRoute => {
      const coords = feature.geometry.coordinates;
      const segments = terrainAware ? splitRouteByTerrain(coords) : [{
        coordinates: coords.map(([lng, lat]) => [lng, lat] as [number, number]),
        terrainType: 'land' as TerrainType,
      }];
      const terrainType = terrainAware ? classifyRouteTerrain(coords) : 'land';
      const elevationProfile = generateElevationProfile(coords);
      return { feature, segments, terrainType, elevationProfile };
    });
  }, [features, terrainAware]);

  const getRouteColor = (routeType: string): string => {
    return ROUTE_TYPE_COLORS[routeType] || ROUTE_TYPE_COLORS.unknown;
  };

  const getDashPattern = (routeType: string, terrainType: TerrainType): string | undefined => {
    // Terrain type takes precedence for dash patterns
    if (terrainAware) {
      const terrainStyle = getTerrainStyle(terrainType);
      if (terrainStyle.dashArray) return terrainStyle.dashArray;
    }

    if (routeType === 'migration') return '10, 5';
    if (routeType === 'pilgrimage') return '5, 10';
    if (routeType === 'diaspora') return '15, 5, 5, 5';
    return undefined;
  };

  if (features.length === 0) return null;

  return (
    <>
      {processedRoutes.map(({ feature, segments, terrainType, elevationProfile }) => {
        const props = feature.properties;
        const isSelected = selectedFeatureId === feature.id;
        const baseColor = getRouteColor(props.routeType);
        const emphasis = emphasisFor(props.routeId);
        // Dim non-selected routes when a hypothesis is active; boost highlighted ones.
        // A directly-selected route always renders at full emphasis.
        const dimFactor = emphasis === 'dim' && !isSelected ? DIMMED_OPACITY_FACTOR : 1;
        const weightBonus = emphasis === 'highlight' && !isSelected ? HIGHLIGHT_WEIGHT_BONUS : 0;

        if (terrainAware && segments.length > 1) {
          // Render each terrain segment separately with terrain-specific styling
          return (
            <React.Fragment key={feature.id}>
              {segments.map((segment, segIdx) => {
                const segStyle = getTerrainStyle(segment.terrainType);
                const positions: LatLngExpression[] = segment.coordinates.map(
                  ([lng, lat]) => [lat, lng] as LatLngExpression
                );

                return (
                  <React.Fragment key={`${feature.id}-seg-${segIdx}`}>
                    <Polyline
                      positions={positions}
                      pathOptions={{
                        color: isSelected ? INTERACTION_COLORS.selectedBorder : baseColor,
                        weight: isSelected ? 5 : segStyle.weight + weightBonus,
                        opacity: isSelected ? 1 : opacity * segStyle.opacity * dimFactor,
                        dashArray: isAnimating ? '10, 10' : (isSelected ? undefined : segStyle.dashArray),
                        lineCap: segStyle.lineCap,
                        className: isAnimating && !isSelected && emphasis !== 'dim'
                          ? 'animated-route'
                          : segStyle.className,
                      }}
                      eventHandlers={{
                        click: () => onFeatureClick?.(props.routeId),
                        mouseover: function() {
                          if (!isSelected) {
                            this.setStyle({ weight: 5, opacity: opacity * 1.2 });
                          }
                        },
                        mouseout: function() {
                          if (!isSelected) {
                            this.setStyle({ weight: segStyle.weight + weightBonus, opacity: opacity * segStyle.opacity * dimFactor });
                          }
                        },
                      }}
                    >
                      {segIdx === 0 && (
                        <Popup>
                          <RoutePopupContent
                            props={props}
                            terrainType={terrainType}
                            elevationProfile={elevationProfile}
                            baseColor={baseColor}
                            onFeatureClick={onFeatureClick}
                          />
                        </Popup>
                      )}
                    </Polyline>

                    {/* Ship/terrain markers on maritime segments */}
                    {segment.terrainType === 'maritime' && segment.coordinates
                      .filter((_, i) => i % SEA_MARKER_INTERVAL === 1)
                      .map((coord, mIdx) => (
                        <CircleMarker
                          key={`${feature.id}-ship-${segIdx}-${mIdx}`}
                          center={[coord[1], coord[0]]}
                          radius={4}
                          pathOptions={{
                            color: baseColor,
                            fillColor: '#ffffff',
                            fillOpacity: 0.9,
                            weight: 1.5,
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -5]} permanent={false}>
                            <span className="text-xs">{getTerrainIcon('maritime')} Sea passage</span>
                          </Tooltip>
                        </CircleMarker>
                      ))
                    }
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        }

        // Single-terrain route or non-terrain-aware mode
        const segStyle = terrainAware ? getTerrainStyle(terrainType) : { weight: 3, opacity: 1, lineCap: 'round' as const };
        const dashArray = getDashPattern(props.routeType, terrainType);
        const positions: LatLngExpression[] = feature.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as LatLngExpression
        );

        return (
          <React.Fragment key={feature.id}>
            <Polyline
              positions={positions}
              pathOptions={{
                color: isSelected ? INTERACTION_COLORS.selectedBorder : baseColor,
                weight: isSelected ? 5 : segStyle.weight + weightBonus,
                opacity: isSelected ? 1 : opacity * segStyle.opacity * dimFactor,
                dashArray: isAnimating ? '10, 10' : (isSelected ? undefined : dashArray),
                lineCap: segStyle.lineCap,
                className: isAnimating && !isSelected && emphasis !== 'dim' ? 'animated-route' : undefined,
              }}
              eventHandlers={{
                click: () => onFeatureClick?.(props.routeId),
                mouseover: function() {
                  if (!isSelected) {
                    this.setStyle({ weight: 5, opacity: opacity * 1.2 });
                  }
                },
                mouseout: function() {
                  if (!isSelected) {
                    this.setStyle({ weight: segStyle.weight + weightBonus, opacity: opacity * segStyle.opacity * dimFactor });
                  }
                },
              }}
            >
              <Popup>
                <RoutePopupContent
                  props={props}
                  terrainType={terrainType}
                  elevationProfile={elevationProfile}
                  baseColor={baseColor}
                  onFeatureClick={onFeatureClick}
                />
              </Popup>
            </Polyline>

            {/* Ship markers for maritime routes */}
            {terrainAware && terrainType === 'maritime' && feature.geometry.coordinates
              .filter((_, i) => i % SEA_MARKER_INTERVAL === 1)
              .map((coord, mIdx) => (
                <CircleMarker
                  key={`${feature.id}-ship-${mIdx}`}
                  center={[coord[1], coord[0]]}
                  radius={4}
                  pathOptions={{
                    color: baseColor,
                    fillColor: '#ffffff',
                    fillOpacity: 0.9,
                    weight: 1.5,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -5]} permanent={false}>
                    <span className="text-xs">{getTerrainIcon('maritime')} Sea passage</span>
                  </Tooltip>
                </CircleMarker>
              ))
            }
          </React.Fragment>
        );
      })}
    </>
  );
}

// Extracted popup content to avoid duplication
function RoutePopupContent({
  props,
  terrainType,
  elevationProfile,
  baseColor,
  onFeatureClick,
}: {
  props: HistoricalRouteFeature['properties'];
  terrainType: TerrainType;
  elevationProfile: ElevationProfileType;
  baseColor: string;
  onFeatureClick?: (id: string) => void;
}) {
  return (
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
          <span className="text-gray-600">Terrain:</span>
          <span className="font-medium">
            {getTerrainIcon(terrainType)} {getTerrainLabel(terrainType)}
          </span>
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

        {/* Elevation Profile */}
        {elevationProfile.points.length >= 2 && terrainType !== 'maritime' && (
          <div className="pt-2 border-t">
            <span className="text-gray-600 text-xs font-medium">Elevation Profile:</span>
            <div className="mt-1">
              <RouteElevationProfile
                profile={elevationProfile}
                color={baseColor}
                width={200}
                height={50}
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>Ascent: {Math.round(elevationProfile.totalAscent)}m</span>
                <span>Descent: {Math.round(elevationProfile.totalDescent)}m</span>
              </div>
            </div>
          </div>
        )}

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
        onClick={() => onFeatureClick?.(props.routeId)}
      >
        View Details
      </Button>
    </div>
  );
}
