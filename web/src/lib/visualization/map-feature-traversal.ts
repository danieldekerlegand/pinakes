/**
 * Pure keyboard-traversal logic for interactive map features.
 *
 * Given a flat list of navigable features (each carrying a geographic
 * position), these helpers compute which feature should receive focus next in
 * response to an arrow-key / Home / End / Tab intent. Everything here is pure
 * and deterministic so it can be unit-tested in the node vitest environment
 * without a DOM; the React hook + component layers are responsible for wiring
 * DOM focus indicators and screen-reader announcements to these results.
 *
 * See useMapAccessibility.ts for the hook that consumes this module and
 * map-accessibility.ts for the screen-reader description helpers.
 */

import { describeFeature } from './map-accessibility';
import type { MapFeatureType } from './map-accessibility';

/**
 * A single interactive map feature that can hold keyboard focus.
 * `lat`/`lng` are the representative point used for spatial (arrow-key)
 * navigation; sequential (Tab) navigation only needs a stable order.
 */
export interface NavigableFeature {
  id: string;
  name: string;
  type: MapFeatureType;
  lat: number;
  lng: number;
  timeStart?: number | null;
  timeEnd?: number | null;
  extra?: Record<string, string | number | undefined>;
}

/** Compass directions for spatial arrow-key traversal. */
export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

/** Sequential (roving) traversal steps. */
export type SequentialStep = 'next' | 'prev' | 'first' | 'last';

/**
 * A resolved traversal intent decoded from a keyboard event, independent of
 * which physical key produced it.
 */
export type TraversalIntent =
  | { kind: 'spatial'; direction: SpatialDirection }
  | { kind: 'sequential'; step: SequentialStep }
  | { kind: 'select' }
  | { kind: 'exit' };

/**
 * Weight applied to cross-axis distance when scoring spatial candidates. A
 * value > 1 biases selection toward features that stay close to the current
 * feature's cross-axis position (i.e. a straighter line in the pressed
 * direction) rather than ones that drift far sideways.
 */
const CROSS_AXIS_PENALTY = 2.5;

/**
 * Deterministically order features for sequential (Tab / next / prev)
 * traversal: north-to-south (lat desc), then west-to-east (lng asc), then by
 * id as a stable tie-breaker. Returns a new array; the input is not mutated.
 */
