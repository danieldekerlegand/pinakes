import React, { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
  value?: number;
  category: string;
  id?: string;
  metadata?: Record<string, any>;
}

export interface GeoDistributionMapProps {
  points: GeoPoint[];
  colorScale?: (category: string) => string;
  onPointClick?: (point: GeoPoint) => void;
  selectedPointId?: string | null;
  height?: number;
  className?: string;
  showLegend?: boolean;
  renderPopup?: (point: GeoPoint) => React.ReactNode;
}

const DEFAULT_COLORS: Record<string, string> = {};
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];
let colorIdx = 0;

function defaultColorScale(category: string): string {
  if (!DEFAULT_COLORS[category]) {
    DEFAULT_COLORS[category] = PALETTE[colorIdx % PALETTE.length];
    colorIdx++;
  }
  return DEFAULT_COLORS[category];
}

function AutoBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();

  useMemo(() => {
    if (points.length === 0) return;
    const bounds = points.map(p => [p.lat, p.lng] as [number, number]);
    if (bounds.length === 1) {
      map.setView(bounds[0], 5);
    } else {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
    }
  }, [points, map]);

  return null;
}

export function GeoDistributionMap({
  points,
  colorScale = defaultColorScale,
  onPointClick,
  selectedPointId,
  height = 300,
  className = '',
  showLegend = true,
  renderPopup,
}: GeoDistributionMapProps) {
  const categories = useMemo(() => {
    const cats = new Set<string>();
    points.forEach(p => cats.add(p.category));
    return Array.from(cats).sort();
  }, [points]);

  const center: [number, number] = useMemo(() => {
    if (points.length === 0) return [20, 0];
    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    return [avgLat, avgLng];
  }, [points]);

  return (
    <div className={`relative ${className}`} style={{ height }}>
      <MapContainer
        center={center}
        zoom={2}
        style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <AutoBounds points={points} />
        {points.map((point, idx) => {
          const isSelected = selectedPointId != null && point.id === selectedPointId;
          const color = colorScale(point.category);
          return (
            <CircleMarker
              key={point.id || `${point.lat}-${point.lng}-${idx}`}
              center={[point.lat, point.lng]}
              radius={isSelected ? 10 : 7}
              pathOptions={{
                fillColor: isSelected ? '#3b82f6' : color,
                fillOpacity: isSelected ? 0.9 : 0.7,
                color: isSelected ? '#1d4ed8' : '#fff',
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={{
                click: () => onPointClick?.(point),
              }}
            >
              <Popup>
                {renderPopup ? renderPopup(point) : (
                  <div className="min-w-[160px] p-1">
                    <div className="font-semibold text-sm">{point.label}</div>
                    <div className="text-xs text-gray-500">{point.category}</div>
                    {point.value != null && (
                      <div className="text-xs text-gray-600">Value: {point.value}</div>
                    )}
                  </div>
                )}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {showLegend && categories.length > 1 && (
        <div className="absolute bottom-2 left-2 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow text-xs space-y-1 max-h-[120px] overflow-y-auto">
          {categories.map(cat => (
            <div key={cat} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: colorScale(cat) }}
              />
              <span className="text-gray-700 truncate">{cat}</span>
            </div>
          ))}
        </div>
      )}

      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm z-[1000]">
          No geographic data to display
        </div>
      )}
    </div>
  );
}

export default GeoDistributionMap;
