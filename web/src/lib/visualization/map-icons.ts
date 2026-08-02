/**
 * Custom map marker and icon system.
 *
 * Provides SVG icon definitions for settlement types, event types,
 * cultural markers, and route waypoints. Supports size scaling,
 * color theming, and optional count badges.
 *
 * All SVG paths use a 24x24 viewBox coordinate system.
 */

// ---------------------------------------------------------------------------
// Icon categories
// ---------------------------------------------------------------------------

export type IconCategory = 'settlement' | 'event' | 'cultural' | 'waypoint';

export interface IconDefinition {
  /** SVG path data (24x24 viewBox) */
  path: string;
  /** Human-readable label */
  label: string;
  /** Category for grouping in legends */
  category: IconCategory;
  /** Default color (hex) */
  defaultColor: string;
}

// ---------------------------------------------------------------------------
// Settlement type icons
// ---------------------------------------------------------------------------

const SETTLEMENT_ICONS: Record<string, IconDefinition> = {
  city: {
    path: 'M3 21V7l6-4 6 4v2h6v12H3zm2-2h2v-2H5v2zm0-4h2v-2H5v2zm0-4h2V9H5v2zm6 8h2v-2h-2v2zm0-4h2v-2h-2v2zm0-4h2V9h-2v2zm6 8h2v-2h-2v2zm0-4h2v-2h-2v2z',
    label: 'City',
    category: 'settlement',
    defaultColor: '#f59e0b',
  },
  village: {
    path: 'M12 3L2 12h3v8h5v-5h4v5h5v-8h3L12 3z',
    label: 'Village',
    category: 'settlement',
    defaultColor: '#84cc16',
  },
  port: {
    path: 'M20 21c-1.5 0-2.7-.4-3.6-1-1 .6-2.2 1-3.4 1s-2.4-.4-3.4-1c-.9.6-2.1 1-3.6 1H4v-2h2c1 0 1.8-.3 2.5-.7C9.2 18.7 10 19 11 19h2c1 0 1.8-.3 2.5-.7.7.4 1.5.7 2.5.7h2v2h-2zM12 3l-7 9h4v4h6v-4h4L12 3z',
    label: 'Port',
    category: 'settlement',
    defaultColor: '#3b82f6',
  },
  fortress: {
    path: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 3l5 1.88v4.21c0 3.73-2.46 7.2-5 8.18V5z',
    label: 'Fortress',
    category: 'settlement',
    defaultColor: '#64748b',
  },
  temple: {
    path: 'M12 2L6 7v1H4v2h1v8H4v2h16v-2h-1v-8h1V8h-2V7l-6-5zm-2 8h4v8h-4v-8zm-3 0h1v8H7v-8zm8 0h2v8h-2v-8z',
    label: 'Temple',
    category: 'settlement',
    defaultColor: '#8b5cf6',
  },
  mine: {
    path: 'M17.62 3.84c-.5-.24-1.1-.04-1.34.46L12 13.38 7.72 4.3c-.24-.5-.84-.7-1.34-.46-.5.24-.7.84-.46 1.34l5.38 11.38H8v2h8v-2h-3.3l5.38-11.38c.24-.5.04-1.1-.46-1.34zM6 20h12v2H6v-2z',
    label: 'Mine',
    category: 'settlement',
    defaultColor: '#92400e',
  },
  farm: {
    path: 'M12 3C7 3 3 7 3 12h2c0-3.87 3.13-7 7-7s7 3.13 7 7h2c0-5-4-9-9-9zm0 4c-2.76 0-5 2.24-5 5h2c0-1.66 1.34-3 3-3s3 1.34 3 3h2c0-2.76-2.24-5-5-5zm0 4c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1zm7 5H5c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1h14c.55 0 1-.45 1-1v-2c0-.55-.45-1-1-1z',
    label: 'Farm',
    category: 'settlement',
    defaultColor: '#16a34a',
  },
};

// ---------------------------------------------------------------------------
// Event type icons
// ---------------------------------------------------------------------------

const EVENT_ICONS: Record<string, IconDefinition> = {
  battle: {
    path: 'M7.05 3.5L3.5 7.05l4.24 4.24-4.24 4.24L7.05 19.1l4.24-4.24 4.24 4.24 3.54-3.54-4.24-4.24 4.24-4.24L15.53 3.5l-4.24 4.24L7.05 3.5z',
    label: 'Battle',
    category: 'event',
    defaultColor: '#ef4444',
  },
  treaty: {
    path: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
    label: 'Treaty',
    category: 'event',
    defaultColor: '#ec4899',
  },
  'natural-disaster': {
    path: 'M7 17h2l1-4 2 6 2-8 1.5 6H18l-1.24-3.32L14 5l-2.5 8L10 7 7 17zM2 19h20v2H2v-2z',
    label: 'Natural Disaster',
    category: 'event',
    defaultColor: '#f97316',
  },
};

