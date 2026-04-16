import React, { useMemo } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  buildLeafletIconConfig,
  buildGroupedLegendEntries,
  CATEGORY_LABELS,
  type IconCategory,
  type MarkerIconOptions,
  type MarkerSize,
} from '../../../lib/visualization/map-icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapMarkerData {
  id: string;
  position: [number, number];
  /** Icon type key from the ICON_REGISTRY (e.g. 'city', 'battle', 'tomb') */
  iconType: string;
  /** Override the default icon color */
  color?: string;
  size?: MarkerSize | number;
  /** Count badge for grouped items */
  count?: number;
  opacity?: number;
  /** Popup content (JSX) */
  popupContent?: React.ReactNode;
  onClick?: () => void;
}

interface MapIconsLayerProps {
  markers: MapMarkerData[];
}

// ---------------------------------------------------------------------------
// Icon cache – avoid rebuilding identical Leaflet icons each render
// ---------------------------------------------------------------------------

const iconCache = new Map<string, L.Icon>();

function cacheKey(opts: MarkerIconOptions): string {
  return `${opts.type}|${opts.color ?? ''}|${typeof opts.size === 'number' ? opts.size : opts.size ?? 'md'}|${opts.count ?? 0}|${opts.opacity ?? 1}`;
}

function getOrCreateIcon(opts: MarkerIconOptions): L.Icon {
  const key = cacheKey(opts);
  let icon = iconCache.get(key);
  if (!icon) {
    const config = buildLeafletIconConfig(opts);
    icon = L.icon(config);
    iconCache.set(key, icon);
  }
  return icon;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapIconsLayer({ markers }: MapIconsLayerProps) {
  const leafletMarkers = useMemo(
    () =>
      markers.map((m) => ({
        ...m,
        icon: getOrCreateIcon({
          type: m.iconType,
          color: m.color,
          size: m.size,
          count: m.count,
          opacity: m.opacity,
        }),
      })),
    [markers],
  );

  if (leafletMarkers.length === 0) return null;

  return (
    <>
      {leafletMarkers.map((m) => (
        <Marker
          key={m.id}
          position={m.position}
          icon={m.icon}
          eventHandlers={m.onClick ? { click: m.onClick } : undefined}
        >
          {m.popupContent && <Popup>{m.popupContent}</Popup>}
        </Marker>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Icon Legend component
// ---------------------------------------------------------------------------

interface MapIconLegendProps {
  /** The icon types currently visible on the map */
  activeTypes: string[];
  /** Optional color overrides keyed by icon type */
  colorOverrides?: Record<string, string>;
}

export function MapIconLegend({ activeTypes, colorOverrides }: MapIconLegendProps) {
  const grouped = useMemo(
    () => buildGroupedLegendEntries(activeTypes, colorOverrides),
    [activeTypes, colorOverrides],
  );

  const nonEmptyCategories = (Object.keys(grouped) as IconCategory[]).filter(
    (cat) => grouped[cat].length > 0,
  );

  if (nonEmptyCategories.length === 0) return null;

  return (
    <div className="space-y-2">
      {nonEmptyCategories.map((cat) => (
        <div key={cat} className="space-y-1">
          <div className="text-xs font-medium text-gray-700">
            {CATEGORY_LABELS[cat]}
          </div>
          {grouped[cat].map((entry) => (
            <div key={entry.type} className="flex items-center gap-2">
              <img
                src={entry.svgDataUri}
                alt={entry.label}
                width={16}
                height={16}
                className="flex-shrink-0"
              />
              <span className="text-xs text-gray-600">{entry.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
