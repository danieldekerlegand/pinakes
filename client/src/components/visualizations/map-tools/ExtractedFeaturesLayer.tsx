import React from 'react';
import { CircleMarker, Polygon, Polyline, Tooltip } from 'react-leaflet';
import type { ReviewableFeature } from './ExtractedFeatureReview';

interface ExtractedFeaturesLayerProps {
  features: ReviewableFeature[];
}

const SETTLEMENT_COLORS: Record<string, string> = {
  city: '#dc2626',
  town: '#ea580c',
  village: '#ca8a04',
  fort: '#7c3aed',
  port: '#0284c7',
  religious: '#be185d',
  unknown: '#6b7280',
};

const BOUNDARY_COLORS: Record<string, string> = {
  empire: '#dc2626',
  kingdom: '#2563eb',
  region: '#16a34a',
  territory: '#d97706',
  unknown: '#6b7280',
};

const ROUTE_COLORS: Record<string, string> = {
  trade: '#d97706',
  migration: '#2563eb',
  military: '#dc2626',
  pilgrimage: '#7c3aed',
  unknown: '#6b7280',
};

export function ExtractedFeaturesLayer({ features }: ExtractedFeaturesLayerProps) {
  const visible = features.filter((f) => f.visible);

  return (
    <>
      {/* Boundaries (render first, under other features) */}
      {visible
        .filter((f) => f.type === 'boundary')
        .map((f) => {
          const coords = f.data.coordinates as [number, number][];
          if (!coords || coords.length < 3) return null;
          const color = BOUNDARY_COLORS[(f.data.boundaryType as string) || 'unknown'] || '#6b7280';
          return (
            <Polygon
              key={f.id}
              positions={coords}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: f.accepted ? 0.15 : 0.05,
                weight: f.accepted ? 2 : 1,
                dashArray: f.accepted ? undefined : '5,5',
              }}
            >
              <Tooltip>
                <span className="text-xs">
                  <strong>{f.name}</strong>
                  <br />
                  {f.data.boundaryType as string} · {Math.round(f.confidence * 100)}%
                </span>
              </Tooltip>
            </Polygon>
          );
        })}

      {/* Routes */}
      {visible
        .filter((f) => f.type === 'route')
        .map((f) => {
          const waypoints = f.data.waypoints as [number, number][];
          if (!waypoints || waypoints.length < 2) return null;
          const color = ROUTE_COLORS[(f.data.routeType as string) || 'unknown'] || '#6b7280';
          return (
            <Polyline
              key={f.id}
              positions={waypoints}
              pathOptions={{
                color,
                weight: f.accepted ? 3 : 2,
                dashArray: f.accepted ? undefined : '8,4',
                opacity: f.accepted ? 0.8 : 0.4,
              }}
            >
              <Tooltip>
                <span className="text-xs">
                  <strong>{f.name}</strong>
                  <br />
                  {f.data.routeType as string} route · {Math.round(f.confidence * 100)}%
                </span>
              </Tooltip>
            </Polyline>
          );
        })}

      {/* Settlements */}
      {visible
        .filter((f) => f.type === 'settlement')
        .map((f) => {
          const lat = f.data.lat as number;
          const lng = f.data.lng as number;
          const color =
            SETTLEMENT_COLORS[(f.data.settlementType as string) || 'unknown'] || '#6b7280';
          return (
            <CircleMarker
              key={f.id}
              center={[lat, lng]}
              radius={f.accepted ? 6 : 4}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: f.accepted ? 0.8 : 0.3,
                weight: f.accepted ? 2 : 1,
              }}
            >
              <Tooltip>
                <span className="text-xs">
                  <strong>{f.name}</strong>
                  <br />
                  {f.data.settlementType as string} · {Math.round(f.confidence * 100)}%
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}

      {/* Labels */}
      {visible
        .filter((f) => f.type === 'label')
        .map((f) => {
          const lat = f.data.lat as number;
          const lng = f.data.lng as number;
          return (
            <CircleMarker
              key={f.id}
              center={[lat, lng]}
              radius={3}
              pathOptions={{
                color: '#059669',
                fillColor: '#059669',
                fillOpacity: f.accepted ? 0.7 : 0.2,
                weight: 1,
              }}
            >
              <Tooltip permanent={f.accepted} direction="right" offset={[8, 0]}>
                <span className={`text-[10px] ${f.accepted ? 'font-medium' : 'text-gray-500'}`}>
                  {f.name}
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}
    </>
  );
}
