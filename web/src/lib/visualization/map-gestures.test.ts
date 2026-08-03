import { describe, it, expect } from 'vitest';
import {
  distanceBetween,
  recognizeSwipe,
  pinchScale,
  swipeToPan,
  pinchToZoomDelta,
  TAP_MAX_TRAVEL,
  type TouchPoint,
} from './map-gestures';

const p = (x: number, y: number): TouchPoint => ({ x, y });

describe('distanceBetween', () => {
  it('computes euclidean distance', () => {
    expect(distanceBetween(p(0, 0), p(3, 4))).toBe(5);
  });
});

describe('recognizeSwipe', () => {
  it('classifies a near-stationary touch as a tap', () => {
    const g = recognizeSwipe(p(100, 100), p(100 + TAP_MAX_TRAVEL, 100));
    expect(g).toEqual({ kind: 'tap', point: { x: 110, y: 100 } });
  });

  it('detects horizontal swipes', () => {
    expect(recognizeSwipe(p(0, 0), p(80, 5))).toMatchObject({ kind: 'swipe', direction: 'right' });
    expect(recognizeSwipe(p(80, 0), p(0, 5))).toMatchObject({ kind: 'swipe', direction: 'left' });
  });

  it('detects vertical swipes', () => {
    expect(recognizeSwipe(p(0, 0), p(5, 80))).toMatchObject({ kind: 'swipe', direction: 'down' });
    expect(recognizeSwipe(p(0, 80), p(5, 0))).toMatchObject({ kind: 'swipe', direction: 'up' });
  });

  it('reports the dominant-axis distance', () => {
    const g = recognizeSwipe(p(0, 0), p(60, 0));
    expect(g).toMatchObject({ kind: 'swipe', distance: 60 });
  });

  it('rejects ambiguous diagonal drags', () => {
    // 40px right, 40px down -> ratio 1 < dominance 1.5 -> null.
    expect(recognizeSwipe(p(0, 0), p(40, 40))).toBeNull();
  });

  it('honors a custom minDistance threshold', () => {
    expect(recognizeSwipe(p(0, 0), p(20, 0), { minDistance: 50 })).toBeNull();
    expect(recognizeSwipe(p(0, 0), p(60, 0), { minDistance: 50 })).toMatchObject({ kind: 'swipe' });
  });

  it('honors a custom dominanceRatio', () => {
    // 40 right / 20 down = ratio 2; strict ratio 3 -> null, lax ratio 1.5 -> swipe.
    expect(recognizeSwipe(p(0, 0), p(40, 20), { dominanceRatio: 3 })).toBeNull();
    expect(recognizeSwipe(p(0, 0), p(40, 20), { dominanceRatio: 1.5 })).toMatchObject({ kind: 'swipe', direction: 'right' });
  });
});

describe('pinchScale', () => {
  it('returns > 1 when fingers spread apart (zoom in)', () => {
    const scale = pinchScale(p(0, 0), p(10, 0), p(0, 0), p(20, 0));
    expect(scale).toBe(2);
  });

  it('returns < 1 when fingers pinch together (zoom out)', () => {
    const scale = pinchScale(p(0, 0), p(20, 0), p(0, 0), p(10, 0));
    expect(scale).toBe(0.5);
  });

  it('guards against a degenerate initial span', () => {
    expect(pinchScale(p(5, 5), p(5, 5), p(0, 0), p(50, 0))).toBe(1);
  });
});

describe('swipeToPan', () => {
  it('maps swipe directions to inverse pan deltas (natural scroll)', () => {
    expect(swipeToPan('left')).toEqual({ dx: 1, dy: 0 });
    expect(swipeToPan('right')).toEqual({ dx: -1, dy: 0 });
    expect(swipeToPan('up')).toEqual({ dx: 0, dy: 1 });
    expect(swipeToPan('down')).toEqual({ dx: 0, dy: -1 });
  });
});

describe('pinchToZoomDelta', () => {
  it('zooms in past the threshold', () => {
    expect(pinchToZoomDelta(1.5)).toBe(1);
  });

  it('zooms out below the reciprocal', () => {
    expect(pinchToZoomDelta(0.5)).toBe(-1);
  });

  it('does nothing in the neutral band', () => {
    expect(pinchToZoomDelta(1.05)).toBe(0);
  });

  it('respects a custom threshold', () => {
    expect(pinchToZoomDelta(1.1, 1.05)).toBe(1);
    expect(pinchToZoomDelta(1.1, 1.5)).toBe(0);
  });
});
