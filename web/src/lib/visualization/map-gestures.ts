/**
 * Pure touch/gesture recognition for map interaction.
 *
 * Classifies raw touch point samples into high-level gestures (tap, swipe,
 * pinch) so mobile/touch users get explicit, testable gesture handling instead
 * of relying solely on the underlying map library's built-in handlers. All
 * functions are pure — the component layer feeds them TouchEvent coordinates
 * and reacts to the returned gesture. Tested in the node vitest environment
 * (no DOM required).
 */

/** A single touch sample: a screen-space point. */
export interface TouchPoint {
  x: number;
  y: number;
}

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export interface SwipeGesture {
  kind: 'swipe';
  direction: SwipeDirection;
  distance: number;
}

export interface TapGesture {
  kind: 'tap';
  point: TouchPoint;
}

export interface PinchGesture {
  kind: 'pinch';
  /** > 1 = fingers spread apart (zoom in); < 1 = pinch together (zoom out). */
  scale: number;
}

export type Gesture = SwipeGesture | TapGesture | PinchGesture;

export interface SwipeOptions {
  /** Minimum travel (px) along the dominant axis to count as a swipe. */
  minDistance?: number;
  /**
   * Minimum ratio between the dominant and off axis for the swipe to be
   * considered directional rather than diagonal. Higher = stricter.
   */
  dominanceRatio?: number;
}

const DEFAULT_MIN_SWIPE = 30;
const DEFAULT_DOMINANCE = 1.5;
/** Below this movement a one-finger gesture is treated as a tap, not a swipe. */
export const TAP_MAX_TRAVEL = 10;

export function distanceBetween(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Classify a single-finger gesture from its start and end points. Returns a
 * tap for near-stationary touches, a directional swipe when the dominant axis
 * clears `minDistance` and the `dominanceRatio` threshold, or null for
 * ambiguous diagonal drags that are neither a clean tap nor a clean swipe.
 */
export function recognizeSwipe(
  start: TouchPoint,
  end: TouchPoint,
  opts: SwipeOptions = {},
): SwipeGesture | TapGesture | null {
  const minDistance = opts.minDistance ?? DEFAULT_MIN_SWIPE;
  const dominanceRatio = opts.dominanceRatio ?? DEFAULT_DOMINANCE;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX <= TAP_MAX_TRAVEL && absY <= TAP_MAX_TRAVEL) {
    return { kind: 'tap', point: { x: end.x, y: end.y } };
  }

  const horizontal = absX >= absY;
  const dominant = horizontal ? absX : absY;
  const offAxis = horizontal ? absY : absX;

  if (dominant < minDistance) return null;
  // Guard against diagonal drags: require the dominant axis to clearly win.
  if (offAxis > 0 && dominant / offAxis < dominanceRatio) return null;

  let direction: SwipeDirection;
  if (horizontal) {
    direction = dx > 0 ? 'right' : 'left';
  } else {
    direction = dy > 0 ? 'down' : 'up';
  }

  return { kind: 'swipe', direction, distance: dominant };
}

/**
 * Compute the pinch scale between an initial two-finger span and a current
 * one. `scale > 1` means the fingers spread apart (zoom in), `< 1` means they
 * moved together (zoom out). Returns 1 (no-op) when the initial span is
 * degenerate to avoid division by zero.
 */
export function pinchScale(
  startA: TouchPoint,
  startB: TouchPoint,
  currentA: TouchPoint,
  currentB: TouchPoint,
): number {
  const initial = distanceBetween(startA, startB);
  if (initial === 0) return 1;
  const current = distanceBetween(currentA, currentB);
  return current / initial;
}

/**
 * Translate a swipe gesture into a map pan intent (the direction the *content*
 * should move). A swipe left pans the view east (content moves left under the
 * finger), matching natural touch scrolling. Returns a unit delta in map
 * screen space that the caller scales by a pan step.
 */
export function swipeToPan(direction: SwipeDirection): { dx: number; dy: number } {
  switch (direction) {
    case 'left':
      return { dx: 1, dy: 0 };
    case 'right':
      return { dx: -1, dy: 0 };
    case 'up':
      return { dx: 0, dy: 1 };
    case 'down':
      return { dx: 0, dy: -1 };
  }
}

/**
 * Map a pinch scale to a discrete zoom delta: spread past `threshold` zooms
 * in (+1), pinch below its reciprocal zooms out (-1), otherwise no change (0).
 */
export function pinchToZoomDelta(scale: number, threshold = 1.2): number {
  if (scale >= threshold) return 1;
  if (scale <= 1 / threshold) return -1;
  return 0;
}