// ---------------------------------------------------------------------------
// Cultural marker icons
// ---------------------------------------------------------------------------

const CULTURAL_ICONS: Record<string, IconDefinition> = {
  'pottery-find': {
    path: 'M12 2C9 2 7 4 7 7v3c0 2 1 3 2 4v3c0 1 1 2 3 2s3-1 3-2v-3c1-1 2-2 2-4V7c0-3-2-5-5-5zm3 8c0 1.5-1 2.5-1.5 3l-.5.5V17c0 .5-.5 1-1 1s-1-.5-1-1v-3.5l-.5-.5C9.5 12.5 9 11.5 9 10V7c0-2 1.5-3 3-3s3 1 3 3v3z',
    label: 'Pottery Find',
    category: 'cultural',
    defaultColor: '#d97706',
  },
  'inscription-find': {
    path: 'M3 3v18h18V3H3zm16 16H5V5h14v14zM7 7h4v2H7V7zm0 4h10v2H7v-2zm0 4h10v2H7v-2zm6-8h4v2h-4V7z',
    label: 'Inscription Find',
    category: 'cultural',
    defaultColor: '#2563eb',
  },
  tomb: {
    path: 'M12 2l-8 6v1h2v11h12V9h2V8l-8-6zm4 16h-3v-4h-2v4H8V9.5l4-3 4 3V18z',
    label: 'Tomb',
    category: 'cultural',
    defaultColor: '#6b7280',
  },
};

// ---------------------------------------------------------------------------
// Route waypoint icons
// ---------------------------------------------------------------------------

const WAYPOINT_ICONS: Record<string, IconDefinition> = {
  waypoint: {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z',
    label: 'Waypoint',
    category: 'waypoint',
    defaultColor: '#14b8a6',
  },
  'waypoint-start': {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 2c2.76 0 5 2.24 5 5 0 2.88-2.5 6.85-5 10.17C9.5 15.85 7 11.88 7 9c0-2.76 2.24-5 5-5zm-1 3v5l4-2.5L11 7z',
    label: 'Start',
    category: 'waypoint',
    defaultColor: '#22c55e',
  },
  'waypoint-end': {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 2c2.76 0 5 2.24 5 5 0 2.88-2.5 6.85-5 10.17C9.5 15.85 7 11.88 7 9c0-2.76 2.24-5 5-5zm-2 3v4h4V7h-4z',
    label: 'End',
    category: 'waypoint',
    defaultColor: '#ef4444',
  },
};

// ---------------------------------------------------------------------------
// Unified icon registry
// ---------------------------------------------------------------------------

export const ICON_REGISTRY: Record<string, IconDefinition> = {
  ...SETTLEMENT_ICONS,
  ...EVENT_ICONS,
  ...CULTURAL_ICONS,
  ...WAYPOINT_ICONS,
};

/** Get an icon definition by type key, with optional fallback */
export function getIconDefinition(type: string): IconDefinition | undefined {
  return ICON_REGISTRY[type];
}

/** List all icon types within a given category */
export function getIconsByCategory(category: IconCategory): Array<{ type: string; icon: IconDefinition }> {
  return Object.entries(ICON_REGISTRY)
    .filter(([, def]) => def.category === category)
    .map(([type, icon]) => ({ type, icon }));
}

/** All available categories */
export const ICON_CATEGORIES: IconCategory[] = ['settlement', 'event', 'cultural', 'waypoint'];

/** Category display labels */
export const CATEGORY_LABELS: Record<IconCategory, string> = {
  settlement: 'Settlements',
  event: 'Events',
  cultural: 'Cultural Finds',
  waypoint: 'Route Waypoints',
};

// ---------------------------------------------------------------------------
// Size scaling
// ---------------------------------------------------------------------------

export type MarkerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<MarkerSize, number> = {
  xs: 16,
  sm: 20,
  md: 28,
  lg: 36,
  xl: 48,
};

/** Convert a named size to pixel dimension */
export function getMarkerSizePx(size: MarkerSize): number {
  return SIZE_PX[size];
}

/** Compute marker size from a numeric value (e.g. population) */
export function scaleMarkerSize(
  value: number,
  minValue: number,
  maxValue: number,
  minSize: MarkerSize = 'sm',
  maxSize: MarkerSize = 'xl',
): number {
  const range = maxValue - minValue;
  if (range <= 0) return SIZE_PX[minSize];
  const t = Math.max(0, Math.min(1, (value - minValue) / range));
  return SIZE_PX[minSize] + t * (SIZE_PX[maxSize] - SIZE_PX[minSize]);
}

