/**
 * Map accessibility utilities: screen reader descriptions, ARIA live
 * announcements, high-contrast color palettes, and keyboard navigation helpers.
 */

// ---------------------------------------------------------------------------
// Screen Reader Feature Descriptions
// ---------------------------------------------------------------------------

export type MapFeatureType =
  | 'settlement'
  | 'civilization'
  | 'language-range'
  | 'archaeological-site'
  | 'route'
  | 'battle'
  | 'religion'
  | 'cuisine'
  | 'haplogroup'
  | 'deity'
  | 'urheimat';

export interface FeatureDescriptionInput {
  type: MapFeatureType;
  name: string;
  timeStart?: number | null;
  timeEnd?: number | null;
  extra?: Record<string, string | number | undefined>;
}

/**
 * Format a year for screen readers (e.g., -3500 → "3500 BCE", 476 → "476 CE").
 */
export function formatYearForSR(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

/**
 * Build a human-readable screen reader description for a map feature.
 */
export function describeFeature(input: FeatureDescriptionInput): string {
  const { type, name, timeStart, timeEnd, extra } = input;
  const typeName = type.replace(/-/g, ' ');

  let desc = `${capitalizeFirst(typeName)}: ${name}`;

  if (timeStart != null) {
    const startStr = formatYearForSR(timeStart);
    if (timeEnd != null) {
      desc += `, from ${startStr} to ${formatYearForSR(timeEnd)}`;
    } else {
      desc += `, from ${startStr} to present`;
    }
  }

  if (extra) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(extra)) {
      if (value != null && value !== '') {
        parts.push(`${key}: ${value}`);
      }
    }
    if (parts.length > 0) {
      desc += `. ${parts.join(', ')}`;
    }
  }

  return desc;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// ARIA Live Region Announcements
// ---------------------------------------------------------------------------

let liveRegion: HTMLDivElement | null = null;

/**
 * Get or create the ARIA live region for map announcements.
 */
