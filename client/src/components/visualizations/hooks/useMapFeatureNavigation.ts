import { useState, useCallback, useRef, useEffect } from 'react';
import {
  applyTraversal,
  decodeTraversalKey,
  announceFeatureFocus,
  type NavigableFeature,
} from '../../../lib/visualization/map-feature-traversal';
import { announceToScreenReader } from '../../../lib/visualization/map-accessibility';

export interface UseMapFeatureNavigationOptions {
  /** Called when the user activates (Enter/Space) the focused feature. */
  onSelect?: (feature: NavigableFeature) => void;
  /** Called when navigation mode is entered or exited. */
  onModeChange?: (active: boolean) => void;
}

export interface UseMapFeatureNavigationReturn {
  /** Whether keyboard feature-navigation mode is currently engaged. */
  navActive: boolean;
  /** The id of the feature that currently holds keyboard focus, if any. */
  focusedId: string | null;
  /** Enter navigation mode (focuses the first feature if none is focused). */
  enterNav: () => void;
  /** Leave navigation mode (keeps the last focused id for re-entry). */
  exitNav: () => void;
  /**
   * Handle a keydown while a map feature layer is active. Returns true if the
   * event was consumed (caller should preventDefault + stop other handlers).
   */
  handleFeatureNavKey: (e: KeyboardEvent) => boolean;
}

/**
 * Roving keyboard navigation across interactive map features.
 *
 * Wraps the pure traversal logic in `map-feature-traversal.ts` with the small
 * amount of React state it needs (mode toggle + focused id) and screen-reader
 * announcements. Arrow keys move spatially, `[`/`]`/Home/End step
 * sequentially, Enter selects, Escape (or `n`) exits. The `features` array is
 * read through a ref so the returned handler stays stable across renders while
 * always seeing the latest feature list.
 */
export function useMapFeatureNavigation(
  features: readonly NavigableFeature[],
  options: UseMapFeatureNavigationOptions = {},
): UseMapFeatureNavigationReturn {
  const [navActive, setNavActive] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const featuresRef = useRef(features);
  featuresRef.current = features;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const focusedRef = useRef<string | null>(null);
  focusedRef.current = focusedId;

  const setMode = useCallback((active: boolean) => {
    setNavActive(active);
    optionsRef.current.onModeChange?.(active);
  }, []);

  const focusFeature = useCallback((feature: NavigableFeature) => {
    setFocusedId(feature.id);
    focusedRef.current = feature.id;
    announceToScreenReader(announceFeatureFocus(feature, featuresRef.current));
  }, []);

  const enterNav = useCallback(() => {
    setMode(true);
    const list = featuresRef.current;
    if (list.length === 0) {
      announceToScreenReader('Feature navigation on. No features to navigate.');
      return;
    }
    const current = list.find((f) => f.id === focusedRef.current);
    if (current) {
      announceToScreenReader('Feature navigation on. ' + announceFeatureFocus(current, list));
    } else {
      const seeded = applyTraversal(list, null, { kind: 'sequential', step: 'first' });
      if (seeded) {
        announceToScreenReader('Feature navigation on. ' + announceFeatureFocus(seeded, list));
        setFocusedId(seeded.id);
        focusedRef.current = seeded.id;
      }
    }
  }, [setMode]);

  const exitNav = useCallback(() => {
    setMode(false);
    announceToScreenReader('Feature navigation off.');
  }, [setMode]);

  const handleFeatureNavKey = useCallback(
    (e: KeyboardEvent): boolean => {
      // Never hijack typing.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return false;
      }

      // `n` toggles navigation mode (no modifiers).
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (navActive) exitNav();
        else enterNav();
        return true;
      }

      if (!navActive) return false;

      const intent = decodeTraversalKey(e.key, { shiftKey: e.shiftKey });
      if (!intent) return false;

      if (intent.kind === 'exit') {
        exitNav();
        return true;
      }

      if (intent.kind === 'select') {
        const list = featuresRef.current;
        const current = list.find((f) => f.id === focusedRef.current);
        if (current) optionsRef.current.onSelect?.(current);
        return true;
      }

      const next = applyTraversal(featuresRef.current, focusedRef.current, intent);
      if (next) {
        focusFeature(next);
      } else {
        // At an edge: keep focus, but tell the user there's nothing there.
        announceToScreenReader('No feature in that direction.');
      }
      return true;
    },
    [navActive, enterNav, exitNav, focusFeature],
  );

  // If the focused feature disappears (e.g. filtered out by the timeline),
  // drop stale focus so the next key press re-seeds cleanly.
  useEffect(() => {
    if (focusedId && !features.some((f) => f.id === focusedId)) {
      setFocusedId(null);
    }
  }, [features, focusedId]);

  return { navActive, focusedId, enterNav, exitNav, handleFeatureNavKey };
}
