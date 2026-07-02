import React, { useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { computeCenter, computeBounds } from './geo-distribution-utils';
import type { GeoDataPoint, MarkerStyle, LegendItem } from './geo-distribution-utils';
import { BaseMapSelector } from './map-layers/BaseMapSelector';
import { useBaseMap } from './hooks/useBaseMap';
import 'leaflet/dist/leaflet.css';

export type { GeoDataPoint, MarkerStyle, LegendItem } from './geo-distribution-utils';

export interface GeoDistributionMapProps<T> {
  /** Array of data items to display on the map */
  data: T[];
  /** Extract a unique key from each item */
  getKey: (item: T) => string;
  /** Extract lat/lng coordinates from each item */
  getCoordinates: (item: T) => GeoDataPoint;
  /** Return marker style for an item (color, size, opacity) */
  getMarkerStyle: (item: T, isSelected: boolean) => MarkerStyle;
  /** Render popup content for an item */
  renderPopup: (item: T) => React.ReactNode;
  /** Called when a marker is clicked */
  onMarkerClick?: (item: T) => void;
  /** Check if an item is currently selected */
  isSelected?: (item: T) => boolean;
  /** Legend items to display */
  legend?: LegendItem[];
  /** Title for the legend */
  legendTitle?: string;
  /** Initial zoom level (default: 2) */
  initialZoom?: number;
  /** Whether to auto-fit bounds to data (default: true) */
  fitBounds?: boolean;
  /** Padding for fitBounds in pixels (default: 50) */
  fitBoundsPadding?: number;
  /** Empty state message */
  emptyMessage?: string;
  /** Empty state description */
  emptyDescription?: string;
  /** Additional CSS class for the container */
  className?: string;
}

// ============================================================================
// Sub-components
// ============================================================================

function FitBoundsController({ points, padding }: { points: GeoDataPoint[]; padding: number }) {
  const map = useMap();

  React.useEffect(() => {
    if (points.length > 0) {
      const bounds = computeBounds(points);
      map.fitBounds(bounds, { padding: [padding, padding] });
    }
  }, [points, map, padding]);

  return null;
}

function MapLegend({ items, title }: { items: LegendItem[]; title?: string }) {
  if (items.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg border shadow-sm p-3 max-h-[300px] overflow-y-auto">
      {title && <h4 className="text-xs font-semibold text-gray-700 mb-2">{title}</h4>}
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-gray-600">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function GeoDistributionMap<T>({
  data,
  getKey,
  getCoordinates,
  getMarkerStyle,
  renderPopup,
  onMarkerClick,
  isSelected,
  legend,
  legendTitle,
  initialZoom = 2,
  fitBounds = true,
  fitBoundsPadding = 50,
  emptyMessage = 'No geographic data available',
  emptyDescription = 'Items need coordinate data to be displayed on the map.',
  className = '',
}: GeoDistributionMapProps<T>) {
  const { baseMapId, baseMap, setBaseMap, availableMaps } = useBaseMap();

  const points = useMemo(
    () => data.map((item) => getCoordinates(item)),
    [data, getCoordinates]
  );

  const center = useMemo(() => computeCenter(points), [points]);

  const handleMarkerClick = useCallback(
    (item: T) => {
      onMarkerClick?.(item);
    },
    [onMarkerClick]
  );

  if (data.length === 0) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-gray-50 rounded-lg ${className}`}>
        <div className="text-center p-8">
          <p className="text-gray-600 mb-2">{emptyMessage}</p>
          <p className="text-sm text-gray-500">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full rounded-lg overflow-hidden relative ${className}`}>
      <MapContainer
        center={center}
        zoom={initialZoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          key={baseMap.id}
          attribution={baseMap.attribution}
          url={baseMap.url}
          maxZoom={baseMap.maxZoom}
        />

        {fitBounds && <FitBoundsController points={points} padding={fitBoundsPadding} />}

        {data.map((item) => {
          const key = getKey(item);
          const coords = getCoordinates(item);
          const selected = isSelected ? isSelected(item) : false;
          const style = getMarkerStyle(item, selected);

          return (
            <CircleMarker
              key={key}
              center={[coords.lat, coords.lng]}
              radius={style.radius}
              pathOptions={{
                fillColor: style.fillColor,
                fillOpacity: style.fillOpacity,
                color: style.color,
                weight: style.weight,
              }}
              eventHandlers={{
                click: () => handleMarkerClick(item),
              }}
            >
              <Popup>
                <div className="min-w-[200px]">
                  {renderPopup(item)}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {legend && legend.length > 0 && (
        <MapLegend items={legend} title={legendTitle} />
      )}

      <BaseMapSelector
        currentBaseMapId={baseMapId}
        availableMaps={availableMaps}
        onSelect={setBaseMap}
      />

      <div className="absolute bottom-4 left-14 z-[1000] text-xs text-gray-500 bg-white px-2 py-1 rounded border shadow-sm">
        Click markers to select · Drag to pan · Scroll to zoom
      </div>
    </div>
  );
}

export default GeoDistributionMap;