export function orderFeatures(features: readonly NavigableFeature[]): NavigableFeature[] {
  return [...features].sort((a, b) => {
    if (a.lat !== b.lat) return b.lat - a.lat;
    if (a.lng !== b.lng) return a.lng - b.lng;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function indexOfId(ordered: readonly NavigableFeature[], id: string | null): number {
  if (id == null) return -1;
  return ordered.findIndex((f) => f.id === id);
}

/**
 * Resolve a sequential step to the next feature, wrapping at the ends. When no
 * feature is currently focused, `next`/`first` land on the first item and
 * `prev`/`last` on the last. Returns null only for an empty list.
 */
export function sequentialTarget(
  features: readonly NavigableFeature[],
  currentId: string | null,
  step: SequentialStep,
): NavigableFeature | null {
  const ordered = orderFeatures(features);
  if (ordered.length === 0) return null;

  if (step === 'first') return ordered[0];
  if (step === 'last') return ordered[ordered.length - 1];

  const idx = indexOfId(ordered, currentId);
  if (idx === -1) {
    return step === 'next' ? ordered[0] : ordered[ordered.length - 1];
  }

  const delta = step === 'next' ? 1 : -1;
  const nextIdx = (idx + delta + ordered.length) % ordered.length;
  return ordered[nextIdx];
}

/**
 * Resolve a spatial (arrow-key) direction to the nearest feature that lies in
 * that direction from the currently focused feature. Uses a directional
 * scoring function: candidates must be strictly beyond the current feature on
 * the primary axis, and are ranked by primary-axis distance plus a weighted
 * cross-axis penalty so the traversal follows a roughly straight line. Returns
 * null when nothing lies in the requested direction (no wrap-around).
 *
 * When no feature is currently focused, spatial navigation seeds on the
 * sequential first feature so the first arrow press is never a no-op.
 */
export function spatialTarget(
  features: readonly NavigableFeature[],
  currentId: string | null,
  direction: SpatialDirection,
): NavigableFeature | null {
  if (features.length === 0) return null;

  const current = features.find((f) => f.id === currentId) ?? null;
  if (!current) {
    return sequentialTarget(features, null, 'first');
  }

  let best: NavigableFeature | null = null;
  let bestScore = Infinity;

  for (const f of features) {
    if (f.id === current.id) continue;

    const dLng = f.lng - current.lng;
    const dLat = f.lat - current.lat;

    let primary: number;
    let cross: number;
    switch (direction) {
      case 'right':
        if (dLng <= 0) continue;
        primary = dLng;
        cross = Math.abs(dLat);
        break;
      case 'left':
        if (dLng >= 0) continue;
        primary = -dLng;
        cross = Math.abs(dLat);
        break;
      case 'up':
        if (dLat <= 0) continue;
        primary = dLat;
        cross = Math.abs(dLng);
        break;
      case 'down':
        if (dLat >= 0) continue;
        primary = -dLat;
        cross = Math.abs(dLng);
        break;
    }

    const score = primary + CROSS_AXIS_PENALTY * cross;
    if (score < bestScore || (score === bestScore && best !== null && f.id < best.id)) {
      bestScore = score;
      best = f;
    }
  }

  return best;
}

/**
 * Apply a decoded traversal intent, returning the feature that should receive
 * focus, or null when the intent produces no movement (empty list, or nothing
 * in the requested spatial direction). `select` and `exit` intents never move
 * focus and always return null — callers handle those out of band.
 */
export function applyTraversal(
  features: readonly NavigableFeature[],
  currentId: string | null,
  intent: TraversalIntent,
): NavigableFeature | null {
  switch (intent.kind) {
    case 'spatial':
      return spatialTarget(features, currentId, intent.direction);
    case 'sequential':
      return sequentialTarget(features, currentId, intent.step);
    case 'select':
    case 'exit':
      return null;
  }
}

/**
 * Decode a keyboard event's key (plus shift state) into a traversal intent,
 * or null if the key is not a traversal key. Arrow keys map to spatial
 * directions; Home/End to first/last; Enter/Space to select; Escape to exit;
 * `[` / `]` (and Shift+Tab / Tab semantics via 'prev'/'next') to sequential
 * stepping. This is the single place key bindings are defined so the hook and
 * the help dialog stay in sync.
 */
export function decodeTraversalKey(
  key: string,
  opts: { shiftKey?: boolean } = {},
): TraversalIntent | null {
  switch (key) {
    case 'ArrowRight':
      return { kind: 'spatial', direction: 'right' };
    case 'ArrowLeft':
      return { kind: 'spatial', direction: 'left' };
    case 'ArrowUp':
      return { kind: 'spatial', direction: 'up' };
    case 'ArrowDown':
      return { kind: 'spatial', direction: 'down' };
    case 'Home':
      return { kind: 'sequential', step: 'first' };
    case 'End':
      return { kind: 'sequential', step: 'last' };
    case ']':
      return { kind: 'sequential', step: 'next' };
    case '[':
      return { kind: 'sequential', step: 'prev' };
    case 'Tab':
      return { kind: 'sequential', step: opts.shiftKey ? 'prev' : 'next' };
    case 'Enter':
    case ' ':
      return { kind: 'select' };
    case 'Escape':
      return { kind: 'exit' };
    default:
      return null;
  }
}

/**
 * Build the screen-reader announcement for landing on a feature during
 * traversal, including a "1 of N" position cue. Reuses describeFeature so the
 * wording matches feature info panels.
 */
export function announceFeatureFocus(
  feature: NavigableFeature,
  features: readonly NavigableFeature[],
): string {
  const ordered = orderFeatures(features);
  const position = ordered.findIndex((f) => f.id === feature.id) + 1;
  const description = describeFeature({
    type: feature.type,
    name: feature.name,
    timeStart: feature.timeStart,
    timeEnd: feature.timeEnd,
    extra: feature.extra,
  });
  const total = ordered.length;
  return total > 0 ? `${description}. ${position} of ${total}.` : description;
}
