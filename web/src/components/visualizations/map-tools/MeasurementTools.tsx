import React, { useCallback } from 'react';
import { useMapEvents, CircleMarker, Polyline, Polygon, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import {
  Ruler,
  PenTool,
  Navigation,
  Undo2,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import type { MeasurementToolReturn } from '../hooks/useMeasurementTool';
import type { MeasurementMode } from '../hooks/useMeasurementTool';
import {
  formatDistance,
  formatArea,
  formatTravelTime,
  TRAVEL_MODE_LABELS,
  type DistanceUnit,
  type TravelMode,
} from '../../../lib/visualization/measurement-utils';

// ============================================================================
// Map Layer (rendered inside MapContainer)
// ============================================================================

interface MeasurementLayerProps {
  measurement: MeasurementToolReturn;
}

export function MeasurementLayer({ measurement }: MeasurementLayerProps) {
  const { state, addPoint } = measurement;

  useMapEvents({
    click(e) {
      if (state.mode === 'none') return;
      addPoint([e.latlng.lng, e.latlng.lat]);
    },
  });

  if (state.mode === 'none') return null;

  const latLngs = state.points.map(
    (p) => [p[1], p[0]] as [number, number]
  );

  return (
    <>
      {/* Distance line */}
      {state.mode === 'distance' && latLngs.length >= 2 && (
        <Polyline
          positions={latLngs}
          pathOptions={{
            color: '#3b82f6',
            weight: 3,
            dashArray: '8,6',
          }}
        />
      )}

      {/* Area polygon */}
      {state.mode === 'area' && latLngs.length >= 3 && (
        <Polygon
          positions={latLngs}
          pathOptions={{
            color: '#8b5cf6',
            fillColor: '#8b5cf6',
            fillOpacity: 0.15,
            weight: 2,
          }}
        />
      )}

      {/* Isochrone rings */}
      {state.mode === 'isochrone' && state.isochroneResult && (
        <>
          {[...state.isochroneResult.rings].reverse().map((ring) => {
            const coords = ring.polygon.geometry.coordinates[0].map(
              (c) => [c[1], c[0]] as [number, number]
            );
            const opacity = 0.3 - (ring.hours / 100) * 0.2;
            return (
              <Polygon
                key={ring.hours}
                positions={coords}
                pathOptions={{
                  color: '#f59e0b',
                  fillColor: '#f59e0b',
                  fillOpacity: Math.max(0.05, opacity),
                  weight: 1.5,
                }}
              >
                <Tooltip permanent direction="center">
                  <span className="text-xs font-semibold">
                    {formatTravelTime(ring.hours)} · {formatDistance(ring.radiusKm, 'km')}
                  </span>
                </Tooltip>
              </Polygon>
            );
          })}
        </>
      )}

      {/* Point markers */}
      {latLngs.map((pos, i) => (
        <CircleMarker
          key={i}
          center={pos}
          radius={6}
          pathOptions={{
            color: '#fff',
            fillColor: state.mode === 'distance' ? '#3b82f6' : state.mode === 'area' ? '#8b5cf6' : '#f59e0b',
            fillOpacity: 1,
            weight: 2,
          }}
        >
          {state.mode === 'distance' && i > 0 && state.distanceResult && (
            <Tooltip permanent direction="top" offset={[0, -10]}>
              <span className="text-xs">
                {formatDistance(state.distanceResult.segments[i - 1].distance, state.unit)}
              </span>
            </Tooltip>
          )}
        </CircleMarker>
      ))}
    </>
  );
}

// ============================================================================
// Control Panel (rendered outside MapContainer)
// ============================================================================

interface MeasurementPanelProps {
  measurement: MeasurementToolReturn;
}

const MODE_BUTTONS: { mode: MeasurementMode; icon: React.ReactNode; label: string }[] = [
  { mode: 'distance', icon: <Ruler className="w-4 h-4" />, label: 'Distance' },
  { mode: 'area', icon: <PenTool className="w-4 h-4" />, label: 'Area' },
  { mode: 'isochrone', icon: <Navigation className="w-4 h-4" />, label: 'Isochrone' },
];

export function MeasurementPanel({ measurement }: MeasurementPanelProps) {
  const { state, setMode, setUnit, setTravelMode, removeLastPoint, clear, close } = measurement;

  const handleModeToggle = useCallback(
    (mode: MeasurementMode) => {
      setMode(state.mode === mode ? 'none' : mode);
    },
    [state.mode, setMode]
  );

  if (state.mode === 'none') {
    // Collapsed: show just the mode buttons
    return (
      <div className="absolute bottom-4 left-4 z-[1000] flex gap-1">
        {MODE_BUTTONS.map(({ mode, icon, label }) => (
          <Button
            key={mode}
            variant="outline"
            size="sm"
            className="bg-white shadow-md"
            onClick={() => handleModeToggle(mode)}
            title={label}
          >
            {icon}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Card className="absolute bottom-4 left-4 z-[1000] w-72 p-3 bg-white/95 backdrop-blur shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          {MODE_BUTTONS.map(({ mode, icon, label }) => (
            <Button
              key={mode}
              variant={state.mode === mode ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleModeToggle(mode)}
              title={label}
            >
              {icon}
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={close} title="Close">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Instructions */}
      <p className="text-xs text-muted-foreground mb-2">
        {state.mode === 'distance' && 'Click on the map to place measurement points.'}
        {state.mode === 'area' && 'Click to place polygon vertices (min 3).'}
        {state.mode === 'isochrone' && 'Click on the map to set center point.'}
      </p>

      {/* Unit selector (distance mode) */}
      {state.mode === 'distance' && (
        <div className="flex gap-1 mb-2">
          {(['km', 'miles'] as DistanceUnit[]).map((u) => (
            <Button
              key={u}
              variant={state.unit === u ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setUnit(u)}
            >
              {u === 'km' ? 'Kilometers' : 'Miles'}
            </Button>
          ))}
        </div>
      )}

      {/* Travel mode selector (isochrone mode) */}
      {state.mode === 'isochrone' && (
        <div className="flex flex-col gap-1 mb-2">
          {(['walking', 'horseback', 'ship'] as TravelMode[]).map((tm) => (
            <Button
              key={tm}
              variant={state.travelMode === tm ? 'default' : 'outline'}
              size="sm"
              className="text-xs justify-start"
              onClick={() => setTravelMode(tm)}
            >
              {TRAVEL_MODE_LABELS[tm]}
            </Button>
          ))}
        </div>
      )}

      {/* Results */}
      {state.mode === 'distance' && state.distanceResult && (
        <div className="bg-blue-50 rounded p-2 mb-2">
          <div className="text-sm font-semibold text-blue-900">
            Total: {formatDistance(state.distanceResult.totalDistance, state.unit)}
          </div>
          {state.distanceResult.segments.length > 1 && (
            <div className="text-xs text-blue-700 mt-1">
              {state.distanceResult.segments.length} segments
            </div>
          )}
        </div>
      )}

      {state.mode === 'area' && state.areaResult && state.areaResult.area > 0 && (
        <div className="bg-purple-50 rounded p-2 mb-2">
          <div className="text-sm font-semibold text-purple-900">
            Area: {formatArea(state.areaResult.area)}
          </div>
          <div className="text-xs text-purple-700 mt-1">
            {state.areaResult.areaSqMiles.toFixed(1)} sq mi · Perimeter: {formatDistance(state.areaResult.perimeter, 'km')}
          </div>
        </div>
      )}

      {state.mode === 'isochrone' && state.isochroneResult && (
        <div className="bg-amber-50 rounded p-2 mb-2">
          <div className="text-sm font-semibold text-amber-900">
            Travel Isochrones
          </div>
          <div className="text-xs text-amber-700 mt-1 space-y-0.5">
            {state.isochroneResult.rings.map((ring) => (
              <div key={ring.hours}>
                {formatTravelTime(ring.hours)}: {formatDistance(ring.radiusKm, 'km')} radius
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1">
        {state.points.length > 0 && (
          <>
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={removeLastPoint}>
              <Undo2 className="w-3 h-3 mr-1" /> Undo
            </Button>
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={clear}>
              <Trash2 className="w-3 h-3 mr-1" /> Clear
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
