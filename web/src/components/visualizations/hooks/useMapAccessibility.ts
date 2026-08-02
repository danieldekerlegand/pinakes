import { useState, useCallback, useEffect } from 'react';
import {
  announceToScreenReader,
  removeLiveRegion,
  getMapPalette,
  describeMapState,
  formatYearForSR,
  MAP_KEYBOARD_SHORTCUTS,
} from '../../../lib/visualization/map-accessibility';
import type { MapColorPalette } from '../../../lib/visualization/map-accessibility';

export interface MapAccessibilityState {
  highContrast: boolean;
  showKeyboardHelp: boolean;
}

/**
 * Hook providing map accessibility features: high-contrast mode toggle,
 * screen reader announcements, and keyboard help dialog state.
 */
export function useMapAccessibility() {
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('map-high-contrast') === 'true';
  });
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  // Persist high-contrast preference
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('map-high-contrast', String(highContrast));
    }
  }, [highContrast]);

  // Clean up live region on unmount
  useEffect(() => {
    return () => removeLiveRegion();
  }, []);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => {
      const next = !prev;
      announceToScreenReader(next ? 'High contrast mode enabled' : 'High contrast mode disabled');
      return next;
    });
  }, []);

  const toggleKeyboardHelp = useCallback(() => {
    setShowKeyboardHelp((prev) => !prev);
  }, []);

  const palette: MapColorPalette = getMapPalette(highContrast);

  const announce = useCallback((message: string) => {
    announceToScreenReader(message);
  }, []);

  /**
   * Announce the current year when the time slider changes.
   * Debounced internally — call freely on each year change.
   */
  const announceYear = useCallback((year: number) => {
    announceToScreenReader(`Year: ${formatYearForSR(year)}`);
  }, []);

  /**
   * Announce a summary of the current map state.
   */
  const announceMapState = useCallback(
    (params: Parameters<typeof describeMapState>[0]) => {
      announceToScreenReader(describeMapState(params));
    },
    []
  );

  /**
   * Handle accessibility keyboard shortcuts (h = high-contrast, ? = help).
   * Call this from the map's keydown handler.
   */
  const handleAccessibilityKey = useCallback(
    (e: KeyboardEvent): boolean => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return false;
      }

      if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleHighContrast();
        return true;
      }

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        toggleKeyboardHelp();
        return true;
      }

      if (e.key === 'Escape' && showKeyboardHelp) {
        setShowKeyboardHelp(false);
        return true;
      }

      return false;
    },
    [toggleHighContrast, toggleKeyboardHelp, showKeyboardHelp]
  );

  return {
    highContrast,
    showKeyboardHelp,
    palette,
    toggleHighContrast,
    toggleKeyboardHelp,
    announce,
    announceYear,
    announceMapState,
    handleAccessibilityKey,
    keyboardShortcuts: MAP_KEYBOARD_SHORTCUTS,
  };
}