// ---------------------------------------------------------------------------
// SVG generation helpers
// ---------------------------------------------------------------------------

export interface MarkerIconOptions {
  type: string;
  color?: string;
  size?: MarkerSize | number;
  count?: number;
  opacity?: number;
}

/** Build a complete SVG string for a map marker icon */
export function buildMarkerSvg(options: MarkerIconOptions): string {
  const def = ICON_REGISTRY[options.type];
  if (!def) return buildFallbackSvg(options);

  const color = options.color ?? def.defaultColor;
  const sizePx = typeof options.size === 'number'
    ? options.size
    : getMarkerSizePx(options.size ?? 'md');
  const opacity = options.opacity ?? 1;

  const badge = options.count != null && options.count > 1
    ? buildBadgeSvg(options.count, sizePx)
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24">`,
    `<circle cx="12" cy="12" r="11" fill="white" fill-opacity="${0.9 * opacity}" stroke="${color}" stroke-width="1.5"/>`,
    `<path d="${def.path}" fill="${color}" fill-opacity="${opacity}"/>`,
    badge,
    '</svg>',
  ].join('');
}

function buildFallbackSvg(options: MarkerIconOptions): string {
  const color = options.color ?? '#9ca3af';
  const sizePx = typeof options.size === 'number'
    ? options.size
    : getMarkerSizePx(options.size ?? 'md');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24">`,
    `<circle cx="12" cy="12" r="10" fill="${color}" fill-opacity="0.6" stroke="${color}" stroke-width="1.5"/>`,
    `<circle cx="12" cy="12" r="3" fill="white"/>`,
    '</svg>',
  ].join('');
}

function buildBadgeSvg(count: number, parentSize: number): string {
  const text = count > 99 ? '99+' : String(count);
  const badgeR = parentSize < 24 ? 5 : 6;
  // Position badge at top-right
  const cx = 21;
  const cy = 3;
  return [
    `<circle cx="${cx}" cy="${cy}" r="${badgeR}" fill="#ef4444" stroke="white" stroke-width="1"/>`,
    `<text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="7" font-weight="bold" font-family="sans-serif">${text}</text>`,
  ].join('');
}

/** Convert an SVG string to a data URI for use as a Leaflet icon URL */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** Build a data URI icon ready for Leaflet's L.icon */
export function buildMarkerIconUri(options: MarkerIconOptions): string {
  return svgToDataUri(buildMarkerSvg(options));
}

// ---------------------------------------------------------------------------
// Leaflet icon dimensions helper
// ---------------------------------------------------------------------------

export interface LeafletIconConfig {
  iconUrl: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
}

/** Build a complete Leaflet icon configuration object */
export function buildLeafletIconConfig(options: MarkerIconOptions): LeafletIconConfig {
  const sizePx = typeof options.size === 'number'
    ? options.size
    : getMarkerSizePx(options.size ?? 'md');

  return {
    iconUrl: buildMarkerIconUri(options),
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
    popupAnchor: [0, -sizePx / 2],
  };
}

// ---------------------------------------------------------------------------
// Legend helpers
// ---------------------------------------------------------------------------

export interface LegendEntry {
  type: string;
  label: string;
  category: IconCategory;
  color: string;
  svgDataUri: string;
}

/** Generate legend entries for a set of active icon types */
export function buildLegendEntries(activeTypes: string[], colorOverrides?: Record<string, string>): LegendEntry[] {
  return activeTypes
    .map((type) => {
      const def = ICON_REGISTRY[type];
      if (!def) return null;
      const color = colorOverrides?.[type] ?? def.defaultColor;
      return {
        type,
        label: def.label,
        category: def.category,
        color,
        svgDataUri: buildMarkerIconUri({ type, color, size: 'sm' }),
      };
    })
    .filter((e): e is LegendEntry => e !== null);
}

/** Generate legend entries grouped by category */
export function buildGroupedLegendEntries(
  activeTypes: string[],
  colorOverrides?: Record<string, string>,
): Record<IconCategory, LegendEntry[]> {
  const entries = buildLegendEntries(activeTypes, colorOverrides);
  const grouped: Record<IconCategory, LegendEntry[]> = {
    settlement: [],
    event: [],
    cultural: [],
    waypoint: [],
  };
  for (const entry of entries) {
    grouped[entry.category].push(entry);
  }
  return grouped;
}
