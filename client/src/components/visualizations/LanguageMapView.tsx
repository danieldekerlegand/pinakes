import React, { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { useVisualization } from '../../contexts/VisualizationContext';
import type { MapPoint } from '../../lib/visualization/types';
import { getFamilyColor, formatNumber } from '../../lib/visualization/d3-helpers';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import 'leaflet/dist/leaflet.css';

interface LanguageMapViewProps {
  mapData: MapPoint[];
  onMarkerClick?: (id: string) => void;
}

// Component to fit bounds when data changes
function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();

  React.useEffect(() => {
    if (points.length > 0) {
      const bounds: [number, number][] = points.map((p) => [p.lat, p.lng]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [points, map]);

  return null;
}

export function LanguageMapView({ mapData, onMarkerClick }: LanguageMapViewProps) {
  const { isLanguageSelected, selectLanguage } = useVisualization();

  // Calculate marker size based on speakers
  const getMarkerRadius = (speakers?: number) => {
    if (!speakers) return 6;
    if (speakers > 100_000_000) return 15;
    if (speakers > 10_000_000) return 12;
    if (speakers > 1_000_000) return 9;
    if (speakers > 100_000) return 7;
    return 5;
  };

  // Convert hex color to RGB for opacity
  const colorWithOpacity = (hexColor: string, opacity: number = 0.7) => {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const centerPosition = useMemo<[number, number]>(() => {
    if (mapData.length === 0) return [20, 0];

    const avgLat = mapData.reduce((sum, p) => sum + p.lat, 0) / mapData.length;
    const avgLng = mapData.reduce((sum, p) => sum + p.lng, 0) / mapData.length;
    return [avgLat, avgLng];
  }, [mapData]);

  if (mapData.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center p-8">
          <p className="text-gray-600 mb-2">No geographic data available</p>
          <p className="text-sm text-gray-500">
            Languages need coordinate data to be displayed on the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-lg overflow-hidden relative">
      <MapContainer
        center={centerPosition}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds points={mapData} />

        {mapData.map((point) => {
          const color = getFamilyColor(point.familyId);
          const radius = getMarkerRadius(point.totalSpeakers);
          const selected = isLanguageSelected(point.id);

          return (
            <CircleMarker
              key={point.id}
              center={[point.lat, point.lng]}
              radius={selected ? radius * 1.5 : radius}
              pathOptions={{
                fillColor: selected ? '#3b82f6' : color,
                fillOpacity: selected ? 0.9 : 0.7,
                color: selected ? '#1d4ed8' : '#fff',
                weight: selected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => {
                  if (onMarkerClick) {
                    onMarkerClick(point.id);
                  } else {
                    selectLanguage(point.id);
                  }
                },
              }}
            >
              <Popup>
                <div className="p-2 min-w-[220px]">
                  <h3 className="font-bold text-base mb-1">{point.name}</h3>
                  {point.nativeName && (
                    <p className="text-sm text-gray-600 mb-2">({point.nativeName})</p>
                  )}

                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Family:</span>
                      <span className="font-medium">{point.familyName}</span>
                    </div>

                    {point.region && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Region:</span>
                        <span className="font-medium">{point.region}</span>
                      </div>
                    )}

                    {point.countries && point.countries.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Countries:</span>
                        <span className="font-medium text-right max-w-[140px] truncate" title={point.countries.join(', ')}>
                          {point.countries.slice(0, 2).join(', ')}
                          {point.countries.length > 2 && ` +${point.countries.length - 2}`}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between">
                      <span className="text-gray-600">Status:</span>
                      <Badge variant="outline" className="text-xs">
                        {point.status}
                      </Badge>
                    </div>

                    {point.totalSpeakers && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Speakers:</span>
                        <span className="font-medium">{formatNumber(point.totalSpeakers)}</span>
                      </div>
                    )}

                    {(point.iso639_1 || point.iso639_2) && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">ISO Code:</span>
                        <span className="font-medium font-mono text-xs">
                          {point.iso639_1 || point.iso639_2}
                        </span>
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    className="w-full mt-3"
                    onClick={() => {
                      if (onMarkerClick) {
                        onMarkerClick(point.id);
                      } else {
                        selectLanguage(point.id);
                      }
                    }}
                  >
                    View Details
                  </Button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <div className="absolute bottom-4 left-4 z-[1000] text-xs text-gray-500 bg-white px-2 py-1 rounded border shadow-sm">
        Click markers to select • Drag to pan • Scroll to zoom
      </div>
    </div>
  );
}