function getOrCreateLiveRegion(): HTMLDivElement {
  if (liveRegion && document.body.contains(liveRegion)) return liveRegion;

  liveRegion = document.createElement('div');
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.className = 'sr-only';
  // Visually hidden but accessible to screen readers
  Object.assign(liveRegion.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  document.body.appendChild(liveRegion);
  return liveRegion;
}

/**
 * Announce a message to screen readers via ARIA live region.
 */
export function announceToScreenReader(message: string): void {
  if (typeof document === 'undefined') return;
  const region = getOrCreateLiveRegion();
  // Clear and re-set to trigger announcement even for repeated text
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

/**
 * Clean up the live region (call on unmount).
 */
export function removeLiveRegion(): void {
  if (liveRegion && document.body.contains(liveRegion)) {
    document.body.removeChild(liveRegion);
  }
  liveRegion = null;
}

// ---------------------------------------------------------------------------
// High-Contrast Mode Colors
// ---------------------------------------------------------------------------

/**
 * High-contrast palette suitable for low-vision users.
 * Each color pair provides foreground and background with WCAG AAA contrast.
 */
export const HIGH_CONTRAST_PALETTE = {
  // Layer colors in high-contrast mode
  languageRange: '#0000CC',
  civilization: '#CC0000',
  archaeologicalSite: '#006600',
  route: '#FF6600',
  settlement: '#000000',
  battle: '#CC0000',
  religion: '#6600CC',
  cuisine: '#008080',
  haplogroup: '#663300',
  deity: '#990099',
  urheimat: '#004D99',

  // UI elements
  selectedOutline: '#FFFF00',
  focusRing: '#FF8800',
  background: '#FFFFFF',
  foreground: '#000000',
  secondaryForeground: '#333333',
} as const;

/** Standard palette (matches existing theme colors for reference) */
export const STANDARD_PALETTE = {
  languageRange: '#3b82f6',
  civilization: '#ef4444',
  archaeologicalSite: '#22c55e',
  route: '#f97316',
  settlement: '#6366f1',
  battle: '#dc2626',
  religion: '#8b5cf6',
  cuisine: '#14b8a6',
  haplogroup: '#a16207',
  deity: '#d946ef',
  urheimat: '#0ea5e9',

  selectedOutline: '#fbbf24',
  focusRing: '#3b82f6',
  background: '#FFFFFF',
  foreground: '#1f2937',
  secondaryForeground: '#6b7280',
} as const;

export type MapColorPalette = typeof HIGH_CONTRAST_PALETTE | typeof STANDARD_PALETTE;

/**
 * Get the appropriate palette based on high-contrast mode.
 */
export function getMapPalette(highContrast: boolean): MapColorPalette {
  return highContrast ? HIGH_CONTRAST_PALETTE : STANDARD_PALETTE;
}

// ---------------------------------------------------------------------------
// Keyboard Navigation Helpers
// ---------------------------------------------------------------------------

export interface KeyboardNavAction {
  key: string;
  label: string;
  description: string;
}

/**
 * Map keyboard shortcut definitions for screen reader help dialogs.
 */
export const MAP_KEYBOARD_SHORTCUTS: KeyboardNavAction[] = [
  { key: 'Space', label: 'Play/Pause', description: 'Toggle timeline playback' },
  { key: 'ArrowLeft', label: 'Step Back', description: 'Move timeline one step backward' },
  { key: 'ArrowRight', label: 'Step Forward', description: 'Move timeline one step forward' },
  { key: 'Home', label: 'Jump to Start', description: 'Jump to the earliest time period' },
  { key: 'End', label: 'Jump to End', description: 'Jump to the latest time period' },
  { key: '+', label: 'Zoom In', description: 'Zoom into the map' },
  { key: '-', label: 'Zoom Out', description: 'Zoom out of the map' },
  { key: 'Tab', label: 'Next Control', description: 'Move focus to the next map control' },
  { key: 'Escape', label: 'Close Panel', description: 'Close the active info panel or menu' },
  { key: 'h', label: 'High Contrast', description: 'Toggle high-contrast mode' },
  { key: '?', label: 'Help', description: 'Show keyboard shortcuts help' },
];

/**
 * Feature-navigation shortcuts, active only while feature navigation mode is
 * engaged (press `n` to enter/exit). Kept separate from the timeline shortcuts
 * above because they rebind the arrow keys to spatial feature traversal.
 */
export const MAP_FEATURE_NAV_SHORTCUTS: KeyboardNavAction[] = [
  { key: 'n', label: 'Feature Navigation', description: 'Enter or exit keyboard navigation of map features' },
  { key: 'Arrow keys', label: 'Move Focus', description: 'Move focus to the nearest feature north/south/east/west' },
  { key: '[ / ]', label: 'Prev / Next Feature', description: 'Step to the previous or next feature in order' },
  { key: 'Home / End', label: 'First / Last Feature', description: 'Focus the first or last feature' },
  { key: 'Enter', label: 'Open Feature', description: 'Open the focused feature’s details' },
  { key: 'Escape', label: 'Exit Navigation', description: 'Leave feature navigation mode' },
];

/**
 * Build a summary description of the current map state for screen readers.
 */
export function describeMapState(params: {
  visibleLayerCount: number;
  featureCount: number;
  currentYear: number;
  isPlaying: boolean;
  zoom: number;
}): string {
  const { visibleLayerCount, featureCount, currentYear, isPlaying, zoom } = params;
  const yearStr = formatYearForSR(currentYear);
  const playStr = isPlaying ? 'Timeline is playing' : 'Timeline is paused';
  const zoomStr = zoom <= 3 ? 'world view' : zoom <= 6 ? 'regional view' : 'detailed view';

  return `Interactive historical map. ${visibleLayerCount} layers active with ${featureCount} features visible. Current year: ${yearStr}. ${playStr}. Zoom level: ${zoomStr}.`;
}
